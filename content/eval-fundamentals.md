# LLM Evaluation Fundamentals: Metrics, Datasets & Methodology

Evaluating large language models requires a principled framework that goes far beyond simple accuracy checks. The rapid proliferation of LLMs has exposed deep methodological gaps in how we measure model quality, from metric selection to dataset construction to statistical rigor. This article provides a practitioner-grounded tour of evaluation fundamentals, covering the metrics that matter, the benchmarks that define the field, and the methodology needed to draw valid conclusions.

## Why Evaluation Is Hard for Language Models

Traditional machine learning evaluation assumes a well-defined task with clear ground truth. Language models break this assumption in several ways:

- **Open-ended outputs**: There is no single correct answer to "write a poem about autumn." Any metric that compares against a single reference will penalize valid alternatives.
- **Surface-form variation**: The same semantic content can be expressed in countless ways. "Barack Obama," "Obama," and "the 44th president" are all correct, but string matching treats them as different.
- **Capability breadth**: LLMs are general-purpose systems. Evaluation must cover a combinatorial explosion of tasks — reasoning, coding, creative writing, factual recall, instruction following — each requiring different metrics.
- **Stochastic outputs**: Temperature, sampling strategies, and prompt phrasing all influence outputs, meaning evaluation must account for variance across runs.

The consequence is that LLM evaluation is inherently multi-dimensional. A model might excel at factual recall but fail at reasoning. It might produce fluent text that is subtly wrong. It might follow instructions precisely but lack creativity. The evaluation framework must capture these distinctions, which means understanding what each metric actually measures and where it breaks down.

## Core Metrics: What They Measure and Where They Fail

### Accuracy and Exact Match

The simplest metric: does the model's output exactly match the reference? Exact match (EM) is used in extractive QA benchmarks like SQuAD and closed-form tasks where the answer space is constrained. Accuracy generalizes this to classification tasks.

The limitation is obvious: exact match penalizes correct answers that differ in surface form. For this reason, exact match is typically paired with softer metrics. In practice, most evaluation pipelines normalize whitespace, punctuation, and casing before computing EM, and even then it misses valid paraphrases.

### F1 Score (Token-Level)

Token-level F1 treats the prediction and reference as bags of tokens and computes precision and recall over their overlap. This is more forgiving than exact match but still operates at the lexical level.

```python
def token_f1(prediction: str, reference: str) -> float:
    pred_tokens = prediction.lower().split()
    ref_tokens = reference.lower().split()
    common = set(pred_tokens) & set(ref_tokens)
    if len(common) == 0:
        return 0.0
    precision = len(common) / len(pred_tokens)
    recall = len(common) / len(ref_tokens)
    return 2 * (precision * recall) / (precision + recall)

# Example: semantically identical but lexically different
print(token_f1("the cat sat on the mat", "a feline rested on the rug"))
# 0.4 — penalizes valid paraphrases
```

Token F1 cannot recognize paraphrases or handle cases where the model provides additional correct context beyond what the reference contains. It is a useful quick check but should never be the sole metric.

### BLEU Score

BLEU measures n-gram overlap between generated text and one or more references. It computes modified precision for n-grams of size 1 through 4 and applies a brevity penalty to discourage overly short outputs. Originally designed for machine translation.

BLEU has well-documented limitations for LLM evaluation:

- It correlates poorly with human judgment on open-ended generation tasks
- A sentence with all the right words in the wrong order can score well
- It penalizes valid paraphrases and creative reformulations
- It is reference-dependent: the quality of BLEU scores is bounded by the quality and diversity of the references

Despite these issues, BLEU remains widely reported due to its simplicity and the need for comparable numbers across work. When using BLEU, always pair it with at least one semantic metric.

### ROUGE

ROUGE is the standard metric for summarization. The main variants:

- **ROUGE-N**: Measures n-gram recall between generated summary and reference
- **ROUGE-L**: Computes the longest common subsequence
- **ROUGE-Lsum**: Applies LCS at the sentence level for multi-sentence summaries

ROUGE shares many of BLEU's limitations regarding surface-form dependence. However, its focus on recall rather than precision makes it more appropriate for summarization, where the question is "did the summary capture the key content?" rather than "is every generated word in the reference?"

```python
from rouge_score import rouge_scorer

scorer = rouge_scorer.RougeScorer(['rouge1', 'rouge2', 'rougeL'], use_stemmer=True)
scores = scorer.score(
    "The model uses attention mechanisms to process input sequences in parallel.",
    "Attention allows parallel processing of input sequences by the model."
)
for key, value in scores.items():
    print(f"{key}: precision={value.precision:.3f}, recall={value.recall:.3f}, f1={value.fmeasure:.3f}")
```

### BERTScore

