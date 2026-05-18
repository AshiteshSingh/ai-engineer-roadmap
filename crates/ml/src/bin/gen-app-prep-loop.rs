//! `gen-app-prep-loop` — the full-Rust prep pipeline.
//!
//! 1. Runs a `deepseek-loop` agent **in-process** (`deepseek::run`) with only
//!    the builtin `Read`/`Write` tools: it reads `data/app-prep/<slug>.json`
//!    for the job description and rewrites the artifact's prep fields.
//! 2. Validates the regenerated artifact in Rust (4 `##` sections, tech-stack
//!    categories ∈ `app_prep::CATEGORIES`, relevance, JSON-string shape).
//! 3. Persists it into the Neon `applications` row over Postgres (sqlx).
//!
//! Replaces the old bash (`prep-loop.sh`) + tsx (`gen-app-prep-db.ts`) glue.
//!
//!   DEEPSEEK_API_KEY=… DATABASE_URL=… \
//!     cargo run -p aer-ml --release --bin gen-app-prep-loop -- \
//!       --slug european-central-bank-ssm-cockpit-developer
//!
//! Exits non-zero (and leaves Neon untouched) on agent failure or a bad
//! artifact.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use aer_ml::server::graphs::app_prep::CATEGORIES;
use anyhow::Context;
use clap::Parser;
use deepseek::agent::builtin_tools::{ReadTool, WriteTool};
use deepseek::types::EffortLevel;
use deepseek::{run, PermissionMode, ReqwestClient, RunOptions, SdkMessage, Tool};
use futures::StreamExt;
use serde_json::Value;
use sqlx::postgres::PgPoolOptions;
use sqlx::Row;
use tracing_subscriber::EnvFilter;

#[derive(Parser)]
#[command(name = "gen-app-prep-loop")]
struct Args {
    /// Application slug; `data/app-prep/<slug>.json` must already exist (it
    /// carries the job description the agent reads).
    #[arg(long, default_value = "european-central-bank-ssm-cockpit-developer")]
    slug: String,
    /// Disambiguate when several `applications` rows share the slug.
    #[arg(long)]
    user_id: Option<String>,
    /// Agent model.
    #[arg(long, default_value = "deepseek-v4-pro")]
    model: String,
    #[arg(long, default_value_t = 6)]
    max_turns: u32,
    #[arg(long, default_value_t = 0.30)]
    max_budget_usd: f64,
    /// Directory holding `<slug>.json` (relative to CWD or absolute).
    #[arg(long, default_value = "../../data/app-prep")]
    art_dir: PathBuf,
    /// Neon connection string (defaults to `$DATABASE_URL`).
    #[arg(long)]
    database_url: Option<String>,
    /// Regenerate + validate only; skip the Neon write.
    #[arg(long)]
    no_db: bool,
}

fn build_prompt(art_abs: &str) -> String {
    format!(
        "You are regenerating a job-application interview-prep artifact.\n\n\
1. Use the Read tool to read this exact file:\n   {art_abs}\n   It is JSON. \
Keep these fields EXACTLY as they are: slug, company, position, url, status, \
jobDescription.\n\n\
2. From its \"jobDescription\" (plus company/position), generate:\n\n\
   - \"aiInterviewQuestions\": GitHub-flavored Markdown, high-signal, specific \
to the JD. It MUST contain exactly these four level-2 headings, in order:\n\
       ## Technical screen likely topics\n\
       ## System design scenarios\n\
       ## Behavioral themes\n\
       ## Questions to ask them\n\
     (bulleted, concrete, no padding; ~6-10 technical topics, 2-3 \
system-design prompts, 4-6 behavioral themes, 5 questions). No top-level # H1.\n\n\
   - \"aiTechStack\": a JSON STRING (the array JSON-encoded as a string, NOT a \
nested array) of 8-20 objects, each {{\"tag\": kebab-case-id, \"label\": \
\"Human Name\", \"category\": one of EXACTLY \\\"Databases & Storage\\\" | \
\\\"Backend Frameworks\\\" | \\\"Frontend Frameworks\\\" | \\\"Cloud & \
DevOps\\\" | \\\"Languages\\\" | \\\"Testing & Quality\\\" | \\\"API & \
Communication\\\", \"relevance\": \"primary\" | \"secondary\"}}. Skip soft \
skills/seniority. Merge synonyms.\n\n\
3. Use the Write tool to overwrite {art_abs} with a single JSON object having \
EXACTLY these keys: slug, company, position, url, status, jobDescription, \
aiInterviewQuestions, aiTechStack, generatedAt\n\
   - slug/company/position/url/status/jobDescription: copied verbatim from \
step 1\n\
   - generatedAt: the current UTC time in ISO-8601 (e.g. 2026-05-18T12:34:56Z)\n\
   - valid JSON, UTF-8, no trailing prose.\n\n\
Do ONLY this. After the Write succeeds, stop."
    )
}

