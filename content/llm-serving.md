# LLM Serving: API Design, Batching & Streaming

Serving large language models in production requires solving a unique set of systems challenges that differ fundamentally from traditional ML inference. The autoregressive nature of token generation, variable-length inputs and outputs, and the sheer scale of modern models demand specialized serving architectures that balance throughput, latency, and resource utilization. This article examines the key components of LLM serving stacks, from API design patterns through continuous batching to streaming delivery mechanisms.

## The Anatomy of an LLM Serving Request

Before diving into architecture, it helps to understand what makes LLM serving distinct from serving a classifier or an image model. A single LLM request involves two phases: **prefill** (processing the entire input prompt in parallel) and **decode** (generating output tokens one at a time, each depending on all previous tokens). The prefill phase is compute-bound and parallelizable; the decode phase is memory-bandwidth-bound and inherently sequential.

This two-phase nature creates a tension that pervades every design decision in the serving stack. Prefill benefits from large batch sizes and GPU saturation, while decode benefits from low memory latency and fast KV-cache access. The ratio of input to output tokens varies wildly across requests, making static resource allocation wasteful.

### Key Metrics

- **Time to First Token (TTFT)**: How long until the first output token is generated. Dominated by prefill time.
- **Inter-Token Latency (ITL)**: Time between consecutive output tokens during decode. Determines perceived streaming speed.
- **Throughput**: Total tokens generated per second across all concurrent requests.
- **Token/dollar**: The economic efficiency metric that ultimately drives production decisions.

## API Design Patterns

### REST with Synchronous Response

The simplest pattern: client sends a request, waits for the complete response. OpenAI's `/v1/chat/completions` endpoint without streaming is the canonical example.

```python
# Simple synchronous call
import requests

response = requests.post("https://api.example.com/v1/chat/completions", json={
    "model": "gpt-4",
    "messages": [{"role": "user", "content": "Explain quicksort"}],
    "stream": False
})
result = response.json()
```

This pattern works for short outputs or background processing but creates poor user experience for longer generations. The client blocks for the entire generation time, which can be 10-30 seconds for a 1000-token response.

### Server-Sent Events (SSE) Streaming

SSE is the dominant pattern for streaming LLM responses. The server sends a stream of `data:` events, each containing a token or chunk. OpenAI, Anthropic, and most providers use this approach.

```python
# SSE streaming client
import httpx

with httpx.stream("POST", "https://api.example.com/v1/chat/completions", json={
    "model": "gpt-4",
    "messages": [{"role": "user", "content": "Explain quicksort"}],
    "stream": True
}) as response:
    for line in response.iter_lines():
        if line.startswith("data: "):
            chunk = json.loads(line[6:])
            if chunk["choices"][0]["delta"].get("content"):
                print(chunk["choices"][0]["delta"]["content"], end="")
```

SSE has several advantages: it works over standard HTTP, passes through most proxies and CDNs, supports automatic reconnection via the `Last-Event-ID` header, and is simple to implement. The trade-off is that it is unidirectional -- the client cannot send messages back on the same connection.

The SSE event format for LLM streaming typically follows this structure:

```
data: {"id":"chatcmpl-abc","choices":[{"delta":{"content":"Quick"}}]}

data: {"id":"chatcmpl-abc","choices":[{"delta":{"content":"sort"}}]}

data: {"id":"chatcmpl-abc","choices":[{"delta":{"content":" is"}}]}

data: [DONE]
```

### WebSocket Streaming

WebSockets provide bidirectional communication, which enables patterns like mid-generation cancellation, sending additional context during generation, or multiplexing multiple conversations over a single connection. Google's Gemini Multimodal Live API uses WebSockets for real-time audio/video interactions.

```javascript
const ws = new WebSocket("wss://api.example.com/v1/stream");

ws.onopen = () => {
    ws.send(JSON.stringify({
        type: "generate",
        messages: [{ role: "user", content: "Explain quicksort" }]
    }));
};

ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.type === "token") {
        process.stdout.write(data.content);
    } else if (data.type === "done") {
        ws.close();
    }
};
```

