# Continual Learning: Catastrophic Forgetting & Knowledge Retention

Catastrophic forgetting -- the tendency of neural networks to abruptly lose previously learned knowledge when trained on new tasks -- is one of the most fundamental challenges in machine learning and a critical practical concern for anyone fine-tuning or updating language models. This article provides a technical deep-dive into the mechanisms behind catastrophic forgetting, surveys the major mitigation strategies (elastic weight consolidation, progressive networks, replay buffers, knowledge distillation), and examines how these ideas apply to continual pre-training and domain adaptation of large language models. The ability to update models without destroying existing capabilities is increasingly essential as organizations deploy and iterate on LLM-based systems.

## TL;DR

- Catastrophic forgetting happens because gradient updates for new tasks destructively overwrite weights that encode old knowledge -- a fundamental consequence of parameter sharing.
- **EWC** uses the Fisher information matrix to protect important parameters; **replay buffers** mix in old examples; **knowledge distillation** preserves the previous model's output distribution.
- For large language models, **data mixing** (60-70% domain, 30-40% general) during continual pre-training is the most practical and effective forgetting mitigation.
- **LoRA adapters** eliminate forgetting of base model knowledge by design -- the base is never modified -- at the cost of single-domain inference per adapter.
- **Model merging** (TIES, DARE, SLERP) offers an alternative: train specialists independently, then combine their weight deltas without any sequential fine-tuning.

## Why Neural Networks Forget

### The Stability-Plasticity Dilemma

The stability-plasticity dilemma, first articulated in the context of adaptive resonance theory by Grossberg (1980), describes a fundamental tension in learning systems: a system must be **plastic** enough to learn new information, but **stable** enough to retain old knowledge. Standard neural networks trained with gradient descent are heavily biased toward plasticity -- they eagerly overwrite old parameters to accommodate new data.

The root cause is parameter sharing. In a neural network, every input is processed through the same set of weights. When those weights are optimized for task B, they are no longer optimal for task A unless the tasks share substantial structure. This is qualitatively different from how biological memory works, where new memories can be formed without overwriting existing ones.

### Catastrophic Forgetting in Practice

Consider a concrete scenario: you have a language model fine-tuned on medical question-answering that performs well on clinical queries. You then fine-tune it on legal question-answering. After legal fine-tuning, the model's medical performance degrades significantly -- not because it is incapable of both tasks, but because the gradient updates for legal tasks destructively interfere with the weight configurations that enabled medical performance.

The severity of forgetting depends on:

| Factor | Direction | Why |
|--------|-----------|-----|
| Task similarity | More dissimilar = more forgetting | Less shared structure in weights |
| Dataset size imbalance | Small new dataset + aggressive training = faster forgetting | Gradient signal dominated by new task |
| Model capacity | Larger models forget less | More capacity to encode multiple tasks without interference |
| Learning rate | Higher = faster, more severe forgetting | Larger parameter updates overwrite more |
| Training duration | Longer on new task = more forgetting of old | Accumulated overwriting of old parameter regions |

### Measuring Forgetting

The standard metric for catastrophic forgetting is **backward transfer** (BWT):

$$BWT = \frac{1}{T-1} \sum_{i=1}^{T-1} (R_{T,i} - R_{i,i})$$

where $R_{j,i}$ is the performance on task $i$ after training on task $j$, and $T$ is the total number of tasks. Negative BWT indicates forgetting.

**Forward transfer** (FWT) measures whether learning previous tasks helps with future tasks:

$$FWT = \frac{1}{T-1} \sum_{i=2}^{T} (R_{i-1,i} - R_{0,i})$$

where $R_{0,i}$ is the performance on task $i$ before any training (random initialization or base model).

## Elastic Weight Consolidation (EWC)

### The Fisher Information Approach

Kirkpatrick et al. (2017) introduced Elastic Weight Consolidation (EWC), drawing inspiration from Bayesian learning. The key insight: after learning task A, we can estimate which parameters are important for task A using the Fisher information matrix, then penalize changes to those parameters when learning task B.

