# LoRA, QLoRA & Adapter Methods: Parameter-Efficient Fine-tuning

Parameter-efficient fine-tuning (PEFT) methods have fundamentally changed the economics of adapting large language models, reducing trainable parameters by 99%+ while preserving most of the quality of full fine-tuning. This article provides a deep technical treatment of LoRA, QLoRA, and the broader family of adapter methods, covering the mathematical foundations, practical rank selection heuristics, and implementation details using the Hugging Face PEFT library. We also examine emerging methods like DoRA and IA3 that push the Pareto frontier of efficiency versus quality.

## TL;DR

- **LoRA** inserts trainable low-rank matrices alongside frozen base weights, reducing trainable parameters by 100-1000x. Rank 8-16 covers most use cases.
- **QLoRA** adds 4-bit NF4 quantization of the base model, enabling 70B model fine-tuning on a single 48GB GPU with minimal quality loss.
- LoRA adapters can be merged into the base model after training, adding zero inference latency; multiple adapters can be swapped at serving time.
- **vLLM** supports multi-LoRA serving natively: one base model in GPU memory, hundreds of adapters loaded on demand.
- For 2024-2025, the practical default is QLoRA with rank 16, applied to all linear layers, using `paged_adamw_8bit`.

## The Motivation for Parameter Efficiency

Full fine-tuning of a 70B parameter model requires updating 140GB of parameters in fp16, demanding multiple high-end GPUs and creating a separate copy of the entire model for each task. For organizations fine-tuning models for dozens of tasks or domains, this becomes prohibitively expensive in both compute and storage.

Parameter-efficient methods address this by modifying only a small subset of parameters (or adding a small number of new parameters) while keeping the base model frozen. The key insight is that the weight updates during fine-tuning occupy a much lower-dimensional subspace than the full parameter space, meaning we can represent these updates compactly without significant loss of expressiveness.

## LoRA: Low-Rank Adaptation

### Mathematical Foundation

LoRA, introduced by Hu et al. (2021) in "LoRA: Low-Rank Adaptation of Large Language Models," is built on the hypothesis that the weight updates during fine-tuning have low intrinsic rank. For a pre-trained weight matrix $W_0 \in \mathbb{R}^{d \times k}$, LoRA decomposes the update as:

$$W = W_0 + \Delta W = W_0 + BA$$

where $B \in \mathbb{R}^{d \times r}$ and $A \in \mathbb{R}^{r \times k}$, with rank $r \ll \min(d, k)$.

During the forward pass, for input $x$:

$$h = W_0 x + \Delta W x = W_0 x + BAx$$

The key properties of this decomposition:

1. **$A$ is initialized with random Gaussian values** and **$B$ is initialized to zero**, so $\Delta W = BA = 0$ at the start of training. The model begins with exactly the pre-trained behavior.
2. **$\Delta W$ is scaled by $\alpha / r$**, where $\alpha$ is a constant. This scaling factor controls the magnitude of the adaptation relative to the original weights.
3. **No additional inference latency**: After training, the adapter weights can be merged into the base model: $W_{merged} = W_0 + \frac{\alpha}{r} BA$. The merged model has the same architecture and inference cost as the original.

> **Note:** The zero initialization of $B$ is essential -- it ensures the model starts from exactly the pre-trained checkpoint, making LoRA training more stable than inserting randomly initialized weight matrices.

### Why Low Rank Works

Aghajanyan et al. (2021) provided theoretical motivation in "Intrinsic Dimensionality Explains the Effectiveness of Language Model Fine-Tuning," demonstrating that pre-trained models have a low intrinsic dimensionality for fine-tuning. They showed that fine-tuning in a random low-dimensional subspace of 200-800 dimensions could recover 90%+ of full fine-tuning performance, suggesting that the "useful" updates are indeed low-rank.

The intuition is that pre-training already places the model near a good solution for most tasks. Fine-tuning only needs to make relatively small, structured adjustments rather than exploring the full parameter space.

### Rank Selection

The rank $r$ controls the tradeoff between expressiveness and efficiency:

| Rank | Trainable Params (7B model) | Typical Use Case |
|------|---------------------------|-----------------|
| 4 | ~4M (0.06%) | Simple classification, style transfer |
| 8 | ~8M (0.11%) | General instruction tuning |
| 16 | ~16M (0.23%) | Complex domain adaptation |
| 32 | ~33M (0.47%) | Demanding tasks, large datasets |
| 64 | ~67M (0.96%) | Approaching diminishing returns |
| 256 | ~268M (3.8%) | Near full fine-tuning quality |

