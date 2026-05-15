# Prompt Caching: KV Cache Mechanics, Prefix Caching & Cost Optimization

Prompt caching is the single most accessible optimization available to engineers building on LLM APIs today. At its core, the technique exploits a fundamental property of transformer inference: the key-value (KV) cache computed during the prefill phase for a given token prefix is identical regardless of what follows it. When multiple requests share the same prefix -- a system prompt, tool definitions, few-shot examples, or conversation history -- the provider can reuse the cached KV tensors instead of recomputing them from scratch, reducing both latency and cost by 50-90%. This article examines KV cache mechanics from the ground up, explores how prefix caching works at the infrastructure level, then focuses on the practical engineering: how to use provider caching APIs (Anthropic, OpenAI, Google), how to structure prompts for maximum cache efficiency, and how to measure and optimize cache performance in production systems.

Understanding prompt caching sits at the intersection of several disciplines covered elsewhere in this knowledge base. The transformer attention mechanism that creates the KV cache is detailed in [Transformer Architecture](/transformer-architecture). The serving infrastructure that manages KV cache memory -- PagedAttention, continuous batching, disaggregated prefill/decode -- is covered in [Inference Optimization](/inference-optimization) and [LLM Serving](/llm-serving). The economic framework for evaluating when caching is worthwhile appears in [Cost Optimization](/cost-optimization). And the broader practice of designing what goes into the context window -- of which cache-aware prompt design is a critical technique -- is the subject of [Context Engineering](/context-engineering).

## KV Cache Fundamentals

### Why the KV Cache Exists

During autoregressive generation, a transformer generates one token at a time. Each new token must attend to all previous tokens through the self-attention mechanism. Without caching, generating the $t$-th token would require recomputing the key and value projections for all $t-1$ preceding tokens -- an $O(t^2)$ operation per generated token, and $O(t^3)$ total for generating a sequence of length $t$. The KV cache eliminates this redundancy by storing the key and value vectors after they are computed, so each decode step only computes the query, key, and value for the single new token and attends to the cached keys and values from all prior positions.

```
Autoregressive Generation Without KV Cache (wasteful):

Step 1: Compute K,V for [token_1]                        -> generate token_2
Step 2: Compute K,V for [token_1, token_2]               -> generate token_3
Step 3: Compute K,V for [token_1, token_2, token_3]      -> generate token_4
                         ^^^^^^^^^^^^^^^^^^^^^^
                         Recomputed every step!

Autoregressive Generation With KV Cache (efficient):

Step 1: Compute K,V for [token_1], store in cache         -> generate token_2
Step 2: Compute K,V for [token_2], append to cache         -> generate token_3
Step 3: Compute K,V for [token_3], append to cache         -> generate token_4
         Only the new token's K,V are computed each step.
```

### What the KV Cache Stores

For each layer $l$ in the transformer and each attention head $h$, the KV cache stores two tensors:

- **Key tensor**: $K_l^h \in \mathbb{R}^{t \times d_h}$ -- the key projections for all $t$ tokens processed so far
- **Value tensor**: $V_l^h \in \mathbb{R}^{t \times d_h}$ -- the value projections for all $t$ tokens processed so far

where $d_h$ is the head dimension (typically 64 or 128). The total KV cache for a sequence of length $t$ in a model with $L$ layers and $n_{kv}$ key-value heads is:

```
KV cache memory = 2 * L * n_kv * d_h * t * bytes_per_element

Example: Claude Sonnet-class model (estimated)
  L = 80 layers, n_kv = 8 (GQA), d_h = 128, dtype = bf16 (2 bytes)
  For a 4K token prompt:
    2 * 80 * 8 * 128 * 4096 * 2 = 1.07 GB

  For a 128K token prompt:
    2 * 80 * 8 * 128 * 131072 * 2 = 34.4 GB
```

The key insight is that the KV cache is computed *deterministically* from the input tokens. Given the same sequence of input tokens, the same model weights, and the same numerical precision, the resulting KV cache is bit-for-bit identical. This determinism is what makes prefix caching possible.

### The Two Phases of Inference

LLM inference proceeds in two phases with radically different computational profiles, and understanding them is essential for grasping why prefix caching matters:

```
┌──────────────────────────────────────────────────────────────┐
│                    LLM Inference Pipeline                     │
│                                                              │
│  Phase 1: PREFILL                   Phase 2: DECODE          │
│  ─────────────────                  ─────────────            │
│  Process entire prompt              Generate tokens one      │
│  in parallel                        at a time                │
│                                                              │
│  Compute-bound                      Memory-bandwidth-bound   │
│  (matrix-matrix multiply)           (matrix-vector multiply) │
│                                                              │
│  Populates KV cache                 Reads from KV cache,     │
│  for all prompt tokens              appends one entry/step   │
│                                                              │
│  Latency = TTFT                     Latency = ITL * tokens   │
│  (Time to First Token)              (Inter-Token Latency)    │
│                                                              │
│  Cost driver: prompt length         Cost driver: output len  │
│  Optimization: caching              Optimization: batching   │
└──────────────────────────────────────────────────────────────┘
```

Prompt caching targets Phase 1. When a prefix is cache-hit, the prefill phase for those tokens is skipped entirely -- the pre-computed KV cache entries are loaded into memory directly. This reduces TTFT proportionally to the fraction of the prompt that is cached. For a request with a 3000-token cached prefix and a 200-token unique suffix, the prefill only processes 200 tokens instead of 3200 -- a 94% reduction in prefill computation.

## How Prefix Caching Works

### The Prefix Invariance Property

The critical property that enables prefix caching is *prefix invariance*: in a causal (left-to-right) transformer, the KV cache entries for position $i$ depend only on tokens at positions $0$ through $i$ -- never on tokens that come after position $i$. This means if two requests share the first $k$ tokens, their KV caches are identical for all positions $0$ through $k-1$, regardless of how the requests diverge after position $k$.

```
Request A: [system_prompt | tool_defs | user_query_A]
Request B: [system_prompt | tool_defs | user_query_B]
           |<-- identical prefix -->|  |<- different ->|

KV cache for positions 0..k-1 is IDENTICAL for both requests.
Only positions k..end need fresh computation.
```

This property does *not* hold for bidirectional attention (as in encoder models like BERT), where every position attends to every other position. Prefix caching is specific to causal (decoder-only) transformers -- the architecture used by GPT, Claude, Gemini, Llama, and essentially all modern LLMs.

### Infrastructure-Level Implementation

At the serving infrastructure level, prefix caching is implemented through data structures that index KV cache blocks by their token content. The two primary approaches are:

**Hash-based (vLLM Automatic Prefix Caching)**: Each KV cache block (typically 16 tokens) is hashed by its token content. When a new request arrives, the system hashes each block of the prompt and checks for existing blocks with the same hash. Matching blocks are shared via copy-on-write semantics. See [Inference Optimization](/inference-optimization) for the full PagedAttention architecture.

**Radix tree (SGLang RadixAttention)**: The KV cache is organized as a radix tree (compressed trie) keyed by token sequences. New requests perform a longest-prefix match against the tree. The matched portion of the KV cache is reused; only the unmatched suffix undergoes prefill. The radix tree supports efficient insertion, deletion, and LRU eviction of cached prefixes.

