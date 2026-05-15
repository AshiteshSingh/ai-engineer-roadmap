"""deepeval gate for the ``chat`` graph.

Metrics per case:
  - ``Grounded-in-Context`` GEval — when retrieval_context is provided the
    answer must be consistent with it; replaces ``FaithfulnessMetric`` which
    was too literal (penalized valid paraphrases) for tutor-style output.
  - ``Answers-The-Question`` GEval — tutor-aware relevance check that
    treats polite off-topic redirects as correct and tolerates pedagogical
    context/caveats. Replaces ``AnswerRelevancyMetric``, which expects
    pure Q&A and scored our tutor at 0.0 on off-topic refusal.
  - ``must_mention`` heuristic — cheap structural signal; catches systemic
    misses without spending judge tokens.

Aggregate pass-rate across all (case × metric) cells must be ≥
``DEFAULT_AGGREGATE_GATE`` (0.65).
"""

from __future__ import annotations

import pytest

from knowledge_agent.chat_graph import build_graph

from .conftest import (
    DEFAULT_THRESHOLD,
    aggregate_gate,
    deepeval_required,
    run_metric,
)


async def _run_chat(case: dict) -> str:
    graph = build_graph()
    result = await graph.ainvoke(
        {
            "message": case["message"],
            "history": [],
            "context_snippets": case.get("context_snippets", []),
        }
    )
    return str(result.get("response", ""))


@pytest.mark.deepeval
@pytest.mark.asyncio
async def test_chat_shape(golden_chat: list[dict]) -> None:
    """Every chat case must return a non-empty string response."""
    failures: list[str] = []
    for case in golden_chat:
        try:
            response = await _run_chat(case)
        except Exception as e:  # noqa: BLE001
            failures.append(f"[{case['id']}] graph raised: {e!r}")
            continue
        if not response or not isinstance(response, str):
            failures.append(f"[{case['id']}] empty or non-string response")
        elif len(response) < 10:
            failures.append(
                f"[{case['id']}] suspiciously short response: {response!r}"
            )
    assert not failures, "Shape failures:\n  - " + "\n  - ".join(failures)


@deepeval_required
@pytest.mark.deepeval
@pytest.mark.asyncio
async def test_chat_judged(golden_chat: list[dict], judge) -> None:
    """LLM-judge gate with two tutor-aware GEval metrics + must_mention heuristic."""
    from deepeval.metrics import GEval
    from deepeval.test_case import LLMTestCase, LLMTestCaseParams

    grounded = GEval(
        name="Grounded-in-Context",
        evaluation_steps=[
            "Read the INPUT (user question), ACTUAL_OUTPUT (tutor's answer), and RETRIEVAL_CONTEXT (snippets the tutor was shown).",
            "If retrieval context is provided, the answer must be consistent with it — penalize claims that directly contradict the snippets.",
            "Paraphrases and syntheses that stay faithful to the snippets' meaning are acceptable (a good tutor restates in their own words).",
            "Adding complementary detail from general AI/ML knowledge is fine as long as it doesn't contradict the snippets.",
            "If no retrieval context is provided, score this metric a full pass — it's not applicable to off-topic refusals.",
        ],
        evaluation_params=[
            LLMTestCaseParams.INPUT,
            LLMTestCaseParams.ACTUAL_OUTPUT,
            LLMTestCaseParams.RETRIEVAL_CONTEXT,
        ],
        threshold=DEFAULT_THRESHOLD,
        model=judge,
        async_mode=False,
    )

    answers = GEval(
        name="Answers-The-Question",
        evaluation_steps=[
            "This is an AI engineering tutor chatbot. Tutors answer questions with pedagogical context, caveats, and cross-references — that is the expected style.",
            "A good answer addresses the user's question substantively. It does NOT need to be minimal — educational context is a feature, not a flaw.",
            "For off-topic questions (e.g., restaurants, sports), the correct behavior is a polite redirect back to AI/ML engineering topics. Score a polite redirect as a FULL PASS.",
            "Penalize only: answers that ignore the question, give nonsense, repeat themselves excessively, or go on long tangents unrelated to the question.",
        ],
        evaluation_params=[
            LLMTestCaseParams.INPUT,
            LLMTestCaseParams.ACTUAL_OUTPUT,
        ],
        threshold=DEFAULT_THRESHOLD,
        model=judge,
        async_mode=False,
    )

    passes = 0
    total = 0
    failures: list[str] = []

    for case in golden_chat:
        try:
            actual = await _run_chat(case)
        except Exception as e:  # noqa: BLE001
            failures.append(f"[{case['id']}] graph error: {e!r}")
            continue

        snippets = case.get("context_snippets", [])
        tc = LLMTestCase(
            input=case["message"],
            actual_output=actual,
            retrieval_context=snippets or ["(no context — off-topic question)"],
        )

        must = [m.lower() for m in case.get("must_mention", [])]
        if must:
            al = actual.lower()
            hits = sum(1 for m in must if m in al)
            heuristic_pass = hits / len(must) >= 0.5
            total += 1
            passes += int(heuristic_pass)
            if not heuristic_pass:
                failures.append(
                    f"[{case['id']}] must_mention: {hits}/{len(must)} ({must})"
                )

        # Grounded-in-Context only runs when there's retrieval context.
        if snippets:
            ok, diag = run_metric(grounded, tc)
            total += 1
            passes += int(ok)
            if not ok:
                failures.append(f"[{case['id']}] Grounded-in-Context: {diag}")

        ok, diag = run_metric(answers, tc)
        total += 1
        passes += int(ok)
        if not ok:
            failures.append(f"[{case['id']}] Answers-The-Question: {diag}")

    aggregate_gate(passes, total, failures, label="chat_graph")
