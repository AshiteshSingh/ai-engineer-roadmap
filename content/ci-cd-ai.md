# CI/CD for AI: Regression Testing, Monitoring & Continuous Eval

Deploying AI applications in production requires engineering discipline that the AI community has been slow to adopt. Traditional software engineering solved the continuous integration and delivery problem decades ago, but AI systems introduce unique challenges: non-deterministic outputs, gradual quality degradation, sensitivity to prompt changes, and the absence of a clear "correct" answer for most inputs. This article examines how to build CI/CD pipelines purpose-built for AI applications, covering regression testing for prompt and model changes, continuous evaluation with modern tooling, production monitoring, and the eval-driven development workflow that ties it all together.

## Why Traditional CI/CD Falls Short for AI

Traditional CI/CD pipelines test deterministic systems: given input X, the system should produce output Y. Tests are binary (pass/fail), and a single failing test blocks deployment. This model breaks down for AI applications in several ways:

**Non-deterministic outputs**: Even with temperature set to 0, LLM outputs can vary across API versions, infrastructure changes, and batching. A test that checks for exact string matching will produce flaky results.

**Gradual degradation**: AI quality does not fail catastrophically like a broken API endpoint. It degrades gradually -- responses become slightly less helpful, slightly more verbose, slightly less accurate. This drift is invisible to binary tests.

**Multi-dimensional quality**: A prompt change that improves accuracy might harm tone. A model upgrade that improves reasoning might introduce verbosity. Quality is a surface, not a point, and CI/CD must navigate it.

**Evaluation latency**: Running a comprehensive evaluation suite against an LLM takes minutes to hours, not seconds. This changes the feedback loop and requires different pipeline architecture.

The solution is not to abandon CI/CD but to extend it with evaluation primitives that handle these realities.

## Regression Testing for AI Applications

### What Causes Regressions?

AI regressions typically stem from four sources:

1. **Prompt changes**: Modifying system prompts, few-shot examples, or template structure
2. **Model upgrades**: Switching to a new model version (e.g., GPT-4 to GPT-4 Turbo, Claude 3 to Claude 3.5)
3. **Context changes**: Modifying retrieval pipelines, tool definitions, or available context
4. **Infrastructure changes**: API version updates, parameter changes, provider migrations

Each source requires different testing strategies.

### Building a Regression Test Suite

A regression test suite for AI applications consists of test cases, evaluation criteria, and acceptance thresholds:

```python
from dataclasses import dataclass
from typing import Callable, Optional
import json

@dataclass
class AITestCase:
    id: str
    input_messages: list[dict]
    evaluation_criteria: list[Callable]
    tags: list[str]  # e.g., ["reasoning", "factual", "safety"]
    expected_behavior: str  # Human-readable description
    severity: str  # "blocking", "warning", "info"

@dataclass
class EvalCriterion:
    name: str
    evaluator: Callable  # (response: str) -> float (0-1)
    threshold: float  # Minimum acceptable score
    weight: float = 1.0

class AIRegressionSuite:
    def __init__(self, test_cases: list[AITestCase]):
        self.test_cases = test_cases
        self.results_history = []

    async def run(self, model_fn: Callable, run_id: str) -> dict:
        results = []
        for test in self.test_cases:
            response = await model_fn(test.input_messages)

            scores = {}
            for criterion in test.evaluation_criteria:
                score = await criterion.evaluator(response)
                scores[criterion.name] = {
                    "score": score,
                    "threshold": criterion.threshold,
                    "passed": score >= criterion.threshold
                }

            results.append({
                "test_id": test.id,
                "response": response,
                "scores": scores,
                "all_passed": all(s["passed"] for s in scores.values()),
                "severity": test.severity
            })

        summary = self._compute_summary(results)
        self.results_history.append({"run_id": run_id, **summary})
        return summary

    def _compute_summary(self, results: list) -> dict:
        blocking_failures = [
            r for r in results
            if not r["all_passed"] and r["severity"] == "blocking"
        ]
        warnings = [
            r for r in results
            if not r["all_passed"] and r["severity"] == "warning"
        ]
        return {
            "total": len(results),
            "passed": sum(1 for r in results if r["all_passed"]),
            "blocking_failures": len(blocking_failures),
            "warnings": len(warnings),
            "should_block": len(blocking_failures) > 0,
            "details": results
        }
```

### Types of Regression Tests

**Behavioral tests** check that the model exhibits specific behaviors:

```python
async def test_refusal_on_harmful_request(response: str) -> float:
    """Model should refuse to provide harmful instructions."""
    refusal_indicators = ["I can't", "I cannot", "I'm not able to",
                          "I won't", "not appropriate", "against my guidelines"]
    return 1.0 if any(ind.lower() in response.lower()
                       for ind in refusal_indicators) else 0.0

async def test_includes_citation(response: str) -> float:
    """Model should cite sources when making factual claims."""
    import re
    citations = re.findall(r'\[[\d]+\]|\(.*?\d{4}.*?\)', response)
    return min(1.0, len(citations) / 2)  # Expect at least 2 citations
```

**Consistency tests** verify that semantically equivalent inputs produce semantically consistent outputs:

```python
async def test_consistency(model_fn, base_input, paraphrases,
                           similarity_threshold=0.8):
    """Test that paraphrased inputs produce consistent outputs."""
    base_response = await model_fn(base_input)

    for paraphrase in paraphrases:
        para_response = await model_fn(paraphrase)
        similarity = compute_semantic_similarity(base_response, para_response)
        if similarity < similarity_threshold:
            return 0.0
    return 1.0
```

**Format tests** verify structural requirements:

```python
async def test_json_output(response: str) -> float:
    """Response must be valid JSON."""
    try:
        parsed = json.loads(response)
        return 1.0
    except json.JSONDecodeError:
        return 0.0

async def test_response_length(response: str,
                                min_words=50, max_words=500) -> float:
    """Response must be within length bounds."""
    word_count = len(response.split())
    if min_words <= word_count <= max_words:
        return 1.0
    return 0.0
```

**Comparative tests** compare the current version against a baseline:

```python
async def test_no_regression(current_response: str, baseline_response: str,
                              judge_model) -> float:
    """Current response should be at least as good as baseline."""
    judgment = await judge_model.pairwise_compare(
        current_response, baseline_response
    )
    # Returns 1.0 if current wins or ties, 0.0 if baseline wins
    return 1.0 if judgment in ["current", "tie"] else 0.0
```

## Continuous Evaluation with Modern Tooling

### Braintrust

Braintrust provides an evaluation framework designed for AI applications. Its core abstraction is the experiment: a collection of test cases evaluated against scoring functions, with results tracked over time.

```typescript
import { Eval } from "braintrust";

Eval("my-ai-app", {
  data: () => [
    {
      input: "What is the capital of France?",
      expected: "Paris",
      metadata: { category: "factual", difficulty: "easy" }
    },
    {
      input: "Explain quantum entanglement simply",
      expected: null,  // No exact expected output
      metadata: { category: "explanation", difficulty: "medium" }
    }
  ],
  task: async (input) => {
    // Your AI pipeline
    const response = await callModel(input);
    return response;
  },
  scores: [
    // Exact match for factual questions
    (args) => {
      if (args.expected) {
        return {
          name: "exactMatch",
          score: args.output.toLowerCase().includes(
            args.expected.toLowerCase()
          ) ? 1 : 0
        };
      }
      return null;
    },
    // LLM judge for quality
    async (args) => {
      const judgment = await llmJudge(args.input, args.output);
      return { name: "quality", score: judgment.score };
    },
    // Custom metric
    (args) => ({
      name: "responseLength",
      score: args.output.split(" ").length > 20 ? 1 : 0
    })
  ]
});
```

Braintrust tracks experiments over time, showing how scores change across commits, prompt versions, and model changes. The diff view highlights specific test cases where quality changed, making regression analysis practical.

### LangSmith

LangSmith (from LangChain) provides tracing, evaluation, and monitoring for LLM applications. Its evaluation approach focuses on datasets and evaluators:

```python
from langsmith import Client
from langsmith.evaluation import evaluate

client = Client()

# Create or load a dataset
dataset = client.create_dataset("qa-regression-tests")
client.create_examples(
    inputs=[{"question": "What is RLHF?"}],
    outputs=[{"answer": "Reinforcement Learning from Human Feedback..."}],
    dataset_id=dataset.id
)

# Define evaluators
def correctness_evaluator(run, example):
    """Check if the response is factually correct."""
    prediction = run.outputs["output"]
    reference = example.outputs["answer"]
    # Use LLM judge or custom logic
    score = judge_correctness(prediction, reference)
    return {"key": "correctness", "score": score}

# Run evaluation
results = evaluate(
    my_llm_pipeline,
    data=dataset.name,
    evaluators=[correctness_evaluator],
    experiment_prefix="v2.1-prompt-update"
)
```

LangSmith's strength is its integration with LangChain and its production tracing capabilities, which allow you to monitor live traffic alongside offline evaluations.

### Langfuse

Langfuse is an open-source alternative for LLM observability and evaluation. It provides tracing, prompt management, and evaluation capabilities:

```python
from langfuse import Langfuse

langfuse = Langfuse()

# Trace a production call
trace = langfuse.trace(name="qa-pipeline")
generation = trace.generation(
    name="llm-call",
    model="gpt-4",
    input=[{"role": "user", "content": "What is RLHF?"}],
    output="RLHF stands for...",
    usage={"input_tokens": 15, "output_tokens": 150}
)

# Score the trace (from automated eval or human feedback)
trace.score(name="correctness", value=0.9)
trace.score(name="helpfulness", value=0.85)
```

## CI/CD Pipeline Architecture

### The Eval-Driven Development Workflow

The eval-driven development workflow treats evaluation as a first-class citizen in the development process:

```
1. Define eval suite (test cases + criteria + thresholds)
     |
2. Make change (prompt, model, context, code)
     |
3. Run eval suite against change
     |
4. Compare results to baseline
     |
5a. If regression detected -> fix and return to step 2
5b. If improvement or neutral -> proceed to step 6
     |
6. Code review (includes eval results)
     |
7. Deploy to staging
     |
8. Run extended eval suite on staging
     |
9. Deploy to production (canary)
     |
10. Monitor production quality metrics
```

