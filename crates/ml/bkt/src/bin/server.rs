use axum::{routing::{get, post}, Json, Router};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use knowledge_bkt::bkt::{self, KnowledgeState, MasteryLevel};
use knowledge_bkt::scheduler::{self, ReviewSchedule};

// ---------------------------------------------------------------------------
// Request / response types
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct BktUpdateRequest {
    state: KnowledgeState,
    is_correct: bool,
}

#[derive(Deserialize)]
struct BktPredictRequest {
    state: KnowledgeState,
}

#[derive(Serialize)]
struct BktPredictResponse {
    p_correct: f32,
    mastery_level: MasteryLevel,
}

#[derive(Deserialize)]
struct ScheduleUpdateRequest {
    state: KnowledgeState,
    last_review: DateTime<Utc>,
    is_correct: bool,
    response_time_ms: u32,
}

#[derive(Deserialize)]
struct ScheduleDueRequest {
    schedules: Vec<ReviewSchedule>,
    now: DateTime<Utc>,
}

#[derive(Serialize)]
struct HealthResponse {
    status: &'static str,
    service: &'static str,
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async fn health() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok",
        service: "knowledge-bkt",
    })
}

async fn bkt_update(Json(req): Json<BktUpdateRequest>) -> Json<KnowledgeState> {
    let updated = bkt::update(&req.state, req.is_correct);
    Json(updated)
}

async fn bkt_predict(Json(req): Json<BktPredictRequest>) -> Json<BktPredictResponse> {
    let p_correct = bkt::predict_correct(&req.state);
    let mastery_level = bkt::mastery_level(req.state.p_mastery);
    Json(BktPredictResponse {
        p_correct,
        mastery_level,
    })
}

async fn schedule_update(Json(req): Json<ScheduleUpdateRequest>) -> Json<ReviewSchedule> {
    let schedule = scheduler::schedule_review(
        &req.state,
        req.last_review,
        req.is_correct,
        req.response_time_ms,
    );
    Json(schedule)
}

async fn schedule_due(Json(req): Json<ScheduleDueRequest>) -> Json<Vec<ReviewSchedule>> {
    let due = scheduler::get_due_reviews(&req.schedules, req.now);
    // Convert references to owned values for serialization.
    let owned: Vec<ReviewSchedule> = due.into_iter().cloned().collect();
    Json(owned)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info".into()),
        )
        .init();

    let app = Router::new()
        .route("/health", get(health))
        .route("/bkt/update", post(bkt_update))
        .route("/bkt/predict", post(bkt_predict))
        .route("/schedule/update", post(schedule_update))
        .route("/schedule/due", post(schedule_due));

    let listener = tokio::net::TcpListener::bind("0.0.0.0:9998")
        .await
        .expect("failed to bind to 0.0.0.0:9998");

    tracing::info!("knowledge-bkt listening on 0.0.0.0:9998");
    axum::serve(listener, app)
        .await
        .expect("server error");
}