```
Radix Tree for KV Cache (conceptual):

Root
 |
 "You are a helpful AI assistant that..." (system prompt, 500 tokens)
 ├── "Analyze this code:\n```python..." (code analysis request)
 │    └── KV cache: 500 + 45 tokens
 ├── "Translate the following to French..." (translation request)
 │    └── KV cache: 500 + 38 tokens
 └── "You are a helpful AI assistant that... Given tools:" (extended prefix)
      ├── "[tool schemas]... User: summarize..." (tool-augmented request A)
      │    └── KV cache: 500 + 200 + 30 tokens
      └── "[tool schemas]... User: debug..."     (tool-augmented request B)
           └── KV cache: 500 + 200 + 25 tokens

Request B reuses 700 tokens of KV cache from the tree.
Only 25 new tokens need prefill.
```

### Provider-Level vs. Self-Hosted Caching

The same prefix caching concept manifests differently depending on where inference runs:

| Aspect | Provider API (Anthropic/OpenAI/Google) | Self-hosted (vLLM/SGLang/TGI) |
|---|---|---|
| Cache scope | Per-organization, cross-request | Per-server instance |
| Control | API parameters or automatic | Server configuration flags |
| Visibility | Usage metadata in responses | Prometheus metrics, logs |
| TTL | Provider-managed (5min-1hr) | Configurable or LRU eviction |
| Cost model | Discounted token rate | Reduced GPU compute time |
| Granularity | Token-level prefix matching | Block-level (16-token blocks) |

## Provider Implementations

### Anthropic: Explicit Prompt Caching

Anthropic's prompt caching gives engineers explicit control over what gets cached through `cache_control` breakpoints. This is the most granular caching API available from any major provider, offering up to 90% cost reduction on cached input tokens.

**How it works**: You annotate content blocks in your messages with `cache_control: {"type": "ephemeral"}` to mark cache breakpoints. The Anthropic infrastructure caches the KV cache state up to each breakpoint. On subsequent requests, if the prefix up to a breakpoint matches exactly (same tokens, same order), the cached KV state is reused.

**Pricing model**:
- Cache write: 25% surcharge over base input token price
- Cache read (hit): 90% discount off base input token price
- Cache TTL: 5 minutes, reset on each hit

**Minimum cacheable length**: 1024 tokens for Claude Sonnet/Opus, 2048 tokens for Claude Haiku. Content shorter than this threshold will not be cached even if annotated.

```python
import anthropic

client = anthropic.Anthropic()

# The system prompt and tool definitions are static across requests.
# Mark them with cache_control to cache the KV state.

system_prompt = """You are an expert code reviewer. You analyze code for:
1. Security vulnerabilities (SQL injection, XSS, CSRF, etc.)
2. Performance issues (N+1 queries, unnecessary allocations, etc.)
3. Maintainability concerns (dead code, unclear naming, etc.)
4. Best practice violations for the detected language.

Always structure your response as JSON with the following schema:
{
  "issues": [
    {
      "severity": "critical" | "warning" | "info",
      "category": "security" | "performance" | "maintainability" | "best-practice",
      "line": <number>,
      "description": "<string>",
      "suggestion": "<string>"
    }
  ],
  "summary": "<string>",
  "score": <0-100>
}
"""  # ~200 tokens -- below 1024 minimum, so we combine with tools

tool_definitions = """
Available tools for deeper analysis:
- grep_codebase(pattern, path): Search for patterns across the codebase
- read_file(path): Read a file's contents
- run_tests(path): Execute test suite for a module
- check_dependencies(package): Check for known vulnerabilities in a dependency
... [imagine 900+ more tokens of tool schemas]
"""

# Combined system content exceeds 1024 tokens -- eligible for caching
response = client.messages.create(
    model="claude-sonnet-4-20250514",
    max_tokens=2048,
    system=[
        {
            "type": "text",
            "text": system_prompt + "\n\n" + tool_definitions,
            "cache_control": {"type": "ephemeral"}  # <-- Cache breakpoint
        }
    ],
    messages=[
        {"role": "user", "content": f"Review this code:\n```python\n{user_code}\n```"}
    ],
)

# Check cache performance in the response
usage = response.usage
print(f"Input tokens: {usage.input_tokens}")
print(f"Cache creation tokens: {usage.cache_creation_input_tokens}")
print(f"Cache read tokens: {usage.cache_read_input_tokens}")

# First request output:
#   Input tokens: 1250
#   Cache creation tokens: 1150   <-- System prompt cached (pays 1.25x)
#   Cache read tokens: 0
#
# Subsequent requests (within 5 min):
#   Input tokens: 100             <-- Only the user message
#   Cache creation tokens: 0
#   Cache read tokens: 1150       <-- Cache hit! (pays 0.10x)
```

**Multiple breakpoints**: You can set up to 4 cache breakpoints to create a hierarchy of cached prefixes. This is powerful for multi-turn conversations where you want to cache the system prompt, then the conversation history, then tool results:

```python
# Multi-breakpoint caching for a conversation with tools
response = client.messages.create(
    model="claude-sonnet-4-20250514",
    max_tokens=1024,
    system=[
        {
            "type": "text",
            "text": long_system_prompt,         # ~1500 tokens
            "cache_control": {"type": "ephemeral"}  # Breakpoint 1
        }
    ],
    messages=[
        # Conversation history -- stable across the current turn
        {"role": "user", "content": "Analyze the auth module"},
        {"role": "assistant", "content": previous_analysis},
        {
            "role": "user",
            "content": [
                {
                    "type": "text",
                    "text": "Now check the database module too",
                    "cache_control": {"type": "ephemeral"}  # Breakpoint 2
                }
            ]
        },
        {"role": "assistant", "content": db_analysis},
        # Latest turn -- not cached, changes each request
        {"role": "user", "content": "Compare the two and suggest refactoring priorities"}
    ],
)
```

The TypeScript equivalent uses the same structure:

```typescript
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

const response = await client.messages.create({
  model: "claude-sonnet-4-20250514",
  max_tokens: 1024,
  system: [
    {
      type: "text",
      text: longSystemPrompt,
      cache_control: { type: "ephemeral" },
    },
  ],
  messages: [
    { role: "user", content: userQuery },
  ],
});

// TypeScript usage types
const { input_tokens, cache_creation_input_tokens, cache_read_input_tokens } =
  response.usage;

console.log(`Cache hit rate: ${
  cache_read_input_tokens /
  (cache_read_input_tokens + cache_creation_input_tokens + input_tokens) *
  100
}%`);
```

### OpenAI: Automatic Prompt Caching

OpenAI's approach is simpler: caching happens automatically for any prompt longer than 1024 tokens, with no code changes required. There is no write fee -- cached tokens are billed at 50% of the standard input rate.

**How it works**: OpenAI automatically detects when a request's prompt prefix matches a recently cached prefix. The matching is done in 128-token increments -- so a prompt must share at least 1024 tokens with a cached prefix to benefit, and additional savings accrue in 128-token chunks. The cache is scoped to the organization and has an unspecified (but typically minutes-scale) TTL.

**Pricing model**:
- Cache write: no surcharge (free)
- Cache read (hit): 50% discount off base input token price
- No explicit TTL published; cache persists "for minutes to hours" depending on demand

```python
from openai import OpenAI

client = OpenAI()

# Long system prompt with tool definitions -- automatically cached
# No special annotations needed
system_message = {
    "role": "system",
    "content": long_system_prompt  # Must be >= 1024 tokens for caching
}

# First request -- populates cache
response1 = client.chat.completions.create(
    model="gpt-4o",
    messages=[
        system_message,
        {"role": "user", "content": "Analyze this dataset for anomalies."}
    ],
)

