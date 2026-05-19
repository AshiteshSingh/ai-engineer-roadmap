//! Ingest scraped DeepLearning.AI courses into the Rust pipeline.
//!
//! Reads `data/deeplearning/<slug>.json` (produced by
//! `scripts/scrape-deeplearning-course.ts`) and integrates each course on
//! four surfaces:
//!
//!   1. `external_courses` + `lesson_courses` rows in `courses.db`
//!      (→ `export-content` → the "Further Learning" rails).
//!   2. `data/content/deeplearning-sections.json` — a lexical corpus the
//!      chat retrieval path (`lib/search-index.ts`) reads, so the assistant
//!      can cite DeepLearning.AI lesson content.
//!   3. LanceDB `dl_transcript_chunks` — windowed + timestamped transcript
//!      embeddings for semantic search (gated on the embed-server).
//!   4. The similarity matrix is handled by `build-similarity --dlai-dir`.
//!
//! Usage:
//!   cargo run -p aer-ml --release --bin seed-dl-transcripts -- \
//!     [--input-dir ../../data/deeplearning] [--no-embed] [--dry-run]

use std::path::PathBuf;

use aer_ml::content::courses;
use aer_ml::dlai::chunk::{chunk_course, fmt_ts, TranscriptChunk};
use aer_ml::dlai::model::ScrapedCourse;
use aer_ml::dlai::store::TranscriptStore;
use aer_ml::udemy::embed::embed_batch;
use anyhow::{Context, Result};
use clap::Parser;
use serde::Serialize;
use serde_json::json;
use tracing_subscriber::EnvFilter;