The Fisher information matrix $F$ approximates the curvature of the loss landscape around the learned parameters $\theta^*_A$. Parameters with high Fisher information are important for task A (changing them would significantly increase the loss), while parameters with low Fisher information can be freely modified.

The EWC loss for learning task B:

$$\mathcal{L}_{EWC} = \mathcal{L}_B(\theta) + \frac{\lambda}{2} \sum_i F_i (\theta_i - \theta^*_{A,i})^2$$

where $F_i$ is the diagonal of the Fisher information matrix for parameter $i$, and $\lambda$ controls the strength of the regularization.

```python
import torch
import torch.nn as nn
from copy import deepcopy

class EWC:
    def __init__(self, model, dataloader, device, lambda_ewc=1000):
        self.model = model
        self.lambda_ewc = lambda_ewc
        self.device = device

        # Store the parameters after learning the previous task
        self.prev_params = {
            name: param.clone().detach()
            for name, param in model.named_parameters()
            if param.requires_grad
        }

        # Compute Fisher information matrix (diagonal approximation)
        self.fisher = self._compute_fisher(dataloader)

    def _compute_fisher(self, dataloader):
        """Compute diagonal Fisher information matrix."""
        fisher = {
            name: torch.zeros_like(param)
            for name, param in self.model.named_parameters()
            if param.requires_grad
        }

        self.model.eval()
        for batch in dataloader:
            self.model.zero_grad()
            input_ids = batch["input_ids"].to(self.device)
            attention_mask = batch["attention_mask"].to(self.device)
            labels = batch["labels"].to(self.device)

            outputs = self.model(
                input_ids=input_ids,
                attention_mask=attention_mask,
                labels=labels
            )
            loss = outputs.loss
            loss.backward()

            for name, param in self.model.named_parameters():
                if param.requires_grad and param.grad is not None:
                    fisher[name] += param.grad.detach() ** 2

        # Average over dataset
        for name in fisher:
            fisher[name] /= len(dataloader)

        return fisher

    def penalty(self):
        """Compute EWC penalty to add to the current task's loss."""
        loss = 0
        for name, param in self.model.named_parameters():
            if name in self.fisher:
                loss += (self.fisher[name] *
                        (param - self.prev_params[name]) ** 2).sum()
        return self.lambda_ewc * loss

# Usage during training on task B
ewc = EWC(model, task_a_dataloader, device)

for batch in task_b_dataloader:
    outputs = model(**batch)
    task_loss = outputs.loss
    ewc_loss = ewc.penalty()
    total_loss = task_loss + ewc_loss
    total_loss.backward()
    optimizer.step()
```

### Limitations of EWC

- **Diagonal approximation**: The full Fisher information matrix is too large to compute for modern networks (it is $n \times n$ where $n$ is the number of parameters). The diagonal approximation ignores parameter interactions.
- **Scaling to many tasks**: As more tasks are added, the number of constraints grows linearly. The model may run out of "free" parameters.
- **Lambda tuning**: The regularization strength $\lambda$ is hard to set. Too high prevents learning; too low permits forgetting.

> **Note:** For large language models, EWC is rarely used directly due to the computational cost of estimating Fisher information across billions of parameters. Data mixing and LoRA-based approaches are more practical at scale.

## Progressive Networks

Rusu et al. (2016) proposed progressive networks, which take a radically different approach: instead of modifying existing parameters, add new parameters for each task and freeze old ones.

For each new task, a new column (set of layers) is added to the network, with lateral connections to all previous columns. The previous columns are frozen, guaranteeing zero forgetting.

```text
Task 1:  [Input] -> [Layer 1a] -> [Layer 2a] -> [Output A]
Task 2:  [Input] -> [Layer 1b] -> [Layer 2b] -> [Output B]
                       ^              ^
                  [Lateral from 1a] [Lateral from 2a]
Task 3:  [Input] -> [Layer 1c] -> [Layer 2c] -> [Output C]
                       ^  ^           ^  ^
                  [From 1a,1b]   [From 2a,2b]
```

