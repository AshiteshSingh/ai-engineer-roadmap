# LLM-as-Judge: Automated Evaluation, Calibration & Bias

The most promising solution for evaluating the flood of AI-generated text is not a team of human experts -- it is another AI. In the MT-Bench study by Zheng et al. (2023), GPT-4's evaluations matched human preferences over 80% of the time, rivaling human-human agreement rates -- at a fraction of the cost and latency. But this LLM-as-Judge paradigm, where one language model evaluates the output of another, carries hidden risks: position bias can flip verdicts in up to 30% of cases, verbosity bias inflates scores for longer-but-not-better responses, and self-enhancement bias means models quietly favor their own outputs. This article examines the methodology, calibration techniques, known biases, and concrete mitigation code for deploying LLM judges in evaluation pipelines.

## The Case for LLM Judges

Human evaluation remains the gold standard for assessing language model outputs on subjective dimensions like helpfulness, harmlessness, and honesty. But human evaluation is slow (days to weeks for a study), expensive ($10-50+ per annotation depending on expertise required), and difficult to reproduce. For iterative development, where you might evaluate thousands of prompt variations across dozens of model configurations, human evaluation is simply not feasible at every decision point.

LLM-as-Judge fills this gap. The core insight, formalized in the MT-Bench paper by Zheng et al. (2023), is that strong language models can provide evaluations that correlate well with human judgment -- often above 80% agreement -- at a fraction of the cost and latency.

The approach is not without controversy. Using an LLM to evaluate an LLM introduces circular dependencies, potential biases, and failure modes that do not exist in human evaluation. Understanding these limitations is essential for using LLM judges responsibly.

## LLM Judges vs. Alternative Evaluation Approaches

Before diving into LLM-as-Judge methodology, it is worth understanding where this approach fits in the evaluation landscape. [Eval Fundamentals](/eval-fundamentals) covers the full spectrum of evaluation methods; here we focus on the tradeoffs that determine when LLM judges are the right tool.

**Reference-based metrics** (BLEU, ROUGE, BERTScore) compare model output to a gold-standard reference. They are fast, deterministic, and cheap -- but they require references to exist, penalize valid paraphrases, and fail entirely on open-ended tasks where many correct answers exist. They work well for translation and extractive summarization but poorly for dialogue, creative writing, or advisory tasks.

**Execution-based evaluation** runs model output as code, checks mathematical answers against computed results, or validates structured outputs against schemas. This is the most reliable evaluation method when it applies -- correctness is binary and verifiable. But it only works for tasks with objectively checkable outputs. Most real-world LLM applications (chatbots, content generation, analysis) produce outputs that cannot be verified through execution.

**Human evaluation** provides the highest-fidelity signal for subjective quality dimensions. It captures nuance that no automated method can. But it is expensive, slow, noisy (inter-annotator agreement is often only 70-80%), and does not scale to the thousands of evaluations needed during iterative development. [Human Evaluation](/human-evaluation) covers annotation design and reliability measurement in depth.

**LLM-as-Judge** occupies the middle ground: it handles open-ended tasks that reference metrics cannot, scales far better than human evaluation, and provides richer signal than simple heuristics. The key limitation is that the judge inherits the biases and knowledge gaps of the evaluating model -- it cannot reliably judge factual correctness in domains beyond its training.

| Approach | Speed | Cost per eval | Open-ended tasks | Factual verification | Reproducibility |
|---|---|---|---|---|---|
| Reference metrics (BLEU, ROUGE) | ms | ~$0 | Poor | N/A | Deterministic |
| Execution-based | ms-sec | ~$0 | N/A (structured only) | Strong | Deterministic |
| LLM-as-Judge | sec | $0.01-0.10 | Strong | Weak | Near-deterministic (temp=0) |
| Human evaluation | hours-days | $10-50+ | Strong | Moderate | Low (60-80% agreement) |

The practical recommendation: use execution-based evaluation wherever possible, LLM judges for subjective quality dimensions and open-ended tasks, and reserve human evaluation for calibration sets and high-stakes decisions. These approaches are complementary, not competing.

## The MT-Bench Judge Protocol

MT-Bench (Zheng et al., 2023) established the foundational protocol for LLM-as-Judge evaluation. The benchmark, implemented in the open-source FastChat framework, consists of 80 multi-turn questions across 8 categories (writing, roleplay, extraction, reasoning, math, coding, knowledge, and STEM). The key contribution was not the benchmark itself but the systematic study of how to use GPT-4 as an automated evaluator.

A critical finding often overlooked: evaluation quality degrades significantly in multi-turn scenarios. GPT-4's agreement with human preferences is 80-85% on single-turn tasks but drops to approximately 65% for multi-turn dialogue evaluation. This gap highlights that judge reliability is not a fixed property -- it varies with task complexity, and calibration must account for this.

### Absolute Scoring (Single-Answer Grading)

In absolute scoring, the judge rates a single response on a numerical scale, typically 1-10:

```python
JUDGE_PROMPT_ABSOLUTE = """Please act as an impartial judge and evaluate the
quality of the response provided by an AI assistant to the user question
displayed below. Your evaluation should consider factors such as helpfulness,
relevance, accuracy, depth, creativity, and level of detail. Begin your
evaluation by providing a short explanation. Be as objective as possible.
After providing your explanation, you must rate the response on a scale of
1 to 10 by strictly following this format: "[[rating]]", for example:
"Rating: [[5]]".

[Question]
{question}

[The Start of Assistant's Answer]
{answer}
[The End of Assistant's Answer]"""
```

Absolute scoring is straightforward but suffers from calibration drift: different judges (or the same judge at different times) may use the scale differently. A "7" from one evaluation run may not mean the same as a "7" from another.

### Pairwise Comparison

Pairwise comparison asks the judge to choose which of two responses is better:

