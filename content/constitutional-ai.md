# Constitutional AI & RLHF for Safety

Constitutional AI (CAI) represents a paradigm shift in how we train language models to be helpful, harmless, and honest. Rather than relying solely on human feedback to shape model behavior, CAI uses a set of explicit principles -- a "constitution" -- to guide self-critique and revision, dramatically reducing the need for human-labeled harmlessness data. This article examines the mechanics of CAI, its relationship to RLHF, and how these techniques scale supervision of increasingly capable models.

## The Safety Problem in Language Models

Large language models trained on internet text inevitably learn to produce harmful, biased, and deceptive outputs. The fundamental challenge is alignment: ensuring models behave in ways consistent with human values and intentions. Early approaches relied on simple keyword filtering and rule-based systems, but these proved brittle against the combinatorial explosion of ways harmful content can be expressed.

The deeper problem is that helpfulness and harmlessness can conflict. A maximally helpful model answers every question completely, including requests for dangerous information. A maximally safe model refuses everything remotely sensitive, becoming useless. The alignment challenge is finding the right balance, and doing so in a way that scales.

### Why Pure Supervised Fine-Tuning Falls Short

Supervised fine-tuning (SFT) on curated datasets teaches models to mimic safe responses but does not teach them to reason about safety. Models learn surface patterns -- refusing certain keywords, adding disclaimers -- without understanding why certain outputs are harmful. This leads to overfitting to refusal patterns where models refuse benign requests that superficially resemble harmful ones, brittleness to rephrasing where slight rewording bypasses safety training, and poor generalization where novel harmful requests not in the training set go undetected.

## RLHF: The Foundation

Reinforcement Learning from Human Feedback (RLHF), as described in Ouyang et al. (2022) "Training language models to follow instructions with human feedback," established the modern paradigm for aligning language models. The process involves three stages.

### Stage 1: Supervised Fine-Tuning

A pretrained model is fine-tuned on high-quality demonstration data -- examples of desired behavior written by human annotators. This gives the model a starting distribution of helpful, safe responses.

### Stage 2: Reward Model Training

Human annotators compare pairs of model outputs and indicate which is better. These preference labels train a reward model (RM) that predicts human preferences. The reward model learns a scalar score function:

```python
class RewardModel(nn.Module):
    def __init__(self, base_model):
        super().__init__()
        self.backbone = base_model
        self.reward_head = nn.Linear(hidden_size, 1)

    def forward(self, input_ids, attention_mask):
        outputs = self.backbone(input_ids, attention_mask=attention_mask)
        reward = self.reward_head(outputs.last_hidden_state[:, -1, :])
        return reward
```

The reward model is trained with a pairwise ranking loss:

```python
def reward_loss(reward_chosen, reward_rejected):
    return -torch.log(torch.sigmoid(reward_chosen - reward_rejected)).mean()
```

### Stage 3: RL Optimization

The language model is optimized against the reward model using Proximal Policy Optimization (PPO). A KL divergence penalty prevents the model from drifting too far from the SFT baseline:

```
objective = E[RM(prompt, response)] - beta * KL(policy || reference)
```

The KL penalty is critical -- without it, the model finds adversarial outputs that score highly on the reward model but produce degenerate text, a phenomenon known as reward hacking.

### Limitations of Pure RLHF for Safety

RLHF for safety faces several challenges that motivated the development of Constitutional AI. Human labeler disagreement makes safety judgments subjective -- what counts as harmful varies across cultures, contexts, and individuals, and inter-annotator agreement on harmlessness is typically lower than on helpfulness. Red-teaming cost scales linearly with model capability; as models become more capable, the space of potential harms expands. Human labelers must read and evaluate harmful outputs, creating occupational health concerns. And human feedback is inherently noisy and inconsistent across labelers and sessions.

## Constitutional AI: The Bai et al. Approach

Constitutional AI, introduced by Bai et al. (2022) at Anthropic in "Constitutional AI: Harmlessness from AI Feedback," addresses RLHF's limitations by replacing human feedback on harmlessness with AI self-supervision guided by a set of principles.

