# Human Evaluation: Annotation Design, Inter-Rater Reliability & Scale

Despite advances in automated metrics and LLM-as-Judge systems, human evaluation remains the ultimate arbiter of language model quality for subjective, open-ended, and safety-critical tasks. However, human evaluation done poorly is worse than no evaluation at all: inconsistent annotations, biased protocols, and underpowered studies produce numbers that mislead rather than inform. This article covers the methodology of rigorous human evaluation for AI systems, from annotation protocol design through inter-rater reliability measurement to the practical challenges of scaling evaluation while maintaining quality.

## Why Human Evaluation Still Matters

Automated metrics optimize for what can be measured, not necessarily what matters. BLEU score does not capture whether a translation sounds natural. BERTScore does not assess whether an explanation is actually helpful. Even LLM-as-Judge systems (see Article 33 for a detailed treatment of their capabilities and limitations) inherit biases and cannot reliably verify factual claims.

Human evaluation provides three things that automated approaches cannot:

1. **Construct validity**: Humans can evaluate the actual construct of interest (helpfulness, safety, truthfulness) rather than a proxy metric that correlates with it.
2. **Edge case detection**: Human evaluators notice subtle failure modes -- condescending tone, cultural insensitivity, technically correct but misleading responses -- that automated systems miss.
3. **Calibration anchor**: All automated metrics must ultimately be validated against human judgment. Human evaluation provides the ground truth that gives automated metrics meaning.

The challenge is that human judgment is variable, expensive, and difficult to reproduce. Rigorous methodology is the solution.

## Annotation Protocol Design

### Defining the Task

The single most important step in human evaluation is clearly defining what annotators should evaluate. Vague instructions like "rate the quality of this response" produce unreliable data because different annotators interpret "quality" differently.

Effective task definitions include:

**Specific dimensions**: Break "quality" into concrete, independently measurable aspects. For a chatbot evaluation, this might include:

- Factual accuracy: Are all claims correct and verifiable?
- Relevance: Does the response address the user's actual question?
- Completeness: Are all aspects of the question covered?
- Clarity: Is the response well-organized and easy to understand?
- Harmlessness: Does the response avoid harmful, biased, or inappropriate content?

**Anchored scales**: For each dimension, provide concrete descriptions of what each scale point means:

```
Factual Accuracy Scale:
5 - All factual claims are correct. Appropriate hedging on uncertain claims.
4 - Minor inaccuracies that do not affect the overall message.
3 - Some factual errors, but the core message is correct.
2 - Significant factual errors that could mislead the reader.
1 - Predominantly incorrect. The response would cause harm if relied upon.
```

**Worked examples**: Provide 3-5 annotated examples for each scale point, with explanations of why they received that rating. These examples serve as shared reference points that anchor annotator calibration. When building annotation protocols for dataset curation specifically, Article 22 covers the broader pipeline from data collection through quality filtering.

### Likert Scales vs. Pairwise Comparison

Two dominant paradigms exist for human evaluation:

**Likert scales** (absolute rating) ask annotators to assign a numerical score to each response independently. Benefits include simplicity and the ability to rate individual responses without requiring comparison materials. Drawbacks include scale usage inconsistency (one annotator's "4" is another's "3"), central tendency bias, and difficulty comparing across studies.

**Pairwise comparison** asks annotators to indicate which of two responses is better. Benefits include higher inter-rater reliability (comparisons are cognitively easier than absolute ratings), natural resistance to scale calibration issues, and the ability to aggregate into robust rankings via Bradley-Terry models or Elo ratings. Drawbacks include O(n^2) comparisons for n systems, the inability to assess absolute quality, and the challenge of handling ties.

Research consistently shows that pairwise comparison produces more reliable human judgments. Novikova et al. (2018) demonstrated this in NLG evaluation, finding significantly higher inter-annotator agreement for pairwise comparisons compared to Likert scales. The Chatbot Arena system (Zheng et al., 2023) builds on this insight at scale.

**Best-worst scaling** (BWS) is a compromise: show annotators 3-4 items and ask them to identify the best and worst. This generates more ranking information per annotation than pairwise comparison while remaining cognitively manageable. Kiritchenko and Mohammad (2017) showed that BWS produces reliable rankings with fewer annotations than Likert scales.

