"""Chat graph: tutor-style RAG answer.

Input:
    message: the user's question
    history: prior chat history [{role, content}] (already loaded by Next.js)
    context_snippets: pre-retrieved RAG excerpts from the Next.js search layer

Output:
    response: assistant reply text

Retrieval stays in Next.js (SQLite FTS + vector search) — the graph only does
the LLM call. This keeps the container stateless about content and avoids
bundling the content DB.
"""

from __future__ import annotations

from typing import Any

from langgraph.graph import END, START, StateGraph

from .llm import make_llm
from .state import ChatState

SYSTEM = (
    "You are an AI engineering tutor for a knowledge base covering transformers, "
    "RAG, agents, fine-tuning, evaluations, infrastructure, safety, and multimodal AI. "
    "Answer questions concisely and accurately. Cite specific architectures or lesson "
    "topics when relevant. When context excerpts are provided, base your answer on "
    "them and cite the lesson title. If a question is outside AI/ML engineering, "
    "politely redirect the conversation back to the subject matter."
)


async def generate(state: ChatState) -> dict:
    message = (state.get("message") or "").strip()
    if not message:
        return {"response": ""}

    history = state.get("history") or []
    snippets = state.get("context_snippets") or []

    system = SYSTEM
    if snippets:
        joined = "\n\n---\n\n".join(snippets)
        system = f"{SYSTEM}\n\nRelevant knowledge base excerpts:\n{joined}"

    messages: list[dict[str, str]] = [{"role": "system", "content": system}]
    for m in history:
        role = m.get("role")
        content = m.get("content")
        if role and content:
            messages.append({"role": role, "content": content})
    messages.append({"role": "user", "content": message})

    llm = make_llm()
    resp = await llm.ainvoke(messages)
    return {"response": str(resp.content)}


def build_graph(checkpointer: Any = None) -> Any:
    builder = StateGraph(ChatState)
    builder.add_node("generate", generate)
    builder.add_edge(START, "generate")
    builder.add_edge("generate", END)
    return builder.compile(checkpointer=checkpointer)


graph = build_graph()
