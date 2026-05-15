# Distillation & Model Compression: Pruning, Quantization & Student Models

Deploying large language models in production requires navigating the tension between model quality and computational cost, a tension that model compression techniques directly address. This article provides a technical deep-dive into knowledge distillation, structured and unstructured pruning, post-training quantization versus quantization-aware training, the GPTQ and AWQ algorithms, and emerging model merging techniques like TIES, DARE, and SLERP. These methods are not theoretical curiosities; they are the practical tools that determine whether a model runs on a single GPU, on a mobile device, or at all within a given latency budget. Understanding their trade-offs is essential for any engineer deploying LLMs at scale.

## Knowledge Distillation

### The Hinton Framework

Knowledge distillation, introduced by Hinton, Vinyals, and Dean (2015) in "Distilling the Knowledge in a Neural Network," transfers knowledge from a large "teacher" model to a smaller "student" model. The key insight is that the teacher's soft probability distribution over outputs contains far more information than the hard labels alone.

Consider a classification example: a teacher model might assign probabilities [0.7, 0.2, 0.05, 0.05] to four classes. The hard label only says "class 1," but the soft distribution reveals that class 2 is somewhat plausible, and classes 3 and 4 are equally unlikely. These "dark knowledge" relationships between classes encode rich structural information about the problem.

The distillation loss uses a temperature-scaled softmax:

$$\mathcal{L}_{distill} = T^2 \cdot D_{KL}\left(\sigma\left(\frac{z_s}{T}\right) \| \sigma\left(\frac{z_t}{T}\right)\right)$$

where $z_s$ and $z_t$ are student and teacher logits, $T$ is the temperature (typically 2-20), and $\sigma$ is the softmax function. Higher temperatures produce softer distributions that reveal more inter-class relationships.

The total student loss combines distillation with the standard task loss:

$$\mathcal{L}_{student} = \alpha \cdot \mathcal{L}_{distill} + (1 - \alpha) \cdot \mathcal{L}_{task}$$

where $\alpha$ balances the two objectives. Typical values are $\alpha \in [0.5, 0.9]$.

```python
import torch
import torch.nn.functional as F

def distillation_loss(student_logits, teacher_logits, labels,
                      temperature=4.0, alpha=0.7):
    """Combined distillation and task loss."""
    # Soft targets from teacher
    soft_loss = F.kl_div(
        F.log_softmax(student_logits / temperature, dim=-1),
        F.softmax(teacher_logits / temperature, dim=-1),
        reduction='batchmean'
    ) * (temperature ** 2)

    # Hard targets (standard cross-entropy)
    hard_loss = F.cross_entropy(student_logits, labels)

    return alpha * soft_loss + (1 - alpha) * hard_loss
```

### Distillation for Language Models

For autoregressive language models, distillation operates on the per-token probability distribution. The student is trained to match the teacher's next-token distribution at each position:

```python
def lm_distillation_loss(student_model, teacher_model, input_ids,
                         attention_mask, temperature=2.0, alpha=0.5):
    """Distillation loss for causal language models."""
    # Get student logits
    student_outputs = student_model(
        input_ids=input_ids, attention_mask=attention_mask
    )
    student_logits = student_outputs.logits[:, :-1, :]  # Shift for next-token

    # Get teacher logits (no gradient needed)
    with torch.no_grad():
        teacher_outputs = teacher_model(
            input_ids=input_ids, attention_mask=attention_mask
        )
        teacher_logits = teacher_outputs.logits[:, :-1, :]

    # Labels are the next tokens
    labels = input_ids[:, 1:]

    # Per-token distillation loss
    vocab_size = student_logits.size(-1)
    soft_loss = F.kl_div(
        F.log_softmax(student_logits.view(-1, vocab_size) / temperature, dim=-1),
        F.softmax(teacher_logits.view(-1, vocab_size) / temperature, dim=-1),
        reduction='batchmean'
    ) * (temperature ** 2)

    # Standard language modeling loss
    hard_loss = F.cross_entropy(
        student_logits.view(-1, vocab_size), labels.view(-1)
    )

    return alpha * soft_loss + (1 - alpha) * hard_loss
```

### Student Architecture Design

The student model architecture significantly impacts distillation quality:

- **Depth reduction**: Remove transformer layers. A 12-layer student from a 24-layer teacher retains more knowledge than reducing hidden dimensions.
- **Width reduction**: Reduce hidden dimensions and number of attention heads. This gives uniform compression across all layers.
- **Hybrid**: Reduce both, but prioritize depth over width for the same parameter budget.