# Second request with same prefix -- cache hit
response2 = client.chat.completions.create(
    model="gpt-4o",
    messages=[
        system_message,  # Same system prompt -> cached
        {"role": "user", "content": "Now cluster the results by severity."}
    ],
)

# Check for cache usage in the response
print(response2.usage)
# CompletionUsage(
#     prompt_tokens=1250,
#     completion_tokens=340,
#     prompt_tokens_details=PromptTokensDetails(
#         cached_tokens=1152  # <-- 1024+ tokens served from cache at 50% rate
#     )
# )
```

```typescript
import OpenAI from "openai";

const client = new OpenAI();

const response = await client.chat.completions.create({
  model: "gpt-4o",
  messages: [
    { role: "system", content: longSystemPrompt },
    { role: "user", content: userQuery },
  ],
});

// Automatic caching -- check the usage details
const cached = response.usage?.prompt_tokens_details?.cached_tokens ?? 0;
const total = response.usage?.prompt_tokens ?? 0;
console.log(`Cached: ${cached}/${total} tokens (${(cached / total * 100).toFixed(1)}%)`);
```

**Key differences from Anthropic**:

| Feature | Anthropic | OpenAI |
|---|---|---|
| Activation | Explicit (`cache_control`) | Automatic |
| Write cost | 25% surcharge | None |
| Read discount | 90% | 50% |
| Minimum size | 1024 tokens (Sonnet/Opus) | 1024 tokens |
| Granularity | Exact breakpoint position | 128-token increments |
| Max breakpoints | 4 per request | N/A (automatic) |
| TTL | 5 min (resets on hit) | Unspecified (~minutes) |
| Best for | High-traffic, long prefixes | Any workload >= 1024 token prefix |

The Anthropic model rewards you more for optimizing (90% vs 50% discount) but penalizes cache misses (25% surcharge). OpenAI's model is simpler -- you never pay more, and you sometimes pay less.

### Google Gemini: Context Caching

Google takes a third approach with an explicit caching API that creates named, persistent cache objects with configurable TTLs. This is the most operationally complex but also the most controllable option.

**How it works**: You create a cached content object via the API, specifying its contents (system instructions, few-shot examples, tool definitions, or even entire documents). The cache returns a handle that you reference in subsequent generation requests. Cached input tokens receive a 75% discount, but you pay a per-hour storage cost for maintaining the cache.

**Pricing model**:
- Cache creation: standard input token price
- Cache read (hit): 75% discount off standard input price
- Storage cost: per-1M-tokens-per-hour (varies by model)
- Configurable TTL: you set it explicitly

```python
import google.generativeai as genai

genai.configure(api_key="YOUR_API_KEY")

# Create a cached content object with a long reference document
cached_content = genai.caching.CachedContent.create(
    model="models/gemini-2.0-flash",
    display_name="product-catalog-cache",
    system_instruction="You are a product recommendation assistant. "
                       "Use the catalog below to answer questions accurately.",
    contents=[
        # A large product catalog -- perhaps 50K tokens
        genai.types.ContentDict(
            role="user",
            parts=[genai.types.PartDict(text=product_catalog_text)]
        ),
        genai.types.ContentDict(
            role="model",
            parts=[genai.types.PartDict(
                text="I have loaded the product catalog. Ready for questions."
            )]
        ),
    ],
    ttl="3600s",  # 1 hour TTL
)

print(f"Cache name: {cached_content.name}")
print(f"Token count: {cached_content.usage_metadata.total_token_count}")
# Cache name: cachedContents/abc123
# Token count: 52340

# Use the cached content in generation requests
model = genai.GenerativeModel.from_cached_content(cached_content)
response = model.generate_content("What wireless headphones do you recommend under $100?")

# The 52K cached tokens are billed at 75% discount.
# Only the user query tokens are billed at full rate.
```

**When Gemini context caching makes sense**: The explicit cache creation model is best suited for scenarios where you have a very large, stable context (a full codebase, a legal document, a product catalog) that will be queried many times over a period of hours. The storage cost means you need enough query volume to offset the hourly charge.

```
Gemini cache break-even calculation:

Cache size: 50K tokens
Storage cost: ~$0.0025/hour (model-dependent)
Per-query savings: 50K tokens * $0.075/MTok discount = $0.00375 per query

Break-even: $0.0025/hour / $0.00375/query = ~0.67 queries/hour
            Even 1 query per hour makes the cache worthwhile.

For 100 queries/hour:
  Without cache: 100 * 50K * $0.10/MTok = $0.50/hour
  With cache: storage($0.0025) + 100 * 50K * $0.025/MTok = $0.1275/hour
  Savings: 74%
```

### Provider Comparison Summary

```
Cost reduction per cached input token (relative to base input price):

Anthropic:  |##########| 90% discount (but 25% write surcharge)
Google:     |#######   | 75% discount (plus storage cost)
OpenAI:     |#####     | 50% discount (no write surcharge)

Break-even requests (for 2000-token prefix, one cache write):

Anthropic:  ~2 requests   (write cost recouped quickly due to large discount)
OpenAI:     1 request     (no write cost, immediate savings)
Google:     ~1 request    (depends on TTL vs storage cost)

Anthropic wins for: high-volume, long-prefix workloads (chatbots, agents)
OpenAI wins for:    simplicity, moderate-volume workloads
Google wins for:    very large contexts queried over hours (document QA)
```

## Self-Hosted Caching

When running your own inference infrastructure, prefix caching is a server-side configuration rather than an API feature. The three major open-source serving frameworks each implement it differently.

### vLLM Automatic Prefix Caching (APC)

vLLM's automatic prefix caching extends its PagedAttention memory manager. Each KV cache block is hashed by its token content, and blocks with matching hashes are shared across requests via copy-on-write.

```bash
# Enable APC when launching vLLM
python -m vllm.entrypoints.openai.api_server \
    --model meta-llama/Llama-3.1-70B-Instruct \
    --enable-prefix-caching \
    --max-model-len 32768 \
    --tensor-parallel-size 4 \
    --gpu-memory-utilization 0.92
```

With APC enabled, vLLM automatically detects and reuses common prefixes across all requests. No client-side changes are needed -- the OpenAI-compatible API works identically, but requests with shared prefixes see reduced TTFT and higher throughput.

```python
# Client code is identical with or without APC -- it is transparent
from openai import OpenAI

# Point to your vLLM server
client = OpenAI(base_url="http://localhost:8000/v1", api_key="unused")

# These requests share a system prompt prefix.
# With APC enabled, the second request's prefill skips the shared prefix.
for user_query in batch_of_queries:
    response = client.chat.completions.create(
        model="meta-llama/Llama-3.1-70B-Instruct",
        messages=[
            {"role": "system", "content": long_system_prompt},  # Cached after first request
            {"role": "user", "content": user_query},
        ],
    )
```

**Performance impact**: In benchmarks with a 2048-token shared system prompt, APC reduces TTFT by 60-80% for cache-hit requests and increases overall throughput by 1.5-2.5x, depending on the ratio of cached-to-unique tokens.

**Monitoring**: vLLM exposes prefix caching metrics via Prometheus:

```
# Prometheus metrics for APC monitoring
vllm:prefix_cache_hit_rate          # Fraction of blocks served from cache
vllm:prefix_cache_num_blocks        # Total blocks in the prefix cache
vllm:prefix_cache_num_evictions     # Blocks evicted (cache pressure indicator)
```

### SGLang RadixAttention

SGLang's RadixAttention organizes the KV cache as a radix tree, enabling automatic prefix matching at arbitrary granularity. This approach is particularly effective for workloads with a tree-structured prefix pattern -- such as LLM-as-judge evaluations where many candidates share the same evaluation rubric prefix.

```python
# SGLang server launch with RadixAttention (enabled by default)
# python -m sglang.launch_server --model meta-llama/Llama-3.1-70B-Instruct \
#     --tp 4 --chunked-prefill-size 8192