```python
JUDGE_PROMPT_PAIRWISE = """Please act as an impartial judge and evaluate the
quality of the responses provided by two AI assistants to the user question
below. You should choose the assistant that follows the user's instructions
and answers the question better. Your evaluation should consider factors
such as helpfulness, relevance, accuracy, depth, creativity, and level of
detail. Begin your evaluation by comparing the two responses and provide a
short explanation. Avoid any position biases and ensure that the order in
which the responses were presented does not influence your decision. Do not
allow the length of the responses to influence your evaluation. Be as
objective as possible. After providing your explanation, output your final
verdict by strictly following this format: "[[A]]" if assistant A is better,
"[[B]]" if assistant B is better, and "[[C]]" for a tie.

[User Question]
{question}

[The Start of Assistant A's Answer]
{answer_a}
[The End of Assistant A's Answer]

[The Start of Assistant B's Answer]
{answer_b}
[The End of Assistant B's Answer]"""
```

Pairwise comparison is generally more reliable than absolute scoring because it is easier to determine which of two things is better than to assign a number to a single thing. Human annotators show higher inter-rater agreement on pairwise comparisons, and the same holds for LLM judges.

## Known Biases in LLM Judges

### Position Bias

Position bias is the most well-documented bias in LLM-as-Judge systems. The judge tends to prefer the response presented first (primacy bias) or last (recency bias), independent of quality. Zheng et al. (2023) found that simply swapping the order of two candidate responses could flip GPT-4's preference in 10-30% of cases, depending on task type -- a range wide enough to invalidate naive single-pass evaluation.

The standard mitigation is to evaluate each pair twice with the order swapped and check for consistency:

```python
async def pairwise_judge_debiased(question: str, answer_a: str,
                                   answer_b: str, judge_model) -> str:
    # First evaluation: A then B
    result_ab = await judge_model.evaluate(
        format_pairwise(question, answer_a, answer_b)
    )
    # Second evaluation: B then A
    result_ba = await judge_model.evaluate(
        format_pairwise(question, answer_b, answer_a)
    )

    verdict_ab = parse_verdict(result_ab)  # "A", "B", or "tie"
    verdict_ba = parse_verdict(result_ba)  # "A", "B", or "tie" (note: swapped)

    # Flip the second verdict back to original ordering
    verdict_ba_flipped = flip_verdict(verdict_ba)

    if verdict_ab == verdict_ba_flipped:
        return verdict_ab  # Consistent verdict
    else:
        return "tie"  # Inconsistent -> call it a tie
```

This doubles the cost but substantially reduces position bias. In practice, the consistency rate is a useful diagnostic: a judge that disagrees with itself more than 20% of the time on order swaps may not be reliable enough for your use case.

### Verbosity Bias

LLM judges tend to prefer longer responses, even when the additional length does not add value. This is likely because training data includes the heuristic that longer, more detailed answers are "better," and judges inherit this bias. In summarization tasks, research has shown GPT-4 judges prefer the longer summary approximately 70% of the time, regardless of whether the additional length added substance.

Mitigation strategies include:
- Explicitly instructing the judge to not prefer longer responses (as in the prompt above)
- Adding a length-normalized scoring component
- Penalizing responses that exceed a reasonable length threshold

Research by Park et al. (2024) showed that verbosity bias can be reduced but not eliminated through prompting alone. The most robust approach is to include deliberately verbose-but-wrong examples in the judge's calibration set.

A practical implementation combines prompt-level instruction with a length penalty:

```python
VERBOSITY_DEBIASED_PROMPT = """Evaluate the response quality.

IMPORTANT: Response length is NOT an indicator of quality. A concise,
accurate response is better than a verbose, padded one. Penalize
unnecessary repetition, filler phrases, and restating the question."""

def length_penalized_score(raw_score: float, response: str,
                           reference_length: int = 500) -> float:
    """Apply a penalty when response significantly exceeds reference length."""
    word_count = len(response.split())
    if word_count > reference_length * 1.5:
        penalty = min(0.2, (word_count - reference_length * 1.5) / (reference_length * 3))
        return max(0, raw_score - penalty)
    return raw_score
```

### Self-Enhancement Bias

Models tend to rate their own outputs higher than outputs from other models. This bias is particularly problematic when the judge and the evaluated model are the same or closely related. Zheng et al. (2023) documented this effect and recommended using a different model family as the judge when possible.

The most reliable mitigation is cross-family judging: never use a model to judge its own outputs. When cross-family judging is impractical, use a multi-judge panel and detect self-enhancement statistically:

```python
def detect_self_enhancement(judge_scores: dict[str, list[float]],
                             model_families: dict[str, str]) -> dict:
    """Flag cases where a judge scores its own family higher."""
    from statistics import mean
    results = {}
    for judge_name, scores_by_model in judge_scores.items():
        judge_family = model_families[judge_name]
        same_family = [s for m, s in scores_by_model if model_families[m] == judge_family]
        diff_family = [s for m, s in scores_by_model if model_families[m] != judge_family]
        if same_family and diff_family:
            gap = mean(same_family) - mean(diff_family)
            results[judge_name] = {
                "self_preference_gap": gap,
                "flagged": gap > 0.5,  # threshold for concern
            }
    return results
```

### Style Bias

LLM judges can be swayed by formatting (markdown, bullet points, headers), confident language, and rhetorical flourishes, independent of factual accuracy. A response that says "I'm not sure, but I think..." may be penalized relative to a confidently wrong response.

This is arguably the most dangerous bias because it can systematically reward style over substance. Mitigation requires either:
- Normalizing response format before judging
- Including rubric items that specifically address factual accuracy
- Using verification-based evaluation (checking claims against ground truth) alongside stylistic assessment

Format normalization before judging removes the most egregious style signals:

```python
import re

def normalize_for_judging(response: str) -> str:
    """Strip formatting that could trigger style bias."""
    # Remove markdown headers
    text = re.sub(r'^#{1,6}\s+', '', response, flags=re.MULTILINE)
    # Convert bullet points to plain sentences
    text = re.sub(r'^[\-\*]\s+', '', text, flags=re.MULTILINE)
    # Remove bold/italic markers
    text = re.sub(r'\*{1,2}([^*]+)\*{1,2}', r'\1', text)
    # Collapse multiple newlines
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text.strip()

STYLE_DEBIASED_RUBRIC = """Evaluate ONLY the substance of the response.
Ignore formatting, markdown, bullet points, and headers — the response
has been stripped of formatting for this evaluation.

Separately score:
1. **Factual Accuracy** (1-5): Are claims correct and verifiable?
2. **Reasoning Quality** (1-5): Is the logic sound, regardless of tone?
3. **Calibrated Confidence** (1-5): Does the response appropriately
   hedge uncertain claims? Reward "I'm not sure, but..." over
   confidently wrong assertions."""
```

## Calibrating LLM Judges

### Agreement with Human Annotators

The primary validation for an LLM judge is its agreement with human annotators. This is typically measured using:

**Cohen's kappa**: Measures agreement beyond chance for categorical judgments (A wins, B wins, tie). Kappa above 0.6 is considered substantial agreement; above 0.8 is almost perfect.

**Spearman correlation**: For numerical ratings, measures rank-order agreement between the judge and human ratings.

**Win rate agreement**: The percentage of pairwise comparisons where the judge agrees with the human majority vote.

```python
from sklearn.metrics import cohen_kappa_score
import numpy as np

def evaluate_judge_quality(human_labels: list, judge_labels: list) -> dict:
    kappa = cohen_kappa_score(human_labels, judge_labels)
    agreement = np.mean([h == j for h, j in zip(human_labels, judge_labels)])

    # Also compute human-human agreement as an upper bound
    # (if you have multiple human annotators)
    return {
        "cohen_kappa": kappa,
        "raw_agreement": agreement,
        "n_samples": len(human_labels)
    }
```

Zheng et al. (2023) reported that GPT-4 as a judge achieved over 80% agreement with human preferences on MT-Bench, comparable to human-human agreement rates. However, this varies significantly by task type: factual questions show higher agreement than creative or subjective tasks.

### Building a Calibration Set

Before deploying an LLM judge at scale, build a calibration set:

1. Collect 50-200 examples representative of your evaluation distribution
2. Obtain high-quality human annotations (ideally from 3+ annotators with majority vote)
3. Run the LLM judge on the same examples
4. Compute agreement metrics
5. Analyze disagreements to identify systematic patterns

If agreement is below your threshold, iterate on the judge prompt, rubric, or model before scaling up.

### Rubric Engineering

Vague evaluation criteria produce unreliable judgments. Instead of "rate the response quality," provide specific rubrics:

```python
RUBRIC_EXAMPLE = """Evaluate the response on these specific dimensions:

1. **Factual Accuracy** (1-5): Are all claims verifiable and correct?
   - 5: All facts correct, properly qualified
   - 3: Mostly correct with minor inaccuracies
   - 1: Contains significant factual errors

2. **Completeness** (1-5): Does the response address all parts of the question?
   - 5: Comprehensively addresses every aspect
   - 3: Addresses main points but misses some aspects
   - 1: Fails to address key parts of the question

3. **Clarity** (1-5): Is the response well-organized and easy to understand?
   - 5: Excellent organization, clear explanations
   - 3: Generally clear but could be better organized
   - 1: Confusing, poorly organized

Provide scores for each dimension and explain your reasoning.
Overall score = weighted average (Accuracy: 50%, Completeness: 30%, Clarity: 20%)"""
```

Detailed rubrics improve both human and LLM judge consistency by reducing ambiguity about what constitutes a "good" response.

## Cost-Effective Evaluation Pipelines

### Cascaded Evaluation

Not every example needs the most expensive judge. A cascaded approach uses a cheap, fast judge for clear-cut cases and escalates ambiguous ones:

```python
class CascadedJudge:
    def __init__(self, fast_judge, strong_judge, confidence_threshold=0.8):
        self.fast_judge = fast_judge
        self.strong_judge = strong_judge
        self.threshold = confidence_threshold

    async def evaluate(self, question, answer_a, answer_b):
        # Stage 1: Fast judge (e.g., smaller model or simple heuristics)
        fast_result = await self.fast_judge.evaluate(question, answer_a, answer_b)

        if fast_result.confidence >= self.threshold:
            return fast_result

        # Stage 2: Strong judge for ambiguous cases
        strong_result = await self.strong_judge.evaluate(
            question, answer_a, answer_b
        )
        return strong_result
```

This can reduce costs by 50-70% while maintaining evaluation quality comparable to using the strong judge everywhere.

### Batched and Parallel Evaluation

LLM judge calls are embarrassingly parallel. Evaluate all examples concurrently:

```python
import asyncio

async def batch_evaluate(judge, examples, max_concurrent=50):
    semaphore = asyncio.Semaphore(max_concurrent)

    async def evaluate_one(example):
        async with semaphore:
            return await judge.evaluate(**example)

    results = await asyncio.gather(
        *[evaluate_one(ex) for ex in examples]
    )
    return results
```

### Caching and Deduplication

For iterative development where you re-run evaluations frequently, cache judge responses keyed on the (question, answer, judge_prompt) tuple. This avoids re-evaluating unchanged examples when you modify a subset of your system.

## Multi-Judge Consensus

Using multiple judges and aggregating their decisions improves reliability:

### Majority Vote

The simplest approach: use 3 or 5 different judge prompts (or models) and take the majority verdict.

### Weighted Consensus

Weight judges by their calibrated agreement with humans:

```python
def weighted_consensus(judge_verdicts: list[str],
                       judge_weights: list[float]) -> str:
    scores = {"A": 0.0, "B": 0.0, "tie": 0.0}
    for verdict, weight in zip(judge_verdicts, judge_weights):
        scores[verdict] += weight
    return max(scores, key=scores.get)
```