Progressive networks guarantee zero forgetting but have a critical drawback: the model grows linearly with the number of tasks. This makes them impractical for scenarios with many tasks, but the architecture has influenced more practical approaches like adapter-based continual learning.

> **Tip:** LoRA adapters are effectively a practical, parameter-efficient version of the progressive networks idea -- each new adapter adds capacity for a new task without touching existing weights.

## Replay-Based Methods

### Experience Replay

Replay methods maintain a memory buffer of examples from previous tasks and interleave them during training on new tasks. This is the simplest and often most effective approach to continual learning:

```python
class ReplayBuffer:
    def __init__(self, max_size=5000):
        self.buffer = []
        self.max_size = max_size

    def add_task_data(self, task_data, samples_to_keep=1000):
        """Add representative samples from a completed task."""
        if len(task_data) > samples_to_keep:
            # Reservoir sampling or stratified sampling
            selected = random.sample(task_data, samples_to_keep)
        else:
            selected = task_data

        self.buffer.extend(selected)

        # If buffer exceeds max, remove oldest examples proportionally
        if len(self.buffer) > self.max_size:
            self.buffer = random.sample(self.buffer, self.max_size)

    def sample(self, batch_size):
        """Sample a batch from the replay buffer."""
        return random.sample(self.buffer, min(batch_size, len(self.buffer)))

# Training loop with replay
replay = ReplayBuffer(max_size=10000)

for task_id, task_data in enumerate(tasks):
    for epoch in range(num_epochs):
        for batch in task_data:
            # Train on current task
            loss = compute_loss(model, batch)

            # Mix in replay examples
            if len(replay.buffer) > 0:
                replay_batch = replay.sample(batch_size=len(batch) // 4)
                replay_loss = compute_loss(model, replay_batch)
                loss = loss + 0.5 * replay_loss

            loss.backward()
            optimizer.step()

    # After training on task, add samples to replay buffer
    replay.add_task_data(task_data)
```

### Generative Replay

Instead of storing raw examples, use a generative model to synthesize examples from previous tasks. This avoids the memory overhead of storing examples but requires maintaining a generative model. For language models, this can mean using the model itself to generate responses to stored prompts:

```python
def generative_replay(model, stored_prompts, n_samples=100):
    """Generate synthetic examples from previous tasks using the model."""
    replay_data = []
    sampled_prompts = random.sample(stored_prompts, n_samples)

    for prompt in sampled_prompts:
        # Generate response using current model
        response = model.generate(prompt, max_tokens=512, temperature=0.7)
        replay_data.append({"prompt": prompt, "response": response})

    return replay_data
```

This approach is related to self-distillation: the model's current knowledge is "replayed" through generation, preventing it from forgetting how to respond to previous task types.

## Knowledge Distillation for Retention

Knowledge distillation, originally proposed by Hinton et al. (2015) for model compression, can be repurposed for knowledge retention during continual learning. The idea is to use the model's state before new training as a "teacher" and regularize the updated model (student) to match the teacher's output distribution.

```python
def distillation_loss(student_logits, teacher_logits, temperature=2.0):
    """KL divergence between student and teacher distributions."""
    student_probs = F.log_softmax(student_logits / temperature, dim=-1)
    teacher_probs = F.softmax(teacher_logits / temperature, dim=-1)
    return F.kl_div(student_probs, teacher_probs, reduction='batchmean') * (temperature ** 2)

# During continual learning
teacher_model = deepcopy(model)  # Snapshot before new training
teacher_model.eval()

for batch in new_task_data:
    student_outputs = model(**batch)
    with torch.no_grad():
        teacher_outputs = teacher_model(**batch)

    task_loss = student_outputs.loss
    distill_loss = distillation_loss(
        student_outputs.logits, teacher_outputs.logits
    )
    total_loss = task_loss + alpha * distill_loss
    total_loss.backward()
```

