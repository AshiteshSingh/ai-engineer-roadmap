//! Rust ports of the five non-`chat` LangGraph graphs from
//! `backend/knowledge_agent/`. Together with the existing RAG `chat` path this
//! makes the Rust server a full drop-in for the Python FastAPI backend.
//!
//! Parity contract: the Python `/runs/wait` returns `graph.ainvoke(input)`,
//! which is LangGraph's **fully-merged final state** — the input dict with
//! every node's returned partial state layered on top. Each `run` here returns
//! that same merged object so the Next.js client and seeding scripts see an
//! identical wire shape.
//!
//! No checkpointer: every ported graph is invoked with a fresh thread id and
//! `resumable=False`, so the Python service already discards its checkpoints.
//! These graphs are pure LLM orchestration — only `chat` touches
//! SQLite/LanceDB, and that retrieval layer is unchanged.

pub mod app_prep;
pub mod article;
pub mod course_review;
pub mod course_review_prompts;
pub mod fetch_courses;
pub mod memorize;

use deepseek::{ChatContent, ChatMessage, DeepSeekClient, HttpClient};
use serde_json::{Map, Value};

use crate::server::json::parse_loose;
use crate::server::llm;

/// Graphs ported into the Rust backend (everything the Python service serves
/// except `chat`, which the binary handles directly with the RAG retriever).
pub const PORTED_GRAPHS: &[&str] = &[
    "app_prep",
    "memorize_generate",
    "article_generate",
    "course_review",
    "fetch_courses",
];

/// Build a role-tagged chat message (DeepSeek wire shape).
pub fn msg(role: &str, content: impl Into<String>) -> ChatMessage {
    ChatMessage {
        role: role.to_string(),
        content: ChatContent::Text(content.into()),
        reasoning_content: None,
        tool_calls: None,
        tool_call_id: None,
        name: None,
    }
}

/// One plain chat completion (mirrors `llm.py::make_llm().ainvoke`).
pub async fn ask<H: HttpClient>(
    client: &DeepSeekClient<H>,
    model: &str,
    temperature: f64,
    messages: Vec<ChatMessage>,
) -> anyhow::Result<String> {
    llm::complete(client, model, temperature, messages).await
}

/// Completion + loose JSON parse (mirrors `llm.py::ainvoke_json`).
pub async fn ask_json<H: HttpClient>(
    client: &DeepSeekClient<H>,
    model: &str,
    temperature: f64,
    messages: Vec<ChatMessage>,
) -> anyhow::Result<Value> {
    let text = llm::complete(client, model, temperature, messages).await?;
    parse_loose(&text)
}

/// Coerce an arbitrary input `Value` to an object (LangGraph state is a dict;
/// a null/non-object body behaves like an empty dict).
pub fn as_object(input: Value) -> Map<String, Value> {
    match input {
        Value::Object(m) => m,
        _ => Map::new(),
    }
}

/// `state.get(key)` as a trimmed `&str`, empty string when absent/non-string.
pub fn str_field<'a>(state: &'a Map<String, Value>, key: &str) -> &'a str {
    state.get(key).and_then(Value::as_str).unwrap_or("").trim()
}

/// LangGraph state merge: start from the input dict, layer node outputs on top
/// (later writes win), preserving input keys the nodes didn't touch.
pub fn merge(mut state: Map<String, Value>, updates: Vec<(&str, Value)>) -> Value {
    for (k, v) in updates {
        state.insert(k.to_string(), v);
    }
    Value::Object(state)
}

/// Dispatch a ported graph by `assistant_id`. `default_temp` is the configured
/// `LLM_TEMPERATURE` (Python `make_llm()` with no explicit temperature).
pub async fn dispatch<H: HttpClient>(
    assistant_id: &str,
    input: Value,
    client: &DeepSeekClient<H>,
    model: &str,
    default_temp: f64,
) -> anyhow::Result<Value> {
    match assistant_id {
        "app_prep" => app_prep::run(input, client, model, default_temp).await,
        "memorize_generate" => memorize::run(input, client, model, default_temp).await,
        "article_generate" => article::run(input, client, model, default_temp).await,
        "course_review" => course_review::run(input, client, model).await,
        "fetch_courses" => fetch_courses::run(input, client, model).await,
        other => Err(anyhow::anyhow!("unknown assistant_id '{other}'")),
    }
}
