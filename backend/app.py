"""FastAPI harness for the knowledge-app LangGraph graphs.

Mirrors apps/lead-gen/backend/app.py. Deploys to Cloudflare Containers and uses
Neon Postgres as the AsyncPostgresSaver checkpointer so threads persist across
the container's sleep/wake cycle. Bearer-token middleware gates non-public
paths when ``LANGGRAPH_AUTH_TOKEN`` is set.

Endpoints:
    GET  /health    — cheap liveness; does not touch DB/LLM
    POST /runs/wait — {assistant_id, input, thread_id?} → final graph state

``/runs/wait`` matches the shape the Next.js client in
``apps/knowledge/src/lib/langgraph-client.ts`` sends, so flipping
``LANGGRAPH_URL`` at the client is the only change needed to cut over.

Tests: ``create_app(graphs=...)`` skips the Postgres-dependent lifespan so
TestClient runs can inject stub graphs.
"""

from __future__ import annotations

import logging
import os
import uuid
from contextlib import asynccontextmanager
from typing import Any, Mapping

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from langgraph_checkpoint_cloudflare_d1 import AsyncCloudflareD1Saver
from pydantic import BaseModel
from starlette.middleware.base import BaseHTTPMiddleware

from knowledge_agent.app_prep_graph import build_graph as build_app_prep
from knowledge_agent.article_generate_graph import build_graph as build_article_generate
from knowledge_agent.chat_graph import build_graph as build_chat
from knowledge_agent.course_review_graph import build_graph as build_course_review
from knowledge_agent.fetch_courses_graph import build_graph as build_fetch_courses
from knowledge_agent.memorize_generate_graph import build_graph as build_memorize_generate

log = logging.getLogger("knowledge_agent")

_PUBLIC_PATHS = frozenset({"/health", "/ok"})


class BearerTokenMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        expected = os.environ.get("LANGGRAPH_AUTH_TOKEN")
        if not expected or request.url.path in _PUBLIC_PATHS:
            return await call_next(request)
        auth = request.headers.get("authorization", "")
        scheme, _, token = auth.partition(" ")
        if scheme.lower() != "bearer" or token != expected:
            return JSONResponse({"detail": "Unauthorized"}, status_code=401)
        return await call_next(request)


class RunRequest(BaseModel):
    assistant_id: str
    input: dict[str, Any]
    thread_id: str | None = None


@asynccontextmanager
async def _prod_lifespan(app: FastAPI):
    account_id = os.environ.get("CLOUDFLARE_ACCOUNT_ID", "").strip()
    database_id = os.environ.get("CHECKPOINTER_D1_DATABASE_ID", "").strip()
    api_token = os.environ.get("CLOUDFLARE_API_TOKEN", "").strip()
    if not (account_id and database_id and api_token):
        raise RuntimeError(
            "CLOUDFLARE_ACCOUNT_ID, CHECKPOINTER_D1_DATABASE_ID and "
            "CLOUDFLARE_API_TOKEN env vars are required for the D1 checkpointer."
        )

    async with AsyncCloudflareD1Saver.from_connection_params(
        account_id=account_id,
        database_id=database_id,
        api_token=api_token,
    ) as checkpointer:
        await checkpointer.setup()
        app.state.graphs = {
            "chat": build_chat(checkpointer),
            "app_prep": build_app_prep(checkpointer),
            "memorize_generate": build_memorize_generate(checkpointer),
            "article_generate": build_article_generate(checkpointer),
            "course_review": build_course_review(checkpointer),
            "fetch_courses": build_fetch_courses(checkpointer),
        }
        log.info("Graphs compiled: %s", list(app.state.graphs))
        yield


def create_app(
    graphs: Mapping[str, Any] | None = None,
    *,
    use_prod_lifespan: bool = True,
) -> FastAPI:
    """Factory so tests can bypass the Postgres-dependent lifespan.

    - Production: ``create_app()`` — attaches the real lifespan that compiles
      the 5 graphs with ``AsyncPostgresSaver``.
    - Tests: ``create_app(graphs={"chat": stub}, use_prod_lifespan=False)`` —
      pre-populates ``app.state.graphs`` so TestClient can dispatch without
      touching Postgres or any LLM.
    """
    lifespan = _prod_lifespan if use_prod_lifespan else None
    app = FastAPI(title="knowledge LangGraph", lifespan=lifespan)
    app.add_middleware(BearerTokenMiddleware)

    if graphs is not None:
        app.state.graphs = dict(graphs)

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.post("/runs/wait")
    async def runs_wait(req: RunRequest) -> dict[str, Any]:
        graphs_dict = getattr(app.state, "graphs", {})
        graph = graphs_dict.get(req.assistant_id)
        if graph is None:
            raise HTTPException(
                status_code=404, detail=f"Unknown assistant_id: {req.assistant_id}"
            )
        thread_id = req.thread_id or str(uuid.uuid4())
        config: dict[str, Any] = {"configurable": {"thread_id": thread_id}}
        return await graph.ainvoke(req.input, config=config)

    return app


app = create_app()
