# Fine-tuning Fundamentals: Full, Freeze & Transfer Learning

Fine-tuning pre-trained language models remains the most reliable method for adapting general-purpose models to domain-specific tasks, yet the decision space around when, how, and whether to fine-tune has grown considerably. This article examines the mechanics of full fine-tuning, feature extraction, and transfer learning strategies, covering supervised fine-tuning (SFT) for instruction following, learning rate scheduling, catastrophic forgetting mitigation, mixed-precision and distributed training, and the practical economics of fine-tuning versus prompt engineering. Understanding these fundamentals is essential before exploring parameter-efficient methods like [LoRA](/lora-adapters) or reinforcement learning from human feedback.

## TL;DR

- Fine-tuning adapts a pre-trained model to your task by updating some or all of its weights on labeled data -- full fine-tuning updates everything; feature extraction freezes the backbone.
- **SFT for instruction following** is the dominant modern workflow: chat-format data, correct chat templates, and loss masking on prompt tokens. TRL's `SFTTrainer` handles this automatically.
- Use **bf16** on A100/H100 hardware and **FSDP or DeepSpeed ZeRO** when training models above 7B parameters.
- **Learning rate scheduling matters most**: linear warmup (6-10% of steps) followed by cosine decay, with a low base LR (around 2e-5) to avoid catastrophic forgetting.
- Fine-tuning wins at scale (1,000+ labeled examples, repeated inference); prompting wins for flexibility and low-data regimes.

## The Transfer Learning Paradigm

Transfer learning in NLP underwent a phase transition with the introduction of large pre-trained language models. The core insight, articulated in Howard and Ruder's ULMFiT paper (2018) and later scaled by BERT (Devlin et al., 2019) and GPT (Radford et al., 2018), is that representations learned during unsupervised pre-training on large corpora encode general linguistic knowledge that transfers effectively to downstream tasks.

The transfer learning pipeline follows a two-stage process:

1. **Pre-training**: Learn general representations from large unlabeled corpora using self-supervised objectives (masked language modeling, next-token prediction, or denoising).
2. **Fine-tuning**: Adapt these representations to a specific task using labeled data, typically with a task-specific head appended to the pre-trained backbone.

This paradigm works because:
- Early layers capture low-level syntactic patterns (part-of-speech, phrase structure)
- Middle layers encode semantic relationships
- Later layers develop task-relevant abstractions

Fine-tuning adjusts all these layers to align with the target distribution.

### Feature Extraction vs. Fine-tuning

Two fundamental approaches exist for leveraging pre-trained models:

**Feature extraction** freezes all pre-trained weights and only trains a new classification head on top. The pre-trained model acts as a fixed feature extractor. This approach is computationally cheap and works well when the target domain is similar to the pre-training corpus.

```python
from transformers import AutoModel, AutoTokenizer
import torch.nn as nn

class FeatureExtractor(nn.Module):
    def __init__(self, model_name, num_classes):
        super().__init__()
        self.backbone = AutoModel.from_pretrained(model_name)
        # Freeze all backbone parameters
        for param in self.backbone.parameters():
            param.requires_grad = False
        self.classifier = nn.Linear(self.backbone.config.hidden_size, num_classes)

    def forward(self, input_ids, attention_mask):
        with torch.no_grad():
            outputs = self.backbone(input_ids, attention_mask=attention_mask)
        cls_embedding = outputs.last_hidden_state[:, 0, :]
        return self.classifier(cls_embedding)
```

**Full fine-tuning** updates all parameters, including the pre-trained backbone. This is more expressive but requires more data, more compute, and careful hyperparameter tuning to avoid catastrophic forgetting.

The choice between these approaches depends on several factors: dataset size, domain shift from pre-training data, compute budget, and the complexity of the target task. Research by Peters et al. (2019) in "To Tune or Not to Tune?" demonstrated that fine-tuning consistently outperforms feature extraction when sufficient labeled data is available, but the gap narrows for tasks closely aligned with pre-training objectives.