### Diverse Judge Panels

Use judges from different model families to reduce correlated biases. A panel might include GPT-4, Claude 3.5 Sonnet, and Gemini 1.5 Pro as judges. Since their biases are less likely to be correlated, the aggregate judgment is more robust.

Li et al. (2023) showed that multi-judge panels with diverse models achieve higher agreement with human evaluators than any single judge model, even when the panel includes weaker individual judges.

## When LLM-as-Judge Fails

LLM judges are unreliable in several important cases:

**Factual verification**: LLM judges cannot reliably distinguish correct from incorrect factual claims, especially in specialized domains. They may confidently rate a factually wrong response as excellent if it is well-written. For factual tasks, combine LLM judges with retrieval-based fact-checking.

**Mathematical reasoning**: LLM judges often cannot verify mathematical derivations. They may accept incorrect proofs or calculations. For math evaluation, use execution-based verification (run the code, check the answer) rather than LLM judgment.

**Subtle logical errors**: LLM judges can miss logical fallacies, non-sequiturs, and circular reasoning, especially when buried in fluent text. They tend to evaluate surface quality over logical soundness.

**Cross-cultural evaluation**: LLM judges inherit the cultural biases of their training data and may not reliably evaluate content targeting audiences from underrepresented cultures.

**Circularity and optimization pressure**: If the community primarily uses GPT-4 to judge models, it creates a feedback loop where models are optimized to please GPT-4's preferences rather than genuine user needs. This risks homogenizing model outputs around a single judge's aesthetic. The mitigation is to use diverse judge panels and periodically validate against human evaluation to ensure you are measuring quality, not judge-pleasing.

## Fine-Tuned Judge Models

General-purpose frontier models like GPT-4 are effective judges, but a growing body of work shows that models specifically fine-tuned for evaluation can match or exceed their performance at a fraction of the inference cost.

### Prometheus 2

Prometheus 2 (Kim et al., 2024) is an open-source family of judge models fine-tuned on large-scale evaluation datasets. The key insight is that evaluation is itself a learnable skill: by training on thousands of (input, response, rubric, score, rationale) tuples, a smaller model can internalize the evaluation patterns that a general-purpose model applies through in-context learning.

Prometheus 2 supports both absolute scoring and pairwise comparison modes. On the Vicuna Benchmark, the 7B variant achieves approximately 0.9 Pearson correlation with human judgment, rivaling GPT-4-Turbo -- while costing roughly 300x less per evaluation call. The 7B and 13B variants run on a single consumer GPU, and the model accepts custom rubrics, making it adaptable across tasks without re-training.

### JudgeLM

JudgeLM (Zhu et al., 2023) takes a complementary approach, fine-tuning LLaMA-based models on over 100,000 judge samples distilled from GPT-4 evaluations. The training data includes diverse evaluation scenarios -- single-answer grading, pairwise comparison, and multi-dimensional scoring -- which gives the model broad evaluation capabilities. JudgeLM also incorporates reference-based judging, where the model receives a gold-standard reference alongside the candidate response, improving accuracy on tasks where ground truth exists.

### When to Use Fine-Tuned vs. General-Purpose Judges

The decision depends on three factors:

**Cost at scale.** If you are running thousands of evaluations per day -- common in [CI/CD pipelines](/ci-cd-ai) or iterative prompt tuning -- the per-token cost of frontier API models adds up quickly. A fine-tuned 7B judge running on local hardware can reduce marginal cost to near zero after the initial infrastructure investment.

**Evaluation quality requirements.** For high-stakes evaluations where you need the best possible agreement with human judgment, frontier models still hold an edge, particularly on novel or complex tasks outside the fine-tuned model's training distribution. For routine regression testing on well-defined rubrics, fine-tuned judges are often sufficient.

**Privacy and deployment constraints.** Fine-tuned judge models can run entirely on-premises, which matters when evaluating outputs that contain sensitive data. Sending proprietary content to third-party APIs for evaluation may be unacceptable in regulated industries.

A practical pattern is to use a fine-tuned judge as the first stage in a cascaded pipeline, escalating to a frontier model only when the fine-tuned judge's confidence is low. This captures the cost benefit without sacrificing quality on edge cases.

## G-Eval and Chain-of-Thought Judging

Standard judge prompts ask the model to provide a brief explanation and then a score. G-Eval (Liu et al., 2023) formalizes a more structured approach: have the judge reason step-by-step through explicit evaluation criteria before arriving at a score, then derive the final score from the probabilities of the reasoning steps.

### The G-Eval Protocol

G-Eval operates in three stages:

1. **Criteria decomposition.** The evaluation criteria are broken into specific, sequential evaluation steps. For a coherence evaluation, the steps might be: (a) identify the main topic, (b) check whether each paragraph relates to the main topic, (c) assess whether transitions between ideas are logical, (d) determine whether the conclusion follows from the body.

2. **Chain-of-thought evaluation.** The judge model executes each step, producing intermediate reasoning. This forces the model to engage with specific aspects of the response rather than forming a gestalt impression.

3. **Probability-weighted scoring.** Rather than taking the judge's stated score at face value, G-Eval extracts the token-level probabilities for each possible score (1 through 5, say) and computes a weighted average. This produces a continuous score that is more fine-grained than the discrete output.

```python
def geval_score(judge_model, prompt, score_tokens):
    """Extract probability-weighted score from judge output."""
    response = judge_model.generate(prompt, return_logprobs=True)

    # Extract log probabilities for score tokens (e.g., "1", "2", "3", "4", "5")
    score_probs = {}
    for token, logprob in response.token_logprobs.items():
        if token in score_tokens:
            score_probs[int(token)] = math.exp(logprob)

    # Normalize probabilities
    total = sum(score_probs.values())
    if total == 0:
        return None

    weighted_score = sum(
        score * (prob / total) for score, prob in score_probs.items()
    )
    return weighted_score
```

### Why Chain-of-Thought Judging Works

