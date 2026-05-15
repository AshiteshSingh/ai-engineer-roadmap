//! Export the canonical SQLite store to JSON for Next.js. SQLite is the
//! single source of truth and only Rust reads it.
//!
//!   cd crates/ml && cargo run -p knowledge-ml-core --release --bin export-content
//!
//! Writes (relative to the knowledge app root): data/content/index.json,
//! <slug>.json per lesson, sections.json, jobs.json, courses.json,
//! course-reviews.json. Commit the JSON like crates/ml/data/readability.json.

use std::fs;
use std::path::PathBuf;

use clap::Parser;
use knowledge_ml_core::sqlite;
use tracing_subscriber::EnvFilter;

#[derive(Parser)]
#[command(name = "export-content")]
struct Args {
    #[arg(long, default_value = "../../data/knowledge.db")]
    db: PathBuf,
    #[arg(long, default_value = "../../data/content")]
    out_dir: PathBuf,
}

fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .init();
    let args = Args::parse();

    if !args.db.exists() {
        anyhow::bail!(
            "SQLite db not found at {} — run `npm run seed:content` first",
            args.db.display()
        );
    }

    let conn = sqlite::open_ro(&args.db)?;
    fs::create_dir_all(&args.out_dir)?;

    let index = sqlite::load_content_index(&conn)?;
    fs::write(
        args.out_dir.join("index.json"),
        serde_json::to_vec_pretty(&index)?,
    )?;

    let lessons = sqlite::load_lesson_full(&conn)?;
    for lesson in &lessons {
        fs::write(
            args.out_dir.join(format!("{}.json", lesson.slug)),
            serde_json::to_vec_pretty(lesson)?,
        )?;
    }

    let sections = sqlite::load_sections(&conn)?;
    fs::write(
        args.out_dir.join("sections.json"),
        serde_json::to_vec_pretty(&sections)?,
    )?;

    let jobs = sqlite::load_jobs(&conn)?;
    fs::write(
        args.out_dir.join("jobs.json"),
        serde_json::to_vec_pretty(&jobs)?,
    )?;

    let courses = sqlite::load_external_courses(&conn)?;
    fs::write(
        args.out_dir.join("courses.json"),
        serde_json::to_vec_pretty(&courses)?,
    )?;

    let reviews = sqlite::load_course_reviews(&conn)?;
    fs::write(
        args.out_dir.join("course-reviews.json"),
        serde_json::to_vec_pretty(&reviews)?,
    )?;

    tracing::info!(
        "Exported: {} categories, {} lessons, {} sections, {} jobs, {} courses, {} reviews",
        index.categories.len(),
        lessons.len(),
        sections.len(),
        jobs.len(),
        courses.len(),
        reviews.len()
    );
    println!(
        "Exported to {}: {} lessons, {} sections, {} jobs",
        args.out_dir.display(),
        lessons.len(),
        sections.len(),
        jobs.len()
    );
    Ok(())
}