This is similar to EWC but operates on the output distribution rather than individual parameters. It is often more effective because it preserves functional behavior rather than specific weight values.

## Continual Pre-training Strategies

For large language models, "continual pre-training" refers to extending pre-training on domain-specific corpora to inject new knowledge without losing general capabilities. This is distinct from fine-tuning, which adapts the model to a specific task format.

### Data Mixing

The most common approach is to mix domain-specific data with general-domain data during continued pre-training:

```python
def create_mixed_dataloader(domain_data, general_data, domain_ratio=0.7):
    """Create a dataloader that mixes domain and general data."""
    combined = []
    domain_samples = int(len(domain_data) * domain_ratio / (1 - domain_ratio))
    general_samples = min(len(general_data), domain_samples)

    # Oversample domain data if needed
    while len(combined) < domain_samples + general_samples:
        combined.extend(random.sample(
            domain_data,
            min(len(domain_data), domain_samples - len(combined))
        ))

    # Add general data
    combined.extend(random.sample(general_data, general_samples))
    random.shuffle(combined)

    return DataLoader(combined, batch_size=batch_size, shuffle=True)
```

Research suggests domain ratios of 50-80% work well, with the remainder being general-domain data for retention. The optimal ratio depends on how different the domain is from the pre-training distribution.

### Learning Rate Considerations

Continual pre-training typically uses a lower learning rate than initial pre-training:

| Stage | Typical learning rate |
|-------|-----------------------|
| Initial pre-training | 1e-4 to 3e-4 |
| Continual pre-training | 1e-5 to 5e-5 |
| Task-specific fine-tuning | 1e-5 to 5e-5 |

The warmup-stable-decay (WSD) schedule is particularly useful for continual pre-training because checkpoints from the stable phase maintain good general performance and can be decayed independently for different downstream uses.

### Curriculum Strategies

Rather than randomly mixing data, curriculum-based approaches order training examples from general to specific:

| Phase | General data | Domain data | Purpose |
|-------|-------------|-------------|---------|
| Phase 1 | 80% | 20% | Preserve general capabilities, introduce domain |
| Phase 2 | 50% | 50% | Balanced transition |
| Phase 3 | 20% | 80% | Focused domain training with retention anchor |

This gradual transition helps the model build domain knowledge incrementally without sharp distribution shifts.

### Curriculum Ordering and Learning Rate Interactions

The interaction between data ordering and learning rate schedules is an active area of research with practical implications for continual pre-training. Naive curriculum strategies -- moving from general to domain-specific data -- can underperform if the learning rate schedule is not aligned with the transition.

**Cosine decay misalignment**: A standard cosine schedule reaches its lowest learning rates at the end of training. If the most important domain-specific data is concentrated in the final phase, the model may lack sufficient plasticity to absorb it. The warmup-stable-decay (WSD) schedule addresses this by maintaining a constant learning rate during the "stable" phase (where most training occurs) and only decaying in a final annealing phase. This pairs well with curriculum strategies because the learning rate remains high enough throughout the domain transition to incorporate new knowledge.

**Cyclical curricula**: Rather than a single general-to-specific transition, recent work explores cyclical data orderings that alternate between general and domain-specific batches within each epoch. This interleaving prevents the model from "settling" into a domain-specific loss basin and forgetting general capabilities. Empirically, cyclical curricula with a constant or slowly decaying learning rate often match or outperform linear transitions while being simpler to implement.

**Difficulty-aware scheduling**: Building on the curriculum learning ideas from pre-training (see [Pre-training: Data Curation, Objectives & Curriculum](/pretraining-data)), difficulty-aware continual pre-training orders domain-specific data by perplexity under the base model. Documents with moderate perplexity (novel but not incomprehensible) are presented first, followed by higher-perplexity material. This prevents the model from encountering highly out-of-distribution text before it has built intermediate representations, reducing the gradient variance that drives forgetting.

