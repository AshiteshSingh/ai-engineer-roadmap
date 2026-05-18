//! `review-courses` — full-Rust replacement for `scripts/review-courses.ts` +
//! the knowledge-server `course_review` graph.
//!
//! Reads unreviewed rows from the SQLite course store (`data/courses.db`),
//! runs `course_review::run` in-process (10-expert fan-out + aggregator — no
//! server), and upserts `course_reviews` exactly like
//! `src/db/courses-sqlite.ts::upsertCourseReview`.
//!
//!   DEEPSEEK_API_KEY=… cargo run -p aer-ml --release --bin review-courses -- \
//!     [--limit 5] [--provider udemy] [--dry-run]

use std::path::PathBuf;

use aer_ml::server::{graphs::course_review, llm};
use anyhow::Context;
use clap::Parser;
use rusqlite::{params, Connection};
use serde_json::{json, Map, Value};
use tracing_subscriber::EnvFilter;

#[derive(Parser)]
#[command(name = "review-courses")]
struct Args {
    #[arg(long, default_value_t = 5)]
    limit: i64,
    #[arg(long)]
    provider: Option<String>,
    #[arg(long)]
    dry_run: bool,
    /// SQLite course store (relative to CWD or absolute). Env: COURSES_DB.
    #[arg(long, default_value = "../../data/courses.db")]
    courses_db: PathBuf,
}

/// Verbatim `course_reviews` DDL from `src/db/courses-sqlite.ts` so the table
/// exists before upsert (matches the TS `coursesDb()` open behaviour).
const ENSURE_DDL: &str = "CREATE TABLE IF NOT EXISTS course_reviews (
  id                          TEXT PRIMARY KEY,
  course_id                   TEXT NOT NULL UNIQUE REFERENCES external_courses(id) ON DELETE CASCADE,
  pedagogy_score              INTEGER,
  technical_accuracy_score    INTEGER,
  content_depth_score         INTEGER,
  practical_application_score INTEGER,
  instructor_clarity_score    INTEGER,
  curriculum_fit_score        INTEGER,
  prerequisites_score         INTEGER,
  domain_relevance_score      INTEGER,
  community_health_score      INTEGER,
  value_proposition_score     INTEGER,
  aggregate_score             REAL,
  verdict                     TEXT,
  summary                     TEXT,
  expert_details              TEXT,
  model_version               TEXT NOT NULL DEFAULT 'deepseek-chat',
  reviewed_at                 TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS course_reviews_course_idx ON course_reviews(course_id);";

const EXPERT_KEYS: &[&str] = &[
    "pedagogy_score",
    "technical_accuracy_score",
    "content_depth_score",
    "practical_application_score",
    "instructor_clarity_score",
    "curriculum_fit_score",
    "prerequisites_score",
    "domain_relevance_score",
    "community_health_score",
    "value_proposition_score",
];

struct CourseRow {
    id: String,
    title: String,
    url: String,
    provider: String,
    description: String,
    level: String,
    rating: f64,
    review_count: i64,
    duration_hours: f64,
    is_free: bool,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .with_writer(std::io::stderr)
        .init();
    let args = Args::parse();

    let db_path = std::env::var("COURSES_DB")
        .map(PathBuf::from)
        .unwrap_or_else(|_| args.courses_db.clone());
    anyhow::ensure!(
        db_path.is_file(),
        "courses db {} not found",
        db_path.display()
    );
    let conn = Connection::open(&db_path)?;
    conn.execute_batch(ENSURE_DDL)?;

    let base = "SELECT ec.id, ec.title, ec.url, ec.provider, \
        COALESCE(ec.description,''), COALESCE(ec.level,'Beginner'), \
        COALESCE(ec.rating,0.0), COALESCE(ec.review_count,0), \
        COALESCE(ec.duration_hours,0.0), ec.is_free \
        FROM external_courses ec \
        WHERE NOT EXISTS (SELECT 1 FROM course_reviews cr WHERE cr.course_id = ec.id)";

    let map_row = |r: &rusqlite::Row| -> rusqlite::Result<CourseRow> {
        Ok(CourseRow {
            id: r.get(0)?,
            title: r.get(1)?,
            url: r.get(2)?,
            provider: r.get(3)?,
            description: r.get(4)?,
            level: r.get(5)?,
            rating: r.get(6)?,
            review_count: r.get(7)?,
            duration_hours: r.get(8)?,
            is_free: r.get::<_, i64>(9).unwrap_or(0) != 0,
        })
    };

