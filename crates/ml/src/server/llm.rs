//! DeepSeek chat-completion wrapper.
//!
//! Mirrors `backend/knowledge_agent/llm.py`: same env vars and defaults
//! (`deepseek-chat`, temperature `0.2`). A plain `ChatRequest` is sent — no
//! tools, no thinking/reasoning_effort — to match the Python `ChatOpenAI`
//! call (do not route through `deepseek::build_request`, which forces
//! thinking mode on).

use anyhow::Context;
use deepseek::{ChatMessage, ChatRequest, DeepSeekClient, HttpClient, ReqwestClient};

/// Resolved LLM configuration.
#[derive(Debug, Clone)]
pub struct LlmConfig {
    pub api_key: String,
    pub base_url: String,
    pub model: String,
    pub temperature: f64,
}

impl LlmConfig {
    /// Resolve from the environment, matching `llm.py` precedence.
    pub fn from_env() -> Self {
        let api_key = std::env::var("DEEPSEEK_API_KEY")
            .or_else(|_| std::env::var("LLM_API_KEY"))
            .unwrap_or_else(|_| "local".to_string());
        let base_url = std::env::var("LLM_BASE_URL")
            .or_else(|_| std::env::var("DEEPSEEK_BASE_URL"))
            .unwrap_or_else(|_| "https://api.deepseek.com/v1".to_string());
        let model = std::env::var("LLM_MODEL").unwrap_or_else(|_| "deepseek-chat".to_string());
        let temperature = std::env::var("LLM_TEMPERATURE")
            .ok()
            .and_then(|s| s.parse::<f64>().ok())
            .unwrap_or(0.2);
        Self {
            api_key,
            base_url,
            model,
            temperature,
        }
    }
}

/// Build the production (reqwest) DeepSeek client for a config.
pub fn reqwest_client(cfg: &LlmConfig) -> DeepSeekClient<ReqwestClient> {
    DeepSeekClient::new(ReqwestClient::new(), cfg.api_key.clone())
        .with_base_url(cfg.base_url.clone())
}

/// One non-streaming chat completion. Generic over the transport so tests can
/// inject a fake `HttpClient`.
pub async fn complete<H: HttpClient>(
    client: &DeepSeekClient<H>,
    model: &str,
    temperature: f64,
    messages: Vec<ChatMessage>,
) -> anyhow::Result<String> {
    let request = ChatRequest {
        model: model.to_string(),
        messages,
        tools: None,
        tool_choice: None,
        temperature: Some(temperature),
        max_tokens: None,
        stream: Some(false),
        reasoning_effort: None,
        thinking: None,
    };

    let resp = client
        .chat(&request)
        .await
        .map_err(|e| anyhow::anyhow!("deepseek chat failed: {e}"))?;

    let text = resp
        .choices
        .first()
        .map(|c| c.message.content.as_str().to_string())
        .context("deepseek returned no choices")?;
    Ok(text)
}

#[cfg(test)]
mod tests {
    use super::*;
    use async_trait::async_trait;
    use deepseek::{ChatContent, ChatResponse, Choice};

    #[derive(Clone)]
    struct FakeHttp {
        reply: String,
    }

    #[async_trait]
    impl HttpClient for FakeHttp {
        async fn post_json(
            &self,
            _url: &str,
            _bearer: &str,
            body: &ChatRequest,
        ) -> deepseek::Result<ChatResponse> {
            // Echo a deterministic reply; assert the request shape is plain.
            assert!(body.tools.is_none());
            assert!(body.thinking.is_none());
            assert!(body.reasoning_effort.is_none());
            assert_eq!(body.stream, Some(false));
            Ok(ChatResponse {
                id: "fake".into(),
                choices: vec![Choice {
                    index: 0,
                    message: ChatMessage {
                        role: "assistant".into(),
                        content: ChatContent::Text(self.reply.clone()),
                        reasoning_content: None,
                        tool_calls: None,
                        tool_call_id: None,
                        name: None,
                    },
                    finish_reason: Some("stop".into()),
                }],
                usage: None,
            })
        }
    }

    #[tokio::test]
    async fn complete_returns_first_choice_text() {
        let client = DeepSeekClient::new(
            FakeHttp {
                reply: "RAG retrieves context before generation.".into(),
            },
            "test-key",
        );
        let out = complete(
            &client,
            "deepseek-chat",
            0.2,
            vec![deepseek::user_msg("what is rag?")],
        )
        .await
        .unwrap();
        assert_eq!(out, "RAG retrieves context before generation.");
    }
}