### Question and Prompt Design

The prompts shown to annotators affect their judgments:

- **Avoid leading language**: "How good is this response?" biases toward positive ratings. "Evaluate this response" is more neutral.
- **Randomize order**: If showing multiple responses, randomize presentation order to mitigate primacy and recency effects.
- **Control for anchoring**: The first example an annotator sees calibrates their internal scale. Ensure the first example is neither exceptionally good nor bad.
- **Minimize cognitive load**: Keep annotation interfaces clean. Do not require annotators to evaluate too many dimensions simultaneously -- 3-5 is a practical maximum per screen.

## Inter-Rater Reliability

### Why It Matters

Inter-rater reliability (IRR) quantifies the degree to which different annotators agree. Low IRR means the annotation task is either poorly defined or inherently subjective. Without measuring IRR, you cannot know whether your evaluation data is meaningful.

### Cohen's Kappa

Cohen's kappa measures agreement between two raters on categorical judgments, correcting for chance agreement:

$$\kappa = \frac{p_o - p_e}{1 - p_e}$$

where $p_o$ is the observed agreement and $p_e$ is the expected agreement by chance.

```python
def cohens_kappa(rater1: list, rater2: list) -> float:
    assert len(rater1) == len(rater2)
    n = len(rater1)
    categories = set(rater1) | set(rater2)

    # Observed agreement
    p_o = sum(a == b for a, b in zip(rater1, rater2)) / n

    # Expected agreement by chance
    p_e = sum(
        (rater1.count(c) / n) * (rater2.count(c) / n)
        for c in categories
    )

    if p_e == 1.0:
        return 1.0
    return (p_o - p_e) / (1 - p_e)
```

Interpretation guidelines (Landis & Koch, 1977):
- 0.81-1.00: Almost perfect agreement
- 0.61-0.80: Substantial agreement
- 0.41-0.60: Moderate agreement
- 0.21-0.40: Fair agreement
- Below 0.20: Slight agreement

For LLM evaluation tasks, aim for kappa above 0.6 for factual dimensions and above 0.4 for subjective dimensions like "naturalness" or "creativity."

### Krippendorff's Alpha

Krippendorff's alpha generalizes beyond Cohen's kappa in several ways:

- Supports any number of raters (not just two)
- Handles missing data (not every rater rates every item)
- Works with different measurement scales (nominal, ordinal, interval, ratio)

```python
import krippendorff
import numpy as np

def compute_alpha(annotations: np.ndarray, level: str = "ordinal") -> float:
    """
    annotations: shape (n_raters, n_items), with np.nan for missing
    level: "nominal", "ordinal", "interval", or "ratio"
    """
    return krippendorff.alpha(
        reliability_data=annotations,
        level_of_measurement=level
    )

# Example: 3 raters, 10 items, ordinal scale
ratings = np.array([
    [3, 4, 3, 2, 5, 4, 3, 4, 2, 5],       # Rater 1
    [3, 3, 4, 2, 5, 4, 3, 4, 3, 5],       # Rater 2
    [4, 4, 3, 2, 4, np.nan, 3, 4, 2, 5],  # Rater 3 (one missing)
])

alpha = compute_alpha(ratings, level="ordinal")
print(f"Krippendorff's alpha: {alpha:.3f}")
```

Krippendorff recommends alpha above 0.8 for reliable conclusions and above 0.667 as a minimum for tentative conclusions. For ordinal scales, the ordinal-level alpha accounts for the fact that a disagreement of 1 point is less severe than a disagreement of 3 points.

### Measuring and Improving IRR

Low IRR is diagnostic, not just a number to report. When IRR is low:

1. **Examine disagreements**: Look at the specific examples where annotators disagree. Are they genuinely ambiguous, or is the annotation guideline unclear?
2. **Refine guidelines**: Add examples and clarifications that address the specific sources of disagreement.
3. **Calibration sessions**: Have annotators discuss their reasoning on disagreement cases. This aligns their mental models.
4. **Iterate**: Annotate a fresh batch, measure IRR again, and repeat until reliability is acceptable.

