# Inference Optimization: KV Cache, Quantization & Speculative Decoding

Serving large language models at production scale is fundamentally an inference optimization problem. While training a frontier model may cost hundreds of millions of dollars, the cumulative cost of inference — serving billions of requests across the model's lifetime — typically dwarfs training cost by an order of magnitude (see [Article 39: Cost Optimization](/cost-optimization) for the economic analysis). This article examines the core techniques that make LLM inference practical: KV cache management, prefix caching, quantization methods, speculative decoding, disaggregated serving, continuous batching, and attention optimization. Each technique addresses a different bottleneck in the inference pipeline — rooted in the transformer's attention mechanism and autoregressive decode loop covered in [Article 01: Transformer Architecture](/transformer-architecture) — and understanding their interactions is essential for building efficient serving systems.

## The Inference Pipeline

LLM inference proceeds in two distinct phases, each with different computational characteristics:

### Prefill Phase

The prefill phase processes the entire input prompt in parallel. For a prompt of $n$ tokens, the model computes attention over all $n$ tokens simultaneously, populating the KV cache. This phase is **compute-bound** — it performs $O(n^2 d)$ operations for attention and $O(n d^2)$ for FFN layers, and modern GPUs have sufficient memory bandwidth to keep ALUs busy.

### Decode Phase

The decode phase generates tokens one at a time, autoregressively. Each new token requires:

1. Computing the query, key, and value for the new token
2. Attending to all previous keys and values (from the KV cache)
3. Computing the FFN output
4. Sampling the next token

This phase is **memory-bandwidth-bound**: for each generated token, the model must read all its parameters from memory (GPU HBM) but performs very little computation per parameter (just a matrix-vector multiplication, not a matrix-matrix multiplication). The arithmetic intensity (FLOPs per byte loaded) is extremely low, leaving the GPU's compute units mostly idle.

```python
# Arithmetic intensity comparison
# Prefill: matrix-matrix multiply (high intensity)
# B=batch, N=seq_len, D=hidden_dim
# FLOPs: B * N * D * D, Bytes: D * D (weight) + B * N * D (input)
# Intensity: ~N (scales with sequence length)

# Decode: matrix-vector multiply (low intensity)
# FLOPs: B * 1 * D * D, Bytes: D * D (weight) + B * 1 * D (input)
# Intensity: ~B (scales with batch size only)
# For B=1: intensity ~1, GPU utilization ~1%
```

This memory-bandwidth bottleneck during decode is the central challenge of LLM inference optimization.

## KV Cache Mechanics

The KV cache stores the key and value projections for all previously processed tokens, avoiding redundant recomputation during autoregressive generation.

### Memory Requirements

For a model with $L$ layers, $n_h$ attention heads, head dimension $d_h$, and sequence length $s$:

$$\text{KV cache size} = 2 \times L \times n_h \times d_h \times s \times \text{bytes\_per\_element}$$

For Llama 2 70B ($L=80$, $n_h=8$ KV heads with GQA, $d_h=128$) at 128K context in fp16:

$$2 \times 80 \times 8 \times 128 \times 131072 \times 2 = 34.4 \text{ GB}$$

This means the KV cache alone can exceed the model weights in memory for long sequences, making KV cache management the primary memory bottleneck for long-context inference.

### Grouped-Query Attention for KV Cache Reduction

As discussed in [Article 04: Model Architectures](/model-architectures), GQA reduces the number of KV heads. Llama 2 70B uses 8 KV heads instead of 64, achieving an 8x reduction in KV cache size. This was the primary motivation for adopting GQA — the quality impact is minimal, but the inference memory savings are substantial.

### Multi-Query Attention (MQA)

The extreme case of GQA is MQA (**Shazeer, 2019**), where all query heads share a single key and single value head. While this maximally reduces KV cache size, it can degrade quality, especially for tasks requiring fine-grained attention patterns. GQA provides a tunable middle ground.

## PagedAttention and vLLM