The trade-off is complexity: WebSockets require connection management, heartbeating, reconnection logic, and don't work well with HTTP-based load balancers without special configuration.

### gRPC Streaming

For internal microservice communication, gRPC with server-side streaming offers strong typing, efficient binary serialization via Protocol Buffers, and built-in deadline propagation. NVIDIA Triton Inference Server uses gRPC as its primary serving protocol.

```protobuf
service LLMService {
    rpc Generate(GenerateRequest) returns (stream GenerateResponse);
    rpc GenerateUnary(GenerateRequest) returns (GenerateResponse);
}

message GenerateRequest {
    string model = 1;
    repeated Message messages = 2;
    GenerationParams params = 3;
}
```

## Continuous Batching: The Orca Revolution

Traditional ML serving uses **static batching**: collect N requests, process them as a batch, return all results. This works terribly for LLM inference because requests have wildly different output lengths. In a static batch, all requests must wait for the longest one to finish, wasting GPU cycles on padding.

The Orca paper (Yu et al., 2022, "Orca: A Distributed Serving System for Transformer-Based Generative Models") introduced **continuous batching** (also called **iteration-level scheduling**). The key insight: instead of batching at the request level, batch at the iteration (token) level.

### How Continuous Batching Works

1. The scheduler maintains a pool of active requests, each with its own KV-cache.
2. At each decode iteration, the scheduler selects which requests to include in the current batch.
3. When a request finishes (generates EOS or hits max tokens), its slot is immediately freed.
4. New requests can be admitted into the batch at any iteration, without waiting for other requests to finish.

```
Static Batching:
Request A: [prefill ████████ decode ████████████████████████████]
Request B: [prefill ██ decode ██████████]  [padding ██████████████]
Request C: [prefill ████ decode ████████████████]  [padding ██████]
           |<---- all wait for Request A to finish ---->|

Continuous Batching:
Request A: [prefill ████████ decode ████████████████████████████]
Request B: [prefill ██ decode ██████████]
Request C:          [prefill ████ decode ████████████████]
Request D:                        [prefill ██ decode ████████████]
           ^ D enters when B finishes, no wasted cycles
```

This can improve throughput by 2-8x compared to static batching, depending on the variance in output lengths.

### Prefill-Decode Disaggregation

A further optimization, explored in systems like Splitwise (Patel et al., 2024) and DistServe, is to run prefill and decode on separate GPU pools. Since prefill is compute-bound and decode is memory-bound, they have different optimal hardware configurations. Prefill benefits from high-FLOPS GPUs; decode benefits from high-memory-bandwidth configurations.

```
┌─────────────────┐         ┌──────────────────┐
│   Prefill Pool   │         │   Decode Pool     │
│  (Compute-heavy) │ ──KV──> │  (Memory-heavy)   │
│  High-FLOPS GPUs │  cache  │  High-BW GPUs     │
└─────────────────┘         └──────────────────┘
```

The challenge is efficiently transferring KV-caches between pools. With large context windows (100K+ tokens), KV-caches can be gigabytes in size, making network transfer a bottleneck.

## KV-Cache Management: PagedAttention

One of the most important innovations in LLM serving is **PagedAttention**, introduced in the vLLM paper (Kwon et al., 2023, "Efficient Memory Management for Large Language Model Serving with PagedAttention"). The core problem: KV-caches are large, variably sized, and their final size is unknown at request start.

Traditional serving pre-allocates a contiguous block of GPU memory for each request's KV-cache based on the maximum sequence length. This wastes 60-80% of GPU memory on average due to internal fragmentation (allocated but unused space) and external fragmentation (gaps between allocations).

PagedAttention borrows ideas from OS virtual memory: it divides the KV-cache into fixed-size **pages** (blocks of, say, 16 tokens) and uses a page table to map logical KV-cache positions to physical GPU memory blocks. Pages are allocated on demand as the sequence grows.

