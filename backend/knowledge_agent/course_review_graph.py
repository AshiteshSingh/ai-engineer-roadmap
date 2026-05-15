"""Course-review graph: 10 parallel expert LLM calls + aggregator.

Ports apps/knowledge/src/mastra/workflows/review-course.ts. Per-expert
temperatures match the Mastra version:
- REASONER_TEMP (0.0) for pedagogy, technical_accuracy, ai_domain_relevance,
  and the aggregator — these benefit from deterministic judgement.
- FAST_TEMP (0.3) for the six remaining soft-scoring experts.

Input fields mirror the Mastra `courseInput` zod schema. Output fields mirror
`reviewOutput` so the existing frontend/DB storage stays unchanged.
"""

from __future__ import annotations

import asyncio
from typing import Any

from langgraph.graph import END, START, StateGraph

from . import course_review_prompts as prompts
from .llm import ainvoke_json, make_llm
from .state import CourseReviewState, ExpertScore

REASONER_TEMP = 0.0
FAST_TEMP = 0.3

# (state_key, prompt_fn, temperature)
_EXPERTS: list[tuple[str, Any, float]] = [
    ("pedagogy_score", prompts.pedagogy, REASONER_TEMP),
    ("technical_accuracy_score", prompts.technical_accuracy, REASONER_TEMP),
    ("content_depth_score", prompts.content_depth, FAST_TEMP),
    ("practical_application_score", prompts.practical_application, FAST_TEMP),
    ("instructor_clarity_score", prompts.instructor_clarity, FAST_TEMP),
    ("curriculum_fit_score", prompts.curriculum_fit, FAST_TEMP),
    ("prerequisites_score", prompts.prerequisites, FAST_TEMP),
    ("ai_domain_relevance_score", prompts.ai_domain_relevance, REASONER_TEMP),
    ("community_health_score", prompts.community_health, FAST_TEMP),
    ("value_proposition_score", prompts.value_proposition, FAST_TEMP),
]


def _format_course_info(s: CourseReviewState) -> str:
    rating = float(s.get("rating", 0.0))
    review_count = int(s.get("review_count", 0))
    duration_hours = float(s.get("duration_hours", 0.0))
    free_label = "Free" if s.get("is_free") else "Paid"
    return "\n".join(
        [
            f"Title: {s.get('title', '')}",
            f"Provider: {s.get('provider', '')}",
            f"URL: {s.get('url', '')}",
            f"Level: {s.get('level', 'Beginner')}",
            f"Rating: {rating:.1f}/5 ({review_count:,} reviews)",
            f"Duration: ~{round(duration_hours)}h",
            f"Price: {free_label}",
            f"Description: {s.get('description') or 'N/A'}",
        ]
    )


def _normalize_expert(raw: Any) -> ExpertScore:
    if not isinstance(raw, dict):
        return {"score": 1, "reasoning": "Invalid response", "strengths": [], "weaknesses": []}
    try:
        score = int(raw.get("score", 1))
    except (TypeError, ValueError):
        score = 1
    score = max(1, min(10, score))
    strengths = [str(s) for s in (raw.get("strengths") or []) if s]
    weaknesses = [str(w) for w in (raw.get("weaknesses") or []) if w]
    return {
        "score": score,
        "reasoning": str(raw.get("reasoning") or ""),
        "strengths": strengths,
        "weaknesses": weaknesses,
    }


async def _run_expert(course_info: str, system_prompt: str, temperature: float) -> ExpertScore:
    llm = make_llm(temperature=temperature)
    parsed = await ainvoke_json(
        llm,
        [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"Review this course:\n\n{course_info}"},
        ],
    )
    return _normalize_expert(parsed)


async def experts_node(state: CourseReviewState) -> dict:
    info = _format_course_info(state)
    tasks = [_run_expert(info, fn(info), temp) for _key, fn, temp in _EXPERTS]
    results = await asyncio.gather(*tasks)
    return {key: score for (key, _fn, _temp), score in zip(_EXPERTS, results)}


def _format_scores_summary(state: CourseReviewState) -> str:
    blocks: list[str] = []
    for key, _fn, _temp in _EXPERTS:
        s = state.get(key) or {}
        strengths = ", ".join(s.get("strengths", []))
        weaknesses = ", ".join(s.get("weaknesses", []))
        blocks.append(
            f"{key}:\n"
            f"  Score: {s.get('score', '?')}/10\n"
            f"  Reasoning: {s.get('reasoning', '')}\n"
            f"  Strengths: {strengths}\n"
            f"  Weaknesses: {weaknesses}"
        )
    return "\n\n".join(blocks)


async def aggregator_node(state: CourseReviewState) -> dict:
    course_info = _format_course_info(state)
    summary = _format_scores_summary(state)
    llm = make_llm(temperature=REASONER_TEMP)
    parsed = await ainvoke_json(
        llm,
        [
            {"role": "system", "content": prompts.aggregator(course_info, summary)},
            {"role": "user", "content": f"Aggregate these expert scores:\n\n{summary}"},
        ],
    )
    if not isinstance(parsed, dict):
        parsed = {}

    try:
        aggregate_score = float(parsed.get("aggregate_score", 0.0))
    except (TypeError, ValueError):
        aggregate_score = 0.0
    verdict = str(parsed.get("verdict") or "").strip().lower()
    if verdict not in ("excellent", "recommended", "average", "skip"):
        if aggregate_score >= 8.5:
            verdict = "excellent"
        elif aggregate_score >= 7.0:
            verdict = "recommended"
        elif aggregate_score >= 5.5:
            verdict = "average"
        else:
            verdict = "skip"
    top_strengths = [str(s) for s in (parsed.get("top_strengths") or []) if s]
    key_weaknesses = [str(w) for w in (parsed.get("key_weaknesses") or []) if w]

    return {
        "aggregate_score": round(aggregate_score, 1),
        "verdict": verdict,
        "summary": str(parsed.get("summary") or ""),
        "top_strengths": top_strengths,
        "key_weaknesses": key_weaknesses,
    }


def build_graph(checkpointer: Any = None) -> Any:
    builder = StateGraph(CourseReviewState)
    builder.add_node("experts", experts_node)
    builder.add_node("aggregator", aggregator_node)
    builder.add_edge(START, "experts")
    builder.add_edge("experts", "aggregator")
    builder.add_edge("aggregator", END)
    return builder.compile(checkpointer=checkpointer)


graph = build_graph()
