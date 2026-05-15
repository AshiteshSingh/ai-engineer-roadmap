use clap::Parser;
use std::path::PathBuf;

use knowledge_ml_core::{parser, readability};
use tracing_subscriber::EnvFilter;

#[derive(Parser)]
#[command(name = "analyze-readability")]
struct Args {
    #[arg(long, default_value = "../../content")]
    content: PathBuf,
    #[arg(long, default_value = "../data/readability.json")]
    output: PathBuf,
}

fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .init();
    let args = Args::parse();

    let lessons = parser::load_lessons(&args.content)?;
    tracing::info!("Loaded {} lessons", lessons.len());

    let results: Vec<readability::LessonReadability> =
        lessons.iter().map(|l| readability::analyze_lesson(l)).collect();

    let file = std::fs::File::create(&args.output)?;
    serde_json::to_writer_pretty(file, &results)?;

    // Print summary
    for r in &results {
        tracing::info!(
            "{}: FK={:.1} Fog={:.1} Tech={:.3} {:?}",
            r.slug,
            r.overall.flesch_kincaid_grade,
            r.overall.gunning_fog,
            r.overall.technical_term_density,
            r.overall.difficulty
        );
    }

    Ok(())
}
