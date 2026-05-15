//! Semantic search over a Lance topic store using a local Candle embedding.
//!
//! Usage:
//!   cargo run --bin search-topics -- "vector database embeddings"
//!   cargo run --bin search-topics -- --db ./topics-lance-db --top 10 "GraphQL resolvers"

use candle::{best_device, EmbeddingModel};
use clap::Parser;
use topic_miner::TopicStore;

const MODEL: &str = "BAAI/bge-large-en-v1.5";

#[derive(Parser)]
#[command(about = "Semantic search over extracted codebase topics")]
struct Args {
    /// The search query
    query: String,

    /// Lance database path
    #[arg(long, default_value = "./topics-lance-db")]
    db: String,

    /// Number of results
    #[arg(long, short, default_value_t = 5)]
    top: usize,

    /// Embedding model (must match the one used during mining)
    #[arg(long, default_value = MODEL)]
    model: String,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args = Args::parse();

    // Embed the query.
    let device = best_device()?;
    let model = EmbeddingModel::from_hf(&args.model, &device)?;
    let vec = model.embed_one(&args.query)?;

    // Search.
    let store = TopicStore::connect(&args.db).await?;
    let results = store.search(vec, args.top).await?;

    if results.is_empty() {
        eprintln!("No results. Run mine-topics first.");
        return Ok(());
    }

    println!("\nQuery: \"{}\"\n", args.query);
    println!(
        "{:<4} {:<6} {:<30} {:<20} {}",
        "Rank", "Score", "Topic", "Category", "Files"
    );
    println!("{}", "-".repeat(85));

    for (i, r) in results.iter().enumerate() {
        println!(
            "{:<4} {:<6.3} {:<30} {:<20} {}",
            i + 1,
            r.score,
            truncate(&r.title, 29),
            truncate(&r.category, 19),
            r.source_count,
        );
        println!("     {}", truncate(&r.description, 78));

        // Show top 2 evidence files.
        for ev in r.evidence.iter().take(2) {
            println!("       -> {}:{}", ev.file, ev.line);
        }
        println!();
    }

    Ok(())
}

fn truncate(s: &str, max: usize) -> String {
    if s.len() <= max {
        s.to_string()
    } else {
        format!("{}...", &s[..max.saturating_sub(3)])
    }
}