**Kwon et al. (2023)** introduced PagedAttention in the vLLM system, which revolutionized KV cache management by borrowing ideas from operating system virtual memory.

### The Fragmentation Problem

Naive KV cache management pre-allocates a contiguous block of GPU memory for each request's maximum possible sequence length. This leads to severe memory fragmentation:

- A request might use only 500 of 2048 allocated token slots, wasting 75% of memory.
- Different requests have different lengths, creating external fragmentation.
- Memory utilization typically runs at 20-40% in naive systems.

### PagedAttention Solution

PagedAttention divides the KV cache into fixed-size **pages** (blocks of token slots, typically 16 tokens per block). Pages are allocated on demand as the sequence grows, similar to how OS virtual memory maps logical pages to physical frames:

```python
class PagedKVCache:
    """Simplified PagedAttention KV cache manager."""
    def __init__(self, num_layers, num_heads, head_dim, block_size=16):
        self.block_size = block_size
        self.free_blocks = list(range(MAX_BLOCKS))
        # block_table[request_id] = list of block indices
        self.block_tables = {}

    def allocate_block(self, request_id):
        block_idx = self.free_blocks.pop()
        if request_id not in self.block_tables:
            self.block_tables[request_id] = []
        self.block_tables[request_id].append(block_idx)
        return block_idx

    def free_request(self, request_id):
        blocks = self.block_tables.pop(request_id)
        self.free_blocks.extend(blocks)
```

This approach achieves near-100% memory utilization and enables:

- **Memory sharing**: multiple sequences with shared prefixes (e.g., the same system prompt) can share KV cache pages via copy-on-write semantics.
- **Efficient beam search**: candidate beams share the common prefix and only allocate new pages for divergent tokens.
- **Dynamic allocation**: memory is used proportionally to actual sequence lengths, not worst-case allocations.

vLLM with PagedAttention achieves 2-4x higher throughput than naive serving implementations, primarily by fitting more concurrent requests into GPU memory.

## Prefix Caching and KV Cache Reuse

A large fraction of production LLM traffic shares common prompt prefixes — system prompts, few-shot examples, tool definitions, and RAG preambles. Computing the KV cache for these shared prefixes from scratch on every request is wasteful. Prefix caching eliminates this redundancy by reusing previously computed KV cache blocks across requests.

### RadixAttention

**Zheng et al. (2024)** introduced RadixAttention in the SGLang serving framework. The core idea is to organize the KV cache as a **radix tree** (a compressed trie) keyed by token sequences. When a new request arrives, the system performs a longest-prefix match against the radix tree. If the first $k$ tokens of the new request match an existing cached sequence, those $k$ positions of KV cache are reused directly, and the prefill phase only processes the remaining tokens.

```python
# Conceptual radix tree for KV cache reuse
# Three requests sharing a common system prompt prefix:
#
#   "You are a helpful assistant..." (system prompt, 500 tokens)
#       ├── "Summarize this article: ..." (Request A)
#       ├── "Translate to French: ..."    (Request B)
#       └── "You are a helpful assistant..." (different continuation)
#           └── "Write unit tests for..." (Request C)
#
# Request A computes KV cache for all tokens (cache miss).
# Request B reuses the 500-token system prompt KV cache; only prefills
#   the unique suffix.
# Request C shares the same prefix as A and B, reuses that KV cache.
```

The radix tree supports **automatic** prefix sharing with no manual annotation required. Unlike explicit caching APIs (discussed below), the serving system transparently identifies and reuses common prefixes across all concurrent requests. In workloads with high prefix overlap — LLM-as-judge evaluations, chat applications with fixed system prompts, batch processing with shared instructions — RadixAttention achieves up to 5x throughput improvement. See [Article 37: LLM Serving](/llm-serving) for SGLang's full serving architecture.

### Shared Prefix Caching Across Requests