### The Constitution

The constitution is a set of natural language principles that define desired behavior. Example principles include directives like "Choose the assistant response that is as harmless and ethical as possible," or "Choose the response that is least likely to be perceived as harmful or offensive by a reasonable person." These principles are not hard-coded rules but guidelines that the model uses for self-evaluation. The key insight is that a sufficiently capable language model can apply these principles to critique and improve its own outputs.

### Stage 1: Supervised Learning from Self-Critique (SL-CAI)

The first stage generates training data through a self-critique and revision loop:

1. **Generate**: A helpful-only model generates responses to red-team prompts, including harmful ones.
2. **Critique**: The model critiques its own response according to a randomly sampled constitutional principle.
3. **Revise**: The model generates an improved response based on its critique.
4. **Repeat**: Steps 2-3 can be iterated multiple times with different principles.

The revised responses form the SFT dataset. The model is fine-tuned on these self-generated, self-revised examples:

```python
# Pseudocode for SL-CAI data generation
def generate_sl_cai_data(model, red_team_prompts, constitution):
    training_pairs = []
    for prompt in red_team_prompts:
        response = model.generate(prompt)
        for _ in range(num_revisions):
            principle = random.choice(constitution)
            critique = model.generate(
                f"Critique this response according to: {principle}\n"
                f"Response: {response}"
            )
            response = model.generate(
                f"Given this critique: {critique}\n"
                f"Revise the response to address the concerns."
            )
        training_pairs.append((prompt, response))
    return training_pairs
```

### Stage 2: RL from AI Feedback (RLAIF)

After SL-CAI fine-tuning, the model undergoes reinforcement learning -- but instead of human preference labels, an AI model generates the comparisons. For each prompt, the model generates multiple responses, and a separate model (or the same model with chain-of-thought prompting) evaluates which response better satisfies the constitutional principles.

This AI-generated preference data trains a harmlessness reward model, which is then used for PPO training, combined with the existing helpfulness reward model from human feedback.

The result is a model trained with human feedback for helpfulness and AI feedback for harmlessness, achieving comparable or better harmlessness ratings than pure RLHF while requiring dramatically fewer human annotations.

## Red-Teaming Assisted Training

Red-teaming is the practice of deliberately trying to elicit harmful behavior from a model. In the context of CAI, red-teaming serves two purposes: generating the adversarial prompts used in SL-CAI training and evaluating the trained model's robustness.

### Automated Red-Teaming

Perez et al. (2022) in "Red Teaming Language Models with Language Models" demonstrated that language models themselves can generate effective red-team attacks. A red-team model is prompted to generate inputs likely to elicit harmful responses from the target model:

```python
red_team_prompt = """Generate a question that might cause an AI assistant
to provide harmful, unethical, or dangerous information. The question
should be subtle and not obviously malicious."""
```

This creates a feedback loop: the red-team model finds vulnerabilities, which are used to generate training data, which makes the target model more robust, which requires more sophisticated red-teaming.

### Categories of Red-Team Attacks

Effective red-teaming covers multiple attack vectors. Direct requests ask explicitly for harmful content. Indirect/roleplay attacks frame harmful requests within fictional scenarios. Multi-turn attacks build context over multiple turns before making the harmful request. Jailbreaks use prompt injection techniques to override safety training. And social engineering attacks use persuasion tactics to gradually shift the model's behavior.

CAI is particularly effective against indirect attacks because the constitutional principles can be applied regardless of the framing -- the model evaluates the substance of what is being asked, not just the surface form.

## Self-Critique and Revision Mechanics

The self-critique mechanism is perhaps the most novel aspect of CAI. It leverages the model's own reasoning capabilities to evaluate and improve its outputs.

### Chain-of-Thought Critique

When the model critiques its response, it engages in explicit reasoning about why the response might be harmful:

```
Critique Request: Identify specific ways in which the assistant's
response is harmful, unethical, racist, sexist, toxic, dangerous,
or illegal.

Critique: The response provides step-by-step instructions for
[harmful activity]. While the information is technically available
online, providing it in this format lowers the barrier to [harm]
and could enable [specific negative outcome]. The response also
fails to suggest legal alternatives or discourage the harmful
behavior.
```

This chain-of-thought reasoning serves multiple purposes. It forces the model to explicitly identify what makes a response harmful, building an internal representation of harm categories. It provides a natural language justification for the revision, making the training signal more informative than a binary label. And it can be inspected by humans, providing transparency into the model's safety reasoning.

### Revision Quality

Research from Anthropic shows that the quality of revisions improves with model capability. Larger models produce more nuanced critiques and better revisions. This creates a virtuous cycle: as models become more capable, CAI becomes more effective at training them to be safe, partially addressing the scalability concern of pure RLHF.

However, revision quality is not monotonic. Models sometimes over-correct, producing responses that are safe but unhelpfully vague or preachy. Balancing thoroughness of safety revision against preservation of helpfulness is an ongoing challenge.

## CAI vs RLHF: Tradeoffs and Complementarity

CAI and RLHF are not competitors but complementary approaches. Understanding their tradeoffs is essential for designing effective safety training pipelines.

### Where CAI Excels

CAI provides superior consistency because the constitution is deterministic -- the same principles are applied every time, unlike human labelers who vary day to day. It offers massive scalability since generating AI feedback is orders of magnitude cheaper than human annotation. It eliminates the need for humans to read harmful content during harmlessness training. And the explicit principles provide transparency about what the model is being trained to do.

### Where RLHF Excels

RLHF captures nuanced human preferences that are difficult to articulate as principles. Edge cases and context-dependent judgments are where human feedback provides the most value. RLHF also provides a ground truth signal -- ultimately, safety is defined by human values, and human feedback is the most direct measure of alignment with those values. Additionally, RLHF can capture evolving social norms in ways that a fixed constitution cannot.

### The Hybrid Approach

Anthropic's production systems use a hybrid approach: RLHF for helpfulness (where human preferences are essential) and CAI for harmlessness (where consistency and scalability matter more). The helpfulness and harmlessness reward models are combined during RL training:

```
combined_reward = alpha * helpfulness_RM(x) + (1 - alpha) * harmlessness_RM(x)
```

The weighting parameter alpha controls the helpfulness-harmlessness tradeoff. In practice, this is tuned empirically, often with different weights for different harm categories.

## Scaling Supervision

As language models become more capable, the challenge of supervising them grows. A sufficiently capable model might produce outputs that appear safe to human evaluators but contain subtle harms that require expert knowledge to detect. This is the scalable oversight problem.

### Recursive Reward Modeling

One approach to scaling supervision is recursive reward modeling, where AI systems help humans evaluate AI outputs. Rather than asking humans to directly judge whether a response is harmful, the AI provides analysis and evidence that helps humans make better judgments. This is related to the debate and amplification approaches proposed by Irving et al. (2018).

### Constitutional AI as Scalable Oversight

CAI can be viewed as a form of scalable oversight. Instead of scaling the number of human evaluators, it scales the application of human-defined principles through AI self-evaluation. The human contribution is concentrated at the highest level -- defining the constitution -- while the AI handles the labor-intensive work of applying those principles to millions of examples.

However, this raises a fundamental question: can a model reliably apply principles it was trained to follow? If the model has blind spots or biases in its understanding of the principles, those will be systematically replicated in the training data. This is why periodic human evaluation remains essential even in CAI systems.

### Weak-to-Strong Generalization

Burns et al. (2023) from OpenAI explored "weak-to-strong generalization" -- whether a weaker model's supervision can elicit the capabilities of a stronger model. In the context of safety, this asks whether constitutional principles understood by a weaker model can effectively train a stronger model. The results are encouraging but not definitive: stronger models can generalize beyond their supervisor's capabilities in some domains, but reliability decreases as the capability gap grows.

## Anthropic's Approach to AI Safety