Research by Jiao et al. (2020, "TinyBERT") and Sanh et al. (2019, "DistilBERT") established that a student with roughly half the layers of the teacher can retain 95-97% of performance while being 2x faster at inference.

### Layer Mapping Strategies

When the student has fewer layers than the teacher, you need to decide which teacher layers to align with which student layers:

- **Uniform**: Map every $k$-th teacher layer to the student (e.g., teacher layers 0, 4, 8, 12 map to student layers 0, 1, 2, 3)
- **Top-heavy**: Align more student layers with the teacher's later layers, which tend to be more task-specific
- **Learned**: Use attention-based mapping that learns which teacher layers are most informative for each student layer

```python
def uniform_layer_mapping(n_teacher_layers, n_student_layers):
    """Map student layers to uniformly spaced teacher layers."""
    step = n_teacher_layers // n_student_layers
    return {i: i * step for i in range(n_student_layers)}

# For a 24-layer teacher and 6-layer student:
# {0: 0, 1: 4, 2: 8, 3: 12, 4: 16, 5: 20}
```

### Distillation from Proprietary Models

A significant branch of the distillation landscape involves using outputs from proprietary models -- GPT-4, Claude, Gemini -- as the teacher signal for training smaller open-weight students. This approach, pioneered by Microsoft's Orca (Mukherjee et al., 2023) and Phi (Gunasekar et al., 2023) model families, fundamentally changes the distillation setup: instead of matching logit distributions (which proprietary APIs do not expose), the student learns from the teacher's generated text directly.

The mechanism is straightforward. You prompt the proprietary model with carefully designed instructions that elicit detailed, step-by-step reasoning. The resulting completions become the training corpus for the student. Orca, for example, trained a 13B-parameter model on millions of GPT-4 completions that included chain-of-thought reasoning, system messages demanding thoroughness, and complex multi-step tasks. The student never sees the teacher's internal probability distribution -- it learns purely from the surface-level text, which makes this closer to supervised fine-tuning on high-quality data than classical Hinton-style distillation.

```python
# Simplified pipeline for proprietary model distillation
def generate_training_data(prompts, system_prompt, api_client):
    """Generate training pairs from a proprietary teacher model."""
    training_pairs = []
    for prompt in prompts:
        response = api_client.chat_completions(
            model="gpt-4",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": prompt}
            ],
            temperature=0.7  # Some diversity in responses
        )
        training_pairs.append({
            "instruction": prompt,
            "response": response.content,
            "system": system_prompt
        })
    return training_pairs

# System prompts that elicit detailed reasoning (the Orca approach)
SYSTEM_PROMPTS = [
    "You are a helpful assistant. Think step by step and explain your reasoning.",
    "You are an expert. Provide a detailed, thorough answer with justifications.",
    "Solve this carefully. Show all intermediate steps.",
]
```

The quality expectations are surprisingly high. Orca-2 demonstrated that a 7B model trained on structured GPT-4 outputs could match or exceed GPT-4 itself on certain reasoning benchmarks, particularly when the training data was curated to include the teacher's reasoning process rather than just final answers. The Phi series pushed this further, showing that carefully filtered and synthesized "textbook-quality" data -- partly generated by GPT-4 -- could produce models under 3B parameters that rivaled models 10x their size on academic benchmarks.

However, this approach sits in a legal and ethical gray area. Most proprietary model terms of service explicitly prohibit using their outputs to train competing models. OpenAI's usage policies, for instance, state that output cannot be used to "develop models that compete with OpenAI." Whether such terms are enforceable -- particularly when the distilled model is released as open-source -- remains largely untested in court. Practitioners should be aware of three distinct risk layers: (1) contractual risk from violating terms of service, (2) copyright risk if the teacher's outputs contain memorized copyrighted material that propagates to the student, and (3) the broader question of whether model outputs can be copyrighted at all. For production deployments, the safest approach is to use open-weight teachers (Llama, Qwen, Mistral) where the license explicitly permits derivative works, or to use proprietary models only for evaluation and curriculum design rather than direct training data generation.

## Pruning

Pruning removes redundant parameters or structures from a trained model, reducing size and computation. Two major categories exist:

### Unstructured Pruning

Unstructured pruning removes individual weights (setting them to zero) based on magnitude or other importance criteria:

```python
import torch.nn.utils.prune as prune

def magnitude_prune(model, sparsity=0.5):
    """Apply unstructured magnitude pruning to all linear layers."""
    for name, module in model.named_modules():
        if isinstance(module, torch.nn.Linear):
            prune.l1_unstructured(module, name='weight', amount=sparsity)
            # Make pruning permanent
            prune.remove(module, 'weight')

    # Count zeros
    total = sum(p.numel() for p in model.parameters())
    zeros = sum((p == 0).sum().item() for p in model.parameters())
    print(f"Sparsity: {zeros/total*100:.1f}%")
```

Unstructured pruning can achieve high sparsity (90%+) with minimal accuracy loss, but has a critical limitation: modern hardware (GPUs, TPUs) is not optimized for sparse computation. The pruned weights are still stored and processed; they are just zero. Achieving actual speedup requires specialized sparse kernels or hardware.

### Structured Pruning

Structured pruning removes entire structures: attention heads, neurons in feed-forward layers, or entire transformer layers. This produces dense models that benefit from standard hardware acceleration:

```python
def prune_attention_heads(model, heads_to_prune):
    """Remove entire attention heads from a transformer model.

    heads_to_prune: dict of {layer_idx: [head_indices]}
    """
    for layer_idx, heads in heads_to_prune.items():
        layer = model.encoder.layer[layer_idx]
        # Remove heads by zeroing their weight matrices
        # and adjusting the output projection
        prune_heads(layer.attention, heads)

def identify_unimportant_heads(model, eval_dataloader):
    """Identify attention heads with lowest importance scores."""
    head_importance = compute_head_importance(model, eval_dataloader)
    # head_importance: [num_layers, num_heads]

    # Sort heads by importance
    all_heads = []
    for layer in range(head_importance.size(0)):
        for head in range(head_importance.size(1)):
            all_heads.append((layer, head, head_importance[layer, head].item()))

    all_heads.sort(key=lambda x: x[2])  # Sort by importance
    return all_heads
```

Michel et al. (2019) in "Are Sixteen Heads Really Better than One?" showed that many attention heads can be removed with minimal quality loss, suggesting significant redundancy in transformer architectures.

### SparseGPT

Frantar and Alistarh (2023) introduced SparseGPT, which achieves 50-60% unstructured sparsity on large language models in a single pass (no retraining required). SparseGPT uses an approximate second-order method to solve the layer-wise pruning problem optimally, considering the correlation structure between weights rather than pruning by magnitude alone.

```python
# Using SparseGPT via the sparseml library
from sparseml.transformers import SparseAutoModelForCausalLM

model = SparseAutoModelForCausalLM.from_pretrained(
    "meta-llama/Llama-3-8B",
    recipe="recipe.yaml"  # Specifies sparsity targets
)

# recipe.yaml specifies:
# - 50% unstructured sparsity
# - Calibration dataset for optimal pruning
# - Optional quantization (2:4 sparsity + INT8)
```

## Quantization

Quantization reduces the numerical precision of model weights and/or activations, trading precision for reduced memory and faster computation.

### Precision Formats

| Format | Bits | Range | Use Case |
|--------|------|-------|----------|
| FP32 | 32 | Full | Training (legacy) |
| BF16 | 16 | Wide range, low precision | Training & inference |
| FP16 | 16 | Narrower range, higher precision | Mixed precision training |
| FP8 (E4M3) | 8 | ±240, low precision | H100/H200 training & inference |
| FP8 (E5M2) | 8 | ±57344, very low precision | H100/H200 gradient storage |
| INT8 | 8 | [-128, 127] | Inference quantization |
| INT4 | 4 | [-8, 7] | Aggressive inference quantization |
| NF4 | 4 | Normal distribution optimized | QLoRA training |

**FP8 on modern hardware.** The NVIDIA H100 and H200 GPUs introduced native FP8 tensor core support, making 8-bit floating point a first-class citizen for both training and inference. FP8 comes in two variants: E4M3 (4 exponent bits, 3 mantissa bits) offers higher precision within a narrower dynamic range, making it suitable for weights and activations during forward passes; E5M2 (5 exponent bits, 2 mantissa bits) trades precision for wider dynamic range, which is better suited for gradient representation during backward passes. The critical advantage of FP8 over INT8 is that it preserves the floating-point representation, avoiding the need for separate scale factors per tensor or per channel. In practice, FP8 inference on H100 delivers roughly 2x the throughput of FP16/BF16 with quality degradation that is typically smaller than INT8 PTQ, because the format better matches the natural distribution of transformer weight values. FP8 is rapidly becoming the default precision for inference on Hopper-class hardware, occupying the sweet spot between the quality of FP16 and the efficiency of INT4.

