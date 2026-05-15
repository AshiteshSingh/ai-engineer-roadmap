# LLM Architectures Compared: GPT, Claude, Llama, Gemini, Mistral, and Beyond

The landscape of large language model architectures has diversified significantly since GPT-3 demonstrated that scaling decoder-only transformers yields powerful general-purpose language systems. While the decoder-only transformer remains the dominant paradigm (see [Article 01: Transformer Architecture](/transformer-architecture) for foundational concepts), each major model family introduces architectural innovations — from Mixture-of-Experts routing in Mixtral to grouped-query attention in Llama 2 to multimodal fusion in Gemini. More recently, reasoning-focused architectures like OpenAI's o1/o3 and DeepSeek R1 have introduced test-time compute scaling as a new dimension of model design, while state-space models like Mamba challenge the transformer's monopoly on sequence modeling. This article provides a detailed comparative analysis of the architectural choices across leading LLM families, examining why specific design decisions were made and their implications for capability, efficiency, and deployment.

## The Decoder-Only Consensus

Before comparing individual architectures, it is worth noting the remarkable convergence. Every major frontier LLM as of 2025 — GPT-4, Claude, Llama 3, Gemini, Mistral, Qwen, DeepSeek — uses a decoder-only transformer architecture with causal (left-to-right) attention masking. This convergence was not inevitable; T5 (**Raffel et al., 2020**) showed competitive results with encoder-decoder architectures, and models like UL2 (**Tay et al., 2022**) explored hybrid approaches.

The decoder-only design won for several reinforcing reasons:

1. **Simplicity of the pre-training objective**: next-token prediction requires no architectural modifications and scales naturally.
2. **Unified handling of input and output**: no need for separate encoder and decoder stacks, simplifying both training and serving infrastructure.
3. **Flexible prompting**: the same architecture naturally supports zero-shot, few-shot, and instruction-following via prompt formatting.
4. **Empirical scaling**: decoder-only models showed stronger scaling behavior on general benchmarks (**Wang et al., 2022**).

Within this consensus, however, significant architectural variation exists in the details.

## GPT Architecture Family

### GPT-3 and the Foundation

**Brown et al. (2020)** established the GPT-3 architecture as a straightforward scaled-up transformer decoder:

- 96 layers, $d_{model} = 12288$, 96 attention heads
- 175 billion parameters
- Learned absolute positional embeddings (max 2048 tokens)
- Standard Pre-Norm with LayerNorm
- GELU activation in FFN
- Alternating dense and locally banded sparse attention layers

GPT-3's architecture was deliberately conservative — the innovation was scale, not architecture. The alternating sparse attention (using banded patterns every other layer) was one of few deviations from the vanilla transformer.

### GPT-4 and Beyond

While OpenAI has not published full architectural details for GPT-4, substantial evidence from **reverse engineering efforts** and **leaked information** (confirmed by media reports) suggests GPT-4 uses a **Mixture-of-Experts** architecture:

- 8 expert modules per MoE layer, with top-2 routing
- Approximately 220B active parameters per forward pass out of ~1.8T total parameters
- 128K context window
- Multimodal (vision) capability through an adapter-based approach

The MoE design allows GPT-4 to have a very large total parameter count (capturing more knowledge) while keeping the per-token compute cost manageable — only 2 of 8 experts are active for any given token.

## Claude Architecture

Anthropic has published limited architectural details about Claude models. What is publicly known:

- **Decoder-only transformer** with proprietary architectural modifications
- **Constitutional AI** training methodology (**Bai et al., 2022**) shapes behavior but operates primarily at the training level rather than the architectural level
- **200K token context window** in Claude 3 and 3.5 families, suggesting innovations in positional encoding and attention efficiency
- **Multimodal** (vision) capabilities in Claude 3 and later versions
- **Claude 3.5 Sonnet** (2024) achieved frontier-class performance — matching or exceeding GPT-4o on major benchmarks — with what appears to be a more compute-efficient architecture, given its strong cost-performance ratio
- **Extended thinking** capabilities in Claude 3.5 Sonnet, enabling step-by-step reasoning for complex tasks