import sglang as sgl

@sgl.function
def code_review(s, system_prompt, code_snippet):
    s += sgl.system(system_prompt)  # Shared prefix -- cached in radix tree
    s += sgl.user(f"Review this code:\n```\n{code_snippet}\n```")
    s += sgl.assistant(sgl.gen("review", max_tokens=1024))

# Batch execution -- SGLang automatically shares the system prompt KV cache
# across all items in the batch via the radix tree
runtime = sgl.Runtime(model_path="meta-llama/Llama-3.1-70B-Instruct", tp_size=4)
sgl.set_default_backend(runtime)

results = code_review.run_batch(
    [{"system_prompt": shared_system_prompt, "code_snippet": snippet}
     for snippet in code_snippets],
    num_threads=32,
)
```

SGLang's radix tree provides automatic prefix sharing across concurrent requests without any explicit cache management. The tree structure also supports efficient eviction -- least-recently-used leaf nodes are pruned first, preserving heavily-shared interior prefixes.

### TGI (Text Generation Inference)

Hugging Face TGI supports prefix caching through its `--prefix-caching` flag. The implementation is block-based, similar to vLLM's approach.

```bash
# Launch TGI with prefix caching
text-generation-launcher \
    --model-id meta-llama/Llama-3.1-70B-Instruct \
    --prefix-caching \
    --max-input-length 32768 \
    --max-total-tokens 65536 \
    --num-shard 4
```

### Self-Hosted Caching Comparison

| Feature | vLLM APC | SGLang RadixAttention | TGI |
|---|---|---|---|
| Data structure | Hash table | Radix tree | Hash table |
| Granularity | Block-level (16 tokens) | Token-level | Block-level |
| Eviction policy | LRU per block | LRU, leaf-first | LRU per block |
| Multi-request sharing | Copy-on-write | Tree node sharing | Copy-on-write |
| Cross-request matching | Automatic | Automatic | Automatic |
| Tree-structured workloads | Good | Excellent | Good |
| Monitoring | Prometheus metrics | Built-in analytics | Prometheus metrics |

## Cache-Aware Prompt Design

The most impactful optimization an engineer can make -- independent of which provider or serving framework they use -- is structuring prompts so that static content comes first and dynamic content comes last. This maximizes the length of the cacheable prefix.

### The Golden Rule: Static First, Dynamic Last

```
OPTIMAL for caching:

┌─────────────────────────────────────────┐
│  System instructions     (static)       │  ← Cached across ALL requests
│  Tool/function schemas   (static)       │
│  Few-shot examples       (static)       │
│  Reference documents     (semi-static)  │  ← Cached across similar requests
│  Conversation history    (per-session)  │  ← Cached within a session
│  Current user message    (dynamic)      │  ← Never cached (always unique)
└─────────────────────────────────────────┘

SUBOPTIMAL for caching:

┌─────────────────────────────────────────┐
│  Current user message    (dynamic)      │  ← Breaks cache immediately
│  System instructions     (static)       │  ← Can't cache (prefix differs)
│  Retrieved documents     (dynamic)      │  ← Can't cache
│  Tool schemas            (static)       │  ← Can't cache
└─────────────────────────────────────────┘
```

This is not merely a theoretical concern. Misordering prompt components can eliminate caching entirely, even when the majority of content is static. A single dynamic token at position 0 invalidates the entire prefix cache.

### Layered Caching Architecture

For complex applications, design your prompt as a series of increasingly specific layers, each building on the cache of the layer above:

```
Layer 0: Model identity + core constraints       (~500 tokens)
         Cached across: ALL requests
         Example: "You are an AI assistant for AcmeCorp..."

Layer 1: Tool definitions + output schemas        (~1500 tokens)
         Cached across: ALL requests for this tool configuration
         Example: function schemas, JSON output format

Layer 2: Domain knowledge / few-shot examples     (~2000 tokens)
         Cached across: Requests in the same domain/task
         Example: "Here are examples of good code reviews..."

Layer 3: Session context / conversation history   (variable)
         Cached across: Turns within a single conversation
         Example: previous messages in the chat

Layer 4: Current turn (user message + retrieval)  (variable)
         Cached across: NEVER (unique per request)
```

```python
# Implementing layered caching with Anthropic

def build_messages_for_caching(
    system_prompt: str,        # Layer 0 + 1: static
    few_shot_examples: str,    # Layer 2: semi-static
    conversation_history: list,  # Layer 3: per-session
    current_query: str,        # Layer 4: unique
) -> dict:
    """Structure messages for maximum cache efficiency."""

    # Layer 0+1+2: Cache the entire static prefix as one block
    system_content = [
        {
            "type": "text",
            "text": system_prompt + "\n\n" + few_shot_examples,
            "cache_control": {"type": "ephemeral"},  # Breakpoint 1
        }
    ]

    # Layer 3: Cache conversation history (grows each turn)
    messages = []
    for i, msg in enumerate(conversation_history):
        if i == len(conversation_history) - 1:
            # Mark last history message as cache breakpoint
            messages.append({
                "role": msg["role"],
                "content": [
                    {
                        "type": "text",
                        "text": msg["content"],
                        "cache_control": {"type": "ephemeral"},  # Breakpoint 2
                    }
                ],
            })
        else:
            messages.append(msg)

    # Layer 4: Current query (never cached)
    messages.append({"role": "user", "content": current_query})

    return {"system": system_content, "messages": messages}
```

### RAG Context Placement

A common mistake in RAG applications is placing retrieved documents before the system prompt or interspersing them with static instructions. Retrieved content is dynamic by nature -- it changes with every query. Placing it early in the prompt destroys prefix caching for everything that follows.

```
BAD: Retrieved docs break the cacheable prefix

  [System prompt] [Retrieved chunk 1] [Instructions] [Retrieved chunk 2] [Query]
  |<- cached ->|  |<- CACHE MISS: different docs every request -------->|

GOOD: Retrieved docs at the end, after all static content

  [System prompt] [Instructions] [Few-shot examples] [Retrieved chunks] [Query]
  |<----------- cached across requests ----------->| |<- unique/turn ->|
```

```python
# RAG prompt structure optimized for caching
def build_rag_prompt(
    system: str,
    examples: str,
    retrieved_chunks: list[str],
    user_query: str,
) -> dict:
    """Place retrieved content AFTER static prefix for cache efficiency."""
    return {
        "system": [
            {
                "type": "text",
                "text": f"{system}\n\n## Examples\n\n{examples}",
                "cache_control": {"type": "ephemeral"},
            }
        ],
        "messages": [
            {
                "role": "user",
                "content": (
                    "## Reference Documents\n\n"
                    + "\n\n---\n\n".join(retrieved_chunks)
                    + f"\n\n## Question\n\n{user_query}"
                ),
            }
        ],
    }
```

For deeper patterns on structuring retrieval contexts, see [Context Engineering](/context-engineering) and [Advanced RAG](/advanced-rag).

### Tool Definition Ordering

When using function calling or tool use, tool definitions are typically part of the system message and are static across requests. Ensure they are included in the cached prefix, not appended dynamically:

```python
# Tool definitions as part of the cached system block
tools = [
    {
        "name": "search_database",
        "description": "Search the product database by query",
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {"type": "string"},
                "filters": {
                    "type": "object",
                    "properties": {
                        "category": {"type": "string"},
                        "price_max": {"type": "number"},
                    },
                },
            },
            "required": ["query"],
        },
    },
    # ... more tool definitions
]