Research and practical experience suggest:
- **r=8 to r=16** covers most use cases effectively
- Higher ranks help when the task requires substantial behavioral change
- Diminishing returns typically set in above r=64
- The optimal rank depends on the gap between pre-training distribution and target distribution

> **Tip:** When in doubt, start with r=16. If quality is insufficient, try r=32 before adding complexity elsewhere. If you're memory-constrained, r=8 with `lora_alpha=16` is a solid fallback.

### Which Layers to Adapt

The original LoRA paper applied adapters only to attention weight matrices ($W_q$, $W_v$). Subsequent work has shown that applying LoRA to all linear layers (including $W_k$, $W_o$, and MLP layers) generally improves results:

```python
from peft import LoraConfig, get_peft_model

lora_config = LoraConfig(
    r=16,
    lora_alpha=32,
    # Apply to all linear layers in the transformer
    target_modules=[
        "q_proj", "k_proj", "v_proj", "o_proj",
        "gate_proj", "up_proj", "down_proj"
    ],
    lora_dropout=0.05,
    bias="none",
    task_type="CAUSAL_LM"
)

model = get_peft_model(base_model, lora_config)
model.print_trainable_parameters()
# Output: trainable params: 16,777,216 || all params: 6,754,332,672 || trainable%: 0.2484
```

### The Alpha/Rank Ratio

The scaling factor $\alpha / r$ is critical and often misunderstood. When $\alpha = r$, the scaling is 1.0 and the LoRA update has the same magnitude as if the model were trained directly. Common practices:

- Set $\alpha = 2r$ (so scaling = 2.0) when using lower ranks, to compensate for the limited expressiveness
- Set $\alpha = r$ (scaling = 1.0) as a safe default
- When changing rank, adjust alpha proportionally to maintain consistent update magnitude

## QLoRA: Quantized LoRA

### The QLoRA Innovation

QLoRA, introduced by Dettmers et al. (2023) in "QLoRA: Efficient Finetuning of Quantized Language Models," combines LoRA with aggressive quantization of the base model, enabling fine-tuning of a 65B parameter model on a single 48GB GPU.

The three key innovations:

| Innovation | What it does | Memory impact |
|------------|-------------|---------------|
| 4-bit NormalFloat (NF4) | Quantization levels placed at equal-probability intervals of the normal distribution (matching how weights are distributed) | ~4x base model compression |
| Double quantization | Quantizes the 32-bit quantization constants themselves to 8-bit | Reduces overhead from 0.5 to 0.127 bits/parameter |
| Paged optimizers | Uses NVIDIA unified memory to page optimizer states to CPU during gradient checkpointing spikes | Prevents OOM on memory spikes |

```python
from transformers import BitsAndBytesConfig, AutoModelForCausalLM

bnb_config = BitsAndBytesConfig(
    load_in_4bit=True,
    bnb_4bit_quant_type="nf4",
    bnb_4bit_compute_dtype=torch.bfloat16,
    bnb_4bit_use_double_quant=True,
)

model = AutoModelForCausalLM.from_pretrained(
    "meta-llama/Llama-3-70B",
    quantization_config=bnb_config,
    device_map="auto",
)

# Apply LoRA on top of the quantized model
model = get_peft_model(model, lora_config)
```

### Memory Footprint Comparison

For a 70B parameter model:

| Method | GPU Memory | Trainable Params |
|--------|-----------|-----------------|
| Full fine-tuning (fp16) | ~140 GB (multi-GPU) | 70B (100%) |
| LoRA (fp16 base) | ~140 GB + adapters | ~67M (0.1%) |
| QLoRA (4-bit base) | ~35 GB | ~67M (0.1%) |
| QLoRA (4-bit) + gradient checkpointing | ~24 GB | ~67M (0.1%) |

QLoRA demonstrated that the quality gap between 4-bit quantized LoRA training and full 16-bit fine-tuning is minimal, often within 1-2 points on standard benchmarks.

## Adapter Layers

Before LoRA, Houlsby et al. (2019) introduced adapter layers in "Parameter-Efficient Transfer Learning for NLP." Adapters insert small bottleneck modules between existing transformer layers:

```text
Input -> LayerNorm -> Self-Attention -> Residual ->
  LayerNorm -> FFN -> Residual -> Adapter -> Output

Adapter architecture:
  Input -> Down-projection (d -> r) -> NonLinearity ->
  Up-projection (r -> d) -> Residual -> Output
```

The adapter has $2 \times d \times r + r + d$ parameters (two projection matrices plus biases). With $r \ll d$, this is a small fraction of the total model parameters.

Key differences from LoRA:

| Dimension | Adapters | LoRA |
|-----------|----------|------|
| Inference latency | Added (sequential computation) | None (can merge into base weights) |
| Requires adapter at inference | Yes | No (after merging) |
| Modifies | Model architecture | Weight values only |
| Performance | Competitive on some tasks | Generally preferred |

## Prefix Tuning and Prompt Tuning

### Prefix Tuning

Li and Liang (2021) proposed prefix tuning, which prepends trainable continuous vectors to the key and value matrices in each attention layer. Rather than modifying model weights, prefix tuning learns a set of "virtual tokens" that steer the model's behavior:

```python
from peft import PrefixTuningConfig

prefix_config = PrefixTuningConfig(
    task_type="CAUSAL_LM",
    num_virtual_tokens=20,  # Number of prefix tokens per layer
    prefix_projection=True,  # Use MLP to parameterize prefix
)
```

Prefix tuning trains approximately $L \times 2 \times n_{prefix} \times d_{model}$ parameters, where $L$ is the number of layers. For a 7B model with 20 prefix tokens, this is roughly 5M parameters.

### Prompt Tuning

Lester et al. (2021) simplified prefix tuning to "prompt tuning," which only prepends trainable embeddings to the input layer (not every layer). This is even more parameter-efficient but generally less expressive. Prompt tuning scales better with model size: on sufficiently large models (10B+), prompt tuning approaches fine-tuning quality.

## IA3: Few-Parameter Fine-tuning

IA3 (Infused Adapter by Inhibiting and Amplifying Inner Activations), introduced by Liu et al. (2022), takes parameter efficiency to an extreme. Instead of adding new weight matrices, IA3 learns three vectors that rescale:
1. Keys in self-attention
2. Values in self-attention
3. The intermediate activation in the position-wise feed-forward network

```python
from peft import IA3Config

ia3_config = IA3Config(
    task_type="CAUSAL_LM",
    target_modules=["k_proj", "v_proj", "down_proj"],
    feedforward_modules=["down_proj"],
)
```

IA3 trains roughly 10x fewer parameters than LoRA with r=8, at the cost of somewhat reduced expressiveness. It excels in few-shot settings where overfitting is a concern.

## DoRA: Weight-Decomposed Low-Rank Adaptation

DoRA (Liu et al., 2024) decomposes pre-trained weights into magnitude and direction components, then applies LoRA only to the directional component:

$$W = m \cdot \frac{W_0 + BA}{||W_0 + BA||_c}$$

where $m$ is a trainable magnitude vector and the fraction represents the normalized directional component. The insight is that full fine-tuning tends to change the direction of weight vectors more than their magnitude, and LoRA's coupled updates to both can be suboptimal.

DoRA consistently outperforms LoRA by 1-3% on various benchmarks at the same rank, with only a marginal increase in trainable parameters (the magnitude vector $m$).

## Merging Adapters

A powerful property of LoRA is that multiple adapters can be combined:

### Weight Merging

After training, LoRA weights can be merged into the base model:

```python
# Merge LoRA weights into base model
merged_model = model.merge_and_unload()

# Save the merged model (same format as original)
merged_model.save_pretrained("merged_model")
```

### Multi-Task Adapter Composition

Multiple LoRA adapters trained for different tasks can be combined at inference time:

```python
from peft import PeftModel

# Load base model with first adapter
model = PeftModel.from_pretrained(base_model, "adapter_task_a")

# Load additional adapters
model.load_adapter("adapter_task_b", adapter_name="task_b")

# Switch between adapters
model.set_adapter("task_b")

# Or combine adapters with weighted averaging
# (requires manual implementation or tools like mergekit)
```

### Adapter Arithmetic

Adapters can be linearly combined: $\Delta W_{combined} = \alpha_1 \Delta W_1 + \alpha_2 \Delta W_2$. This enables:
- **Task composition**: Combine a "coding" adapter with a "formal tone" adapter
- **Interpolation**: Blend between two behavioral extremes
- **Negation**: Subtract an adapter to remove learned behaviors