This iterative calibration process typically requires 2-4 rounds. Document each iteration, including which guideline changes were made and how they affected IRR.

## Crowdsourcing vs. Expert Evaluation

### Crowdsourced Evaluation

Several platforms provide access to large pools of annotators, though the landscape has shifted significantly in recent years:

**Prolific** has largely replaced Amazon Mechanical Turk (MTurk) as the platform of choice for research-grade annotation. Prolific pre-screens participants for demographics and language proficiency, enforces minimum pay rates (helping ensure data quality), and provides built-in tools for longitudinal studies. Its participant pool skews more educated and attentive than MTurk, and rejection rates for attention checks are substantially lower.

**Surge AI** specializes in AI training data, offering managed annotation teams with domain expertise. Surge is particularly useful for tasks that require consistency across annotators, like RLHF preference labeling (see Article 21) or safety annotation for red teaming (see Article 35), because their workforce is trained and calibrated rather than ad hoc.

**Scale AI** serves enterprise-scale annotation needs, combining human annotators with automated quality control pipelines. Scale's RLHF annotation product handles the full pipeline from prompt curation through preference ranking, and their Remotasks platform provides access to large annotator pools for high-volume work.

**Amazon Mechanical Turk** still exists but has experienced declining data quality and workforce engagement. For AI evaluation tasks specifically, Prolific or Surge AI are generally better choices unless you need very high throughput on extremely simple tasks.

Advantages of crowdsourcing:
- Scale: Hundreds of annotations per hour
- Diversity: Annotators from varied backgrounds
- Speed: Results within hours to days
- Cost: $0.10-$2.00 per annotation for standard tasks (platform dependent)

Challenges and mitigations:

**Quality control**: Some crowdworkers produce low-quality annotations. Standard mitigations include:

```python
class CrowdsourceQualityControl:
    def __init__(self, gold_questions: list, min_accuracy: float = 0.8):
        self.gold_questions = gold_questions
        self.min_accuracy = min_accuracy

    def filter_workers(self, worker_responses: dict) -> list:
        """Filter workers based on gold question accuracy."""
        qualified = []
        for worker_id, responses in worker_responses.items():
            gold_correct = sum(
                1 for q in self.gold_questions
                if responses.get(q["id"]) == q["gold_answer"]
            )
            accuracy = gold_correct / len(self.gold_questions)
            if accuracy >= self.min_accuracy:
                qualified.append(worker_id)
        return qualified

    def aggregate_labels(self, worker_labels: dict,
                         qualified_workers: list,
                         min_annotations: int = 3) -> dict:
        """Majority vote from qualified workers only."""
        from collections import Counter
        aggregated = {}
        for item_id, labels in worker_labels.items():
            qualified_labels = [
                label for worker, label in labels
                if worker in qualified_workers
            ]
            if len(qualified_labels) >= min_annotations:
                counter = Counter(qualified_labels)
                aggregated[item_id] = counter.most_common(1)[0][0]
        return aggregated
```

- **Gold standard questions**: Embed items with known answers. Filter out workers who fail these.
- **Attention checks**: Include obviously easy items to detect random clicking.
- **Redundancy**: Collect 3-5 annotations per item and aggregate via majority vote or more sophisticated methods (Dawid-Skene model).
- **Fair compensation**: Underpaying workers leads to low-effort annotations. Pay at least minimum wage equivalent. Prolific has built-in protections for this.

### Expert Evaluation

For specialized domains (medical, legal, scientific), crowd workers typically lack the knowledge to evaluate accurately. Expert evaluation is essential but introduces its own challenges:

- **Cost**: $50-200+ per hour for domain experts
- **Availability**: Experts have limited time and competing demands
- **Calibration**: Even experts may disagree on complex cases

Best practices for expert evaluation:
- Involve experts in guideline design, not just annotation
- Provide structured rubrics that channel expert knowledge into consistent judgments
- Use Delphi-method-inspired approaches: independent rating followed by discussion of disagreements
- Plan for 2-3 experts per item minimum

### When to Use Which