vLLM implements a related approach through **automatic prefix caching (APC)**: each KV cache block is hashed by its token content, and blocks with matching hashes are shared via copy-on-write semantics (the same mechanism PagedAttention uses for beam search). When APC is enabled, requests that share a common prefix — even if they arrive minutes apart — skip prefill for the shared portion.

The performance impact is substantial for system-prompt-heavy workloads. A 2000-token system prompt at fp16 on a 70B model consumes roughly 0.5 GB of KV cache. Without prefix caching, 100 concurrent requests each allocate their own copy (50 GB total for system prompts alone). With prefix caching, a single copy is shared, freeing memory for additional concurrent requests and directly improving throughput.

Prefix caching also reduces **Time to First Token (TTFT)** — the cache-hit portion of the prompt skips the compute-bound prefill entirely, so a request with a 2000-token cached prefix and a 200-token unique suffix only prefills 200 tokens. For chat applications where multi-turn conversations accumulate context, this means each successive turn benefits from caching the entire conversation history up to that point.

## Quantization

Quantization reduces the numerical precision of model weights and/or activations, decreasing memory usage and often improving throughput. The challenge is maintaining quality while reducing precision.

### Weight-Only Quantization

The most common approach quantizes only the model weights, keeping activations in higher precision (fp16 or bf16). Since decode is memory-bandwidth-bound, reducing weight size directly increases throughput.

#### GPTQ

**Frantar et al. (2023)** introduced GPTQ, a one-shot post-training quantization method based on approximate second-order information:

1. Process layers sequentially, quantizing one layer at a time.
2. For each layer, use a calibration dataset to compute the Hessian (second-order gradient information).
3. Quantize weights to minimize the layer's output error, using the Hessian to optimally adjust remaining weights to compensate for quantization error.

GPTQ achieves 4-bit quantization with minimal quality loss for most models, reducing memory by 4x compared to fp16.

#### AWQ (Activation-Aware Weight Quantization)

**Lin et al. (2023)** observed that not all weights are equally important — weights corresponding to large-magnitude activations have outsized impact on quality. AWQ scales weights by the activation magnitude before quantization:

```python
def awq_quantize(weight, activation_scale, group_size=128):
    """Simplified AWQ quantization."""
    # Scale weights by activation importance
    scaled_weight = weight * activation_scale.unsqueeze(0)

    # Group quantization: quantize in groups of `group_size` columns
    for i in range(0, weight.shape[1], group_size):
        group = scaled_weight[:, i:i+group_size]
        scale = group.abs().max() / 7  # for 4-bit: range [-8, 7]
        quantized = torch.round(group / scale).clamp(-8, 7)
        # Store scale factor and quantized weights
```

AWQ typically outperforms GPTQ at the same bit width and is faster to apply (no Hessian computation needed).

#### GGUF and llama.cpp Quantization

The GGUF format (used by llama.cpp) provides a range of quantization schemes optimized for CPU inference:

- **Q4_0**: 4-bit quantization with 32-element blocks, simple round-to-nearest
- **Q4_K_M**: 4-bit with k-quant optimization, using 256-element superblocks with 6-bit scales
- **Q5_K_M**: 5-bit with k-quant, slightly better quality
- **Q8_0**: 8-bit, near-lossless

The k-quant methods (**Gerganov, 2023**) use a nested quantization structure where scale factors themselves are quantized, achieving better precision per bit than flat quantization.

#### QuIP# and AQLM: Pushing 4-bit Quality Higher

More recent methods have narrowed the gap between 4-bit quantized and full-precision models to near-zero, even for smaller models.

**QuIP#** (**Tseng et al., 2024**) achieves high-quality 4-bit and even 2-bit quantization through two key ideas: (1) **incoherence processing** — applying random orthogonal transformations to the weight matrix before quantization, which spreads information uniformly across all entries and eliminates outlier-sensitive columns; and (2) **vector quantization** using E8 lattice codebooks, which provides better rate-distortion tradeoffs than scalar quantization. QuIP# at 2 bits per parameter matches or exceeds GPTQ at 3 bits on perplexity benchmarks for 70B-class models.

