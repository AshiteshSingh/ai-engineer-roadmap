# Cost Optimization: Token Economics, Caching & Model Selection

The economics of large language model usage have become a strategic concern as organizations move from prototyping to production. A single GPT-4-class API call costs roughly 1000x more than a traditional database query, and unoptimized LLM pipelines can generate monthly bills that dwarf the rest of an application's infrastructure costs combined. This article provides a systematic framework for understanding, measuring, and optimizing LLM costs across the full spectrum of strategies -- from prompt engineering and caching through intelligent model routing to the build-versus-buy decision.

## TL;DR

- Model routing is the single highest-impact optimization: 70-80% of production requests are "easy" and can be handled by a model 10-50x cheaper than your frontier default.
- Provider-side prompt caching (Anthropic, OpenAI, Google) delivers 50-90% discounts on cached token prefixes with zero or minimal code changes.
- Prompt compression tools like LLMLingua can reduce RAG context tokens by 2-5x with under 2% quality loss.
- Reasoning models can inflate output costs by 3-20x via thinking tokens -- use them only for tasks that genuinely benefit, and always cap the thinking budget.
- Self-hosting rarely breaks even below ~$10K/month in API spend; a hybrid baseline-load + burst-to-API strategy offers the best economics at medium scale.

## Token Pricing Landscape

### Understanding the Pricing Model

LLM API pricing is denominated in tokens, typically quoted per million tokens (MTok). Most providers charge differently for input tokens (prompt) and output tokens (completion), with output tokens costing 2-5x more because they require sequential autoregressive generation.

As of early 2026, the pricing landscape spans roughly three orders of magnitude:

| Model Tier | Example Models | Input ($/MTok) | Output ($/MTok) |
|---|---|---|---|
| Frontier | Claude Opus, GPT-4.5 | $10-15 | $30-75 |
| High capability | Claude Sonnet, GPT-4o | $3-5 | $10-15 |
| Mid-tier | Claude Haiku, GPT-4o-mini | $0.25-0.80 | $1.00-4.00 |
| Lightweight | Gemini Flash, Llama 3.1 8B (hosted) | $0.03-0.10 | $0.10-0.40 |
| Self-hosted open | Llama, Mistral, Qwen on own GPUs | ~$0.05-0.30 | ~$0.15-0.80 |

The cost difference between a frontier model and a lightweight model can be 100-500x. This spread is the foundation of every cost optimization strategy: use the cheapest model that delivers acceptable quality for each task.

> **Tip:** The cost difference between frontier and lightweight models spans 100-500x. Every optimization strategy in this article is essentially a way to spend more of your token budget on the cheap end of that range.

### Hidden Costs

Token pricing alone doesn't capture the full picture:

- **System prompts**: A 2000-token system prompt repeated on every request adds up. At $10/MTok input, that is $0.02 per request -- which at 1M requests/day is $20,000/month just for system prompts.
- **Context window loading**: RAG pipelines that stuff 10K tokens of retrieved context per request can dominate costs even when the user's query is short.
- **Retry costs**: Failed requests that are retried still incur charges for the initial attempt.
- **Structured output overhead**: JSON mode and function calling add schema tokens to both input and output.

## Prompt Caching

### Exact-Match Prompt Caching

The simplest caching strategy: if the exact same prompt has been seen before, return the cached response. This works well for applications with high prompt repetition, such as classification tasks with a fixed set of inputs or FAQ systems.

```python
import hashlib
import redis

class ExactPromptCache:
    def __init__(self, redis_client: redis.Redis, ttl_seconds: int = 3600):
        self.redis = redis_client
        self.ttl = ttl_seconds

    def _cache_key(self, messages: list[dict], model: str, params: dict) -> str:
        # Include model and generation params in cache key
        # to avoid serving wrong results
        payload = json.dumps({
            "messages": messages,
            "model": model,
            "temperature": params.get("temperature", 1.0),
            "max_tokens": params.get("max_tokens"),
        }, sort_keys=True)
        return f"llm:exact:{hashlib.sha256(payload.encode()).hexdigest()}"

    async def get_or_generate(self, messages, model, params, generate_fn):
        # Only cache deterministic requests (temperature=0)
        if params.get("temperature", 1.0) != 0:
            return await generate_fn(messages, model, params)

        key = self._cache_key(messages, model, params)
        cached = self.redis.get(key)
        if cached:
            return json.loads(cached)

        result = await generate_fn(messages, model, params)
        self.redis.setex(key, self.ttl, json.dumps(result))
        return result
```