# With Anthropic, tools are passed at the top level and cached automatically
# when they appear before the first message
response = client.messages.create(
    model="claude-sonnet-4-20250514",
    max_tokens=1024,
    system=[{
        "type": "text",
        "text": system_prompt,
        "cache_control": {"type": "ephemeral"},
    }],
    tools=tools,  # Tool defs become part of the prefix
    messages=[{"role": "user", "content": user_query}],
)
```

For details on function calling patterns, see [Function Calling](/function-calling).

## Multi-Turn Conversation Caching

Multi-turn conversations are a natural fit for prefix caching because each new turn extends the previous turn's prefix. The conversation history is identical across consecutive turns within a session -- it only grows, it never changes.

### The Accumulating Prefix Pattern

```
Turn 1: [system] [user_1]
        |<- new ->|

Turn 2: [system] [user_1] [assistant_1] [user_2]
        |<--- cached from turn 1 --->|  |new|

Turn 3: [system] [user_1] [assistant_1] [user_2] [assistant_2] [user_3]
        |<------------ cached from turn 2 ------------>|       |new|

Turn 4: [system] ... [user_3] [assistant_3] [user_4]
        |<------------- cached from turn 3 ----------->| |new|
```

Each turn only pays for prefill on the new tokens (the latest user message), while the entire prior conversation is served from cache. For a conversation that accumulates 10K tokens of history, the 11th turn only prefills the new user message (~100 tokens) rather than all 10,100 tokens.

**Latency impact**: This is particularly valuable for interactive applications. Without caching, TTFT degrades linearly with conversation length as the prefill must process more tokens. With caching, TTFT remains approximately constant regardless of conversation history length -- it is proportional only to the length of the new turn.

```
TTFT vs. conversation length:

Without caching:          With prefix caching:
TTFT                      TTFT
 |                         |
 |              /          |
 |            /            |  ─ ─ ─ ─ ─ ─ ─ ─ (constant)
 |          /              |
 |        /                |
 |      /                  |
 |    /                    |
 |  /                      |
 └────────────────         └────────────────
   Conversation length       Conversation length
```

### Implementation for Multi-Turn Sessions

```python
import anthropic

client = anthropic.Anthropic()

class CachedConversation:
    """Manages a multi-turn conversation with optimal caching."""

    def __init__(self, system_prompt: str, model: str = "claude-sonnet-4-20250514"):
        self.model = model
        self.system = [{
            "type": "text",
            "text": system_prompt,
            "cache_control": {"type": "ephemeral"},
        }]
        self.messages: list[dict] = []
        self._total_cache_reads = 0
        self._total_cache_writes = 0

    def send(self, user_message: str) -> str:
        """Send a message, leveraging prefix caching for conversation history."""
        # Build messages with cache breakpoint on the last history message
        messages_to_send = []

        for i, msg in enumerate(self.messages):
            if i == len(self.messages) - 1:
                # Mark the end of history as a cache breakpoint
                messages_to_send.append({
                    "role": msg["role"],
                    "content": [{
                        "type": "text",
                        "text": msg["content"] if isinstance(msg["content"], str)
                                else msg["content"],
                        "cache_control": {"type": "ephemeral"},
                    }],
                })
            else:
                messages_to_send.append(msg)

        # Add the new user message (uncached -- unique to this turn)
        messages_to_send.append({"role": "user", "content": user_message})

        response = client.messages.create(
            model=self.model,
            max_tokens=4096,
            system=self.system,
            messages=messages_to_send,
        )

        # Track cache performance
        usage = response.usage
        self._total_cache_reads += getattr(usage, "cache_read_input_tokens", 0)
        self._total_cache_writes += getattr(usage, "cache_creation_input_tokens", 0)

        assistant_text = response.content[0].text

        # Append both messages to history for next turn
        self.messages.append({"role": "user", "content": user_message})
        self.messages.append({"role": "assistant", "content": assistant_text})

        return assistant_text

    @property
    def cache_stats(self) -> dict:
        return {
            "total_cache_reads": self._total_cache_reads,
            "total_cache_writes": self._total_cache_writes,
            "estimated_savings_pct": (
                self._total_cache_reads /
                max(self._total_cache_reads + self._total_cache_writes, 1) * 90
            ),
        }


# Usage
convo = CachedConversation(system_prompt=long_system_prompt)
convo.send("What are the main performance bottlenecks in our API?")
convo.send("Can you elaborate on the N+1 query issue?")
convo.send("Show me how to implement DataLoaders to fix it.")
convo.send("Now write tests for the DataLoader implementation.")

print(convo.cache_stats)
# {'total_cache_reads': 12450, 'total_cache_writes': 3200,
#  'estimated_savings_pct': 71.6}
```

```typescript
// TypeScript equivalent for multi-turn caching
import Anthropic from "@anthropic-ai/sdk";

interface Message {
  role: "user" | "assistant";
  content: string;
}

class CachedConversation {
  private client: Anthropic;
  private model: string;
  private systemPrompt: Anthropic.MessageCreateParams["system"];
  private messages: Message[] = [];
  private cacheReads = 0;
  private cacheWrites = 0;

  constructor(systemPrompt: string, model = "claude-sonnet-4-20250514") {
    this.client = new Anthropic();
    this.model = model;
    this.systemPrompt = [
      {
        type: "text" as const,
        text: systemPrompt,
        cache_control: { type: "ephemeral" as const },
      },
    ];
  }

  async send(userMessage: string): Promise<string> {
    const messagesToSend: Anthropic.MessageCreateParams["messages"] =
      this.messages.map((msg, i) => {
        if (i === this.messages.length - 1) {
          return {
            role: msg.role,
            content: [
              {
                type: "text" as const,
                text: msg.content,
                cache_control: { type: "ephemeral" as const },
              },
            ],
          };
        }
        return msg;
      });

    messagesToSend.push({ role: "user", content: userMessage });

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      system: this.systemPrompt,
      messages: messagesToSend,
    });

    this.cacheReads += response.usage.cache_read_input_tokens ?? 0;
    this.cacheWrites += response.usage.cache_creation_input_tokens ?? 0;

    const text =
      response.content[0].type === "text" ? response.content[0].text : "";

    this.messages.push({ role: "user", content: userMessage });
    this.messages.push({ role: "assistant", content: text });

    return text;
  }
}
```

## Cache Hit Rates and Optimization

### Measuring Cache Effectiveness

Cache effectiveness should be measured along three dimensions:

1. **Hit rate**: Fraction of input tokens served from cache
2. **Cost savings**: Actual dollar reduction vs. uncached baseline
3. **Latency improvement**: TTFT reduction from cache hits

```python
# Cache monitoring wrapper
from dataclasses import dataclass, field
from datetime import datetime