```python
# Conceptual PagedAttention allocation
class KVCacheManager:
    def __init__(self, num_blocks, block_size, num_heads, head_dim):
        self.block_size = block_size  # e.g., 16 tokens per block
        self.free_blocks = list(range(num_blocks))
        # Physical KV cache: [num_blocks, 2, num_heads, block_size, head_dim]
        self.kv_cache = torch.zeros(num_blocks, 2, num_heads, block_size, head_dim)

    def allocate_block(self, request_id):
        if not self.free_blocks:
            raise RuntimeError("OOM: no free KV-cache blocks")
        block_id = self.free_blocks.pop()
        self.page_tables[request_id].append(block_id)
        return block_id
```

This achieves near-zero waste and enables advanced features like **copy-on-write** for parallel sampling (multiple completions sharing the same prompt KV-cache) and **prefix caching** (reusing KV-cache pages across requests that share a common prefix).

## Serving Stacks Compared

### vLLM

vLLM is the most widely deployed open-source LLM serving engine. Its core architecture is built around PagedAttention, continuous batching, and an OpenAI-compatible API server. Releases from v0.5 through v0.6+ have substantially expanded the feature set:

- **PagedAttention v2** with improved memory efficiency and reduced fragmentation overhead
- **Automatic prefix caching (APC)**: Enabled via `--enable-prefix-caching`, vLLM hashes KV-cache blocks and reuses them across requests that share common prefixes (system prompts, few-shot examples). Unlike manual prefix registration, APC works transparently across all requests with zero configuration.
- **Pipeline parallelism**: vLLM v0.5+ introduced pipeline parallelism alongside tensor parallelism, enabling models to be distributed across nodes connected by commodity networking. This is critical for serving 400B+ parameter models where a single node's GPUs are insufficient (see [Article 38: Scaling & Load Balancing](/scaling-load-balancing) for a deeper treatment of parallelism strategies).
- **Multimodal serving**: vLLM v0.5+ supports vision-language models (LLaVA, Qwen-VL, InternVL) with unified batching of text and image inputs. Image preprocessing is pipelined with token generation to avoid blocking.
- **Chunked prefill**: Borrowed from the Sarathi-Serve approach (discussed below), vLLM v0.6+ breaks long prefill operations into smaller chunks interleaved with decode iterations, preventing prefill from starving decode requests.
- **Multi-LoRA serving**: Native support for serving multiple LoRA adapters on a single base model with per-request adapter selection (see the Multi-LoRA Serving section below).
- **Speculative decoding** with draft models, Medusa heads, and n-gram speculation
- **FP8 and GPTQ/AWQ quantization** for reduced memory and improved throughput (see [Article 5: Inference Optimization](/inference-optimization) for quantization fundamentals)

```bash
# Launch vLLM server with v0.6+ features
python -m vllm.entrypoints.openai.api_server \
    --model meta-llama/Llama-3.1-70B-Instruct \
    --tensor-parallel-size 4 \
    --max-model-len 8192 \
    --enable-prefix-caching \
    --enable-chunked-prefill \
    --gpu-memory-utilization 0.9
```

### Text Generation Inference (TGI)

Hugging Face's TGI is a Rust-based serving solution with a focus on safety and production readiness. It was one of the first systems to implement continuous batching and Flash Attention in production.

```bash
# Launch TGI with Docker
docker run --gpus all -p 8080:80 \
    -v $PWD/models:/data \
    ghcr.io/huggingface/text-generation-inference:latest \
    --model-id meta-llama/Llama-3.1-70B-Instruct \
    --num-shard 4 \
    --max-input-length 4096 \
    --max-total-tokens 8192
```

### NVIDIA Triton + TensorRT-LLM

For maximum performance on NVIDIA hardware, TensorRT-LLM compiles models into optimized TensorRT engines with custom CUDA kernels. Triton provides the serving infrastructure with advanced scheduling and multi-model support.

```python
# TensorRT-LLM build config
import tensorrt_llm

builder = tensorrt_llm.Builder()
network = builder.create_network()
# ... configure layers, quantization, parallelism
engine = builder.build_engine(network, builder_config)
engine.save("llama-70b-engine")
```