### Post-Training Quantization (PTQ)

PTQ quantizes a trained model without further training. The simplest form is round-to-nearest (RTN):

$$W_q = \text{round}\left(\frac{W}{s}\right) \cdot s, \quad s = \frac{\max(|W|)}{2^{b-1} - 1}$$

where $s$ is the scaling factor and $b$ is the target bit-width.

RTN works well for INT8 but degrades significantly at INT4 for large models. More sophisticated PTQ methods use calibration data to minimize the quantization error:

```python
from transformers import AutoModelForCausalLM
import torch

def simple_ptq_int8(model):
    """Naive per-tensor INT8 quantization."""
    quantized_state = {}
    for name, param in model.named_parameters():
        if param.dim() >= 2:  # Only quantize weight matrices
            scale = param.abs().max() / 127.0
            quantized = torch.round(param / scale).clamp(-128, 127).to(torch.int8)
            quantized_state[name] = {
                'quantized_weight': quantized,
                'scale': scale
            }
        else:
            quantized_state[name] = {'weight': param}
    return quantized_state
```

### GPTQ: Accurate Post-Training Quantization

Frantar et al. (2023) developed GPTQ, which quantizes large language models to 3-4 bits with minimal quality loss. GPTQ uses the Optimal Brain Quantization (OBQ) framework, quantizing weights one at a time and adjusting the remaining weights to compensate for quantization error.

The algorithm works layer by layer:
1. Compute the Hessian matrix $H = 2X^TX$ from calibration data (where $X$ is the layer input)
2. For each weight column, find the quantized value that minimizes the output error
3. Update remaining (unquantized) weights to compensate: $\delta_F = -\frac{w_q - w}{[H^{-1}]_{qq}} \cdot (H^{-1})_{:,q}$
4. This "error compensation" is what allows GPTQ to achieve much better quality than naive rounding

```python
from auto_gptq import AutoGPTQForCausalLM, BaseQuantizeConfig

# Configure GPTQ quantization
quantize_config = BaseQuantizeConfig(
    bits=4,
    group_size=128,        # Quantize in groups for better accuracy
    desc_act=True,         # Use activation-aware ordering
    damp_percent=0.01,     # Dampening for Hessian stability
)

# Load model and quantize
model = AutoGPTQForCausalLM.from_pretrained(
    "meta-llama/Llama-3-8B",
    quantize_config=quantize_config,
)

# Quantize using calibration data
model.quantize(calibration_dataset)

# Save quantized model (~4GB instead of ~16GB)
model.save_quantized("Llama-3-8B-GPTQ")
```

### AWQ: Activation-Aware Weight Quantization

Lin et al. (2023) proposed AWQ, which observes that not all weights are equally important for model output. Weights connected to larger activation magnitudes are more important and should be quantized more carefully.

AWQ's key innovation is **per-channel scaling**: before quantization, multiply weights by a scaling factor $s$ that protects important channels:

$$Q(W \cdot \text{diag}(s)) \cdot \text{diag}(s)^{-1} \cdot X$$

The scaling factor $s$ is optimized to minimize quantization error on calibration data, effectively allocating more of the limited quantization precision to channels that matter most.

AWQ advantages over GPTQ:
- **Faster quantization**: No iterative weight updates required
- **Better generalization**: Does not overfit to calibration data
- **Hardware friendly**: The scaling can be fused into adjacent operations

```python
from awq import AutoAWQForCausalLM

model = AutoAWQForCausalLM.from_pretrained(
    "meta-llama/Llama-3-8B", device_map="auto"
)

quant_config = {
    "zero_point": True,
    "q_group_size": 128,
    "w_bit": 4,
    "version": "GEMM"  # or "GEMV" for batch_size=1
}

model.quantize(
    tokenizer,
    quant_config=quant_config,
    calib_data=calibration_samples
)

model.save_quantized("Llama-3-8B-AWQ")
```

### Quantization-Aware Training (QAT)

QAT simulates quantization during training, allowing the model to adapt to quantization noise. It consistently outperforms PTQ but requires a training run:

```python
def quantize_aware_forward(weight, bits=8):
    """Simulate quantization during forward pass with straight-through estimator."""
    scale = weight.abs().max() / (2 ** (bits - 1) - 1)
    # Forward: quantize
    weight_q = torch.round(weight / scale) * scale
    # Backward: straight-through (gradient passes through as if no quantization)
    weight_q = weight + (weight_q - weight).detach()
    return weight_q
```

QAT is more computationally expensive than PTQ but produces better results, especially at very low bit-widths (2-3 bits). For most practical purposes, GPTQ and AWQ at 4 bits provide sufficient quality without the training overhead.

## Model Merging

Model merging combines multiple fine-tuned models into a single model without additional training. This enables combining specialized capabilities from different fine-tunes.

### Linear Merging (Model Soup)

The simplest approach averages model weights:

$$\theta_{merged} = \frac{1}{N} \sum_{i=1}^{N} \theta_i$$

Or with weighted averaging:

$$\theta_{merged} = \sum_{i=1}^{N} w_i \theta_i, \quad \sum w_i = 1$$

Wortsman et al. (2022) showed in "Model Soups" that averaging multiple fine-tunes of the same base model often outperforms any individual model, without any additional training.

### TIES: Trimming, Electing Signs, and Merging

Yadav et al. (2023) identified that naive merging suffers from two problems: (1) redundant parameters that changed minimally during fine-tuning add noise, and (2) sign conflicts between models (one model increased a weight, another decreased it) cause destructive interference.

TIES addresses both:

```python
def ties_merge(models, base_model, density=0.2):
    """TIES merging: Trim, Elect signs, then merge."""
    base_params = dict(base_model.named_parameters())
    task_vectors = []

    # Step 1: Compute task vectors (delta from base)
    for model in models:
        tv = {}
        for name, param in model.named_parameters():
            tv[name] = param.data - base_params[name].data
        task_vectors.append(tv)

    merged = {}
    for name in base_params:
        deltas = torch.stack([tv[name] for tv in task_vectors])

        # Step 2: TRIM - zero out small-magnitude changes
        threshold = torch.quantile(deltas.abs().flatten(), 1 - density)
        trimmed = deltas.clone()
        trimmed[trimmed.abs() < threshold] = 0

        # Step 3: ELECT SIGN - resolve sign conflicts by majority vote
        sign_sum = trimmed.sign().sum(dim=0)
        elected_sign = sign_sum.sign()

        # Zero out values that disagree with elected sign
        for i in range(len(models)):
            mask = trimmed[i].sign() != elected_sign
            trimmed[i][mask] = 0

        # Step 4: MERGE - average the trimmed, sign-aligned deltas
        merged_delta = trimmed.mean(dim=0)
        merged[name] = base_params[name].data + merged_delta

    return merged
```

### DARE: Drop and Rescale

Yu et al. (2024) proposed DARE, which randomly drops a large fraction (90-99%) of delta parameters and rescales the remaining ones:

$$\tilde{\delta}_t = \frac{m_t \odot \delta_t}{1 - p}$$

where $m_t$ is a random binary mask with drop rate $p$, $\delta_t$ is the task vector, and the rescaling by $1/(1-p)$ preserves the expected magnitude.

DARE works because fine-tuning typically produces highly redundant updates, and random subsets of these updates capture the essential adaptation. DARE is often combined with TIES for best results.

### SLERP: Spherical Linear Interpolation

SLERP interpolates between two models along a geodesic on the hypersphere, rather than linear interpolation in weight space:

$$\theta_{merged} = \frac{\sin((1-t)\Omega)}{\sin(\Omega)} \theta_1 + \frac{\sin(t\Omega)}{\sin(\Omega)} \theta_2$$

where $\Omega = \arccos\left(\frac{\theta_1 \cdot \theta_2}{|\theta_1||\theta_2|}\right)$ is the angle between the two parameter vectors, and $t \in [0, 1]$ controls the interpolation.

SLERP is limited to merging exactly two models but often produces smoother interpolations than linear averaging, especially when the models have diverged significantly from each other.

### Practical Merging with mergekit

The mergekit library provides a unified interface for model merging:

```yaml
# mergekit config for TIES merge
merge_method: ties
base_model: meta-llama/Llama-3-8B
models:
  - model: coding-specialist/Llama-3-8B-Code
    parameters:
      weight: 0.5
      density: 0.5
  - model: math-specialist/Llama-3-8B-Math
    parameters:
      weight: 0.3
      density: 0.5
  - model: writing-specialist/Llama-3-8B-Creative
    parameters:
      weight: 0.2
      density: 0.5
parameters:
  normalize: true
dtype: bfloat16
```

