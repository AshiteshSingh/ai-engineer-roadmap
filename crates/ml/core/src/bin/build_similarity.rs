use clap::Parser;
use std::path::PathBuf;

use knowledge_ml_core::{parser, similarity::SimilarityMatrix};
use tracing_subscriber::EnvFilter;

#[derive(Parser)]
#[command(name = "build-similarity")]
struct Args {
    #[arg(long, default_value = "../../content")]
    content: PathBuf,
    #[arg(long, default_value = "../data/similarity-matrix.json")]
    output: PathBuf,
}

fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .init();
    let args = Args::parse();

    let lessons = parser::load_lessons(&args.content)?;
    tracing::info!("Loaded {} lessons", lessons.len());

    let device = candle::best_device()?;
    let model = candle::EmbeddingModel::from_hf("BAAI/bge-large-en-v1.5", &device)?;
    tracing::info!("Model loaded on {:?}", device);

    let matrix = SimilarityMatrix::compute(&lessons, &model)?;
    matrix.save_json(&args.output)?;

    // Print top-5 for first few lessons as verification
    for lesson in lessons.iter().take(3) {
        let top = matrix.top_k(&lesson.slug, 5);
        tracing::info!(
            "{}: {:?}",
            lesson.slug,
            top.iter()
                .map(|(s, sc)| format!("{s}={sc:.3}"))
                .collect::<Vec<_>>()
        );
    }

    Ok(())
}