The improvement from chain-of-thought judging parallels the well-documented benefit of chain-of-thought prompting in reasoning tasks. By forcing the judge to articulate its reasoning before scoring, the approach reduces several failure modes:

- **Anchoring effects.** Without structured reasoning, judges often anchor on a first impression and adjust insufficiently. Step-by-step evaluation forces engagement with each criterion.
- **Halo effects.** A response that excels on one dimension (say, eloquence) can inflate scores on other dimensions (say, accuracy). Explicit per-criterion reasoning reduces this cross-contamination.
- **Score clustering.** LLM judges tend to compress their scores into a narrow range (often 7-9 on a 1-10 scale). Chain-of-thought reasoning combined with probability-weighted scoring produces a wider, more discriminative score distribution.

Liu et al. (2023) demonstrated that G-Eval with GPT-4 achieved higher Spearman correlation with human judgments than any prior automated metric on summarization evaluation, including reference-based metrics like ROUGE and BERTScore. The same principle applies to other evaluation targets, including the evaluation frameworks discussed in [Eval Fundamentals](/eval-fundamentals). Open-source frameworks like DeepEval have since made G-Eval accessible as a reusable metric primitive, allowing teams to define custom evaluation criteria and run chain-of-thought judging without implementing the protocol from scratch.

### Choosing an Evaluation Protocol

With multiple judge protocols available, the choice depends on what you are evaluating and the reliability you need:

| Protocol | Best For | Reliability | Cost | When to Avoid |
|---|---|---|---|---|
| Absolute scoring (1-10) | Quick regression checks, tracking trends over time | Moderate -- calibration drift across runs | 1x (one call per example) | When you need to compare two specific outputs |
| Pairwise comparison | A/B testing, model selection, preference data for RLHF | High -- easier judgment, higher human agreement | 2x with debiasing (order swap) | When you have many candidates (O(n^2) comparisons) |
| G-Eval (chain-of-thought) | High-stakes evaluation, fine-grained scoring | Highest -- structured reasoning reduces bias | 1.5-2x (longer prompts, logprob extraction) | When latency or cost is the primary constraint |
| Multi-judge panel | Final model selection, production quality gates | Highest -- decorrelated errors | 3-5x (multiple models) | Early-stage development where speed matters more |
| Cascaded (fast → strong) | High-volume CI/CD pipelines | High -- strong judge handles edge cases | 0.3-0.5x average | When all examples require maximum precision |

For most teams, the practical starting point is pairwise comparison with position debiasing for model selection decisions, and G-Eval with a single strong judge for continuous quality monitoring. Scale to multi-judge panels only for high-stakes evaluations where the added cost is justified.

## Domain-Specific Judge Adaptation

A judge prompt designed for evaluating general-knowledge chatbot responses will perform poorly when applied to code generation, medical question answering, or legal analysis. Each domain has distinct quality criteria, failure modes, and standards of correctness that a generic rubric cannot capture.

### Calibrating Judges for Code

Code evaluation has a significant advantage: outputs can be verified through execution. However, LLM judges are still valuable for assessing code quality dimensions that execution alone cannot capture -- readability, maintainability, idiomatic usage, and architectural decisions.

An effective code judge rubric separates functional correctness (which should be verified by running tests) from qualitative assessment:

```python
CODE_JUDGE_RUBRIC = """Evaluate the code response on these dimensions.
Note: functional correctness has already been verified by test execution.
Focus your evaluation on code quality aspects.

1. **Readability** (1-5): Clear naming, appropriate comments, logical structure
2. **Idiomatic Usage** (1-5): Follows language conventions and best practices
3. **Error Handling** (1-5): Handles edge cases, validates inputs, fails gracefully
4. **Efficiency** (1-5): Appropriate algorithmic complexity, avoids unnecessary work
5. **Security** (1-5): No injection vulnerabilities, safe data handling, proper auth checks

For each dimension, explain your reasoning with specific references to the code,
then provide a score. Do not evaluate whether the code produces correct output --
that has been separately verified."""
```

This separation of concerns -- execution-based correctness checking plus LLM-based quality assessment -- produces evaluations that are both reliable and comprehensive. The execution-based component can be integrated into [CI/CD pipelines](/ci-cd-ai) while the quality assessment runs in parallel.

### Calibrating Judges for Medical and Legal Domains

Medical and legal content evaluation requires domain expertise that general-purpose LLM judges only partially possess. Two patterns improve reliability:

**Expert-seeded rubrics.** Instead of writing rubrics yourself, have domain experts define the evaluation criteria and anchor points. A medical rubric might include dimensions like "clinical accuracy," "appropriate caveats and contraindications," and "consistency with current guidelines." The rubric should include concrete examples of acceptable and unacceptable responses that reflect the domain's standards of care.

**Reference-augmented judging.** Provide the judge with authoritative reference material alongside the response being evaluated. For a medical Q&A evaluation, include relevant clinical guidelines or textbook excerpts. This partially compensates for the judge model's potential knowledge gaps:

```python
DOMAIN_JUDGE_PROMPT = """You are evaluating a response about {domain}.

[Authoritative Reference Material]
{reference_context}

[User Question]
{question}

[Response to Evaluate]
{response}

Using the reference material as ground truth, evaluate the response on:
1. **Factual Consistency** (1-5): Does the response align with the reference material?
2. **Appropriate Caveats** (1-5): Does it include necessary warnings and limitations?
3. **Completeness** (1-5): Does it cover the key points from the reference?

Flag any claims in the response that contradict the reference material."""
```

This approach connects to the broader retrieval-augmented pattern: the same retrieval infrastructure used for RAG-based generation can supply reference material for evaluation. The [human evaluation](/human-evaluation) methodology provides complementary guidance on when domain expert annotators are irreplaceable.

### Custom Rubric Engineering Patterns

Across domains, several rubric engineering patterns consistently improve judge quality:

**Anchored scales with examples.** Instead of abstract descriptors ("excellent," "good," "poor"), provide concrete examples of responses at each score level. This calibrates the judge's internal scale to your domain's standards.

**Negative criteria.** Specify what a response must *not* do. In medical contexts: "must not recommend specific dosages without professional consultation." In legal contexts: "must not present legal interpretation as settled law when there is active circuit disagreement." Negative criteria are often more actionable than positive ones.

**Hierarchical rubrics.** Some criteria are prerequisites for others. A response that is factually wrong should not receive high marks for clarity or completeness, regardless of how well-written it is. Structure the rubric to enforce this hierarchy, either through explicit gating ("if Factual Accuracy < 3, cap Overall at 3") or through heavily weighted scoring.

## Expanding the Judge Model Landscape

The original MT-Bench work established GPT-4 as the default judge, but the landscape has evolved considerably. Two models have emerged as strong alternatives that diversify the judge panel and reduce single-vendor dependency.

### Claude 3.5 Sonnet as Judge

Anthropic's Claude 3.5 Sonnet brings distinct evaluation characteristics. Its training emphasis on careful reasoning and calibrated uncertainty makes it particularly effective at identifying hedged-but-correct responses that other judges might penalize for lacking confidence. In practice, Claude 3.5 Sonnet shows lower verbosity bias than GPT-4 -- it is less likely to prefer longer responses for their length alone -- and tends to be more conservative in its scores, which can be an advantage when you want a judge that errs toward skepticism.

Claude 3.5 Sonnet is also effective in the role of a reward model surrogate, providing preference judgments that can feed into [RLHF-style training loops](/rlhf-preference). Its relatively long context window allows judging multi-turn conversations without truncation artifacts.

### Gemini 1.5 Pro as Judge

Google's Gemini 1.5 Pro offers a different evaluation profile. Its very large context window (up to 1M tokens in some configurations) makes it uniquely suited for evaluating long-form outputs -- full documents, multi-file code reviews, or extended dialogue transcripts -- where other judges would need chunked evaluation. Gemini 1.5 Pro also handles multimodal evaluation natively, which is relevant for tasks that combine text with images, charts, or code outputs.

On standard evaluation benchmarks, Gemini 1.5 Pro's agreement with human judges is competitive with GPT-4, though each model has domain-specific strengths. The practical recommendation is to include both (or all three) in a diverse judge panel and weight them based on calibration performance for your specific task distribution.

### Cost-Quality Tradeoffs Across Judge Models

| Judge Model | Relative Cost | Strengths | Watch For |
|---|---|---|---|
| GPT-4 | High | Strong baseline, well-studied biases | Verbosity bias, self-enhancement if evaluating GPT outputs |
| Claude 3.5 Sonnet | Medium | Lower verbosity bias, careful reasoning | Conservative scoring, may under-reward creative responses |
| Gemini 1.5 Pro | Medium | Long context, multimodal | Less studied bias profile, newer calibration data needed |
| Prometheus 2 (7B) | Low (self-hosted) | Custom rubric support, no API cost | Weaker on out-of-distribution tasks |
| GPT-4o-mini / Claude Haiku | Low | Fast, good for cascaded first-stage | Lower agreement on nuanced judgments |

## Implementing LLM-as-Judge with DeepEval

The theory above is actionable today through evaluation frameworks that encode these patterns. DeepEval is an open-source LLM evaluation framework that implements G-Eval, custom metric authoring, and judge model abstraction -- turning the research described in this article into a practical testing pipeline.

### G-Eval Metrics in DeepEval

DeepEval's `GEval` metric directly implements the G-Eval protocol from Liu et al. (2023). You define evaluation criteria in natural language, and the framework handles chain-of-thought decomposition, score extraction, and threshold-based pass/fail logic:

```python
from deepeval.metrics import GEval
from deepeval.test_case import LLMTestCase, LLMTestCaseParams

coherence = GEval(
    name="Coherence",
    criteria=(
        "Evaluate the logical flow and structural coherence. "
        "Check that sections transition smoothly, the narrative "
        "builds logically, and the explanation forms a cohesive arc."
    ),
    evaluation_params=[LLMTestCaseParams.ACTUAL_OUTPUT],
    threshold=0.7,
)

test_case = LLMTestCase(
    input="Evaluate response quality",
    actual_output=response_text,
)
coherence.measure(test_case)
print(f"Score: {coherence.score}, Reason: {coherence.reason}")
```

This encodes the rubric engineering patterns described earlier -- the `criteria` string is the rubric, and the framework ensures the judge model follows the G-Eval protocol of criteria decomposition, chain-of-thought evaluation, and probability-weighted scoring.

### Custom Judge Models

DeepEval abstracts the judge model behind `DeepEvalBaseLLM`, so you can swap between judge models without changing evaluation logic. This directly enables the multi-judge panel strategy:

```python
from deepeval.models import DeepEvalBaseLLM
from openai import OpenAI, AsyncOpenAI

class DeepSeekJudge(DeepEvalBaseLLM):
    """Use DeepSeek as an LLM judge via OpenAI-compatible API."""

    def __init__(self, model: str = "deepseek-chat"):
        self._model = model
        self._client = OpenAI(
            api_key=os.environ["DEEPSEEK_API_KEY"],
            base_url="https://api.deepseek.com",
        )

    def generate(self, prompt: str, **kwargs) -> str:
        resp = self._client.chat.completions.create(
            model=self._model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0,
        )
        return resp.choices[0].message.content or ""

    async def a_generate(self, prompt: str, **kwargs) -> str:
        async_client = AsyncOpenAI(
            api_key=os.environ["DEEPSEEK_API_KEY"],
            base_url="https://api.deepseek.com",
        )
        resp = await async_client.chat.completions.create(
            model=self._model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0,
        )
        return resp.choices[0].message.content or ""

    def get_model_name(self) -> str:
        return self._model

# Use the custom judge in metrics
judge = DeepSeekJudge()
coherence = GEval(name="Coherence", criteria="...", model=judge, threshold=0.7)
```