### Provider-Side Prompt Caching

All three major providers -- Anthropic, OpenAI, and Google -- now offer server-side prompt caching where repeated prompt prefixes are cached on the provider's infrastructure, reducing both cost and latency. The mechanics differ across providers, but the core idea is the same: if the beginning of your prompt matches a recently seen prefix, the provider reuses its internal KV-cache rather than recomputing attention from scratch.

**Anthropic** offers explicit prompt caching with `cache_control` markers. Cached input tokens receive a 90% discount, while the initial cache write incurs a 25% surcharge. The cache has a 5-minute TTL that resets on each hit.

```python
# Anthropic prompt caching -- mark the system prompt for caching
response = client.messages.create(
    model="claude-sonnet-4-20250514",
    max_tokens=1024,
    system=[
        {
            "type": "text",
            "text": long_system_prompt,  # 2000+ tokens
            "cache_control": {"type": "ephemeral"}  # Cache this block
        }
    ],
    messages=[{"role": "user", "content": user_query}]
)
# First request: pays full input + cache write fee (1.25x)
# Subsequent requests (within TTL): pays ~10% for cached prefix
```

**OpenAI** implements automatic prompt caching for prompts longer than 1024 tokens. There is no write fee -- cached tokens are simply billed at 50% of the standard input rate. Caching happens automatically with no code changes required; the API response includes a `cached_tokens` field so you can verify it is working.

**Google (Gemini)** provides context caching through an explicit caching API where you create a named cache object with a configurable TTL. Cached input tokens are billed at 75% off the standard rate, but there is a per-hour storage cost for maintaining the cache.

**Cost savings calculation**: Consider an application making 10,000 requests/day with a 3000-token system prompt on Claude Sonnet ($3/MTok input):

```text
Without caching:
  3,000 tokens * 10,000 requests = 30M input tokens/day
  30M * $3/MTok = $90/day = $2,700/month

With Anthropic prompt caching (95% hit rate):
  First/miss requests: 500 * 3,000 = 1.5M tokens at $3.75/MTok = $5.63
  Cache hits: 9,500 * 3,000 = 28.5M tokens at $0.30/MTok = $8.55
  Daily cost: ~$14.18/day = ~$425/month (84% savings)
```

This is especially powerful for applications with long, stable system prompts or RAG pipelines where the retrieved context is the same across multiple user queries (e.g., when multiple users ask about the same document). For AI gateway architectures that centralize LLM traffic (see [AI Gateways: Rate Limiting, Fallbacks & Multi-Provider Routing](/ai-gateway)), provider-side caching is even more effective because the gateway naturally aggregates requests that share prompt prefixes.

### Semantic Caching

Semantic caching extends exact-match caching to handle semantically similar queries. If a user asks "What is the capital of France?" and another asks "capital of france?", a semantic cache recognizes these as equivalent.

```python
from openai import OpenAI
import numpy as np

class SemanticCache:
    def __init__(self, embedding_client, vector_store, similarity_threshold=0.95):
        self.embedder = embedding_client
        self.store = vector_store
        self.threshold = similarity_threshold

    async def get_or_generate(self, query: str, generate_fn):
        # Embed the query
        embedding = await self.embedder.embed(query)

        # Search for similar cached queries
        results = await self.store.search(
            vector=embedding,
            top_k=1,
            threshold=self.threshold
        )

        if results and results[0].score >= self.threshold:
            return results[0].metadata["response"]

        # Cache miss: generate and store
        response = await generate_fn(query)
        await self.store.insert(
            vector=embedding,
            metadata={"query": query, "response": response}
        )
        return response
```

