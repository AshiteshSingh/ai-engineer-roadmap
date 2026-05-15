"""Memorize-generate graph: build flashcard categories from a filtered tech stack.

Input:
    company: employer name (for interview context)
    position: target role
    techs: [{tag, label, category, relevance}] — already filtered by Next.js
           (dismissed tags removed)

Output:
    categories: [{id, name, icon, color, items: [...]}]

Per-tech fan-out with asyncio.gather: each tech gets its own LLM call (8 items
for primary relevance, 4 for secondary), then items are grouped back into
categories matching the frontend's MemorizeCategory shape. Ports
apps/knowledge/lib/memorize-generator.ts 1:1.
"""

from __future__ import annotations

import asyncio
import re
from typing import Any

from langgraph.graph import END, START, StateGraph

from .llm import ainvoke_json, make_llm
from .state import MemorizeGenerateState

CATEGORY_ICONS: dict[str, str] = {
    "Databases & Storage": "db",
    "Backend Frameworks": "server",
    "Frontend Frameworks": "layout",
    "Cloud & DevOps": "cloud",
    "Languages": "code",
    "Testing & Quality": "check",
    "API & Communication": "plug",
}

CATEGORY_COLORS: dict[str, str] = {
    "Databases & Storage": "cyan",
    "Backend Frameworks": "green",
    "Frontend Frameworks": "violet",
    "Cloud & DevOps": "blue",
    "Languages": "orange",
    "Testing & Quality": "red",
    "API & Communication": "indigo",
}


def _category_id(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def _item_prompt(tech: dict[str, Any], position: str, company: str, count: int) -> str:
    return (
        f'Generate exactly {count} flashcard-style memorization items for a software '
        f'engineer preparing for a "{position}" interview at {company}.\n\n'
        f"Technology: {tech['label']} (category: {tech['category']})\n\n"
        "For each item, produce a JSON object with these fields:\n"
        '- "id": kebab-case identifier (e.g., "use-effect-cleanup")\n'
        '- "term": the concept name (e.g., "useEffect Cleanup")\n'
        '- "description": 1-2 sentence explanation\n'
        '- "details": array of {"label": string, "description": string} pairs — '
        "key syntax points, gotchas, or patterns (3-5 per item)\n"
        '- "context": when/why this matters in interviews (1 sentence)\n'
        '- "relatedItems": array of related concept ids (can be empty)\n'
        '- "mnemonicHint": a short memory aid (1 sentence)\n\n'
        "Focus on concepts commonly asked in technical interviews: core APIs, common "
        "patterns, gotchas, performance considerations, best practices.\n\n"
        'Return ONLY valid JSON: { "items": [...] }\n'
        "No markdown fences, no explanation — just the JSON object."
    )


async def _gen_items_for_tech(
    llm, tech: dict[str, Any], position: str, company: str, count: int
) -> list[dict[str, Any]]:
    try:
        parsed = await ainvoke_json(
            llm,
            [
                {
                    "role": "system",
                    "content": "You are a technical interview preparation expert. Return only valid JSON, no markdown.",
                },
                {"role": "user", "content": _item_prompt(tech, position, company, count)},
            ],
        )
    except Exception:
        return []

    raw_items = parsed.get("items") if isinstance(parsed, dict) else []
    if not isinstance(raw_items, list):
        return []

    cleaned: list[dict[str, Any]] = []
    for item in raw_items:
        if not isinstance(item, dict):
            continue
        item_id = str(item.get("id") or "").strip()
        term = str(item.get("term") or "").strip()
        if not item_id or not term:
            continue
        details_raw = item.get("details") or []
        details = [
            {"label": str(d.get("label", "")), "description": str(d.get("description", ""))}
            for d in details_raw
            if isinstance(d, dict)
        ]
        related = [str(r) for r in (item.get("relatedItems") or []) if r]
        cleaned.append(
            {
                "id": f"{tech['tag']}-{item_id}",
                "term": term,
                "description": str(item.get("description") or ""),
                "details": details,
                "context": str(item.get("context") or ""),
                "relatedItems": related,
                "mnemonicHint": str(item.get("mnemonicHint") or ""),
            }
        )
    return cleaned


async def run(state: MemorizeGenerateState) -> dict:
    techs = state.get("techs") or []
    if not techs:
        return {"categories": []}

    company = (state.get("company") or "").strip()
    position = (state.get("position") or "").strip()

    llm = make_llm()

    async def _one(t: dict[str, Any]) -> tuple[dict[str, Any], list[dict[str, Any]]]:
        count = 8 if t.get("relevance") == "primary" else 4
        items = await _gen_items_for_tech(llm, t, position, company, count)
        return t, items

    results = await asyncio.gather(*(_one(t) for t in techs))

    # Group by category, preserving first-seen ordering.
    grouped: dict[str, list[dict[str, Any]]] = {}
    for tech, items in results:
        if not items:
            continue
        cat = tech["category"]
        grouped.setdefault(cat, []).extend(items)

    categories: list[dict[str, Any]] = []
    for cat_name, items in grouped.items():
        if not items:
            continue
        categories.append(
            {
                "id": _category_id(cat_name),
                "name": cat_name,
                "icon": CATEGORY_ICONS.get(cat_name, "code"),
                "color": CATEGORY_COLORS.get(cat_name, "gray"),
                "items": items,
            }
        )
    return {"categories": categories}


def build_graph(checkpointer: Any = None) -> Any:
    builder = StateGraph(MemorizeGenerateState)
    builder.add_node("run", run)
    builder.add_edge(START, "run")
    builder.add_edge("run", END)
    return builder.compile(checkpointer=checkpointer)


graph = build_graph()