BERTScore addresses the lexical matching limitation by computing similarity in embedding space. It uses contextual embeddings from a pretrained model (typically RoBERTa) to compute token-level cosine similarities between the candidate and reference, then aggregates via greedy matching.

```python
from bert_score import score

candidates = ["The cat sat on the mat."]
references = ["A feline was resting on the rug."]

P, R, F1 = score(candidates, references, lang="en", rescale_with_baseline=True)
print(f"BERTScore F1: {F1.item():.4f}")
# Much higher than lexical metrics for semantically equivalent text
```

BERTScore correlates better with human judgment than BLEU or ROUGE on many tasks, but it is not without issues:

- The choice of underlying model affects results significantly — RoBERTa-large and DeBERTa produce different scores
- The metric is computationally expensive compared to string matching
- It still requires reference text, limiting applicability to open-ended generation
- Score distributions vary by language and domain, making cross-task comparison difficult

### Perplexity and Its Limitations

Perplexity measures how well a language model predicts a held-out text corpus. Formally, it is the exponentiated average negative log-likelihood per token:

$$PPL = \exp\left(-\frac{1}{N}\sum_{i=1}^{N}\log p(x_i | x_{<i})\right)$$

Lower perplexity means the model assigns higher probability to the observed text. Perplexity is useful for comparing models trained on similar data with similar tokenizers, but it has critical limitations:

1. **Tokenizer dependence**: Models with different tokenizers produce incomparable perplexity values because they define "token" differently. A BPE tokenizer with 32K vocab and one with 128K vocab tokenize the same text differently, making their perplexities incommensurable.
2. **Not a task metric**: Low perplexity does not imply good task performance. A model can be excellent at next-token prediction while being terrible at following instructions or reasoning.
3. **Distribution sensitivity**: Perplexity on one corpus says little about performance on a different distribution. A model trained on code will have low perplexity on code but high perplexity on poetry.
4. **Context window effects**: Perplexity computation is affected by the context window size. Sliding-window perplexity and strided perplexity give different results for the same model on the same text.

Perplexity is best understood as an intrinsic metric that measures language modeling quality, not as an extrinsic metric that measures usefulness.

## Benchmark Suites: The Standard Evaluations

### MMLU (Massive Multitask Language Understanding)

MMLU tests knowledge across 57 subjects spanning STEM, humanities, social sciences, and professional domains. Each question is multiple-choice with four options. The benchmark ranges from elementary-level to professional-exam difficulty.

MMLU has become the de facto standard for measuring broad knowledge. However, it has known issues:

- Some questions are ambiguous or have debatable correct answers
- The multiple-choice format constrains evaluation to recognition rather than generation
- High-performing models are approaching saturation on many subjects
- The 5-shot evaluation protocol is standard but introduces sensitivity to example selection
- Several questions have been identified as incorrectly labeled

### HellaSwag

HellaSwag evaluates commonsense reasoning through sentence completion. Given a context, the model must select the most plausible continuation from four options. The dataset was constructed using adversarial filtering against earlier-generation models, making the distractors challenging for those architectures.

HellaSwag tests a specific type of reasoning: understanding what typically happens next in everyday scenarios. Frontier models now score above 95%, raising questions about whether it still discriminates meaningfully between top models. It remains useful for evaluating smaller or specialized models.

### HumanEval

HumanEval evaluates code generation through 164 Python programming problems. Each problem includes a function signature, docstring, and test cases. The primary metric is pass@k: the probability that at least one of k generated samples passes all test cases.

```python
# Example HumanEval problem structure
def has_close_elements(numbers: List[float], threshold: float) -> bool:
    """Check if in given list of numbers, are any two numbers
    closer to each other than given threshold.
    >>> has_close_elements([1.0, 2.0, 3.0], 0.5)
    False
    >>> has_close_elements([1.0, 2.8, 3.0, 4.0, 5.0, 2.0], 0.3)
    True
    """
```

Pass@k is estimated using an unbiased estimator rather than simply generating k samples and checking:

$$\text{pass@k} = 1 - \frac{\binom{n-c}{k}}{\binom{n}{k}}$$

where n is total samples generated and c is the number that pass. HumanEval has spawned extensions like HumanEval+ with more rigorous test cases and MultiPL-E for multilingual code evaluation.

### Other Notable Benchmarks

- **GSM8K**: Grade school math word problems testing multi-step arithmetic reasoning. The step-by-step solution format makes it a standard test for chain-of-thought reasoning.
- **TruthfulQA**: Questions designed to elicit common misconceptions, testing whether models reproduce popular falsehoods rather than stating the truth.
- **WinoGrande**: Pronoun resolution requiring commonsense reasoning about real-world situations.
- **ARC (AI2 Reasoning Challenge)**: Science questions from grade school exams, with an easy set and a challenge set. The challenge set filters for questions that retrieval and co-occurrence methods get wrong.
- **BBH (BIG-Bench Hard)**: A curated subset of BIG-Bench tasks where language models previously performed below average human raters. Includes algorithmic, logical, and linguistic reasoning tasks.