TensorRT-LLM typically achieves 1.5-3x higher throughput than PyTorch-based solutions on the same hardware, at the cost of longer setup time and less flexibility.

### SGLang

SGLang (Zheng et al., 2024) takes a different approach, optimizing at the programming model level. Its **RadixAttention** mechanism uses a radix tree (prefix tree) to automatically detect and reuse KV-cache across requests that share common prefixes. Unlike vLLM's hash-based prefix caching, RadixAttention operates on a trie structure over token sequences, enabling sub-linear lookup for shared prefixes even across complex multi-call LLM programs (tree-of-thought, multi-turn chat, few-shot batches with shared examples).

SGLang has emerged as a genuine competitor to vLLM, particularly for workloads involving structured multi-call programs. Key differentiators:

- **RadixAttention**: Automatic KV-cache sharing across requests with common prefixes, without requiring explicit prefix registration. The radix tree is maintained incrementally and supports LRU eviction when GPU memory is exhausted.
- **Compressed finite-state machines**: SGLang integrates constrained decoding via compressed FSMs that jump multiple tokens in a single step when the grammar permits only one valid continuation, reducing decode iterations for structured output (see the Guided Decoding section below and [Article 10: Structured Output](/structured-output) for the broader constrained decoding landscape).
- **Data parallelism with expert parallelism**: SGLang v0.3+ supports DP attention combined with tensor parallelism, enabling higher throughput on multi-GPU nodes without full pipeline parallelism overhead.
- **Overlap scheduling**: Prefill and decode operations are overlapped within the same batch to improve GPU utilization, an approach complementary to the chunked-prefill strategy discussed below.

In benchmarks on LLM-as-judge workloads (where many requests share the same system prompt and rubric), SGLang's RadixAttention achieves up to 5x throughput improvement over systems without automatic prefix sharing.

## Request Scheduling and Queuing

### Priority Queuing

Production systems need to handle mixed workloads: real-time chat requests (latency-sensitive) alongside batch processing (throughput-sensitive). A multi-level priority queue allows the scheduler to prefer low-latency requests:

```python
class LLMScheduler:
    def __init__(self):
        self.queues = {
            "realtime": asyncio.PriorityQueue(),   # TTFT < 500ms target
            "interactive": asyncio.PriorityQueue(), # TTFT < 2s target
            "batch": asyncio.PriorityQueue(),       # Throughput-optimized
        }

    async def schedule_next_batch(self, max_batch_tokens: int):
        batch = []
        token_budget = max_batch_tokens

        for tier in ["realtime", "interactive", "batch"]:
            while not self.queues[tier].empty() and token_budget > 0:
                request = self.queues[tier].get_nowait()
                est_tokens = estimate_tokens(request)
                if est_tokens <= token_budget:
                    batch.append(request)
                    token_budget -= est_tokens

        return batch
```

### Admission Control

When the system is overloaded, it's better to reject requests quickly with a 429 status than to accept them and deliver terrible latency. Admission control monitors queue depth, GPU utilization, and KV-cache occupancy to decide whether to accept new requests.

### Fairness and Rate Limiting

In multi-tenant scenarios, per-user rate limiting prevents a single user from monopolizing GPU resources. Token-bucket algorithms work well here, where each user has a bucket that refills at a configured rate:

```python
class TokenBucket:
    def __init__(self, rate: float, capacity: int):
        self.rate = rate          # tokens per second refill rate
        self.capacity = capacity  # max burst size
        self.tokens = capacity
        self.last_refill = time.monotonic()

    def consume(self, num_tokens: int) -> bool:
        self._refill()
        if self.tokens >= num_tokens:
            self.tokens -= num_tokens
            return True
        return False
```

## Throughput vs Latency Tradeoffs

The fundamental tradeoff in LLM serving is between throughput (tokens/second across all requests) and latency (time per individual request). Larger batches improve throughput by amortizing memory access costs but increase per-request latency due to contention.

### The Batching Sweet Spot

For a given GPU and model, there is typically a batching sweet spot where throughput is maximized without unacceptable latency degradation:

- **Batch size 1**: Minimum latency, poor GPU utilization (often <20% of theoretical FLOPS)
- **Batch size 8-32**: Good GPU utilization (60-80%), moderate latency increase
- **Batch size 64-256**: Near-peak throughput, significant latency increase, risk of KV-cache OOM

The optimal batch size depends on model size, sequence length, GPU memory, and the latency SLA. vLLM's scheduler dynamically adjusts the batch size based on these factors.

### Speculative Decoding

Speculative decoding (Leviathan et al., 2023; Chen et al., 2023) uses a small "draft" model to generate K candidate tokens, then verifies them in parallel with the large "target" model. When the draft model's predictions are correct (which happens frequently for common text patterns), this generates K tokens in the time it takes to generate ~1, achieving 2-3x decode speedup without changing output quality.

```python
# Speculative decoding pseudocode
def speculative_decode(draft_model, target_model, prompt, K=5):
    tokens = prompt
    while not done:
        # Draft model generates K candidates
        draft_tokens = draft_model.generate(tokens, num_tokens=K)

        # Target model verifies all K+1 positions in parallel
        target_logits = target_model.forward(tokens + draft_tokens)

        # Accept tokens where draft matches target distribution
        accepted = 0
        for i in range(K):
            if accept_criterion(draft_logits[i], target_logits[i]):
                accepted += 1
            else:
                # Resample from adjusted distribution
                tokens.append(resample(target_logits[i], draft_logits[i]))
                break

        tokens.extend(draft_tokens[:accepted])
```

## FlashAttention and Memory-Efficient Kernels

Standard self-attention computes the full $N \times N$ attention matrix, requiring $O(N^2)$ memory -- prohibitive for long sequences. **FlashAttention** (Dao et al., 2022) reformulated attention to avoid materializing the full attention matrix, computing attention in tiles that fit in GPU SRAM (on-chip memory) and fusing the softmax normalization into the same kernel pass.

### FlashAttention Evolution

**FlashAttention-1** introduced the tiled, IO-aware algorithm. By computing attention in blocks that fit in SRAM and accumulating the softmax statistics online (using the log-sum-exp trick), it reduces GPU HBM reads/writes from $O(N^2)$ to $O(N^2 d / M)$ where $M$ is SRAM size. In practice, this translates to 2-4x wall-clock speedup and up to 20x memory reduction for long contexts.

**FlashAttention-2** (Dao, 2023) improved on v1 with better work partitioning across GPU warps and thread blocks. Key optimizations include: parallelizing over the sequence length dimension (not just batch and heads), reducing non-matmul FLOPs, and better occupancy on A100 GPUs. FlashAttention-2 achieves up to 230 TFLOPs on A100 (73% of theoretical peak), compared to ~150 TFLOPs for v1.

**FlashAttention-3** (Dao et al., 2024) targets NVIDIA Hopper (H100/H200) GPUs specifically. Hopper introduces the Tensor Memory Accelerator (TMA) for asynchronous block-level data movement and warp-group-level matrix multiply via WGMMA instructions. FA3 exploits these with:

- **Asynchronous pipelining**: Overlaps data loading (via TMA), computation (via WGMMA), and softmax operations in a 3-stage software pipeline, hiding latency at each stage.
- **FP8 support**: Native FP8 attention with incoherent processing (per-block quantization scaling) to maintain accuracy, achieving up to 1.2 PFLOPs on H100 -- a 2x improvement over FA2 in FP16 on the same hardware.
- **Block quantization**: Rather than quantizing the entire Q, K, V matrices uniformly, FA3 applies quantization at the tile level with per-tile scaling factors, significantly improving FP8 accuracy.

### FlashDecoding

While FlashAttention primarily optimizes the prefill phase (where the full attention matrix is computed), **FlashDecoding** (Dao et al., 2023) addresses the decode phase. During decode, each new token attends to all previous KV-cache entries -- a workload that is memory-bandwidth-bound with poor GPU utilization because the parallelism is limited to the batch and head dimensions.