**AQLM** (Additive Quantization for Language Models; **Egiazarian et al., 2024**) extends multi-codebook quantization to LLMs. Instead of quantizing individual scalars, AQLM quantizes groups of weights as vectors, using a sum of entries from multiple learned codebooks to approximate each weight group. This additive structure captures weight correlations that per-element quantization discards. At 2 bits per parameter, AQLM achieves notably better perplexity than GPTQ at the same bit budget, particularly on smaller models (7B-13B) where quantization error has a larger relative impact.

These methods demonstrate that the "4-bit quality wall" is not fundamental — with sufficiently sophisticated quantization algorithms, even 2-bit weights can preserve model quality at scale.

### Quantization Quality Impact

The quality impact of quantization depends on model size. Larger models are more robust to quantization:

| Model Size | 8-bit Impact | 4-bit Impact | 3-bit Impact |
|-----------|-------------|-------------|-------------|
| 7B | Negligible | Minor (~1-2% degradation) | Significant |
| 13B | Negligible | Minimal (<1%) | Moderate |
| 70B | Negligible | Negligible | Minor |

This pattern holds because larger models have more redundancy — the same information is distributed across more parameters, providing resilience to individual weight perturbation.

### Activation Quantization

Quantizing activations (in addition to weights) is more challenging because activation distributions have outliers — a small number of channels with very large values that make uniform quantization lossy.

**Dettmers et al. (2022)** with LLM.int8() showed that mixed-precision decomposition works: perform most matrix multiplications in int8 but identify and handle outlier channels (those with values > 6) in fp16. This adds overhead but enables int8 inference with negligible quality loss.

**SmoothQuant** (**Xiao et al., 2023**) takes a different approach: mathematically migrate the quantization difficulty from activations to weights by applying a per-channel scaling factor. Since weights are static, they can tolerate more aggressive quantization than dynamic activations.

### FP8 and Modern Number Formats

While INT4/INT8 quantization requires post-training calibration and can introduce quality degradation, the NVIDIA H100 (and subsequent architectures) introduced native hardware support for **FP8** (8-bit floating point), enabling a simpler path to 2x throughput improvement over FP16 with minimal quality loss.

FP8 comes in two variants:

- **E4M3** (4 exponent bits, 3 mantissa bits): wider dynamic range, suitable for weights and forward-pass activations. Range: $\pm 448$, precision: $\sim$0.125.
- **E5M2** (5 exponent bits, 2 mantissa bits): even wider dynamic range, suitable for gradients during training. Range: $\pm 57344$, precision: $\sim$0.25.

For inference, E4M3 is the standard choice. The key advantage over INT8 is that FP8 preserves the floating-point representation — it handles the wide dynamic range of activations naturally, without the outlier problems that plague integer activation quantization. In practice, FP8 inference on H100 achieves nearly 2x the throughput of FP16 inference with perplexity degradation typically below 0.1%, making it the default precision for production serving on H100 hardware.

**MXFP formats** (Microscaling Floating Point), standardized by the Open Compute Project, take this further by combining block-level scaling with narrow floating-point elements. MXFP4 uses 4-bit floating-point values with a shared 8-bit scale per block of 32 elements, providing FP-style dynamic range at INT4-class memory savings. Hardware support for MXFP formats is expected in next-generation accelerators, which may make FP4 inference practical without the quality penalties of INT4 quantization.

The broader trend is clear: the industry is moving from integer quantization (which requires careful calibration to handle activation outliers) toward narrow floating-point formats (which handle dynamic range natively). For current deployments, FP8 on H100 is the simplest high-impact optimization — it requires no calibration dataset, no per-layer tuning, and delivers roughly half the memory bandwidth of FP16 with near-lossless quality.

## Speculative Decoding