Anthropic's research publications emphasize interpretability (**Elhage et al., 2022**; **Bills et al., 2023**) and alignment methodology over architectural novelty, suggesting that Claude's advantages come primarily from training methodology and data rather than novel architecture.

## Llama Architecture Family

Meta's Llama family is the most thoroughly documented major LLM architecture, with full technical reports and open weights enabling detailed analysis.

### Llama 1 (2023)

**Touvron et al. (2023a)** introduced several architectural modifications that have since become standard in the open-source ecosystem:

- **RMSNorm** instead of LayerNorm: removes the mean-centering step, reducing computation with no quality loss (**Zhang and Sennrich, 2019**).
- **SwiGLU activation** (**Shazeer, 2020**): replaces the standard two-layer FFN with a gated variant using the Swish function, improving quality at matched parameter count.
- **Rotary Position Embedding (RoPE)** (**Su et al., 2021**): enables relative positional information through rotation of query and key vectors, with better length extrapolation than learned absolute embeddings.
- **Pre-normalization**: applying RMSNorm before each sublayer rather than after.

```python
class LlamaBlock(torch.nn.Module):
    """Simplified Llama transformer block."""
    def __init__(self, config):
        super().__init__()
        self.attention_norm = RMSNorm(config.dim)
        self.ffn_norm = RMSNorm(config.dim)
        self.attention = MultiHeadAttention(config)  # with RoPE
        self.ffn = SwiGLUFFN(config)

    def forward(self, x, freqs_cis, mask=None):
        # Pre-norm + residual for attention
        h = x + self.attention(self.attention_norm(x), freqs_cis, mask)
        # Pre-norm + residual for FFN
        out = h + self.ffn(self.ffn_norm(h))
        return out
```

The Llama 1 architecture was deliberately Chinchilla-optimal in its training data ratios: the 7B model was trained on 1T tokens and the 65B on 1.4T tokens.

### Llama 2 (2023)

**Touvron et al. (2023b)** made targeted improvements:

- **Grouped-Query Attention (GQA)** in the 34B and 70B models: instead of each attention head having its own key and value projections, heads are grouped and share KV projections. The 70B model uses 8 KV heads shared across 64 query heads. This reduces KV cache size by 8x with minimal quality impact.
- **Extended context**: 4096 tokens, up from 2048 in Llama 1.
- **More training data**: 2T tokens for all model sizes, significantly beyond Chinchilla-optimal for the smaller sizes (deliberate overtraining for inference efficiency).

```python
class GroupedQueryAttention(torch.nn.Module):
    def __init__(self, d_model, n_q_heads, n_kv_heads):
        super().__init__()
        self.n_q_heads = n_q_heads
        self.n_kv_heads = n_kv_heads
        self.n_groups = n_q_heads // n_kv_heads  # queries per KV head
        self.head_dim = d_model // n_q_heads

        self.W_q = torch.nn.Linear(d_model, n_q_heads * self.head_dim)
        self.W_k = torch.nn.Linear(d_model, n_kv_heads * self.head_dim)
        self.W_v = torch.nn.Linear(d_model, n_kv_heads * self.head_dim)
        self.W_o = torch.nn.Linear(d_model, d_model)

    def forward(self, x, freqs_cis, mask=None):
        B, L, _ = x.shape
        Q = self.W_q(x).view(B, L, self.n_q_heads, self.head_dim)
        K = self.W_k(x).view(B, L, self.n_kv_heads, self.head_dim)
        V = self.W_v(x).view(B, L, self.n_kv_heads, self.head_dim)

        # Expand KV heads to match query heads
        K = K.repeat_interleave(self.n_groups, dim=2)
        V = V.repeat_interleave(self.n_groups, dim=2)
        # ... standard attention computation
```

### Llama 3 (2024)

Llama 3 made further refinements:

- **128K vocabulary** (up from 32K), significantly improving multilingual and code tokenization efficiency.
- **8K default context** with 128K extended context via RoPE scaling.
- **15T training tokens** for the 8B model — extreme overtraining for inference efficiency.
- GQA used across all model sizes.

The Llama 3.1 405B model represents the largest open-weights dense model, trained on 15T+ tokens with extensive post-training (instruction tuning, RLHF, tool use training).