FlashDecoding introduces parallelism along the KV sequence length dimension: different thread blocks process different chunks of the KV-cache in parallel, then combine results with a lightweight reduction. This improves decode throughput by up to 8x for long contexts (e.g., 64K tokens) with small batch sizes.

These kernel-level optimizations form the computational foundation of every serving engine discussed in this article. TGI, vLLM, SGLang, and TensorRT-LLM all use FlashAttention variants as their default attention implementation. For a broader treatment of the attention mechanism and its computational costs, see [Article 5: Inference Optimization](/inference-optimization).

## Multi-LoRA Serving

A common production pattern involves fine-tuning dozens or hundreds of LoRA adapters on top of a single base model -- one per customer, language, task, or domain. Naive serving would require loading a separate model copy for each adapter, wasting GPU memory on redundant base model weights. Multi-LoRA serving solves this by keeping one copy of the base model in GPU memory and dynamically swapping lightweight adapter weights per request.

### S-LoRA: Scalable LoRA Serving

S-LoRA (Sheng et al., 2023, "S-LoRA: Serving Thousands of Concurrent LoRA Adapters") introduced a system architecture for serving up to several thousand LoRA adapters concurrently on a single base model. The key innovations:

1. **Unified paging for adapter weights**: S-LoRA extends PagedAttention's paging mechanism to LoRA adapter weights. Adapter matrices A and B are stored in a paged memory pool, allowing adapters to be loaded and evicted at the page granularity.
2. **Heterogeneous batching**: Within a single batch, different requests can use different LoRA adapters (or no adapter at all). The attention kernel is modified to apply the correct adapter for each request using custom CUDA kernels with gather-scatter operations.
3. **Adapter caching with LRU eviction**: Frequently used adapters stay in GPU memory; rarely used ones are evicted to CPU memory or disk. When a request arrives for an evicted adapter, it is loaded asynchronously while other requests in the batch proceed.

```python
# vLLM multi-LoRA serving example
# Launch with LoRA support enabled
# python -m vllm.entrypoints.openai.api_server \
#     --model meta-llama/Llama-3.1-8B-Instruct \
#     --enable-lora \
#     --lora-modules customer-a=./adapters/customer_a \
#                     customer-b=./adapters/customer_b \
#     --max-loras 64 \
#     --max-lora-rank 64

# Request with a specific LoRA adapter
import requests
response = requests.post("http://localhost:8000/v1/chat/completions", json={
    "model": "customer-a",  # selects the LoRA adapter
    "messages": [{"role": "user", "content": "Summarize this contract"}],
})
```

### Hot-Swapping Adapters

In production, adapters are trained and updated continuously. Hot-swapping allows registering new adapters or updating existing ones without restarting the server or draining requests. vLLM's LoRA support allows dynamic adapter registration via API, while SGLang supports loading adapters from Hugging Face Hub at runtime. The adapter weights are small (typically 10-100 MB for rank-16 adapters on a 7B model), making swap latency negligible compared to full model loading.

For a deep dive into LoRA training, rank selection, and merging strategies, see [Article 20: LoRA Adapters](/lora-adapters).

## Chunked Prefill

In standard continuous batching, prefill and decode compete for the same GPU compute cycle. A long-context prefill (say, 32K tokens) can monopolize the GPU for hundreds of milliseconds, during which all in-flight decode requests are stalled. This creates severe tail-latency spikes -- a single long-context request arriving at an unfortunate time can degrade inter-token latency for every other active request.

### Sarathi-Serve: Interleaving Prefill and Decode

Sarathi-Serve (Agrawal et al., 2024) formalized the **chunked-prefill** approach. Instead of processing an entire prefill in one pass, the prefill is broken into fixed-size chunks (e.g., 512 or 1024 tokens). Between prefill chunks, the scheduler inserts decode iterations for in-flight requests:

```
Without chunked prefill (standard continuous batching):
Decode reqs: [d d d d d |          BLOCKED          | d d d d d]
Prefill req:            [========= 32K prefill =========]
                        ^ decode requests stall here

With chunked prefill:
Decode reqs: [d d d][d d d][d d d][d d d][d d d][d d d][d d d]
Prefill req:  [p512] [p512] [p512] [p512] [p512] [p512]...
              ^ prefill and decode interleaved at chunk boundaries
```