**Practical recommendation**: For continual pre-training runs, pair a WSD learning rate schedule with a two-phase curriculum -- (1) mixed general/domain data at the stable learning rate for 70-80% of training, then (2) domain-heavy data during the decay phase. This combines the retention benefits of data mixing with the efficiency of focused domain training during annealing, mirroring the phase-based approach that has become standard in initial pre-training.

## Domain Adaptation Without Regression

### The Evaluation Framework

To ensure domain adaptation does not cause regression, maintain a comprehensive evaluation suite:

```python
class ContinualLearningEvaluator:
    def __init__(self, benchmarks):
        self.benchmarks = benchmarks  # Dict of name -> eval_fn
        self.baseline_scores = {}

    def establish_baseline(self, model):
        """Record performance before adaptation."""
        for name, eval_fn in self.benchmarks.items():
            self.baseline_scores[name] = eval_fn(model)
        print("Baseline scores:", self.baseline_scores)

    def evaluate_regression(self, model, threshold=0.02):
        """Check for performance regression after adaptation."""
        regressions = []
        for name, eval_fn in self.benchmarks.items():
            current = eval_fn(model)
            baseline = self.baseline_scores[name]
            delta = current - baseline

            if delta < -threshold:
                regressions.append({
                    'benchmark': name,
                    'baseline': baseline,
                    'current': current,
                    'regression': abs(delta)
                })
                print(f"REGRESSION on {name}: {baseline:.4f} -> {current:.4f} "
                      f"({delta:+.4f})")
            else:
                print(f"OK on {name}: {baseline:.4f} -> {current:.4f} "
                      f"({delta:+.4f})")

        return regressions

# Example usage
evaluator = ContinualLearningEvaluator({
    'mmlu': evaluate_mmlu,
    'hellaswag': evaluate_hellaswag,
    'gsm8k': evaluate_gsm8k,
    'domain_specific': evaluate_domain,
})

evaluator.establish_baseline(model)
# ... perform continual pre-training ...
regressions = evaluator.evaluate_regression(model)
```

### Practical Recipe for Domain Adaptation

Based on accumulated research and practice, a reliable recipe for domain adaptation:

1. **Establish baselines** on general benchmarks before any training
2. **Continual pre-training** with 60-70% domain data, 30-40% general data
3. Use **learning rate of 2e-5** with cosine decay and 5% warmup
4. Train for **1-3 epochs** over the domain corpus
5. **Evaluate** general benchmarks every 500 steps and stop if regression exceeds 2%
6. **Task-specific fine-tuning** after continual pre-training, using standard SFT
7. Final evaluation on both domain and general benchmarks

### LoRA for Continual Learning

Parameter-efficient methods like LoRA offer a natural solution to continual learning: train separate adapters for different tasks/domains while keeping the base model frozen. This guarantees zero forgetting of base model knowledge (it is never modified) and enables task switching by swapping adapters.

```python
from peft import LoraConfig, get_peft_model

# Create domain-specific adapter
medical_config = LoraConfig(r=16, target_modules="all-linear", task_type="CAUSAL_LM")
medical_model = get_peft_model(base_model, medical_config)
# Train on medical data...
medical_model.save_pretrained("medical-adapter")

# Create legal adapter from same base
legal_config = LoraConfig(r=16, target_modules="all-linear", task_type="CAUSAL_LM")
legal_model = get_peft_model(base_model, legal_config)
# Train on legal data...
legal_model.save_pretrained("legal-adapter")

# At inference, load whichever adapter is needed
# Base model knowledge is perfectly preserved in both cases
```

This approach trades off integrated multi-task performance (the model can only do one domain at a time) for guaranteed knowledge retention. For a full treatment of LoRA mechanics, rank selection, and QLoRA, see [LoRA, QLoRA & Adapter Methods](/lora-adapters).

## Case Studies in Domain Adaptation