## Full Fine-tuning Mechanics

Full fine-tuning updates every parameter in the model using gradient descent on the task-specific loss. For a model with parameters $\theta$ pre-trained to $\theta_0$, fine-tuning solves:

$$\theta^* = \arg\min_\theta \mathcal{L}_{task}(D_{train}; \theta) + \lambda ||\theta - \theta_0||^2$$

The regularization term $\lambda ||\theta - \theta_0||^2$ (L2 regularization toward pre-trained weights, sometimes called "weight decay toward init") is optional but helps prevent the model from drifting too far from its pre-trained initialization.

### The Mechanics of Gradient Flow

During full fine-tuning, gradients flow from the task-specific loss through every layer. This means:

- **Output layers** receive the strongest gradient signal and change most rapidly
- **Middle layers** adjust their semantic representations to align with task requirements
- **Input layers** (embeddings, early attention) change least, as they encode fundamental linguistic patterns

This natural gradient hierarchy is why discriminative learning rates (different learning rates per layer) can be effective. ULMFiT introduced this concept, applying progressively smaller learning rates to earlier layers:

```python
from torch.optim import AdamW

def get_discriminative_lr_params(model, base_lr=2e-5, decay_factor=0.95):
    """Apply discriminative learning rates: lower LR for earlier layers."""
    param_groups = []
    num_layers = model.config.num_hidden_layers

    # Embeddings get the smallest learning rate
    param_groups.append({
        'params': model.embeddings.parameters(),
        'lr': base_lr * (decay_factor ** num_layers)
    })

    # Each transformer layer gets a progressively higher LR
    for i, layer in enumerate(model.encoder.layer):
        param_groups.append({
            'params': layer.parameters(),
            'lr': base_lr * (decay_factor ** (num_layers - i - 1))
        })

    # Classification head gets the highest learning rate
    param_groups.append({
        'params': model.classifier.parameters(),
        'lr': base_lr
    })

    return param_groups

optimizer = AdamW(get_discriminative_lr_params(model))
```

### Gradual Unfreezing

An alternative to discriminative learning rates is gradual unfreezing, where layers are progressively unfrozen during training. Start by training only the classification head, then unfreeze the top transformer layer, then the next, and so on. This gives each layer time to adapt before earlier layers begin changing.

```python
def gradual_unfreeze(model, epoch, total_layers):
    """Unfreeze one additional layer per epoch, starting from the top."""
    # Freeze everything first
    for param in model.parameters():
        param.requires_grad = False

    # Always train the classification head
    for param in model.classifier.parameters():
        param.requires_grad = True

    # Unfreeze layers from top to bottom based on epoch
    layers_to_unfreeze = min(epoch + 1, total_layers)
    for i in range(total_layers - layers_to_unfreeze, total_layers):
        for param in model.encoder.layer[i].parameters():
            param.requires_grad = True
```

## SFT for Instruction Following

Supervised fine-tuning (SFT) for instruction following is the dominant modern fine-tuning use case. Rather than appending a classification head, SFT trains a causal language model to generate helpful responses given conversational prompts. This is the process that transforms a raw pre-trained model into a useful assistant, and it is the first stage of the alignment pipeline that precedes RLHF or DPO.

### Conversation Data Format

SFT datasets consist of multi-turn conversations formatted as sequences of role-tagged messages. The standard format mirrors the OpenAI chat schema:

```json
{
  "messages": [
    {"role": "system", "content": "You are a helpful coding assistant."},
    {"role": "user", "content": "Write a Python function to compute Fibonacci numbers."},
    {"role": "assistant", "content": "Here is an efficient implementation using memoization:\n\n```python\nfrom functools import lru_cache\n\n@lru_cache(maxsize=None)\ndef fibonacci(n: int) -> int:\n    if n < 2:\n        return n\n    return fibonacci(n - 1) + fibonacci(n - 2)\n```"}
  ]
}
```