This interleaving bounds the worst-case decode stall to the time of one prefill chunk rather than the time of the full prefill. The cost is slightly increased total prefill latency (due to chunking overhead and re-scheduling), but the tail-latency improvement for concurrent decode requests is dramatic -- P99 inter-token latency improvements of 3-10x in mixed workloads are typical.

### Implementation in Serving Engines

vLLM v0.6+ adopted chunked prefill as a first-class scheduling option via `--enable-chunked-prefill`. The chunk budget is configured alongside the token budget, and the scheduler co-locates prefill chunks with decode iterations in the same batch to maximize GPU utilization. The token budget parameter `--max-num-batched-tokens` controls how many tokens (from both prefill chunks and decode steps) are processed per iteration.

TensorRT-LLM implements a similar concept under the name "inflight batching with context chunking," where long contexts are automatically segmented and interleaved with generation requests.

Chunked prefill is especially important for production deployments that must serve both long-context (RAG, document analysis) and short-context (chat) workloads on the same GPU pool, a scenario that is increasingly common in real-world systems. For how this fits into broader cluster-level scheduling, see [Article 38: Scaling & Load Balancing](/scaling-load-balancing).

## Guided Decoding and Constrained Generation

Many production applications require LLM output to conform to a strict schema -- a JSON object matching a Pydantic model, a SQL query, or a response restricted to an enum of values. While prompt engineering can encourage compliance, it does not guarantee it. **Guided decoding** enforces structural constraints at the token level during generation, making schema violations impossible by construction.

### Finite-State Machine Approach

The dominant approach represents the target grammar (JSON Schema, regular expression, context-free grammar) as a finite-state machine (FSM) or pushdown automaton. At each decode step, the FSM's current state determines which tokens are valid continuations. The serving engine masks logits for invalid tokens before sampling, guaranteeing that every generated token moves the FSM toward an accepting state.

```python
# Conceptual guided decoding with an FSM
class GuidedDecoder:
    def __init__(self, grammar_fsm):
        self.fsm = grammar_fsm

    def apply_mask(self, logits, current_state):
        # Determine valid next tokens from FSM
        valid_tokens = self.fsm.get_valid_tokens(current_state)
        mask = torch.full_like(logits, float('-inf'))
        mask[valid_tokens] = 0
        return logits + mask

    def decode_step(self, model, input_ids, state):
        logits = model(input_ids).logits[:, -1, :]
        masked_logits = self.apply_mask(logits, state)
        next_token = torch.argmax(masked_logits)  # or sample
        next_state = self.fsm.advance(state, next_token)
        return next_token, next_state
```

### Outlines and XGrammar

**Outlines** (Willard & Louf, 2023) pioneered the FSM-based approach for LLM-serving integration. Given a JSON Schema or regex, Outlines pre-compiles the constraint into an FSM where states map to sets of allowed token IDs. The pre-compilation step is critical for performance: building the token mask is done once per schema, and per-step masking is a fast index lookup.

**XGrammar** (Dong et al., 2024) extends this to context-free grammars with a focus on serving-system integration. XGrammar pre-computes token masks at multiple granularities: context-independent masks (tokens that are always valid or invalid regardless of grammar state) are computed at schema-load time, while context-dependent masks are computed per-step using an adaptive expansion algorithm. This reduces per-token overhead to microseconds, making it practical for high-throughput serving.

### Serving Framework Integration

Guided decoding is integrated into major serving frameworks:

- **vLLM**: Supports `guided_json`, `guided_regex`, and `guided_choice` parameters in the OpenAI-compatible API. Uses Outlines or XGrammar as backends (configurable via `--guided-decoding-backend`).
- **SGLang**: Integrates compressed FSMs that can skip multiple tokens when only one valid continuation exists (e.g., generating the fixed string `"type":` in a JSON object), reducing the number of decode iterations.
- **TGI**: Supports grammar-based constraints via the `grammar` API parameter.

