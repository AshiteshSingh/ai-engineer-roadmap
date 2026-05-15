# RLHF & Preference Optimization: DPO, ORPO & PPO

Aligning language models with human preferences has become the defining challenge of modern AI engineering, transforming base models that merely predict text into assistants that are helpful, harmless, and honest. This article provides a technical deep-dive into the RLHF pipeline (reward model training and PPO), Direct Preference Optimization (DPO), and emerging alternatives like ORPO and KTO, covering the mathematical foundations, practical implementation details, and the real-world challenges of preference data collection. Understanding these alignment techniques is essential for anyone building production language model systems.

## The Alignment Problem

Pre-trained language models are trained to predict the next token, not to be helpful. A model trained on internet text will cheerfully generate toxic content, hallucinate confidently, or produce verbose non-answers, because all of these patterns exist in its training data. Alignment is the process of steering model behavior toward human preferences without destroying the model's underlying capabilities.

The fundamental challenge is that "helpfulness" and "harmlessness" are not easily expressed as loss functions. We cannot write a differentiable objective that captures what makes a good response. Instead, we rely on human judgments: given two responses, which one is better? This preference signal, while noisy and subjective, turns out to be sufficient to dramatically improve model behavior.

## The RLHF Pipeline

The standard RLHF pipeline, as described in Ouyang et al. (2022) "Training language models to follow instructions with human feedback" (the InstructGPT paper), consists of three stages:

### Stage 1: Supervised Fine-Tuning (SFT)

Before applying RLHF, the base model is fine-tuned on high-quality demonstration data. Human annotators write ideal responses to prompts, and the model is trained to imitate these demonstrations using standard cross-entropy loss.

This stage serves two purposes:
1. It teaches the model the desired format and style of responses
2. It provides a good initialization for the RL phase, which is crucial because RL from a random policy is sample-inefficient

### Stage 2: Reward Model Training

A reward model (RM) is trained to predict human preferences. The RM takes a prompt and response as input and outputs a scalar reward score.

**Data collection**: Human annotators are shown a prompt and multiple model responses (typically 4-9), then rank them from best to worst. These rankings are decomposed into pairwise comparisons: (prompt, chosen_response, rejected_response).

The reward model is trained using the Bradley-Terry preference model:

$$\mathcal{L}_{RM} = -\mathbb{E}_{(x, y_w, y_l) \sim D} [\log \sigma(r_\phi(x, y_w) - r_\phi(x, y_l))]$$

where $y_w$ is the preferred (winning) response, $y_l$ is the rejected (losing) response, and $r_\phi$ is the reward model with parameters $\phi$.

```python
import torch
import torch.nn as nn
from transformers import AutoModelForSequenceClassification

class RewardModel(nn.Module):
    def __init__(self, model_name):
        super().__init__()
        self.model = AutoModelForSequenceClassification.from_pretrained(
            model_name, num_labels=1
        )

    def forward(self, input_ids, attention_mask):
        outputs = self.model(input_ids=input_ids, attention_mask=attention_mask)
        return outputs.logits.squeeze(-1)  # Scalar reward

def reward_loss(reward_model, chosen_ids, chosen_mask, rejected_ids, rejected_mask):
    chosen_reward = reward_model(chosen_ids, chosen_mask)
    rejected_reward = reward_model(rejected_ids, rejected_mask)
    loss = -torch.log(torch.sigmoid(chosen_reward - rejected_reward)).mean()
    return loss, chosen_reward.mean(), rejected_reward.mean()
```

**Reward model sizing**: The RM is typically the same size or slightly smaller than the policy model. Using a much smaller RM risks reward hacking, where the policy exploits weaknesses in the RM's judgment. InstructGPT used a 6B reward model for a 175B policy.

### Stage 3: PPO Optimization

Proximal Policy Optimization (Schulman et al., 2017) is used to optimize the language model policy against the reward model, with a KL divergence penalty to prevent the policy from diverging too far from the SFT model.

The objective is:

$$\max_\pi \mathbb{E}_{x \sim D, y \sim \pi(\cdot|x)} [r_\phi(x, y)] - \beta \cdot D_{KL}[\pi(\cdot|x) || \pi_{ref}(\cdot|x)]$$

The KL penalty is critical: without it, the model learns to produce degenerate outputs that exploit the reward model (reward hacking). The reference policy $\pi_{ref}$ is typically the SFT model.

The PPO algorithm involves:
1. **Rollout**: Generate responses from the current policy
2. **Reward**: Score responses with the reward model
3. **KL penalty**: Compute per-token KL divergence from reference policy
4. **Advantage estimation**: Compute advantages using Generalized Advantage Estimation (GAE)
5. **Policy update**: Update the policy using clipped PPO objective
6. **Value update**: Update the value function (critic)

```python
from trl import PPOConfig, PPOTrainer, AutoModelForCausalLMWithValueHead

# PPO requires a value head for advantage estimation
model = AutoModelForCausalLMWithValueHead.from_pretrained("sft-model")
ref_model = AutoModelForCausalLMWithValueHead.from_pretrained("sft-model")

ppo_config = PPOConfig(
    model_name="sft-model",
    learning_rate=1.41e-5,
    batch_size=64,
    mini_batch_size=16,
    gradient_accumulation_steps=4,
    ppo_epochs=4,
    kl_penalty="kl",
    init_kl_coef=0.2,        # Initial KL penalty coefficient
    target_kl=6.0,            # Target KL divergence
    cliprange=0.2,             # PPO clipping range
    vf_coef=0.1,               # Value function coefficient
)

ppo_trainer = PPOTrainer(
    config=ppo_config,
    model=model,
    ref_model=ref_model,
    tokenizer=tokenizer,
    dataset=prompt_dataset,
)

for batch in ppo_trainer.dataloader:
    # Generate responses
    query_tensors = batch["input_ids"]
    response_tensors = ppo_trainer.generate(query_tensors, max_new_tokens=256)

    # Score with reward model
    rewards = [reward_model(q, r) for q, r in zip(query_tensors, response_tensors)]

    # PPO step
    stats = ppo_trainer.step(query_tensors, response_tensors, rewards)
```

### PPO Challenges

PPO-based RLHF is notoriously difficult to implement and tune:

- **Four models in memory**: Policy, reference policy, reward model, and value head. For a 7B model, this requires 4x the memory of SFT.
- **Training instability**: PPO is sensitive to hyperparameters, especially the KL coefficient, learning rate, and clipping range.
- **Reward hacking**: The policy learns to exploit imperfections in the reward model, producing outputs that score highly but are low quality.
- **Mode collapse**: The policy may converge to a narrow set of "safe" responses that reliably get high rewards.
- **Computational cost**: Each training step requires generation (slow autoregressive sampling), reward model inference, and policy updates.

## DPO: Direct Preference Optimization

### The DPO Insight

Rafailov et al. (2023) in "Direct Preference Optimization: Your Language Model Is Secretly a Reward Model" showed that the RLHF objective has a closed-form solution that maps the optimal policy directly to a function of the preference data, eliminating the need for explicit reward modeling and RL.

The key mathematical insight: given the standard RLHF objective, the optimal policy satisfies:

$$\pi^*(y|x) = \frac{1}{Z(x)} \pi_{ref}(y|x) \exp\left(\frac{1}{\beta} r^*(x, y)\right)$$

This can be rearranged to express the reward in terms of the policy:

$$r^*(x, y) = \beta \log \frac{\pi^*(y|x)}{\pi_{ref}(y|x)} + \beta \log Z(x)$$

Substituting this into the Bradley-Terry preference model and noting that the partition function $Z(x)$ cancels, we get the DPO loss:

$$\mathcal{L}_{DPO} = -\mathbb{E}_{(x, y_w, y_l)} \left[\log \sigma\left(\beta \log \frac{\pi_\theta(y_w|x)}{\pi_{ref}(y_w|x)} - \beta \log \frac{\pi_\theta(y_l|x)}{\pi_{ref}(y_l|x)}\right)\right]$$

