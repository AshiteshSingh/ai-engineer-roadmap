//! Local Rust LangGraph backend — drop-in for the Python FastAPI service.
//!
//!   cd crates/ml && cargo run -p knowledge-ml-langgraph-server \
//!       --release --bin langgraph-server
//!
//! Env: LANGGRAPH_AUTH_TOKEN, DEEPSEEK_API_KEY / LLM_* , EMBED_URL,
//! KNOWLEDGE_DB, LANCEDB_PATH, PORT (default 7860).

use std::sync::Arc;

use axum::{
    extract::State,
    http::{header::AUTHORIZATION, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use deepseek::{DeepSeekClient, ReqwestClient};
use serde_json::json;
use tracing_subscriber::EnvFilter;

use knowledge_ml_langgraph_server::{
    build_chat_messages, graphs, llm, parse_chat_input, retrieval::Retriever, ChatInput,
    RunRequest,
};

struct AppState {
    retriever: Retriever,
    llm: DeepSeekClient<ReqwestClient>,
    model: String,
    temperature: f64,
    auth_token: Option<String>,
}

// ── Error → JSON {"detail": ...} (FastAPI-shaped) ─────────────────────────

struct AppError {
    status: StatusCode,
    detail: String,
}

impl AppError {
    fn unauthorized() -> Self {
        Self {
            status: StatusCode::UNAUTHORIZED,
            detail: "Unauthorized".into(),
        }
    }
    fn bad_request(detail: impl Into<String>) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            detail: detail.into(),
        }
    }
    fn bad_gateway(detail: impl Into<String>) -> Self {
        Self {
            status: StatusCode::BAD_GATEWAY,
            detail: detail.into(),
        }
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        (self.status, Json(json!({ "detail": self.detail }))).into_response()
    }
}

// ── Handlers ──────────────────────────────────────────────────────────────

async fn health() -> Json<serde_json::Value> {
    Json(json!({ "status": "ok", "service": "knowledge-ml-langgraph-server" }))
}

fn check_auth(state: &AppState, headers: &HeaderMap) -> Result<(), AppError> {
    let Some(expected) = state.auth_token.as_deref() else {
        return Ok(()); // auth disabled when env unset
    };
    let got = headers
        .get(AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default();
    if got == format!("Bearer {expected}") {
        Ok(())
    } else {
        Err(AppError::unauthorized())
    }
}

async fn runs_wait(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(req): Json<RunRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    check_auth(&state, &headers)?;

    match req.assistant_id.as_str() {
        "chat" => {
            let input = parse_chat_input(req.input)
                .map_err(|e| AppError::bad_request(format!("invalid chat input: {e}")))?;

            // Parity with chat_graph.py: empty message → empty response.
            if input.message.trim().is_empty() {
                return Ok(Json(json!({ "response": "" })));
            }

            let snippets = state
                .retriever
                .retrieve(input.message.trim(), &input.context_snippets)
                .await;
            let merged = ChatInput {
                message: input.message.clone(),
                history: input.history.clone(),
                context_snippets: snippets,
            };
            let messages = build_chat_messages(&merged);

            let text = llm::complete(&state.llm, &state.model, state.temperature, messages)
                .await
                .map_err(|e| AppError::bad_gateway(format!("chat generation failed: {e}")))?;

            Ok(Json(json!({ "response": text })))
        }
        id if graphs::PORTED_GRAPHS.contains(&id) => {
            // Ported graphs return LangGraph's fully-merged final state.
            // `state.temperature` is the configured LLM_TEMPERATURE — the
            // default for graphs whose Python uses `make_llm()` with no
            // explicit temperature (course_review/fetch_courses set their own).
            let out = graphs::dispatch(
                id,
                req.input,
                &state.llm,
                &state.model,
                state.temperature,
            )
            .await
            .map_err(|e| AppError::bad_gateway(format!("{id} failed: {e}")))?;
            Ok(Json(out))
        }
        other => Err(AppError::bad_request(format!(
            "unknown assistant_id '{other}'"
        ))),
    }
}

// ── Main ──────────────────────────────────────────────────────────────────

fn env_or(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_string())
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .init();

    let cfg = llm::LlmConfig::from_env();
    let db_path = env_or("KNOWLEDGE_DB", "../../data/knowledge.db");
    let lancedb_path = env_or("LANCEDB_PATH", "../../data/lancedb");
    let embed_url = env_or("EMBED_URL", "http://localhost:9999");
    let port = env_or("PORT", "7860");
    let auth_token = std::env::var("LANGGRAPH_AUTH_TOKEN").ok().filter(|t| !t.is_empty());

    if auth_token.is_none() {
        tracing::warn!("LANGGRAPH_AUTH_TOKEN unset — /runs/wait is unauthenticated");
    }
    tracing::info!(
        "llm: model={} base={} temp={}",
        cfg.model,
        cfg.base_url,
        cfg.temperature
    );

    let retriever = Retriever::new(&db_path, &lancedb_path, embed_url.clone()).await?;
    let state = Arc::new(AppState {
        retriever,
        llm: llm::reqwest_client(&cfg),
        model: cfg.model.clone(),
        temperature: cfg.temperature,
        auth_token,
    });

    let app = Router::new()
        .route("/health", get(health))
        .route("/ok", get(health))
        .route("/runs/wait", post(runs_wait))
        .with_state(state);

    let addr = format!("0.0.0.0:{port}");
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .map_err(|e| anyhow::anyhow!("bind {addr}: {e}"))?;
    tracing::info!("langgraph-server listening on {addr} (db={db_path}, lancedb={lancedb_path})");
    axum::serve(listener, app).await?;
    Ok(())
}
