"""Shared fixtures for the deepeval suite.

Pattern mirrors apps/lead-gen/backend/tests/test_deep_icp_eval.py:

1. A ``DeepEvalBaseLLM`` wrapper over our ``make_llm()`` factory so deepeval
   judges respect ``LLM_BASE_URL`` / ``DEEPSEEK_API_KEY`` from the env.
2. ``deepeval_required`` skip marker — the suite no-ops on dev machines
   without deepeval or a judge LLM configured.
3. JSON golden loaders keyed by graph name.
4. ``aggregate_gate()`` helper that asserts pass-rate ≥ threshold across
   (case × metric) cells and prints a compact diagnostic on failure.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import pytest

GOLDEN_DIR = Path(__file__).parent / "golden"


def _deepeval_available() -> bool:
    try:
        import deepeval  # noqa: F401
        from deepeval.metrics import AnswerRelevancyMetric  # noqa: F401

        return True
    except ImportError:
        return False


def _judge_available() -> bool:
    return bool(
        os.environ.get("LLM_BASE_URL") or os.environ.get("DEEPSEEK_API_KEY")
    )


deepeval_required = pytest.mark.skipif(
    not _deepeval_available() or not _judge_available(),
    reason="deepeval not installed or no judge LLM configured (set LLM_BASE_URL or DEEPSEEK_API_KEY)",
)


def _load_golden(name: str) -> list[dict]:
    path = GOLDEN_DIR / f"{name}.json"
    with path.open("r", encoding="utf-8") as fh:
        data = json.load(fh)
    assert isinstance(data, list), f"{name}.json must be a JSON array"
    assert len(data) >= 3, f"{name}.json must have at least 3 cases"
    return data


@pytest.fixture(scope="session")
def golden_chat() -> list[dict]:
    return _load_golden("chat")


@pytest.fixture(scope="session")
def golden_app_prep() -> list[dict]:
    return _load_golden("app_prep")


@pytest.fixture(scope="session")
def golden_course_review() -> list[dict]:
    return _load_golden("course_review")


@pytest.fixture(scope="session")
def golden_article_generate() -> list[dict]:
    return _load_golden("article_generate")


def make_judge():
    """Wrap our ``make_llm()`` in ``DeepEvalBaseLLM`` so judges honor
    ``LLM_BASE_URL`` / ``DEEPSEEK_API_KEY`` the same way the graphs do."""
    from deepeval.models.base_model import DeepEvalBaseLLM

    from knowledge_agent.llm import make_llm

    class LocalJudge(DeepEvalBaseLLM):
        def __init__(self) -> None:
            self._m = make_llm(temperature=0.0)

        def load_model(self):
            return self._m

        def generate(self, prompt: str) -> str:
            resp = self._m.invoke(prompt)
            return str(getattr(resp, "content", resp))

        async def a_generate(self, prompt: str) -> str:
            resp = await self._m.ainvoke(prompt)
            return str(getattr(resp, "content", resp))

        def get_model_name(self) -> str:
            return os.environ.get("LLM_MODEL", "local")

    return LocalJudge()


@pytest.fixture(scope="session")
def judge():
    return make_judge()


def _run_graph_for_all(graph, payloads: list[dict]) -> list[dict]:
    """Invoke ``graph.ainvoke`` once per payload; return results in order.

    Used by session-scoped output fixtures so the expensive graphs
    (course_review: 11 LLM calls/case; article_generate: 4-5 calls/case)
    run exactly once per case per test session — shape, direction, and
    judged tests then share the same outputs. Cuts slow-tier runtime by ~3x.
    """
    import asyncio

    async def _all() -> list[dict]:
        out: list[dict] = []
        for p in payloads:
            out.append(await graph.ainvoke(p))
        return out

    return asyncio.run(_all())


@pytest.fixture(scope="session")
def course_review_outputs(golden_course_review: list[dict]) -> list[dict]:
    """Run each golden course through ``course_review`` exactly once per session."""
    from knowledge_agent.course_review_graph import build_graph

    graph = build_graph()
    return _run_graph_for_all(graph, [c["course"] for c in golden_course_review])


@pytest.fixture(scope="session")
def article_outputs(golden_article_generate: list[dict]) -> list[dict]:
    """Run each golden article case through ``article_generate`` once per session."""
    from knowledge_agent.article_generate_graph import build_graph

    graph = build_graph()
    payloads = [
        {
            "slug": c["slug"],
            "topic": c["topic"],
            "category": c["category"],
            "related_topics": c["related_topics"],
            "existing_articles": c["existing_articles"],
            "style_sample": c["style_sample"],
        }
        for c in golden_article_generate
    ]
    return _run_graph_for_all(graph, payloads)


DEFAULT_THRESHOLD = 0.7
# 0.65 is the empirical floor for 5-case goldens judged by DeepSeek:
# ~1 of 15 cells flakes on judge JSON parse errors and another 1-2 hit real
# borderline-quality signals (answer redundancy, mild conflation). Tighten
# this as the golden set grows or judge calibration improves.
DEFAULT_AGGREGATE_GATE = 0.65


def aggregate_gate(
    passes: int,
    total: int,
    failures: list[str],
    *,
    gate: float = DEFAULT_AGGREGATE_GATE,
    label: str = "deepeval",
) -> None:
    """Assert pass-rate ≥ ``gate`` across all (case × metric) cells.

    ``failures`` is a list of human-readable strings for diagnostics when the
    gate trips — only the first 30 are printed to keep output manageable.
    """
    rate = passes / max(1, total)
    summary = (
        f"{label} pass rate: {passes}/{total} = {rate:.2%} (gate {gate:.2f})"
    )
    if failures:
        summary += "\n  - " + "\n  - ".join(failures[:30])
    assert rate >= gate, summary


def run_metric(
    metric: Any, test_case: Any, *, retries: int = 1
) -> tuple[bool, str]:
    """Invoke a deepeval metric safely.

    Returns ``(passed, reason_or_error)``. Behavior:
      - Retries once on exception (DeepSeek occasionally returns malformed
        JSON the judge can't parse; one retry usually succeeds).
      - Treats ``score >= threshold`` as a pass even when
        ``is_successful()`` returns False — deepeval's ``_successful``
        flag can false-flag when a sub-step errored mid-run despite the
        final score being valid.
      - Any persistent exception counts as a failure with the error
        captured for diagnostics, so one bad judge response can't kill
        the whole run.
    """
    last_err: str | None = None
    for attempt in range(retries + 1):
        try:
            metric.measure(test_case)
            score = getattr(metric, "score", None)
            threshold = getattr(metric, "threshold", DEFAULT_THRESHOLD)
            is_successful = getattr(metric, "is_successful", lambda: False)
            flag_ok = bool(is_successful())
            score_ok = (
                isinstance(score, (int, float)) and score >= threshold
            )
            ok = flag_ok or score_ok
            reason = getattr(metric, "reason", "") or ""
            return ok, (
                f"score={score} threshold={threshold} flag={flag_ok} "
                f"reason={str(reason)[:180]}"
            )
        except Exception as e:  # noqa: BLE001
            last_err = repr(e)
            if attempt >= retries:
                break
    return False, f"error_after_retry={last_err}"