**Leviathan et al. (2023)** and **Chen et al. (2023)** independently proposed speculative decoding, which accelerates autoregressive generation by using a small, fast **draft model** to propose multiple tokens that are then verified in parallel by the large **target model**.

### Algorithm

```python
def speculative_decode(target_model, draft_model, prompt, gamma=5):
    """Generate tokens using speculative decoding."""
    tokens = list(prompt)

    while not done:
        # Step 1: Draft model generates gamma candidate tokens
        draft_tokens = []
        draft_probs = []
        for _ in range(gamma):
            p = draft_model.predict(tokens + draft_tokens)
            t = sample(p)
            draft_tokens.append(t)
            draft_probs.append(p)

        # Step 2: Target model scores ALL gamma+1 positions in one forward pass
        target_probs = target_model.predict_batch(
            tokens + draft_tokens  # single forward pass for gamma+1 tokens
        )

        # Step 3: Accept/reject each draft token
        accepted = 0
        for i in range(gamma):
            # Accept with probability min(1, target_prob / draft_prob)
            ratio = target_probs[i][draft_tokens[i]] / draft_probs[i][draft_tokens[i]]
            if random.random() < min(1, ratio):
                tokens.append(draft_tokens[i])
                accepted += 1
            else:
                # Reject: sample from adjusted distribution
                adjusted = max(0, target_probs[i] - draft_probs[i])
                adjusted = adjusted / adjusted.sum()
                tokens.append(sample(adjusted))
                break

        # If all accepted, sample one more from target
        if accepted == gamma:
            tokens.append(sample(target_probs[gamma]))

    return tokens
```

### Key Properties

The acceptance-rejection scheme guarantees that the output distribution is **exactly** the same as the target model's distribution — speculative decoding introduces zero quality degradation. It is purely a latency optimization. Note that speculative decoding interacts with constrained decoding techniques (see [Article 10: Structured Output](/structured-output)): when output must conform to a grammar or JSON schema, the draft model's proposals can be further filtered by the grammar constraints, improving acceptance rates on structured output tasks.

The speedup depends on the acceptance rate, which depends on how well the draft model approximates the target model. In practice:

- **Self-speculative decoding** (using earlier layers of the same model as the draft) achieves 1.3-1.5x speedup.
- **Dedicated draft models** (e.g., Llama 7B drafting for Llama 70B) achieve 2-3x speedup.
- **Medusa** (**Cai et al., 2024**) adds multiple prediction heads to the target model itself, avoiding the need for a separate draft model.
- **EAGLE** (**Li et al., 2024**) uses a lightweight autoregressive draft head that operates on the target model's hidden states rather than token embeddings, achieving higher acceptance rates than Medusa. EAGLE-2 further improves efficiency by dynamically adjusting the draft tree structure based on confidence scores, achieving 3-4x speedup on code generation and multi-turn conversation tasks. EAGLE's key insight is that predicting at the feature level (hidden states) is easier than predicting at the token level, since features carry richer contextual information.

## Continuous Batching

Traditional static batching waits until a batch of requests is assembled, processes them all together, and returns results. This is wasteful because different requests have different generation lengths — short requests finish early but must wait for long requests in the same batch.

**Yu et al. (2022)** at Orca introduced **continuous batching** (also called iteration-level scheduling): the serving system manages a pool of in-progress requests and, at each iteration, processes all active requests together. When a request finishes, a new request can immediately take its slot.

```python
class ContinuousBatchScheduler:
    """Simplified continuous batching scheduler."""
    def __init__(self, model, max_batch_size):
        self.model = model
        self.max_batch_size = max_batch_size
        self.active_requests = []
        self.waiting_queue = []

    def step(self):
        # Fill batch with new requests if space available
        while (len(self.active_requests) < self.max_batch_size
               and self.waiting_queue):
            req = self.waiting_queue.pop(0)
            self.prefill(req)
            self.active_requests.append(req)

        if not self.active_requests:
            return

        # Run one decode step for all active requests
        next_tokens = self.model.decode_batch(
            [req.current_tokens for req in self.active_requests],
            [req.kv_cache for req in self.active_requests]
        )

        # Process results
        finished = []
        for req, token in zip(self.active_requests, next_tokens):
            req.append_token(token)
            if req.is_done():
                finished.append(req)

        for req in finished:
            self.active_requests.remove(req)
            req.complete()
```