/// Read + strictly validate the artifact. Returns
/// `(jobDescription, aiInterviewQuestions, aiTechStack-json-string)`.
fn validate(path: &Path) -> anyhow::Result<(String, String, String)> {
    let raw = std::fs::read_to_string(path)
        .with_context(|| format!("reading {}", path.display()))?;
    let v: Value = serde_json::from_str(&raw).context("artifact is not valid JSON")?;

    let iq = v
        .get("aiInterviewQuestions")
        .and_then(Value::as_str)
        .unwrap_or("");
    anyhow::ensure!(
        iq.trim().chars().count() >= 200,
        "aiInterviewQuestions too short/empty ({} chars)",
        iq.trim().chars().count()
    );
    let sections = iq.lines().filter(|l| l.starts_with("## ")).count();
    anyhow::ensure!(sections >= 4, "expected ≥4 '## ' sections, found {sections}");

    let ts_raw = v
        .get("aiTechStack")
        .and_then(Value::as_str)
        .context("aiTechStack must be a JSON string")?;
    let arr = serde_json::from_str::<Value>(ts_raw)
        .context("aiTechStack is not parseable JSON")?;
    let arr = arr
        .as_array()
        .cloned()
        .filter(|a| !a.is_empty())
        .context("aiTechStack must parse to a non-empty array")?;
    for t in &arr {
        let tag = t.get("tag").and_then(Value::as_str).unwrap_or("");
        let label = t.get("label").and_then(Value::as_str).unwrap_or("");
        let cat = t.get("category").and_then(Value::as_str).unwrap_or("");
        let rel = t.get("relevance").and_then(Value::as_str).unwrap_or("");
        anyhow::ensure!(!tag.is_empty() && !label.is_empty(), "tech entry missing tag/label: {t}");
        anyhow::ensure!(CATEGORIES.contains(&cat), "invalid tech category: {cat:?}");
        anyhow::ensure!(rel == "primary" || rel == "secondary", "invalid relevance: {rel:?}");
    }

    let jd = v
        .get("jobDescription")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    Ok((jd, iq.to_string(), ts_raw.to_string()))
}