Each conversation is serialized into a single token sequence using a **chat template** -- a model-specific format that inserts special tokens to delimit roles and turns. For Llama 3, this looks like `<|begin_of_text|><|start_header_id|>system<|end_header_id|>...`. The tokenizer handles this automatically:

```python
from transformers import AutoTokenizer

tokenizer = AutoTokenizer.from_pretrained("meta-llama/Llama-3.1-8B-Instruct")

messages = [
    {"role": "user", "content": "Explain gradient descent in one sentence."},
    {"role": "assistant", "content": "Gradient descent iteratively adjusts parameters in the direction that reduces the loss function."}
]

# apply_chat_template serializes the conversation with proper special tokens
formatted = tokenizer.apply_chat_template(messages, tokenize=False)
```

Getting the chat template right is critical. A mismatch between the template used during SFT and the one used at inference causes degraded performance, as the model encounters token patterns it was not trained on.

> **Note:** Chat template mismatches are a common silent failure mode. Always verify that `apply_chat_template` uses the same template at training time and inference time.

### Loss Masking on Prompt Tokens

A key detail that distinguishes SFT from naive language model training is **loss masking**: the cross-entropy loss is computed only on assistant response tokens, not on user or system prompt tokens. The model should learn to *generate* good responses, not to *predict* user messages.

In practice, this is implemented by setting labels to `-100` (the PyTorch cross-entropy ignore index) for all non-assistant tokens:

```python
def mask_prompt_tokens(input_ids, assistant_start_positions, assistant_end_positions):
    """Create labels with -100 for prompt tokens, actual token IDs for assistant tokens."""
    labels = input_ids.clone()
    labels[:] = -100  # Mask everything by default

    for start, end in zip(assistant_start_positions, assistant_end_positions):
        labels[start:end] = input_ids[start:end]  # Unmask assistant tokens

    return labels
```

Without loss masking, the model wastes capacity learning to reproduce prompt tokens, which can degrade generation quality and slow convergence. The effect is especially pronounced when system prompts are long relative to responses.

### The TRL SFTTrainer

The Transformer Reinforcement Learning (TRL) library by Hugging Face provides `SFTTrainer`, which handles chat template application, loss masking, and dataset formatting automatically. This has become the standard tool for instruction tuning:

```python
from trl import SFTTrainer, SFTConfig
from transformers import AutoModelForCausalLM, AutoTokenizer
from datasets import load_dataset

model_name = "meta-llama/Llama-3.1-8B"
model = AutoModelForCausalLM.from_pretrained(model_name, torch_dtype="bfloat16")
tokenizer = AutoTokenizer.from_pretrained(model_name)

dataset = load_dataset("json", data_files="sft_data.jsonl", split="train")

sft_config = SFTConfig(
    output_dir="./sft-output",
    num_train_epochs=3,
    per_device_train_batch_size=2,
    gradient_accumulation_steps=8,
    learning_rate=2e-5,
    lr_scheduler_type="cosine",
    warmup_ratio=0.1,
    bf16=True,
    logging_steps=10,
    save_strategy="steps",
    save_steps=200,
    max_seq_length=4096,
)

trainer = SFTTrainer(
    model=model,
    args=sft_config,
    train_dataset=dataset,
    processing_class=tokenizer,
)

trainer.train()
```

`SFTTrainer` expects the dataset to contain a `"messages"` column in the standard chat format. It applies the model's chat template, handles tokenization and packing, and masks prompt tokens from the loss automatically. For details on curating high-quality instruction datasets, see [Dataset Curation: Synthetic Data, Quality Filtering & Annotation](/dataset-curation).

## Mixed-Precision Training

Training large models in full float32 precision is both memory-prohibitive and unnecessarily slow on modern hardware. Mixed-precision training performs most computations in a lower-precision format while maintaining a master copy of weights in higher precision for numerical stability.

### bf16 vs fp16

Two 16-bit formats are commonly used, and the choice matters:

| Format | Exponent bits | Mantissa bits | Dynamic range | Loss scaling needed | Min GPU |
|--------|--------------|---------------|---------------|---------------------|---------|
| fp16 | 5 | 10 | Limited (~65,504 max) | Yes (auto in HF Trainer) | V100 |
| bf16 | 8 | 7 | Same as float32 | No | A100+ |

**fp16 (float16)** offers 2x memory savings and significant speedups on tensor cores (available since V100). However, its limited dynamic range means gradient values can overflow or underflow, requiring **loss scaling**. The Hugging Face `Trainer` handles this automatically when `fp16=True`.

**bf16 (bfloat16)** matches float32's dynamic range, eliminating overflow/underflow issues and making loss scaling unnecessary. The tradeoff is slightly lower mantissa precision, but this is rarely a problem for training. bf16 requires Ampere (A100) or newer GPUs.

```python
# Use bf16 on A100/H100 hardware (preferred)
training_args = TrainingArguments(
    bf16=True,       # bfloat16 -- no loss scaling needed
    # ...
)

# Use fp16 on V100 or older hardware
training_args = TrainingArguments(
    fp16=True,       # float16 with automatic loss scaling
    # ...
)
```

**Practical guidance:**
- Use bf16 whenever hardware supports it (A100, H100, AMD MI300X).
- Fall back to fp16 on V100s.
- Never use both flags simultaneously.
- If you encounter NaN losses with fp16, try reducing the learning rate or switching to bf16 if possible.

For more on quantization during inference, see [Inference Optimization: KV Cache, Quantization & Speculative Decoding](/inference-optimization).

## Distributed Training Essentials

Full fine-tuning of models above 7B parameters requires distributing computation across multiple GPUs. The two dominant frameworks are PyTorch FSDP and DeepSpeed ZeRO, both of which shard optimizer states, gradients, and optionally parameters across devices to reduce per-GPU memory consumption.

### FSDP vs DeepSpeed ZeRO

**DeepSpeed ZeRO** (Rajbhandari et al., 2020) defines three sharding stages:

| Stage | What is sharded | Memory reduction | Communication cost |
|-------|-----------------|------------------|--------------------|
| ZeRO-1 | Optimizer states only | ~4x (Adam stores 2 state tensors/param) | Minimal |
| ZeRO-2 | Optimizer states + gradients | Higher | Small |
| ZeRO-3 | Optimizer states + gradients + parameters | Maximum | Highest |

**PyTorch FSDP** (Fully Sharded Data Parallel) is PyTorch's native answer to ZeRO Stage 3. It shards parameters, gradients, and optimizer states, with configurable sharding strategies. FSDP integrates cleanly with the PyTorch ecosystem and is the recommended approach for new projects since it does not require an external library.

### When to Use Each

| Scenario | Recommended Approach |
|----------|---------------------|
| 7B model, single GPU (80GB) | No distribution needed; bf16 is sufficient |
| 7B model, 2-4 GPUs | FSDP or ZeRO Stage 2 |
| 13B-34B model, 4-8 GPUs | FSDP or ZeRO Stage 3 |
| 70B+ model, 8+ GPUs | ZeRO Stage 3 with offloading, or FSDP |
| Already using HF Trainer | Either; both have Trainer integration |

### Practical Configuration

Both frameworks integrate with the Hugging Face `Trainer` via Accelerate configuration files:

```yaml
# accelerate_config.yaml for FSDP
compute_environment: LOCAL_MACHINE
distributed_type: FSDP
fsdp_config:
  fsdp_sharding_strategy: FULL_SHARD         # equivalent to ZeRO-3
  fsdp_auto_wrap_policy: TRANSFORMER_BASED_WRAP
  fsdp_transformer_layer_cls_to_wrap: LlamaDecoderLayer
  fsdp_backward_prefetch_policy: BACKWARD_PRE
  fsdp_state_dict_type: SHARDED_STATE_DICT
mixed_precision: bf16
num_machines: 1
num_processes: 4                              # number of GPUs
```

Launch training with:

```bash
accelerate launch --config_file accelerate_config.yaml train.py
```