Continuous batching increases GPU utilization from typically 30-50% to 70-90%+ and is now standard in all production serving systems (vLLM, TGI, TensorRT-LLM).

### Chunked Prefill

A refinement of continuous batching is **chunked prefill**: instead of processing the entire prompt of a new request in one step (which can cause latency spikes for long prompts), the prefill is split into chunks interleaved with decode steps for existing requests. This smooths latency at the cost of slightly slower prefill.

## Disaggregated Serving

As noted in the opening of this article, prefill and decode have fundamentally different computational profiles: prefill is compute-bound (high arithmetic intensity, benefits from FLOPS), while decode is memory-bandwidth-bound (low arithmetic intensity, benefits from memory bandwidth). Running both phases on the same GPU forces a compromise — the hardware cannot be simultaneously optimized for both workloads, and mixing prefill and decode in the same batch creates interference that degrades inter-token latency for in-flight requests.

**Disaggregated serving** addresses this by physically separating prefill and decode onto different hardware pools.

### Splitwise and DistServe

**Patel et al. (2024)** introduced Splitwise, and **Zhong et al. (2024)** independently proposed DistServe, both built on the same principle: route prefill requests to a **prefill cluster** and decode requests to a **decode cluster**, transferring the KV cache between them.

```
                    ┌─────────────────┐
   New Request ───▶ │  Prefill Cluster │ ── High-FLOPS GPUs (H100 SXM)
                    │  (compute-bound) │    Optimized for large matrix-matrix ops
                    └────────┬────────┘
                             │ KV cache transfer (over NVLink/network)
                             ▼
                    ┌─────────────────┐
                    │  Decode Cluster  │ ── High-bandwidth memory GPUs
                    │  (memory-bound)  │    Optimized for low-latency token gen
                    └────────┬────────┘
                             │
                             ▼
                    Token stream to client
```

The benefits are significant. Prefill GPUs can run at near-100% compute utilization without worrying about inter-token latency — they process one prompt after another at maximum throughput. Decode GPUs run without prefill interruptions, delivering consistent inter-token latency. DistServe reports 1.5-2x throughput improvement over co-located serving at the same latency SLOs, with particularly large gains when input prompts are long relative to outputs (common in RAG and summarization workloads).

### Hardware Implications

The separation opens the door to heterogeneous hardware. Prefill benefits from raw FLOPS — fewer, more powerful GPUs are ideal. Decode benefits from memory bandwidth per dollar — more GPUs with high HBM bandwidth, even at lower compute capability, may be cost-optimal. In practice, operators might allocate H100 SXM nodes (high NVLink bandwidth, high FLOPS) for prefill and H100 PCIe or even L40S nodes (lower cost per GB/s of memory bandwidth) for decode.

The main challenge is KV cache transfer latency. For a 70B model at fp16 with a 4K-token prompt, the KV cache is roughly 1 GB. Over a 400 Gbps (50 GB/s) inter-node network, this transfer takes ~20 ms — acceptable for TTFT targets above 100 ms, but potentially problematic for ultra-low-latency applications. See [Article 37: LLM Serving](/llm-serving) for the broader serving architecture context in which disaggregated serving operates.

## Flash Attention for Inference

**Dao et al. (2022)** designed Flash Attention primarily for training, but it is equally important for inference:

- **Prefill phase**: Flash Attention reduces memory usage from $O(n^2)$ to $O(n)$ and provides 2-4x speedup, directly enabling longer context lengths.
- **Decode phase**: Flash Decoding (**Dao et al., 2023**) optimizes the decode-specific pattern of attending a single query to many KV pairs, parallelizing across the KV sequence length dimension rather than the batch dimension.