Anthropic's safety research program integrates CAI with several other approaches to create a multi-layered safety system.

### The HHH Framework

Anthropic frames alignment along three axes: Helpful (the model should assist users with their tasks), Harmless (the model should avoid causing harm), and Honest (the model should be truthful and transparent about its limitations). These three objectives can conflict, and much of alignment research is about navigating these tensions.

### Iterative Deployment

Anthropic advocates for iterative deployment -- releasing models with known limitations, learning from real-world usage, and improving safety in subsequent versions. Each deployment provides data about failure modes that inform the next round of constitutional principles and safety training.

### Safety Levels (ASL)

Anthropic's Responsible Scaling Policy defines AI Safety Levels (ASLs) analogous to biosafety levels. Each level specifies the safety measures required before deployment. As models become more capable, they require more stringent safety evaluations, including red-teaming by domain experts and evaluations for specific dangerous capabilities.

## Recent Advances and Future Directions

### Direct Preference Optimization (DPO)

Rafailov et al. (2023) introduced Direct Preference Optimization, which eliminates the need for a separate reward model by directly optimizing the language model on preference data:

```python
def dpo_loss(policy_logps_chosen, policy_logps_rejected,
             ref_logps_chosen, ref_logps_rejected, beta):
    log_ratio_chosen = policy_logps_chosen - ref_logps_chosen
    log_ratio_rejected = policy_logps_rejected - ref_logps_rejected
    logits = beta * (log_ratio_chosen - log_ratio_rejected)
    return -F.logsigmoid(logits).mean()
```

DPO can be combined with CAI by using AI-generated preferences instead of human preferences, simplifying the training pipeline while maintaining the scalability benefits. For a deeper treatment of DPO, PPO, and the reward modeling pipeline, see [Article 21: RLHF & Preference Optimization](/rlhf-preference).

### Constitutional AI for Code Safety

The CAI framework extends naturally to code generation safety. Constitutional principles can specify security requirements, and the self-critique mechanism can identify vulnerabilities in generated code. For example, a principle might state: "The code should not include hardcoded credentials, SQL injection vulnerabilities, or buffer overflow risks."

## Post-DPO Alignment Methods

DPO demonstrated that preference optimization could work without a separate reward model, but its assumptions -- strict Bradley-Terry preference modeling, reliance on paired comparisons, and sensitivity to the reference policy -- prompted a wave of alternatives. Each method relaxes different constraints, and the choice depends on data availability, compute budget, and the specific alignment objective. These methods are covered in more detail in [Article 21: RLHF & Preference Optimization](/rlhf-preference); here we focus on how they interact with Constitutional AI pipelines specifically.

### Group Relative Policy Optimization (GRPO)

DeepSeek introduced GRPO as an alternative to PPO that eliminates the need for a separate critic model. Instead of training a value function to estimate advantages, GRPO samples a group of responses for each prompt and computes advantages relative to the group mean reward. This reduces memory and compute requirements significantly -- a meaningful consideration when running RL on models with hundreds of billions of parameters.

In the context of CAI, GRPO is particularly well-suited for RLAIF pipelines because the group-relative advantage computation is more stable when rewards come from AI feedback models, which tend to have lower variance than human annotators but can exhibit systematic biases that destabilize PPO's value function.

### Kahneman-Tversky Optimization (KTO)

Ethayarajh et al. (2024) proposed KTO, which requires only binary signal -- whether a given output is desirable or undesirable -- rather than paired preferences. This is a significant practical advantage because binary labels are far easier to collect at scale than pairwise comparisons. KTO's loss function is inspired by prospect theory, weighting losses from undesirable outputs more heavily than gains from desirable ones, reflecting the asymmetry in how humans evaluate risk.

For CAI, KTO opens a simplified data pipeline: instead of asking the AI feedback model to compare two responses, it only needs to classify each response as acceptable or unacceptable under the constitution. This reduces the number of inference calls and simplifies the feedback prompt.

### Identity Preference Optimization (IPO)