```bash
mergekit-yaml merge_config.yaml ./merged-model --cuda
```

## Compression Pipeline

In practice, these techniques are often combined in sequence:

1. **Distillation**: Train a smaller student model from a large teacher
2. **Pruning**: Remove redundant structures from the student
3. **Quantization**: Reduce precision of the pruned model
4. **Optionally merge**: Combine with other specialized models

```python
class CompressionPipeline:
    def __init__(self, teacher_model, student_config):
        self.teacher = teacher_model
        self.student_config = student_config

    def run(self, train_data, calibration_data):
        # Stage 1: Distillation
        print("Stage 1: Knowledge distillation...")
        student = self.distill(train_data, epochs=5, temperature=4.0)

        # Stage 2: Structured pruning
        print("Stage 2: Pruning attention heads...")
        unimportant_heads = identify_unimportant_heads(student, calibration_data)
        heads_to_prune = select_heads(unimportant_heads, prune_ratio=0.25)
        prune_attention_heads(student, heads_to_prune)

        # Stage 3: Fine-tune after pruning (recover quality)
        print("Stage 3: Recovery fine-tuning...")
        student = self.recovery_finetune(student, train_data, epochs=2)

        # Stage 4: Quantization
        print("Stage 4: GPTQ quantization to 4-bit...")
        quantized = self.quantize_gptq(student, calibration_data)

        return quantized
```

### Quality-Size Trade-offs

Typical quality retention at different compression levels (relative to full-precision base model):

| Compression Method | Size Reduction | Quality Retention |
|-------------------|---------------|-------------------|
| FP16 (from FP32) | 2x | ~100% |
| INT8 PTQ | 4x | 99%+ |
| GPTQ 4-bit | 8x | 96-99% |
| AWQ 4-bit | 8x | 97-99% |
| Distillation (2x smaller) | 2x | 95-97% |
| Pruning 50% + INT8 | 8x | 93-96% |
| Distillation + GPTQ 4-bit | 16x | 90-95% |

## Deployment Formats: GGUF and ExLlamaV2

Quantization algorithms like GPTQ and AWQ produce compressed weights, but those weights need a runtime and a file format to actually reach end users. Two ecosystems dominate deployment on consumer and edge hardware.

### GGUF and the llama.cpp Ecosystem

GGUF (GPT-Generated Unified Format) is the file format used by llama.cpp, the C/C++ inference engine created by Georgi Gerganov. It replaced the earlier GGML format in August 2023 and has become the de facto standard for running quantized models on consumer hardware -- laptops, desktops, and edge devices with limited or no GPU memory (see [Article 41: Edge Deployment](/edge-deployment) for the broader edge inference landscape).

GGUF stores model weights, tokenizer configuration, and metadata in a single self-contained file. Its key strength is flexibility in quantization granularity. Rather than applying a uniform bit-width across the entire model, GGUF supports mixed quantization: different layers or tensor types can use different precisions. The naming convention encodes the quantization scheme -- Q4_K_M means 4-bit quantization with K-quant (importance-weighted) at medium quality, Q5_K_S is 5-bit at small quality, and so on.

```bash
# Convert a Hugging Face model to GGUF and quantize
# (using llama.cpp's convert and quantize tools)
python convert_hf_to_gguf.py meta-llama/Llama-3-8B --outfile llama3-8b-f16.gguf

# Quantize to various bit-widths
./llama-quantize llama3-8b-f16.gguf llama3-8b-Q4_K_M.gguf Q4_K_M
./llama-quantize llama3-8b-f16.gguf llama3-8b-Q5_K_M.gguf Q5_K_M

# Run inference (CPU + partial GPU offload)
./llama-cli -m llama3-8b-Q4_K_M.gguf -p "Explain distillation" \
    -ngl 20  # Offload 20 layers to GPU
```

The llama.cpp runtime supports CPU inference via optimized SIMD kernels (AVX2, AVX-512, ARM NEON), partial or full GPU offload via CUDA, Metal, and Vulkan, and even hybrid CPU-GPU splits where some layers run on the GPU and others on the CPU. This makes it possible to run a 70B-parameter model on a machine with only 8GB of VRAM by offloading most layers to system RAM, accepting higher latency in exchange for accessibility.