```python
# Flash Attention conceptual workflow (actual implementation is CUDA)
# Key insight: tile the attention computation to fit in SRAM

# Instead of:
#   S = Q @ K.T          # n x n matrix in HBM (expensive)
#   P = softmax(S)       # n x n matrix in HBM
#   O = P @ V            # read n x n from HBM

# Flash Attention:
#   For each tile of Q (fits in SRAM):
#     For each tile of K, V (fits in SRAM):
#       Compute local attention (in SRAM)
#       Update running softmax statistics (online softmax)
#       Accumulate output (in SRAM)
#     Write final output tile to HBM
# Total HBM reads/writes: O(n * d) instead of O(n^2)
```

## Tensor Parallelism for Inference

For models too large to fit on a single GPU, tensor parallelism (TP) splits individual operations across multiple GPUs. Unlike pipeline parallelism (which splits by layers), TP splits the weight matrices within each layer:

### Column-Parallel and Row-Parallel Linear Layers

```python
# Column-parallel: split the weight matrix by columns
# GPU 0 gets W[:, :d//2], GPU 1 gets W[:, d//2:]
# Each GPU computes a partial output, which are concatenated

# Row-parallel: split the weight matrix by rows
# GPU 0 gets W[:d//2, :], GPU 1 gets W[d//2:, :]
# Each GPU computes a partial output, which are summed (all-reduce)
```

For the attention layer, Q/K/V projections are column-parallel (split heads across GPUs), and the output projection is row-parallel. For FFN, the first linear layer is column-parallel and the second is row-parallel. This arrangement minimizes communication: only two all-reduce operations per transformer layer.

### Communication Overhead

The all-reduce operations add latency proportional to the message size divided by the inter-GPU bandwidth. On NVLink (900 GB/s on H100), the overhead is modest. On PCIe (64 GB/s), it can dominate inference time, making TP across PCIe-connected GPUs inadvisable for latency-sensitive applications.

## Prompt Caching APIs

The prefix caching optimization described above also manifests as a user-facing API feature from major LLM providers. While the underlying mechanism is the same — reusing KV cache computations for repeated prompt prefixes — the API-level implementations expose this as a cost and latency optimization for end users.

### Provider Implementations

**Anthropic** offers explicit prompt caching with `cache_control` markers in the message structure. The developer designates which portions of the prompt (typically the system prompt and few-shot examples) should be cached. Cached input tokens receive a 90% price discount, while the initial cache write incurs a 25% surcharge. The cache has a 5-minute TTL, reset on each cache hit. This explicit design gives developers precise control over what is cached.

**OpenAI** implements automatic prompt caching for prompts longer than 1024 tokens with no code changes required. The system automatically detects repeated prefixes and caches them. Cached tokens are billed at 50% of the standard input rate. The API response includes a `cached_tokens` field, making cache hits observable.

**Google (Gemini)** provides context caching through an explicit API where you create a named cache object with a configurable TTL. Cached input tokens are discounted 75%, but there is a per-hour storage cost for maintaining the cache, making it best suited for high-volume workloads that amortize the storage overhead.

### Inference Optimization Impact

From an inference optimization perspective, prompt caching APIs provide two benefits:

1. **TTFT reduction**: The cached prefix skips the compute-bound prefill entirely. For a 4000-token system prompt, this eliminates roughly 80-200 ms of prefill time (depending on model size and hardware), delivering first tokens faster.
2. **Cost reduction**: Since the provider avoids the prefill computation for cached tokens, they pass a portion of the savings to the user. The economics are significant — a chatbot with a 3000-token system prompt making 1M requests/day saves $20,000-50,000/month on input token costs alone.

The key architectural insight is that prompt caching is a natural extension of the KV cache reuse described in the prefix caching section above. API providers are effectively running RadixAttention or equivalent systems on their serving infrastructure and exposing the savings through pricing. For a detailed cost analysis and implementation patterns, see [Article 39: Cost Optimization](/cost-optimization).

