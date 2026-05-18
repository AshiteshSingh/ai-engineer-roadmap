//! audio-gate: quality + audio-experience gate over generated AudioMeta JSON.
//!
//! Mirrors `crates/ml/core/src/bin/content_gate.rs`:
//!   --all              scan every <dir>/*.json, (over)write the worklist
//!   --slug <s> [--json] gate one file; exit 0 ok / 1 fail / 2 not found
//!
//! Run from `crates/ml` (npm `audio:gate:scan` / `audio:gate:check`):
//!   cargo run -q -p audio-guide --release --bin audio-gate -- --all

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use clap::Parser;
use serde::Serialize;

use aer_ml::audio_guide::audio_meta::AudioMeta;
use aer_ml::audio_guide::gate::{self, AudioGateReport};

#[derive(Parser)]
#[command(name = "audio-gate", about = "Quality/audio-experience gate for AudioMeta JSON")]
struct Args {
    /// Directory of generated AudioMeta JSON files.
    #[arg(long, default_value = "../../data/audio")]
    dir: PathBuf,
    /// Worklist JSON written by --all.
    #[arg(long, default_value = "../../data/audio-gate-worklist.json")]
    output: PathBuf,
    /// Gate a single slug (<dir>/<slug>.json) and print its report.
    #[arg(long)]
    slug: Option<String>,
    /// Emit the report JSON to stdout (for --slug).
    #[arg(long)]
    json: bool,
    /// Scan all files and write the worklist (default mode).
    #[arg(long)]
    all: bool,
}

#[derive(Serialize)]
struct Thresholds {
    min_chapters: usize,
    min_words_per_chapter: usize,
    min_total_words: usize,
    max_title_words: usize,
    max_title_chars: usize,
    sentence_cv_min: f64,
}

#[derive(Serialize)]
struct Summary {
    total: usize,
    pass: usize,
    fail: usize,
}

#[derive(Serialize)]
struct Report {
    generated_at_unix: u64,
    thresholds: Thresholds,
    summary: Summary,
    lessons: Vec<AudioGateReport>,
    /// Failing slugs, most-failures-first then slug-asc (loop consumes this).
    worklist: Vec<String>,
}

fn thresholds() -> Thresholds {
    Thresholds {
        min_chapters: gate::MIN_CHAPTERS,
        min_words_per_chapter: gate::MIN_WORDS_PER_CHAPTER,
        min_total_words: gate::MIN_TOTAL_WORDS,
        max_title_words: gate::MAX_TITLE_WORDS,
        max_title_chars: gate::MAX_TITLE_CHARS,
        sentence_cv_min: gate::SENTENCE_CV_MIN,
    }
}

fn load(path: &Path) -> anyhow::Result<AudioMeta> {
    let raw = std::fs::read_to_string(path)
        .map_err(|e| anyhow::anyhow!("reading {}: {e}", path.display()))?;
    serde_json::from_str(&raw)
        .map_err(|e| anyhow::anyhow!("parsing {}: {e}", path.display()))
}

fn now_unix() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// Atomic write: tmp sibling + rename (same dir → same filesystem).
fn write_worklist(path: &Path, report: &Report) -> anyhow::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_string_pretty(report)?)?;
    std::fs::rename(&tmp, path)?;
    Ok(())
}

fn main() -> anyhow::Result<()> {
    let args = Args::parse();

    if let Some(slug) = &args.slug {
        let path = args.dir.join(format!("{slug}.json"));
        if !path.exists() {
            eprintln!("slug not found: {}", path.display());
            std::process::exit(2);
        }
        let meta = load(&path)?;
        let r = gate::gate_audio(&meta);
        if args.json {
            println!("{}", serde_json::to_string_pretty(&r)?);
        } else {
            eprintln!("{slug}: ok={} failures={} warnings={}", r.ok, r.failures.len(), r.warnings.len());
            for f in &r.failures {
                eprintln!("  ✗ [{}]{} {}", f.rule, f.chapter.map(|c| format!(" ch{c}")).unwrap_or_default(), f.detail);
            }
            for w in &r.warnings {
                eprintln!("  ! [{}]{} {}", w.rule, w.chapter.map(|c| format!(" ch{c}")).unwrap_or_default(), w.detail);
            }
        }
        std::process::exit(if r.ok { 0 } else { 1 });
    }

    // Default: --all
    let mut files: Vec<PathBuf> = std::fs::read_dir(&args.dir)
        .map_err(|e| anyhow::anyhow!("reading dir {}: {e}", args.dir.display()))?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().and_then(|s| s.to_str()) == Some("json"))
        .collect();
    files.sort();

    let mut lessons: Vec<AudioGateReport> = Vec::with_capacity(files.len());
    for f in &files {
        match load(f) {
            Ok(meta) => lessons.push(gate::gate_audio(&meta)),
            Err(e) => {
                // An unparseable AudioMeta is itself a hard failure.
                let slug = f.file_stem().and_then(|s| s.to_str()).unwrap_or("?").to_string();
                lessons.push(AudioGateReport {
                    slug: slug.clone(),
                    title: String::new(),
                    ok: false,
                    failures: vec![aer_ml::audio_guide::gate::AudioViolation {
                        chapter: None,
                        rule: "unparseable",
                        detail: e.to_string(),
                    }],
                    warnings: vec![],
                    metrics: aer_ml::audio_guide::gate::AudioMetrics {
                        chapters: 0,
                        total_words: 0,
                        total_duration_secs: 0,
                        mean_words_per_chapter: 0,
                        sentence_len_cv: 0.0,
                    },
                });
            }
        }
    }

    let pass = lessons.iter().filter(|l| l.ok).count();
    let fail = lessons.len() - pass;
    let mut worklist: Vec<(&String, usize)> = lessons
        .iter()
        .filter(|l| !l.ok)
        .map(|l| (&l.slug, l.failures.len()))
        .collect();
    worklist.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(b.0)));
    let worklist: Vec<String> = worklist.into_iter().map(|(s, _)| s.clone()).collect();

    let report = Report {
        generated_at_unix: now_unix(),
        thresholds: thresholds(),
        summary: Summary { total: lessons.len(), pass, fail },
        lessons,
        worklist,
    };
    write_worklist(&args.output, &report)?;
    eprintln!(
        "audio-gate: total={} pass={} fail={} worklist={} → {}",
        report.summary.total,
        report.summary.pass,
        report.summary.fail,
        report.worklist.len(),
        args.output.display()
    );
    if !report.worklist.is_empty() {
        eprintln!("failing: {}", report.worklist.join(", "));
    }
    Ok(())
}