Swapping from DeepSeek to Claude or GPT-4 as judge requires only changing the class -- the evaluation logic, criteria, and thresholds remain identical. This is the concrete mechanism for the diverse judge panel approach described in the Multi-Judge Consensus section.

### Multi-Dimensional Article Evaluation

A production evaluation pipeline applies multiple G-Eval metrics simultaneously, each targeting a distinct quality dimension. This implements the rubric engineering principle of separating evaluation concerns:

```python
from deepeval import assert_test

# Define domain-specific metrics
metrics = {
    "factual_grounding": GEval(
        name="Factual Grounding",
        criteria=(
            "Check for citation of specific benchmarks or results. "
            "Penalize unsourced quantitative claims and vague attributions."
        ),
        evaluation_params=[LLMTestCaseParams.ACTUAL_OUTPUT],
        model=judge,
        threshold=0.7,
    ),
    "completeness": GEval(
        name="Completeness",
        criteria=(
            "Check for coverage of fundamentals, practical code examples, "
            "discussion of trade-offs, and actionable implementation guidance."
        ),
        evaluation_params=[LLMTestCaseParams.ACTUAL_OUTPUT],
        model=judge,
        threshold=0.7,
    ),
    "readability": GEval(
        name="Readability",
        criteria=(
            "Check that jargon is explained on first use, code snippets are "
            "properly formatted, and mathematical notation is accompanied "
            "by intuitive explanation."
        ),
        evaluation_params=[LLMTestCaseParams.ACTUAL_OUTPUT],
        model=judge,
        threshold=0.7,
    ),
}

# Run all metrics on a test case
test_case = LLMTestCase(input="Evaluate quality", actual_output=article_text)
for name, metric in metrics.items():
    metric.measure(test_case)
    print(f"{name}: {metric.score:.2f} — {metric.reason}")
```

### Agent Evaluation with LangGraph Integration

DeepEval integrates with LangGraph agents through `CallbackHandler`, enabling end-to-end evaluation of agent pipelines. The `TaskCompletionMetric` acts as an LLM judge that assesses whether the agent's response adequately completes the user's task:

```python
from deepeval.integrations.langgraph import CallbackHandler
from deepeval.metrics import TaskCompletionMetric
from deepeval.dataset import EvaluationDataset, Golden

# Define golden test cases
goldens = [
    Golden(
        input="Explain how LLM-as-Judge evaluation works",
        expected_output="Describe judge prompts, scoring protocols, bias mitigation",
    ),
    Golden(
        input="What biases affect LLM judges?",
        expected_output="Position bias, verbosity bias, self-enhancement, style bias",
    ),
]

dataset = EvaluationDataset(goldens=goldens)
metric = TaskCompletionMetric(model=judge, threshold=0.5)

for golden in dataset.evals_iterator():
    handler = CallbackHandler(metrics=[metric])
    result = agent.invoke(
        input={"messages": [{"role": "user", "content": golden.input}]},
        config={"callbacks": [handler]},
    )
    print(f"Task: {golden.input[:50]}... Score: {metric.score}")
```

This pattern -- golden test cases evaluated by LLM judges via DeepEval -- is a concrete instantiation of the calibration set methodology described earlier in this article. The golden cases serve as the calibration set, the `TaskCompletionMetric` is the LLM judge, and the threshold determines pass/fail gating.

### Continuous Evaluation in CI/CD

DeepEval integrates with pytest, enabling LLM-as-Judge evaluation as part of continuous integration pipelines:

```python
import pytest
from deepeval import assert_test
from deepeval.test_case import LLMTestCase

@pytest.mark.parametrize("article_content", load_articles())
def test_coherence(article_content: str):
    test_case = LLMTestCase(
        input="Evaluate article quality",
        actual_output=article_content,
    )
    assert_test(test_case, [coherence_metric])
```

This connects to the cascaded evaluation pattern: run fast, cheap metrics (linting, length checks) first, then escalate to LLM judge evaluation only for content that passes basic gates. The `assert_test` function raises `AssertionError` on failure, integrating directly with pytest's test runner and CI systems. [CI/CD for AI](/ci-cd-ai) covers the broader integration patterns that contextualize this approach.

## Evaluation Framework Landscape

DeepEval is one of several frameworks that implement LLM-as-Judge patterns. The choice depends on your stack, evaluation scope, and whether you need RAG-specific metrics or general-purpose judging.

**DeepEval** is the most comprehensive open-source option for general-purpose LLM evaluation. It implements G-Eval, supports custom judge models via `DeepEvalBaseLLM`, integrates with pytest for CI/CD, and provides both metric-level and dataset-level evaluation. Its LangGraph callback handler enables end-to-end agent evaluation. Best for teams that want a batteries-included evaluation framework with strong Python/pytest integration.

**RAGAS** specializes in RAG pipeline evaluation, providing metrics like faithfulness, answer relevancy, and context precision that are purpose-built for retrieval-augmented systems. If your primary use case is [RAG evaluation](/rag-evaluation), RAGAS provides more targeted metrics than a general-purpose framework. It can be combined with DeepEval or used standalone.

**LangSmith** (from LangChain) provides evaluation as part of a broader observability platform. Its strength is tracing: you can evaluate individual steps within a chain or agent, not just final outputs. The tradeoff is vendor coupling -- LangSmith works best within the LangChain ecosystem. For teams already using LangChain, LangSmith's evaluation features integrate naturally with existing tracing and debugging workflows.

**Braintrust** focuses on the iteration loop: log LLM calls, score outputs with custom judge functions, compare across experiments, and track quality over time. It is less opinionated about evaluation methodology than DeepEval but provides stronger experiment management and dataset versioning.