The continual pre-training pipeline -- base model, continued pre-training on domain data, supervised fine-tuning, alignment -- is now well-established enough that several high-profile models serve as instructive case studies. Each illustrates different trade-offs in data curation, training duration, and forgetting mitigation.

### CodeLlama: Code Domain Adaptation

Meta's CodeLlama (Roziere et al., 2023) adapted Llama 2 to code through a multi-stage pipeline that demonstrates the full continual learning arc:

1. **Continual pre-training**: Starting from Llama 2 7B/13B/34B checkpoints, the team performed continued pre-training on 500B tokens of primarily code data (publicly available code repositories, with a small fraction of natural language data mixed in for retention). The learning rate was set significantly lower than the original Llama 2 pre-training, following the standard continual pre-training practice.
2. **Long-context fine-tuning**: A dedicated stage extended the context window from 4K to 16K tokens using a modified RoPE frequency base, trained on an additional 20B tokens of long code sequences. This is a form of capability extension that required careful learning rate management to avoid regressing short-context performance.
3. **Instruction tuning**: CodeLlama-Instruct variants received SFT on a mixture of code-specific instruction data and general instruction data, preserving both coding ability and conversational quality.
4. **Infilling specialization**: A separate variant was trained with a fill-in-the-middle (FIM) objective, demonstrating that you can branch the continual learning pipeline to produce multiple specialists from the same intermediate checkpoint.

The key lesson from CodeLlama is the importance of data volume: 500B tokens of code data -- roughly 10-15x the code data in the original Llama 2 pre-training mix -- was necessary to achieve strong coding performance. Shorter continual pre-training runs produced models that improved at code but fell short of dedicated code models.

On general benchmarks (MMLU, common-sense reasoning), CodeLlama retained most of Llama 2's capabilities, with regressions under 2% on most tasks -- a testament to the natural-language data mixed into training and the conservative learning rate.

### BioMistral: Medical Domain Adaptation

BioMistral (Labrak et al., 2024) adapted Mistral 7B to the biomedical domain, providing a case study in domain adaptation at moderate scale with a narrower target domain:

1. **Continual pre-training**: The team trained on PubMed Central articles -- approximately 3B tokens of biomedical text. This is a much smaller corpus than CodeLlama's, reflecting the constrained size of high-quality medical text relative to code. The data mix included no general-domain replay, relying instead on the relatively short training duration (roughly 1 epoch over the PubMed data) to limit forgetting.
2. **Evaluation-driven iteration**: BioMistral was evaluated on a suite of medical QA benchmarks (MedQA, PubMedQA, MedMCQA) and general benchmarks (MMLU) at regular intervals during training. The team observed that medical performance improved steadily while general performance showed modest degradation, consistent with the absence of general-domain replay data.
3. **SFT and alignment**: Medical instruction tuning used a curated dataset of medical question-answer pairs. The SFT stage recovered some general capability by including a small fraction of general instruction data.

BioMistral demonstrates both the power and the risk of domain-specialized continual pre-training without replay. Medical benchmark performance improved substantially (5-10% on MedQA variants), but general MMLU performance dropped by 3-5% -- more than the CodeLlama case, likely because no general data was mixed into the continual pre-training stage.

> **Note:** This underscores the practical recommendation from the data mixing section above: even a 20-30% general data component during continual pre-training significantly reduces regression.

### Multilingual Adaptation: Extending to New Languages

Adapting English-centric models to new languages represents a particularly challenging continual learning problem because the new "domain" (a different language) has minimal lexical overlap with the source. Several projects illustrate the pattern:

The typical pipeline for multilingual adaptation adds a preliminary step: **vocabulary extension**. The base model's tokenizer is augmented with tokens from the target language to reduce the fertility rate (tokens per word), which directly affects both training efficiency and inference cost. After vocabulary extension, the embedding layer is resized and new embeddings are randomly initialized, while existing embeddings remain frozen or are updated with a much lower learning rate.