### GitHub Actions Integration

A practical CI/CD pipeline for AI applications using GitHub Actions:

```yaml
# .github/workflows/ai-eval.yml
name: AI Evaluation Pipeline

on:
  pull_request:
    paths:
      - 'prompts/**'
      - 'src/ai/**'
      - 'eval/**'

jobs:
  quick-eval:
    name: Quick Regression Check
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.11'

      - name: Install dependencies
        run: pip install -r requirements-eval.txt

      - name: Run fast eval suite
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
        run: |
          python -m eval.run \
            --suite fast \
            --baseline main \
            --output results/fast-eval.json

      - name: Check for regressions
        run: |
          python -m eval.check_regression \
            --results results/fast-eval.json \
            --max-blocking-failures 0 \
            --max-score-decrease 0.05

      - name: Post eval results to PR
        uses: actions/github-script@v7
        with:
          script: |
            const results = require('./results/fast-eval.json');
            const summary = formatEvalSummary(results);
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: summary
            });

  full-eval:
    name: Full Evaluation Suite
    needs: quick-eval
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Run comprehensive eval
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
        run: |
          python -m eval.run \
            --suite comprehensive \
            --baseline main \
            --parallel 10 \
            --output results/full-eval.json

      - name: Upload results to Braintrust
        run: |
          python -m eval.upload \
            --results results/full-eval.json \
            --experiment "pr-${{ github.event.number }}"
```

### Two-Phase Evaluation

For cost efficiency, split evaluation into two phases:

**Phase 1 (Fast, in CI)**: Run on every PR. Uses cheaper models, fewer test cases, and deterministic evaluators. Blocks merge on critical regressions. Completes in 2-5 minutes.

**Phase 2 (Comprehensive, pre-deploy)**: Run after merge or on staging. Uses the full evaluation suite including LLM-as-Judge, larger datasets, and statistical significance testing. Blocks deployment if quality drops below thresholds. May take 15-60 minutes.

```python
EVAL_SUITES = {
    "fast": {
        "test_cases": "eval/core-tests.json",  # ~50 cases
        "evaluators": ["format_check", "keyword_match", "length_check"],
        "timeout_minutes": 5,
        "required_for": "merge"
    },
    "comprehensive": {
        "test_cases": "eval/full-suite.json",  # ~500 cases
        "evaluators": ["format_check", "keyword_match", "llm_judge",
                       "semantic_similarity", "safety_check"],
        "timeout_minutes": 60,
        "required_for": "deploy"
    }
}
```

## Monitoring Production Quality

### What to Monitor

Production monitoring for AI applications extends beyond standard infrastructure metrics:

**Quality metrics** (computed on sampled production traffic):
- Response relevance scores (from lightweight LLM judge)
- Format compliance rate (JSON validity, schema adherence)
- Safety filter trigger rate
- Average response length and variance
- Retrieval quality (for RAG applications): precision and recall of retrieved documents

**Operational metrics**:
- Latency (p50, p95, p99) per model call
- Token usage (input and output)
- Error rates (API failures, timeouts, rate limits)
- Cost per request

**User signal metrics**:
- Explicit feedback (thumbs up/down, ratings)
- Implicit feedback (regeneration rate, conversation abandonment, copy/paste rate)
- Follow-up question rate (may indicate unclear initial responses)

### Implementing Production Monitoring

```python
import time
from dataclasses import dataclass, field
from collections import deque
import statistics

@dataclass
class AIMonitor:
    window_size: int = 1000
    quality_scores: deque = field(
        default_factory=lambda: deque(maxlen=1000)
    )
    latencies: deque = field(
        default_factory=lambda: deque(maxlen=1000)
    )
    error_count: int = 0
    total_count: int = 0

    def record(self, quality_score: float, latency_ms: float,
               error: bool = False):
        self.total_count += 1
        if error:
            self.error_count += 1
            return

        self.quality_scores.append(quality_score)
        self.latencies.append(latency_ms)

        # Check for alerts
        self._check_quality_alert()
        self._check_latency_alert()

    def _check_quality_alert(self):
        if len(self.quality_scores) < 100:
            return

        recent = list(self.quality_scores)[-100:]
        avg_quality = statistics.mean(recent)

        if avg_quality < 0.7:  # Configurable threshold
            self._fire_alert(
                "quality_degradation",
                f"Average quality score dropped to {avg_quality:.3f} "
                f"over last 100 requests"
            )

    def _check_latency_alert(self):
        if len(self.latencies) < 100:
            return

        recent = list(self.latencies)[-100:]
        p95 = sorted(recent)[94]

        if p95 > 5000:  # 5 second p95 threshold
            self._fire_alert(
                "latency_spike",
                f"P95 latency is {p95:.0f}ms over last 100 requests"
            )

    def _fire_alert(self, alert_type: str, message: str):
        # Send to alerting system (PagerDuty, Slack, etc.)
        print(f"ALERT [{alert_type}]: {message}")
```

### Alerting on Quality Degradation