### DPO Implementation

DPO is remarkably simple to implement compared to PPO:

```python
from trl import DPOConfig, DPOTrainer

dpo_config = DPOConfig(
    output_dir="./dpo-output",
    num_train_epochs=1,
    per_device_train_batch_size=4,
    gradient_accumulation_steps=8,
    learning_rate=5e-7,        # Very low LR for DPO
    lr_scheduler_type="cosine",
    warmup_ratio=0.1,
    beta=0.1,                  # KL penalty strength
    loss_type="sigmoid",       # Standard DPO loss
    bf16=True,
    gradient_checkpointing=True,
    max_length=2048,
    max_prompt_length=1024,
)

trainer = DPOTrainer(
    model=model,
    ref_model=ref_model,       # Or use implicit reference with peft
    args=dpo_config,
    train_dataset=preference_data,
    tokenizer=tokenizer,
)

trainer.train()
```

### DPO Advantages Over PPO

1. **Simplicity**: No reward model, no value function, no RL optimization loop. DPO is a supervised learning problem.
2. **Memory efficiency**: Only two models (policy + reference) instead of four. With PEFT, the reference can be implicit (the frozen base model).
3. **Training stability**: Standard cross-entropy-like optimization, no PPO clipping or advantage estimation.
4. **Computational efficiency**: No generation step during training. DPO trains directly on preference pairs.

### DPO Limitations

1. **Offline data**: DPO trains on a fixed preference dataset. It cannot explore and discover new behaviors like PPO can.
2. **Distribution mismatch**: As the policy improves, the preference data (generated by the SFT model) becomes off-policy, potentially degrading learning.
3. **Beta sensitivity**: The $\beta$ parameter controls the trade-off between fitting preferences and staying close to the reference. Too low leads to degenerate policies; too high prevents learning.

## ORPO: Odds Ratio Preference Optimization

Hong et al. (2024) proposed ORPO, which eliminates the need for a separate reference model entirely by combining SFT and preference optimization into a single training stage.

ORPO adds an odds ratio-based penalty to the standard SFT loss:

$$\mathcal{L}_{ORPO} = \mathcal{L}_{SFT}(y_w) + \lambda \cdot \mathcal{L}_{OR}$$

where the odds ratio loss penalizes the model for assigning higher odds to rejected responses than chosen responses:

$$\mathcal{L}_{OR} = -\log \sigma\left(\log \frac{odds_\theta(y_w|x)}{odds_\theta(y_l|x)}\right)$$

The odds of a sequence is defined as $odds(y|x) = \frac{P(y|x)}{1 - P(y|x)}$.

ORPO's advantage is efficiency: it requires only one model and one training stage, combining instruction following and preference alignment. The authors showed competitive results with DPO while being simpler to implement.

## KTO: Kahneman-Tversky Optimization

Ethayarajh et al. (2024) introduced KTO, which aligns models using only binary feedback (good/bad) rather than paired preferences. This is significant because binary feedback is far easier to collect than pairwise comparisons.

KTO is grounded in prospect theory (Kahneman & Tversky, 1979), which describes how humans evaluate gains and losses asymmetrically. The KTO loss:

$$\mathcal{L}_{KTO} = \mathbb{E}_{(x,y) \in D_{desirable}} [\lambda_D \sigma(\beta(r_{ref} - r_\theta(x,y)))] + \mathbb{E}_{(x,y) \in D_{undesirable}} [\lambda_U \sigma(\beta(r_\theta(x,y) - r_{ref}))]$$

where $r_\theta(x,y) = \log \frac{\pi_\theta(y|x)}{\pi_{ref}(y|x)}$ is the implicit reward.

KTO can match DPO performance even without paired data, making it practical when you have thumbs-up/thumbs-down feedback but no side-by-side comparisons.

## Preference Data Collection

The quality of alignment depends critically on preference data quality. Several approaches exist:

### Human Annotation

