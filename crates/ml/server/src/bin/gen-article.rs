//! Pure-Rust knowledge-base article generator — port of
//! `backend/scripts/generate_article.py`.
//!
//!   cd crates/ml && cargo run -p knowledge-ml-server \
//!       --release --bin gen-article -- --slug postgresql-joins \
//!       --topic "PostgreSQL JOINs" [--category "Software Engineering"] \
//!       [--related "indexing,query-optimization"] [--no-write]
//!
//! Invokes the in-process `article_generate` graph (research → outline → draft
//! → review → revise loop → finalize) and writes `content/<slug>.md`. Catalog
//! context (existing-articles list, longest article as a style sample) is
//! scanned straight off the `content/` directory — no Neon, no TS glue.

use std::path::PathBuf;

use clap::Parser;
use knowledge_ml_server::{graphs::article, llm};
use serde_json::json;
use tracing_subscriber::EnvFilter;

const STYLE_SAMPLE_MAX_CHARS: usize = 2000;
const EXISTING_ARTICLES_LIMIT: usize = 40;

#[derive(Parser)]
#[command(name = "gen-article")]
struct Args {
    /// Article slug, e.g. postgresql-joins.
    #[arg(long)]
    slug: String,
    /// Human-readable topic; defaults to the titled slug.
    #[arg(long)]
    topic: Option<String>,
    /// Lesson category (free-form).
    #[arg(long, default_value = "")]
    category: String,
    /// Comma-separated related slugs.
    #[arg(long, default_value = "")]
    related: String,
    /// Print the article but don't overwrite the .md.
    #[arg(long)]
    no_write: bool,
    /// Knowledge-base content directory.
    #[arg(long, default_value = "../../content")]
    content_dir: PathBuf,
}

/// Python `str.title()` over hyphen/underscore-free words: capitalize the
/// first letter of each whitespace-separated word, lowercase the rest.
fn titlecase(s: &str) -> String {
    s.split_whitespace()
        .map(|w| {
            let mut c = w.chars();
            match c.next() {
                Some(f) => f.to_uppercase().collect::<String>() + &c.as_str().to_lowercase(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn humanize_slug(slug: &str) -> String {
    titlecase(&slug.replace(['-', '_'], " "))
}

/// Sorted `*.md` stems (excluding the current slug). Mirrors Python's
/// `sorted(CONTENT_DIR.glob("*.md"))` + `path.stem`.
fn content_md_stems(content_dir: &PathBuf) -> Vec<String> {
    let mut stems: Vec<String> = std::fs::read_dir(content_dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| {
            let p = e.path();
            if p.extension().and_then(|x| x.to_str()) == Some("md") {
                p.file_stem().and_then(|s| s.to_str()).map(str::to_string)
            } else {
                None
            }
        })
        .collect();
    stems.sort();
    stems
}

fn gather_existing_articles(content_dir: &PathBuf, current_slug: &str) -> String {
    let mut items: Vec<String> = Vec::new();
    for stem in content_md_stems(content_dir) {
        if stem == current_slug {
            continue;
        }
        let title = titlecase(&stem.replace('-', " "));
        items.push(format!("- [{title}](/{stem})"));
        if items.len() >= EXISTING_ARTICLES_LIMIT {
            break;
        }
    }
    items.join("\n")
}

/// Longest existing article (other than current) as a style reference — first
/// `STYLE_SAMPLE_MAX_CHARS` chars.
fn pick_style_sample(content_dir: &PathBuf, current_slug: &str) -> String {
    let mut best: Option<(u64, PathBuf)> = None;
    for stem in content_md_stems(content_dir) {
        if stem == current_slug {
            continue;
        }
        let path = content_dir.join(format!("{stem}.md"));
        let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
        if best.as_ref().map(|(s, _)| size > *s).unwrap_or(true) {
            best = Some((size, path));
        }
    }
    match best {
        Some((_, path)) => std::fs::read_to_string(&path)
            .map(|s| s.chars().take(STYLE_SAMPLE_MAX_CHARS).collect())
            .unwrap_or_default(),
        None => String::new(),
    }
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .init();
    let args = Args::parse();

    anyhow::ensure!(
        args.content_dir.is_dir(),
        "content dir {} not found",
        args.content_dir.display()
    );

    let topic = args
        .topic
        .clone()
        .filter(|t| !t.is_empty())
        .unwrap_or_else(|| humanize_slug(&args.slug));
    let out_path = args.content_dir.join(format!("{}.md", args.slug));

    println!("Generating: {topic}  (slug={})", args.slug);
    println!("Output:     {}", out_path.display());
    println!("Pipeline:   research -> outline -> draft -> review -> [revise loop] -> finalize");
    println!();

    let cfg = llm::LlmConfig::from_env();
    let client = llm::reqwest_client(&cfg);

    let state = json!({
        "slug": args.slug,
        "topic": topic,
        "category": args.category,
        "related_topics": args.related,
        "existing_articles": gather_existing_articles(&args.content_dir, &args.slug),
        "style_sample": pick_style_sample(&args.content_dir, &args.slug),
    });

    let result = article::run(state, &client, &cfg.model, cfg.temperature).await?;

    let final_md = result.get("final").and_then(|v| v.as_str()).unwrap_or("");
    let quality = result.get("quality").cloned().unwrap_or(json!({}));
    let ok = quality.get("ok").and_then(|v| v.as_bool()).unwrap_or(false);
    let word_count = result
        .get("word_count")
        .and_then(|v| v.as_u64())
        .or_else(|| quality.get("wordCount").and_then(|v| v.as_u64()))
        .unwrap_or(0);
    let revisions = result.get("revisions").and_then(|v| v.as_i64()).unwrap_or(0);
    let issues: Vec<String> = quality
        .get("issues")
        .and_then(|v| v.as_array())
        .map(|a| {
            a.iter()
                .map(|i| i.as_str().unwrap_or("").to_string())
                .collect()
        })
        .unwrap_or_default();

    if args.no_write {
        println!("{final_md}");
    } else {
        std::fs::write(&out_path, final_md)?;
        println!("Wrote {}", out_path.display());
    }

    println!("Done! {word_count} words, {revisions} revisions, ok={ok}");
    if !issues.is_empty() {
        println!("Quality issues:");
        for issue in &issues {
            println!("  - {issue}");
        }
    }

    std::process::exit(if ok { 0 } else { 1 });
}