The risk with semantic caching is returning incorrect responses for queries that are similar but meaningfully different ("How do I delete my account?" vs. "How do I delete a file from my account?"). The similarity threshold must be set conservatively, and certain query patterns (e.g., those containing negation) may need special handling.

## Model Routing

### The Model Router Pattern

Model routing is the single most impactful cost optimization technique. The insight: 70-80% of production LLM requests are "easy" -- classification, extraction, simple Q&A, formatting -- and can be handled by a model that costs 10-50x less than the frontier model.

```python
class ModelRouter:
    def __init__(self):
        self.routes = [
            # Pattern-based routing
            Route(
                condition=lambda req: req.task_type == "classification",
                model="claude-haiku",
                reason="Classification tasks don't need frontier models"
            ),
            Route(
                condition=lambda req: req.max_tokens and req.max_tokens < 100,
                model="gpt-4o-mini",
                reason="Short outputs suggest simple tasks"
            ),
            Route(
                condition=lambda req: req.task_type == "code_generation",
                model="claude-sonnet",
                reason="Code generation benefits from stronger models"
            ),
            # Default route
            Route(
                condition=lambda req: True,
                model="claude-sonnet",
                reason="Default to mid-tier for unknown tasks"
            ),
        ]

    def select_model(self, request: LLMRequest) -> str:
        for route in self.routes:
            if route.condition(request):
                return route.model
        return self.routes[-1].model
```

### LLM-as-Judge Routing

A more sophisticated approach uses a small, fast LLM to assess query difficulty and route accordingly. The routing model costs a fraction of the frontier model, so even if it is invoked on every request, the net savings are substantial:

```python
class LLMRouter:
    def __init__(self):
        self.router_model = "gpt-4o-mini"  # Fast, cheap router
        self.router_prompt = """Classify the complexity of this user request.

        SIMPLE: factual questions, formatting, classification, extraction
        MEDIUM: multi-step reasoning, summarization, moderate code generation
        COMPLEX: novel analysis, long-form writing, complex code, math proofs

        Respond with exactly one word: SIMPLE, MEDIUM, or COMPLEX."""

    async def route(self, user_message: str) -> str:
        complexity = await self.fast_llm_call(
            self.router_model,
            self.router_prompt,
            user_message
        )

        model_map = {
            "SIMPLE": "claude-haiku",      # ~$0.25/MTok input
            "MEDIUM": "claude-sonnet",     # ~$3/MTok input
            "COMPLEX": "claude-opus",      # ~$15/MTok input
        }
        return model_map.get(complexity.strip(), "claude-sonnet")
```

Research from Martian, Unify, and others suggests that well-implemented model routing can reduce costs by 40-60% with less than 2% quality degradation compared to always using the frontier model.

### Cascading: Try Cheap First

An alternative to upfront routing is cascading: try the cheap model first, and only escalate to the expensive model if the cheap model's response fails a quality check.

```python
class CascadingRouter:
    async def generate(self, request: LLMRequest) -> LLMResponse:
        # Try the cheap model first
        cheap_response = await self.call_model("claude-haiku", request)

        # Quality check (can be rule-based or LLM-based)
        if self.passes_quality_check(request, cheap_response):
            return cheap_response

        # Escalate to the expensive model
        expensive_response = await self.call_model("claude-sonnet", request)
        return expensive_response

    def passes_quality_check(self, request, response) -> bool:
        # Rule-based checks
        if response.finish_reason == "length":
            return False  # Truncated, likely needs more capable model
        if response.confidence_score and response.confidence_score < 0.7:
            return False
        if len(response.content) < 50 and request.expected_length == "long":
            return False
        return True
```

The cascading approach has the advantage that it never degrades quality below the expensive model's level, but the disadvantage that ~20-30% of requests incur the cost of both models.

## Batch API Usage

Most providers offer batch APIs that process requests asynchronously at significant discounts (typically 50% off). OpenAI's Batch API and Anthropic's Message Batches API are the primary examples.

