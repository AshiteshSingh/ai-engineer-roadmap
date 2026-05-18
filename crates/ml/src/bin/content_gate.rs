//! content-gate: structure + relation + quality gate for the lesson corpus.
//!
//! The checking logic now lives in the shared, config-driven
//! `aer_ml::content::checker` engine (thresholds from
//! `aer_ml::content::profiles`, on-disk config at
//! `crates/ml/quality-profiles.toml`). This binary is a thin adapter: it
//! does the I/O (load lessons, parse articles.ts, load the similarity
//! matrix), runs the engine, and **projects** the generic engine report
//! into the historical worklist JSON shape — byte-for-byte unchanged so
//! the content-loop tooling keeps working.
//!
//! Modes:
//!   --all              scan every lesson, (over)write the worklist JSON
//!   --slug <s> --json  print one lesson's report; exit 0 if ok else 1
//!   --resolve <s>      rescan, rewrite worklist atomically; exit 0 if <s> ok
//!
//! With the built-in `deep-dive` profile (the default for every slug) the
//! output is identical to the pre-refactor gate; per-slug overrides in the
//! TOML (e.g. `rag → overview`) relax specific lessons without touching any
//! other lesson's verdict.

use std::path::{Path, PathBuf};

use clap::Parser;
use serde::Serialize;

use aer_ml::content::checker::{self, EngineReport};
use aer_ml::content::profiles::ProfileSet;
use aer_ml::content::{parser, similarity::SimilarityMatrix};

#[derive(Parser)]
#[command(name = "content-gate")]
struct Args {
    /// Markdown lesson directory (source of truth the loop edits).
    #[arg(long, default_value = "../../content")]
    content: PathBuf,
    /// articles.ts — canonical slug list (LESSON_SLUGS).
    #[arg(long, default_value = "../../lib/articles.ts")]
    articles: PathBuf,
    /// Precomputed similarity matrix (R4). Missing => R4 skipped + warning.
    #[arg(long, default_value = "../data/similarity-matrix.json")]
    similarity: PathBuf,
    /// Quality-profile config (TOML). Missing/invalid => built-in defaults
    /// (== historical thresholds), logged to stderr only.
    #[arg(long, default_value = "quality-profiles.toml")]
    profiles: PathBuf,
    /// Worklist JSON written by --all / --resolve.
    #[arg(long, default_value = "../../data/content-loop-worklist.json")]
    output: PathBuf,
    /// Gate a single slug and print its report.
    #[arg(long)]
    slug: Option<String>,
    /// Rescan, rewrite the worklist, exit per this slug's pass/fail.
    #[arg(long)]
    resolve: Option<String>,
    /// Emit JSON to stdout (for --slug).
    #[arg(long)]
    json: bool,
    /// Scan all lessons and write the worklist (default mode).
    #[arg(long)]
    all: bool,
    /// Restrict the worklist/counts to AI-engineering categories only;
    /// non-AI lessons are excluded from the loop (not gated, not failed).
    #[arg(long)]
    ai_only: bool,
    /// Disable the quality tier (Q0–Q3); structure+relation only.
    #[arg(long)]
    no_quality: bool,
}

// ── Serialized report shapes (unchanged: a loop-tooling contract) ────

#[derive(Serialize)]
struct Metrics {
    #[serde(rename = "wordCount")]
    word_count: usize,
    #[serde(rename = "codeBlocks")]
    code_blocks: usize,
    #[serde(rename = "crossRefs")]
    cross_refs: usize,
    #[serde(rename = "xyflowBlocks")]
    xyflow_blocks: usize,
}

#[derive(Serialize)]
struct LessonReport {
    slug: String,
    file: String,
    structure_ok: bool,
    relation_ok: bool,
    quality_ok: bool,
    ok: bool,
    structure_issues: Vec<String>,
    relation_issues: Vec<String>,
    quality_issues: Vec<String>,
    metrics: Metrics,
}

#[derive(Serialize)]
struct Thresholds {
    #[serde(rename = "minWords")]
    min_words: usize,
    #[serde(rename = "minCode")]
    min_code: usize,
    #[serde(rename = "minXyflow")]
    min_xyflow: usize,
    #[serde(rename = "relationMinCrossrefs")]
    relation_min_crossrefs: usize,
    #[serde(rename = "relationTopK")]
    relation_topk: usize,
    #[serde(rename = "relationTopKHits")]
    relation_topk_hits: usize,
    #[serde(rename = "qDupJaccard")]
    q_dup_jaccard: f32,
    #[serde(rename = "qFkRange")]
    q_fk_range: [f32; 2],
    #[serde(rename = "qTechMin")]
    q_tech_min: f32,
    #[serde(rename = "qProsePerXyflow")]
    q_prose_per_xyflow: usize,
    #[serde(rename = "qualityEnabled")]
    quality_enabled: bool,
}

#[derive(Serialize)]
struct Summary {
    total: usize,
    skipped: usize,
    pass: usize,
    fail: usize,
}

#[derive(Serialize)]
struct Report {
    generated_at_unix: u64,
    thresholds: Thresholds,
    warnings: Vec<String>,
    summary: Summary,
    skipped: Vec<String>,
    excluded_non_ai: Vec<String>,
    lessons: Vec<LessonReport>,
    worklist: Vec<String>,
}