K-quant methods (Q4_K, Q5_K, Q6_K) allocate more bits to layers that are more sensitive to quantization error and fewer bits to layers that are robust, achieving better quality than uniform quantization at the same average bit-width. In practice, Q4_K_M (roughly 4.8 bits per weight on average) provides the best trade-off for most users, while Q5_K_M is the conservative choice when quality is paramount.

### ExLlamaV2 for GPU Inference

ExLlamaV2 is a highly optimized inference engine for running quantized models entirely on GPU. Where llama.cpp emphasizes broad hardware compatibility, ExLlamaV2 focuses on maximizing throughput on NVIDIA GPUs using custom CUDA kernels for dequantization and matrix multiplication.

ExLlamaV2 uses its own EXL2 quantization format, which extends the mixed-precision idea further: it supports arbitrary average bit-widths (e.g., 3.5, 4.25, 5.0 bits per weight) by varying precision at the individual layer and group level. The quantization process uses calibration data to determine which layers need more bits, similar in spirit to AWQ's activation-awareness but applied at the format level.

```python
from exllamav2 import ExLlamaV2, ExLlamaV2Config, ExLlamaV2Tokenizer
from exllamav2.generator import ExLlamaV2StreamingGenerator

# Load an EXL2 quantized model
config = ExLlamaV2Config("Llama-3-8B-exl2-4.0bpw")
model = ExLlamaV2(config)
model.load()
tokenizer = ExLlamaV2Tokenizer(config)

# Stream tokens with high throughput
generator = ExLlamaV2StreamingGenerator(model, tokenizer)
generator.set_stop_conditions([tokenizer.eos_token_id])
output = generator.generate_simple("Explain knowledge distillation:", max_new_tokens=256)
```

For single-user inference on a desktop GPU, ExLlamaV2 typically achieves 1.5-2x the tokens-per-second of GPTQ through the standard Hugging Face pipeline, thanks to its fused kernels and aggressive memory management. For multi-user serving, however, engines like vLLM and TensorRT-LLM (covered in [Article 37: LLM Serving](/llm-serving)) are better suited because they add continuous batching and PagedAttention.

## Speculative Decoding as Deployment Optimization

Speculative decoding is an inference-time technique that uses a small, fast "draft" model to propose multiple tokens in parallel, which are then verified by the full-size "target" model in a single forward pass. When the draft model's proposals are accepted, the system generates multiple tokens for the cost of one target model forward pass, delivering wall-clock speedups of 2-3x without any change to the output distribution.

The algorithm works as follows:

1. The draft model autoregressively generates $K$ candidate tokens (typically $K = 4$-$8$).
2. The target model evaluates all $K$ tokens in a single forward pass (this is efficient because the target model processes the entire sequence in parallel, similar to a prefill operation).
3. Each draft token is accepted or rejected by comparing the draft and target probability distributions. Tokens are accepted from left to right; once a token is rejected, a corrected token is sampled from an adjusted distribution and all subsequent draft tokens are discarded.

The mathematical guarantee is exact: speculative decoding produces the same output distribution as running the target model alone. There is no quality loss whatsoever. The speedup comes from the asymmetry between the draft model's fast sequential generation and the target model's ability to verify a batch of tokens in parallel.

```python
def speculative_decode(draft_model, target_model, prompt_ids, K=5):
    """Simplified speculative decoding loop."""
    generated = prompt_ids.clone()

    while not is_finished(generated):
        # Step 1: Draft model generates K candidate tokens
        draft_probs = []
        draft_tokens = []
        current = generated.clone()
        for _ in range(K):
            logits = draft_model(current).logits[:, -1, :]
            p = torch.softmax(logits, dim=-1)
            token = torch.multinomial(p, 1)
            draft_probs.append(p)
            draft_tokens.append(token)
            current = torch.cat([current, token], dim=-1)

        # Step 2: Target model scores all K tokens in one pass
        target_logits = target_model(current).logits
        target_probs = [
            torch.softmax(target_logits[:, len(generated) + i - 1, :], dim=-1)
            for i in range(K)
        ]

        # Step 3: Accept/reject each draft token
        accepted = 0
        for i in range(K):
            token = draft_tokens[i]
            r = torch.rand(1)
            accept_prob = (target_probs[i].gather(-1, token)
                          / draft_probs[i].gather(-1, token)).clamp(max=1.0)
            if r < accept_prob:
                generated = torch.cat([generated, token], dim=-1)
                accepted += 1
            else:
                # Sample corrected token from adjusted distribution
                adjusted = torch.clamp(target_probs[i] - draft_probs[i], min=0)
                adjusted = adjusted / adjusted.sum()
                corrected = torch.multinomial(adjusted, 1)
                generated = torch.cat([generated, corrected], dim=-1)
                break

    return generated
```