**Custom implementations** remain a viable option for teams with specific requirements. The core LLM-as-Judge protocol is straightforward to implement: format a judge prompt, call a model, parse the output. The frameworks above add value through rubric engineering patterns, bias mitigation, metric aggregation, and CI integration -- but if you only need basic pairwise comparison with position debiasing, the `ProductionJudge` class shown later in this article is a reasonable starting point.

| Framework | Best For | RAG-specific | CI/CD integration | Judge model flexibility |
|---|---|---|---|---|
| DeepEval | General-purpose LLM eval, pytest workflows | Basic | Strong (pytest native) | High (custom `DeepEvalBaseLLM`) |
| RAGAS | RAG pipeline evaluation | Strong | Moderate | Moderate |
| LangSmith | LangChain-based apps, tracing + eval | Moderate | Moderate | LangChain models |
| Braintrust | Experiment tracking, dataset management | Basic | Moderate | High |
| Custom | Specific requirements, minimal dependencies | N/A | Custom | Full control |

## Practical Implementation Guide

### Step-by-Step Pipeline

1. **Define evaluation criteria** with specific rubrics
2. **Build a calibration set** with human annotations (50-200 examples)
3. **Select judge model(s)** -- start with the strongest available (GPT-4, Claude 3.5 Sonnet, or Gemini 1.5 Pro)
4. **Engineer the judge prompt** -- iterate on rubric specificity, debiasing instructions
5. **Validate against calibration set** -- compute kappa, analyze failure modes
6. **Deploy with position debiasing** -- swap order and check consistency
7. **Monitor judge quality over time** -- periodically re-validate against fresh human annotations
8. **Log everything** -- store judge inputs, outputs, and parsed scores for analysis

```python
class ProductionJudge:
    def __init__(self, model, prompt_template, rubric):
        self.model = model
        self.prompt_template = prompt_template
        self.rubric = rubric
        self.logger = EvalLogger()

    async def evaluate(self, question, answer_a, answer_b):
        # Position-debiased pairwise evaluation
        prompt_ab = self.prompt_template.format(
            question=question, answer_a=answer_a,
            answer_b=answer_b, rubric=self.rubric
        )
        prompt_ba = self.prompt_template.format(
            question=question, answer_a=answer_b,
            answer_b=answer_a, rubric=self.rubric
        )

        result_ab, result_ba = await asyncio.gather(
            self.model.generate(prompt_ab),
            self.model.generate(prompt_ba)
        )

        verdict = self._reconcile(result_ab, result_ba)
        self.logger.log(question, answer_a, answer_b,
                       result_ab, result_ba, verdict)
        return verdict
```

## Summary and Key Takeaways

- **LLM-as-Judge is practical** for iterative development but is not a replacement for [human evaluation](/human-evaluation) on high-stakes decisions. Use it to narrow the search space, then validate top candidates with human judges.
- **Pairwise comparison is more reliable** than absolute scoring. When using absolute scoring, provide detailed rubrics with anchored scales. G-Eval's chain-of-thought protocol further improves scoring discriminativeness.
- **Position bias is real and measurable.** Always debias by evaluating with swapped order. Treat inconsistent judgments as ties.
- **Calibrate before deploying.** Build a human-annotated calibration set and measure agreement. If kappa is below 0.6, iterate on your judge prompt and rubric. [Eval Fundamentals](/eval-fundamentals) covers the broader evaluation methodology that contextualizes these calibration decisions.
- **Fine-tuned judge models** like Prometheus 2 and JudgeLM offer cost-effective alternatives to frontier API judges, especially for high-volume evaluation in [CI/CD pipelines](/ci-cd-ai).
- **Multi-judge panels outperform single judges,** especially when using diverse model families. GPT-4, Claude 3.5 Sonnet, and Gemini 1.5 Pro each bring distinct evaluation characteristics that complement one another.
- **Domain-specific rubrics are essential.** Generic evaluation criteria fail in specialized domains like code, medicine, and law. Invest in expert-seeded rubrics and reference-augmented judging for domain tasks.
- **LLM judges fail on factual verification and math.** For these tasks, use execution-based or retrieval-based evaluation methods instead of or alongside LLM judgment.
- **LLM judges and reward models are converging.** The same preference judgments used in LLM-as-Judge evaluation can feed [RLHF training loops](/rlhf-preference), blurring the line between evaluation and training signal.
- **Log everything.** Judge outputs are data. Analyze disagreement patterns to improve both the judge and the evaluated system.

The LLM-as-Judge paradigm represents a significant advance in evaluation scalability, but only when deployed with an understanding of its limitations, appropriate calibration against human judgment, and rubrics engineered for the specific domain and task.

## Further Reading

This article covers LLM-as-Judge methodology in depth. The following companion articles provide context on related topics:

- [Eval Fundamentals: Metrics, Benchmarks & Statistical Rigor](/eval-fundamentals) -- The evaluation foundations that LLM-as-Judge builds upon, including reference-based metrics, benchmark design, and statistical methodology.
- [Benchmark Design: Contamination, Saturation & Domain-Specific Evals](/benchmark-design) -- How to construct benchmarks and evaluation datasets, including the calibration sets used to validate LLM judges.
- [Human Evaluation: Annotation Design, Inter-Rater Reliability & Scale](/human-evaluation) -- When human evaluation is irreplaceable, and how to design annotation studies that produce the gold-standard labels LLM judges are calibrated against.
- [Red Teaming: Adversarial Testing & Safety Evaluation](/red-teaming) -- Adversarial evaluation methods that complement LLM-as-Judge by stress-testing model outputs in ways judge-based evaluation may miss.
- [CI/CD for AI: Regression Testing, Monitoring & Continuous Eval](/ci-cd-ai) -- Integrating LLM judge evaluations into deployment pipelines for continuous quality assurance.
- [RAG Evaluation: Faithfulness, Relevance & Failure Modes](/rag-evaluation) -- Evaluation frameworks specific to retrieval-augmented generation, including RAGAS metrics that extend the LLM-as-Judge pattern to retrieval quality.