/// Project the generic engine report into the historical worklist shape.
/// The global `thresholds` block comes from the *default* profile so it
/// stays byte-identical even when per-slug overrides exist.
fn project(engine: EngineReport, profiles: &ProfileSet) -> Report {
    let dp = profiles.default_profile();
    let lessons = engine
        .lessons
        .into_iter()
        .map(|o| LessonReport {
            slug: o.slug,
            file: o.file,
            structure_ok: o.structure_ok,
            relation_ok: o.relation_ok,
            quality_ok: o.quality_ok,
            ok: o.ok,
            structure_issues: o.structure_issues,
            relation_issues: o.relation_issues,
            quality_issues: o.quality_issues,
            metrics: Metrics {
                word_count: o.metrics.word_count,
                code_blocks: o.metrics.code_blocks,
                cross_refs: o.metrics.cross_refs,
                xyflow_blocks: o.metrics.xyflow_blocks,
            },
        })
        .collect();
    Report {
        generated_at_unix: engine.generated_at_unix,
        thresholds: Thresholds {
            min_words: dp.structure.min_word_count,
            min_code: dp.structure.min_code_blocks,
            min_xyflow: dp.structure.min_xyflow_blocks,
            relation_min_crossrefs: dp.relation.min_crossrefs,
            relation_topk: dp.relation.topk,
            relation_topk_hits: dp.relation.topk_hits,
            q_dup_jaccard: dp.quality.dup_jaccard,
            q_fk_range: [dp.quality.fk_min, dp.quality.fk_max],
            q_tech_min: dp.quality.tech_min,
            q_prose_per_xyflow: dp.quality.prose_per_xyflow,
            quality_enabled: engine.quality_enabled,
        },
        warnings: engine.warnings,
        summary: Summary {
            total: engine.summary_total,
            skipped: engine.summary_skipped,
            pass: engine.summary_pass,
            fail: engine.summary_fail,
        },
        skipped: engine.skipped,
        excluded_non_ai: engine.excluded_non_ai,
        lessons,
        worklist: engine.worklist,
    }
}

/// Atomic write: tmp sibling + rename (same dir → same filesystem).
fn write_worklist(path: &Path, report: &Report) -> anyhow::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension("json.tmp");
    let json = serde_json::to_string_pretty(report)?;
    std::fs::write(&tmp, json)?;
    std::fs::rename(&tmp, path)?;
    Ok(())
}

fn build_report(args: &Args) -> anyhow::Result<Report> {
    let profiles = ProfileSet::load_or_builtin(&args.profiles);

    let lessons = parser::load_lessons(&args.content)?;
    let loaded: Vec<String> = lessons.iter().map(|l| l.slug.clone()).collect();
    let canonical: Vec<String> =
        checker::scan::parse_lesson_slugs(&args.articles).unwrap_or(loaded);

    let matrix = if args.similarity.exists() {
        Some(SimilarityMatrix::load_json(&args.similarity)?)
    } else {
        None
    };

    let engine = checker::run_content(
        &lessons,
        &canonical,
        matrix.as_ref(),
        &profiles,
        args.no_quality,
        args.ai_only,
    );
    Ok(project(engine, &profiles))
}

fn main() -> anyhow::Result<()> {
    let args = Args::parse();
    let report = build_report(&args)?;

    if let Some(slug) = &args.resolve {
        write_worklist(&args.output, &report)?;
        let lr = report.lessons.iter().find(|r| &r.slug == slug);
        let ok = lr.map(|r| r.ok).unwrap_or(false);
        eprintln!(
            "resolved {slug}: ok={ok} remaining={} (worklist {})",
            report.worklist.len(),
            args.output.display()
        );
        std::process::exit(if ok { 0 } else { 1 });
    }

    if let Some(slug) = &args.slug {
        match report.lessons.iter().find(|r| &r.slug == slug) {
            Some(lr) => {
                if args.json {
                    println!("{}", serde_json::to_string_pretty(lr)?);
                } else {
                    eprintln!(
                        "{slug}: ok={} structure_ok={} relation_ok={} quality_ok={}",
                        lr.ok, lr.structure_ok, lr.relation_ok, lr.quality_ok
                    );
                    for i in lr
                        .structure_issues
                        .iter()
                        .chain(lr.relation_issues.iter())
                        .chain(lr.quality_issues.iter())
                    {
                        eprintln!("  - {i}");
                    }
                }
                std::process::exit(if lr.ok { 0 } else { 1 });
            }
            None => {
                eprintln!("slug not found in corpus: {slug}");
                std::process::exit(2);
            }
        }
    }

    // Default: --all
    write_worklist(&args.output, &report)?;
    eprintln!(
        "content-gate: total={} skipped={} pass={} fail={} worklist={} → {}",
        report.summary.total,
        report.summary.skipped,
        report.summary.pass,
        report.summary.fail,
        report.worklist.len(),
        args.output.display()
    );
    if !report.warnings.is_empty() {
        eprintln!("warnings: {}", report.warnings.join(", "));
    }
    Ok(())
}
