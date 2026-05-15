"""Pytest fixtures for the knowledge backend.

Tests never touch real Postgres or real LLM endpoints. Each graph is
represented by a stub callable that returns canned state, and the FastAPI
app is created via ``create_app(use_prod_lifespan=False)`` so the
Postgres-dependent lifespan is bypassed.
"""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient

from app import create_app


class StubGraph:
    """Mimics the ``compile()``-d LangGraph surface used by ``runs_wait``.

    Captures the last ``ainvoke`` call so tests can assert on input+config.
    """

    def __init__(self, response: dict[str, Any] | None = None):
        self._response = response or {"ok": True}
        self.last_input: dict[str, Any] | None = None
        self.last_config: dict[str, Any] | None = None

    async def ainvoke(self, input: dict[str, Any], config: dict[str, Any]) -> dict[str, Any]:
        self.last_input = input
        self.last_config = config
        return self._response


@pytest.fixture
def chat_stub() -> StubGraph:
    return StubGraph({"response": "stubbed chat reply"})


@pytest.fixture
def course_review_stub() -> StubGraph:
    return StubGraph(
        {
            "aggregate_score": 7.8,
            "verdict": "recommended",
            "summary": "stubbed review",
            "top_strengths": ["a", "b"],
            "key_weaknesses": ["c"],
        }
    )


@pytest.fixture
def test_app(chat_stub: StubGraph, course_review_stub: StubGraph):
    return create_app(
        graphs={"chat": chat_stub, "course_review": course_review_stub},
        use_prod_lifespan=False,
    )


@pytest.fixture
def client(test_app) -> TestClient:
    return TestClient(test_app)


@pytest.fixture
def authed_client(test_app, monkeypatch) -> TestClient:
    """TestClient that pre-sets a bearer token both on the server + client."""
    monkeypatch.setenv("LANGGRAPH_AUTH_TOKEN", "test-token-abc")
    c = TestClient(test_app)
    c.headers.update({"Authorization": "Bearer test-token-abc"})
    return c


@pytest.fixture
def unauthed_token_env(monkeypatch) -> None:
    """Sets LANGGRAPH_AUTH_TOKEN but the client does not present it."""
    monkeypatch.setenv("LANGGRAPH_AUTH_TOKEN", "test-token-abc")
