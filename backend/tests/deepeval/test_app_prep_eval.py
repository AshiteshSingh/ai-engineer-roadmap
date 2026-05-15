"""deepeval gate for the ``app_prep`` graph.

Evaluates whether the JD → (tech_stack, interview_questions) extraction
captures the right tech and produces targeted prep material.

Metrics per case:
  - Tech-Coverage heuristic — fraction of expected_tech_tags whose
    tag/label appears in the output tech_stack. Cheap, doesn't spend judge
    tokens, catches systemic misses.
  - GEval Tech-Coverage — judge rates how well the extracted tech stack
    matches the JD's explicit + implicit stack (catches hallucinations).
  - GEval Interview-Relevance — judge rates whether the generated
    interview prep addresses the role + stack described in the JD.
"""

from __future__ import annotations

import pytest

from knowledge_agent.app_prep_graph import build_graph

from .conftest import (
    DEFAULT_THRESHOLD,
    aggregate_gate,
    deepeval_required,
    run_metric,
)


async def _run_app_prep(case: dict) -> dict:
    graph = build_graph()
    return await graph.ainvoke(
        {
            "app_id": case.get("id", "test"),
            "job_description": case["job_description"],
            "company": case.get("company", ""),
            "position": case.get("position", ""),
        }
    )


def _tech_tags_of(result: dict) -> set[str]:
    return {
        str(t.get("tag", "")).lower()
        for t in (result.get("tech_stack") or [])
        if isinstance(t, dict)
    }


def _tech_labels_of(result: dict) -> list[str]:
    return [
        str(t.get("label", ""))
        for t in (result.get("tech_stack") or [])
        if isinstance(t, dict)
    ]


@pytest.mark.deepeval
@pytest.mark.asyncio
async def test_app_prep_shape(golden_app_prep: list[dict]) -> None:
    """Every case must return a non-empty tech_stack and interview_questions."""
    failures: list[str] = []
    for case in golden_app_prep:
        try:
            out = await _run_app_prep(case)
        except Exception as e:  # noqa: BLE001
            failures.append(f"[{case['id']}] graph raised: {e!r}")
            continue

        techs = out.get("tech_stack") or []
        if not isinstance(techs, list) or len(techs) == 0:
            failures.append(f"[{case['id']}] empty tech_stack")
        else:
            for t in techs:
                if not isinstance(t, dict):
                    failures.append(f"[{case['id']}] tech entry not a dict: {t!r}")
                    continue
                for k in ("tag", "label", "category", "relevance"):
                    if not t.get(k):
                        failures.append(
                            f"[{case['id']}] tech missing {k}: {t!r}"
                        )

        iq = out.get("interview_questions") or ""
        if not isinstance(iq, str) or len(iq) < 200:
            failures.append(
                f"[{case['id']}] interview_questions short/missing: {len(iq) if isinstance(iq, str) else 'n/a'}"
            )

    assert not failures, "Shape failures:\n  - " + "\n  - ".join(failures)


@deepeval_required
@pytest.mark.deepeval
@pytest.mark.asyncio
async def test_app_prep_tech_and_relevance(
    golden_app_prep: list[dict], judge
) -> None:
    from deepeval.metrics import GEval
    from deepeval.test_case import LLMTestCase, LLMTestCaseParams

    tech_coverage = GEval(
        name="Tech-Coverage",
        evaluation_steps=[
            "Read the job description (INPUT) and the extracted tech_stack (ACTUAL_OUTPUT).",
            "The stack should name the technologies explicitly mentioned in the JD.",
            "Penalize hallucinated tech not implied by the JD.",
            "Synonyms and close variants count as matches (e.g. 'Postgres' and 'PostgreSQL').",
        ],
        evaluation_params=[LLMTestCaseParams.INPUT, LLMTestCaseParams.ACTUAL_OUTPUT],
        threshold=DEFAULT_THRESHOLD,
        model=judge,
        async_mode=False,
    )
    interview_relevance = GEval(
        name="Interview-Relevance",
        evaluation_steps=[
            "Interview questions should be tailored to the role and the stack in the JD.",
            "Reward concrete questions about the specific tech mentioned.",
            "Penalize generic 'tell me about yourself' questions with no tech specificity.",
        ],
        evaluation_params=[LLMTestCaseParams.INPUT, LLMTestCaseParams.ACTUAL_OUTPUT],
        threshold=DEFAULT_THRESHOLD,
        model=judge,
        async_mode=False,
    )

    passes = 0
    total = 0
    failures: list[str] = []

    for case in golden_app_prep:
        try:
            out = await _run_app_prep(case)
        except Exception as e:  # noqa: BLE001
            failures.append(f"[{case['id']}] graph error: {e!r}")
            continue

        tags = _tech_tags_of(out)
        labels_lower = [l.lower() for l in _tech_labels_of(out)]

        expected = [t.lower() for t in case.get("expected_tech_tags", [])]
        hits = 0
        for exp in expected:
            if exp in tags or any(exp in lbl for lbl in labels_lower):
                hits += 1
        coverage = hits / max(1, len(expected))
        heuristic_pass = coverage >= 0.6
        total += 1
        passes += int(heuristic_pass)
        if not heuristic_pass:
            failures.append(
                f"[{case['id']}] tech heuristic: {hits}/{len(expected)} "
                f"got tags={sorted(tags)}"
            )

        actual = (
            f"TECH_STACK: {', '.join(_tech_labels_of(out))}\n\n"
            f"INTERVIEW_QUESTIONS:\n{out.get('interview_questions', '')}"
        )
        tc = LLMTestCase(
            input=f"Role: {case['position']} at {case['company']}\n\n{case['job_description']}",
            actual_output=actual,
        )

        for metric in (tech_coverage, interview_relevance):
            total += 1
            ok, diag = run_metric(metric, tc)
            passes += int(ok)
            if not ok:
                failures.append(
                    f"[{case['id']}] {metric.name} failed: {diag}"
                )

    aggregate_gate(passes, total, failures, label="app_prep_graph")