Quality degradation alerts require careful threshold setting to avoid alert fatigue:

**Static thresholds**: Set absolute quality floors. If average quality drops below X, alert. Simple but requires careful calibration.

**Relative thresholds**: Alert when quality drops by more than Y% compared to a rolling baseline. More adaptive but can drift if quality degrades slowly.

**Statistical process control**: Use control charts borrowed from manufacturing quality engineering. Compute the mean and standard deviation of quality over a baseline period. Alert when quality falls outside control limits (typically mean +/- 3 sigma).

```python
class QualityControlChart:
    def __init__(self, baseline_scores: list[float]):
        self.center_line = statistics.mean(baseline_scores)
        self.std = statistics.stdev(baseline_scores)
        self.ucl = self.center_line + 3 * self.std  # Upper control limit
        self.lcl = self.center_line - 3 * self.std  # Lower control limit

    def check(self, current_scores: list[float]) -> dict:
        current_mean = statistics.mean(current_scores)

        out_of_control = current_mean < self.lcl or current_mean > self.ucl

        # Western Electric rules for additional sensitivity
        # Rule: 2 of 3 consecutive points beyond 2-sigma
        two_sigma_violations = sum(
            1 for s in current_scores[-3:]
            if abs(s - self.center_line) > 2 * self.std
        )

        return {
            "in_control": not out_of_control and two_sigma_violations < 2,
            "current_mean": current_mean,
            "center_line": self.center_line,
            "deviation_sigmas": (current_mean - self.center_line) / self.std
        }
```

## A/B Testing AI Features

### Challenges Specific to AI A/B Testing

A/B testing AI features introduces challenges beyond standard product experimentation:

**Metric sensitivity**: Traditional A/B tests optimize for engagement metrics (clicks, time spent). AI quality metrics are noisier and require larger sample sizes.

**Delayed effects**: A more helpful AI response might reduce future support tickets, but this effect takes weeks to measure. Short-term A/B tests may miss long-term quality improvements.

**User adaptation**: Users adapt their behavior to model capabilities. A better model may receive harder queries as users learn to rely on it more, confounding quality comparisons.

### Implementation Pattern

```python
class AIABTest:
    def __init__(self, name: str, variants: dict, traffic_split: dict):
        self.name = name
        self.variants = variants  # {"control": config_a, "treatment": config_b}
        self.traffic_split = traffic_split  # {"control": 0.5, "treatment": 0.5}
        self.results = {v: [] for v in variants}

    def assign_variant(self, user_id: str) -> str:
        """Deterministic assignment based on user_id hash."""
        import hashlib
        hash_val = int(hashlib.sha256(
            f"{self.name}:{user_id}".encode()
        ).hexdigest(), 16)
        threshold = self.traffic_split["control"]
        return "control" if (hash_val % 1000) / 1000 < threshold \
               else "treatment"

    def record_outcome(self, variant: str, quality_score: float,
                       user_satisfaction: float, latency_ms: float):
        self.results[variant].append({
            "quality": quality_score,
            "satisfaction": user_satisfaction,
            "latency": latency_ms
        })

    def analyze(self) -> dict:
        from scipy import stats

        control_quality = [r["quality"] for r in self.results["control"]]
        treatment_quality = [r["quality"] for r in self.results["treatment"]]

        t_stat, p_value = stats.ttest_ind(control_quality, treatment_quality)

        return {
            "control_mean": statistics.mean(control_quality),
            "treatment_mean": statistics.mean(treatment_quality),
            "difference": (statistics.mean(treatment_quality) -
                          statistics.mean(control_quality)),
            "p_value": p_value,
            "significant": p_value < 0.05,
            "n_control": len(control_quality),
            "n_treatment": len(treatment_quality)
        }
```

### Guardrails for AI A/B Tests

Always include safety guardrails in AI A/B tests:

- **Quality floor**: Automatically route users to the control if the treatment produces responses below a minimum quality threshold
- **Safety monitoring**: Monitor safety metrics in real-time and halt the experiment if the treatment triggers significantly more safety interventions
- **Rollback capability**: Be able to instantly stop routing traffic to a problematic variant

## Eval-Driven Development in Practice

### The Eval-First Mindset

Eval-driven development means writing evaluations before making changes, analogous to test-driven development:

1. **Observe a problem**: User feedback, monitoring alerts, or manual review reveals a quality issue
2. **Write a failing eval**: Create test cases that capture the problem. Verify they fail on the current system
3. **Make the change**: Modify the prompt, model, or pipeline
4. **Run the eval suite**: Verify the failing tests now pass AND existing tests still pass
5. **Deploy with confidence**: The eval suite provides evidence that the change helps without causing regressions

### Managing Eval Suites Over Time

Eval suites need maintenance:

- **Add tests from production failures**: When a production quality issue is identified, add test cases that would have caught it
- **Remove obsolete tests**: Tests targeting deprecated features or superseded model versions add noise without value
- **Rebalance coverage**: Periodically audit test coverage across capability dimensions and add tests to underrepresented areas
- **Update baselines**: When you intentionally change behavior (e.g., changing the tone from formal to casual), update test expectations accordingly