```python
# Anthropic Message Batches API
import anthropic

client = anthropic.Anthropic()

# Submit a batch of requests
batch = client.messages.batches.create(
    requests=[
        {
            "custom_id": f"request-{i}",
            "params": {
                "model": "claude-sonnet-4-20250514",
                "max_tokens": 1024,
                "messages": [{"role": "user", "content": prompt}]
            }
        }
        for i, prompt in enumerate(prompts)
    ]
)

# Poll for completion (batch SLA is typically 24 hours)
while batch.processing_status != "ended":
    await asyncio.sleep(60)
    batch = client.messages.batches.retrieve(batch.id)

# Retrieve results
results = client.messages.batches.results(batch.id)
```

Batch APIs are ideal for:
- Evaluation pipelines (running benchmarks across hundreds of prompts)
- Data processing (summarizing, classifying, or extracting from large document sets)
- Synthetic data generation
- Nightly analysis or reporting

They are not suitable for real-time user-facing applications.

## Token Budgeting and Monitoring

### Setting Token Budgets

A token budget defines the maximum tokens a project, team, or user can consume per time period. This prevents runaway costs from bugs, prompt injection attacks, or unexpected usage spikes:

```python
class TokenBudgetManager:
    def __init__(self, redis_client):
        self.redis = redis_client

    async def check_and_deduct(
        self,
        org_id: str,
        estimated_tokens: int,
        budget_window: str = "monthly"
    ) -> bool:
        key = f"budget:{org_id}:{budget_window}:{self._current_period()}"
        current_usage = int(self.redis.get(key) or 0)
        budget_limit = await self.get_budget_limit(org_id)

        if current_usage + estimated_tokens > budget_limit:
            raise BudgetExceededError(
                f"Organization {org_id} has used {current_usage} tokens "
                f"of {budget_limit} budget for {budget_window}"
            )

        # Atomically increment
        pipe = self.redis.pipeline()
        pipe.incrby(key, estimated_tokens)
        pipe.expire(key, self._ttl_for_window(budget_window))
        pipe.execute()
        return True
```

### Cost Monitoring Dashboard

Effective cost monitoring requires tracking multiple dimensions:

```python
@dataclass
class LLMUsageEvent:
    timestamp: datetime
    model: str
    provider: str
    org_id: str
    user_id: str
    feature: str           # Which product feature triggered this call
    prompt_tokens: int
    completion_tokens: int
    cached_tokens: int     # Tokens served from cache
    cost_usd: float        # Computed cost
    latency_ms: float
    was_routed: bool       # Whether model routing was applied
    original_model: str    # Model before routing (if different)

# Aggregate queries for dashboards
# - Cost by model, by feature, by user over time
# - Cache hit rate and savings
# - Model routing savings (cost with routing vs. without)
# - Token efficiency (useful output tokens / total tokens)
```

### Prompt Optimization for Cost

Small changes to prompts can significantly impact token costs:

1. **Minimize system prompt length**: Every token in the system prompt is repeated on every request. Reducing a system prompt from 2000 to 1000 tokens saves 50% on system prompt costs.

2. **Use structured output**: Asking for JSON output instead of prose typically produces more concise responses with less wasted tokens.

3. **Set appropriate max_tokens**: Always set `max_tokens` to a reasonable value. A request with `max_tokens=4096` that only needs 100 tokens wastes scheduling resources and can lead to higher latency.

4. **Avoid chain-of-thought when unnecessary**: CoT prompting (see [Few-Shot & Chain-of-Thought Prompting](/few-shot-chain-of-thought)) can increase output tokens by 3-10x. Use it for complex reasoning tasks but skip it for simple extraction or classification.

```python
# Before: verbose prompt (high token count)
prompt = """You are an expert sentiment analyst. Please carefully analyze
the following customer review and determine whether the sentiment expressed
is positive, negative, or neutral. Consider the overall tone, specific
word choices, and the customer's apparent satisfaction level. Provide your
analysis in a detailed paragraph followed by your final classification."""

# After: concise prompt (low token count)
prompt = """Classify sentiment as POSITIVE, NEGATIVE, or NEUTRAL.
Reply with one word only."""
```

## Self-Hosting vs. API: The Decision Framework

### When to Self-Host

Self-hosting makes economic sense when:

1. **Volume exceeds ~$5,000-10,000/month in API costs** for a single model tier, and the workload is consistent (not bursty).