### 2024-2025 Benchmarks and the Saturation Problem

As frontier models saturate older benchmarks, the evaluation community has introduced harder suites designed to maintain discriminative power:

- **MMLU-Pro**: An expanded, harder version of MMLU with 10 answer choices instead of 4 and heavier emphasis on reasoning-intensive questions. The larger option set reduces guessing impact (random baseline drops from 25% to 10%) and the inclusion of more multi-step problems widens the gap between models that have memorized facts and those that can reason over them. Increasingly replacing vanilla MMLU as the primary knowledge benchmark.

- **GPQA (Graduate-Level Google-Proof QA)**: Expert-crafted questions in biology, physics, and chemistry deliberately resistant to web search. Domain experts with PhDs achieve roughly 65% accuracy, while non-expert humans with unrestricted internet access score around 34%. This makes GPQA a meaningful ceiling test: if a model exceeds non-expert-with-search performance, it is demonstrating something beyond pattern matching.

- **FrontierMath**: Original, unpublished mathematics problems created by research mathematicians, spanning computation, proof construction, and mathematical insight. Even strong math-specialized models score in the low single digits. Designed to remain unsaturated for years.

- **ARC-AGI**: Tests fluid intelligence through novel visual pattern-completion puzzles. Each task requires identifying an abstract transformation rule from a handful of input-output grid pairs, then applying it to a new input. Trivial for most humans but extremely difficult for current LLMs, making it a litmus test for genuine abstraction rather than knowledge retrieval.

- **SWE-bench**: Real GitHub issues from popular Python repositories, requiring a model to generate code patches that resolve the issue and pass the repository's test suite. Evaluates practical software engineering capability end-to-end: reading code, understanding requirements, and producing working fixes. The verified subset uses human-validated issues for cleaner signal.

- **LiveBench**: Refreshes its questions monthly from recent sources to combat contamination. Questions are drawn from recent math competitions, news articles, and newly published datasets, making memorization ineffective. Addresses one of the deepest structural problems in static benchmarks.

The pattern across these newer benchmarks is clear: as models improve, evaluations must escalate in difficulty and freshness. Benchmark saturation is not merely an academic nuisance — it means that reported scores stop correlating with real capability differences. When the top ten models all score between 86% and 89%, the evaluation has lost its discriminative power, and further investment in that metric becomes misleading. For a deeper treatment of contamination and saturation dynamics, see [Benchmark Design: Contamination, Saturation & Domain-Specific Evals](/benchmark-design).

## Evaluation Methodology: Getting It Right

### Held-Out Test Sets and Data Contamination

The most fundamental requirement in evaluation is that the model has not seen the test data during training. With LLMs trained on massive web corpora, this is increasingly difficult to guarantee. Benchmark contamination — where test examples appear in training data — is a pervasive concern.

For custom evaluations, the standard practice is a train/validation/test split:

- **Test set**: Held out entirely during development, including hyperparameter tuning. Only used for final reporting.
- **Validation set**: Used for development decisions — prompt tuning, threshold selection, hyperparameter search.
- **Training set**: Used for fine-tuning or few-shot example selection.

This discipline is critical: optimizing against the test set, even indirectly through iterative prompt tuning, invalidates results. A common mistake is treating the test set as a development tool, running dozens of prompt variations against it until scores improve, then reporting the best run as the "result."

### Cross-Validation for LLMs

Traditional k-fold cross-validation is rarely applied to LLM pretraining due to computational cost. However, it is relevant for:

1. **Few-shot prompt selection**: When choosing between prompt templates or few-shot examples, cross-validation over the evaluation set prevents overfitting to a particular split.
2. **Fine-tuning evaluation**: When fine-tuning on small datasets, k-fold cross-validation provides more robust performance estimates than a single split.
3. **Evaluation set construction**: Stratified sampling ensures the evaluation set covers the distribution of interest.

```python
from sklearn.model_selection import StratifiedKFold
import numpy as np

def cross_validate_prompt(examples, labels, prompt_fn, model, k=5):
    """Evaluate a prompt template using stratified k-fold cross-validation."""
    skf = StratifiedKFold(n_splits=k, shuffle=True, random_state=42)
    scores = []
    for train_idx, test_idx in skf.split(examples, labels):
        few_shot = [examples[i] for i in train_idx[:5]]
        test_examples = [examples[i] for i in test_idx]
        test_labels = [labels[i] for i in test_idx]
        predictions = [model(prompt_fn(few_shot, ex)) for ex in test_examples]
        scores.append(compute_metric(predictions, test_labels))
    return np.mean(scores), np.std(scores)
```

### Statistical Significance in Evaluation