The gold standard. Human annotators compare model outputs and select the better one. Key considerations:

- **Annotator qualification**: Complex tasks require domain expertise. Medical, legal, and coding tasks need specialized annotators.
- **Inter-annotator agreement**: Measure Cohen's kappa or Krippendorff's alpha. Low agreement indicates ambiguous guidelines or subjective tasks.
- **Annotation guidelines**: Detailed rubrics that specify what "better" means across multiple dimensions (helpfulness, accuracy, harmlessness, conciseness).
- **Cost**: Professional annotation costs $15-50 per hour. A typical preference dataset of 50,000 comparisons might cost $50,000-$200,000.

### Synthetic Preference Generation

Using a stronger model (e.g., GPT-4, Claude) to generate preference data for training a weaker model:

```python
def generate_synthetic_preferences(prompts, model_to_evaluate, judge_model):
    """Generate preference pairs using a strong model as judge."""
    preferences = []
    for prompt in prompts:
        # Generate multiple responses from the model being trained
        responses = [model_to_evaluate.generate(prompt) for _ in range(4)]

        # Use a strong model to rank responses
        ranking_prompt = f"""Rank these responses to: "{prompt}"

        Response A: {responses[0]}
        Response B: {responses[1]}
        Response C: {responses[2]}
        Response D: {responses[3]}

        Rank from best to worst with reasoning."""

        ranking = judge_model.generate(ranking_prompt)
        # Parse ranking and create pairwise comparisons
        pairs = create_pairwise_from_ranking(responses, ranking)
        preferences.extend(pairs)

    return preferences
```

This approach, used in papers like "Self-Play Fine-Tuning" (SPIN) and "Constitutional AI" (Bai et al., 2022), is cheaper but introduces the judge model's biases.

### AI Feedback (RLAIF)

Constitutional AI (Anthropic, 2022) replaces human preferences with AI-generated feedback based on a set of principles (a "constitution"). The model critiques its own outputs and selects the response that better adheres to the constitutional principles.

This approach scales more easily than human annotation but depends on the quality of the constitution and the judge model's ability to apply it consistently.

## SimPO: Simple Preference Optimization

Meng et al. (2024) introduced SimPO, which simplifies DPO further by removing the reference model entirely. SimPO uses the average log-probability of a sequence as an implicit reward, arguing that this length-normalized metric better reflects generation quality than DPO's raw log-ratio.

The SimPO reward is defined as:

$$r_{SimPO}(x, y) = \frac{1}{|y|} \log \pi_\theta(y|x) = \frac{1}{|y|} \sum_{t=1}^{|y|} \log \pi_\theta(y_t|x, y_{<t})$$

The length normalization is critical: without it, shorter responses are inherently favored because they accumulate fewer (typically negative) log-probability terms. SimPO also introduces a target reward margin $\gamma$ that explicitly separates winning and losing responses:

$$\mathcal{L}_{SimPO} = -\mathbb{E}_{(x, y_w, y_l)} \left[\log \sigma\left(\frac{\beta}{|y_w|} \log \pi_\theta(y_w|x) - \frac{\beta}{|y_l|} \log \pi_\theta(y_l|x) - \gamma\right)\right]$$

The margin $\gamma$ (typically 0.5-1.5) acts as a minimum reward gap, ensuring the model does not merely make the preferred response slightly better than the rejected one but maintains a meaningful quality difference. SimPO matches or exceeds DPO performance on benchmarks like AlpacaEval 2 and MT-Bench while requiring less memory (no reference model forward passes) and being straightforward to implement.

## Online and Iterative Preference Optimization

A key limitation of standard DPO is that it trains on a static, offline preference dataset -- typically generated by the SFT model before alignment begins. As the policy improves during training, this fixed dataset becomes increasingly off-policy: the preference pairs no longer reflect the kinds of outputs the current model would produce. This distribution mismatch can limit DPO's effectiveness and cause the policy to plateau early.

**Online DPO** addresses this by generating fresh preference data from the current policy at each training iteration. The procedure repeats a cycle:

1. Sample responses from the current policy $\pi_\theta$ for a batch of prompts
2. Score or rank the generated responses (using a reward model, LLM-as-judge, or human raters)
3. Form new preference pairs from the on-policy generations
4. Perform a DPO update on these fresh pairs

This on-policy data generation ensures the training signal remains relevant to the model's current behavior. Empirically, online DPO converges to stronger policies than offline DPO, particularly when the initial preference dataset is small or low-quality (Guo et al., 2024).

**Iterative DPO** (Yuan et al., 2024) extends this idea across multiple rounds. After each DPO training phase, the improved policy generates new candidate responses, which are then judged (often by an LLM-as-judge -- see Article 33) to produce the next round's preference dataset. Each iteration refines both the policy and the quality of the on-policy data:

$$\pi^{(t+1)} = \text{DPO}(\pi^{(t)}, \mathcal{D}^{(t)}) \quad \text{where} \quad \mathcal{D}^{(t)} \sim \pi^{(t)}$$

The trade-off is computational cost: online and iterative variants require generation at each step (the same bottleneck as PPO), partially negating DPO's efficiency advantage. In practice, performing 2-4 iterations with moderate-sized batches offers a favorable balance between data freshness and compute cost.

## Reward-Free RL for Reasoning: GRPO

Group Relative Policy Optimization (GRPO), introduced by Shao et al. (2024) and central to the training of DeepSeek-R1, represents a significant departure from preference-based alignment. Rather than learning from human preference comparisons, GRPO uses verifiable, outcome-based rewards to train reasoning capabilities -- making it one of the most impactful alignment developments for reasoning models.

The core idea is elegantly simple. For each prompt $x$, sample a group of $G$ responses $\{y_1, y_2, \ldots, y_G\}$ from the current policy. Compute a reward $r_i$ for each response using a verification function (e.g., checking mathematical correctness, code execution, or format compliance). Then normalize rewards within the group to compute advantages:

$$\hat{A}_i = \frac{r_i - \text{mean}(\{r_1, \ldots, r_G\})}{\text{std}(\{r_1, \ldots, r_G\})}$$

The policy is updated using a clipped objective similar to PPO, but without a learned value function (critic):

$$\mathcal{L}_{GRPO} = -\frac{1}{G} \sum_{i=1}^{G} \min\left(\frac{\pi_\theta(y_i|x)}{\pi_{old}(y_i|x)} \hat{A}_i, \; \text{clip}\left(\frac{\pi_\theta(y_i|x)}{\pi_{old}(y_i|x)}, 1-\epsilon, 1+\epsilon\right) \hat{A}_i\right) + \beta \cdot D_{KL}[\pi_\theta || \pi_{ref}]$$

GRPO's advantages are substantial for reasoning tasks:

- **No reward model needed**: Verification functions (checking if $2+3=5$, running unit tests) provide ground-truth signal that no learned reward model can match in accuracy.
- **No critic network**: Eliminating the value function reduces memory by roughly 50% compared to PPO, since the group normalization provides a baseline estimate directly.
- **Emergent reasoning**: DeepSeek-R1 demonstrated that GRPO, when applied to sufficiently capable base models, produces emergent chain-of-thought reasoning without explicit chain-of-thought supervision.
- **Scalable supervision**: For domains where correctness is checkable (mathematics, coding, formal logic), verification-based rewards scale without human annotators.

The limitation is clear: GRPO requires tasks with verifiable outcomes. It is not directly applicable to open-ended generation tasks like creative writing or nuanced instruction following, where "correctness" cannot be mechanically verified. In practice, production systems like DeepSeek-R1 combine GRPO for reasoning with preference-based methods (DPO or PPO) for general alignment and helpfulness.

## Process Reward Models vs. Outcome Reward Models

Standard reward models in RLHF are **Outcome Reward Models (ORMs)**: they assign a single scalar score to the entire completed response. This works well for short, straightforward tasks but provides sparse, uninformative signal for multi-step reasoning, where an error in step 3 of a 10-step proof renders all subsequent steps worthless despite potentially correct reasoning within those steps.

