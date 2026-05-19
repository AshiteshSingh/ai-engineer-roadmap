use clap::Parser;
use std::path::PathBuf;

use aer_ml::content::{parser, similarity::SimilarityMatrix, sqlite, Lesson};
use aer_ml::dlai::model::ScrapedCourse;
use tracing_subscriber::EnvFilter;

#[derive(Parser)]
#[command(name = "build-similarity")]
struct Args {
    /// Canonical SQLite content store (preferred source).
    #[arg(long, default_value = "../../data/knowledge.db")]
    db: PathBuf,
    /// Markdown directory, used as a fallback when `--db` is absent.
    #[arg(long, default_value = "../../content")]
    content: PathBuf,
    // Runtime (lib/ml-client.ts) loads crates/ml/data/similarity-matrix.json;
    // default must land there (cwd is crates/ml when run via npm scripts).
    #[arg(long, default_value = "data/similarity-matrix.json")]
    output: PathBuf,
    /// Optional: also fold DeepLearning.AI scraped-course lessons
    /// (`data/deeplearning/<slug>.json`) into the matrix as `dlai-*` nodes.
    #[arg(long)]
    dlai_dir: Option<PathBuf>,
}

/// One similarity node per scraped DeepLearning.AI lesson.
fn dlai_lessons(dir: &std::path::Path) -> anyhow::Result<Vec<Lesson>> {
    let mut out = Vec::new();
    for entry in std::fs::read_dir(dir)? {
        let path = entry?.path();
        if !path.is_file() || path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let Ok(course) = serde_json::from_str::<ScrapedCourse>(&std::fs::read_to_string(&path)?)
        else {
            continue;
        };
        for l in &course.lessons {
            let body = ScrapedCourse::lesson_transcript(l);
            if body.trim().is_empty() {
                continue;
            }
            let excerpt: String = body.chars().take(600).collect();
            out.push(Lesson {
                slug: format!("dlai-{}-{}", course.slug, l.index),
                title: format!("{} — {}", course.title, l.title),
                excerpt,
                word_count: body.split_whitespace().count(),
                content: body,
                category: "DeepLearning.AI".to_string(),
            });
        }
    }
    Ok(out)
}

fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .init();
    let args = Args::parse();

    let mut lessons = if args.db.exists() {
        tracing::info!("Loading lessons from SQLite: {}", args.db.display());
        sqlite::load_lessons_from_sqlite(&args.db)?
    } else {
        tracing::info!(
            "SQLite db not found at {}; falling back to markdown: {}",
            args.db.display(),
            args.content.display()
        );
        parser::load_lessons(&args.content)?
    };
    tracing::info!("Loaded {} roadmap lessons", lessons.len());

    if let Some(dir) = &args.dlai_dir {
        if dir.exists() {
            let dl = dlai_lessons(dir)?;
            tracing::info!("Folding in {} DeepLearning.AI lesson nodes", dl.len());
            lessons.extend(dl);
        } else {
            tracing::warn!("--dlai-dir {} not found; skipping", dir.display());
        }
    }
    tracing::info!("Total {} lessons in matrix", lessons.len());

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
