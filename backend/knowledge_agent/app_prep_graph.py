"""App-prep graph: derive interview questions + tech stack from a job description.

Input:
    job_description: the raw JD text
    company: optional, improves question specificity
    position: optional, improves question specificity

Output:
    tech_stack: [{tag, label, category, relevance}]
    interview_questions: markdown string

This replaces the dead `graph.cli app-prep` Python CLI that the Next.js prep
route used to spawn as a subprocess before the 2026-04-20 Python cleanup.

Two LLM calls, run in parallel via asyncio.gather. Categories match those
used by the memorize generator so downstream flashcards render with the
right icon/color.
"""

from __future__ import annotations

import asyncio
from typing import Any

from langgraph.graph import END, START, StateGraph

from .llm import ainvoke_json, make_llm
from .state import AppPrepState

CATEGORIES = [
    "Databases & Storage",
    "Backend Frameworks",
    "Frontend Frameworks",
    "Cloud & DevOps",
    "Languages",
    "Testing & Quality",
    "API & Communication",
]

TECH_STACK_INSTRUCTION = (
    "Extract the tech stack mentioned or implied in the job description below. "
    "Return JSON only: { \"techs\": [{\"tag\": \"react\", \"label\": \"React\", "
    "\"category\": \"Frontend Frameworks\", \"relevance\": \"primary\"}, ...] }\n\n"
    "Rules:\n"
    "- tag: lowercase kebab-case identifier (e.g., 'react', 'postgres', 'aws-lambda')\n"
    "- label: human-readable name (e.g., 'React', 'PostgreSQL', 'AWS Lambda')\n"
    f"- category: one of {CATEGORIES}\n"
    "- relevance: 'primary' for core required tech, 'secondary' for nice-to-haves\n"
    "- Aim for 8-15 items. Merge synonyms (e.g., 'JS'+'JavaScript' → one entry).\n"
    "- Skip soft skills, seniority labels, and non-tech keywords."
)

INTERVIEW_INSTRUCTION = (
    "Generate a focused interview-prep document for the candidate, as GitHub-flavored "
    "markdown. Sections:\n"
    "1. **Technical screen likely topics** (bullet list, 6-10 items)\n"
    "2. **System design scenarios** (2-3 realistic prompts tailored to the role)\n"
    "3. **Behavioral themes** (4-6 bullets, drawing from the JD's stated values)\n"
    "4. **Questions to ask them** (5 thoughtful questions)\n\n"
    "Be specific to the tech and domain named in the JD. Don't pad — high signal only."
)


async def _gen_tech_stack(llm, company: str, position: str, jd: str) -> list[dict[str, Any]]:
    result = await ainvoke_json(
        llm,
        [
            {"role": "system", "content": TECH_STACK_INSTRUCTION},
            {
                "role": "user",
                "content": f"Company: {company}\nPosition: {position}\n\nJob description:\n{jd}",
            },
        ],
    )
    if isinstance(result, dict):
        techs = result.get("techs", [])
    else:
        techs = result if isinstance(result, list) else []
    cleaned: list[dict[str, Any]] = []
    for t in techs:
        if not isinstance(t, dict):
            continue
        tag = str(t.get("tag", "")).strip().lower()
        label = str(t.get("label", "")).strip()
        category = str(t.get("category", "")).strip()
        relevance = str(t.get("relevance", "secondary")).strip().lower()
        if not tag or not label or category not in CATEGORIES:
            continue
        if relevance not in ("primary", "secondary"):
            relevance = "secondary"
        cleaned.append({"tag": tag, "label": label, "category": category, "relevance": relevance})
    return cleaned


async def _gen_interview_questions(llm, company: str, position: str, jd: str) -> str:
    resp = await llm.ainvoke(
        [
            {"role": "system", "content": INTERVIEW_INSTRUCTION},
            {
                "role": "user",
                "content": f"Company: {company}\nPosition: {position}\n\nJob description:\n{jd}",
            },
        ]
    )
    return str(resp.content)


async def run(state: AppPrepState) -> dict:
    jd = (state.get("job_description") or "").strip()
    if not jd:
        return {"tech_stack": [], "interview_questions": ""}

    company = (state.get("company") or "").strip()
    position = (state.get("position") or "").strip()

    llm = make_llm()
    tech_stack, interview_questions = await asyncio.gather(
        _gen_tech_stack(llm, company, position, jd),
        _gen_interview_questions(llm, company, position, jd),
    )
    return {"tech_stack": tech_stack, "interview_questions": interview_questions}


def build_graph(checkpointer: Any = None) -> Any:
    builder = StateGraph(AppPrepState)
    builder.add_node("run", run)
    builder.add_edge(START, "run")
    builder.add_edge("run", END)
    return builder.compile(checkpointer=checkpointer)


graph = build_graph()
