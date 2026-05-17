//! Seed the top-N Udemy courses for a lesson topic — port of
//! `backend/scripts/seed_topic_courses.py`.
//!
//! Pipeline (unchanged): TS Playwright scraper subprocess → in-process
//! `fetch_courses` graph → upsert into **`data/courses.db`** (SQLite). The
//! only behavioural change vs. the Python original is the persistence target:
//! the dedicated SQLite course store instead of Neon Postgres. The exporter
//! (`export-content`) turns that into `courses.json` for the Next.js frontend.
//!
//!   cd crates/ml && cargo run -p knowledge-ml-langgraph-server --release \
//!     --bin seed-topic-courses -- \
//!     --slug public-speaking --topic-name "Public Speaking" \
//!     --search-url "https://www.udemy.com/courses/search/?q=public+speaking&sort=most-reviewed" \
//!     --topic-group "Communication Skills" --count 10

use std::path::PathBuf;
use std::process::Command;

use clap::Parser;
use knowledge_ml_langgraph_server::{courses, graphs::fetch_courses, llm};
use serde_json::{json, Value};
use tracing_subscriber::EnvFilter;

#[derive(Parser)]
#[command(name = "seed-topic-courses")]
struct Args {
    /// Lesson slug (e.g. public-speaking).
    #[arg(long)]
    slug: String,
    /// Human topic name (e.g. "Public Speaking").
    #[arg(long)]
    topic_name: String,
    /// Udemy search URL.
    #[arg(long)]
    search_url: String,
    /// Course DB topic_group bucket.
    #[arg(long, default_value = "")]
    topic_group: String,
    /// Top N to keep.
    #[arg(long, default_value_t = 10)]
    count: i64,
    /// Max candidates to scrape.
    #[arg(long, default_value_t = 25)]
    max: i64,
    /// Knowledge-app root (cwd for the TS scraper).
    #[arg(long, default_value = "../..")]
    repo_root: PathBuf,
    /// Dedicated SQLite course store.
    #[arg(long, default_value = "../../data/courses.db")]
    courses_db: PathBuf,
}

/// Run `scripts/fetch-udemy-search.ts` and return its `courses` array.
fn run_ts_scraper(repo_root: &PathBuf, search_url: &str, max: i64) -> anyhow::Result<Vec<Value>> {
    eprintln!(
        "$ pnpm tsx scripts/fetch-udemy-search.ts {search_url} --max {max}\n  (cwd={})",
        repo_root.display()
    );
    let out = Command::new("pnpm")
        .args([
            "tsx",
            "scripts/fetch-udemy-search.ts",
            search_url,
            "--max",
            &max.to_string(),
        ])
        .current_dir(repo_root)
        .output()
        .map_err(|e| anyhow::anyhow!("spawning fetch-udemy-search.ts: {e}"))?;

    // The TS script writes progress to stderr — surface it to the user.
    if !out.stderr.is_empty() {
        eprint!("{}", String::from_utf8_lossy(&out.stderr));
    }
    if !out.status.success() {
        anyhow::bail!(
            "fetch-udemy-search.ts exited {}; see stderr above.",
            out.status.code().unwrap_or(-1)
        );
    }

    let stdout = String::from_utf8_lossy(&out.stdout);
    let last = stdout
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .next_back()
        .ok_or_else(|| anyhow::anyhow!("scraper returned no stdout"))?;
    let payload: Value = serde_json::from_str(last)
        .map_err(|e| anyhow::anyhow!("scraper stdout was not JSON: {e}"))?;
    Ok(payload
        .get("courses")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default())
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .init();
    let args = Args::parse();

    eprintln!(
        "Step 1/3: scraping Udemy for top {} candidates",
        args.max
    );
    let candidates = run_ts_scraper(&args.repo_root, &args.search_url, args.max)?;
    if candidates.is_empty() {
        eprintln!("No candidates scraped — aborting.");
        std::process::exit(1);
    }
    eprintln!("  scraped {} candidates", candidates.len());

    eprintln!("\nStep 2/3: ranking via fetch_courses graph");
    let cfg = llm::LlmConfig::from_env();
    let client = llm::reqwest_client(&cfg);
    let input = json!({
        "courses": candidates,
        "topic_name": args.topic_name,
        "count": args.count,
        "topic_group": args.topic_group,
    });
    let result = fetch_courses::run(input, &client, &cfg.model).await?;
    let ranked = result
        .get("ranked")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let summary = result
        .get("summary")
        .and_then(Value::as_str)
        .unwrap_or("");
    eprintln!("  ranked {} courses", ranked.len());
    if !summary.is_empty() {
        eprintln!("\n  Summary: {summary}\n");
    }

    eprintln!("Step 3/3: persisting to {}", args.courses_db.display());
    let by_url: std::collections::HashMap<&str, &Value> = candidates
        .iter()
        .filter_map(|c| c.get("url").and_then(Value::as_str).map(|u| (u, c)))
        .collect();

    let conn = courses::open(&args.courses_db)?;
    let mut saved = 0usize;
    for r in &ranked {
        let url = r.get("url").and_then(Value::as_str).unwrap_or("");
        let Some(course) = by_url.get(url) else {
            eprintln!("  skip (LLM returned unknown url): {url}");
            continue;
        };
        let course_id = courses::upsert_course(&conn, course, &args.topic_group)?;
        let relevance = r.get("relevance").and_then(Value::as_f64).unwrap_or(0.5);
        courses::link_lesson_course(&conn, &args.slug, &course_id, relevance)?;
        saved += 1;
        let title = course.get("title").and_then(Value::as_str).unwrap_or("");
        let why = r.get("why").and_then(Value::as_str).unwrap_or("");
        eprintln!(
            "  ✓ {}  rel={relevance}  why={why}",
            title.chars().take(70).collect::<String>()
        );
    }

    eprintln!(
        "\nDone. Saved {saved} course(s) and linked to lesson '{}'.",
        args.slug
    );
    std::process::exit(if saved > 0 { 0 } else { 1 });
}