For DeepSpeed, a JSON configuration file specifies the ZeRO stage and optimization settings:

```json
{
  "bf16": {"enabled": true},
  "zero_optimization": {
    "stage": 2,
    "allgather_partitions": true,
    "reduce_scatter": true,
    "overlap_comm": true
  },
  "gradient_accumulation_steps": 4,
  "train_micro_batch_size_per_gpu": 2
}
```

In general, start with the simplest configuration that fits your model in memory and scale up sharding only when needed. Each additional ZeRO stage or FSDP sharding level increases communication overhead and can reduce training throughput.

> **Tip:** Measure training throughput (tokens/sec) after adding each level of sharding. The extra communication cost sometimes makes a lower sharding stage with gradient accumulation faster end-to-end.

For considerations around serving the resulting model, see [LLM Serving: API Design, Batching & Streaming](/llm-serving).

## Learning Rate Scheduling

Learning rate scheduling is arguably the single most impactful hyperparameter decision in fine-tuning. The wrong learning rate schedule can lead to catastrophic forgetting (too high), underfitting (too low), or unstable training (no warmup).

### Linear Warmup

Starting with a high learning rate on a fine-tuned model is dangerous because the randomly initialized classification head produces large gradients that can corrupt pre-trained weights. Linear warmup addresses this by gradually increasing the learning rate from near-zero over the first N steps:

$$lr(t) = lr_{max} \cdot \frac{t}{T_{warmup}} \quad \text{for } t \leq T_{warmup}$$

A typical warmup period is 6-10% of total training steps. The BERT paper used a warmup of 10% of training steps, which has become a common default.

### Cosine Decay

After warmup, cosine decay smoothly reduces the learning rate following a cosine curve:

$$lr(t) = lr_{min} + \frac{1}{2}(lr_{max} - lr_{min})(1 + \cos(\frac{t - T_{warmup}}{T_{total} - T_{warmup}} \cdot \pi))$$

Cosine decay avoids the sharp transitions of step-based schedules and provides a natural annealing that helps the model settle into flatter minima.

```python
from transformers import get_cosine_schedule_with_warmup

optimizer = AdamW(model.parameters(), lr=2e-5, weight_decay=0.01)
scheduler = get_cosine_schedule_with_warmup(
    optimizer,
    num_warmup_steps=int(0.06 * total_steps),  # 6% warmup
    num_training_steps=total_steps
)
```

### Warmup-Stable-Decay (WSD)

A newer schedule gaining traction, particularly for continual pre-training, is warmup-stable-decay (WSD). It maintains a constant learning rate for the majority of training after warmup, then applies a short decay phase at the end. MiniCPM (Hu et al., 2024) demonstrated that WSD enables efficient "anytime" training where checkpoints from the stable phase can be independently decayed.

## Catastrophic Forgetting Prevention

Catastrophic forgetting occurs when fine-tuning on a new task destroys the general knowledge acquired during pre-training. This is not merely a theoretical concern; aggressive fine-tuning on small datasets routinely causes models to lose fluency, factual knowledge, or performance on related tasks.

> **Note:** The most common trigger is a learning rate that's too high, combined with a small domain-specific dataset and no general-data mixing. All three factors compound each other.

### Techniques for Mitigation

**1. Low learning rates**: The simplest defense. BERT-scale models typically use learning rates of 1e-5 to 5e-5, roughly 10-100x smaller than training from scratch.

**2. Short training duration**: Fine-tuning typically runs for 2-5 epochs. Prolonged training increases the risk of overfitting and forgetting. Many practitioners use early stopping based on validation loss.

**3. Regularization toward pre-trained weights**: Explicitly penalizing divergence from pre-trained weights constrains how far the model can drift:

```python
def l2_regularization_to_init(model, pretrained_params, lambda_reg=0.01):
    reg_loss = 0
    for name, param in model.named_parameters():
        if name in pretrained_params:
            reg_loss += torch.sum((param - pretrained_params[name]) ** 2)
    return lambda_reg * reg_loss
```