Continual pre-training then proceeds on a mix of target-language text (60-80%) and English text (20-40%), with the English component serving as both a retention mechanism and a cross-lingual alignment signal. Learning rates are typically higher than in same-language domain adaptation because the model must learn fundamentally new representations -- new token embeddings, new syntactic patterns -- rather than refining existing ones.

> **Note:** A common failure mode in multilingual adaptation is "translationese" -- the model learns to generate the target language but with English syntax and phrasing patterns, producing text that is grammatically correct but stylistically unnatural. This is mitigated by ensuring the target-language training data includes diverse registers and native text rather than translated content. See [Pre-training: Data Curation, Objectives & Curriculum](/pretraining-data) for related data provenance and quality filtering guidance.

## Model Merging as an Alternative to Sequential Training

The continual learning methods discussed above -- EWC, replay, distillation, data mixing -- all address forgetting within a single sequential training run. Model merging takes a fundamentally different approach: train multiple specialized models independently from the same base, then combine their weights into a single multi-domain model without any additional training. For a detailed treatment of merging algorithms and tooling, see [Distillation & Model Compression](/distillation-compression).

### Why Merging Sidesteps Forgetting

The core insight is that merging avoids the sequential training problem entirely. Instead of training on domain A then domain B (risking forgetting of A), you train model-A on domain A and model-B on domain B independently, both starting from the same base checkpoint. Merging then combines the two sets of learned "task vectors" (the delta between each fine-tuned model and the base). Because neither model was ever exposed to the other's data during training, there is no opportunity for gradient interference during learning.

The trade-off is different from continual learning: merging does not guarantee that the combined model retains the full performance of either specialist. When task vectors conflict (a parameter that model-A pushed up and model-B pushed down), the merged model must compromise. The severity of these conflicts depends on how different the two domains are and how much the fine-tuning modified overlapping parameters.

### TIES, DARE, and SLERP for Multi-Domain Models

The three dominant merging strategies address task-vector conflicts in different ways:

- **TIES** (Trim, Elect Sign, Merge) resolves sign conflicts by majority vote and trims low-magnitude deltas as noise. This is most effective when merging 3+ models, where sign election has enough "voters" to produce a reliable consensus. For two-model merges, TIES often reduces to simple averaging with pruning.
- **DARE** (Drop and Rescale) randomly drops 90-99% of each task vector's parameters before merging, then rescales the survivors. This works because fine-tuning produces highly redundant parameter updates, and random subsets capture the essential adaptation. DARE is particularly effective when merged models have been fine-tuned on similar data distributions, where parameter redundancy is highest.
- **SLERP** (Spherical Linear Interpolation) is limited to two-model merges but produces smoother interpolations by traversing a geodesic on the weight hypersphere rather than interpolating linearly. SLERP tends to outperform linear averaging when the two models have diverged significantly from each other.

### Merging vs. Continual Learning: When to Use Which

| Criterion | Prefer model merging | Prefer continual learning |
|-----------|---------------------|--------------------------|
| Compute budget | Can train specialists in parallel | Limited; sequential training only |
| Domain structure | Well-separated (code, medical, legal) | Sequential stream; overlapping domains |
| Inference requirement | Single model, multiple domains | Tight performance balance needed |
| Iteration pattern | Update individual domains independently | Capability extension (context, modalities) |

In practice, the two approaches are often combined. A team might use continual pre-training to adapt a base model to a broad domain (e.g., all of biomedicine), then train multiple SFT specialists from that checkpoint (radiology, genomics, clinical notes), and finally merge the SFT specialists using TIES or DARE.

This hybrid pipeline captures the benefits of deep domain adaptation from continual pre-training and the forgetting-free combination of narrow specializations from merging. The fine-tuning fundamentals discussed in [Fine-tuning Fundamentals](/fine-tuning-fundamentals) apply at each stage of this pipeline, from learning rate selection to evaluation strategy.

