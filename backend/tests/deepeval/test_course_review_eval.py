"""deepeval gate for the ``course_review`` graph.

The graph runs 10 parallel expert LLM calls + 1 aggregator per course — by
far the most expensive graph to evaluate. Marked ``@slow`` so it's skipped
by the default ``pnpm test:deepeval`` run; opt in via ``test:deepeval:all``.

Metrics:
  - Deterministic shape: all 10 expert scores, aggregate in [1,10], valid
    verdict, verdict consistent with aggregate thresholds.
  - Golden direction check: known-good courses should land in
    {excellent, recommended}; known-bad in {average, skip}. This is the
    core signal — if the verdict drifts on these benchmark courses we want
    the gate to trip.
  - GEval Verdict-Consistency — judge rates whether the summary and
    top_strengths/key_weaknesses fit the aggregate_score.
"""

from __future__ import annotations

import pytest

from .conftest import (
    DEFAULT_THRESHOLD,
    aggregate_gate,
    deepeval_required,
    run_metric,
)

VALID_VERDICTS = {"excellent", "recommended", "average", "skip"}


@pytest.mark.deepeval
@pytest.mark.slow
def test_course_review_shape(
    golden_course_review: list[dict],
    course_review_outputs: list[dict],
) -> None:
    """Every graph output must be well-formed: 10 experts, aggregate in range, valid verdict.

    Uses the session-scoped ``course_review_outputs`` fixture so the graph
    is run once per case; all three slow tests share the same outputs.
    """
    failures: list[str] = []

    expert_keys = [
        "pedagogy_score",
        "technical_accuracy_score",
        "content_depth_score",
        "practical_application_score",
        "instructor_clarity_score",
        "curriculum_fit_score",
        "prerequisites_score",
        "ai_domain_relevance_score",
        "community_health_score",
        "value_proposition_score",
    ]

    for case, out in zip(golden_course_review, course_review_outputs):
        if not isinstance(out, dict):
            failures.append(f"[{case['id']}] graph output not a dict: {out!r}")
            continue

        for k in expert_keys:
            score_obj = out.get(k) or {}
            if not isinstance(score_obj, dict):
                failures.append(f"[{case['id']}] {k} not a dict")
                continue
            s = score_obj.get("score")
            if not isinstance(s, int) or not (1 <= s <= 10):
                failures.append(f"[{case['id']}] {k}.score not 1-10: {s!r}")

        agg = out.get("aggregate_score")
        if not isinstance(agg, (int, float)) or not (0 < agg <= 10):
            failures.append(f"[{case['id']}] aggregate_score not (0,10]: {agg!r}")

        verdict = out.get("verdict")
        if verdict not in VALID_VERDICTS:
            failures.append(f"[{case['id']}] verdict not valid: {verdict!r}")

        if not out.get("summary"):
            failures.append(f"[{case['id']}] empty summary")

    assert not failures, "Shape failures:\n  - " + "\n  - ".join(failures)


@pytest.mark.deepeval
@pytest.mark.slow
def test_course_review_verdict_direction(
    golden_course_review: list[dict],
    course_review_outputs: list[dict],
) -> None:
    """On benchmark courses the verdict must land in the expected band.

    Runs WITHOUT the judge — uses the graph's own aggregate_score + verdict
    compared to the golden-set expectations. Cheap to run and the most
    important signal for catching regressions.
    """
    passes = 0
    total = 0
    failures: list[str] = []

    for case, out in zip(golden_course_review, course_review_outputs):
        if not isinstance(out, dict):
            failures.append(f"[{case['id']}] graph output not a dict")
            continue

        verdict = out.get("verdict", "")
        agg = float(out.get("aggregate_score", 0.0))

        total += 1
        expected_verdicts = case.get("expected_verdict_in") or []
        if not expected_verdicts or verdict in expected_verdicts:
            passes += 1
        else:
            failures.append(
                f"[{case['id']}] verdict={verdict!r} not in {expected_verdicts} "
                f"(agg={agg:.2f})"
            )

        if "expected_aggregate_min" in case:
            total += 1
            if agg >= case["expected_aggregate_min"]:
                passes += 1
            else:
                failures.append(
                    f"[{case['id']}] aggregate {agg:.2f} < min {case['expected_aggregate_min']}"
                )
        if "expected_aggregate_max" in case:
            total += 1
            if agg <= case["expected_aggregate_max"]:
                passes += 1
            else:
                failures.append(
                    f"[{case['id']}] aggregate {agg:.2f} > max {case['expected_aggregate_max']}"
                )

    aggregate_gate(passes, total, failures, label="course_review_direction")


@deepeval_required
@pytest.mark.deepeval
@pytest.mark.slow
def test_course_review_summary_coherence(
    golden_course_review: list[dict],
    course_review_outputs: list[dict],
    judge,
) -> None:
    """GEval: summary + strengths/weaknesses should fit the aggregate score."""
    from deepeval.metrics import GEval
    from deepeval.test_case import LLMTestCase, LLMTestCaseParams

    coherence = GEval(
        name="Verdict-Coherence",
        evaluation_steps=[
            "Read the INPUT (course description) and the ACTUAL_OUTPUT (aggregate score, verdict, summary, strengths, weaknesses).",
            "Check that the summary reflects the aggregate score — a 'recommended' course should not be described as 'shallow and outdated'.",
            "Check that top_strengths and key_weaknesses are consistent with the verdict.",
            "Penalize contradictions between the narrative and the numeric score.",
        ],
        evaluation_params=[LLMTestCaseParams.INPUT, LLMTestCaseParams.ACTUAL_OUTPUT],
        threshold=DEFAULT_THRESHOLD,
        model=judge,
        async_mode=False,
    )

    passes = 0
    total = 0
    failures: list[str] = []

    for case, out in zip(golden_course_review, course_review_outputs):
        if not isinstance(out, dict):
            failures.append(f"[{case['id']}] graph output not a dict")
            continue

        course = case["course"]
        input_str = (
            f"{course['title']} by {course['provider']} "
            f"(level: {course.get('level', '?')}, rating: {course.get('rating', '?')})\n"
            f"{course.get('description', '')}"
        )
        actual_str = (
            f"aggregate_score: {out.get('aggregate_score')}\n"
            f"verdict: {out.get('verdict')}\n"
            f"summary: {out.get('summary')}\n"
            f"top_strengths: {out.get('top_strengths')}\n"
            f"key_weaknesses: {out.get('key_weaknesses')}"
        )
        tc = LLMTestCase(input=input_str, actual_output=actual_str)

        total += 1
        ok, diag = run_metric(coherence, tc)
        passes += int(ok)
        if not ok:
            failures.append(f"[{case['id']}] coherence failed: {diag}")

    aggregate_gate(passes, total, failures, label="course_review_coherence")