**4. Elastic Weight Consolidation (EWC)**: Originally proposed by Kirkpatrick et al. (2017) for continual learning, EWC uses the Fisher information matrix to identify which parameters are important for previously learned tasks and penalizes changes to those parameters more heavily. This is explored in depth in [Continual Learning: Catastrophic Forgetting & Knowledge Retention](/continual-learning).

**5. Mixout regularization**: Proposed by Lee et al. (2020), mixout stochastically replaces fine-tuned weights with their pre-trained values during training, similar to dropout but replacing with the pre-trained value instead of zero.

**6. Data mixing**: Including a small percentage of general-domain data during fine-tuning helps maintain broad capabilities. This approach is common in instruction tuning, where general instruction-following data is mixed with domain-specific examples.

## When to Fine-tune vs. Prompt

The decision between fine-tuning and prompt engineering (including in-context learning and RAG) depends on several interconnected factors:

### Favor Prompting When:
- You have fewer than ~100 labeled examples
- The task is well-represented in the model's pre-training data
- You need flexibility to change task definitions quickly
- Latency requirements allow for longer prompts
- You lack GPU infrastructure for training

### Favor Fine-tuning When:
- You have 1,000+ labeled examples (more is better)
- The task requires domain-specific knowledge not in pre-training data
- You need to reduce inference costs (shorter prompts, smaller models)
- Consistency and reliability matter more than flexibility
- You need to encode specific formatting or style requirements

### The Cost Crossover

There is a cost crossover point where fine-tuning becomes cheaper than prompting. Consider a classification task where:

- **Prompting**: Each request includes a system prompt with instructions and examples (~1,000 tokens). At $10/million input tokens, processing 1 million requests costs $10,000 in input tokens alone.
- **Fine-tuning**: A fine-tuned model needs no examples in the prompt (~50 tokens per request). At $10/million input tokens, 1 million requests cost $500. Fine-tuning itself might cost $100-$1,000 depending on dataset size and model.

At scale, fine-tuning amortizes its fixed cost across many inferences. The crossover typically occurs between 10,000 and 100,000 requests, depending on prompt length reduction.

## Data Requirements

The amount of data needed for fine-tuning depends on the task, model size, and desired performance:

### Rules of Thumb

- **Text classification**: 500-5,000 labeled examples per class for strong performance. Fewer examples work with larger pre-trained models.
- **Named entity recognition**: 5,000-20,000 annotated sentences for reasonable coverage of entity types.
- **Instruction tuning**: Research suggests that even 1,000 high-quality instruction-response pairs can meaningfully improve model behavior (Zhou et al., 2023, "LIMA: Less Is More for Alignment").
- **Domain adaptation**: 10,000-100,000 domain-specific documents for continual pre-training before task-specific fine-tuning.

### Data Quality Over Quantity

The LIMA paper demonstrated that 1,000 carefully curated examples can rival models trained on 50,000+ examples of lower quality.

> **Tip:** Before collecting more data, audit the examples you already have. Removing duplicates, correcting label errors, and improving output quality typically yields larger gains than adding raw volume.

Key quality indicators include:

- **Diversity**: Cover the full range of expected inputs
- **Correctness**: Ensure labels/responses are accurate
- **Consistency**: Apply uniform labeling standards
- **Representativeness**: Match the distribution of real production data
- **Difficulty calibration**: Include both easy and hard examples

```python
# Quality filtering heuristic for instruction data
def filter_instruction_data(examples):
    filtered = []
    for ex in examples:
        # Remove very short responses (likely low quality)
        if len(ex['response'].split()) < 20:
            continue
        # Remove exact duplicates
        if ex['instruction'] in seen_instructions:
            continue
        # Remove examples where response doesn't address instruction
        if not is_relevant(ex['instruction'], ex['response']):
            continue
        seen_instructions.add(ex['instruction'])
        filtered.append(ex)
    return filtered
```

## Practical Cost Analysis