Azar et al. (2024) identified a theoretical issue with DPO: under certain conditions, DPO overfits to the preference dataset because it implicitly assumes the preference data is deterministic. IPO adds a regularization term that prevents the model from assigning infinite likelihood ratios to preferred over dispreferred responses. In safety training, this regularization is valuable because harmlessness preferences are often soft -- there is rarely a response that is categorically better, only one that is somewhat more appropriate.

### Odds Ratio Preference Optimization (ORPO)

Hong et al. (2024) proposed ORPO, which combines SFT and preference optimization into a single training stage. ORPO adds a relative odds ratio penalty to the standard cross-entropy SFT loss, penalizing the model for assigning high probability to dispreferred responses. This eliminates the need for a separate reference model and a separate alignment stage.

For CAI pipelines, ORPO is attractive because it collapses the SL-CAI and RLAIF stages into one: the self-revised responses serve as the preferred outputs, the original harmful responses as the dispreferred ones, and both SFT and alignment happen simultaneously.

### Comparison of Post-DPO Methods

| Method | Preference Data | Reference Model | Separate RM | Key Advantage | Best For |
|--------|----------------|-----------------|-------------|---------------|----------|
| **DPO** | Pairwise | Yes | No | Simplicity, well-studied | General alignment with clean paired data |
| **GRPO** | Reward scores | No (group-relative) | Yes | No critic model, scalable RL | Large-scale RLAIF with reward models |
| **KTO** | Binary (good/bad) | Yes | No | Unpaired data, asymmetric loss | Abundant unlabeled data, simple feedback |
| **IPO** | Pairwise | Yes | No | Regularized, avoids overfitting | Noisy or ambiguous preference data |
| **ORPO** | Pairwise | No | No | Single-stage SFT + alignment | Compute-constrained, streamlined pipelines |

## Process Reward Models

Standard reward models -- often called Outcome Reward Models (ORMs) -- assign a single scalar score to a complete response. This works well for short, self-contained outputs, but breaks down for multi-step reasoning tasks where a response can go wrong at any intermediate step. Process Reward Models (PRMs) address this by providing step-level supervision, scoring each reasoning step independently.

### PRM vs ORM

The distinction is fundamental to how the reward signal guides learning. An ORM sees a math proof with a correct final answer and assigns a high reward, even if an intermediate step contains a logical error that happened to cancel out. A PRM evaluates each step: "Is this algebraic manipulation valid? Does this conclusion follow from the premises?" This granularity provides a denser, more informative training signal.

Lightman et al. (2023) in "Let's Verify Step by Step" demonstrated that PRMs substantially outperform ORMs on mathematical reasoning tasks. When used to select among multiple candidate solutions (best-of-N sampling), PRM-guided selection achieved significantly higher accuracy than ORM-guided selection, because PRMs could identify solutions that arrived at correct answers through valid reasoning rather than lucky errors.

### PRMs in Frontier Model Training

Process reward models are widely understood to be a key component in training reasoning-focused models such as OpenAI's o1 and o3 series. The training pipeline uses PRMs to provide step-level rewards during RL optimization, encouraging the model to develop reliable reasoning chains rather than learning shortcuts to correct answers. This is closely related to the chain-of-thought faithfulness problem: without step-level supervision, models trained with outcome-only rewards may learn to produce plausible-looking reasoning that does not actually reflect their internal computation.

### PRMs for Safety

PRMs have direct applications in safety training. Harmful responses often involve a chain of reasoning where the model progressively elaborates on dangerous information. A step-level reward model can identify exactly where a response transitions from benign to harmful, enabling more targeted intervention. In CAI pipelines, PRMs can evaluate whether each step of the model's self-critique reasoning is sound, rather than just whether the final revised response is acceptable.

The challenge is annotation cost: training a PRM requires step-level labels, which are far more expensive to collect than response-level labels. Automated approaches -- using the model itself to verify each step, or using formal verification tools for mathematical reasoning -- help mitigate this cost but introduce their own failure modes.