/// sqlx-postgres rejects libpq-only query params (e.g. `channel_binding`).
/// Neon needs TLS but channel binding is optional, so keep the base URL +
/// `sslmode=require`.
fn sanitize_pg_url(url: &str) -> String {
    match url.split_once('?') {
        Some((base, _)) => format!("{base}?sslmode=require"),
        None => url.to_string(),
    }
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| "warn,deepseek=info".into()),
        )
        .with_writer(std::io::stderr)
        .init();
    let args = Args::parse();

    let art_path = args.art_dir.join(format!("{}.json", args.slug));
    anyhow::ensure!(
        art_path.is_file(),
        "artifact {} not found — it carries the job description the agent reads",
        art_path.display()
    );
    let art_abs = std::fs::canonicalize(&art_path)?
        .to_string_lossy()
        .into_owned();

    let api_key = std::env::var("DEEPSEEK_API_KEY")
        .map_err(|_| anyhow::anyhow!("DEEPSEEK_API_KEY not set"))?;

    println!("==> deepseek-loop agent regenerating {art_abs}");
    let http = ReqwestClient::new();
    let tools: Arc<Vec<Box<dyn Tool>>> =
        Arc::new(vec![Box::new(ReadTool) as Box<dyn Tool>, Box::new(WriteTool)]);
    let opts = RunOptions::new(&args.model)
        .effort(EffortLevel::High)
        .permission_mode(PermissionMode::AcceptEdits)
        .max_turns(args.max_turns)
        .max_budget_usd(args.max_budget_usd)
        .allowed_tools(["Read", "Write"])
        .system_prompt(
            "You are a precise file-editing agent. Use only the Read and Write \
             tools. Do exactly what the user asks, then stop.",
        );

    let mut stream = Box::pin(run(http, api_key, tools, build_prompt(&art_abs), opts));
    let mut outcome = None;
    while let Some(msg) = stream.next().await {
        match msg {
            SdkMessage::Assistant { .. } | SdkMessage::User { .. } => eprint!("."),
            SdkMessage::Result {
                subtype,
                total_cost_usd,
                num_turns,
                ..
            } => outcome = Some((subtype, total_cost_usd, num_turns)),
            SdkMessage::System { .. } => {}
        }
    }
    eprintln!();
    let (subtype, cost, turns) = outcome.context("agent produced no terminal Result")?;
    anyhow::ensure!(subtype.is_success(), "agent run failed: {subtype:?}");
    println!("    agent ok: {turns} turns, ${:.4}", cost.unwrap_or(0.0));

    let (jd, iq, ts) = validate(&art_path)?;
    let badges = serde_json::from_str::<Value>(&ts)?
        .as_array()
        .map(Vec::len)
        .unwrap_or(0);
    println!(
        "==> artifact valid: aiInterviewQuestions={} chars, aiTechStack={badges} badges",
        iq.len()
    );

    if args.no_db {
        println!("--no-db: skipping Neon write.");
        return Ok(());
    }

    let db_url = args
        .database_url
        .clone()
        .or_else(|| std::env::var("DATABASE_URL").ok())
        .context("DATABASE_URL not set and --database-url not given")?;
    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&sanitize_pg_url(&db_url))
        .await
        .context("connecting to Neon Postgres")?;

    let rows = sqlx::query(
        "SELECT id::text AS id, user_id, job_description, \
         length(coalesce(ai_interview_questions,'')) AS iq_len \
         FROM applications WHERE slug = $1",
    )
    .bind(&args.slug)
    .fetch_all(&pool)
    .await?;
    anyhow::ensure!(!rows.is_empty(), "no applications row for slug {:?}", args.slug);

    let row = if rows.len() > 1 {
        let uid = args.user_id.clone().ok_or_else(|| {
            for r in &rows {
                eprintln!(
                    "  user-id={} id={}",
                    r.get::<String, _>("user_id"),
                    r.get::<String, _>("id"),
                );
            }
            anyhow::anyhow!("{} rows match slug {:?}; pass --user-id", rows.len(), args.slug)
        })?;
        rows.into_iter()
            .find(|r| r.get::<String, _>("user_id") == uid)
            .ok_or_else(|| anyhow::anyhow!("no row for slug {:?} user-id {:?}", args.slug, uid))?
    } else {
        rows.into_iter().next().unwrap()
    };

    let id: String = row.get("id");
    let existing_jd: Option<String> = row.get("job_description");
    let before_len: i32 = row.get("iq_len");
    let backfill_jd = existing_jd
        .as_deref()
        .map_or(true, |s| s.trim().is_empty())
        && !jd.trim().is_empty();
    println!(
        "==> Neon row id={id}: before aiInterviewQuestions={before_len} chars{}",
        if backfill_jd {
            " (will backfill jobDescription)"
        } else {
            ""
        }
    );

    sqlx::query(
        "UPDATE applications \
         SET ai_interview_questions = $1, \
             ai_tech_stack = $2, \
             job_description = CASE WHEN $3 THEN $4 ELSE job_description END, \
             updated_at = now() \
         WHERE id = $5::uuid",
    )
    .bind(&iq)
    .bind(&ts)
    .bind(backfill_jd)
    .bind(&jd)
    .bind(&id)
    .execute(&pool)
    .await
    .context("UPDATE applications")?;

    let after: i32 = sqlx::query_scalar(
        "SELECT length(coalesce(ai_interview_questions,'')) FROM applications WHERE id = $1::uuid",
    )
    .bind(&id)
    .fetch_one(&pool)
    .await?;

    println!(
        "✓ Neon updated: id={id} slug={} — aiInterviewQuestions now {after} chars, \
         aiTechStack {badges} badges. The owner's live /applications/{}/prep now \
         renders this generated prep.",
        args.slug, args.slug
    );
    Ok(())
}