@dataclass
class CacheMetrics:
    total_requests: int = 0
    total_input_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    uncached_tokens: int = 0
    total_latency_ms: float = 0
    cache_hit_latency_ms: float = 0
    cache_miss_latency_ms: float = 0
    _hit_count: int = field(default=0, repr=False)
    _miss_count: int = field(default=0, repr=False)

    @property
    def hit_rate(self) -> float:
        total = self.cache_read_tokens + self.cache_write_tokens + self.uncached_tokens
        return self.cache_read_tokens / max(total, 1)

    @property
    def cost_savings_pct(self) -> float:
        """Estimated savings assuming Anthropic pricing (90% read discount, 25% write surcharge)."""
        base_cost = (
            self.cache_read_tokens + self.cache_write_tokens + self.uncached_tokens
        )
        actual_cost = (
            self.cache_read_tokens * 0.10  # 90% discount
            + self.cache_write_tokens * 1.25  # 25% surcharge
            + self.uncached_tokens * 1.00
        )
        return (1 - actual_cost / max(base_cost, 1)) * 100

    @property
    def avg_ttft_improvement(self) -> float:
        avg_hit = self.cache_hit_latency_ms / max(self._hit_count, 1)
        avg_miss = self.cache_miss_latency_ms / max(self._miss_count, 1)
        return (1 - avg_hit / max(avg_miss, 1)) * 100

    def record(self, usage, latency_ms: float):
        self.total_requests += 1
        self.total_input_tokens += usage.input_tokens
        cache_read = getattr(usage, "cache_read_input_tokens", 0) or 0
        cache_write = getattr(usage, "cache_creation_input_tokens", 0) or 0

        self.cache_read_tokens += cache_read
        self.cache_write_tokens += cache_write
        self.uncached_tokens += usage.input_tokens - cache_read

        self.total_latency_ms += latency_ms
        if cache_read > 0:
            self.cache_hit_latency_ms += latency_ms
            self._hit_count += 1
        else:
            self.cache_miss_latency_ms += latency_ms
            self._miss_count += 1

    def report(self) -> str:
        return (
            f"Cache Performance Report\n"
            f"  Requests:      {self.total_requests}\n"
            f"  Hit rate:      {self.hit_rate:.1%}\n"
            f"  Cost savings:  {self.cost_savings_pct:.1f}%\n"
            f"  TTFT improve:  {self.avg_ttft_improvement:.1f}%\n"
            f"  Read tokens:   {self.cache_read_tokens:,}\n"
            f"  Write tokens:  {self.cache_write_tokens:,}\n"
        )
```

### Cache Warming Strategies

For applications with predictable traffic patterns, proactively warming the cache ensures that the first real user request benefits from caching rather than paying the write cost.

**Strategy 1: Startup warming** -- Send a minimal request with the cacheable prefix when the application starts or when a new system prompt is deployed:

```python
async def warm_cache(client: anthropic.AsyncAnthropic, system_prompt: str):
    """Send a minimal request to populate the prefix cache."""
    await client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=1,  # Minimize output cost
        system=[{
            "type": "text",
            "text": system_prompt,
            "cache_control": {"type": "ephemeral"},
        }],
        messages=[{"role": "user", "content": "ping"}],
    )
    # Cache is now warm. Subsequent requests pay cache_read rate.
```

**Strategy 2: Periodic keepalive** -- For Anthropic's 5-minute TTL, send periodic requests to prevent cache expiration during low-traffic periods:

```python
import asyncio

async def cache_keepalive(
    client: anthropic.AsyncAnthropic,
    system_prompt: str,
    interval_seconds: int = 240,  # 4 min < 5 min TTL
):
    """Keep the prefix cache alive during low-traffic periods."""
    while True:
        await asyncio.sleep(interval_seconds)
        try:
            await warm_cache(client, system_prompt)
        except Exception:
            pass  # Best-effort; cache will be re-warmed on next real request
```

**Strategy 3: Multi-variant warming** -- If your application has multiple system prompt variants (different personas, languages, or feature flags), warm all variants:

```python
async def warm_all_variants(client: anthropic.AsyncAnthropic, variants: dict[str, str]):
    """Warm cache for all system prompt variants in parallel."""
    tasks = [warm_cache(client, prompt) for prompt in variants.values()]
    await asyncio.gather(*tasks)
```

### TTL Management

Each provider handles TTL differently, and the optimal strategy depends on your traffic pattern:

```
Traffic Pattern           Recommended TTL Strategy
──────────────────────    ────────────────────────────────────────
Steady high traffic       No action needed -- cache stays warm from
(>1 req/min)              natural traffic hitting the TTL refresh

Bursty (e.g., business    Warm cache before expected burst. For
hours only)               Anthropic, send keepalive during gaps.

Low, unpredictable        Accept cache misses. The write surcharge
traffic                   on Anthropic may make caching net-negative
                          if hit rate < 25% (see break-even analysis).

Batch processing          Send requests in rapid succession to
                          maximize cache reuse within the batch.
                          Process all items for prompt variant A,
                          then all items for variant B.
```

## Cost and Latency Analysis

### When Caching Saves Money

The economics depend on three variables: (1) the cacheable prefix length, (2) the number of requests that share that prefix within the cache TTL, and (3) the provider's pricing model.

**Anthropic break-even analysis**:

```
Variables:
  P = cacheable prefix length (tokens)
  N = number of requests within TTL
  base_rate = input token price ($/token)

Without caching:
  cost = N * P * base_rate

With caching (first request writes, rest read):
  cost = 1 * P * base_rate * 1.25           # cache write (25% surcharge)
       + (N-1) * P * base_rate * 0.10        # cache reads (90% discount)
       = P * base_rate * (1.25 + 0.10*(N-1))

Break-even when cached cost < uncached cost:
  1.25 + 0.10*(N-1) < N
  1.25 + 0.10*N - 0.10 < N
  1.15 < 0.90*N
  N > 1.28

Caching is profitable after just 2 requests sharing the same prefix.
```

**OpenAI break-even**: Since there is no write surcharge, caching is *always* profitable -- even a single cache hit saves 50%.

**Concrete cost comparison** for a production workload:

```
Scenario: Customer support chatbot
  System prompt: 2,500 tokens (instructions, persona, tool schemas)
  Average conversation: 8 turns
  Daily volume: 5,000 conversations = 40,000 API calls
  Model: Claude Sonnet ($3/MTok input)

Without caching:
  Each call sends full prefix: 2,500 tokens
  Total prefix tokens/day: 40,000 * 2,500 = 100M tokens
  Prefix cost/day: 100M * $3/MTok = $300
  Monthly: $9,000

With Anthropic prompt caching (system prompt cached):
  Cache writes (1 per conversation): 5,000 * 2,500 * $3.75/MTok = $46.88
  Cache reads (7 per conversation): 35,000 * 2,500 * $0.30/MTok = $26.25
  Prefix cost/day: $73.13
  Monthly: $2,194

Savings: $6,806/month (75.6% reduction in prefix costs)

With conversation history caching (system + history cached):
  By turn 8, ~6,000 tokens of history are cached in addition to system prompt.
  Additional savings from history caching: ~$1,500/month
  Total monthly cost: ~$700
  Total savings: ~$8,300/month (92% reduction)
```

### When Caching Does NOT Save Money

Caching is not universally beneficial. It fails to deliver savings in these scenarios:

1. **Short prefixes below minimum threshold**: Anthropic requires 1024+ tokens for caching. A 500-token system prompt cannot be cached -- the `cache_control` annotation is silently ignored.

2. **Highly diverse prefixes with low repetition**: If every request has a unique system prompt (e.g., per-user personalized instructions injected at the start), there are no shared prefixes to cache.

3. **Very low traffic with Anthropic**: If fewer than 2 requests share a prefix within the 5-minute TTL, the 25% write surcharge makes caching net-negative.

4. **Output-dominated costs**: If your workload generates very long outputs (e.g., code generation producing 4000-token files), the output token cost dominates and input caching provides only marginal savings.

```
Cost breakdown by component:

Scenario A: Short answers (chatbot)
  Input: 3000 tokens * $3/MTok  = $0.009
  Output:  200 tokens * $15/MTok = $0.003
  Input is 75% of cost -> CACHING HIGH IMPACT

Scenario B: Long generation (code gen)
  Input: 3000 tokens * $3/MTok   = $0.009
  Output: 4000 tokens * $15/MTok = $0.060
  Input is 13% of cost -> CACHING LOW IMPACT

Scenario C: Reasoning model with thinking tokens
  Input:  3000 tokens * $3/MTok   = $0.009
  Output: 2000 tokens * $15/MTok  = $0.030
  Thinking: 8000 tokens * $15/MTok = $0.120
  Input is 5.7% of cost -> CACHING NEGLIGIBLE IMPACT
```

### Latency Analysis

The latency benefit of prefix caching is proportional to the fraction of prefill computation saved. Prefill time scales roughly linearly with prompt length (for typical prompt sizes below the quadratic attention threshold), so caching $k$ out of $n$ prompt tokens reduces TTFT by approximately $k/n$.

```
TTFT reduction from caching:

Prompt: 4000 tokens total
  System prompt: 2500 tokens (cached)
  User message:  1500 tokens (uncached)

Without caching:
  TTFT ~ prefill(4000 tokens) ~ 400ms  (model-dependent)

With caching:
  TTFT ~ prefill(1500 tokens) ~ 150ms
  TTFT reduction: 62.5%

For multi-turn with 20K accumulated history:
  Without: TTFT ~ prefill(20000) ~ 2000ms
  With:    TTFT ~ prefill(200)   ~   20ms
  TTFT reduction: 99%
```

Provider-reported latency numbers (approximate, as of early 2026):

| Provider | Cache Hit TTFT Reduction | Notes |
|---|---|---|
| Anthropic | ~85% for long cached prefixes | Measured from usage reports |
| OpenAI | ~50-60% | Less reduction because compute savings are partially absorbed |
| Google Gemini | ~70-80% for large cached contexts | Most impactful for very large (50K+) cached contexts |
| vLLM (self-hosted) | ~60-80% | Depends on GPU, model, prefix length |
| SGLang (self-hosted) | ~70-85% | RadixAttention particularly efficient for tree workloads |

## Advanced Patterns

### Batch Processing with Cache Optimization

When processing a batch of items with the same prompt template, order requests to maximize cache reuse. Process all items for one prompt variant before switching to the next:

```python
import asyncio
from anthropic import AsyncAnthropic

client = AsyncAnthropic()

async def process_batch_cached(
    items: list[dict],
    system_prompt: str,
    prompt_template: str,
    concurrency: int = 10,
) -> list[str]:
    """Process a batch with optimal cache utilization."""

    semaphore = asyncio.Semaphore(concurrency)

    async def process_one(item: dict) -> str:
        async with semaphore:
            response = await client.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=1024,
                system=[{
                    "type": "text",
                    "text": system_prompt,
                    "cache_control": {"type": "ephemeral"},
                }],
                messages=[{
                    "role": "user",
                    "content": prompt_template.format(**item),
                }],
            )
            return response.content[0].text

    # Process all items -- they share the system prompt prefix.
    # Concurrent requests to the same model with the same prefix
    # will all benefit from the cached KV state.
    results = await asyncio.gather(*[process_one(item) for item in items])
    return results


# Example: classify 1000 support tickets
results = asyncio.run(process_batch_cached(
    items=tickets,
    system_prompt=classification_system_prompt,  # 2000 tokens, cached
    prompt_template="Classify this support ticket:\n\n{ticket_text}",
    concurrency=20,
))
# First request: cache write (1.25x cost for 2000 tokens)
# Remaining 999 requests: cache read (0.10x cost for 2000 tokens)
# Effective prefix cost: 0.10x for 99.9% of requests
```

### Agent Loop Caching

Agentic systems that run multi-step tool-use loops accumulate context with each step. The conversation history from prior steps is a natural cacheable prefix:

```python
async def agent_loop_with_caching(
    client: anthropic.AsyncAnthropic,
    system_prompt: str,
    tools: list[dict],
    initial_query: str,
    max_steps: int = 10,
) -> str:
    """Run an agent loop with prefix caching at each step."""
    messages = [{"role": "user", "content": initial_query}]

    for step in range(max_steps):
        # Mark the end of accumulated history for caching
        cached_messages = []
        for i, msg in enumerate(messages[:-1]):
            if i == len(messages) - 2:
                # Cache breakpoint at end of history
                cached_messages.append({
                    "role": msg["role"],
                    "content": [{
                        "type": "text",
                        "text": msg["content"] if isinstance(msg["content"], str)
                                else str(msg["content"]),
                        "cache_control": {"type": "ephemeral"},
                    }],
                })
            else:
                cached_messages.append(msg)
        cached_messages.append(messages[-1])  # Latest message, uncached

        response = await client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=4096,
            system=[{
                "type": "text",
                "text": system_prompt,
                "cache_control": {"type": "ephemeral"},
            }],
            tools=tools,
            messages=cached_messages,
        )

        # Check if the model wants to use a tool
        if response.stop_reason == "tool_use":
            tool_block = next(b for b in response.content if b.type == "tool_use")
            tool_result = await execute_tool(tool_block.name, tool_block.input)

            messages.append({"role": "assistant", "content": response.content})
            messages.append({
                "role": "user",
                "content": [{
                    "type": "tool_result",
                    "tool_use_id": tool_block.id,
                    "content": str(tool_result),
                }],
            })
            # Next iteration: all prior messages are cached.
            # Step N only prefills the latest tool result.
        else:
            # Final answer
            return response.content[0].text

    return "Max steps reached"
```

In a 10-step agent loop, step 10 might have 15,000 tokens of accumulated history. Without caching, every step reprocesses the entire history. With caching, step 10 only processes the ~500 tokens from the latest tool result -- a 97% reduction in prefill work.

### Prompt Versioning and Cache Invalidation

When you update your system prompt, all cached prefixes are invalidated because the token sequence changes. This is desirable (you want the model to use the new prompt) but requires awareness:

```python
# Prompt versioning for controlled cache invalidation

class VersionedPromptManager:
    """Manage prompt versions with cache-aware deployment."""

    def __init__(self):
        self._versions: dict[str, str] = {}
        self._active_version: str | None = None

    def register(self, version: str, prompt: str):
        self._versions[version] = prompt

    def activate(self, version: str):
        """Activate a prompt version. Invalidates cache for all prior versions."""
        if version not in self._versions:
            raise ValueError(f"Unknown version: {version}")
        old = self._active_version
        self._active_version = version
        # Log the transition for cache monitoring
        print(f"Prompt version {old} -> {version}. "
              f"Cache will be cold for ~{self.estimated_warm_time()}s.")

    @property
    def active_prompt(self) -> str:
        return self._versions[self._active_version]

    def estimated_warm_time(self) -> int:
        """Estimate time to warm cache based on traffic rate."""
        # With Anthropic's 5-min TTL, cache is warm after the first request
        # The question is how long until the first request arrives
        return 1  # At production traffic, essentially immediate
```

### A/B Testing with Separate Cache Lanes

When A/B testing system prompts, each variant maintains its own cache lane because the prefix tokens differ:

```
Variant A system prompt: "You are a concise assistant..."
Variant B system prompt: "You are a thorough assistant..."

Both variants cache independently. Cache efficiency per variant
depends on traffic split:

50/50 split:  Each variant gets 50% of traffic -> ~50% of max cache efficiency
90/10 split:  Variant A near-optimal, Variant B may have low hit rate
              (fewer requests to keep cache warm within TTL)