| Factor | Crowdsourcing | Expert |
|--------|--------------|--------|
| Task requires domain knowledge | No | Yes |
| Scale needed (1000+ items) | Yes | Difficult |
| Budget constrained | Yes | Challenging |
| Subjective quality judgment | Both work | Better for nuanced tasks |
| Safety/harm evaluation | Expert preferred | Yes |
| Factual accuracy verification | Domain dependent | Yes for specialized domains |

## RLHF Annotation Pipelines

Reinforcement Learning from Human Feedback (RLHF) places human annotation at the center of model training, not just evaluation. The annotation pipeline for RLHF has specific requirements that go beyond standard evaluation.

### The Annotation Task

In the standard RLHF pipeline (Ouyang et al., 2022, InstructGPT), annotators perform two types of tasks:

1. **Demonstration writing**: Given a prompt, write an ideal response. These demonstrations are used for supervised fine-tuning (SFT).
2. **Comparison ranking**: Given a prompt and 4-7 model responses, rank them from best to worst. These rankings train the reward model.

### Scaling RLHF Annotations

The InstructGPT paper used approximately 40 contractors for annotation. The team invested heavily in:

- **Screening**: Multi-stage screening process to select annotators who aligned with the desired output style
- **Training**: Detailed guidelines with extensive examples, iteratively refined based on annotator feedback
- **Ongoing calibration**: Regular calibration sessions where annotators and researchers discussed edge cases
- **Quality monitoring**: Continuous tracking of inter-annotator agreement and individual annotator quality

### Constitutional AI and Reduced Human Dependence

Anthropic's Constitutional AI (Bai et al., 2022) reduces the annotation burden by replacing some human feedback with AI-generated feedback based on a set of principles. However, the principles themselves are human-authored, and human evaluation is still needed to validate that the constitutional approach produces aligned behavior. For the full technical picture of how preference data flows into reward models and policy optimization, see Article 21.

The trend in the field is toward hybrid approaches: human annotation for the highest-leverage decisions (defining principles, validating edge cases, evaluating safety) combined with AI-assisted annotation for scale.

## Practical Considerations for Scale

### Sample Size Planning

How many annotations do you need? This depends on the desired precision of your estimate:

For comparing two systems with pairwise evaluation, the required sample size for detecting a difference of $\delta$ in win rate with power $1-\beta$ and significance $\alpha$:

```python
from scipy import stats
import math

def required_sample_size(effect_size: float, alpha: float = 0.05,
                         power: float = 0.8) -> int:
    """
    Minimum pairwise comparisons needed to detect a given win rate difference.
    effect_size: expected win rate difference (e.g., 0.05 for 5%)
    """
    # Using normal approximation for binomial test
    z_alpha = stats.norm.ppf(1 - alpha / 2)
    z_beta = stats.norm.ppf(power)
    p = 0.5 + effect_size / 2  # Convert to win probability
    n = ((z_alpha + z_beta) ** 2 * p * (1 - p)) / (effect_size ** 2)
    return math.ceil(n)

# Example: detect a 5% win rate difference
n = required_sample_size(0.05)
print(f"Need {n} comparisons")  # Approximately 385
```

For small effect sizes (typical in LLM comparisons), you need hundreds of annotations. Plan accordingly.

### Cost Optimization

Strategies to reduce cost without sacrificing quality:

1. **Tiered evaluation**: Use automated metrics to filter out clearly bad outputs. Only send borderline cases to human evaluators.
2. **Active learning for annotation**: Prioritize annotating examples where the model is most uncertain or where automated metrics disagree.
3. **Efficient annotation interfaces**: Good UI reduces annotation time. Side-by-side comparison layouts, keyboard shortcuts, and clear highlighting all help.
4. **Batch design**: Group related items together so annotators build context efficiently rather than context-switching between unrelated tasks.

### Annotation Interface Design

The interface directly impacts annotation quality:

```
Good practices:
- Side-by-side layout for pairwise comparison
- Highlight differences between responses
- Show the full conversation context
- Allow annotators to flag ambiguous or problematic items
- Record annotation time (identifies rushed or stuck annotators)
- Require written justification for extreme ratings

Bad practices:
- Tiny text or cluttered layouts
- Requiring scrolling to see both responses
- No option to skip or flag problematic items
- No progress indicator
- No breaks enforced for long sessions
```

