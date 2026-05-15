//! Scan a codebase, extract learning topics, embed them, and store in LanceDB.
//!
//! Usage:
//!   cargo run --bin mine-topics -- --root ../../apps/lead-gen
//!   cargo run --bin mine-topics -- --root ../../apps/lead-gen --json
//!   cargo run --bin mine-topics -- --root ../../apps/lead-gen --db ./topics-lance-db

use std::path::PathBuf;

use candle::{best_device, EmbeddingModel};
use clap::Parser;
use topic_miner::{aggregate, scan, TopicStore};
use tracing::info;

const MODEL: &str = "BAAI/bge-large-en-v1.5";

#[derive(Parser)]
#[command(about = "Extract learning topics from a codebase and embed into LanceDB")]
struct Args {
    /// Root directory to scan
    #[arg(long, default_value = ".")]
    root: PathBuf,

    /// LanceDB output path
    #[arg(long, default_value = "./topics-lance-db")]
    db: String,

    /// Embedding model (BERT-compatible on HF Hub)
    #[arg(long, default_value = MODEL)]
    model: String,

    /// Embedding batch size
    #[arg(long, default_value_t = 16)]
    batch: usize,

    /// Dump extracted topics as JSON to stdout (skip embedding)
    #[arg(long)]
    json: bool,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let args = Args::parse();

    // ── Phase 1: Scan ────────────────────────────────────────────────────────
    eprintln!("Scanning {} ...", args.root.display());
    let signals = scan(&args.root);
    eprintln!("  {} raw signals collected", signals.len());

    // ── Phase 2: Aggregate ───────────────────────────────────────────────────
    let topics = aggregate(signals);
    eprintln!("  {} topics extracted", topics.len());

    if topics.is_empty() {
        eprintln!("No topics found.");
        return Ok(());
    }

    // Print summary table.
    eprintln!("\n{:<30} {:<25} {}", "Topic", "Category", "Files");
    eprintln!("{}", "-".repeat(70));
    for t in &topics {
        eprintln!("{:<30} {:<25} {}", truncate(&t.slug, 29), truncate(&t.category, 24), t.source_count);
    }
    eprintln!();

    // ── JSON-only mode ───────────────────────────────────────────────────────
    if args.json {
        println!("{}", serde_json::to_string_pretty(&topics)?);
        return Ok(());
    }

    // ── Phase 3: Embed + Store ───────────────────────────────────────────────
    eprintln!("Loading {} on {:?} ...", args.model, best_device()?);
    let device = best_device()?;
    let model = EmbeddingModel::from_hf(&args.model, &device)?;
    eprintln!("Model ready.");

    let store = TopicStore::connect(&args.db).await?;
    let already = store.count().await?;
    if already > 0 {
        eprintln!("{already} topics already in store. Use a fresh --db path to reindex.");
        return Ok(());
    }

    let total = topics.len();
    let mut done = 0usize;

    for chunk in topics.chunks(args.batch) {
        let texts: Vec<String> = chunk.iter().map(|t| t.embed_text()).collect();
        let refs: Vec<&str> = texts.iter().map(|s| s.as_str()).collect();

        let vecs: Vec<Vec<f32>> = {
            let tensor = model.embed(&refs)?;
            let (batch_size, _) = tensor.dims2()?;
            (0..batch_size)
                .map(|i| tensor.get(i)?.to_vec1::<f32>().map_err(candle::Error::from))
                .collect::<std::result::Result<Vec<_>, _>>()?
        };

        store.add(chunk, &vecs).await?;
        done += chunk.len();
        eprintln!("  {done}/{total} embedded");
    }

    eprintln!("Done — {done} topics indexed into {}", args.db);
    info!(count = done, db = args.db, "topic mining complete");
    Ok(())
}

fn truncate(s: &str, max: usize) -> String {
    if s.len() <= max {
        s.to_string()
    } else {
        format!("{}...", &s[..max.saturating_sub(3)])
    }
}