## Emerging Approaches

### O-LoRA: Orthogonal Low-Rank Adaptation

Wang et al. (2023) proposed constraining successive LoRA adapters to be orthogonal to each other, ensuring that new adaptations do not interfere with previous ones. This extends the progressive networks idea to the parameter-efficient setting.

### TRACE: Task Recognition and Adaptation for Continual Evaluation

Rather than preventing forgetting, TRACE systems detect which task is being requested and route to the appropriate adapter or model variant. This converts the continual learning problem into a task identification problem plus a library of specialists.

### Continual Instruction Tuning

Recent work on continual instruction tuning explores how to add new instruction-following capabilities without degrading existing ones. Key findings:
- Mixing 5-10% of data from previous instruction sets during new training significantly reduces forgetting
- Task-specific tokens or system prompts can help the model maintain distinct behavioral modes
- Evaluation should cover not just accuracy but also formatting, tone, and refusal behavior

## Summary and Key Takeaways

- **Catastrophic forgetting** is caused by the fundamental stability-plasticity dilemma: neural networks trained with gradient descent aggressively overwrite old knowledge to accommodate new data.
- **Elastic Weight Consolidation (EWC)** uses the Fisher information matrix to identify and protect important parameters, but the diagonal approximation limits its effectiveness for large models.
- **Progressive networks** eliminate forgetting by adding new parameters per task, but grow linearly and are impractical for many tasks.
- **Replay buffers** are the simplest and often most effective approach: store examples from previous tasks and mix them into new training. Generative replay avoids storing raw data.
- **Knowledge distillation** regularizes the updated model to match the previous model's output distribution, preserving functional behavior rather than specific weight values.
- **Continual pre-training** requires careful data mixing (60-70% domain, 30-40% general), lower learning rates, and continuous regression monitoring. Curriculum ordering should be aligned with the learning rate schedule -- pairing WSD schedules with phased curricula is a reliable default.
- **Domain adaptation case studies** (CodeLlama, BioMistral, multilingual models) confirm that data volume, general-domain replay, and conservative learning rates are the dominant factors in successful continual pre-training. Omitting general-domain replay consistently increases regression on general benchmarks.
- **Model merging** (TIES, DARE, SLERP) offers a forgetting-free alternative to sequential training by combining independently trained specialists. It is most effective when domains are well-separated and can be combined with continual pre-training in hybrid pipelines.
- **LoRA adapters** provide a natural continual learning solution by keeping the base model frozen and training separate adapters per domain, at the cost of single-domain inference (see [LoRA, QLoRA & Adapter Methods](/lora-adapters)).
- The practical recipe is: **establish baselines, mix domain and general data, use conservative learning rates with WSD scheduling, monitor regression continuously, and stop early if general capabilities degrade**.

## Key Takeaways

- **Always establish baselines before any training.** You cannot detect regression without a measured starting point. Evaluate on general benchmarks (MMLU, HellaSwag, GSM8K) and your domain benchmarks before touching the model.
- **Include at least 20-30% general data during continual pre-training.** The BioMistral case study shows that omitting general-domain replay causes 3-5% regression on general benchmarks -- more than the CodeLlama case where replay was included.
- **Use LoRA adapters when base model knowledge must be fully preserved.** Training separate adapters per domain guarantees zero forgetting of the base model, trading off integrated multi-domain performance for guaranteed retention.
- **Align your learning rate schedule with your curriculum.** Cosine decay reaches its lowest LR just as domain-specific data should be most impactful in a late-phase curriculum. Use WSD instead to keep plasticity high during the domain-heavy phase.
- **Monitor regression every 500 steps and stop early.** Define a regression threshold (e.g., 2% drop on any general benchmark) before training starts and treat it as a hard stop condition, not a warning.
- **Consider model merging before committing to sequential training.** If you have budget for parallel training runs, TIES or DARE merging of independently trained specialists often achieves better multi-domain performance than sequential fine-tuning with replay.