### Annotator Wellbeing

For safety evaluation and red teaming tasks (see Article 35 for adversarial testing methodology), annotators may be exposed to harmful, disturbing, or offensive content. Ethical considerations include:

- Informed consent about the nature of the content
- Content warnings and opt-out provisions
- Regular check-ins and access to support resources
- Compensation that reflects the psychological burden
- Session length limits to prevent burnout
- Rotation between distressing and neutral tasks

The Partnership on AI's guidelines on responsible practices for synthetic media (2023) and similar frameworks provide relevant ethical guidance.

## Combining Human and Automated Evaluation

The optimal evaluation strategy is rarely purely human or purely automated. A layered approach:

1. **Automated metrics** (BLEU, ROUGE, BERTScore) for rapid iteration during development
2. **LLM-as-Judge** (see Article 33) for medium-stakes decisions (prompt selection, parameter tuning)
3. **Human evaluation** for high-stakes decisions (model release, safety assessment, red teaming as described in Article 35) and to calibrate the layers above
4. **Ongoing human monitoring** of production outputs to detect drift

```python
class LayeredEvaluation:
    def __init__(self, auto_metrics, llm_judge, human_eval_budget):
        self.auto_metrics = auto_metrics
        self.llm_judge = llm_judge
        self.human_budget = human_eval_budget

    def evaluate(self, candidates):
        # Layer 1: Automated metrics (cheap, fast, all candidates)
        auto_scores = {c: self.auto_metrics(c) for c in candidates}

        # Layer 2: LLM judge (moderate cost, top candidates)
        top_k = sorted(candidates, key=lambda c: auto_scores[c])[-10:]
        llm_scores = {c: self.llm_judge(c) for c in top_k}

        # Layer 3: Human evaluation (expensive, final candidates)
        final = sorted(top_k, key=lambda c: llm_scores[c])[-3:]
        human_scores = self.human_eval(final)

        return human_scores
```

## LLM-Assisted Annotation

The most significant development in human evaluation methodology is the emergence of hybrid human-AI annotation workflows. Rather than treating human and automated evaluation as separate tiers, LLM-assisted annotation uses language models to pre-annotate data that humans then review and correct. This approach can reduce annotation cost by 40-60% while maintaining or even improving quality compared to purely human workflows.

### Pre-Annotation with Human Correction

The core pattern is straightforward: run an LLM judge (see Article 33 for judge design and calibration) over all items first, then route items to human annotators based on the model's confidence.

```python
class LLMPreAnnotationPipeline:
    def __init__(self, llm_judge, confidence_threshold: float = 0.85):
        self.llm_judge = llm_judge
        self.confidence_threshold = confidence_threshold

    def pre_annotate(self, items: list[dict]) -> dict:
        """
        Pre-annotate items and split into auto-accepted
        and human-review queues.
        """
        auto_accepted = []
        human_review = []

        for item in items:
            judgment = self.llm_judge.evaluate(item)
            item["llm_label"] = judgment["label"]
            item["llm_confidence"] = judgment["confidence"]
            item["llm_rationale"] = judgment["rationale"]

            if judgment["confidence"] >= self.confidence_threshold:
                auto_accepted.append(item)
            else:
                human_review.append(item)

        return {
            "auto_accepted": auto_accepted,
            "human_review": human_review,
            "auto_rate": len(auto_accepted) / len(items),
        }

    def human_correction_pass(self, human_review: list[dict],
                               human_labels: dict) -> list[dict]:
        """
        Merge human corrections, tracking where humans
        overrode the LLM.
        """
        corrected = []
        override_count = 0
        for item in human_review:
            human_label = human_labels.get(item["id"])
            if human_label and human_label != item["llm_label"]:
                override_count += 1
                item["final_label"] = human_label
                item["source"] = "human_override"
            else:
                item["final_label"] = item["llm_label"]
                item["source"] = "human_confirmed"
            corrected.append(item)

        override_rate = override_count / len(human_review) if human_review else 0
        print(f"Human override rate: {override_rate:.1%}")
        return corrected
```

The key design decisions in this pipeline:

**Confidence thresholds determine the cost-quality tradeoff.** A threshold of 0.85 might auto-accept 60% of items, sending only 40% to human review. Lowering it to 0.70 auto-accepts more but risks propagating LLM errors. The right threshold depends on your tolerance for label noise and should be calibrated against a fully human-annotated validation set.

**Human annotators see the LLM's pre-annotation and rationale.** This is deliberately a review-and-correct task, not an independent annotation. Showing the LLM's reasoning speeds up agreement cases (the annotator confirms and moves on) while still allowing correction of errors. However, this introduces anchoring bias -- annotators may be reluctant to override the LLM's suggestion. Mitigate this by explicitly instructing annotators that correction is expected and valued, and by tracking override rates as a quality signal.

**Override rate monitoring is essential.** If humans override the LLM on fewer than 5% of reviewed items, either the LLM is genuinely excellent or your annotators are rubber-stamping. Inject known LLM errors as verification items to distinguish these cases.

### Workflow Variants

Several hybrid workflow designs have emerged in practice:

**LLM-first, human-audit**: The LLM labels everything. A random sample (10-20%) goes to human review. If the human agreement rate on the sample exceeds a threshold (typically 90%+), the full batch is accepted. This is the most cost-efficient approach but provides less per-item quality assurance.

**Confidence-routed**: Items above the confidence threshold are auto-accepted; items below go to human review. This concentrates human effort on genuinely ambiguous cases where human judgment adds the most value.

**Parallel-then-adjudicate**: Both the LLM and a human annotate independently. A second human (or senior annotator) adjudicates only the disagreements. This produces the highest-quality labels but is more expensive than confidence routing.

**Cascaded difficulty**: The LLM pre-classifies items by difficulty. Easy items get LLM-only labels. Medium items get LLM pre-annotation with crowd-worker review. Hard items go to domain experts. This tiered approach aligns annotator expertise (and cost) with task difficulty.

For tasks that feed into RLHF preference data (see Article 21), the confidence-routed approach is most common. Preference pairs where the LLM judge strongly agrees on a winner can be auto-accepted, while close calls -- which are also the most informative training examples -- receive human judgment.

## Cost Benchmarking

Human evaluation costs are frequently underestimated, leading to underpowered studies or budget overruns. The following benchmarks, drawn from published research and industry practice as of 2025, provide realistic planning figures.

### Per-Annotation Cost by Task Type

| Task Type | Platform | Cost per Annotation | Annotations/Hour | Notes |
|-----------|----------|-------------------|-------------------|-------|
| Binary preference (A vs B) | Prolific | $0.30-$0.60 | 40-60 | Simplest judgment task |
| Likert rating (single dimension) | Prolific | $0.20-$0.50 | 50-80 | Fast with clear rubrics |
| Multi-dimension rubric (3-5 dims) | Prolific | $0.80-$2.00 | 15-25 | Complexity scales linearly with dimensions |
| Pairwise with written rationale | Surge AI | $1.50-$3.00 | 10-20 | Rationales slow annotation but improve quality |
| Safety/harm evaluation | Surge AI | $2.00-$5.00 | 8-15 | Requires trained annotators, content moderation protocols |
| Domain expert (medical, legal) | Direct hire | $15-$50 | 5-15 | Highly variable by domain and expertise level |
| RLHF preference ranking (4-7 responses) | Scale AI | $3.00-$8.00 | 5-10 | Reading and ranking multiple responses is time-intensive |

### Study-Level Cost Estimates

A typical human evaluation study for comparing two LLM systems involves:

**Minimum viable study** (detecting a 10% win-rate difference):
- ~200 pairwise comparisons at 3 annotators each = 600 annotations
- Using Prolific at $0.50/annotation: **$300** in annotation cost
- Plus platform fees, qualification screening: **$400-$500 total**
- Turnaround: 2-4 days

**Standard academic study** (detecting a 5% difference, publishable statistical power):
- ~400 comparisons at 3-5 annotators each = 1,200-2,000 annotations
- Using Prolific at $0.50/annotation: **$600-$1,000** in annotation cost
- With pilot studies and calibration rounds: **$1,200-$2,000 total**
- Turnaround: 1-2 weeks