Reporting a single accuracy number without confidence intervals is unfortunately common but methodologically insufficient. Key practices:

**Bootstrap confidence intervals**: Resample the test set with replacement many times, compute the metric on each resample, and report the 95% confidence interval. This is assumption-free and works for any metric.

```python
import numpy as np

def bootstrap_ci(scores, n_bootstrap=10000, ci=0.95):
    """Compute bootstrap confidence interval for a set of scores."""
    bootstrapped = []
    for _ in range(n_bootstrap):
        sample = np.random.choice(scores, size=len(scores), replace=True)
        bootstrapped.append(np.mean(sample))
    lower = np.percentile(bootstrapped, (1 - ci) / 2 * 100)
    upper = np.percentile(bootstrapped, (1 + ci) / 2 * 100)
    return np.mean(scores), lower, upper

# Example: 85% accuracy on 200 examples
scores = [1]*170 + [0]*30
mean, lo, hi = bootstrap_ci(scores)
print(f"Accuracy: {mean:.1%} (95% CI: {lo:.1%} - {hi:.1%})")
# Accuracy: 85.0% (95% CI: 80.0% - 90.0%)
```

**Paired significance tests**: When comparing two models on the same test set, use paired tests (paired bootstrap or McNemar's test) that account for per-example correlation. This is more powerful than unpaired comparisons because it eliminates the variance due to example difficulty.

```python
def paired_bootstrap_test(scores_a, scores_b, n_bootstrap=10000):
    """Test whether model A is significantly better than model B."""
    diff = np.array(scores_a) - np.array(scores_b)
    observed_diff = np.mean(diff)
    count = 0
    for _ in range(n_bootstrap):
        sample = np.random.choice(diff, size=len(diff), replace=True)
        if np.mean(sample) <= 0:
            count += 1
    p_value = count / n_bootstrap
    return observed_diff, p_value
```

**Multiple comparison correction**: When evaluating across many benchmarks, apply Bonferroni correction or control the false discovery rate. Reporting the single benchmark where your model happens to win is a form of p-hacking.

**Effect size**: Statistical significance does not imply practical significance. A 0.1% accuracy improvement on MMLU may be statistically significant with enough test examples but practically meaningless. Report effect sizes alongside p-values.

### Sample Size Considerations

The precision of an evaluation depends on the number of test examples. For binary metrics like accuracy, the standard error is approximately:

$$SE = \sqrt{\frac{p(1-p)}{n}}$$

where p is the true accuracy and n is the number of examples. Practical implications:

| Accuracy | n=100 | n=500 | n=1000 | n=5000 |
|----------|-------|-------|--------|--------|
| 90% | ±5.9% | ±2.6% | ±1.9% | ±0.8% |
| 80% | ±7.8% | ±3.5% | ±2.5% | ±1.1% |
| 70% | ±9.0% | ±4.0% | ±2.8% | ±1.3% |

Small benchmarks may not distinguish between models with similar capabilities. If two models differ by 2% on a 100-example benchmark, that difference is almost certainly within noise.

## Evaluation Protocols: Few-Shot, Chain-of-Thought, and Beyond

### Few-Shot Evaluation

The standard protocol for evaluating base models uses few-shot prompting: provide k examples of the task in the prompt before the test question. The choice of k, the selection of examples, and their ordering all affect results — sometimes by 5-10 percentage points.

Best practices:

- Report results averaged over multiple random selections of few-shot examples (at least 3 seeds)
- Use the same few-shot examples across all models being compared
- Specify the exact prompt template used, including formatting and separators
- Be aware that some models are sensitive to example ordering — shuffling and averaging addresses this

### Chain-of-Thought Evaluation

For reasoning tasks, chain-of-thought (CoT) prompting can dramatically change results. The evaluation protocol must specify whether CoT is used and how the final answer is extracted from the reasoning trace. Common approaches:

1. **Delimiter parsing**: Parse the answer after a delimiter like "The answer is" or "####"
2. **Extraction step**: Use a separate LLM call or regex to pull the answer from free-form reasoning
3. **Reasoning evaluation**: Evaluate the reasoning chain itself, not just the final answer — catching cases where the model gets the right answer for the wrong reason

```python
import re

def extract_answer(response: str) -> str:
    """Extract the final answer from a chain-of-thought response."""
    # Try explicit delimiter first
    if "The answer is" in response:
        return response.split("The answer is")[-1].strip().rstrip(".")
    # Try #### delimiter (GSM8K style)
    if "####" in response:
        return response.split("####")[-1].strip()
    # Fall back to last line
    return response.strip().split("\n")[-1].strip()
```

### Instruction-Following Evaluation

For chat models, evaluation often tests instruction following rather than raw knowledge. IFEval provides verifiable instruction-following tests where compliance can be checked programmatically:

- "Write a response with exactly 3 paragraphs"
- "Include the word 'therefore' at least twice"
- "Respond in all lowercase"
- "End your response with a question"

These constraints are simple to verify automatically and test a capability that is critical for production use: does the model do what you ask, even when the instruction is unusual or specific?

## Evaluation Toolkits

Running evaluations from scratch is error-prone and time-consuming. Several open-source toolkits have become standard infrastructure.

### lm-evaluation-harness (EleutherAI)

The most widely adopted open-source evaluation framework. It provides a unified interface for running hundreds of benchmarks against any model accessible via a HuggingFace-compatible API. The harness handles prompt formatting, few-shot example selection, answer parsing, and metric computation.

```bash
# Evaluate a model on MMLU, HellaSwag, and ARC
lm_eval --model hf \
    --model_args pretrained=meta-llama/Llama-3-8B \
    --tasks mmlu,hellaswag,arc_challenge \
    --num_fewshot 5 \
    --batch_size 8 \
    --output_path ./results/
```

The harness supports custom task definitions via YAML configuration, making it straightforward to add internal benchmarks:

```yaml
# custom_task.yaml
task: my_domain_eval
dataset_path: json
dataset_kwargs:
  data_files: ./my_eval_data.jsonl
output_type: multiple_choice
doc_to_text: "Question: {{question}}\nAnswer:"
doc_to_target: "{{answer}}"
metric_list:
  - metric: acc
  - metric: acc_norm
```

Its main limitation is optimization for multiple-choice and short-answer tasks; evaluating open-ended generation requires more manual setup. The Open LLM Leaderboard on HuggingFace uses lm-evaluation-harness as its backend.

### HELM (Stanford CRFM)

HELM (Holistic Evaluation of Language Models) takes a broader approach, evaluating models not just on accuracy but across multiple dimensions: calibration, robustness, fairness, bias, toxicity, and efficiency. HELM defines a taxonomy of scenarios (tasks) and metrics, then runs a model through a systematic matrix of evaluations.

HELM is particularly useful when the goal is a multi-dimensional model comparison rather than a single-task score. The tradeoff is complexity: running a full HELM evaluation is resource-intensive and requires careful configuration.

### BigCode Evaluation Harness

A specialized fork of lm-evaluation-harness focused on code generation tasks. Supports HumanEval, MBPP, MultiPL-E (multilingual code generation), and DS-1000 (data science tasks). The harness handles sandboxed code execution for pass@k evaluation, which is critical for safe automated assessment of generated code.

### DeepEval

DeepEval is a Python-native testing framework that integrates LLM evaluation into standard pytest workflows. It provides built-in metrics including G-Eval, faithfulness, answer relevancy, contextual precision/recall, and hallucination detection. Designed for engineering teams building LLM-powered applications rather than benchmarking base models.

```python
from deepeval import assert_test
from deepeval.test_case import LLMTestCase
from deepeval.metrics import AnswerRelevancyMetric, GEval
from deepeval.test_case import LLMTestCaseParams

# Simple relevancy check
def test_response_relevancy():
    test_case = LLMTestCase(
        input="What are the benefits of exercise?",
        actual_output="Regular exercise improves cardiovascular health, "
                      "strengthens muscles, and boosts mental well-being.",
    )
    metric = AnswerRelevancyMetric(threshold=0.7)
    assert_test(test_case, [metric])

# Custom G-Eval metric for domain-specific quality
def test_technical_accuracy():
    metric = GEval(
        name="Technical Accuracy",
        criteria="Evaluate whether the response contains technically correct "
                 "information about machine learning concepts. Penalize "
                 "incorrect claims, outdated information, and misleading "
                 "simplifications.",
        evaluation_params=[LLMTestCaseParams.INPUT, LLMTestCaseParams.ACTUAL_OUTPUT],
        threshold=0.7,
    )
    test_case = LLMTestCase(
        input="Explain how dropout regularization works.",
        actual_output="Dropout randomly zeroes out a fraction of neuron "
                      "activations during training, forcing the network to "
                      "learn redundant representations. At inference time, "
                      "all neurons are active but outputs are scaled by the "
                      "dropout probability to maintain expected values.",
    )
    assert_test(test_case, [metric])
```

This approach fits naturally into CI/CD pipelines, enabling automated quality gates on model outputs. For more on integrating evaluation into deployment workflows, see [CI/CD for AI: Regression Testing, Monitoring & Continuous Eval](/ci-cd-ai).

## Reference-Free Evaluation

All the metrics discussed so far — BLEU, ROUGE, BERTScore, exact match — require reference text to compare against. This is a fundamental constraint: for open-ended generation, creative tasks, or domains where ground-truth answers are expensive to create, reference-based evaluation is impractical or impossible. Reference-free methods address this gap by evaluating output quality without gold references.

### G-Eval (LLM-as-Judge)

G-Eval uses an LLM as an evaluator, prompting it with a task description and evaluation criteria, then asking it to score the output on a defined scale. The key innovation is using chain-of-thought to generate detailed evaluation steps before assigning a score, which improves consistency and correlation with human judgment.

G-Eval can assess dimensions like fluency, coherence, consistency, and relevance without any reference text. It achieves strong correlations with human judgments on summarization and QA tasks, outperforming most reference-based metrics.

```python
# G-Eval prompt structure (conceptual)
GEVAL_PROMPT = """
You will be given a summary of a news article.
Your task is to rate the summary on coherence (1-5).

Evaluation steps:
1. Read the summary carefully
2. Check if ideas are presented in a logical order
3. Check if there are any contradictions
4. Check if the summary flows naturally from one point to the next
5. Assign a score from 1 (incoherent) to 5 (perfectly coherent)

Summary: {summary}

Score:
"""
```

The main risks are biases inherent in LLM-based evaluation:

- **Positional bias**: Favoring the first or last option in pairwise comparisons
- **Verbosity bias**: Preferring longer outputs regardless of quality
- **Self-enhancement bias**: An LLM may rate its own outputs more favorably
- **Style bias**: Preferring outputs that match the judge model's writing style

These are discussed in depth in [LLM-as-Judge: Automated Evaluation, Calibration & Bias](/llm-as-judge).

### FActScore (Atomic Factual Precision)

FActScore decomposes a generated text into atomic factual claims, then independently verifies each claim against a knowledge source. The final score is the fraction of claims that are supported.

```python
# Conceptual FActScore pipeline
def factscore(generated_text: str, knowledge_source) -> float:
    # Step 1: Decompose into atomic claims
    claims = decompose_into_atomic_facts(generated_text)
    # e.g., "Marie Curie was born in Warsaw in 1867" ->
    #   ["Marie Curie was born in Warsaw", "Marie Curie was born in 1867"]

    # Step 2: Verify each claim independently
    supported = sum(
        1 for claim in claims
        if is_supported(claim, knowledge_source)
    )

    return supported / len(claims) if claims else 0.0

# In practice, both decomposition and verification use LLM calls
# The knowledge source can be Wikipedia, a domain corpus, or web search
```

FActScore is especially relevant for evaluating long-form generation where traditional metrics fail entirely. A biography or technical explanation might be fluent and well-structured yet contain subtle factual errors that ROUGE would never catch. FActScore targets exactly this failure mode. For evaluation of factual grounding in retrieval-augmented systems, see [RAG Evaluation: Faithfulness, Relevance & Failure Modes](/rag-evaluation).

### When to Use Reference-Free vs Reference-Based

| Criterion | Reference-Based | Reference-Free |
|-----------|----------------|----------------|
| **Best for** | Constrained outputs (extractive QA, translation, structured extraction) | Open-ended generation (chat, creative writing, summarization) |
| **Cost** | Requires high-quality references (expensive to create) | No references needed (but judge LLM API costs) |
| **Speed** | Fast (string/embedding comparison) | Slower (requires LLM inference per evaluation) |
| **Reproducibility** | Deterministic | Stochastic (varies with judge model temperature) |
| **Failure mode** | Penalizes valid alternatives | May have systematic biases |

**Use both together** for the strongest evaluation design. Reference-based metrics catch objective errors; reference-free metrics catch subjective quality issues. Their agreement (or disagreement) is itself informative.

The critical requirement is validating that your reference-free metric correlates with human judgment on your specific task. A metric that works well for summarization may fail for dialogue, and blind trust in any automated metric is a recipe for silent quality degradation. See [Human Evaluation: Annotation Design, Inter-Rater Reliability & Scale](/human-evaluation) for calibration best practices.

## Evaluating Multi-Turn Conversations

Most benchmarks evaluate single-turn interactions: one prompt, one response. But real-world LLM usage is overwhelmingly multi-turn. A model that excels at isolated questions may fail to maintain context, resolve coreferences across turns, or adapt its behavior based on user feedback within a conversation.

### MT-Bench

MT-Bench is a curated set of 80 multi-turn questions spanning writing, roleplay, reasoning, math, coding, extraction, STEM, and humanities. Each item consists of a first-turn question followed by a more challenging or specific follow-up. An LLM judge rates each response on a 1-10 scale.

MT-Bench captures capabilities that single-turn benchmarks miss: can the model build on its previous answer? Does it handle follow-up instructions that modify or constrain the original task? Does it maintain consistency across turns?

### Arena-Style Evaluation (Chatbot Arena)

Chatbot Arena takes a fundamentally different approach: rather than using fixed test sets, it crowdsources pairwise comparisons from real users. Users submit a prompt, receive responses from two anonymous models, and vote for the better one. Elo ratings (and more recently Bradley-Terry model fits) are computed from the accumulated votes.

Strengths:

- Prompts reflect genuine user needs rather than researcher assumptions
- Evaluation is inherently reference-free
- Pairwise comparison is cognitively simpler for annotators than absolute scoring, leading to higher agreement
- Continuous influx of fresh prompts makes contamination essentially impossible

Weaknesses:

- User population skews toward English-speaking technical users
- Responses that "look impressive" may be preferred over technically correct ones
- Pairwise format cannot capture fine-grained quality differences on specific dimensions
- No coverage of specialized domains or edge cases unless users happen to test them

### Conversation-Level Metrics

Beyond benchmark-level evaluation, several metrics target specific properties of multi-turn systems:

- **Context retention**: Does the model correctly recall and use information from earlier turns? Tested by introducing facts early in a conversation and querying them later.
- **Instruction persistence**: If the user sets a constraint in turn 1 ("respond only in French"), does the model maintain it through subsequent turns?
- **Error recovery**: When the model makes a mistake and the user corrects it, does the model incorporate the correction or repeat the error?
- **Coherence across turns**: Does the conversation feel like a unified interaction or a series of disconnected exchanges?

```python
# Example: testing context retention programmatically
def test_context_retention(model):
    """Verify the model remembers facts introduced earlier in conversation."""
    conversation = [
        {"role": "user", "content": "My name is Alice and I work at Acme Corp."},
        {"role": "assistant", "content": "Nice to meet you, Alice!"},
        {"role": "user", "content": "What company do I work at?"},
    ]
    response = model.chat(conversation)
    assert "Acme" in response, f"Failed context retention: {response}"

def test_instruction_persistence(model):
    """Verify the model maintains constraints across turns."""
    conversation = [
        {"role": "user", "content": "From now on, end every response with '---END---'"},
        {"role": "assistant", "content": "Understood! I'll end every response that way. ---END---"},
        {"role": "user", "content": "What is 2 + 2?"},
    ]
    response = model.chat(conversation)
    assert response.strip().endswith("---END---"), f"Lost instruction: {response}"
```

These properties are difficult to capture with automated metrics and often require human evaluation or carefully designed LLM-judge rubrics. Building reliable multi-turn evaluation remains an open problem and an active area of research.

## Leaderboard Critique

Public leaderboards — the Open LLM Leaderboard, Chatbot Arena, and various task-specific rankings — have become the primary mechanism by which the community compares models. This has benefits: leaderboards provide standardized, reproducible comparisons and make evaluation accessible. But leaderboard-driven development introduces serious distortions.

### The Open LLM Leaderboard

HuggingFace's Open LLM Leaderboard runs models through a fixed suite of benchmarks using lm-evaluation-harness. The original leaderboard (v1) used MMLU, HellaSwag, ARC, WinoGrande, TruthfulQA, and GSM8K. As models saturated these benchmarks, v2 shifted to harder tasks including MMLU-Pro, GPQA, MuSR, MATH, and IFEval.

The leaderboard's accessibility has been enormously valuable for the open-source community, but it has also created perverse incentives. Models are explicitly optimized for leaderboard benchmarks, sometimes at the expense of general capability. The practice of "benchmark engineering" — selecting training data, hyperparameters, and even model merging strategies to maximize leaderboard scores — has become widespread.

### Contamination Risks

When the evaluation benchmarks are public and the training data is opaque, contamination is nearly impossible to rule out. A model that has memorized MMLU questions during training will score well without demonstrating genuine understanding. The problem is especially acute for open-weight models where training data composition is not fully disclosed.

Mitigation strategies include canary strings, rephrased test sets, held-out private benchmarks, and monthly refresh (LiveBench). None fully solves the problem. The fundamental tension is that public benchmarks enable reproducibility while also enabling gaming.

### Problems with Leaderboard-Driven Development

The deeper issue is Goodhart's Law applied to LLM development: when a metric becomes a target, it ceases to be a good metric. Specific failure modes:

- **Narrow optimization**: Models tuned for multiple-choice benchmarks may underperform on open-ended tasks that matter more in production.
- **Metric monoculture**: The community converges on a small set of benchmarks, leaving other capabilities unmeasured and therefore unoptimized.
- **False confidence**: A leaderboard ranking creates an illusion of total ordering. Model A outscoring Model B on MMLU says nothing about which is better for a specific production use case.
- **Neglect of non-benchmark qualities**: Properties like latency, cost, calibration, safety, and instruction-following consistency are poorly captured by standard leaderboards but critical in deployment.

The pragmatic response is to treat leaderboards as a coarse filter, not a definitive ranking. Use them to identify plausible candidate models, then evaluate those candidates rigorously on your specific task with your specific data.

## Building a Robust Evaluation Pipeline

A production-grade evaluation pipeline should include:

1. **Version control for eval data**: Test sets should be versioned and immutable once published. Use content hashing to detect accidental modifications.
2. **Deterministic evaluation**: Set temperature to 0 or use fixed random seeds for reproducibility. Log the exact model version, prompt template, and parameters used.
3. **Multiple metrics**: No single metric captures all aspects of quality. Report a suite of complementary metrics.
4. **Human evaluation as ground truth**: Automated metrics should be validated against human judgment for your specific task.
5. **Error analysis**: Beyond aggregate metrics, examine failure modes qualitatively. A model scoring 90% accuracy may fail systematically on a critical subclass.
6. **Regression tracking**: Compare each evaluation run against a baseline. Flag regressions even when aggregate scores improve — a new model that gains 2% on easy questions but loses 5% on hard ones may be worse in practice.

```python
import json
import hashlib
from datetime import datetime

class EvalPipeline:
    def __init__(self, model, metrics, dataset):
        self.model = model
        self.metrics = metrics
        self.dataset = dataset
        self.dataset_hash = hashlib.sha256(
            json.dumps(dataset, sort_keys=True).encode()
        ).hexdigest()[:12]

    def run(self, n_bootstrap=1000):
        predictions = [self.model.generate(ex["input"]) for ex in self.dataset]
        results = {
            "metadata": {
                "model": self.model.name,
                "dataset_hash": self.dataset_hash,
                "n_examples": len(self.dataset),
                "timestamp": datetime.utcnow().isoformat(),
            },
            "metrics": {},
        }
        for metric_name, metric_fn in self.metrics.items():
            scores = [
                metric_fn(pred, ex["target"])
                for pred, ex in zip(predictions, self.dataset)
            ]
            mean, ci_low, ci_high = bootstrap_ci(scores, n_bootstrap)
            results["metrics"][metric_name] = {
                "mean": round(mean, 4),
                "ci_95": (round(ci_low, 4), round(ci_high, 4)),
                "n": len(scores),
                "min": round(min(scores), 4),
                "max": round(max(scores), 4),
            }
        return results

    def compare(self, baseline_results):
        """Compare current run against a baseline, flagging regressions."""
        current = self.run()
        regressions = []
        for metric, values in current["metrics"].items():
            if metric in baseline_results["metrics"]:
                baseline_mean = baseline_results["metrics"][metric]["mean"]
                if values["mean"] < baseline_mean - 0.01:  # 1% threshold
                    regressions.append({
                        "metric": metric,
                        "current": values["mean"],
                        "baseline": baseline_mean,
                        "delta": values["mean"] - baseline_mean,
                    })
        return current, regressions
```

## Summary and Key Takeaways

- **No single metric suffices.** BLEU, ROUGE, and exact match measure surface overlap; BERTScore captures semantics but still needs references; perplexity measures language modeling, not task performance. Use metrics appropriate to your task and report multiple complementary measures.
- **Benchmarks are snapshots, not ground truth.** MMLU, HellaSwag, and HumanEval are useful reference points but each has known limitations including contamination risk, saturation, and format constraints. Newer benchmarks like MMLU-Pro, GPQA, and SWE-bench raise the bar but will eventually face the same pressures.
- **Statistical rigor is non-negotiable.** Always report confidence intervals. Use paired tests for model comparisons. Correct for multiple comparisons. Consider effect sizes alongside p-values.
- **Methodology matters as much as metrics.** The evaluation protocol (few-shot count, prompt template, answer extraction, CoT usage) can swing results by double-digit percentages. Document and standardize every choice.
- **Validate automated metrics against human judgment** for your specific use case. The correlation between automated metrics and human preferences varies dramatically across tasks and domains. Never assume a metric that works well in one domain will transfer.

The field of LLM evaluation is evolving rapidly, but the fundamentals of sound experimental methodology remain constant. Rigorous evaluation is the foundation upon which all claims about model capability must rest.

## Further Reading

This article covers evaluation fundamentals. The following companion articles go deeper on specific topics:

- [Benchmark Design: Contamination, Saturation & Domain-Specific Evals](/benchmark-design) — How benchmarks are constructed, how they degrade, and how to build domain-specific evaluations.
- [LLM-as-Judge: Automated Evaluation, Calibration & Bias](/llm-as-judge) — Using LLMs to evaluate LLMs, including calibration techniques and bias mitigation.
- [Human Evaluation: Annotation Design, Inter-Rater Reliability & Scale](/human-evaluation) — Designing human annotation studies, measuring agreement, and scaling evaluation.
- [RAG Evaluation: Faithfulness, Relevance & Failure Modes](/rag-evaluation) — Evaluation frameworks specific to retrieval-augmented generation systems.
- [CI/CD for AI: Regression Testing, Monitoring & Continuous Eval](/ci-cd-ai) — Integrating evaluation into deployment pipelines for continuous quality assurance.