2. **Data privacy requirements** prevent sending data to third-party APIs.

3. **Latency requirements** demand co-located inference (e.g., within your VPC).

4. **Customization needs** require fine-tuned models, custom decoding strategies, or non-standard APIs.

### Cost Comparison Example

Consider serving Llama 3.1 70B for a workload of 100M tokens/day:

```text
API Route (e.g., Together AI, Fireworks):
- ~$0.90/MTok output
- 100M tokens/day * $0.90/MTok = $90/day = $2,700/month

Self-Hosted (4x H100 on AWS):
- 4x p5.xlarge = ~$40/hour = $960/day = $28,800/month (on-demand)
- With reserved instances (1-year): ~$18,000/month
- With spot instances: ~$10,000/month
- Throughput: ~2000 tok/s = 172M tokens/day

Break-even analysis:
- API at 100M tok/day: $2,700/month
- Self-hosted on-demand: $28,800/month (10.7x more expensive!)
- Self-hosted needs ~1B+ tokens/day to break even with on-demand
- Self-hosted with spot needs ~370M+ tokens/day to break even
```

The break-even point is highly dependent on utilization. Self-hosted GPUs that sit idle 50% of the time effectively double in cost. API pricing bakes in the provider's utilization optimization.

> **Note:** Self-hosting looks attractive on paper but the numbers rarely hold up below ~$10K/month in consistent API spend. Factor in GPU idle time, engineering overhead, and the operational burden of managing inference infrastructure before committing.

### Hybrid Approach

Many organizations use a hybrid strategy:

- **Baseline load on self-hosted**: Run enough self-hosted capacity for the P50 traffic level
- **Burst to APIs**: Route overflow traffic to API providers during peaks
- **Specialized models self-hosted**: Fine-tuned or domain-specific models that aren't available via APIs
- **General models via API**: Use API providers for frontier models that are impractical to self-host

## Prompt Compression

### The Token Bloat Problem

Production LLM pipelines often send far more context than the model actually needs. RAG systems retrieve entire document chunks when only a few sentences are relevant. Conversation histories accumulate redundant turns. System prompts contain verbose instructions that could be stated concisely. Prompt compression techniques address this by systematically reducing input token counts without sacrificing the information the model needs to generate correct outputs.

> **Note:** Prompt compression and prompt caching compose well together -- compress the variable portion of your prompt to reduce costs, while caching the stable prefix for even greater savings on repeated requests.

### LLMLingua and Selective Context Compression

LLMLingua (and its successor LLMLingua-2) uses a small language model to identify and remove tokens that contribute minimally to the prompt's meaning. The approach computes per-token perplexity using a compact model like GPT-2 or LLaMA-7B and drops tokens with the lowest information content -- function words, filler phrases, and redundant context that a capable model can infer from surrounding tokens.

```python
from llmlingua import PromptCompressor

compressor = PromptCompressor(
    model_name="microsoft/llmlingua-2-bert-base-multilingual-cased-meetingbank",
    device_map="cpu"
)

# Compress a long RAG context before sending to the LLM
compressed = compressor.compress_prompt(
    context=[retrieved_doc_1, retrieved_doc_2, retrieved_doc_3],
    instruction="Answer the user's question based on the context.",
    question=user_query,
    rate=0.5,  # Target 50% compression
    condition_in_question="after_condition",
    reorder_context="sort"
)

# compressed["compressed_prompt"] contains the shortened prompt
# compressed["origin_tokens"] vs compressed["compressed_tokens"] shows savings
response = llm_client.generate(compressed["compressed_prompt"])
```

In practice, LLMLingua-2 achieves 2-5x compression ratios on RAG contexts with less than 2% degradation on downstream task accuracy. At $3/MTok, compressing a 4000-token context to 1500 tokens saves $0.0075 per request -- meaningful at scale.

### Practical Compression Strategies

Beyond algorithmic compression, several manual techniques reduce token counts effectively:

1. **Selective context retrieval**: Instead of sending full document chunks, extract only the sentences most relevant to the query. A lightweight re-ranker (e.g., a cross-encoder) can score individual sentences and filter out low-relevance ones before they reach the LLM.

