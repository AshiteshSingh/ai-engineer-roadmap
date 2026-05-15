//! content-gate: structure + relation quality gate for the lesson corpus.
//!
//! Rust port of the Python `check_quality()` structure gate
//! (backend/knowledge_agent/article_generate_graph.py) plus four relation
//! checks (R1–R4). Drives the local content-improvement loop: scan once,
//! work only failing lessons, re-gate per lesson, stop when the worklist
//! empties.
//!
//! Modes:
//!   --all              scan every lesson, (over)write the worklist JSON
//!   --slug <s> --json  print one lesson's report; exit 0 if ok else 1
//!   --resolve <s>      rescan, rewrite worklist atomically; exit 0 if <s> ok
//!
//! The scan is pure CPU over ~110 small markdown files plus a small JSON
//! matrix, so every mode runs a full in-memory scan (R3 reciprocity and R4
//! similarity are global) and differs only in output/side-effects.

use std::collections::{BTreeSet, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use clap::Parser;
use serde::Serialize;

use knowledge_ml_core::{parser, similarity::SimilarityMatrix};

// Structure thresholds — kept byte-identical to the Python gate.
const MIN_WORD_COUNT: usize = 1500;
const MIN_CODE_BLOCKS: usize = 2;
const MIN_CROSS_REFS: usize = 1;
const MIN_XYFLOW_BLOCKS: usize = 5;

// Relation thresholds.
const RELATION_MIN_CROSSREFS: usize = 3;
const RELATION_TOPK: usize = 5;
const RELATION_TOPK_HITS: usize = 2;

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
}

// ── Serialized report shapes ─────────────────────────────────────────

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
    ok: bool,
    structure_issues: Vec<String>,
    relation_issues: Vec<String>,
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
    lessons: Vec<LessonReport>,
    worklist: Vec<String>,
}

// ── Byte-level scanners (ASCII patterns; UTF-8 safe) ─────────────────

#[inline]
fn is_word(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_'
}

#[inline]
fn is_word_or_dash(b: u8) -> bool {
    is_word(b) || b == b'-'
}

/// Count of ```<lang> opening fences — re.findall(r"```\w+").
fn count_code_blocks(b: &[u8]) -> usize {
    let mut c = 0;
    for i in 0..b.len() {
        if i + 3 < b.len() && b[i] == b'`' && b[i + 1] == b'`' && b[i + 2] == b'`' && is_word(b[i + 3]) {
            c += 1;
        }
    }
    c
}

/// Count of ```<tag> fences with a trailing word boundary — re.findall(r"```tag\b").
fn count_fenced_tag(b: &[u8], tag: &[u8]) -> usize {
    let needle_len = tag.len();
    let mut c = 0;
    let mut i = 0;
    while i + needle_len <= b.len() {
        if &b[i..i + needle_len] == tag {
            let after = i + needle_len;
            if after >= b.len() || !is_word(b[after]) {
                c += 1;
            }
        }
        i += 1;
    }
    c
}

/// All `/slug` targets from `](/slug)` links — re.findall(r"\]\(/[\w-]+\)").
fn extract_links(b: &[u8]) -> Vec<String> {
    let mut out = Vec::new();
    let mut i = 0;
    while i + 3 < b.len() {
        if b[i] == b']' && b[i + 1] == b'(' && b[i + 2] == b'/' {
            let start = i + 3;
            let mut j = start;
            while j < b.len() && is_word_or_dash(b[j]) {
                j += 1;
            }
            if j > start && j < b.len() && b[j] == b')' {
                if let Ok(s) = std::str::from_utf8(&b[start..j]) {
                    out.push(s.to_string());
                }
                i = j + 1;
                continue;
            }
        }
        i += 1;
    }
    out
}

/// `^##\s+<phrase>\b` on any line (H2 only; word boundary after phrase).
fn has_h2_phrase(content: &str, phrase: &str) -> bool {
    for line in content.lines() {
        let Some(rest) = line.strip_prefix("##") else {
            continue;
        };
        let trimmed = rest.trim_start_matches([' ', '\t']);
        if trimmed.len() == rest.len() {
            continue; // no whitespace after "##" (e.g. "###" or "##Foo")
        }
        if let Some(tail) = trimmed.strip_prefix(phrase) {
            if tail.as_bytes().first().map_or(true, |&c| !is_word(c)) {
                return true;
            }
        }
    }
    false
}