The connection to distillation is direct: the draft model is often a distilled version of the target model, specifically trained to approximate the target's distribution as closely as possible. The higher the agreement rate between draft and target, the more tokens are accepted per verification step, and the greater the speedup. This creates a virtuous cycle where better distillation directly translates to faster inference.

In practice, speculative decoding is most effective when: (1) the task involves predictable token sequences (code completion, structured output, formulaic text) where the draft model's acceptance rate is high, (2) the target model is large enough that its forward pass dominates wall-clock time, and (3) the draft model is at least 5-10x smaller than the target. Google's production deployment of speculative decoding in Gemini and DeepMind's work on "distillation-based speculative decoding" have validated this approach at scale. For a deeper treatment of inference-time optimization techniques including KV cache management and batching strategies, see [Article 05: Inference Optimization](/inference-optimization).

## Cross-References

This article connects to several other topics in the series:

- **[Article 05: Inference Optimization](/inference-optimization)** covers the broader inference pipeline -- KV cache management, prefix caching, continuous batching, and attention optimizations -- within which quantized and distilled models operate.
- **[Article 20: LoRA, QLoRA & Adapter Methods](/lora-adapters)** explores parameter-efficient fine-tuning. QLoRA in particular combines NF4 quantization with LoRA adapters, directly building on the quantization techniques discussed here.
- **[Article 23: Continual Learning](/continual-learning)** examines catastrophic forgetting and knowledge retention. Knowledge distillation is one of the key strategies for preserving prior capabilities during continual pre-training.
- **[Article 37: LLM Serving](/llm-serving)** covers the serving infrastructure -- API design, batching, streaming -- that sits on top of compressed models in production deployments.
- **[Article 41: Edge Deployment](/edge-deployment)** details on-device inference runtimes (llama.cpp, ONNX, WebLLM) where the deployment formats and quantization methods from this article are essential for making models fit within device constraints.

## Summary and Key Takeaways

- **Knowledge distillation** transfers the "dark knowledge" in a teacher's soft probability distributions to a smaller student model. Temperature scaling reveals inter-class relationships. Students with half the teacher's layers can retain 95-97% of performance.
- **Distillation from proprietary models** (the Orca/Phi approach) uses generated text rather than logit distributions, enabling distillation from closed APIs. Quality results can be impressive, but licensing and legal risks remain largely unresolved.
- **Unstructured pruning** zeros individual weights and can achieve 50-90% sparsity, but requires sparse hardware/kernels for actual speedup. SparseGPT achieves this in a single pass.
- **Structured pruning** removes entire attention heads, neurons, or layers, producing dense models with real speedups on standard hardware.
- **GPTQ** uses second-order information to quantize models to 4 bits with minimal quality loss, compensating for each weight's quantization error in the remaining weights.
- **AWQ** protects important weight channels (identified via activation magnitudes) during quantization, achieving comparable quality to GPTQ with faster quantization and better generalization.
- **FP8** on H100/H200 hardware delivers roughly 2x throughput over FP16/BF16 with quality typically better than INT8 PTQ, making it the emerging default for inference on Hopper-class GPUs.
- **QAT** integrates quantization into training for better quality at very low bit-widths but requires a full training run.
- **Model merging** (TIES, DARE, SLERP) combines specialized fine-tunes without additional training. TIES resolves sign conflicts; DARE randomly prunes redundant updates; SLERP interpolates on the hypersphere.
- **GGUF** (via llama.cpp) and **ExLlamaV2** (EXL2 format) are the dominant deployment formats for quantized models on consumer and edge hardware. GGUF emphasizes broad hardware compatibility with CPU/GPU hybrid execution; ExLlamaV2 maximizes GPU throughput with custom CUDA kernels.
- **Speculative decoding** uses a small draft model (often a distilled version of the target) to propose tokens verified by the larger model in a single pass, yielding 2-3x speedups with mathematically identical output distributions.
- The practical compression pipeline is: **distill (if architecture change needed) -> prune (structural redundancy) -> quantize (precision reduction) -> merge (combine specializations)**. Each step compounds the compression with diminishing quality costs.
- For most deployment scenarios, **AWQ or GPTQ at 4 bits** is the sweet spot, offering 4x memory reduction with negligible quality loss on modern LLMs.