Research by Zhang et al. (2023) and Yadav et al. (2023) on model merging methods (TIES, DARE) has shown that resolving sign conflicts and pruning small-magnitude updates before merging significantly improves results.

## Practical Implementation Guide

### Full QLoRA Training Pipeline

```python
import torch
from transformers import (
    AutoModelForCausalLM, AutoTokenizer,
    BitsAndBytesConfig, TrainingArguments
)
from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training
from trl import SFTTrainer

# 1. Load quantized base model
bnb_config = BitsAndBytesConfig(
    load_in_4bit=True,
    bnb_4bit_quant_type="nf4",
    bnb_4bit_compute_dtype=torch.bfloat16,
    bnb_4bit_use_double_quant=True,
)

model = AutoModelForCausalLM.from_pretrained(
    "meta-llama/Llama-3-8B",
    quantization_config=bnb_config,
    device_map="auto",
    attn_implementation="flash_attention_2",
)
tokenizer = AutoTokenizer.from_pretrained("meta-llama/Llama-3-8B")
tokenizer.pad_token = tokenizer.eos_token

# 2. Prepare model for k-bit training
model = prepare_model_for_kbit_training(model)

# 3. Configure LoRA
lora_config = LoraConfig(
    r=16,
    lora_alpha=32,
    target_modules="all-linear",
    lora_dropout=0.05,
    bias="none",
    task_type="CAUSAL_LM",
)
model = get_peft_model(model, lora_config)

# 4. Training configuration
training_args = TrainingArguments(
    output_dir="./qlora-output",
    num_train_epochs=3,
    per_device_train_batch_size=4,
    gradient_accumulation_steps=8,
    learning_rate=2e-4,  # Higher LR than full FT since fewer params
    lr_scheduler_type="cosine",
    warmup_ratio=0.06,
    fp16=False,
    bf16=True,
    optim="paged_adamw_8bit",
    logging_steps=25,
    save_strategy="steps",
    save_steps=200,
    evaluation_strategy="steps",
    eval_steps=200,
    gradient_checkpointing=True,
    gradient_checkpointing_kwargs={"use_reentrant": False},
    max_grad_norm=0.3,
    group_by_length=True,
)

# 5. Train with SFTTrainer
trainer = SFTTrainer(
    model=model,
    args=training_args,
    train_dataset=train_dataset,
    eval_dataset=eval_dataset,
    tokenizer=tokenizer,
    max_seq_length=2048,
    dataset_text_field="text",
    packing=True,  # Pack multiple examples into single sequences
)

trainer.train()

# 6. Save adapter weights (small! ~30MB for r=16)
trainer.save_model("./qlora-adapter")
```

### Common Pitfalls