/// Heading classifier for R3: nearest H2/H3 starts with a relation word.
fn is_relation_heading(line: &str) -> Option<bool> {
    if !line.starts_with('#') {
        return None;
    }
    let level = line.bytes().take_while(|&c| c == b'#').count();
    if level == 0 {
        return None;
    }
    let text = line[level..].trim_start_matches([' ', '\t']).to_ascii_lowercase();
    if level == 2 || level == 3 {
        let related = text.starts_with("related")
            || text.starts_with("prerequisite")
            || text.starts_with("see also")
            || text.starts_with("next step");
        Some(related)
    } else {
        Some(false) // any other heading level resets the section
    }
}

// ── Structure gate (port of check_quality) ───────────────────────────

fn structure_check(content: &str) -> (Vec<String>, Metrics) {
    let b = content.as_bytes();
    let word_count = content.split_whitespace().count();
    let code_blocks = count_code_blocks(b);
    let cross_refs = extract_links(b).len();
    let has_title = content.trim_start().starts_with("# ");
    let section_count = content.lines().filter(|l| l.starts_with("## ")).count();
    let xyflow_blocks = count_fenced_tag(b, b"```xyflow");
    let mermaid_blocks = count_fenced_tag(b, b"```mermaid");
    let has_mental_model = has_h2_phrase(content, "Mental Model");
    let has_runtime_internals = has_h2_phrase(content, "Runtime Internals");

    let mut issues: Vec<String> = Vec::new();
    if word_count < MIN_WORD_COUNT {
        issues.push(format!("Too short: {word_count} words (min {MIN_WORD_COUNT})"));
    }
    if code_blocks < MIN_CODE_BLOCKS {
        issues.push(format!("Too few code examples: {code_blocks} (min {MIN_CODE_BLOCKS})"));
    }
    if cross_refs < MIN_CROSS_REFS {
        issues.push(format!("Missing cross-references: {cross_refs} (min {MIN_CROSS_REFS})"));
    }
    if !has_title {
        issues.push("Missing # title on first line".to_string());
    }
    if section_count < 3 {
        issues.push("Fewer than 3 ## sections".to_string());
    }
    if xyflow_blocks < MIN_XYFLOW_BLOCKS {
        issues.push(format!(
            "Too few xyflow diagrams: {xyflow_blocks} (min {MIN_XYFLOW_BLOCKS}). \
Use ```xyflow JSON fences, not ```mermaid."
        ));
    }
    if mermaid_blocks > 0 {
        issues.push(format!(
            "Found {mermaid_blocks} ```mermaid block(s) — replace each with a ```xyflow JSON diagram."
        ));
    }
    if !has_mental_model {
        issues.push(
            "Missing `## Mental Model` section (required as the second-level section before Core Concepts).".to_string(),
        );
    }
    if !has_runtime_internals {
        issues.push("Missing `## Runtime Internals` deep-dive section.".to_string());
    }

    (
        issues,
        Metrics { word_count, code_blocks, cross_refs, xyflow_blocks },
    )
}

/// Links grouped by whether they sit inside a Related/Prerequisite section.
struct LinkSets {
    all: Vec<String>,
    in_relation_section: Vec<String>,
}

fn collect_links(content: &str) -> LinkSets {
    let mut all = Vec::new();
    let mut in_relation = Vec::new();
    let mut in_relation_section = false;
    for line in content.lines() {
        if let Some(rel) = is_relation_heading(line) {
            in_relation_section = rel;
        }
        for slug in extract_links(line.as_bytes()) {
            if in_relation_section {
                in_relation.push(slug.clone());
            }
            all.push(slug);
        }
    }
    LinkSets { all, in_relation_section: in_relation }
}

// ── Scan ─────────────────────────────────────────────────────────────

struct Scan {
    report: Report,
}