    let rows: Vec<CourseRow> = if let Some(p) = &args.provider {
        let sql = format!("{base} AND lower(ec.provider) LIKE ?1 ORDER BY ec.created_at LIMIT ?2");
        let mut st = conn.prepare(&sql)?;
        let it = st.query_map(params![format!("%{}%", p.to_lowercase()), args.limit], map_row)?;
        it.collect::<rusqlite::Result<_>>()?
    } else {
        let sql = format!("{base} ORDER BY ec.created_at LIMIT ?1");
        let mut st = conn.prepare(&sql)?;
        let it = st.query_map(params![args.limit], map_row)?;
        it.collect::<rusqlite::Result<_>>()?
    };

    if rows.is_empty() {
        println!("No unreviewed courses found.");
        return Ok(());
    }
    let pmsg = args
        .provider
        .as_deref()
        .map(|p| format!(" (provider filter: '{p}')"))
        .unwrap_or_default();
    println!("Found {} unreviewed course(s){pmsg}.", rows.len());

    if args.dry_run {
        println!("\n-- DRY RUN — no pipeline will be executed --\n");
        for (i, r) in rows.iter().enumerate() {
            let free = if r.is_free { "free" } else { "paid" };
            println!(
                "  [{}] {}\n       provider : {}\n       level    : {}\n       rating   : {}  ({} reviews)\n       duration : {}h  [{free}]\n       id       : {}\n",
                i + 1, r.title, r.provider, r.level, r.rating, r.review_count, r.duration_hours, r.id
            );
        }
        return Ok(());
    }

    let cfg = llm::LlmConfig::from_env();
    let client = llm::reqwest_client(&cfg);

    for (i, r) in rows.iter().enumerate() {
        println!(
            "\n[{}/{}] Reviewing: {} ({}) …",
            i + 1,
            rows.len(),
            r.title,
            r.provider
        );
        let input = json!({
            "course_id": r.id,
            "title": r.title,
            "url": r.url,
            "provider": r.provider,
            "description": r.description,
            "level": r.level,
            "rating": r.rating,
            "review_count": r.review_count,
            "duration_hours": r.duration_hours,
            "is_free": r.is_free,
        });
        let res = match course_review::run(input, &client, &cfg.model).await {
            Ok(v) => v,
            Err(e) => {
                println!("  ERROR reviewing course {}: {e}", r.id);
                continue;
            }
        };

        let score = |k: &str| -> i64 {
            res.get(k)
                .and_then(|x| x.get("score"))
                .and_then(Value::as_i64)
                .unwrap_or(0)
        };
        let aggregate = res.get("aggregate_score").and_then(Value::as_f64).unwrap_or(0.0);
        let verdict = res.get("verdict").and_then(Value::as_str).unwrap_or("");
        let summary = res.get("summary").and_then(Value::as_str).unwrap_or("");
        let mut details = Map::new();
        for k in EXPERT_KEYS {
            details.insert((*k).to_string(), res.get(*k).cloned().unwrap_or(Value::Null));
        }
        let expert_details = Value::Object(details).to_string();

        conn.execute(
            "INSERT INTO course_reviews (
               id, course_id, pedagogy_score, technical_accuracy_score,
               content_depth_score, practical_application_score,
               instructor_clarity_score, curriculum_fit_score, prerequisites_score,
               domain_relevance_score, community_health_score,
               value_proposition_score, aggregate_score, verdict, summary,
               expert_details, model_version, reviewed_at
             ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17, datetime('now'))
             ON CONFLICT(course_id) DO UPDATE SET
               pedagogy_score              = excluded.pedagogy_score,
               technical_accuracy_score    = excluded.technical_accuracy_score,
               content_depth_score         = excluded.content_depth_score,
               practical_application_score = excluded.practical_application_score,
               instructor_clarity_score    = excluded.instructor_clarity_score,
               curriculum_fit_score        = excluded.curriculum_fit_score,
               prerequisites_score         = excluded.prerequisites_score,
               domain_relevance_score      = excluded.domain_relevance_score,
               community_health_score      = excluded.community_health_score,
               value_proposition_score     = excluded.value_proposition_score,
               aggregate_score             = excluded.aggregate_score,
               verdict                     = excluded.verdict,
               summary                     = excluded.summary,
               expert_details              = excluded.expert_details,
               model_version               = excluded.model_version,
               reviewed_at                 = datetime('now')",
            params![
                uuid::Uuid::new_v4().to_string(),
                r.id,
                score("pedagogy_score"),
                score("technical_accuracy_score"),
                score("content_depth_score"),
                score("practical_application_score"),
                score("instructor_clarity_score"),
                score("curriculum_fit_score"),
                score("prerequisites_score"),
                score("domain_relevance_score"),
                score("community_health_score"),
                score("value_proposition_score"),
                aggregate,
                verdict,
                summary,
                expert_details,
                cfg.model,
            ],
        )
        .with_context(|| format!("upsert course_review for {}", r.id))?;

        println!(
            "  verdict={verdict}  score={aggregate:.2}  saved to course_reviews."
        );
    }

    println!("\nDone.");
    Ok(())
}