1. **Learning rate too low**: LoRA adapters can tolerate higher learning rates (1e-4 to 3e-4) than full fine-tuning because fewer parameters mean less risk of catastrophic interference.
2. **Forgetting to prepare for k-bit training**: The `prepare_model_for_kbit_training()` call enables gradient checkpointing and casts layer norms to fp32, both essential for stable QLoRA training.
3. **Not targeting enough layers**: Applying LoRA only to attention projections (the original paper's default) leaves performance on the table. Use `target_modules="all-linear"` for best results.
4. **Ignoring packing**: For instruction tuning with variable-length examples, packing multiple examples into single sequences significantly improves GPU utilization.

> **Note:** If you skip `prepare_model_for_kbit_training()` with a quantized base model, you may see NaN losses or unstable training -- the error won't always be obvious at startup.

## Production Serving of LoRA Adapters

A single base model can serve hundreds of distinct LoRA adapters simultaneously, making multi-tenant and multi-task deployments economically viable. This is one of LoRA's most consequential properties: instead of deploying N separate fine-tuned models, you deploy one base model plus N small adapter weight sets.

### vLLM Multi-LoRA Serving

vLLM supports multi-LoRA serving natively. The base model weights remain in GPU memory once, and individual LoRA adapters (typically 10-50MB each) are loaded alongside it. During inference, each request specifies which adapter to apply, and vLLM fuses the LoRA computation into the attention and MLP kernels without materializing the full merged weight matrix:

```python
from vllm import LLM, SamplingParams
from vllm.lora.request import LoRARequest

llm = LLM(
    model="meta-llama/Llama-3-8B",
    enable_lora=True,
    max_loras=16,          # Number of adapters loaded simultaneously
    max_lora_rank=64,      # Maximum rank across all adapters
)

# Each request can target a different adapter
output = llm.generate(
    "Summarize this contract clause:",
    SamplingParams(temperature=0.1, max_tokens=512),
    lora_request=LoRARequest("legal-adapter", 1, "/adapters/legal-lora"),
)
```

The `max_loras` parameter controls how many adapters are resident in GPU memory at once. When a request arrives for an adapter not currently loaded, vLLM evicts the least recently used adapter and loads the new one.

For workloads with a long tail of infrequently used adapters, this eviction overhead is the primary latency concern -- individual adapter swaps take 10-50ms depending on rank and the number of target modules, which is negligible per-request but can accumulate under adapter thrashing.

### S-LoRA: Scalable Multi-Adapter Serving

S-LoRA (Sheng et al., 2023) extends multi-LoRA serving to thousands of concurrent adapters. The key innovations are:

- A unified paging mechanism that stores adapter weights in a shared memory pool (analogous to PagedAttention for KV caches).
- Custom CUDA kernels that batch heterogeneous LoRA computations across requests with different adapters and ranks.

S-LoRA demonstrated serving up to 2,000 adapters on a single GPU with minimal throughput degradation compared to serving the base model alone, provided that requests are batched effectively.

### Latency Considerations

Adding LoRA computation to inference introduces a small overhead compared to the merged-weight baseline. In practice, this overhead is 2-5% of total latency for typical ranks (r=8 to r=32) because the LoRA matmuls are small relative to the base model computation. The overhead scales linearly with rank, so serving r=256 adapters is noticeably slower than r=16.

For latency-critical paths where even 2% matters, merging the adapter into the base weights and serving as a standalone model remains an option -- the tradeoff is GPU memory (one full model copy per adapter) versus a small latency tax (one shared base model). See [LLM Serving: API Design, Batching & Streaming](/llm-serving) for more on serving architecture decisions.

## Training Acceleration

### Unsloth

Unsloth has emerged as the go-to library for fast LoRA and QLoRA training, particularly on single-GPU setups. It achieves 2-5x training speedups over standard Hugging Face workflows through several techniques: custom Triton kernels for LoRA-fused forward and backward passes, manual backpropagation that avoids autograd overhead, and intelligent memory management that reduces peak VRAM by 50-70%.

```python
from unsloth import FastLanguageModel

model, tokenizer = FastLanguageModel.from_pretrained(
    model_name="meta-llama/Llama-3-8B",
    max_seq_length=4096,
    load_in_4bit=True,
)

model = FastLanguageModel.get_peft_model(
    model,
    r=16,
    lora_alpha=32,
    target_modules=[
        "q_proj", "k_proj", "v_proj", "o_proj",
        "gate_proj", "up_proj", "down_proj"
    ],
    lora_dropout=0,  # Unsloth recommends 0 dropout for speed
)
```

Unsloth's key advantage is that it requires no changes to the training loop itself -- it is a drop-in replacement for the model loading step, and the resulting model is fully compatible with the Hugging Face `Trainer` and `SFTTrainer` APIs.

### Flash Attention Integration

Flash Attention (Dao et al., 2022; Dao, 2023) is effectively mandatory for modern LoRA training. By fusing the attention computation into a single CUDA kernel and avoiding materialization of the full $N \times N$ attention matrix, Flash Attention reduces the memory complexity of attention from $O(N^2)$ to $O(N)$ and improves wall-clock speed by 2-4x. This is orthogonal to LoRA itself but dramatically affects what sequence lengths and batch sizes are feasible during fine-tuning. Most model loading paths now default to Flash Attention 2 via `attn_implementation="flash_attention_2"`, as shown in the QLoRA pipeline example above.

### Gradient Checkpointing Trade-offs

Gradient checkpointing (activation recomputation) trades compute for memory by discarding intermediate activations during the forward pass and recomputing them during the backward pass. For QLoRA training, this typically reduces peak memory by 30-50%, enough to double the effective batch size or train on a model that would otherwise not fit. The cost is a ~30% increase in training time due to the recomputation. The trade-off is almost always worthwhile for QLoRA because the bottleneck is GPU memory, not training speed. However, for LoRA on fp16 base models where memory is less constrained, disabling gradient checkpointing and using larger batch sizes can be faster end-to-end. See [Fine-tuning Fundamentals](/fine-tuning-fundamentals) for broader coverage of mixed-precision and distributed training strategies.

## Emerging PEFT Methods

The LoRA family continues to evolve. Several 2024 innovations push the efficiency-quality frontier further.

### LoRA+ (Hayou et al., 2024)

Standard LoRA uses the same learning rate for both the $A$ and $B$ matrices, but LoRA+ argues this is suboptimal. Because $A$ is initialized with random Gaussian values and $B$ is initialized to zero, their gradient dynamics differ substantially during early training. LoRA+ assigns a higher learning rate to the $B$ matrix (typically 2-8x the $A$ learning rate), which improves convergence speed by 1.5-2x and slightly improves final quality. The implementation is straightforward -- it requires only splitting the adapter parameters into two optimizer groups with different learning rates.

### GaLore (Zhao et al., 2024)

Gradient Low-Rank Projection (GaLore) takes a different approach entirely. Instead of adding low-rank adapter matrices, GaLore projects the full gradient matrix onto a low-rank subspace during training, reducing optimizer state memory without modifying the model architecture. This means the trained model is a standard full-parameter model, not a base-plus-adapter pair.

GaLore can train a 7B model with the memory footprint of a 1B model, and unlike LoRA, it does not impose a structural constraint on the weight update. The downside is that GaLore requires periodic SVD recomputation to update the projection basis, adding overhead every few hundred steps. GaLore is most compelling for pre-training or continued pre-training scenarios where LoRA's low-rank constraint is too restrictive. For connections between GaLore and continued pre-training, see [Continual Learning: Catastrophic Forgetting & Knowledge Retention](/continual-learning).

### rsLoRA (Kalajdzievski, 2024)

rsLoRA addresses a subtle scaling issue in standard LoRA. The original $\alpha / r$ scaling factor means that increasing rank actually decreases the per-element magnitude of the update, which is counterintuitive and can require re-tuning the learning rate when experimenting with different ranks. rsLoRA replaces the scaling with $\alpha / \sqrt{r}$, which stabilizes training dynamics across ranks and makes rank selection less sensitive to learning rate. This is a small but meaningful quality-of-life improvement for practitioners running rank sweeps.

## GGUF Deployment Path

For edge deployment, local inference, and cost-sensitive serving, the llama.cpp ecosystem provides an alternative to GPU-based serving stacks. The typical workflow is to merge LoRA adapters into the base model and then quantize the merged result into GGUF format for serving via llama.cpp, ollama, or LM Studio.

### Merge and Quantize Pipeline

```bash
# 1. Merge LoRA adapter into base model (produces full-size fp16 model)
python -m peft.merge_and_unload \
    --base_model meta-llama/Llama-3-8B \
    --lora_adapter ./qlora-adapter \
    --output_dir ./merged-model

# 2. Convert to GGUF format
python llama.cpp/convert_hf_to_gguf.py ./merged-model \
    --outfile merged-model-f16.gguf --outtype f16

# 3. Quantize to desired precision
llama.cpp/build/bin/llama-quantize \
    merged-model-f16.gguf \
    merged-model-Q4_K_M.gguf Q4_K_M
```

The `Q4_K_M` quantization scheme is a common choice, offering roughly 4.5 bits per weight with mixed precision for attention layers. A 7B model quantized this way occupies approximately 4.5GB and runs comfortably on consumer hardware with no GPU. For a 70B model, `Q4_K_M` produces a ~40GB file that requires 48GB+ of system RAM but no GPU.

### Quantization Format Selection

The choice of GGUF quantization level involves a quality-size tradeoff that mirrors the decisions discussed in [Distillation & Model Compression](/distillation-compression):

| Format | Bits/Weight | 7B Model Size | Quality Impact |
|--------|------------|---------------|----------------|
| Q2_K | ~2.5 | ~2.5 GB | Noticeable degradation |
| Q4_K_M | ~4.5 | ~4.5 GB | Minimal for most tasks |
| Q5_K_M | ~5.5 | ~5.5 GB | Near-fp16 quality |
| Q6_K | ~6.5 | ~6.5 GB | Negligible quality loss |
| Q8_0 | 8.0 | ~8.0 GB | Effectively lossless |

> **Note:** Quantizing after merging the LoRA adapter produces better results than quantizing the base model and applying the adapter at inference time. The merge-then-quantize approach avoids compounding quantization error with LoRA approximation error, and the resulting single-file model is simpler to deploy.

For workloads where multiple adapters are needed at the GGUF level, llama.cpp also supports loading LoRA adapters at runtime on top of a quantized base model, applying the fp16 adapter math on the dequantized weights during inference. This avoids creating separate merged models for each adapter but does add latency overhead.

## Summary and Key Takeaways

- **LoRA** decomposes weight updates into low-rank matrices ($\Delta W = BA$), reducing trainable parameters by 100-1000x while maintaining 95-99% of full fine-tuning quality. Rank 8-16 covers most use cases.
- **QLoRA** combines LoRA with 4-bit NF4 quantization of the base model, enabling 70B model fine-tuning on a single 48GB GPU. The quality cost of quantization is minimal.
- **Adapter layers** insert bottleneck modules between transformer layers. Effective but add inference latency, unlike LoRA which can be merged into base weights.
- **Prefix tuning and prompt tuning** learn virtual tokens rather than modifying weights. Simpler but generally less expressive than LoRA.
- **IA3** rescales activations with learned vectors, achieving extreme parameter efficiency at some quality cost.
- **DoRA** decomposes weights into magnitude and direction, applying LoRA only to direction, consistently outperforming standard LoRA.
- **Adapter merging** enables composing multiple task-specific adaptations, with methods like TIES and DARE improving merge quality.
- **Multi-LoRA serving** via vLLM or S-LoRA enables hundreds of adapters on a single base model, with 2-5% latency overhead at typical ranks.
- **Training acceleration** through Unsloth, Flash Attention, and gradient checkpointing makes QLoRA training 2-5x faster and more memory-efficient.
- **Emerging methods** like LoRA+, GaLore, and rsLoRA refine the training dynamics and expand the applicability of parameter-efficient approaches.
- **GGUF deployment** provides a path from LoRA-trained models to efficient CPU and edge inference via the llama.cpp ecosystem.
- For practical fine-tuning in 2024-2025, **QLoRA with rank 16, applied to all linear layers, using `paged_adamw_8bit`** is the default recommendation. Adjust rank and alpha based on task complexity and available data.

## Key Takeaways

- **Default to QLoRA for 7B+ models on a single GPU.** 4-bit NF4 + LoRA r=16 on all linear layers fits a 70B model on one 48GB GPU and closes 95-99% of the quality gap versus full fine-tuning.
- **Always call `prepare_model_for_kbit_training()` before applying LoRA to a quantized model.** Skipping it causes subtle instabilities (NaN losses, poor convergence) that are hard to diagnose after the fact.
- **Set `target_modules="all-linear"` rather than attention-only.** Including MLP layers in the LoRA target set consistently improves results at minimal extra memory cost.
- **Use higher learning rates than full fine-tuning.** LoRA adapters typically train well at 1e-4 to 3e-4 -- 5-10x higher than the 2e-5 default for full fine-tuning.
- **Plan your serving architecture before training.** If you need multi-adapter serving, use vLLM with `enable_lora=True` and size `max_lora_rank` to match your trained adapters. Merging adapters before serving eliminates the latency overhead but requires one GPU copy per adapter.
- **Merge before GGUF quantization.** Merge LoRA weights into the base model first, then quantize to GGUF. This avoids compounding quantization error with LoRA approximation error.

## Related Articles

- [Fine-tuning Fundamentals: Full, Freeze & Transfer Learning](/fine-tuning-fundamentals) -- full fine-tuning mechanics, SFT, learning rate scheduling, and when to fine-tune versus prompt engineer.
- [Continual Learning: Catastrophic Forgetting & Knowledge Retention](/continual-learning) -- how to update models without destroying existing capabilities, directly relevant when applying LoRA for domain adaptation.
- [Distillation & Model Compression: Pruning, Quantization & Student Models](/distillation-compression) -- GPTQ, AWQ, and post-training quantization techniques that complement the GGUF deployment path discussed above.
- [LLM Serving: API Design, Batching & Streaming](/llm-serving) -- serving architecture decisions including continuous batching and PagedAttention, which interact directly with multi-LoRA serving strategies.