fn parse_lesson_slugs(articles_ts: &Path) -> Option<Vec<String>> {
    let text = std::fs::read_to_string(articles_ts).ok()?;
    let after = text.split("const LESSON_SLUGS").nth(1)?;
    let block = after.split("];").next()?;
    let bytes = block.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'"' {
            let start = i + 1;
            let mut j = start;
            while j < bytes.len() && is_word_or_dash(bytes[j]) {
                j += 1;
            }
            if j < bytes.len() && bytes[j] == b'"' && j > start {
                out.push(String::from_utf8_lossy(&bytes[start..j]).into_owned());
            }
            i = j + 1;
        } else {
            i += 1;
        }
    }
    if out.is_empty() {
        None
    } else {
        Some(out)
    }
}

fn run_scan(args: &Args) -> anyhow::Result<Scan> {
    let lessons = parser::load_lessons(&args.content)?;
    let loaded: BTreeSet<String> = lessons.iter().map(|l| l.slug.clone()).collect();

    let canonical: Vec<String> =
        parse_lesson_slugs(&args.articles).unwrap_or_else(|| loaded.iter().cloned().collect());
    let canonical_set: HashSet<&str> = canonical.iter().map(|s| s.as_str()).collect();

    // Valid link targets: canonical ∪ on-disk (avoids false R2 on real files).
    let mut valid_targets: HashSet<String> = loaded.iter().cloned().collect();
    valid_targets.extend(canonical.iter().cloned());

    let matrix = if args.similarity.exists() {
        Some(SimilarityMatrix::load_json(&args.similarity)?)
    } else {
        None
    };
    let mut warnings = Vec::new();
    if matrix.is_none() {
        warnings.push("similarity_matrix_missing".to_string());
    }

    // Per-lesson link sets (one pass), for R3 reciprocity.
    let mut links: HashMap<String, LinkSets> = HashMap::new();
    for l in &lessons {
        links.insert(l.slug.clone(), collect_links(&l.content));
    }
    let all_targets: HashMap<&str, HashSet<&str>> = links
        .iter()
        .map(|(s, ls)| (s.as_str(), ls.all.iter().map(|x| x.as_str()).collect()))
        .collect();

    // Reciprocity gaps: A links to B in a Related section, B does not link back.
    // need_backlink[B] = {A, ...}  → B is enqueued to add B→A on its own tick.
    let mut need_backlink: HashMap<String, BTreeSet<String>> = HashMap::new();
    for l in &lessons {
        let a = l.slug.as_str();
        for b in &links[a].in_relation_section {
            if b == a || !loaded.contains(b) {
                continue;
            }
            let b_links_back = all_targets.get(b.as_str()).is_some_and(|s| s.contains(a));
            if !b_links_back {
                need_backlink.entry(b.clone()).or_default().insert(a.to_string());
            }
        }
    }

    let mut reports: Vec<LessonReport> = Vec::with_capacity(lessons.len());
    for l in &lessons {
        let slug = l.slug.clone();
        let (structure_issues, metrics) = structure_check(&l.content);
        let structure_ok = structure_issues.is_empty();

        let mut relation_issues: Vec<String> = Vec::new();
        let ls = &links[&slug];

        // R1 — minimum outbound cross-refs.
        if metrics.cross_refs < RELATION_MIN_CROSSREFS {
            relation_issues.push(format!(
                "Relations: only {} cross-refs (min {} for a connected lesson)",
                metrics.cross_refs, RELATION_MIN_CROSSREFS
            ));
        }

        // R2 — no broken slug links.
        let mut broken: BTreeSet<&str> = BTreeSet::new();
        for t in &ls.all {
            if !valid_targets.contains(t) {
                broken.insert(t.as_str());
            }
        }
        if !broken.is_empty() {
            let list = broken.iter().map(|s| format!("/{s}")).collect::<Vec<_>>().join(", ");
            relation_issues.push(format!(
                "Relations: broken cross-ref link(s) to non-existent lesson(s): {list}"
            ));
        }

        // R3 — reciprocity for Related/Prerequisite-section links.
        let mut r3_missing: BTreeSet<&str> = BTreeSet::new();
        for b in &ls.in_relation_section {
            if b == &slug || !loaded.contains(b) {
                continue;
            }
            let b_links_back = all_targets.get(b.as_str()).is_some_and(|s| s.contains(slug.as_str()));
            if !b_links_back {
                r3_missing.insert(b.as_str());
            }
        }
        for b in &r3_missing {
            relation_issues.push(format!(
                "Relations: missing reciprocal link — links to /{b} in a Related/Prerequisite section but /{b} does not link back"
            ));
        }
        // Enqueued back-link obligations onto this lesson (it is some A's B).
        if let Some(sources) = need_backlink.get(&slug) {
            for a in sources {
                relation_issues.push(format!(
                    "Relations: add reciprocal link back to /{a} (referenced from /{a}'s Related/Prerequisite section)"
                ));
            }
        }

        // R4 — similarity top-k coverage.
        if let Some(m) = &matrix {
            let top = m.top_k(&slug, RELATION_TOPK);
            if !top.is_empty() {
                let linked: &HashSet<&str> =
                    all_targets.get(slug.as_str()).expect("links computed for every lesson");
                let mut missing: Vec<String> = Vec::new();
                let mut hits = 0usize;
                for (cand, _) in &top {
                    if linked.contains(cand.as_str()) {
                        hits += 1;
                    } else {
                        missing.push(format!("/{cand}"));
                    }
                }
                if hits < RELATION_TOPK_HITS {
                    relation_issues.push(format!(
                        "Relations: only {hits}/{RELATION_TOPK} top-similar lessons cross-referenced (min {RELATION_TOPK_HITS}): missing high-similarity links to {}",
                        missing.join(", ")
                    ));
                }
            }
        }

        let relation_ok = relation_issues.is_empty();
        let ok = structure_ok && relation_ok;
        reports.push(LessonReport {
            slug: slug.clone(),
            file: format!("content/{slug}.md"),
            structure_ok,
            relation_ok,
            ok,
            structure_issues,
            relation_issues,
            metrics,
        });
    }

    // Skipped = canonical slugs with no markdown on disk (stubs).
    let skipped: Vec<String> = canonical
        .iter()
        .filter(|s| !loaded.contains(s.as_str()) && canonical_set.contains(s.as_str()))
        .cloned()
        .collect();

    let pass = reports.iter().filter(|r| r.ok).count();
    let fail = reports.len() - pass;

    // Worklist: failing slugs, most-issues-first, slug-asc tiebreak.
    let mut failing: Vec<&LessonReport> = reports.iter().filter(|r| !r.ok).collect();
    failing.sort_by(|a, b| {
        let ai = a.structure_issues.len() + a.relation_issues.len();
        let bi = b.structure_issues.len() + b.relation_issues.len();
        bi.cmp(&ai).then_with(|| a.slug.cmp(&b.slug))
    });
    let worklist: Vec<String> = failing.iter().map(|r| r.slug.clone()).collect();

    let generated_at_unix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    Ok(Scan {
        report: Report {
            generated_at_unix,
            thresholds: Thresholds {
                min_words: MIN_WORD_COUNT,
                min_code: MIN_CODE_BLOCKS,
                min_xyflow: MIN_XYFLOW_BLOCKS,
                relation_min_crossrefs: RELATION_MIN_CROSSREFS,
                relation_topk: RELATION_TOPK,
                relation_topk_hits: RELATION_TOPK_HITS,
            },
            warnings,
            summary: Summary {
                total: reports.len() + skipped.len(),
                skipped: skipped.len(),
                pass,
                fail,
            },
            skipped,
            lessons: reports,
            worklist,
        },
    })
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

fn main() -> anyhow::Result<()> {
    let args = Args::parse();
    let scan = run_scan(&args)?;
    let report = &scan.report;

    if let Some(slug) = &args.resolve {
        write_worklist(&args.output, report)?;
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
                        "{slug}: ok={} structure_ok={} relation_ok={}",
                        lr.ok, lr.structure_ok, lr.relation_ok
                    );
                    for i in lr.structure_issues.iter().chain(lr.relation_issues.iter()) {
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
    write_worklist(&args.output, report)?;
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