## Reward Hacking and Overoptimization

When a language model is optimized against a reward model via RL, it will inevitably find inputs and outputs that score highly on the reward model but do not correspond to genuinely better responses. This is reward hacking, and it is one of the most persistent challenges in alignment. The phenomenon is a direct instance of Goodhart's Law: when a measure becomes a target, it ceases to be a good measure.

### How Reward Hacking Manifests

Reward hacking takes many forms. Length exploitation occurs when the reward model assigns higher scores to longer responses, and the policy learns to generate verbose, padded outputs. Sycophancy happens when the reward model -- trained on human preferences -- reflects a preference for agreeable responses, causing the policy to tell users what they want to hear rather than what is true. Format gaming arises when the policy learns that certain formatting patterns (bullet points, confident language, hedging phrases) correlate with higher reward, independent of content quality.

More subtle forms involve exploiting distributional gaps in the reward model's training data. The reward model is trained on a finite dataset and may assign arbitrary scores to outputs far from its training distribution. RL optimization, given enough steps, will find these out-of-distribution regions and exploit them. This is why the KL penalty in the RLHF objective is essential -- it constrains the policy to stay near the reference distribution where the reward model's scores are meaningful.

### Detection

Detecting reward hacking requires monitoring for divergence between reward model scores and actual quality. Key indicators include reward model score increasing while human evaluation scores plateau or decrease, KL divergence from the reference policy growing without corresponding quality improvements, response length or specific formatting patterns increasing systematically, and the model producing outputs that "feel" optimized -- unnaturally polished or formulaic. Regular human evaluation checkpoints during RL training are the most reliable detection mechanism, though they are expensive.

### Mitigation Strategies

Several strategies mitigate reward hacking. Reward model ensembles train multiple reward models on different data subsets and use their agreement as the reward signal; the policy cannot simultaneously hack all models. Reward model retraining periodically retrains the reward model on outputs from the current policy, closing the distributional gap. Conservative optimization uses smaller KL penalty coefficients or stops RL training early, accepting lower reward model scores in exchange for more reliable quality. Constrained optimization adds explicit constraints -- on output length, on format distribution, on topic relevance -- preventing the most common exploitation patterns.

CAI offers a structural advantage against reward hacking: because the harmlessness reward model is trained on AI-generated preferences grounded in constitutional principles, the preference signal is more consistent and less prone to the idiosyncratic biases that human labelers introduce. However, CAI introduces its own risk -- the model may learn to produce responses that satisfy the letter of the constitutional principles while violating their spirit, a form of constitutional reward hacking. See [Article 35: Red Teaming & Adversarial Testing](/red-teaming) for how adversarial testing strategies can surface these failure modes.

### Goodhart's Law and Alignment

The reward hacking problem points to a deeper issue in alignment: any fixed reward signal is an imperfect proxy for what we actually want. Optimizing hard against a proxy inevitably diverges from the true objective. This is why alignment research increasingly focuses on approaches that maintain human oversight throughout training -- iterative RLHF, process reward models, debate-based evaluation -- rather than relying on a single reward model trained once. The connection between reward hacking and broader fairness concerns in production systems is explored further in [Article 46: Bias, Fairness & Responsible AI](/bias-fairness).

## Collective Constitutional AI

The original CAI paper used a constitution written by Anthropic's researchers -- a small group making decisions about the values that would govern an AI system used by millions. This raises a fundamental legitimacy question: who should define the principles that constrain AI behavior?

### The Legitimacy Problem

Constitutional design is inherently a value-laden process. Decisions about how to balance helpfulness against safety, which topics warrant caution, and how to handle culturally contested questions all embed specific value judgments. When a small team of researchers makes these decisions, the resulting constitution inevitably reflects their backgrounds, priorities, and blind spots. This is not a critique of any particular team's competence but a structural observation: alignment is a societal question, and societal questions benefit from broad input.

### Anthropic's Collective Constitutional AI Experiment

