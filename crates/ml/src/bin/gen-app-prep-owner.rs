//! Owner-only, evidence-grounded interview-prep generator. Sibling to
//! `gen-app-prep` but a SEPARATE artifact lane: it feeds a curated, git/code-
//! verified evidence dossier + the same job description the public prep was
//! built from into the `app_prep_owner` graph and writes
//! `<out-dir>/<slug>.owner.json`. It NEVER touches `<slug>.json`, so the public
//! `gen-app-prep` / `gen-app-prep-loop` runs and this one can't clobber each
//! other → the personalization is regen-proof in both directions.
//!
//!   cd crates/ml && cargo run -p aer-ml --release --bin gen-app-prep-owner -- \
//!       --slug european-central-bank-ssm-cockpit-developer \
//!       --evidence-file ../../data/app-prep/_evidence/cortex-portal.md
//!
//! The JD/company/position default to the values in the existing public
//! `<slug>.json` so the owner prep annotates exactly the prep it sits beside.

use std::path::PathBuf;

use aer_ml::server::{graphs::app_prep_owner, llm};
use clap::Parser;
use serde_json::{json, Value};
use tracing_subscriber::EnvFilter;

#[derive(Parser)]
#[command(name = "gen-app-prep-owner")]
struct Args {
    /// URL slug, e.g. european-central-bank-ssm-cockpit-developer.
    #[arg(long)]
    slug: String,
    /// Path to the verified evidence dossier (markdown).
    #[arg(long)]
    evidence_file: PathBuf,
    /// Job-description text; used verbatim when set.
    #[arg(long)]
    jd: Option<String>,
    /// Path to a JD file (takes precedence over --jd).
    #[arg(long)]
    jd_file: Option<PathBuf>,
    /// Company; defaults to the value in the existing <slug>.json.
    #[arg(long)]
    company: Option<String>,
    /// Position; defaults to the value in the existing <slug>.json.
    #[arg(long)]
    position: Option<String>,
    /// Directory holding <slug>.json and the written <slug>.owner.json.
    #[arg(long, default_value = "../../data/app-prep")]
    out_dir: PathBuf,
    /// Print the artifact instead of writing it.
    #[arg(long)]
    no_write: bool,
}

/// Read a string field from the existing public artifact, if present.
fn seed_field(seed: &Option<Value>, key: &str) -> Option<String> {
    seed
        .as_ref()
        .and_then(|v| v.get(key))
        .and_then(|v| v.as_str())
        .map(str::to_string)
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .init();
    let args = Args::parse();

    let slug = args.slug.trim().to_string();
    anyhow::ensure!(!slug.is_empty(), "--slug is required");

    let evidence = std::fs::read_to_string(&args.evidence_file).map_err(|e| {
        anyhow::anyhow!("reading --evidence-file {}: {e}", args.evidence_file.display())
    })?;
    anyhow::ensure!(!evidence.trim().is_empty(), "evidence dossier is empty");

    // The existing public artifact is the default source of JD/company/position
    // so the owner prep annotates exactly the prep it sits beside.
    let seed_path = args.out_dir.join(format!("{slug}.json"));
    let seed: Option<Value> = std::fs::read_to_string(&seed_path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok());

    let jd = if let Some(path) = &args.jd_file {
        std::fs::read_to_string(path)
            .map_err(|e| anyhow::anyhow!("reading --jd-file {}: {e}", path.display()))?
    } else if let Some(text) = args.jd.clone().filter(|t| !t.trim().is_empty()) {
        text
    } else {
        seed_field(&seed, "jobDescription").unwrap_or_default()
    };
    anyhow::ensure!(
        !jd.trim().is_empty(),
        "no job description: pass --jd/--jd-file or generate the public {slug}.json first"
    );

    let company = args
        .company
        .clone()
        .or_else(|| seed_field(&seed, "company"))
        .unwrap_or_default();
    let position = args
        .position
        .clone()
        .or_else(|| seed_field(&seed, "position"))
        .unwrap_or_default();

    let cfg = llm::LlmConfig::from_env();
    let client = llm::reqwest_client(&cfg);

    println!("Generating OWNER prep: {company} — {position}  (slug={slug})");
    println!("Pipeline: [public {slug}.json JD + evidence dossier] -> app_prep_owner");
    println!();

    let result = app_prep_owner::run(
        json!({
            "company": company,
            "position": position,
            "job_description": jd,
            "evidence": evidence,
        }),
        &client,
        &cfg.model,
        cfg.temperature,
    )
    .await?;

    let owner_prep = result
        .get("owner_prep")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    anyhow::ensure!(
        !owner_prep.trim().is_empty(),
        "app_prep_owner returned empty owner_prep (JD or evidence too thin?)"
    );

    let artifact = json!({
        "slug": slug,
        "company": company,
        "position": position,
        "ownerPrep": owner_prep,
        "generatedAt": chrono::Utc::now().to_rfc3339(),
    });

    if args.no_write {
        println!("{}", serde_json::to_string_pretty(&artifact)?);
    } else {
        std::fs::create_dir_all(&args.out_dir)?;
        let out_path = args.out_dir.join(format!("{slug}.owner.json"));
        std::fs::write(&out_path, serde_json::to_string_pretty(&artifact)?)?;
        println!("Wrote {}", out_path.display());
    }

    println!("Done! owner_prep={} chars", owner_prep.len());
    Ok(())
}