2. **Conversation summarization**: For multi-turn conversations, periodically summarize older turns into a compact summary rather than carrying the full history. A 20-turn conversation might be 4000 tokens; a summary of the first 15 turns plus the last 5 verbatim might be 1200 tokens.

3. **Schema pruning for function calling**: If your function schema includes 30 tools but the current context only requires 5, dynamically filter the tool definitions sent in the prompt. Tool schemas can easily consume 2000+ tokens.

4. **Abbreviation and symbol substitution**: In system prompts (which are under your control), use concise notation. "Respond with JSON containing keys: name (string), score (0-100), tags (string array)" is far shorter than a verbose English description of the same schema.

These techniques compose well with each other and with prompt caching -- compressing the variable portion of a prompt while caching the static prefix yields multiplicative savings.

## Reasoning Model Economics

### The Thinking Token Tax

Reasoning models -- OpenAI's o1 and o3 series, Anthropic's extended thinking mode, DeepSeek-R1, and Google's Gemini 2.0 Flash Thinking -- introduce a new cost dimension: thinking tokens. These models generate internal chain-of-thought reasoning before producing their final answer, and this internal reasoning consumes output tokens that you pay for.

The cost implications are significant. A standard Claude Sonnet call answering a straightforward question might use 200 output tokens. The same question routed through extended thinking might use 2000+ thinking tokens plus 200 answer tokens -- a 10x increase in output token costs. For complex math or coding tasks, thinking token counts of 5,000-20,000 are common.

| Model | Input ($/MTok) | Output ($/MTok) | Thinking Tokens | Typical Thinking Overhead |
|---|---|---|---|---|
| o1 | $15 | $60 | Billed as output | 3-20x output increase |
| o3-mini | $1.10 | $4.40 | Billed as output | 2-10x output increase |
| DeepSeek-R1 | $0.55 | $2.19 | Billed as output | 3-15x output increase |
| Claude (extended thinking) | $3 | $15 | Billed as output | 2-10x output increase |

### When Reasoning Models Pay For Themselves

Despite higher per-request costs, reasoning models can be more cost-effective for tasks where standard models require multiple attempts, extensive prompt engineering, or human review:

> **Tip:** Apply the same model routing logic to reasoning mode itself: classify task complexity first using a cheap model, then decide whether extended thinking is warranted. Route only the hardest tier of tasks to reasoning mode.

- **Complex code generation**: If a standard model needs 3 attempts (with human review between each) to produce correct code, while a reasoning model gets it right on the first try, the reasoning model is cheaper in total cost (including engineer time).
- **Mathematical and logical tasks**: Problems requiring multi-step deduction see dramatic accuracy improvements with reasoning models, often eliminating the need for expensive verification pipelines.
- **Agentic workflows**: When an agent makes sequential tool calls and an early mistake cascades into wasted downstream calls, a reasoning model's higher accuracy on the planning step can reduce total pipeline cost.

For simple tasks -- classification, extraction, formatting -- reasoning models are pure overhead. The model routing pattern described earlier is essential here: route only tasks that benefit from extended reasoning to reasoning models.

### Budget Management for Thinking Tokens

Most reasoning model APIs allow you to cap thinking tokens. Use this aggressively:

```python
# Anthropic extended thinking with budget cap
response = client.messages.create(
    model="claude-sonnet-4-20250514",
    max_tokens=16000,
    thinking={
        "type": "enabled",
        "budget_tokens": 4000  # Cap thinking at 4000 tokens
    },
    messages=[{"role": "user", "content": complex_question}]
)

# Monitor thinking token usage for cost tracking
thinking_tokens = sum(
    block.thinking for block in response.content
    if block.type == "thinking"
)
```

Set thinking budgets based on task complexity. A task classifier (which itself uses a cheap model) can assign budget tiers: 1024 tokens for moderate reasoning, 4096 for complex analysis, 10000+ only for the hardest problems. This mirrors the model routing pattern but applied within a single model's reasoning capacity.

## Multi-Modal Cost Optimization

### The Cost of Vision, Audio, and Video