#[derive(Parser)]
#[command(name = "seed-dl-transcripts")]
struct Args {
    /// Directory of scraped <slug>.json files.
    #[arg(long, default_value = "../../data/deeplearning")]
    input_dir: PathBuf,
    /// LanceDB directory (transcript-chunk vector index).
    #[arg(long, default_value = "../../data/lancedb")]
    lancedb: String,
    /// candle embed-server base URL.
    #[arg(long, default_value = "http://localhost:9999")]
    embed_url: String,
    /// Embedding batch size.
    #[arg(long, default_value_t = 32)]
    embed_batch: usize,
    /// SQLite course store.
    #[arg(long, default_value = "../../data/courses.db")]
    courses_db: PathBuf,
    /// Lexical corpus output consumed by lib/search-index.ts.
    #[arg(long, default_value = "../../data/content/deeplearning-sections.json")]
    sections_out: PathBuf,
    /// topic_group bucket for the rails.
    #[arg(long, default_value = "AI Agents & Frameworks")]
    topic_group: String,
    /// Skip embedding + LanceDB (still does courses.db + sections export).
    #[arg(long)]
    no_embed: bool,
    /// Parse + chunk + report only; write nothing.
    #[arg(long)]
    dry_run: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SectionRow {
    lesson_slug: String,
    lesson_title: String,
    heading: String,
    content: String,
}

/// Map a course/lesson topic to roadmap lesson slugs it should surface on.
/// Conservative keyword → (slug, relevance) table over real roadmap slugs.
fn lesson_links(haystack: &str) -> Vec<(&'static str, f64)> {
    const RULES: &[(&str, &str, f64)] = &[
        ("langgraph", "langgraph", 0.9),
        ("agent", "agent-architectures", 0.8),
        ("agentic", "agent-architectures", 0.8),
        ("function calling", "function-calling", 0.9),
        ("tool", "function-calling", 0.7),
        ("memory", "agent-architectures", 0.7),
        ("retrieval", "retrieval-strategies", 0.85),
        ("chat with your data", "advanced-rag", 0.85),
        ("rag", "rag", 0.9),
        ("embedding", "embeddings", 0.85),
        ("vector", "vector-databases", 0.8),
        ("chunk", "chunking-strategies", 0.8),
        ("evaluation", "rag-evaluation", 0.75),
        ("spec-driven", "spec-driven-development", 0.95),
    ];
    let h = haystack.to_lowercase();
    let mut out: Vec<(&'static str, f64)> = Vec::new();
    for (kw, slug, rel) in RULES {
        if h.contains(kw) && !out.iter().any(|(s, _)| s == slug) {
            out.push((slug, *rel));
        }
    }
    out
}

fn load_courses(dir: &std::path::Path) -> Result<Vec<ScrapedCourse>> {
    let mut courses = Vec::new();
    for entry in std::fs::read_dir(dir).with_context(|| format!("read_dir {}", dir.display()))? {
        let path = entry?.path();
        if !path.is_file() || path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let raw = std::fs::read_to_string(&path)?;
        match serde_json::from_str::<ScrapedCourse>(&raw) {
            Ok(c) if !c.lessons.is_empty() => courses.push(c),
            Ok(_) => tracing::warn!("skipping {} (no lessons)", path.display()),
            Err(e) => tracing::warn!("skipping {} ({e})", path.display()),
        }
    }
    courses.sort_by(|a, b| a.slug.cmp(&b.slug));
    Ok(courses)
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env().add_directive("info".parse()?))
        .init();
    let args = Args::parse();

    let courses = load_courses(&args.input_dir)?;
    if courses.is_empty() {
        anyhow::bail!("no scraped courses found in {}", args.input_dir.display());
    }
    tracing::info!("Loaded {} courses", courses.len());

    // ── Chunk everything ────────────────────────────────────────────────
    let mut all_chunks: Vec<TranscriptChunk> = Vec::new();
    let mut sections: Vec<SectionRow> = Vec::new();
    for course in &courses {
        let chunks = chunk_course(course);
        tracing::info!(
            "{}: {} lessons → {} chunks",
            course.slug,
            course.lessons.len(),
            chunks.len()
        );
        for ch in &chunks {
            sections.push(SectionRow {
                lesson_slug: format!("dlai-{}", course.slug),
                lesson_title: course.title.clone(),
                heading: format!(
                    "{} [{}–{}]",
                    ch.lesson_title,
                    fmt_ts(ch.start_secs),
                    fmt_ts(ch.end_secs)
                ),
                content: ch.text.clone(),
            });
        }
        all_chunks.extend(chunks);
    }
    tracing::info!(
        "Total: {} transcript chunks, {} section rows",
        all_chunks.len(),
        sections.len()
    );

    if args.dry_run {
        tracing::info!("--dry-run: nothing written");
        return Ok(());
    }

    // ── 1 + 2: courses.db rails + lexical corpus ───────────────────────
    let conn = courses::open(&args.courses_db)?;
    for course in &courses {
        let titles: Vec<String> = course.lessons.iter().map(|l| l.title.clone()).collect();
        let description = format!(
            "DeepLearning.AI short course. {} lessons: {}.",
            course.lessons.len(),
            titles.join("; ").chars().take(1200).collect::<String>()
        );
        let value = json!({
            "title": course.title,
            "url": course.url,
            "description": description,
            "level": "All Levels",
            "durationHours": course.duration_hours(),
            "isFree": true,
            "language": "English",
            "metadata": {
                "instructor": "DeepLearning.AI",
                "provider": "DeepLearning.AI",
                "lessonCount": course.lessons.len(),
                "scrapedAt": course.scraped_at,
                "sections": titles,
            }
        });
        let id = courses::upsert_course(&conn, &value, "DeepLearning.AI", &args.topic_group)?;

        let mut hay = course.title.clone();
        for l in &course.lessons {
            hay.push(' ');
            hay.push_str(&l.title);
        }
        let links = lesson_links(&hay);
        for (slug, rel) in &links {
            courses::link_lesson_course(&conn, slug, &id, *rel)?;
        }
        tracing::info!(
            "courses.db ← {} (id={}, links: {})",
            course.slug,
            &id[..8],
            links
                .iter()
                .map(|(s, r)| format!("{s}={r}"))
                .collect::<Vec<_>>()
                .join(",")
        );
    }

    if let Some(parent) = args.sections_out.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(&args.sections_out, serde_json::to_vec_pretty(&sections)?)?;
    tracing::info!(
        "Wrote {} ({} rows)",
        args.sections_out.display(),
        sections.len()
    );

    // ── 3: LanceDB transcript-chunk embeddings ─────────────────────────
    if args.no_embed {
        tracing::warn!("--no-embed: skipped LanceDB. Run the embed-server then re-run without --no-embed to populate it.");
        return Ok(());
    }

    let http = reqwest::Client::new();
    let health = http
        .get(format!("{}/health", args.embed_url))
        .send()
        .await
        .map(|r| r.status().is_success())
        .unwrap_or(false);
    if !health {
        tracing::warn!(
            "embed-server not reachable at {} — skipped LanceDB. Start it (crates/candle: cargo run --bin embed-server --features server --release) then re-run.",
            args.embed_url
        );
        return Ok(());
    }

    let store = TranscriptStore::connect(&args.lancedb).await?;
    store.reset().await?;
    let mut embedded = 0usize;
    for batch in all_chunks.chunks(args.embed_batch.max(1)) {
        let texts: Vec<String> = batch.iter().map(|c| c.text.clone()).collect();
        let vecs = embed_batch(&http, &args.embed_url, &texts).await?;
        embedded += store.add(batch, &vecs).await?;
        tracing::info!("embedded {embedded}/{} chunks", all_chunks.len());
    }
    tracing::info!(
        "LanceDB '{}' now holds {} chunks",
        args.lancedb,
        store.count().await?
    );
    Ok(())
}
