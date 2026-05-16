//! Local Rust replacement for the Python FastAPI LangGraph backend — now a
//! full drop-in, not just `chat`.
//!
//! Honors the exact wire contract that `src/lib/langgraph-client.ts` calls:
//! `POST /runs/wait` with `{ assistant_id, input, thread_id? }`. All six
//! graphs the Python service exposes are implemented:
//!
//! - `chat` — RAG retrieval over SQLite + LanceDB → one DeepSeek call (here).
//! - `app_prep`, `memorize_generate`, `article_generate`, `course_review`,
//!   `fetch_courses` — pure LLM orchestration ports in [`graphs`], returning
//!   LangGraph's fully-merged final-state object so callers see an identical
//!   wire shape.
//!
//! Stateless: chat `history` is supplied by the caller (Next.js reads it from
//! Postgres in `app/api/chat/route.ts`); the other graphs run with a fresh
//! thread id (`resumable=False` in Python), so there is no checkpointer.

pub mod graphs;
pub mod json;
pub mod llm;
pub mod retrieval;
pub mod store;

use serde::{Deserialize, Serialize};

/// System prompt — kept verbatim in sync with
/// `backend/knowledge_agent/chat_graph.py::SYSTEM`.
pub const SYSTEM_PROMPT: &str = "You are an AI engineering tutor for a knowledge base covering transformers, RAG, agents, fine-tuning, evaluations, infrastructure, safety, and multimodal AI. Answer questions concisely and accurately. Cite specific architectures or lesson topics when relevant. When context excerpts are provided, base your answer on them and cite the lesson title. If a question is outside AI/ML engineering, politely redirect the conversation back to the subject matter.";

/// Body of `POST /runs/wait`.
#[derive(Debug, Deserialize)]
pub struct RunRequest {
    pub assistant_id: String,
    #[serde(default)]
    pub input: serde_json::Value,
    #[serde(default)]
    pub thread_id: Option<String>,
}

/// `chat` graph input.
#[derive(Debug, Default, Clone, Deserialize)]
pub struct ChatInput {
    #[serde(default)]
    pub message: String,
    #[serde(default)]
    pub history: Vec<HistoryMsg>,
    #[serde(default)]
    pub context_snippets: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct HistoryMsg {
    pub role: String,
    pub content: String,
}

/// `chat` graph output.
#[derive(Debug, Serialize)]
pub struct ChatOutput {
    pub response: String,
}

/// Parse `RunRequest.input` into a `ChatInput`, tolerating a null/absent body.
pub fn parse_chat_input(input: serde_json::Value) -> Result<ChatInput, serde_json::Error> {
    if input.is_null() {
        return Ok(ChatInput::default());
    }
    serde_json::from_value(input)
}

/// Build the `system + history + user` message list exactly like
/// `chat_graph.py::generate` (same snippet join, same role filtering).
pub fn build_chat_messages(input: &ChatInput) -> Vec<deepseek::ChatMessage> {
    let system = if input.context_snippets.is_empty() {
        SYSTEM_PROMPT.to_string()
    } else {
        let joined = input.context_snippets.join("\n\n---\n\n");
        format!("{SYSTEM_PROMPT}\n\nRelevant knowledge base excerpts:\n{joined}")
    };

    let mut messages = vec![deepseek::system_msg(&system)];
    for m in &input.history {
        if m.role.is_empty() || m.content.is_empty() {
            continue;
        }
        messages.push(deepseek::ChatMessage {
            role: m.role.clone(),
            content: deepseek::ChatContent::Text(m.content.clone()),
            reasoning_content: None,
            tool_calls: None,
            tool_call_id: None,
            name: None,
        });
    }
    messages.push(deepseek::user_msg(&input.message));
    messages
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_null_input_yields_default() {
        let ci = parse_chat_input(serde_json::Value::Null).unwrap();
        assert!(ci.message.is_empty());
        assert!(ci.history.is_empty());
        assert!(ci.context_snippets.is_empty());
    }

    #[test]
    fn parse_partial_input_defaults_missing_fields() {
        let ci = parse_chat_input(serde_json::json!({ "message": "hi" })).unwrap();
        assert_eq!(ci.message, "hi");
        assert!(ci.history.is_empty());
    }

    #[test]
    fn messages_without_snippets_use_bare_system_prompt() {
        let input = ChatInput {
            message: "what is rag?".into(),
            ..Default::default()
        };
        let msgs = build_chat_messages(&input);
        assert_eq!(msgs.len(), 2);
        assert_eq!(msgs[0].role, "system");
        assert_eq!(msgs[0].content.as_str(), SYSTEM_PROMPT);
        assert_eq!(msgs[1].role, "user");
        assert_eq!(msgs[1].content.as_str(), "what is rag?");
    }

    #[test]
    fn messages_with_snippets_append_excerpts_and_filter_history() {
        let input = ChatInput {
            message: "q".into(),
            history: vec![
                HistoryMsg { role: "user".into(), content: "prev".into() },
                HistoryMsg { role: "".into(), content: "dropped".into() },
                HistoryMsg { role: "assistant".into(), content: "".into() },
            ],
            context_snippets: vec!["[A > B]\nbody1".into(), "[C > D]\nbody2".into()],
        };
        let msgs = build_chat_messages(&input);
        // system + 1 valid history + user
        assert_eq!(msgs.len(), 3);
        assert!(msgs[0]
            .content
            .as_str()
            .contains("Relevant knowledge base excerpts:"));
        // Snippets are joined whole, separated by the chat_graph.py separator.
        assert!(msgs[0]
            .content
            .as_str()
            .contains("[A > B]\nbody1\n\n---\n\n[C > D]\nbody2"));
        assert_eq!(msgs[1].content.as_str(), "prev");
        assert_eq!(msgs[2].role, "user");
    }

    #[test]
    fn ported_graphs_cover_all_non_chat_assistants() {
        for id in [
            "app_prep",
            "memorize_generate",
            "article_generate",
            "course_review",
            "fetch_courses",
        ] {
            assert!(graphs::PORTED_GRAPHS.contains(&id));
        }
        assert!(!graphs::PORTED_GRAPHS.contains(&"chat"));
    }
}