Multi-modal inputs -- images, audio, and video -- are tokenized differently from text, and their cost profiles vary substantially. Understanding these costs is critical as more applications incorporate multi-modal capabilities.

**Image tokens**: Both OpenAI and Anthropic tokenize images based on resolution. A typical 1024x1024 image consumes roughly 765-1000 tokens. High-resolution images (4K) can consume 4000+ tokens per image. At frontier model pricing ($10-15/MTok input), a single high-res image costs $0.04-0.06 to process -- equivalent to roughly 4000-6000 words of text.

**Audio tokens**: OpenAI's audio models and Gemini's native audio processing tokenize audio at roughly 32-40 tokens per second. A 60-second audio clip becomes ~2000 tokens. For transcription-only tasks, a dedicated Whisper API call ($0.006/minute) is far cheaper than sending audio to a multi-modal model.

**Video tokens**: Google's Gemini models process video at approximately 258 tokens per second. A 1-minute video clip becomes ~15,000 tokens -- equivalent in cost to a substantial text document.

### Strategies for Reducing Multi-Modal Costs

1. **Resize images before sending**: If the task does not require high resolution (e.g., classifying the general content of an image), downscale to 512x512 or lower. This can reduce image token counts by 4-8x.

```python
from PIL import Image
import io, base64

def optimize_image_for_llm(image_path: str, max_size: int = 768) -> str:
    """Resize image to reduce token cost while preserving enough detail."""
    img = Image.open(image_path)
    img.thumbnail((max_size, max_size), Image.LANCZOS)

    # Convert to JPEG for smaller payload (vs PNG)
    buffer = io.BytesIO()
    img.save(buffer, format="JPEG", quality=80)
    return base64.b64encode(buffer.getvalue()).decode()
```

2. **Extract text from images before sending**: If the image contains text (screenshots, documents, receipts), run OCR first and send the extracted text instead. OCR is essentially free compared to vision model inference.

3. **Use frame sampling for video**: Instead of sending every frame, sample key frames at intervals (e.g., 1 frame per second or on scene changes) and send those as individual images.

4. **Route multi-modal tasks to specialized models**: Use a lightweight vision model for simple image tasks (classification, OCR, basic description) and reserve frontier multi-modal models for complex visual reasoning. Gemini Flash with vision is 50-100x cheaper than GPT-4o for image understanding tasks that do not require frontier-level reasoning.

## Fine-Tuning vs. Prompting: Cost Comparison

### The Economic Tradeoff

Few-shot prompting and fine-tuning represent two ends of a cost spectrum. Few-shot prompting (see [Few-Shot & Chain-of-Thought Prompting](/few-shot-chain-of-thought)) has zero upfront cost but inflates every request by embedding examples in the prompt. Fine-tuning (see [Fine-tuning Fundamentals](/fine-tuning-fundamentals)) requires upfront investment in data curation and training compute, but the resulting model requires shorter prompts and often uses a cheaper model tier to achieve the same quality.

### Break-Even Analysis Framework

The decision to fine-tune should be driven by a concrete cost comparison:

```text
Fine-tuning total cost = Data preparation + Training compute + Ongoing inference
Prompting total cost   = Per-request cost * Request volume * Time period

Variables:
- N = number of few-shot examples in prompt (typically 3-8)
- T_example = average tokens per example (~150-300)
- T_system = system prompt tokens
- R = requests per month
- C_input = input cost per MTok
- C_ft = fine-tuning training cost (one-time)
- C_ft_input = fine-tuned model input cost per MTok
```

**Worked example**: A sentiment classification task using GPT-4o-mini.

```text
Few-shot approach (5 examples, ~250 tokens each):
  Extra prompt tokens per request: 5 * 250 = 1,250 tokens
  At $0.15/MTok input: $0.0001875 per request
  At 500,000 requests/month: $93.75/month in example tokens alone

Fine-tuned approach:
  Training cost: ~$5-25 (one-time, for a small dataset)
  Inference savings: No few-shot examples needed, so 1,250 fewer
    input tokens per request
  Monthly savings: $93.75/month

  Break-even: Less than 1 month
```