Fine-tuning costs encompass compute, data preparation, evaluation, and ongoing maintenance.

### Compute Costs

For full fine-tuning, the compute requirement scales linearly with model size and dataset size. Approximate GPU-hours for single-epoch training:

| Model Size | Dataset (10K examples) | GPU Type | Approximate Time |
|-----------|----------------------|----------|-----------------|
| 350M params | 10K | A100 40GB | ~15 minutes |
| 7B params | 10K | A100 80GB | ~2-4 hours |
| 7B params | 10K | H100 80GB | ~1-2 hours |
| 13B params | 10K | 2x A100 80GB | ~4-8 hours |
| 13B params | 10K | 2x H100 80GB | ~2-4 hours |
| 70B params | 10K | 8x A100 80GB | ~12-24 hours |
| 70B params | 10K | 8x H100 80GB | ~6-12 hours |

Cloud compute costs range from $1.50-$3.50/GPU-hour for A100 instances and $3.00-$5.00/GPU-hour for H100 instances. H100s offer roughly 2x throughput over A100s for transformer fine-tuning thanks to improved tensor cores and higher memory bandwidth (3.35 TB/s vs 2.0 TB/s), often making them more cost-effective despite the higher hourly rate.

A 7B full fine-tune typically costs $5-$15 per run on A100s and $4-$12 on H100s. API-based fine-tuning (OpenAI, Google) abstracts these details but charges per training token.

### Hidden Costs

- **Data preparation**: Often 60-80% of total project time. Cleaning, formatting, deduplicating, and validating training data.
- **Hyperparameter search**: Multiple training runs to find optimal learning rate, batch size, number of epochs.
- **Evaluation infrastructure**: Automated evaluation suites, human evaluation, A/B testing.
- **Model hosting**: Serving a fine-tuned model requires dedicated inference infrastructure.
- **Maintenance**: Models degrade over time as data distributions shift, requiring periodic retraining.

## The Fine-tuning Recipe

Based on accumulated practical experience and research, here is a reliable recipe for instruction-tuning a causal language model. This reflects the dominant modern workflow using TRL's `SFTTrainer`:

```python
from trl import SFTTrainer, SFTConfig
from transformers import AutoModelForCausalLM, AutoTokenizer
from datasets import load_dataset

model_name = "meta-llama/Llama-3.1-8B"
tokenizer = AutoTokenizer.from_pretrained(model_name)
model = AutoModelForCausalLM.from_pretrained(
    model_name,
    torch_dtype="bfloat16",
    attn_implementation="flash_attention_2",  # requires flash-attn package
)

# Dataset should have a "messages" column in chat format
dataset = load_dataset("json", data_files="sft_data.jsonl", split="train")
eval_dataset = load_dataset("json", data_files="sft_eval.jsonl", split="train")

sft_config = SFTConfig(
    output_dir="./sft-results",
    num_train_epochs=3,
    per_device_train_batch_size=2,
    per_device_eval_batch_size=4,
    gradient_accumulation_steps=8,  # effective batch size = 2 * 8 = 16
    learning_rate=2e-5,
    weight_decay=0.01,
    warmup_ratio=0.1,
    lr_scheduler_type="cosine",
    eval_strategy="steps",
    eval_steps=200,
    save_strategy="steps",
    save_steps=200,
    load_best_model_at_end=True,
    metric_for_best_model="eval_loss",
    bf16=True,
    logging_steps=10,
    max_seq_length=4096,
    gradient_checkpointing=True,       # trade compute for ~60% memory savings
    dataloader_num_workers=4,
)

trainer = SFTTrainer(
    model=model,
    args=sft_config,
    train_dataset=dataset,
    eval_dataset=eval_dataset,
    processing_class=tokenizer,
)

trainer.train()
```

For classification or other non-generative tasks, the `Trainer` class with `AutoModelForSequenceClassification` remains appropriate, but for instruction following -- the most common modern use case -- `SFTTrainer` with `AutoModelForCausalLM` is the standard approach. For parameter-efficient alternatives that dramatically reduce compute requirements, see [LoRA, QLoRA & Adapter Methods](/lora-adapters).

