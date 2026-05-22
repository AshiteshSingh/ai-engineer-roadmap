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
use aer_ml::d1::D1Client;
use futures::StreamExt;
use serde_json::{json, Value};
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
    /// Regenerate + validate only; skip the D1 write.
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
   - \"interviewQuestions\": GitHub-flavored Markdown, high-signal, specific \
to the JD. It MUST contain exactly these four level-2 headings, in order:\n\
       ## Technical screen likely topics\n\
       ## System design scenarios\n\
       ## Behavioral themes\n\
       ## Questions to ask them\n\
     (bulleted, concrete, no padding; ~6-10 technical topics, 2-3 \
system-design prompts, 4-6 behavioral themes, 5 questions). No top-level # H1.\n\n\
   - \"techStack\": a JSON STRING (the array JSON-encoded as a string, NOT a \
nested array) of 8-20 objects, each {{\"tag\": kebab-case-id, \"label\": \
\"Human Name\", \"category\": one of EXACTLY \\\"Databases & Storage\\\" | \
\\\"Backend Frameworks\\\" | \\\"Frontend Frameworks\\\" | \\\"Cloud & \
DevOps\\\" | \\\"Languages\\\" | \\\"Testing & Quality\\\" | \\\"API & \
Communication\\\", \"relevance\": \"primary\" | \"secondary\"}}. Skip soft \
skills/seniority. Merge synonyms.\n\n\
3. Use the Write tool to overwrite {art_abs} with a single JSON object having \
EXACTLY these keys: slug, company, position, url, status, jobDescription, \
interviewQuestions, techStack, generatedAt\n\
   - slug/company/position/url/status/jobDescription: copied verbatim from \
step 1\n\
   - generatedAt: the current UTC time in ISO-8601 (e.g. 2026-05-18T12:34:56Z)\n\
   - valid JSON, UTF-8, no trailing prose.\n\n\
Do ONLY this. After the Write succeeds, stop."
    )
}

/// Read + strictly validate the artifact. Returns
/// `(jobDescription, interviewQuestions, techStack-json-string)`.
fn validate(path: &Path) -> anyhow::Result<(String, String, String)> {
    let raw = std::fs::read_to_string(path)
        .with_context(|| format!("reading {}", path.display()))?;
    let v: Value = serde_json::from_str(&raw).context("artifact is not valid JSON")?;

    let iq = v
        .get("interviewQuestions")
        .and_then(Value::as_str)
        .unwrap_or("");
    anyhow::ensure!(
        iq.trim().chars().count() >= 200,
        "interviewQuestions too short/empty ({} chars)",
        iq.trim().chars().count()
    );
    let sections = iq.lines().filter(|l| l.starts_with("## ")).count();
    anyhow::ensure!(sections >= 4, "expected ≥4 '## ' sections, found {sections}");

    let ts_raw = v
        .get("techStack")
        .and_then(Value::as_str)
        .context("techStack must be a JSON string")?;
    let arr = serde_json::from_str::<Value>(ts_raw)
        .context("techStack is not parseable JSON")?;
    let arr = arr
        .as_array()
        .cloned()
        .filter(|a| !a.is_empty())
        .context("techStack must parse to a non-empty array")?;
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

/// Read a string column from a D1 JSON result row.
fn col(row: &Value, k: &str) -> Option<String> {
    row.get(k).and_then(Value::as_str).map(String::from)
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
        "==> artifact valid: interviewQuestions={} chars, techStack={badges} badges",
        iq.len()
    );

    if args.no_db {
        println!("--no-db: skipping D1 write.");
        return Ok(());
    }

    let d1 = D1Client::from_env()?
        .context("D1 env vars (CLOUDFLARE_ACCOUNT_ID/_AUDIO_D1_ID/_D1_API_TOKEN) not set")?;

    let rows = d1
        .query_rows(
            "SELECT id, user_id, job_description, \
             length(coalesce(interview_questions,'')) AS iq_len \
             FROM applications WHERE slug = ?",
            vec![json!(args.slug)],
        )
        .await?;
    anyhow::ensure!(!rows.is_empty(), "no applications row for slug {:?}", args.slug);

    let row = if rows.len() > 1 {
        let uid = args.user_id.clone().ok_or_else(|| {
            for r in &rows {
                eprintln!(
                    "  user-id={} id={}",
                    col(r, "user_id").unwrap_or_default(),
                    col(r, "id").unwrap_or_default(),
                );
            }
            anyhow::anyhow!("{} rows match slug {:?}; pass --user-id", rows.len(), args.slug)
        })?;
        rows.into_iter()
            .find(|r| col(r, "user_id").as_deref() == Some(uid.as_str()))
            .ok_or_else(|| anyhow::anyhow!("no row for slug {:?} user-id {:?}", args.slug, uid))?
    } else {
        rows.into_iter().next().unwrap()
    };

    let id: String = col(&row, "id").context("row missing id")?;
    let existing_jd: Option<String> = col(&row, "job_description");
    let before_len: i64 = row.get("iq_len").and_then(Value::as_i64).unwrap_or(0);
    let backfill_jd = existing_jd
        .as_deref()
        .map_or(true, |s| s.trim().is_empty())
        && !jd.trim().is_empty();
    println!(
        "==> Neon row id={id}: before interviewQuestions={before_len} chars{}",
        if backfill_jd {
            " (will backfill jobDescription)"
        } else {
            ""
        }
    );

    sqlx::query(
        "UPDATE applications \
         SET interview_questions = $1, \
             tech_stack = $2, \
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
        "SELECT length(coalesce(interview_questions,'')) FROM applications WHERE id = $1::uuid",
    )
    .bind(&id)
    .fetch_one(&pool)
    .await?;

    println!(
        "✓ Neon updated: id={id} slug={} — interviewQuestions now {after} chars, \
         techStack {badges} badges. The owner's live /applications/{}/prep now \
         renders this generated prep.",
        args.slug, args.slug
    );
    Ok(())
}