**Process Reward Models (PRMs)** address this by providing step-level supervision. A PRM assigns a reward to each intermediate reasoning step, enabling the model to receive credit for correct partial reasoning and targeted penalties for the specific step where an error occurs.

Lightman et al. (2023) demonstrated that PRMs substantially outperform ORMs for mathematical reasoning, particularly when used for best-of-N selection (generating multiple solutions and selecting the one with the highest process reward). The training procedure requires step-level annotations indicating whether each reasoning step is correct:

| Aspect | ORM | PRM |
|--------|-----|-----|
| Supervision granularity | Entire response | Per reasoning step |
| Annotation cost | Low (binary correct/wrong) | High (label each step) |
| Signal density | Sparse | Dense |
| Best for | Short tasks, general alignment | Multi-step reasoning, math, code |
| Credit assignment | Ambiguous | Precise |

PRMs are believed to be a key component in training frontier reasoning models like OpenAI's o1 and o3 series. The dense reward signal allows RL training to more efficiently learn correct reasoning patterns, because the model receives immediate feedback on where its reasoning goes wrong rather than only learning that the final answer was incorrect.

The primary challenge with PRMs is annotation cost: labeling individual reasoning steps requires expert annotators who can evaluate mathematical or logical correctness at each stage. Automated approaches to PRM training -- such as using Monte Carlo rollouts to estimate step-level correctness (Wang et al., 2024) -- are an active research direction that promises to make process supervision more practical. For a deeper discussion of dataset construction for alignment, see Article 22.

## Self-Play and Self-Improvement

A compelling direction in alignment research is training models to improve themselves through self-play, reducing dependence on external human or AI feedback.

**SPIN (Self-Play Fine-Tuning)** by Chen et al. (2024) frames alignment as a two-player game. The current model policy plays against itself from the previous iteration: the "main player" learns to distinguish its own generations from ground-truth human responses, while the "opponent" is the previous iteration's policy. The objective trains the model to generate responses indistinguishable from (and eventually better than) high-quality reference data:

$$\mathcal{L}_{SPIN} = \mathbb{E}_{x \sim D} \left[ f\left(\lambda \log \frac{p_\theta(y_{real}|x)}{p_{\theta_t}(y_{real}|x)} - \lambda \log \frac{p_\theta(y_{synth}|x)}{p_{\theta_t}(y_{synth}|x)}\right) \right]$$

where $y_{real}$ is a human-written response and $y_{synth}$ is generated by the previous iteration $\pi_{\theta_t}$. SPIN converges when the model's generations are indistinguishable from human data -- at which point no further improvement is possible through this mechanism.

**Self-Rewarding Language Models** (Yuan et al., 2024) take a more ambitious approach. The model serves as its own reward model, using LLM-as-judge prompting (see Article 33) to evaluate and score its own outputs. Training proceeds iteratively:

1. Generate candidate responses for a set of prompts
2. Use the model itself (via judge prompting) to create preference pairs
3. Train with DPO on the self-generated preferences
4. Repeat with the improved model

The key finding is that the model's ability to judge quality improves alongside its generation ability, creating a virtuous cycle. Meta's work showed that self-rewarding models can surpass models trained with static human preference data, suggesting that iterative self-improvement may be more effective than collecting ever-larger human annotation datasets.

Both approaches share a philosophical connection with Constitutional AI (see Article 43): the model's own capabilities are leveraged to drive alignment, with varying degrees of human-specified principles guiding the process. The SFT foundations underlying all these methods are covered in Article 19.

## The Alignment Tax

Alignment is not free. The "alignment tax" refers to the performance degradation on raw capability benchmarks that often accompanies alignment training:

- **Reduced creativity**: Aligned models tend toward conservative, "safe" responses
- **Increased refusals**: Models may refuse legitimate requests out of excessive caution
- **Knowledge distortion**: RLHF can cause models to express higher confidence than warranted or avoid certain topics entirely
- **Mode collapse**: The model converges to a narrow behavioral range

