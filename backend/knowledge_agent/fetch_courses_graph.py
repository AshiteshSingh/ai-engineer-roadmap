"""Fetch-courses graph: LLM-rank pre-scraped Udemy courses for an arbitrary topic.

Two-node pipeline:
  rank_courses  — DeepSeek ranks the input course list by relevance to
                  ``topic_name``; returns top ``count`` with relevance (0–1)
                  and a one-line "why".
  summarize     — DeepSeek writes a short intro paragraph (2–3 sentences) for
                  the lesson page explaining the curation.

Why a graph (and not a single LLM call): keeps the ranking deterministic
(REASONER_TEMP=0.0) while the summary uses a warmer temperature (FAST_TEMP)
for prose quality. State threading also lets us add a third node later
(e.g. duplicate-detection across providers) without refactoring callers.

Scraping is intentionally **not** in this graph — the TS orchestrator does it
via Playwright (``scripts/lib/udemy-scrape.ts``) and passes the scraped
``courses`` array as input. This avoids running Playwright from Python and
keeps the existing scrape pattern.
"""

from __future__ import annotations

import json
from typing import Any

from langgraph.graph import END, START, StateGraph

from .llm import ainvoke_json, make_llm
from .state import FetchCoursesState, RankedCourse

REASONER_TEMP = 0.0
FAST_TEMP = 0.5

# Cap how much course context we send the ranker — keeps the prompt under
# DeepSeek's window and signals to the model what the relevant fields are.
_MAX_COURSES_TO_RANK = 30
_MAX_DESC_CHARS = 600
_MAX_LEARN_ITEMS = 6


def _slim_for_prompt(course: dict[str, Any]) -> dict[str, Any]:
    """Project a ScrapedCourse to just the fields the LLM needs to rank."""
    metadata = course.get("metadata") or {}
    desc = course.get("description") or metadata.get("subtitle") or ""
    if isinstance(desc, str) and len(desc) > _MAX_DESC_CHARS:
        desc = desc[:_MAX_DESC_CHARS] + "…"
    learn = metadata.get("whatYoullLearn") or []
    if isinstance(learn, list):
        learn = learn[:_MAX_LEARN_ITEMS]
    return {
        "url": course.get("url", ""),
        "title": course.get("title", ""),
        "subtitle": metadata.get("subtitle"),
        "description": desc,
        "rating": course.get("rating"),
        "review_count": course.get("reviewCount") or course.get("review_count"),
        "enrolled": course.get("enrolled"),
        "duration_hours": course.get("durationHours") or course.get("duration_hours"),
        "level": course.get("level"),
        "is_free": course.get("isFree") or course.get("is_free", False),
        "what_youll_learn": learn,
        "instructors": metadata.get("instructors") or [],
    }


def _ranker_prompt(topic_name: str, count: int) -> str:
    return (
        f"You are a curriculum curator selecting the best Udemy courses for the topic "
        f'"{topic_name}". You will be given a JSON array of candidate courses scraped '
        f"from Udemy's most-reviewed search results.\n\n"
        f"Return STRICTLY a JSON object of this shape:\n"
        f'{{"ranked": [{{"url": "...", "relevance": 0.0-1.0, "why": "<=15 words"}}]}}\n\n'
        f"Selection rules:\n"
        f'1. Pick the top {count} courses MOST relevant to "{topic_name}".\n'
        f"2. Prefer courses with high review_count (signals proven popularity), then high rating.\n"
        f"3. Penalize off-topic courses even if highly reviewed (e.g. for a soft-skill topic, "
        f"reject courses that are mostly about something else).\n"
        f'4. relevance must reflect topical fit to "{topic_name}", not just course quality.\n'
        f"5. ``why`` must be ≤15 words and concrete (mention what the course covers).\n"
        f"6. Output the {count} URLs in descending order of relevance.\n"
        f"7. Use the EXACT url string from each candidate.\n"
    )