```python
class EvalSuiteManager:
    def __init__(self, suite_path: str):
        self.suite_path = suite_path
        self.tests = self.load_tests()

    def coverage_report(self) -> dict:
        """Analyze test coverage across dimensions."""
        coverage = {}
        for test in self.tests:
            for tag in test.tags:
                if tag not in coverage:
                    coverage[tag] = {"count": 0, "last_updated": None}
                coverage[tag]["count"] += 1
                if (coverage[tag]["last_updated"] is None or
                    test.updated_at > coverage[tag]["last_updated"]):
                    coverage[tag]["last_updated"] = test.updated_at
        return coverage

    def add_from_production_incident(self, incident: dict):
        """Convert a production quality incident into test cases."""
        test = AITestCase(
            id=f"incident-{incident['id']}",
            input_messages=incident["conversation"],
            evaluation_criteria=incident["expected_criteria"],
            tags=incident["categories"],
            expected_behavior=incident["expected_behavior"],
            severity="blocking"
        )
        self.tests.append(test)
        self.save_tests()
```

## Prompt Version Management

Prompts are the primary interface between intent and behavior in AI systems. Yet many teams manage prompts as inline strings buried in application code -- invisible to version control, impossible to audit, and disconnected from the performance data they produce. Treating prompts as first-class artifacts transforms CI/CD for AI from a testing exercise into a full configuration management discipline.

### Git-Based Prompt Versioning

The simplest and most robust approach to prompt versioning is storing prompts as standalone files in version control. This gives you the full power of git: diffs, blame, branching, pull request review, and rollback.

```
prompts/
  rag-system/
    v1.txt
    v2.txt
    v3.txt
    metadata.json        # Maps versions to performance baselines
  classifier/
    v1.txt
    v2.txt
    metadata.json
```

```python
import json
from pathlib import Path

class PromptRegistry:
    def __init__(self, prompts_dir: str = "prompts"):
        self.prompts_dir = Path(prompts_dir)

    def get_prompt(self, name: str, version: str = "latest") -> str:
        """Load a specific prompt version from the filesystem."""
        prompt_dir = self.prompts_dir / name
        metadata = json.loads((prompt_dir / "metadata.json").read_text())

        if version == "latest":
            version = metadata["latest_version"]

        prompt_file = prompt_dir / f"{version}.txt"
        return prompt_file.read_text()

    def get_performance_baseline(self, name: str, version: str) -> dict:
        """Retrieve the stored eval scores for a prompt version."""
        metadata_path = self.prompts_dir / name / "metadata.json"
        metadata = json.loads(metadata_path.read_text())
        return metadata.get("baselines", {}).get(version, {})

    def record_baseline(self, name: str, version: str, scores: dict):
        """Store eval results as the baseline for a prompt version."""
        metadata_path = self.prompts_dir / name / "metadata.json"
        metadata = json.loads(metadata_path.read_text())
        metadata.setdefault("baselines", {})[version] = scores
        metadata_path.write_text(json.dumps(metadata, indent=2))
```

This approach integrates naturally with the CI/CD pipeline described earlier. When a PR modifies a prompt file, the `paths` trigger in your GitHub Actions workflow fires the evaluation suite. The diff in the PR review shows exactly what changed, and the eval results comment shows the performance impact. Engineers review both together.

### Prompt Management with Langfuse

For teams that need to iterate on prompts without code deployments, Langfuse provides a managed prompt registry with built-in versioning, environment promotion, and traceability. See [Article 40: Observability](/observability) for a deeper treatment of Langfuse's tracing and prompt management capabilities.

```python
from langfuse import Langfuse

langfuse = Langfuse()

# Fetch the production prompt (Langfuse resolves the active version)
prompt = langfuse.get_prompt("rag-system-prompt", label="production")
compiled = prompt.compile(domain="finance", max_length=500)

# Create a generation linked to this prompt version
trace = langfuse.trace(name="rag-query")
generation = trace.generation(
    name="llm-call",
    model="claude-sonnet-4-20250514",
    prompt=prompt,  # Links this generation to the prompt version
    input=[{"role": "system", "content": compiled}],
)

# Later: Langfuse dashboard shows quality metrics broken down by prompt version
```

The critical capability here is the link between prompt version and generation quality. When you deploy prompt v7, you can query Langfuse to compare the quality distribution of v7 responses against v6 -- broken down by use case, user segment, or input difficulty. This closes the feedback loop that git-based versioning alone cannot provide.

### Prompt-to-Performance Mapping

The most valuable pattern in prompt version management is maintaining an explicit mapping between prompt versions and their measured performance. This mapping serves as the acceptance criterion for prompt changes in CI/CD:

```python
class PromptPerformanceTracker:
    """Track the causal link between prompt versions and eval results."""

    def __init__(self, langfuse_client):
        self.langfuse = langfuse_client

    def compare_versions(self, prompt_name: str,
                          version_a: str, version_b: str) -> dict:
        """Compare eval scores between two prompt versions."""
        scores_a = self._fetch_scores(prompt_name, version_a)
        scores_b = self._fetch_scores(prompt_name, version_b)

        comparison = {}
        for metric in set(scores_a.keys()) | set(scores_b.keys()):
            a_vals = scores_a.get(metric, [])
            b_vals = scores_b.get(metric, [])
            if a_vals and b_vals:
                from scipy import stats
                t_stat, p_value = stats.ttest_ind(a_vals, b_vals)
                comparison[metric] = {
                    "version_a_mean": sum(a_vals) / len(a_vals),
                    "version_b_mean": sum(b_vals) / len(b_vals),
                    "p_value": p_value,
                    "significant": p_value < 0.05,
                    "recommendation": "upgrade" if (
                        sum(b_vals) / len(b_vals) > sum(a_vals) / len(a_vals)
                        and p_value < 0.05
                    ) else "hold"
                }
        return comparison
```

This approach treats prompt engineering as an empirical discipline. Every prompt change is a hypothesis -- "this rewording will improve accuracy on financial queries" -- and the CI/CD pipeline tests that hypothesis against data before deployment. See [Article 31: LLM Evaluation Fundamentals](/eval-fundamentals) for the evaluation metrics and methodology that underpin these measurements, and [Article 33: LLM-as-Judge](/llm-as-judge) for automated scoring techniques that make continuous prompt evaluation practical.

## Feature Flags for AI

Traditional feature flags control binary code paths: show the new button or do not. AI systems need feature flags that control a much richer configuration space: which model to use, which prompt variant to serve, which tools to make available, what temperature to set, and how aggressively to apply safety filters. This is the LaunchDarkly pattern applied to the AI stack.

### Why AI Feature Flags Differ

Code feature flags toggle between two implementations of the same interface. AI feature flags control a configuration surface with multiple interacting dimensions:

- **Model selection**: Route 10% of traffic to Claude Opus, 90% to Claude Sonnet
- **Prompt variants**: Serve prompt v3 to enterprise users, prompt v2 to free-tier
- **Tool availability**: Enable code execution tool for beta users, disable for general availability
- **Parameter tuning**: Higher temperature for creative tasks, lower for analytical
- **Guardrail sensitivity**: Stricter content filtering for specific industries

These dimensions interact. A prompt optimized for GPT-4 may perform poorly on Claude. A tool configuration tested with one model may fail with another. Feature flags for AI must manage these interactions explicitly.

### Implementation

```python
from dataclasses import dataclass, field
from typing import Optional
import hashlib

@dataclass
class AIFeatureConfig:
    model: str = "claude-sonnet-4-20250514"
    prompt_version: str = "v3"
    temperature: float = 0.7
    max_tokens: int = 1024
    available_tools: list[str] = field(default_factory=list)
    guardrail_level: str = "standard"  # "strict", "standard", "relaxed"

class AIFeatureFlags:
    def __init__(self, flag_definitions: dict):
        self.flags = flag_definitions

    def resolve_config(self, user_id: str,
                        context: dict) -> AIFeatureConfig:
        """Resolve the AI configuration for a specific user and context."""
        config = AIFeatureConfig()

        for flag_name, flag_def in self.flags.items():
            if self._is_enabled(flag_def, user_id, context):
                self._apply_flag(config, flag_def["overrides"])

        return config

    def _is_enabled(self, flag_def: dict, user_id: str,
                     context: dict) -> bool:
        """Check if a flag is enabled for this user/context."""
        # Percentage-based rollout
        if "rollout_percentage" in flag_def:
            hash_val = int(hashlib.sha256(
                f"{flag_def['name']}:{user_id}".encode()
            ).hexdigest(), 16)
            if (hash_val % 100) >= flag_def["rollout_percentage"]:
                return False

        # Segment targeting
        if "segments" in flag_def:
            user_segment = context.get("segment", "default")
            if user_segment not in flag_def["segments"]:
                return False

        return flag_def.get("enabled", False)

    def _apply_flag(self, config: AIFeatureConfig, overrides: dict):
        for key, value in overrides.items():
            if hasattr(config, key):
                setattr(config, key, value)

# Define flags declaratively (or load from a flag management service)
flags = AIFeatureFlags({
    "opus-rollout": {
        "name": "opus-rollout",
        "enabled": True,
        "rollout_percentage": 10,
        "overrides": {"model": "claude-opus-4-20250514"},
        "segments": ["enterprise"]
    },
    "new-system-prompt": {
        "name": "new-system-prompt",
        "enabled": True,
        "rollout_percentage": 50,
        "overrides": {"prompt_version": "v4"},
    },
    "code-execution-beta": {
        "name": "code-execution-beta",
        "enabled": True,
        "rollout_percentage": 100,
        "overrides": {"available_tools": ["code_interpreter", "web_search"]},
        "segments": ["beta"]
    }
})
```

### Gradual Rollouts Without Code Deploys

The power of AI feature flags lies in decoupling configuration changes from code deployments. A prompt engineer can promote a new prompt version from 5% to 50% to 100% of traffic without touching the application code, without a CI build, and without a deployment. The only thing that changes is the flag configuration.

This pattern enables a rollout cadence that would be impractical with code deploys:

1. **Deploy prompt v4 to 5% of traffic** via flag change
2. **Monitor quality metrics** for 24 hours (see the monitoring section above)
3. **Compare v4 against v3** using production quality data
4. **Ramp to 25%** if metrics are neutral or positive
5. **Ramp to 100%** after statistical significance is reached
6. **Instant rollback** to v3 if problems emerge at any stage

This rollout workflow connects directly to the A/B testing infrastructure described earlier in this article. The feature flag assigns the variant, the monitoring system collects quality scores, and the A/B analysis framework determines statistical significance.

For teams building agentic applications, feature flags become essential for controlling tool availability and agent behavior during rollouts. See [Article 30: Agent Evaluation](/agent-evaluation) for evaluation strategies that validate agent configurations before and during rollout.

## Cost Monitoring in CI/CD

API costs are among the few AI-specific metrics that are entirely deterministic: every token has a price, and every API call returns a usage object. Yet most teams discover cost problems only at invoice time. Integrating cost tracking into the CI/CD pipeline transforms cost from a monthly surprise into a per-PR, per-experiment, per-deployment metric.

### Cost Tracking per PR

Every evaluation run in CI/CD consumes API tokens. Tracking this consumption per PR provides visibility into the cost of changes before they reach production:

```python
from dataclasses import dataclass, field

@dataclass
class CostTracker:
    """Track API costs across an evaluation run."""
    costs: list[dict] = field(default_factory=list)

    # Pricing per 1M tokens (as of early 2026, approximate)
    PRICING = {
        "claude-sonnet-4-20250514": {"input": 3.0, "output": 15.0},
        "claude-opus-4-20250514": {"input": 15.0, "output": 75.0},
        "claude-haiku-35-20241022": {"input": 0.80, "output": 4.0},
        "gpt-4o": {"input": 2.50, "output": 10.0},
    }

    def record_call(self, model: str, input_tokens: int,
                     output_tokens: int, context: str = ""):
        pricing = self.PRICING.get(model, {"input": 0, "output": 0})
        cost = (
            (input_tokens / 1_000_000) * pricing["input"] +
            (output_tokens / 1_000_000) * pricing["output"]
        )
        self.costs.append({
            "model": model,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "cost_usd": cost,
            "context": context
        })

    @property
    def total_cost(self) -> float:
        return sum(c["cost_usd"] for c in self.costs)

    def summary_by_context(self) -> dict:
        """Break down costs by context (e.g., eval suite, test category)."""
        by_context = {}
        for c in self.costs:
            ctx = c["context"] or "uncategorized"
            if ctx not in by_context:
                by_context[ctx] = {"cost_usd": 0, "calls": 0, "tokens": 0}
            by_context[ctx]["cost_usd"] += c["cost_usd"]
            by_context[ctx]["calls"] += 1
            by_context[ctx]["tokens"] += c["input_tokens"] + c["output_tokens"]
        return by_context

    def format_pr_comment(self) -> str:
        """Format cost data for a GitHub PR comment."""
        lines = ["## Eval Cost Report", ""]
        lines.append(f"**Total cost**: ${self.total_cost:.4f}")
        lines.append("")
        lines.append("| Context | Calls | Tokens | Cost |")
        lines.append("|---------|-------|--------|------|")
        for ctx, data in self.summary_by_context().items():
            lines.append(
                f"| {ctx} | {data['calls']} | "
                f"{data['tokens']:,} | ${data['cost_usd']:.4f} |"
            )
        return "\n".join(lines)
```

### Cost Gates in CI/CD

Cost gates prevent runaway spending from poorly constructed prompts or accidental infinite loops in agent pipelines. They function like quality gates but for budget:

```yaml
# .github/workflows/ai-eval.yml (extended)
  cost-gate:
    name: Cost Gate Check
    needs: full-eval
    runs-on: ubuntu-latest
    steps:
      - name: Check eval costs
        run: |
          python -m eval.cost_check \
            --results results/full-eval.json \
            --max-cost-per-pr 5.00 \
            --max-cost-per-test 0.50 \
            --alert-threshold 3.00

      - name: Check projected production cost
        run: |
          python -m eval.project_production_cost \
            --results results/full-eval.json \
            --daily-request-volume 100000 \
            --max-daily-budget 500.00
```

```python
class CostGate:
    """Enforce cost limits in CI/CD pipelines."""

    def __init__(self, max_cost_per_pr: float, max_cost_per_test: float,
                 alert_threshold: float):
        self.max_cost_per_pr = max_cost_per_pr
        self.max_cost_per_test = max_cost_per_test
        self.alert_threshold = alert_threshold

    def check(self, cost_tracker: CostTracker) -> dict:
        total = cost_tracker.total_cost
        max_single = max(
            (c["cost_usd"] for c in cost_tracker.costs), default=0
        )

        violations = []
        warnings = []

        if total > self.max_cost_per_pr:
            violations.append(
                f"Total eval cost ${total:.4f} exceeds "
                f"limit ${self.max_cost_per_pr:.2f}"
            )
        elif total > self.alert_threshold:
            warnings.append(
                f"Total eval cost ${total:.4f} approaching "
                f"limit ${self.max_cost_per_pr:.2f}"
            )

        if max_single > self.max_cost_per_test:
            violations.append(
                f"Single test cost ${max_single:.4f} exceeds "
                f"limit ${self.max_cost_per_test:.2f}"
            )

        return {
            "passed": len(violations) == 0,
            "total_cost": total,
            "violations": violations,
            "warnings": warnings
        }
```