**Enterprise evaluation** (multi-dimension, high confidence, safety-inclusive):
- ~1,000 items across 3-5 evaluation dimensions, 3-5 annotators per item
- Mixed annotator tiers (crowd + expert for safety dimensions)
- Annotation cost: **$5,000-$15,000**
- Including pipeline development, annotator training, quality monitoring: **$15,000-$40,000 total**
- Turnaround: 3-6 weeks

**RLHF data collection** (sufficient for reward model training):
- 50,000-100,000 preference pairs (InstructGPT scale)
- Using managed annotation (Scale AI / Surge AI): **$150,000-$500,000**
- Turnaround: 2-4 months with a dedicated annotation team

### Reducing Cost with Hybrid Approaches

LLM pre-annotation (described in the previous section) can substantially reduce these costs. The savings depend on the auto-acceptance rate and the quality requirements:

| Approach | Relative Cost | Quality Impact | Best For |
|----------|--------------|----------------|----------|
| Fully human | 1.0x (baseline) | Highest | Safety-critical, novel tasks |
| LLM-first, human audit (20%) | 0.25-0.35x | Slight risk of undetected errors | High-volume, well-defined tasks |
| Confidence-routed (60% auto) | 0.45-0.55x | Minimal if threshold is calibrated | General evaluation |
| Parallel + adjudication | 1.2-1.5x | Highest (exceeds fully human) | Ground truth dataset creation |

The economics are clear: for tasks where an LLM judge achieves above 85% agreement with human annotators (see Article 33 for how to measure this), hybrid approaches dominate purely human evaluation on cost-adjusted quality. The savings compound with scale -- a team running continuous evaluation as part of a dataset curation pipeline (see Article 22) can redirect human annotator budget toward the genuinely hard cases where expert judgment is irreplaceable.

### Budget Planning Checklist

When scoping a human evaluation project, account for these commonly overlooked costs:

1. **Pilot study**: 50-100 items to test and refine the annotation protocol. Budget 10-15% of total annotation cost.
2. **Calibration rounds**: 2-4 rounds of annotator calibration before the main study. Budget 5-10%.
3. **Platform fees**: Prolific charges ~33% on top of participant pay. Surge AI and Scale AI bundle fees into per-annotation pricing.
4. **Qualification screening**: Pre-screening tasks to filter annotator quality. Budget $50-$200 per screening round.
5. **Disagreement adjudication**: Expert review of annotator disagreements. Budget 5-10% of total.
6. **Analysis time**: Your team's time to analyze results, compute IRR, and iterate. Often exceeds the annotation cost itself.

## Summary and Key Takeaways

- **Annotation protocol design is the foundation.** Invest in specific dimensions, anchored scales, worked examples, and iterative refinement. Vague instructions produce noisy data.
- **Pairwise comparison is more reliable** than Likert scales for most evaluation tasks. Consider best-worst scaling as a practical compromise.
- **Always measure inter-rater reliability.** Cohen's kappa for two raters, Krippendorff's alpha for multiple raters. Low IRR means your data may not support valid conclusions.
- **Crowdsourcing works for general tasks** with proper quality control (gold questions, redundancy, fair pay). Expert evaluation is essential for specialized domains.
- **Plan sample sizes in advance.** Detecting small differences between models requires hundreds of annotations. Underpowered studies waste resources.
- **RLHF annotation pipelines** require careful annotator selection, training, and ongoing calibration to produce useful training signal.
- **Combine human and automated evaluation** in layers, using human judgment for the highest-stakes decisions and to calibrate cheaper automated methods (see Article 33 for the LLM-as-Judge layer).
- **LLM pre-annotation with human correction** reduces cost by 40-60% for well-defined tasks. Confidence-routed workflows concentrate human effort on genuinely ambiguous cases where it adds the most value.
- **Budget realistically.** A publishable academic study costs $1,200-$2,000. Enterprise-scale evaluation with safety dimensions costs $15,000-$40,000. Pilot studies, calibration rounds, and analysis time are commonly overlooked line items.

Human evaluation is expensive, slow, and imperfect -- and there is no substitute for it. The methodology described here aims to make it as reliable, efficient, and informative as possible.