### Key Hyperparameters

- **Learning rate**: 1e-5 to 5e-5 for most tasks. Start with 2e-5.
- **Batch size**: As large as GPU memory allows. Use gradient accumulation to simulate larger batches. An effective batch size of 16-64 is typical for SFT.
- **Epochs**: 2-5 for most tasks. Use early stopping. For high-quality SFT datasets (< 10K examples), 3 epochs is a common default.
- **Weight decay**: 0.01-0.1. Helps regularization.
- **Warmup ratio**: 0.06-0.10 of total steps.
- **Max sequence length**: Match your data distribution. Padding to max model length wastes compute. Use `max_seq_length` in `SFTConfig` to truncate.
- **Gradient checkpointing**: Almost always worth enabling for 7B+ models. Reduces memory usage by ~60% at the cost of ~20% slower training.

## Summary and Key Takeaways

- **Transfer learning** is the foundation of modern NLP: pre-train on large unlabeled data, fine-tune on task-specific labeled data. Feature extraction freezes the backbone; full fine-tuning updates everything.
- **SFT for instruction following** is the dominant modern fine-tuning workflow. Use the chat message format, apply the correct chat template, and mask prompt tokens from the loss. TRL's `SFTTrainer` handles these details automatically.
- **Mixed-precision training** is essential. Use bf16 on Ampere+ hardware (A100, H100); fall back to fp16 with loss scaling on older GPUs.
- **Distributed training** is required for 7B+ models in full fine-tuning. Start with FSDP or ZeRO Stage 2 and increase sharding only when memory demands it.
- **Learning rate scheduling** is critical. Use linear warmup (6-10% of steps) followed by cosine decay. Discriminative learning rates and gradual unfreezing offer finer control.
- **Catastrophic forgetting** is a real risk. Mitigate with low learning rates, short training runs, regularization toward pre-trained weights, and data mixing. For a deep treatment, see [Continual Learning: Catastrophic Forgetting & Knowledge Retention](/continual-learning).
- **Fine-tuning vs. prompting** is a cost-benefit analysis. Fine-tuning wins at scale when you have sufficient data; prompting wins for flexibility and low-data regimes.
- **Data quality dominates data quantity**. One thousand high-quality examples can outperform fifty thousand noisy ones (LIMA). See [Dataset Curation: Synthetic Data, Quality Filtering & Annotation](/dataset-curation) for a complete treatment of data preparation.
- **The full fine-tuning recipe** is well-established: AdamW optimizer, cosine schedule with warmup, 2-5 epochs, learning rate around 2e-5, weight decay of 0.01, bf16 precision, gradient checkpointing enabled. Start here and adjust based on validation metrics.
- For most practitioners working with models above 7B parameters, **parameter-efficient methods** ([LoRA, QLoRA](/lora-adapters)) offer a more practical path than full fine-tuning, trading minimal quality for dramatic compute savings.

## Key Takeaways

- **Use `SFTTrainer` with the correct chat template.** Verify the template matches at training and inference time -- silent mismatches are one of the most common causes of degraded SFT performance.
- **Always mask prompt tokens from the loss.** Without masking, the model wastes capacity learning to reproduce instructions rather than generating responses.
- **Default to bf16 + gradient checkpointing.** On A100/H100 hardware this combination maximizes throughput and memory efficiency with no meaningful quality cost.
- **Pick distributed training based on your model size.** Start without distribution, add ZeRO-2 or FSDP when the model doesn't fit, and move to ZeRO-3 only when needed -- each stage adds communication overhead.
- **The cost crossover is real.** At 10,000-100,000+ requests, a fine-tuned model with short prompts will be cheaper than a prompted model with long in-context examples. Calculate this break-even before committing to an approach.
- **Audit data quality before collecting more.** Removing duplicates and correcting label errors in an existing dataset consistently outperforms adding noisy volume.