## Serving System Architecture

A production LLM serving system combines all these techniques:

```
Request Queue
    │
    ▼
┌──────────────┐
│  Scheduler   │ ── Continuous batching + chunked prefill
│  (vLLM/TGI)  │    (Optional) Disaggregated prefill/decode routing
└──────────────┘
    │
    ▼
┌──────────────┐
│  KV Cache    │ ── PagedAttention, GQA/MQA
│  Manager     │ ── Prefix caching (RadixAttention / APC)
└──────────────┘
    │
    ▼
┌──────────────┐
│  Model       │ ── Quantized weights (AWQ/GPTQ/FP8)
│  Engine      │ ── Flash Attention
│              │ ── Tensor Parallelism
│              │ ── (Optional) Speculative decoding (EAGLE/Medusa)
└──────────────┘
    │
    ▼
Response Stream (token-by-token via SSE)
```

### Key Performance Metrics

- **Time to First Token (TTFT)**: latency from request arrival to first generated token. Dominated by prefill time.
- **Time Between Tokens (TBT)**: latency between successive generated tokens. Dominated by decode speed.
- **Throughput**: total tokens generated per second across all requests. Maximized by large batch sizes and high GPU utilization.
- **Tokens per Dollar**: the economic metric that ultimately matters, combining hardware cost with throughput.

## Summary and Key Takeaways

- LLM inference has two phases: **prefill** (compute-bound, parallelizable) and **decode** (memory-bandwidth-bound, sequential). Most optimization effort targets the decode bottleneck. See [Article 01: Transformer Architecture](/transformer-architecture) for the underlying attention mechanism.
- **KV cache** management is the primary memory bottleneck for long-context inference. **PagedAttention** (vLLM) achieves near-optimal memory utilization through OS-inspired virtual memory management.
- **Prefix caching** (RadixAttention, APC) reuses KV cache blocks across requests sharing common prefixes, achieving up to 5x throughput improvement on system-prompt-heavy workloads and reducing TTFT.
- **Quantization** reduces memory and bandwidth requirements. **4-bit weight quantization** (GPTQ, AWQ) provides ~4x memory reduction with minimal quality loss, and newer methods (QuIP#, AQLM) push quality even higher at 2-4 bits. **FP8** on H100 hardware delivers 2x throughput over FP16 with near-zero quality loss and no calibration required. **GGUF** format enables efficient CPU inference.
- **Speculative decoding** uses a small draft model to propose tokens verified by the target model, achieving 2-3x speedup with mathematically guaranteed identical output distribution. **EAGLE** achieves 3-4x speedup by drafting at the hidden-state level.
- **Disaggregated serving** (Splitwise, DistServe) separates prefill and decode onto different hardware pools, enabling independent optimization of compute-bound and memory-bound phases for 1.5-2x throughput at equivalent latency SLOs.
- **Continuous batching** maximizes GPU utilization by processing requests at iteration granularity rather than batch granularity.
- **Flash Attention** reduces memory from $O(n^2)$ to $O(n)$ without approximation, enabling longer contexts and faster prefill.
- **Tensor parallelism** distributes single-layer computation across GPUs, enabling inference on models too large for single GPUs, but requires high-bandwidth interconnects (NVLink) to be latency-efficient.
- **Prompt caching APIs** from Anthropic, OpenAI, and Google expose KV cache reuse as a user-facing feature, reducing both cost (50-90% discount on cached tokens) and latency. See [Article 39: Cost Optimization](/cost-optimization) for detailed cost analysis.
- Production serving systems (vLLM, TGI, TensorRT-LLM, SGLang) combine all these techniques. Understanding their interactions — covered from the serving perspective in [Article 37: LLM Serving](/llm-serving) — is essential for optimizing the cost-performance tradeoff of deployed LLM systems.
