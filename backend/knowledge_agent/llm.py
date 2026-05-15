"""Shared LLM factory + JSON helpers for the knowledge graphs.

`make_llm()` reads LLM_BASE_URL / LLM_API_KEY / LLM_MODEL from env and returns
a ChatOpenAI client. DeepSeek is the production target; mlx_lm.server on :8080
works for local dev.
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from langchain_openai import ChatOpenAI

load_dotenv(Path(__file__).resolve().parent.parent / ".env")


def _is_local(base_url: str) -> bool:
    return "localhost" in base_url or "127.0.0.1" in base_url


def make_llm(temperature: float | None = None) -> ChatOpenAI:
    base_url = os.environ.get("LLM_BASE_URL", "https://api.deepseek.com")
    api_key = (
        os.environ.get("DEEPSEEK_API_KEY")
        or os.environ.get("LLM_API_KEY")
        or "local"
    )
    model = os.environ.get("LLM_MODEL", "deepseek-chat")
    temp = temperature if temperature is not None else float(
        os.environ.get("LLM_TEMPERATURE", "0.2")
    )
    return ChatOpenAI(model=model, api_key=api_key, base_url=base_url, temperature=temp)


def supports_json_mode() -> bool:
    base_url = os.environ.get("LLM_BASE_URL", "https://api.deepseek.com")
    return not _is_local(base_url)


async def ainvoke_json(llm: ChatOpenAI, messages: list[dict[str, str]]) -> Any:
    kwargs: dict[str, Any] = {}
    if supports_json_mode():
        kwargs["response_format"] = {"type": "json_object"}
    resp = await llm.ainvoke(messages, **kwargs)
    return _parse_json(resp.content)


def _parse_json(text: str) -> Any:
    text = text.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        text = "\n".join(lines).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"(\{.*\}|\[.*\])", text, re.DOTALL)
        if match:
            return json.loads(match.group(1))
        raise