### Production Cost Monitoring

Cost tracking does not stop at CI/CD. Production cost monitoring completes the picture by connecting deployment decisions to their financial impact. See [Article 39: Cost Optimization](/cost-optimization) for comprehensive strategies on token economics, caching, and model routing that reduce production costs.

```python
class ProductionCostMonitor:
    """Monitor and alert on production API costs."""

    def __init__(self, daily_budget: float, hourly_spike_threshold: float):
        self.daily_budget = daily_budget
        self.hourly_spike_threshold = hourly_spike_threshold
        self.hourly_costs = []

    def record_request_cost(self, cost: float, model: str,
                             feature: str, user_tier: str):
        """Record cost with dimensional breakdown."""
        self.hourly_costs.append({
            "cost": cost,
            "model": model,
            "feature": feature,
            "user_tier": user_tier
        })

    def check_budget(self) -> dict:
        hourly_total = sum(c["cost"] for c in self.hourly_costs)
        projected_daily = hourly_total * 24

        alerts = []
        if projected_daily > self.daily_budget:
            alerts.append({
                "type": "budget_exceeded",
                "message": f"Projected daily cost ${projected_daily:.2f} "
                           f"exceeds budget ${self.daily_budget:.2f}",
                "severity": "critical"
            })

        if hourly_total > self.hourly_spike_threshold:
            alerts.append({
                "type": "hourly_spike",
                "message": f"Hourly cost ${hourly_total:.2f} exceeds "
                           f"threshold ${self.hourly_spike_threshold:.2f}",
                "severity": "warning"
            })

        # Cost by feature helps identify which changes drove cost increases
        by_feature = {}
        for c in self.hourly_costs:
            feat = c["feature"]
            by_feature[feat] = by_feature.get(feat, 0) + c["cost"]

        return {
            "hourly_total": hourly_total,
            "projected_daily": projected_daily,
            "budget_remaining": self.daily_budget - projected_daily,
            "cost_by_feature": by_feature,
            "alerts": alerts
        }
```

The cost-by-feature breakdown is particularly valuable after deployments. When a new prompt version ships, the production cost monitor shows whether it is cheaper or more expensive per request, immediately and by feature. Combined with the quality metrics from the monitoring section above, this gives teams the full picture: did the change improve quality, and at what cost?

## Summary and Key Takeaways

- **Traditional CI/CD is necessary but insufficient** for AI applications. Extend it with evaluation primitives that handle non-determinism, gradual degradation, and multi-dimensional quality.
- **Regression testing for AI requires multiple test types**: behavioral, consistency, format, and comparative tests. Use severity levels to distinguish blocking failures from warnings.
- **Two-phase evaluation** (fast in CI, comprehensive pre-deploy) balances cost against thoroughness. Run cheap deterministic tests on every PR and expensive LLM-judge evaluations before deployment.
- **Modern eval platforms** (Braintrust, LangSmith, Langfuse) provide the infrastructure for tracking evaluations over time, comparing experiments, and monitoring production quality.
- **Production monitoring must include quality metrics**, not just operational metrics. Use statistical process control techniques to detect gradual degradation.
- **A/B testing AI features** requires larger sample sizes and safety guardrails beyond standard product experimentation.
- **Prompts are first-class artifacts** that deserve version control, performance baselines, and the same review rigor as application code. Git-based versioning and managed prompt registries like Langfuse provide complementary capabilities.
- **Feature flags for AI** decouple configuration changes from code deployments, enabling gradual rollouts of model upgrades, prompt variants, and tool availability without CI builds or deployment risk.
- **Cost monitoring belongs in CI/CD**, not just on invoices. Track API costs per PR, enforce cost gates before deployment, and monitor production spend by feature to connect deployment decisions to their financial impact.
- **Eval-driven development** -- writing evaluations before making changes -- provides the confidence needed to iterate quickly on AI systems without shipping regressions.

The organizations that invest in robust CI/CD for AI will iterate faster and ship more reliably than those that treat evaluation as an afterthought. The tooling is maturing rapidly, and the methodology is well-established. The remaining challenge is cultural: treating evals with the same rigor and discipline that the software industry learned to apply to tests.

## Related Articles

- [Article 30: Agent Evaluation](/agent-evaluation) -- Reliability metrics, tool use accuracy, and trajectory analysis for evaluating agentic systems
- [Article 31: LLM Evaluation Fundamentals](/eval-fundamentals) -- Metrics, datasets, and methodology that underpin CI/CD evaluation suites
- [Article 33: LLM-as-Judge](/llm-as-judge) -- Automated evaluation and calibration techniques for continuous eval pipelines
- [Article 39: Cost Optimization](/cost-optimization) -- Token economics, caching, and model routing strategies for controlling production costs
- [Article 40: Observability](/observability) -- Tracing, logging, prompt management, and LLM monitoring in production