Recommendation: For Anthropic's 5-min TTL with a 10% traffic variant,
ensure at least 1 request/5min to that variant (~12 req/hour minimum)
to maintain cache warmth.
```

## Debugging Cache Performance

### Diagnosing Low Cache Hit Rates

When cache hit rates are lower than expected, the cause is almost always one of these:

**1. Token-level prefix mismatch**: Even a single different token at position $k$ invalidates the cache for all positions $\geq k$. Common culprits:

```python
# BUG: Timestamp in system prompt changes every request
system_prompt = f"You are an assistant. Current time: {datetime.now()}"
# Every request has a different prefix -> 0% cache hit rate

# FIX: Move dynamic content to the user message
system_prompt = "You are an assistant."  # Static -> cacheable
user_message = f"Current time: {datetime.now()}\n\nUser question: {query}"
```

**2. Below minimum token threshold**: Content marked for caching but shorter than the provider's minimum (1024 tokens for Anthropic Sonnet/Opus) is silently not cached.

```python
# BUG: System prompt is only 400 tokens
system = [{
    "type": "text",
    "text": short_system_prompt,  # 400 tokens < 1024 minimum
    "cache_control": {"type": "ephemeral"},  # Silently ignored!
}]

# FIX: Combine with tool definitions or few-shot examples to exceed minimum
system = [{
    "type": "text",
    "text": short_system_prompt + "\n\n" + tool_definitions + "\n\n" + examples,
    # Combined: 1800 tokens > 1024 minimum -> cached
    "cache_control": {"type": "ephemeral"},
}]
```

**3. Cache TTL expiration**: Low-traffic endpoints may see the cache expire between requests.

```python
# Diagnostic: Log timestamps between requests to detect TTL gaps
import time

last_request_time = None

def check_cache_ttl_risk(provider_ttl_seconds: int = 300):
    global last_request_time
    now = time.time()
    if last_request_time:
        gap = now - last_request_time
        if gap > provider_ttl_seconds:
            print(f"WARNING: {gap:.0f}s since last request "
                  f"(TTL: {provider_ttl_seconds}s). Cache likely expired.")
    last_request_time = now
```

**4. Message structure differences**: Different `role` labels, content types, or message ordering can break prefix matching even if the text content is identical.

### Observability Setup

```python
# Structured logging for cache monitoring
import logging
import json

logger = logging.getLogger("prompt_cache")

def log_cache_usage(response, request_id: str, endpoint: str):
    """Log structured cache metrics for monitoring dashboards."""
    usage = response.usage
    cache_read = getattr(usage, "cache_read_input_tokens", 0) or 0
    cache_write = getattr(usage, "cache_creation_input_tokens", 0) or 0
    total_input = usage.input_tokens

    logger.info(json.dumps({
        "event": "llm_request",
        "request_id": request_id,
        "endpoint": endpoint,
        "model": response.model,
        "input_tokens": total_input,
        "output_tokens": usage.output_tokens,
        "cache_read_tokens": cache_read,
        "cache_write_tokens": cache_write,
        "cache_hit_rate": cache_read / max(total_input, 1),
        "is_cache_hit": cache_read > 0,
    }))

# Dashboard queries (pseudo-SQL for your observability platform):
#
# Cache hit rate over time:
#   SELECT time_bucket('5m', timestamp),
#          AVG(cache_hit_rate) as hit_rate,
#          COUNT(*) as requests
#   FROM llm_requests
#   GROUP BY 1
#
# Cost savings estimation:
#   SELECT SUM(cache_read_tokens * 0.9 * base_rate) as savings
#   FROM llm_requests
#   WHERE timestamp > NOW() - INTERVAL '1 day'
```

For comprehensive observability patterns, see [Observability](/observability).

## Caching and Reasoning Models

Extended thinking / reasoning models (Claude with extended thinking, OpenAI o1/o3, DeepSeek R1) introduce an important nuance for caching. The thinking tokens generated during reasoning are part of the model's output, not the input, so they are not directly cacheable via prefix caching. However, the input prefix (system prompt, conversation history) is still cached normally.

The economic impact of caching is *reduced* for reasoning models because output tokens (including thinking tokens) dominate the cost:

```
Standard model request:
  Input: 3000 tokens at $3/MTok    = $0.009
  Output: 500 tokens at $15/MTok   = $0.0075
  Total: $0.0165
  Caching 2500 input tokens saves: ~$0.0068 (41% of total)

Reasoning model request:
  Input: 3000 tokens at $3/MTok       = $0.009
  Thinking: 10000 tokens at $15/MTok  = $0.150
  Output: 500 tokens at $15/MTok      = $0.0075
  Total: $0.1665
  Caching 2500 input tokens saves: ~$0.0068 (4% of total)
```

Caching is still worthwhile for reasoning models (free money is free money), but the primary cost lever shifts to controlling thinking budget. See [Cost Optimization](/cost-optimization) for reasoning model cost management strategies.

## Summary of Best Practices

```
Prompt Caching Checklist:

[1] STRUCTURE: Static content first, dynamic content last
    - System prompt -> tool defs -> few-shot examples -> history -> user query

[2] ANNOTATE: Use cache_control breakpoints (Anthropic) or ensure
    prefix > 1024 tokens (OpenAI automatic caching)

[3] COMBINE: Merge short static blocks to exceed minimum token thresholds

[4] MEASURE: Log cache_read_input_tokens / cache_creation_input_tokens
    and compute hit rates per endpoint

[5] WARM: Pre-populate cache on deployment or after prompt updates

[6] KEEP ALIVE: For low-traffic endpoints with TTL-based caching,
    send periodic keepalive requests

[7] BATCH: Process same-prefix items together; do not interleave
    different prompt variants

[8] VERSION: Track prompt versions so cache invalidations are intentional
    and observable

[9] AVOID: Do not embed timestamps, request IDs, or per-request metadata
    in the cacheable prefix

[10] MONITOR: Alert on cache hit rate drops -- they indicate unintended
     prefix changes or traffic pattern shifts
```

### Decision Framework

```
Should you invest in prompt caching optimization?

                        ┌──────────────────────┐
                        │ Is your prefix > 1024 │
                        │ tokens?               │
                        └──────────┬───────────┘
                              No   │   Yes
                        ┌──────────┘   └───────────┐
                        │                          │
                   Can you combine         ┌───────┴───────┐
                   blocks to exceed        │ > 10 req/min  │
                   1024?                   │ sharing prefix?│
                        │                  └───┬───────┬───┘
                   No   │  Yes            No   │       │ Yes
                   │    │                      │       │
              Caching   └──→ Proceed      Low-traffic  HIGH IMPACT
              not                         optimization  -> Implement
              applicable                  (keepalive    immediately
                                          may help)
```

Prompt caching is one of the few optimizations in the LLM ecosystem that is almost universally beneficial, requires minimal code changes, and compounds in value as your traffic grows. Combined with cache-aware prompt design principles from [Context Engineering](/context-engineering) and the broader cost framework in [Cost Optimization](/cost-optimization), it forms the foundation of efficient LLM application architecture.

---

*Further reading: [Inference Optimization](/inference-optimization) covers the serving-infrastructure perspective on KV cache management (PagedAttention, quantized KV cache, disaggregated prefill/decode). [LLM Serving](/llm-serving) covers the full serving stack including continuous batching and streaming. [System Prompts](/system-prompts) covers techniques for writing effective system prompts, which are the primary candidate for prefix caching.*