For high-volume applications (500K+ requests/month) with repetitive task patterns, fine-tuning almost always pays for itself within weeks.

The savings compound further because fine-tuned models on cheaper architectures often match the quality of larger prompted models, enabling a drop from a mid-tier model to a fine-tuned lightweight model. For a detailed walkthrough of fine-tuning pipelines and when to apply techniques like [RLHF and preference optimization](/rlhf-preference), the alignment and training articles in this series cover the full process.

### When Prompting Wins

Fine-tuning is not always the right answer:

- **Low volume**: Below ~10,000 requests/month, the operational overhead of maintaining a fine-tuned model (versioning, retraining, evaluation) rarely justifies the savings.
- **Rapidly changing requirements**: If the task definition or output format changes frequently, re-fine-tuning each time is expensive and slow. Prompts can be updated instantly.
- **Broad task coverage**: Fine-tuned models excel at narrow tasks. If your application needs to handle diverse, unpredictable queries, a prompted general model is more flexible.
- **Frontier capability requirements**: For tasks that genuinely need frontier model reasoning, fine-tuning a smaller model may not reach acceptable quality regardless of training data.

## Summary and Key Takeaways

1. **Model routing is the highest-impact optimization**: Using a cheap model for easy tasks and reserving expensive models for hard ones can reduce costs by 40-60% with minimal quality impact. Centralize routing logic through an [AI gateway](/ai-gateway) for consistency.

2. **Prompt caching (both client-side and provider-side)** eliminates redundant computation. All three major providers now offer server-side prefix caching with 50-90% discounts on cached tokens -- this is free money for applications with stable prompt prefixes.

3. **Prompt compression** via tools like LLMLingua or manual techniques (selective retrieval, conversation summarization, schema pruning) can reduce input tokens by 2-5x with minimal quality loss.

4. **Reasoning models require careful budget management**: Thinking tokens can inflate output costs by 3-20x. Use thinking token caps and route only genuinely complex tasks to reasoning models.

5. **Multi-modal inputs are expensive**: A single high-res image costs as much as 4000-6000 words of text. Resize images, use OCR for text extraction, and route simple visual tasks to lightweight vision models.

6. **Fine-tuning vs. prompting is a volume decision**: At 500K+ requests/month, fine-tuning (see [Fine-tuning Fundamentals](/fine-tuning-fundamentals)) almost always pays for itself by eliminating few-shot examples from prompts and enabling cheaper model tiers. At low volume, the operational overhead is not worth it.

7. **Batch APIs offer 50% discounts** for non-latency-sensitive workloads. Any pipeline that doesn't need real-time responses should use batch processing.

8. **Token budgeting and monitoring are non-negotiable** in production. Without per-feature and per-user cost tracking, it's impossible to identify optimization opportunities or detect cost anomalies.

9. **Self-hosting rarely makes sense below ~$10K/month** in API spend for a single model, unless driven by privacy or customization requirements. The operational overhead and utilization challenges of GPU management erode the theoretical cost advantage.

10. **Semantic caching is powerful but risky**: it can dramatically reduce costs for repetitive workloads but requires careful threshold tuning to avoid serving incorrect cached responses.

## Key Takeaways

- **Instrument cost tracking from day one**: log tokens, model, feature, and user ID on every LLM call -- you cannot optimize what you cannot observe.
- **Implement model routing before any other optimization**: even a simple rule-based router (task type, expected output length) targeting the cheapest capable model delivers the largest cost reduction for the least engineering effort.
- **Enable provider-side prompt caching immediately** for any application with a long, stable system prompt -- it requires minimal code changes and can reduce prompt costs by 50-90%.
- **Cap `max_tokens` and thinking budgets explicitly**: unset limits waste scheduling resources and can silently inflate costs on both standard and reasoning models.
- **Evaluate fine-tuning at 500K+ requests/month**: at that volume, eliminating few-shot examples from prompts typically pays back the fine-tuning investment within a month.
- **Treat self-hosting as a last resort**: GPU utilization risk, operational overhead, and the rapidly falling cost of hosted inference mean self-hosting only makes sense above ~$10K/month in consistent (non-bursty) API spend.