## Gemini Architecture

Google's Gemini family (**Gemini Team, 2024**) represents the most ambitious multimodal architecture:

### Native Multimodality

Unlike GPT-4 and Claude, which added vision capability through adapter modules, Gemini was designed from the ground up as a multimodal model:

- **Interleaved multimodal training**: text, images, audio, and video are processed in an interleaved fashion during pre-training, not added as a post-training capability.
- **Visual encoder**: likely based on a ViT-style architecture, producing visual tokens that are processed alongside text tokens by the main transformer.
- **Long context**: Gemini 1.5 Pro supports up to 1M tokens (later extended to 2M in experimental settings), enabled by a combination of architectural innovations.

### Mixture-of-Experts

Gemini 1.5 Pro uses a sparse Mixture-of-Experts architecture, which Google has deep experience with from the **Switch Transformer** (**Fedus et al., 2022**) and **GLaM** (**Du et al., 2022**) lineage. The MoE approach allows the model to scale total parameters (and thus knowledge capacity) while keeping the active parameter count — and therefore per-token inference cost — manageable.

### Long Context Innovations

The 1M+ token context window in Gemini 1.5 requires innovations beyond standard RoPE scaling:

- **Efficient attention patterns**: likely a combination of local and global attention, similar to approaches in **Longformer** (**Beltagy et al., 2020**) or the **Big Bird** architecture (**Zaheer et al., 2020**), both from Google.
- **RoPE modifications**: extended RoPE with potentially custom frequency schedules.
- **Ring attention**: distributing the attention computation across TPU pods using a ring topology (**Liu et al., 2023**).

## Mistral Architecture Family

Mistral AI has introduced several architectural innovations focused on inference efficiency.

### Mistral 7B

**Jiang et al. (2023)** introduced two key innovations:

#### Sliding Window Attention (SWA)

Instead of attending to all previous tokens, each attention layer attends to only a fixed window of $W$ tokens (4096 in Mistral 7B). Through stacking $L$ layers with window size $W$, the effective receptive field becomes $L \times W$, allowing information to propagate across the full sequence.

```python
def sliding_window_attention(Q, K, V, window_size):
    """Attention restricted to a local window."""
    seq_len = Q.size(-2)
    # Create sliding window mask
    mask = torch.ones(seq_len, seq_len, dtype=torch.bool)
    for i in range(seq_len):
        mask[i, max(0, i - window_size + 1):i + 1] = False
    mask = ~mask  # True where attention is allowed

    scores = torch.matmul(Q, K.transpose(-2, -1)) / (Q.size(-1) ** 0.5)
    scores.masked_fill_(~mask, float('-inf'))
    weights = F.softmax(scores, dim=-1)
    return torch.matmul(weights, V)
```

SWA reduces attention's memory and compute from $O(n^2)$ to $O(nW)$, making it linear in sequence length for fixed $W$.

#### Rolling Buffer KV Cache

With SWA, the KV cache needs to store only $W$ entries per layer rather than the full sequence, dramatically reducing memory usage during inference. This enables Mistral 7B to handle very long sequences with bounded memory.

### Mixtral 8x7B

**Jiang et al. (2024)** combined Mistral's architecture with Mixture-of-Experts:

- 8 expert FFN modules per layer, with top-2 routing
- Each expert is roughly 7B parameters; total model is ~47B parameters
- Active parameters per token: ~13B (one shared attention module + 2 expert FFNs)
- Same quality as Llama 2 70B with 5x lower inference cost

The routing mechanism uses a learned gating network:

```python
class MoELayer(torch.nn.Module):
    def __init__(self, config):
        super().__init__()
        self.experts = torch.nn.ModuleList([
            SwiGLUFFN(config) for _ in range(config.num_experts)
        ])
        self.gate = torch.nn.Linear(config.dim, config.num_experts, bias=False)
        self.top_k = config.top_k  # typically 2

    def forward(self, x):
        gate_logits = self.gate(x)  # (B, L, num_experts)
        weights, selected = torch.topk(gate_logits, self.top_k, dim=-1)
        weights = F.softmax(weights, dim=-1)

        output = torch.zeros_like(x)
        for i, expert in enumerate(self.experts):
            mask = (selected == i).any(dim=-1)
            if mask.any():
                expert_out = expert(x[mask])
                # Weight by gating score
                expert_weight = weights[mask][selected[mask] == i]
                output[mask] += expert_out * expert_weight.unsqueeze(-1)
        return output
```

