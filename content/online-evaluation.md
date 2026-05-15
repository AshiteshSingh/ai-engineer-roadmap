# Online Evaluation: Production Sampling, Drift Detection & Feedback Loops

Offline evaluation tells you whether a system was good against a fixed dataset on the day you ran it. Production tells you whether it is good *right now*, against real traffic, real users, and a real model endpoint that can change underneath you. These are different questions. A prompt that scored 0.82 on your golden set can quietly degrade to 0.6 in production because users ask things your dataset never anticipated, a provider silently ships a new model snapshot, or a retrieval index drifts. Online evaluation is the discipline of measuring quality continuously on live traffic, detecting regressions before users churn, and feeding what you learn back into the offline suite. This article covers the architecture of a production eval pipeline, sampling and cost control, reference-free metrics, drift and regression detection, online experimentation, and how to close the loop — grounded in the LangGraph backend this roadmap ships with.

## Offline Is Necessary But Not Sufficient

A mature team runs offline evals in CI: a curated golden set, an LLM judge, a pass-rate gate (this is exactly what the `/eval-fundamentals` and `/benchmark-design` articles describe, and what the roadmap's own `backend/tests/deepeval/` suite implements). That catches regressions you can anticipate. It cannot catch:

- **Distribution shift.** Your golden set encodes the queries you imagined. Real users invent new intents weekly. Coverage on a static set says nothing about the long tail you never wrote down.
- **Silent model drift.** `gpt-4o`, `claude-sonnet`, and `deepseek-chat` are moving targets. Providers re-quantize, re-tune, and re-route without changing the model string. A prompt tuned against last month's behavior is an untested prompt today.
- **Upstream data drift.** RAG answers depend on a retrieval index and a document corpus that change independently of your code. The prompt is fixed; the context it receives is not.
- **Emergent failure modes.** Jailbreaks, prompt injection through retrieved content, and adversarial inputs (see `/adversarial-prompting`) show up in production long before they show up in your test fixtures.
- **Interaction effects.** Latency, truncation under load, cache staleness, and concurrency-induced ordering changes only manifest under real traffic.

The mental model: **offline eval gates deploys; online eval gates trust.** You need both. Online eval is what turns "we shipped it" into "we know it still works."

## The Online Evaluation Architecture

The defining constraint of online eval is that **scoring must not be on the critical path of the user request.** Users wait for answers, not for a judge model to deliberate. The standard architecture decouples serving from scoring:

```
User → App → LLM/Graph → Response  ─────────────────────────► User
                  │
                  └─► emit trace event (async, fire-and-forget)
                                │
                                ▼
                        sampling decision
                                │
                         (sampled subset)
                                ▼
                     async scoring workers ──► metrics store
                                │                    │
                                ▼                    ▼
                        feedback join        dashboards / alerts
```

Every production inference emits a structured trace (the same trace the `/observability` article describes — prompt, context, output, model version, latency, cost, request metadata). A sampler decides which traces get scored. Sampled traces go to an out-of-band worker pool that runs metrics — heuristic checks inline, LLM-judge checks in a queue — and writes results to a metrics store keyed by trace ID, model version, and prompt version. User feedback, which arrives seconds to hours later, is joined back on the trace ID.

A minimal trace schema sufficient for online eval:

```python
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

@dataclass
class EvalTrace:
    trace_id: str
    ts: datetime
    graph: str                 # "chat", "course_review", ...
    prompt_version: str        # git sha or content hash of the prompt
    model: str                 # "deepseek-chat"
    model_fingerprint: str | None  # provider system_fingerprint if exposed
    inputs: dict[str, Any]     # user query, retrieved context refs
    output: str
    latency_ms: int
    cost_usd: float
    metadata: dict[str, Any] = field(default_factory=dict)
    # filled in later, out of band:
    scores: dict[str, float] = field(default_factory=dict)
    feedback: dict[str, Any] = field(default_factory=dict)
```

The `prompt_version` and `model_fingerprint` fields are not optional bookkeeping — they are the join keys that let you attribute a quality drop to a specific prompt edit or a silent provider change. Without them, online eval produces a number that trends but cannot be acted on.

## Sampling: You Cannot Score Everything

Scoring every request with an LLM judge would roughly double your inference bill and add a second model's worth of failure surface. The `/rag-evaluation` article quotes a realistic figure of ~$30 per 1,000 LLM-judged items; at 100k requests/day that is $3,000/day of judging to shadow your serving traffic. You sample. The question is *how*, because uniform sampling wastes budget on the easy middle of the distribution.

**Uniform random sampling** is the baseline. Sample rate `r`; every request scored with probability `r`. Unbiased, trivially correct for population-level metrics, and the right default for the headline "is overall quality stable" question. Pick `r` so the daily judged volume fits the budget, and check it gives you enough samples per segment to detect the effect size you care about (see the power calculation below).

**Stratified sampling** allocates budget across segments — language, feature, customer tier, query length bucket — so a low-volume but high-stakes segment (enterprise, a new feature) isn't drowned out by the high-volume head. Score each stratum at a rate inversely related to its volume, then weight when aggregating to recover an unbiased population estimate.

**Targeted / importance sampling** spends budget where failures are likely. Score at an elevated rate when cheap signals predict trouble:

```python
import random

def sample_rate_for(trace: EvalTrace) -> float:
    """Heuristic, cheap, runs inline. Returns P(score this trace)."""
    base = 0.02                                  # 2% uniform floor
    if trace.feedback.get("thumb") == "down":
        return 1.0                               # always score complaints
    if trace.metadata.get("regenerated"):
        return 0.5                               # user asked again → suspect
    if trace.metadata.get("guardrail_flag"):
        return 1.0
    if trace.latency_ms > 20_000:
        return 0.3                               # timeouts correlate with junk
    if trace.metadata.get("prompt_version_is_new"):
        return 0.25                              # watch fresh deploys closely
    return base

def should_score(trace: EvalTrace) -> bool:
    return random.random() < sample_rate_for(trace)
```

Targeted sampling introduces bias by construction — you are over-representing suspected failures — so keep the uniform stratum as a separate, unbiased population estimate and report targeted-stratum metrics separately. Mixing them produces a quality number that looks alarming for no reason. A useful framing: the uniform stratum answers "how are we doing," the targeted stratum answers "what is going wrong."

**Sample size sanity check.** To detect a quality drop of size `d` (in proportion terms) with the usual 80% power at 5% significance you need roughly `n ≈ 16 · p(1−p) / d²` scored items *per comparison window*. To catch a 5-point drop from a 0.85 baseline (`p=0.85, d=0.05`) that's ~816 judged items per window. If your sample rate and traffic don't produce that many in the window you want to alert on, you cannot detect that regression no matter how good the judge is — widen the window or raise the rate.

## Reference-Free Metrics: Judging Without Ground Truth

Offline evals lean on golden answers. Production has no ground truth — nobody wrote the reference answer for a query that arrived 40ms ago. Online metrics must be **reference-free**. The workhorses:

**Cheap deterministic checks (run inline, on 100% of traffic — they're nearly free):**

- **Schema / format validity.** For structured-output graphs, does the output parse and satisfy the schema? This is a free, high-signal regression detector and the single best early-warning metric for "the model changed under us." The roadmap's `course_review` graph emits a fixed score shape; a sudden rise in parse-fallback rate is a louder, faster signal than any judge.
- **Refusal and empty-output rate.** A spike in "I can't help with that" or empty completions is almost always a regression, not a population shift.
- **Guardrail hits.** PII leakage, toxicity classifier, banned-topic match (see `/guardrails-filtering`). Cheap classifiers, run on everything.
- **Length and self-repetition.** Degenerate looping and sudden length collapse are detectable with no model call.

**LLM-as-judge checks (run on the sampled subset):**

Reference-free judging asks the judge to assess properties intrinsic to the (input, output) pair rather than agreement with a reference. The `/llm-as-judge` article covers calibration and bias in depth; the production-specific points:

- **Faithfulness / groundedness** for RAG: is every claim supported by the retrieved context? This is the most operationally critical online metric for any retrieval system because it directly measures hallucination and needs no ground truth — only the context that was already in the trace.
- **Relevance / answer-query alignment:** does the response actually address the request?
- **Coherence / instruction-following:** internal consistency and adherence to system constraints.

The roadmap already has the judge infrastructure for this. `backend/tests/deepeval/conftest.py` wraps `make_llm()` in a `DeepEvalBaseLLM` so the judge honors the same `LLM_BASE_URL` / `DEEPSEEK_API_KEY` as the graphs. The online scorer is the *same judge*, invoked from a worker instead of a pytest fixture:

```python
# online_scorer.py — runs in the async worker pool, NOT in the request path
from deepeval.metrics import FaithfulnessMetric, AnswerRelevancyMetric
from deepeval.test_case import LLMTestCase
from knowledge_agent.llm import make_llm

_judge = make_llm(temperature=0.0)   # reuse the graphs' LLM factory

async def score_trace(trace: EvalTrace) -> dict[str, float]:
    tc = LLMTestCase(
        input=trace.inputs["query"],
        actual_output=trace.output,
        retrieval_context=trace.inputs.get("context_chunks", []),
    )
    scores: dict[str, float] = {}
    for metric in (FaithfulnessMetric(model=_judge),
                   AnswerRelevancyMetric(model=_judge)):
        try:
            metric.measure(tc)
            scores[metric.__class__.__name__] = metric.score
        except Exception as e:                       # judge JSON flake
            scores[metric.__class__.__name__] = float("nan")
            log.warning("judge failed trace=%s: %r", trace.trace_id, e)
    return scores
```

This is the key architectural insight for this codebase: **online eval is not a new system, it is the offline harness invoked from a sampler instead of CI.** Same judge, same metrics, same `run_metric`-style defensive error handling — different trigger and a metrics store instead of an assertion.

**Tiered judging for cost.** Don't use your most expensive judge on every sampled item. Run a cheap small-model judge on the full sample; escalate only the bottom-quartile and disagreement cases to a stronger judge. This is the same tiering logic the `/cost-optimization` article applies to serving, applied to evaluation. Two-tier judging typically cuts judge cost 60–80% while preserving detection of real regressions, because the cheap judge is reliable at separating "clearly fine" from "needs a closer look."

## User Feedback as a Quality Signal

Production has something offline never will: real users reacting to real outputs. Feedback is the closest thing to ground truth you get at scale, but it is sparse, biased, and noisy. Treat it as a signal to be calibrated, not a label to be trusted blindly.

**Explicit feedback** — thumbs, star ratings, "report" buttons. High precision, terrible recall: well under 1% of users click anything, and those who do skew negative and non-representative. Use explicit negatives as a high-priority sampling trigger (always score a thumbs-down) and as seeds for failure analysis, *not* as an unbiased quality estimate. A rising thumbs-down *rate* is meaningful; the absolute rate is not.

**Implicit feedback** — far denser and often more honest:

- **Regeneration / "try again":** the strongest everyday dissatisfaction signal. A regeneration rate climbing from 8% to 15% is a quality regression even with zero explicit complaints.
- **Edits to generated content:** for draft/summary features, the edit distance between what you produced and what the user kept is a continuous quality measure that needs no judge at all.
- **Conversation abandonment:** user leaves mid-task without resolution.
- **Copy / accept / ship actions:** for code or content generation, did the artifact get used? The roadmap's `article_generate` and `memorize_generate` graphs have a natural implicit signal — was the generated lesson/card kept and reviewed, or discarded?
- **Follow-up rephrasing:** the user immediately re-asks the same thing differently — a retrieval or comprehension failure.

Join feedback to traces on `trace_id` and treat the labeled subset as a calibration set for your automated judge: periodically check that judge scores actually predict user-observed outcomes. If "high faithfulness" outputs get regenerated as often as low ones, your judge is measuring the wrong thing — calibrate it (see `/llm-as-judge`) or replace the metric. An online judge that has never been checked against a behavioral signal is decoration.

## Drift and Regression Detection

A raw quality time series is not an alert. Production quality is noisy: it wanders with traffic mix, time of day, and judge variance. The job is separating *signal* (a real regression) from *noise* (normal wobble). Three layers, cheapest first.

**1. Versioned change-point detection.** The highest-value, lowest-effort check. Because every trace carries `prompt_version` and `model_fingerprint`, you can compute quality *per version* and compare deploys directly instead of staring at a continuous line:

```python
from statistics import mean
from scipy import stats   # available in the backend toolchain

def regression_check(baseline: list[float], candidate: list[float],
                     min_n: int = 200, max_drop: float = 0.03):
    """Compare a new prompt/model version's scored window to the prior
    version's. Welch's t-test: unequal variance, unequal n."""
    if len(candidate) < min_n:
        return {"status": "insufficient_data", "n": len(candidate)}
    drop = mean(baseline) - mean(candidate)
    t, p = stats.ttest_ind(baseline, candidate, equal_var=False)
    regressed = drop > max_drop and p < 0.05
    return {
        "status": "regression" if regressed else "ok",
        "baseline_mean": round(mean(baseline), 4),
        "candidate_mean": round(mean(candidate), 4),
        "drop": round(drop, 4),
        "p_value": round(p, 4),
    }
```

A silent provider model swap shows up here as a regression with **no corresponding `prompt_version` change** — that signature ("quality fell, we didn't deploy anything") is precisely the failure offline CI structurally cannot catch, and the single strongest argument for running online eval at all.

**2. Sequential monitoring (CUSUM).** For continuous monitoring without a deploy boundary, a CUSUM chart accumulates small deviations and fires when the running sum crosses a threshold — it catches slow degradation that a single-window t-test misses and reacts far faster than waiting for a window mean to visibly move:

```python
def cusum(scores: list[float], target: float, slack: float = 0.005,
          threshold: float = 0.05) -> int | None:
    """Return the index where a sustained downward shift is detected."""
    s_lo = 0.0
    for i, x in enumerate(scores):
        s_lo = min(0.0, s_lo + (x - target) + slack)
        if s_lo < -threshold:
            return i
    return None
```

**3. Distribution drift on inputs.** Quality can be stable while *inputs* shift — the prelude to a future quality drop. Embed incoming queries (the roadmap already has an embedding path), and track population stability (PSI) or the distance between this week's query-embedding centroid and a reference window. Rising input drift with flat quality is a leading indicator: your golden set is going stale and the next model change will hurt more than the metrics currently show.

**Alerting discipline.** Alert on *sustained, statistically significant* drops attributable to a version or a sustained shift — never on a single bad window. Route every quality alert with its diagnostic payload (version diff, sample traces, segment breakdown) the way `/observability` describes for operational alerts. A quality alert with no example traces attached is unactionable and will be ignored within a week.

## Online Experimentation: Shadow, Canary, A/B

Offline eval predicts whether a change is better. Online experimentation *proves* it on real traffic. The progression, in increasing order of exposure:

**Shadow evaluation.** Run the candidate prompt/model on a copy of live traffic without showing results to users. Score both old and new with the online judge and compare. Zero user risk; the cleanest way to validate a model migration (e.g., a Claude or DeepSeek version bump — see `/eval-frameworks-comparison`) before anyone sees it. Cost is the catch: you pay double inference for shadowed traffic, so shadow a sample, not everything.

**Canary.** Route a small fraction (1–5%) of real traffic to the candidate. Watch online quality *and* guardrail metrics on the canary slice. Auto-rollback on a significant drop. This is the production-deploy analogue of the CI gate in `/ci-cd-ai` — same gate logic, live traffic instead of a fixture set.

**A/B testing with guardrail metrics.** A controlled split with enough traffic for statistical power. The trap unique to LLM A/Bs: a change that improves your headline judge score while quietly degrading latency, cost, or refusal rate. Always pair the primary quality metric with **guardrail metrics** (p95 latency, cost/request, refusal rate, guardrail-hit rate) and require the candidate not to regress *any* of them. Optimizing a single eval number is how you ship a model that judges love and users leave.

**Interleaving.** For ranking-style outputs (the roadmap's `fetch_courses` graph ranks courses by relevance), interleave results from both variants in one response and attribute clicks. Interleaving needs roughly an order of magnitude less traffic than a split A/B to reach significance, because each user sees both variants and within-user comparison removes between-user variance.

**Sequential testing.** Don't peek at a fixed-horizon A/B test and stop when it crosses significance — repeated peeking inflates the false-positive rate dramatically. Use an always-valid sequential test (mSPRT or a group-sequential design) if you want to monitor continuously and stop early. This is the single most common statistical error in LLM experimentation; the `/eval-fundamentals` article covers the underlying multiple-comparisons problem.

## Closing the Loop

Online eval that only produces dashboards is wasted spend. The point is to feed production reality back into the parts of the system that improve:

1. **Mine failures into the golden set.** Every trace that scored low *or* got negative feedback is a candidate test case. Cluster them (embed and group), dedupe, have a human confirm the expected behavior, and append to `backend/tests/deepeval/golden/<graph>.json`. This is how a static golden set stays representative — it grows from the long tail production discovers, not from what you imagined. The `/deepeval-synthesizer` article covers generating variations around each confirmed seed so one production failure becomes a small robust test cluster instead of a single brittle case.
2. **Promote the online judge to a CI gate.** Once an online metric has earned trust (it correlates with user-observed outcomes), wire the same metric into the offline suite so the next regression is caught *before* deploy, not after. Online eval discovers the metrics that matter; offline eval then guards them.
3. **Recalibrate the judge.** Use the feedback-labeled subset to re-check judge agreement with humans on a schedule. Judge calibration drifts as the input distribution and the judge model both change.
4. **Curate fine-tuning / few-shot data.** Confirmed high-quality production outputs are gold-standard few-shot examples and SFT data; confirmed failures define what to fix (see `/dataset-curation`).

The loop, stated as an invariant: *a failure observed in production should make it impossible for the same failure to ship silently again.* If a production regression can recur without a test going red, the loop isn't closed yet.

## A Concrete Wiring for This Codebase

Pulling the pieces together for the roadmap's LangGraph backend, the smallest viable online-eval system is four additions, each reusing infrastructure that already exists:

- **Trace emit.** In the FastAPI `/runs/wait` handler in `backend/app.py`, after `graph.ainvoke(...)` returns, emit an `EvalTrace` to a queue (a Postgres table on the existing Neon instance, or a Cloudflare Queue — the checkpoint store is already there). Fire-and-forget; never block the response. The `applications/[id]/prep` route already uses a fire-and-forget pattern to copy.
- **Sampler.** The `sample_rate_for` heuristic above, computed inline from data already in the response and request metadata. Negative feedback and structured-output parse failures get rate 1.0.
- **Scorer worker.** A separate process draining the queue, reusing `make_llm()` and the exact deepeval metrics from `backend/tests/deepeval/`, writing scores to a `eval_scores` table keyed by `trace_id, graph, prompt_version, model`. Reuse the suite's `run_metric` retry/`nan`-on-flake handling verbatim — production judge flake is the same DeepSeek JSON-parse flake the offline suite already hardened against.
- **Watcher.** A scheduled job running `regression_check` per `(graph, prompt_version)` window and the CUSUM monitor, alerting through the existing observability path. Start it read-only (alert only) for two weeks to learn the noise floor before letting it gate or roll back anything.

Prompt versioning falls out for free: hash each graph's prompt module (`course_review_prompts.py`, the `article_generate` prompt constants) at build time and stamp the hash into every trace. A prompt edit now produces a new `prompt_version`, `regression_check` compares the new version's window against the old automatically, and a quality drop with an *unchanged* hash is, by elimination, an upstream model or data change — the one class of failure the offline suite in `/ci-cd-ai` cannot see.

## Failure Modes and Anti-Patterns

- **Scoring on the request path.** Adding a judge call inline doubles latency and adds a second failure surface to every user request. Always out-of-band.
- **One number, no segments.** A flat aggregate hides a 20-point drop in a 5%-of-traffic segment. Always slice by feature, version, language, and tier.
- **Trusting an uncalibrated judge.** An online judge never checked against a behavioral signal measures its own biases, confidently. Calibrate against feedback before you trust the trend.
- **Alerting on single windows.** Quality is noisy; per-window alerts train the team to ignore the pager. Require sustained, significant, attributable drops.
- **Untracked prompt/model versions.** Without version stamps you get a quality line that moves and no way to say what moved it. The versioned attribution *is* the product; the dashboard is just its display.
- **Mixing biased and unbiased strata.** Aggregating targeted (failure-seeking) samples with uniform samples produces a quality number that is alarming by construction and actionable by no one.
- **Dashboards as the deliverable.** If low-scoring traces never become test cases, you are paying for a judge to narrate a decline you won't prevent. The loop is the point.

## Summary and Key Takeaways

- **Offline eval gates deploys; online eval gates trust.** Offline catches regressions you anticipated on a static set; online catches distribution shift, silent model drift, upstream data drift, and emergent failures that a fixed dataset structurally cannot.
- **Scoring is always out-of-band.** Decouple serving from scoring with trace emission, sampling, and an async worker pool. Never put a judge on the user's critical path.
- **Sample deliberately.** Uniform sampling for an unbiased population estimate; stratified to protect low-volume high-stakes segments; targeted to spend budget where failures are likely — but keep biased and unbiased strata separate, and size the sample to the regression you need to detect.
- **Metrics are reference-free.** Cheap deterministic checks (schema validity, refusal rate, guardrail hits) on 100% of traffic; LLM-judge checks (faithfulness, relevance, coherence) on the sampled subset. Tier judges for cost.
- **User feedback is signal, not truth.** Explicit feedback is high-precision/low-recall and skewed; implicit signals (regeneration, edits, abandonment) are denser and often more honest. Use feedback to calibrate the judge, not to replace it.
- **Detect regressions statistically and by version.** Per-version change-point detection is the highest-value check; CUSUM catches slow drift; input-distribution drift is a leading indicator. Alert only on sustained, significant, attributable drops.
- **Experiment in increasing exposure.** Shadow → canary → A/B, always paired with guardrail metrics (latency, cost, refusal) and proper sequential statistics. Never optimize a single eval number in isolation.
- **Close the loop or don't bother.** Mine production failures into the golden set, promote trusted online metrics into CI gates, recalibrate judges against feedback, and curate training data. A failure seen in production must become impossible to ship silently again.
- **For this codebase, online eval is the offline harness re-triggered.** Same `make_llm()` judge, same deepeval metrics, same defensive error handling — invoked from a sampler and a scheduled watcher instead of pytest, writing to a metrics store instead of asserting.

## Further Reading

This article covers evaluation in production. The following companion articles go deeper on adjacent topics:

- [LLM Evaluation Fundamentals](/eval-fundamentals) — Metrics, datasets, statistical rigor, and the methodology online eval builds on.
- [LLM-as-Judge](/llm-as-judge) — Calibrating and de-biasing the judge model that does your reference-free scoring.
- [Benchmark Design](/benchmark-design) — Contamination and saturation; why static golden sets go stale and need production-mined cases.
- [Human Evaluation](/human-evaluation) — Turning the feedback-labeled subset into a calibration set with measured inter-rater reliability.
- [RAG Evaluation](/rag-evaluation) — Faithfulness and relevance metrics, the workhorses of online scoring for retrieval systems.
- [Agent Evaluation](/agent-evaluation) — Trajectory-level evaluation for multi-step graphs where the final answer isn't the whole story.
- [DeepEval Synthesizer](/deepeval-synthesizer) — Expanding each production failure into a robust test cluster instead of a brittle single case.
- [Observability](/observability) — The tracing, logging, and alerting substrate online eval rides on.
- [CI/CD for AI](/ci-cd-ai) — The offline gate online eval feeds back into; the deploy-time counterpart of the canary.
- [Cost Optimization](/cost-optimization) — Tiered-judge economics and the budget math behind sampling rates.