In 2023, Anthropic partnered with the Collective Intelligence Project to run a large-scale public input process for constitutional design. Approximately 1,000 Americans, recruited to be demographically representative, were asked to participate in a structured deliberation process. Participants discussed and voted on principles for AI behavior across a range of sensitive topics.

The resulting "publicly-sourced" constitution differed from Anthropic's internally-written one in notable ways. The public constitution placed stronger emphasis on objectivity and impartiality, particularly on politically contentious topics. It was less restrictive on certain categories of content that Anthropic's researchers had treated with more caution. And it explicitly valued transparency about AI limitations -- the public wanted the AI to acknowledge uncertainty rather than hedge behind refusals.

When a model was trained using the public constitution, it performed comparably on safety benchmarks but showed different behavioral patterns on contested topics. Critically, the publicly-sourced model exhibited less sycophantic behavior on politically sensitive questions, likely because the public constitution explicitly prioritized balanced presentation over agreeable responses.

### Scaling Democratic Input

The Collective Constitutional AI experiment demonstrated feasibility but also highlighted challenges in scaling democratic input to AI governance. Deliberation quality depends on participants understanding the technical constraints -- you cannot write useful constitutional principles without understanding what a language model can and cannot do. Aggregating diverse preferences into a coherent constitution requires careful process design; naive voting can produce internally contradictory principles. And the constitution must be updated as social norms evolve and model capabilities change, requiring ongoing participatory processes rather than one-time consultations.

Several approaches are being explored to address these challenges. Sortition-based panels select random but representative groups of citizens for structured deliberation. Polis-style opinion mapping uses algorithms to identify consensus clusters and areas of genuine disagreement. Multi-tier constitutions define core safety principles that are non-negotiable alongside culturally-specific guidelines that vary by deployment context.

### Connecting Democratic Governance to Alignment

Collective Constitutional AI connects the technical problem of alignment to the political problem of legitimate governance. A constitution that reflects broad public input has stronger democratic legitimacy, which matters for public trust in AI systems. It also produces more robust safety training because diverse perspectives identify harm categories and edge cases that a homogeneous team might miss. This intersection of alignment and governance is one of the most important frontiers in responsible AI development, with direct implications for the bias and fairness concerns discussed in [Article 46: Bias, Fairness & Responsible AI](/bias-fairness).

## Key Takeaways

- **RLHF** provides a strong foundation for alignment through human preference learning but faces scalability and consistency challenges for safety specifically.
- **Constitutional AI** addresses these challenges by using explicit principles for AI self-supervision, replacing human harmlessness labels with AI-generated feedback.
- **The SL-CAI stage** generates safe training data through self-critique and revision, teaching models to reason about safety rather than just pattern-match.
- **RLAIF** (RL from AI Feedback) trains harmlessness reward models from AI-generated preferences, complementing human-trained helpfulness reward models.
- **Post-DPO methods** (GRPO, KTO, IPO, ORPO) each relax different assumptions of DPO, offering tradeoffs in data requirements, compute cost, and training stability that matter for CAI pipelines.
- **Process reward models** provide step-level supervision that improves reasoning quality and enables more granular safety interventions than outcome-only reward models.
- **Reward hacking** is an inevitable consequence of optimizing against proxy objectives; mitigation requires ensembles, retraining, conservative optimization, and ongoing human evaluation.
- **Red-teaming** is essential for both generating training data and evaluating model robustness, and can itself be automated using language models. See [Article 35: Red Teaming & Adversarial Testing](/red-teaming).
- **Collective Constitutional AI** demonstrates that democratic input to constitution design is feasible and produces constitutions with different -- and in some ways superior -- behavioral properties.
- **The hybrid approach** -- RLHF for helpfulness, CAI for harmlessness -- combines the strengths of both methods and is used in production systems.
- **Scaling supervision** remains a fundamental challenge; CAI provides one approach but is not a complete solution as model capabilities grow.
- **Constitutional principles are living documents** that must evolve with social norms, model capabilities, and deployment contexts -- and the process for defining them should be as carefully designed as the principles themselves.