Research suggests DPO has a lower alignment tax than PPO, likely because it stays closer to the reference policy. Careful calibration of the $\beta$ parameter (or KL coefficient for PPO) is the primary tool for managing this tradeoff.

## Practical Recommendations

### Choosing an Alignment Method

| Method | Paired Data? | Reference Model? | Complexity | Best For |
|--------|-------------|-------------------|------------|----------|
| PPO | No (uses RM) | Yes + RM + Value | Very High | Maximum quality, large budgets |
| DPO | Yes | Yes | Low | Standard alignment, good static data |
| Online DPO | Generated per iteration | Yes + judge/RM | Medium | Overcoming off-policy data limits |
| SimPO | Yes | No | Very Low | Memory-constrained alignment |
| ORPO | Yes | No | Very Low | Single-stage training |
| KTO | No (binary) | Yes | Low | Binary feedback data |
| GRPO | No (verifiable tasks) | Yes (no critic) | Medium | Reasoning, math, code |

### Data Quality Checklist

1. **Minimum 10,000 preference pairs** for meaningful alignment
2. **Diverse prompts** covering the full distribution of expected use cases
3. **Clear quality gap** between chosen and rejected responses
4. **Consistent annotation guidelines** with regular calibration sessions
5. **Decontamination**: Remove any overlap with evaluation benchmarks

### Hyperparameter Guidance for DPO

- **Beta ($\beta$)**: Start with 0.1. Lower values (0.01-0.05) allow more divergence from the reference; higher values (0.2-0.5) keep the model conservative.
- **Learning rate**: 5e-7 to 5e-6. DPO is sensitive to learning rate; err on the side of too low.
- **Epochs**: Usually 1-3. Overfitting to preference data degrades generation quality.
- **Warmup**: 10% of training steps. Critical for stable DPO training.

## Summary and Key Takeaways

- **RLHF** is the foundational alignment paradigm: train a reward model on human preferences, then optimize the policy with PPO. Effective but complex, memory-intensive, and hard to stabilize.
- **DPO** eliminates the reward model and RL loop by deriving a closed-form loss from the RLHF objective. Simpler, more stable, and more memory-efficient, at the cost of being limited to offline preference data. **Online and iterative DPO** variants address the off-policy limitation by generating fresh preference data from the current policy at each round.
- **SimPO** removes the reference model entirely by using length-normalized log-probabilities as an implicit reward, matching DPO performance with lower memory requirements.
- **ORPO** further simplifies by removing the reference model, combining SFT and alignment in one stage. Good for resource-constrained settings.
- **KTO** enables alignment from binary feedback (thumbs up/down) rather than paired preferences, dramatically reducing data collection requirements.
- **GRPO** enables reward-free RL for reasoning tasks using verification-based rewards and group-relative advantage estimation. It was central to training DeepSeek-R1 and represents a major advance for reasoning alignment.
- **Process Reward Models** provide step-level supervision for multi-step reasoning, offering denser training signal than outcome-level rewards and enabling more precise credit assignment.
- **Self-play methods** (SPIN, Self-Rewarding LMs) allow models to iteratively improve using their own generations and judgments, reducing dependence on external annotation.
- **Preference data quality** is the bottleneck for all methods. Invest in clear annotation guidelines, diverse prompts, and quality control (see Article 22).
- **Synthetic preferences** from stronger models (see Article 33 on LLM-as-Judge) offer a scalable alternative to human annotation but introduce the judge model's biases.
- The **alignment tax** is real: alignment training reduces raw capabilities. Manage it by carefully tuning the KL penalty (beta) and monitoring capability benchmarks alongside alignment metrics.
- For most practitioners, **DPO with high-quality preference data and QLoRA** (see Article 19) is the recommended starting point. Consider online DPO if static data proves insufficient. Move to PPO or GRPO for reasoning-heavy applications where you have verifiable outcomes and the engineering resources.