```bash
# vLLM request with JSON schema constraint
curl http://localhost:8000/v1/chat/completions -d '{
    "model": "meta-llama/Llama-3.1-8B-Instruct",
    "messages": [{"role": "user", "content": "Extract the name and age"}],
    "response_format": {
        "type": "json_schema",
        "json_schema": {
            "name": "person",
            "schema": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "age": {"type": "integer"}
                },
                "required": ["name", "age"]
            }
        }
    }
}'
```

The overhead of guided decoding depends on the grammar complexity and the vocabulary size but is typically under 5% of total generation latency with pre-compiled masks. For a comprehensive treatment of structured output techniques and when to prefer constrained decoding over prompt-based approaches, see [Article 10: Structured Output](/structured-output).

## Production Deployment Patterns

### Health Checks and Graceful Degradation

A production LLM serving deployment needs layered health checks:

```python
@app.get("/health")
async def health():
    return {"status": "ok"}

@app.get("/health/ready")
async def ready():
    # Check if model is loaded and GPU is responsive
    gpu_ok = await check_gpu_health()
    model_ok = model_loaded and kv_cache_available
    queue_ok = request_queue.qsize() < MAX_QUEUE_DEPTH

    if gpu_ok and model_ok and queue_ok:
        return {"status": "ready"}
    return JSONResponse(status_code=503, content={"status": "not_ready"})
```

### Warm-up and Model Loading

Large models take minutes to load. Production deployments should:
1. Pre-load models during container startup
2. Send synthetic warm-up requests to populate CUDA caches
3. Only mark the instance as "ready" after warm-up completes
4. Use model caching (e.g., safetensors format) to reduce load times

### Observability Integration

Every serving request should emit structured telemetry:

```python
@dataclass
class InferenceMetrics:
    request_id: str
    model: str
    prompt_tokens: int
    completion_tokens: int
    ttft_ms: float
    total_latency_ms: float
    tokens_per_second: float
    queue_wait_ms: float
    batch_size_at_schedule: int
    kv_cache_utilization: float
```

## Summary and Key Takeaways

1. **LLM inference has two distinct phases** -- prefill (compute-bound) and decode (memory-bound) -- that require different optimization strategies and can even run on different hardware pools.

2. **SSE streaming is the dominant API pattern** for LLM serving, offering a good balance of simplicity, compatibility, and user experience. WebSockets add bidirectional communication for advanced use cases like real-time voice.

3. **Continuous batching (Orca) transforms throughput** by scheduling at the iteration level rather than the request level, eliminating padding waste and enabling 2-8x throughput improvements.

4. **PagedAttention (vLLM) solves memory fragmentation** by borrowing virtual memory concepts from operating systems, enabling near-optimal GPU memory utilization for KV-caches.

5. **FlashAttention (1/2/3) and FlashDecoding** eliminate the memory bottleneck of materialized attention matrices, with Hopper-specific optimizations pushing toward peak hardware utilization. These kernels are the computational foundation of every modern serving engine.

6. **Multi-LoRA serving** (S-LoRA, vLLM LoRA support) enables hundreds of task-specific adapters on a single base model, making per-customer and per-domain fine-tuning economically viable in production (see [Article 20: LoRA Adapters](/lora-adapters)).

7. **Chunked prefill** bounds worst-case decode latency in mixed workloads by interleaving prefill chunks with decode iterations, a critical technique for serving both long-context and short-context requests on shared infrastructure.

8. **Guided decoding** via FSMs and context-free grammars provides runtime enforcement of JSON schemas and other structural constraints, eliminating an entire class of output reliability failures (see [Article 10: Structured Output](/structured-output)).

9. **The throughput-latency tradeoff is fundamental** and must be navigated through dynamic batch sizing, priority scheduling, and admission control based on SLA requirements.

10. **Speculative decoding** is a free lunch for decode-bound workloads, using a small draft model to generate candidates verified in parallel by the target model.

11. **Production serving requires more than fast inference**: health checks, warm-up procedures, graceful degradation, multi-tenant fairness, and comprehensive observability are all essential components.