### Load Balancing

A critical challenge with MoE is ensuring that tokens are distributed reasonably evenly across experts. If most tokens route to the same expert, the model degenerates to a dense model with wasted parameters. **Fedus et al. (2022)** introduced an auxiliary load-balancing loss:

$$\mathcal{L}_{balance} = \alpha \cdot N \sum_{i=1}^{N} f_i \cdot P_i$$

where $f_i$ is the fraction of tokens routed to expert $i$, $P_i$ is the average routing probability for expert $i$, and $\alpha$ is a small coefficient (typically 0.01).

## DeepSeek Architecture

**DeepSeek** has introduced some of the most significant architectural innovations in the open-source LLM space, progressing from V2 through V3 and the reasoning-focused R1.

### Multi-head Latent Attention (MLA)

DeepSeek-V2 (**DeepSeek-AI, 2024a**) introduced MLA, which compresses the KV cache by projecting keys and values into a low-dimensional latent space before storing them. This achieves KV cache compression comparable to MQA while retaining the expressiveness of MHA:

- Keys and values are jointly compressed into a low-rank representation
- At attention time, the compressed representation is projected back to full key-value pairs
- This reduces KV cache size by 4-8x compared to standard MHA

### DeepSeekMoE

DeepSeek uses a fine-grained MoE architecture with many small experts rather than fewer large ones. DeepSeek-V2 uses 160 small experts with top-6 routing (rather than Mixtral's 8 experts with top-2), achieving better expert specialization and utilization.

### DeepSeek-V3

DeepSeek-V3 (**DeepSeek-AI, 2024b**) scaled the architecture to **671 billion total parameters** with only **37 billion active per token**, making it one of the most parameter-efficient frontier models:

- Retains **MLA** from V2 for KV cache efficiency
- **256 routed experts** with top-8 routing, plus 1 shared expert always active — the shared expert captures common patterns while routed experts specialize
- **Auxiliary-loss-free load balancing**: replaces the traditional load-balancing auxiliary loss with a bias-based approach that dynamically adjusts expert selection without degrading the primary training objective
- **Multi-Token Prediction (MTP)**: the training objective predicts multiple future tokens simultaneously, improving data efficiency and representation quality (see [Article 02: Scaling Laws](/scaling-laws) for how this relates to compute-optimal training)
- **FP8 mixed-precision training**: V3 was trained using FP8 for most operations, reducing training cost to approximately $5.5M — a fraction of comparable frontier models
- **128K context window** with RoPE-based positional encoding using YaRN scaling

```python
# Simplified illustration of MLA's KV compression
class MultiHeadLatentAttention(torch.nn.Module):
    def __init__(self, d_model, n_heads, d_latent):
        super().__init__()
        self.head_dim = d_model // n_heads
        self.W_q = torch.nn.Linear(d_model, d_model)
        # Compress KV into low-dimensional latent
        self.W_kv_down = torch.nn.Linear(d_model, d_latent)
        # Decompress latent back to K and V
        self.W_k_up = torch.nn.Linear(d_latent, d_model)
        self.W_v_up = torch.nn.Linear(d_latent, d_model)

    def forward(self, x):
        Q = self.W_q(x)
        # Compress once, store the small latent in KV cache
        kv_latent = self.W_kv_down(x)  # (B, L, d_latent)
        K = self.W_k_up(kv_latent)
        V = self.W_v_up(kv_latent)
        # ... standard attention with Q, K, V
```

### DeepSeek-R1

DeepSeek-R1 (**DeepSeek-AI, 2025**) applies reinforcement learning to elicit reasoning behavior from the V3 base model (see the Reasoning Architectures section below for full treatment).

## Qwen Architecture Family

Alibaba's Qwen family has emerged as a major open-source competitor to Meta's Llama, with particularly strong multilingual and code performance.

### Qwen2 (2024)

**Qwen Team (2024a)** introduced a range of models from 0.5B to 72B parameters, building on the Llama-style architecture with several refinements:

- **GQA** across all model sizes, including the smaller variants
- **SwiGLU activation** and **RMSNorm**, consistent with the open-source consensus
- **128K context support** in the larger models via YaRN-based RoPE scaling
- **Dual-size vocabulary**: 151,646 tokens — notably larger than Llama 3's 128K — with strong CJK language coverage
- **Tied and untied embeddings**: smaller models use tied input-output embeddings for parameter efficiency; larger models untie them for expressiveness

### Qwen2.5 (2024)

**Qwen Team (2024b)** made significant improvements, establishing Qwen2.5 as a direct competitor to Llama 3.1 across all size classes:

- Models at **0.5B, 1.5B, 3B, 7B, 14B, 32B, and 72B** — the broadest size range of any open model family
- **18T pre-training tokens** for the larger variants, surpassing Llama 3.1's 15T
- **Qwen2.5-Coder** and **Qwen2.5-Math** specialized variants demonstrate that the base architecture supports effective domain specialization through data mixture and post-training
- The 72B variant matches or exceeds Llama 3.1 70B on most benchmarks while using a similar dense architecture, suggesting advantages in training data and methodology

The architectural formula is largely convergent with Llama — the differentiation comes from training data quality (particularly for multilingual and code), vocabulary design, and post-training methodology.

## Architectural Comparison Table

| Feature | GPT-4 | Claude 3.5 | Llama 3.1 | Gemini 1.5 | Mistral Large 2 | Mixtral | DeepSeek-V3 | Qwen2.5 72B |
|---------|-------|------------|-----------|------------|-----------------|---------|-------------|-------------|
| Architecture | Decoder-only | Decoder-only | Decoder-only | Decoder-only | Decoder-only | Decoder-only | Decoder-only | Decoder-only |
| MoE | Yes (rumored) | Unknown | No (dense) | Yes | No (dense) | Yes (8x) | Yes (256 experts) | No (dense) |
| Pos. Encoding | Unknown | Unknown | RoPE | RoPE variant | RoPE | RoPE | RoPE (YaRN) | RoPE (YaRN) |
| Attention | Unknown | Unknown | GQA | Unknown | GQA | GQA + SWA | MLA | GQA |
| Normalization | Unknown | Unknown | RMSNorm | Unknown | RMSNorm | RMSNorm | RMSNorm | RMSNorm |
| Activation | Unknown | Unknown | SwiGLU | Unknown | SwiGLU | SwiGLU | SwiGLU | SwiGLU |
| Max Context | 128K | 200K | 128K | 1M-2M | 128K | 32K | 128K | 128K |
| Vocab Size | ~100K | ~100K | 128K | Unknown | 32K | 32K | ~100K | 152K |
| Total Params | ~1.8T | Unknown | 405B | Unknown | 123B | ~47B | 671B | 72B |
| Active Params | ~220B | Unknown | 405B | Unknown | 123B | ~13B | 37B | 72B |

## Context Length Innovations

The race to longer context windows has driven significant architectural innovation:

### RoPE Scaling Methods

Several approaches extend RoPE beyond its training length:

- **Position interpolation** (**Chen et al., 2023**): divide position indices by a scaling factor, effectively interpolating between trained positions.
- **NTK-aware scaling**: modify the base frequency $\theta$ to redistribute information across frequency bands.
- **YaRN** (**Peng et al., 2023**): combines NTK scaling with an attention scaling factor, achieving strong extrapolation with minimal fine-tuning.

### Architectural Approaches

- **Ring Attention** (**Liu et al., 2023**): distributes the sequence across devices and computes attention in a ring topology, enabling sequences that exceed single-device memory.
- **Hierarchical attention**: combining local window attention with periodic global attention tokens.
- **Memory layers**: augmenting the transformer with explicit retrieval mechanisms for very long sequences.

## Training Methodology Differences

Architecture alone does not determine model capability. Training methodology varies significantly:

- **GPT-4**: rumored to use multi-stage training with code-heavy data mixtures and extensive RLHF.
- **Claude**: Constitutional AI (RLHF with AI feedback based on principles), emphasis on harmlessness and honesty.
- **Llama 3**: detailed training recipe published — pre-training on 15T tokens, then supervised fine-tuning, then rejection sampling and DPO.
- **Gemini**: multimodal pre-training from the start, with interleaved modality data.
- **Mixtral**: pre-training with expert load balancing, fine-tuning with expert-aware optimization.

## Reasoning Architectures

A new class of models has emerged where architecture and training are co-designed to enable explicit multi-step reasoning at inference time. Rather than producing answers in a single forward pass, these models allocate additional test-time compute to "think through" problems — a paradigm shift with significant architectural implications (see [Article 02: Scaling Laws](/scaling-laws) for how test-time compute relates to traditional scaling).

### OpenAI o1 and o3

OpenAI's o1 (**OpenAI, 2024**) introduced the concept of **internal chain-of-thought** at scale. While architectural details are proprietary, the key design principles are understood:

- The model generates an extended internal reasoning trace before producing a final answer. This trace is hidden from the user but consumes real inference tokens.
- **Verification-based rewards**: the reinforcement learning training uses outcome-based verification — checking whether the final answer is correct — rather than process-based supervision of individual reasoning steps.
- **Test-time compute scaling**: performance improves with more inference-time tokens spent on reasoning, creating a new scaling axis orthogonal to model size and training data (the traditional scaling dimensions).

o3 (2025) extends this approach with improved reasoning efficiency and reliability, reportedly achieving expert-level performance on competition mathematics and doctoral-level science benchmarks.

### DeepSeek-R1

DeepSeek-R1 (**DeepSeek-AI, 2025**) demonstrated that reasoning capabilities can emerge from pure reinforcement learning without supervised chain-of-thought data:

- **Base architecture**: uses the DeepSeek-V3 model (671B/37B MoE) as its foundation
- **Group Relative Policy Optimization (GRPO)**: instead of training a separate reward model, GRPO estimates the baseline from group scores — sampling multiple responses for each prompt and using their relative rankings as the reward signal

```python
# Simplified GRPO reward computation
def grpo_reward(prompt, policy_model, num_samples=16):
    """Generate multiple responses and compute relative rewards."""
    responses = [policy_model.generate(prompt) for _ in range(num_samples)]
    # Score each response (e.g., correctness check for math)
    scores = [verify_answer(r) for r in responses]

    # Normalize rewards relative to group
    mean_score = sum(scores) / len(scores)
    std_score = (sum((s - mean_score)**2 for s in scores) / len(scores)) ** 0.5
    advantages = [(s - mean_score) / (std_score + 1e-8) for s in scores]
    return advantages
```

- **Emergent reasoning behaviors**: without any supervised examples of chain-of-thought reasoning, the RL-trained model spontaneously develops strategies like self-verification, backtracking, and problem decomposition
- **Distillation to smaller models**: DeepSeek distilled R1's reasoning capabilities into smaller dense models (1.5B to 70B), showing that the reasoning patterns transfer effectively across architectures. The distilled Qwen2.5-32B variant matches many larger models on reasoning benchmarks.

The architectural implication is notable: reasoning capability does not require a novel architecture. It can be trained into a standard transformer through RL post-training, though the model must be large enough to support the emergent reasoning behaviors.

### Implications for Architecture Design

Reasoning models change the compute calculus. A smaller model that spends 10x more inference tokens reasoning can outperform a larger model answering in a single pass. This shifts optimization priorities toward inference efficiency (see [Article 05: Inference Optimization](/inference-optimization)) — fast token generation and efficient KV caching become even more critical when models routinely generate thousands of reasoning tokens per query.

## State-Space Model Alternatives

While the transformer dominates, **state-space models (SSMs)** offer a fundamentally different approach to sequence modeling — one that replaces attention's quadratic complexity with linear scaling.

### Mamba

**Gu and Dao (2023)** introduced Mamba, building on the Structured State Space Sequence model (S4) lineage:

- **Selective state spaces**: unlike fixed-parameter SSMs, Mamba makes the state-space parameters input-dependent, allowing the model to selectively propagate or forget information based on the current token
- **Hardware-aware implementation**: a custom CUDA kernel fuses the selective scan operation, avoiding the materializing of large intermediate states in HBM
- **Linear time complexity**: processes sequences in $O(n)$ time and $O(1)$ memory per step during generation, compared to the transformer's $O(n^2)$ attention and $O(n)$ KV cache

```python
# Conceptual selective SSM forward pass
def selective_ssm(x, A, B, C, delta):
    """
    x: input sequence (B, L, D)
    A, B, C: state-space matrices (input-dependent in Mamba)
    delta: discretization step (input-dependent)
    """
    h = torch.zeros(x.size(0), state_dim)  # hidden state
    outputs = []
    for t in range(x.size(1)):
        # Discretize continuous parameters
        A_bar = torch.exp(delta[:, t] * A[:, t])
        B_bar = delta[:, t].unsqueeze(-1) * B[:, t]
        # State update: linear recurrence
        h = A_bar * h + B_bar * x[:, t].unsqueeze(-1)
        y = (C[:, t] * h).sum(dim=-1)
        outputs.append(y)
    return torch.stack(outputs, dim=1)
```

Mamba-3B matches Transformer models of equivalent size on language modeling while being significantly faster at long-sequence inference.

### Jamba: Hybrid Mamba-Transformer

AI21's Jamba (**Lieber et al., 2024**) demonstrated that the most practical approach may be combining architectures:

- **Alternating layers**: interleaves Mamba layers with Transformer attention layers in a ratio of roughly 7:1 (Mamba to attention)
- **MoE integration**: applies Mixture-of-Experts to some of the MLP layers, creating a triple hybrid: Mamba + Transformer + MoE
- **52B total parameters, 12B active** — the MoE sparsity keeps inference costs low
- **256K context window** — the Mamba layers handle the bulk of sequential processing while the sparse attention layers provide the global context integration that pure SSMs struggle with

The hybrid approach addresses SSMs' key weakness: pure Mamba models underperform transformers on tasks requiring precise long-range retrieval (e.g., "find the specific fact mentioned 50K tokens ago"). The periodic attention layers provide this capability while Mamba layers handle the sequential flow efficiently.

### RWKV

**Peng et al. (2023)** developed RWKV (Receptance Weighted Key Value), which reformulates attention as a linear recurrence:

- Can be trained in parallel like a transformer (using the "attention-like" formulation) but runs as an RNN during inference
- **Constant memory** during generation regardless of context length
- RWKV-v6 (Eagle) scales to 14B parameters with competitive language modeling performance
- Particularly suited to deployment on memory-constrained devices where KV cache size is the binding constraint

### When to Choose SSMs Over Transformers

State-space models are preferred in specific scenarios:

- **Very long sequences** (100K+ tokens) where attention's quadratic cost dominates
- **Streaming applications** where constant-memory inference is required
- **Edge deployment** where KV cache memory budget is severely limited
- **Real-time processing** of continuous signals (audio, time-series)

For most general-purpose language tasks at moderate sequence lengths, transformers remain superior due to their stronger in-context learning and retrieval capabilities. The hybrid approach (Jamba) may represent the practical middle ground.

## Small Language Models

A parallel trend to frontier scaling is the development of highly capable small models (1B-7B parameters), optimized for on-device deployment, low-latency serving, and cost-efficient inference.

### Phi Series (Microsoft)

Microsoft's Phi family demonstrates that data quality can partially substitute for model size:

- **Phi-3 Mini (3.8B)** (**Abdin et al., 2024**): achieves performance comparable to Mixtral 8x7B (47B total) on several benchmarks through "textbook-quality" synthetic training data
- **Phi-4 (14B)**: extends the approach with improved synthetic data generation and reasoning-focused training, competitive with much larger models on math and code benchmarks
- **Architectural choices**: standard Llama-style architecture (RMSNorm, SwiGLU, RoPE, GQA) — the innovation is in training data curation, not architecture
- **Long context**: Phi-3 supports 128K context via LongRoPE, a position encoding extension that combines RoPE scaling with progressive extension during fine-tuning

### Gemma 2 (Google)

**Gemma Team (2024)** introduced architectural optimizations specifically targeting the small-model regime:

- **2B and 9B variants** designed for on-device and efficient cloud deployment
- **Alternating local-global attention**: even-numbered layers use full attention while odd-numbered layers use sliding window attention (4096 tokens), reducing compute while maintaining quality
- **Logit soft-capping**: clips the pre-softmax logits to prevent attention weight concentration, improving training stability at smaller scales
- **Knowledge distillation**: the smaller models are trained with a distillation objective from larger Gemma models, transferring capability more efficiently than training from scratch

### Llama 3.2 Small Variants

Meta's Llama 3.2 (**Meta AI, 2024**) includes **1B and 3B** parameter models designed explicitly for edge deployment:

- **Pruning and distillation from Llama 3.1 8B**: rather than training from scratch, the small models are derived from the larger model through structured pruning followed by knowledge distillation
- **Shared embedding tying**: input and output embeddings are tied to reduce parameter count — a technique that larger models avoid due to its quality ceiling
- **Reduced GQA groups**: fewer KV heads than the 8B model, aggressively compressing the KV cache for memory-constrained deployment
- Targets mobile and edge devices with 4-bit quantization support (see [Article 05: Inference Optimization](/inference-optimization) for quantization techniques)

### Qwen2.5 Small Variants

Qwen2.5's **0.5B, 1.5B, and 3B** models round out the small-model landscape:

- The 0.5B model is one of the smallest instruction-following models that remains genuinely useful for simple tasks
- All variants share the same architectural template as the 72B model, just with fewer layers and smaller hidden dimensions
- The large vocabulary (152K tokens) is maintained even at small scales, preserving multilingual capability

### Architectural Lessons from Small Models

The small model landscape reveals an important insight: below ~7B parameters, **training data quality and distillation methodology matter more than architectural innovations**. All competitive small models use essentially the same Llama-derived architecture. The differentiation comes from:

1. **Data curation**: Phi's synthetic "textbook" data, Gemma's web-filtered data
2. **Distillation**: learning from larger models is consistently more efficient than training from scratch
3. **Quantization-aware design**: architectures chosen to degrade gracefully under 4-bit and 8-bit quantization

## Summary and Key Takeaways

- All frontier LLMs use **decoder-only transformer** architectures (see [Article 01](/transformer-architecture)), converging on this design for its simplicity and scaling properties.
- **Mixture-of-Experts** has emerged as the dominant approach for frontier models (GPT-4, Gemini, Mixtral, DeepSeek-V3), offering more total parameters at lower per-token compute cost. DeepSeek-V3's 671B/37B design pushes this to an extreme.
- **Grouped-Query Attention** (Llama 2+, Mistral, Qwen) and **Multi-head Latent Attention** (DeepSeek) address the KV cache memory bottleneck during inference (see [Article 05](/inference-optimization) for deployment implications).
- **Sliding Window Attention** (Mistral) provides linear-cost attention for long sequences when combined with layer stacking.
- The **Llama architecture** (RMSNorm, SwiGLU, RoPE, GQA) has become the de facto standard for open-source models, adopted by Qwen, Mistral, and others.
- **Reasoning architectures** (o1/o3, DeepSeek-R1) introduce test-time compute as a new scaling axis — models that "think longer" can outperform larger models that answer immediately, shifting optimization priorities toward inference efficiency.
- **State-space models** (Mamba, RWKV) and **hybrid architectures** (Jamba) offer linear-scaling alternatives for long sequences and memory-constrained deployment, though transformers retain advantages in in-context learning.
- **Small language models** (Phi-3/4, Gemma 2, Llama 3.2 1B/3B, Qwen2.5 small) demonstrate that data quality and distillation matter more than architecture below ~7B parameters.
- **Context length** innovations (RoPE scaling, ring attention) have pushed from 2K to 1M+ tokens, but effective utilization of very long contexts remains an active research challenge.
- Architectural differences between frontier models are increasingly secondary to differences in **training data, training methodology, and post-training** (RLHF, RL for reasoning, instruction tuning, tool use training). The convergence of open-source architectures around the Llama template underscores this point.
- For practitioners, understanding these architectural choices is essential for selecting the right model for a given deployment scenario: dense vs. MoE tradeoffs, context length requirements, reasoning vs. latency needs, and inference efficiency constraints.