def _summary_prompt(topic_name: str, count: int) -> str:
    return (
        f'Write a 2–3 sentence intro paragraph (under 60 words) for the "{topic_name}" '
        f"lesson page that introduces these {count} curated Udemy courses. "
        f"Be concrete about what learners will get; do not list course titles. "
        f'Return STRICTLY {{"summary": "..."}}.'
    )


def _normalize_ranked(raw: Any, valid_urls: set[str], count: int) -> list[RankedCourse]:
    if isinstance(raw, dict):
        items = raw.get("ranked") or raw.get("courses") or []
    elif isinstance(raw, list):
        items = raw
    else:
        items = []

    seen: set[str] = set()
    out: list[RankedCourse] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        url = str(item.get("url") or "").strip()
        if not url or url in seen:
            continue
        # Accept any URL the LLM returned; the orchestrator filters against
        # actually-scraped courses so a hallucinated URL just gets dropped.
        try:
            relevance = float(item.get("relevance", 0.5))
        except (TypeError, ValueError):
            relevance = 0.5
        relevance = max(0.0, min(1.0, relevance))
        why = str(item.get("why") or "").strip()
        out.append({"url": url, "relevance": round(relevance, 2), "why": why})
        seen.add(url)
        if len(out) >= count:
            break

    # If the LLM returned hallucinated URLs only, fall back to the first
    # `count` valid ones at relevance=0.5 so the orchestrator still gets data.
    if not any(r["url"] in valid_urls for r in out):
        fallback = list(valid_urls)[:count]
        return [{"url": u, "relevance": 0.5, "why": ""} for u in fallback]

    return out


async def rank_node(state: FetchCoursesState) -> dict:
    raw_courses = state.get("courses") or []
    topic_name = state.get("topic_name") or "this topic"
    count = max(1, int(state.get("count") or 10))

    candidates = [_slim_for_prompt(c) for c in raw_courses[:_MAX_COURSES_TO_RANK]]
    valid_urls = {c["url"] for c in candidates if c.get("url")}

    if not candidates:
        return {"ranked": []}

    llm = make_llm(temperature=REASONER_TEMP)
    parsed = await ainvoke_json(
        llm,
        [
            {"role": "system", "content": _ranker_prompt(topic_name, count)},
            {
                "role": "user",
                "content": (
                    f"Candidate courses (JSON array):\n{json.dumps(candidates, ensure_ascii=False)}"
                ),
            },
        ],
    )
    ranked = _normalize_ranked(parsed, valid_urls, count)
    return {"ranked": ranked}


async def summarize_node(state: FetchCoursesState) -> dict:
    ranked = state.get("ranked") or []
    topic_name = state.get("topic_name") or "this topic"
    if not ranked:
        return {"summary": ""}

    # Resolve titles for each ranked URL to give the summarizer concrete context.
    by_url = {c.get("url"): c for c in (state.get("courses") or [])}
    picks = []
    for r in ranked:
        course = by_url.get(r.get("url"))
        if course:
            picks.append(
                {
                    "title": course.get("title"),
                    "rating": course.get("rating"),
                    "review_count": course.get("reviewCount") or course.get("review_count"),
                    "why": r.get("why"),
                }
            )

    llm = make_llm(temperature=FAST_TEMP)
    try:
        parsed = await ainvoke_json(
            llm,
            [
                {"role": "system", "content": _summary_prompt(topic_name, len(picks))},
                {
                    "role": "user",
                    "content": f"Curated courses:\n{json.dumps(picks, ensure_ascii=False)}",
                },
            ],
        )
    except Exception:
        # Summary is best-effort — never fail the graph because the LLM
        # returned something un-parseable.
        return {"summary": ""}
    summary = ""
    if isinstance(parsed, dict):
        summary = str(parsed.get("summary") or "").strip()
    return {"summary": summary}


def build_graph(checkpointer: Any = None) -> Any:
    builder = StateGraph(FetchCoursesState)
    builder.add_node("rank", rank_node)
    builder.add_node("summarize", summarize_node)
    builder.add_edge(START, "rank")
    builder.add_edge("rank", "summarize")
    builder.add_edge("summarize", END)
    return builder.compile(checkpointer=checkpointer)


graph = build_graph()
