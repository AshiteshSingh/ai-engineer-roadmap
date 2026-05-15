//! Seed the canonical SQLite store from markdown + roadmap meta.
//! Rust is the only thing that reads or writes `data/knowledge.db`.
//!
//!   npm run roadmap:meta   # dump data/roadmap-meta.json from lib/articles.ts
//!   cd crates/ml && cargo run -p knowledge-ml-core --release --bin seed-content

use std::path::PathBuf;

use clap::Parser;
use knowledge_ml_core::seed;
use tracing_subscriber::EnvFilter;

#[derive(Parser)]
#[command(name = "seed-content")]
struct Args {
    #[arg(long, default_value = "../../data/knowledge.db")]
    db: PathBuf,
    #[arg(long, default_value = "../../content")]
    content: PathBuf,
    #[arg(long, default_value = "../../data/roadmap-meta.json")]
    meta: PathBuf,
    #[arg(long, default_value = "../../data/jobs")]
    jobs_dir: PathBuf,
}

fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .init();
    let args = Args::parse();

    if !args.meta.exists() {
        anyhow::bail!(
            "{} not found — run `npm run roadmap:meta` first",
            args.meta.display()
        );
    }

    let (cats, lessons, sections, jobs) =
        seed::seed_content(&args.db, &args.content, &args.meta, &args.jobs_dir)?;

    println!(
        "Seeded {}: {} categories, {} lessons, {} sections, {} jobs",
        args.db.display(),
        cats,
        lessons,
        sections,
        jobs
    );
    Ok(())
}
