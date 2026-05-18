//! Build the LanceDB section index from `data/knowledge.db`.
//!
//!   cd crates/ml && cargo run -p knowledge-ml-server \
//!       --release --bin knowledge-index
//!
//! Requires the candle embed server running (default http://localhost:9999):
//!   cd crates/candle && cargo run --release --bin embed-server --features server

use std::path::PathBuf;

use clap::Parser;
use aer_ml::server::retrieval::{embed_batch, load_all_sections};
use aer_ml::server::store::SectionStore;
use tracing_subscriber::EnvFilter;

/// Max chars of section text sent to the embed server.
const EMBED_TEXT_CHARS: usize = 1800;

#[derive(Parser)]
#[command(name = "knowledge-index")]
struct Args {
    /// Canonical SQLite content store.
    #[arg(long, default_value = "../../data/knowledge.db")]
    db: PathBuf,
    /// LanceDB directory (rebuilt from scratch each run).
    #[arg(long, default_value = "../../data/lancedb")]
    lancedb: String,
    /// Candle embed server base URL.
    #[arg(long, env = "EMBED_URL", default_value = "http://localhost:9999")]
    embed_url: String,
    /// Embedding request batch size.
    #[arg(long, default_value_t = 64)]
    batch: usize,
}

fn embed_text(heading: &str, content: &str) -> String {
    let combined = format!("{heading}\n\n{content}");
    if combined.chars().count() <= EMBED_TEXT_CHARS {
        combined
    } else {
        combined.chars().take(EMBED_TEXT_CHARS).collect()
    }
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .init();
    let args = Args::parse();

    anyhow::ensure!(
        args.db.exists(),
        "{} not found — run `npm run seed:content` first",
        args.db.display()
    );

    let sections = load_all_sections(&args.db)?;
    let total = sections.len();
    tracing::info!("loaded {total} sections from {}", args.db.display());
    anyhow::ensure!(total > 0, "no sections found in {}", args.db.display());

    // Clean rebuild: drop the existing store directory entirely.
    match std::fs::remove_dir_all(&args.lancedb) {
        Ok(()) => tracing::info!("cleared existing index at {}", args.lancedb),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(anyhow::anyhow!("clearing {}: {e}", args.lancedb)),
    }

    let store = SectionStore::connect(&args.lancedb).await?;
    let http = reqwest::Client::new();

    let mut done = 0usize;
    for chunk in sections.chunks(args.batch) {
        let texts: Vec<String> = chunk
            .iter()
            .map(|s| embed_text(&s.heading, &s.content))
            .collect();
        let vectors = embed_batch(&http, &args.embed_url, &texts).await?;
        store.add(chunk, &vectors).await?;
        done += chunk.len();
        tracing::info!("indexed {done}/{total}");
    }

    let count = store.count().await?;
    tracing::info!("done: {count} rows in LanceDB ({})", args.lancedb);
    anyhow::ensure!(
        count == total,
        "row count {count} != section count {total}"
    );
    println!("Indexed {count} sections into {}", args.lancedb);
    Ok(())
}
