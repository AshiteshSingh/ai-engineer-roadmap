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
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use clap::Parser;
use serde::Serialize;

use knowledge_ml_core::{parser, readability, similarity::SimilarityMatrix};

// Structure thresholds — kept byte-identical to the Python gate.
const MIN_WORD_COUNT: usize = 1500;
const MIN_CODE_BLOCKS: usize = 2;
const MIN_CROSS_REFS: usize = 1;
const MIN_XYFLOW_BLOCKS: usize = 5;

// Relation thresholds.
const RELATION_MIN_CROSSREFS: usize = 3;
const RELATION_TOPK: usize = 5;
const RELATION_TOPK_HITS: usize = 2;

// Quality thresholds (blocking; disabled by --no-quality).
const Q_DUP_JACCARD: f32 = 0.50; // MM/RI cross-lesson near-duplicate ceiling
const Q_SHINGLE_K: usize = 8; // word k-shingle size
const Q_XYFLOW_DUP_OTHERS: usize = 8; // diagram skeleton shared by ≥N other lessons
const Q_XYFLOW_DUP_MIN_BLOCKS: usize = 3; // ≥N such blocks in a lesson → boilerplate
const Q_FK_MIN: f32 = 10.0;
const Q_FK_MAX: f32 = 22.0;
const Q_TECH_MIN: f32 = 0.010;
const Q_PROSE_PER_XYFLOW: usize = 200;
const Q_SECTION_MIN_PROSE: usize = 120;

// Categories (from parser::category_from_slug) that are NOT AI-engineering
// topics. With --ai-only, lessons in these categories leave the loop.
const NON_AI: [&str; 4] = [
    "Cloud Platforms",
    "AWS Deep Dives",
    "Software Engineering",
    "Other",
];

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
    /// Restrict the worklist/counts to AI-engineering categories only;
    /// non-AI lessons are excluded from the loop (not gated, not failed).
    #[arg(long)]
    ai_only: bool,
    /// Disable the quality tier (Q0–Q3); structure+relation only.
    #[arg(long)]
    no_quality: bool,
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

// ── Quality tier helpers (Q0–Q3) ─────────────────────────────────────

/// A markdown line that is an H2 (`## …`) — exactly two hashes then ws.
fn is_h2(line: &str) -> bool {
    match line.strip_prefix("##") {
        Some(rest) => {
            let t = rest.trim_start_matches([' ', '\t']);
            t.len() != rest.len() // whitespace consumed ⇒ not "###"/"##Foo"
        }
        None => false,
    }
}

/// Body text of the `## <heading>` section (until the next H2 / EOF), with
/// fenced code/xyflow blocks removed. None if the section is absent.
fn section_body(content: &str, heading: &str) -> Option<String> {
    let mut in_section = false;
    let mut out: Vec<&str> = Vec::new();
    for line in content.lines() {
        if is_h2(line) {
            if in_section {
                break; // next H2 ends the section
            }
            let rest = line.strip_prefix("##").unwrap();
            let t = rest.trim_start_matches([' ', '\t']);
            if let Some(tail) = t.strip_prefix(heading) {
                if tail.as_bytes().first().map_or(true, |&c| !is_word(c)) {
                    in_section = true;
                }
            }
            continue;
        }
        if in_section {
            out.push(line);
        }
    }
    if !in_section {
        return None;
    }
    Some(strip_fences(&out.join("\n")))
}

/// Remove ```…``` fenced blocks (code or xyflow) entirely.
fn strip_fences(s: &str) -> String {
    let mut keep = true;
    let mut out: Vec<&str> = Vec::new();
    for line in s.lines() {
        if line.trim_start().starts_with("```") {
            keep = !keep;
            continue;
        }
        if keep {
            out.push(line);
        }
    }
    out.join("\n")
}

/// Whitespace word count of fence-stripped prose (heading hashes ignored).
fn prose_words(text: &str) -> usize {
    strip_fences(text)
        .split_whitespace()
        .filter(|w| !w.chars().all(|c| c == '#'))
        .count()
}

/// Lowercased alphanumeric-token k-shingle set, hashed to u64.
fn shingle_set(text: &str, k: usize) -> HashSet<u64> {
    let toks: Vec<String> = text
        .split(|c: char| !c.is_alphanumeric())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_ascii_lowercase())
        .collect();
    let mut set = HashSet::new();
    if toks.len() < k {
        if !toks.is_empty() {
            let mut h = DefaultHasher::new();
            toks.join(" ").hash(&mut h);
            set.insert(h.finish());
        }
        return set;
    }
    for w in toks.windows(k) {
        let mut h = DefaultHasher::new();
        w.join(" ").hash(&mut h);
        set.insert(h.finish());
    }
    set
}

fn jaccard(a: &HashSet<u64>, b: &HashSet<u64>) -> f32 {
    if a.is_empty() || b.is_empty() {
        return 0.0;
    }
    let inter = a.intersection(b).count() as f32;
    let uni = a.union(b).count() as f32;
    inter / uni
}

/// Extract each ```xyflow fenced block's body.
fn xyflow_bodies(content: &str) -> Vec<String> {
    let mut blocks = Vec::new();
    let mut cur: Option<Vec<&str>> = None;
    for line in content.lines() {
        let t = line.trim_start();
        if cur.is_none() && t.starts_with("```xyflow") {
            cur = Some(Vec::new());
            continue;
        }
        if let Some(buf) = cur.as_mut() {
            if t == "```" {
                blocks.push(buf.join("\n"));
                cur = None;
            } else {
                buf.push(line);
            }
        }
    }
    blocks
}

/// Validate one xyflow block against the documented schema.
/// Ok(signature) on success; Err(reason) on any violation.
fn xyflow_signature(body: &str) -> Result<String, String> {
    let v: serde_json::Value =
        serde_json::from_str(body).map_err(|e| format!("invalid JSON ({e})"))?;
    let obj = v.as_object().ok_or("not a JSON object")?;
    match obj.get("direction").and_then(|d| d.as_str()) {
        Some("TD") | Some("LR") => {}
        _ => return Err("direction must be \"TD\" or \"LR\"".into()),
    }
    let nodes = obj
        .get("nodes")
        .and_then(|n| n.as_array())
        .ok_or("missing nodes[]")?;
    let mut ids: HashSet<&str> = HashSet::new();
    let mut shapes: Vec<&str> = Vec::new();
    for (i, n) in nodes.iter().enumerate() {
        let no = n.as_object().ok_or(format!("node {i} not an object"))?;
        let id = no
            .get("id")
            .and_then(|x| x.as_str())
            .ok_or(format!("node {i} missing string id"))?;
        no.get("label")
            .and_then(|x| x.as_str())
            .ok_or(format!("node {id} missing string label"))?;
        let shape = no
            .get("shape")
            .and_then(|x| x.as_str())
            .ok_or(format!("node {id} missing shape"))?;
        if !matches!(shape, "rect" | "circle" | "diamond" | "stadium") {
            return Err(format!("node {id} bad shape '{shape}'"));
        }
        ids.insert(id);
        shapes.push(shape);
    }
    let edges = obj
        .get("edges")
        .and_then(|e| e.as_array())
        .ok_or("missing edges[]")?;
    for (i, e) in edges.iter().enumerate() {
        let eo = e.as_object().ok_or(format!("edge {i} not an object"))?;
        let s = eo
            .get("source")
            .and_then(|x| x.as_str())
            .ok_or(format!("edge {i} missing source"))?;
        let t = eo
            .get("target")
            .and_then(|x| x.as_str())
            .ok_or(format!("edge {i} missing target"))?;
        if !ids.contains(s) {
            return Err(format!("edge {i} source '{s}' is not a node id"));
        }
        if !ids.contains(t) {
            return Err(format!("edge {i} target '{t}' is not a node id"));
        }
    }
    shapes.sort_unstable();
    Ok(format!(
        "n{}|{}|e{}",
        nodes.len(),
        shapes.join(","),
        edges.len()
    ))
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

    // ── Quality corpus pass (Q1 needs cross-lesson comparison) ──────
    let quality_on = !args.no_quality;
    struct QData {
        mm: Option<HashSet<u64>>,
        ri: Option<HashSet<u64>>,
        mm_prose: usize,
        ri_prose: usize,
        sigs: Vec<String>,
        xy_errs: Vec<String>,
        prose_total: usize,
    }
    let mut qmap: HashMap<String, QData> = HashMap::new();
    let mut sig_lessons: HashMap<String, HashSet<String>> = HashMap::new();
    if quality_on {
        for l in &lessons {
            let mm = section_body(&l.content, "Mental Model");
            let ri = section_body(&l.content, "Runtime Internals");
            let mm_prose = mm.as_deref().map(prose_words).unwrap_or(0);
            let ri_prose = ri.as_deref().map(prose_words).unwrap_or(0);
            let mm_sh = mm.as_deref().map(|s| shingle_set(s, Q_SHINGLE_K));
            let ri_sh = ri.as_deref().map(|s| shingle_set(s, Q_SHINGLE_K));
            let mut sigs = Vec::new();
            let mut xy_errs = Vec::new();
            for (i, body) in xyflow_bodies(&l.content).into_iter().enumerate() {
                match xyflow_signature(&body) {
                    Ok(sig) => sigs.push(sig),
                    Err(why) => xy_errs.push(format!("block {}: {why}", i + 1)),
                }
            }
            for s in sigs.iter().collect::<BTreeSet<_>>() {
                sig_lessons
                    .entry(s.clone())
                    .or_default()
                    .insert(l.slug.clone());
            }
            qmap.insert(
                l.slug.clone(),
                QData {
                    mm: mm_sh,
                    ri: ri_sh,
                    mm_prose,
                    ri_prose,
                    sigs,
                    xy_errs,
                    prose_total: prose_words(&l.content),
                },
            );
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

        // R3 — reciprocity. The obligation falls solely on the lesson that
        // must ADD the outgoing back-link (resolvable by editing only that
        // lesson on its own tick). We deliberately do NOT also fail the
        // lesson that already links out: it cannot fix the other side by
        // editing itself, which would livelock the single-file-per-tick loop.
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

        // ── Quality tier (Q0–Q3) — blocking unless --no-quality ──────
        let mut quality_issues: Vec<String> = Vec::new();
        if quality_on {
            if let Some(q) = qmap.get(&slug) {
                // Q0 — xyflow JSON / schema validity
                for e in &q.xy_errs {
                    quality_issues.push(format!("Q0: xyflow {e}"));
                }
                // Q1 — MM / RI cross-lesson near-duplicate (boilerplate)
                for (label, mine) in [("Mental Model", &q.mm), ("Runtime Internals", &q.ri)] {
                    if let Some(mine) = mine {
                        let mut best = 0.0f32;
                        let mut who = String::new();
                        for (os, oq) in &qmap {
                            if os == &slug {
                                continue;
                            }
                            let other = if label == "Mental Model" { &oq.mm } else { &oq.ri };
                            if let Some(other) = other {
                                let j = jaccard(mine, other);
                                if j > best {
                                    best = j;
                                    who = os.clone();
                                }
                            }
                        }
                        if best >= Q_DUP_JACCARD {
                            quality_issues.push(format!(
                                "Q1: {label} section is {best:.2} Jaccard-similar to /{who} (ceiling {Q_DUP_JACCARD:.2}) — rewrite it lesson-specifically, drop the template"
                            ));
                        }
                    }
                }
                // Q1 — reused xyflow skeletons
                let dup_blocks = q
                    .sigs
                    .iter()
                    .filter(|s| {
                        sig_lessons
                            .get(*s)
                            .map_or(0, |set| set.iter().filter(|x| *x != &slug).count())
                            >= Q_XYFLOW_DUP_OTHERS
                    })
                    .count();
                if dup_blocks >= Q_XYFLOW_DUP_MIN_BLOCKS {
                    quality_issues.push(format!(
                        "Q1: {dup_blocks} xyflow diagrams reuse a skeleton shared by ≥{Q_XYFLOW_DUP_OTHERS} other lessons — make the diagrams lesson-specific"
                    ));
                }
                // Q2 — readability / substance (reuses readability.rs)
                let rm = readability::analyze_lesson(l).overall;
                if rm.flesch_kincaid_grade < Q_FK_MIN || rm.flesch_kincaid_grade > Q_FK_MAX {
                    quality_issues.push(format!(
                        "Q2: Flesch-Kincaid {:.1} outside [{Q_FK_MIN:.0},{Q_FK_MAX:.0}]",
                        rm.flesch_kincaid_grade
                    ));
                }
                if rm.technical_term_density < Q_TECH_MIN {
                    quality_issues.push(format!(
                        "Q2: technical-term density {:.4} < {Q_TECH_MIN:.3} (filler / not substantive)",
                        rm.technical_term_density
                    ));
                }
                // Q3 — prose / diagram balance
                if metrics.xyflow_blocks > 0 {
                    let ratio = q.prose_total / metrics.xyflow_blocks;
                    if ratio < Q_PROSE_PER_XYFLOW {
                        quality_issues.push(format!(
                            "Q3: {ratio} prose words per xyflow (min {Q_PROSE_PER_XYFLOW}) — add explanation, not just diagrams"
                        ));
                    }
                }
                if q.mm.is_some() && q.mm_prose < Q_SECTION_MIN_PROSE {
                    quality_issues.push(format!(
                        "Q3: Mental Model section has {} prose words (min {Q_SECTION_MIN_PROSE})",
                        q.mm_prose
                    ));
                }
                if q.ri.is_some() && q.ri_prose < Q_SECTION_MIN_PROSE {
                    quality_issues.push(format!(
                        "Q3: Runtime Internals section has {} prose words (min {Q_SECTION_MIN_PROSE})",
                        q.ri_prose
                    ));
                }
            }
        }
        let quality_ok = quality_issues.is_empty();
        let ok = structure_ok && relation_ok && quality_ok;
        reports.push(LessonReport {
            slug: slug.clone(),
            file: format!("content/{slug}.md"),
            structure_ok,
            relation_ok,
            quality_ok,
            ok,
            structure_issues,
            relation_issues,
            quality_issues,
            metrics,
        });
    }

    // Skipped = canonical slugs with no markdown on disk (stubs).
    let skipped: Vec<String> = canonical
        .iter()
        .filter(|s| !loaded.contains(s.as_str()) && canonical_set.contains(s.as_str()))
        .cloned()
        .collect();

    // AI-topics-only scope: lessons in non-AI categories leave the loop
    // entirely — not gated, not failed, not counted.
    let non_ai_slugs: BTreeSet<String> = if args.ai_only {
        lessons
            .iter()
            .filter(|l| NON_AI.contains(&l.category.as_str()))
            .map(|l| l.slug.clone())
            .collect()
    } else {
        BTreeSet::new()
    };
    let excluded_non_ai: Vec<String> = non_ai_slugs.iter().cloned().collect();

    let scoped: Vec<&LessonReport> = reports
        .iter()
        .filter(|r| !non_ai_slugs.contains(&r.slug))
        .collect();
    let scoped_total = scoped.len();
    let pass = scoped.iter().filter(|r| r.ok).count();
    let fail = scoped_total - pass;

    // Worklist: failing in-scope slugs, most-issues-first, slug-asc tiebreak.
    let mut failing: Vec<&LessonReport> =
        scoped.into_iter().filter(|r| !r.ok).collect();
    failing.sort_by(|a, b| {
        let ai = a.structure_issues.len() + a.relation_issues.len() + a.quality_issues.len();
        let bi = b.structure_issues.len() + b.relation_issues.len() + b.quality_issues.len();
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
                q_dup_jaccard: Q_DUP_JACCARD,
                q_fk_range: [Q_FK_MIN, Q_FK_MAX],
                q_tech_min: Q_TECH_MIN,
                q_prose_per_xyflow: Q_PROSE_PER_XYFLOW,
                quality_enabled: !args.no_quality,
            },
            warnings,
            summary: Summary {
                total: scoped_total + skipped.len(),
                skipped: skipped.len(),
                pass,
                fail,
            },
            skipped,
            excluded_non_ai,
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

#[cfg(test)]
mod tests {
    use super::*;

    const VALID: &str = r#"{"direction":"TD","nodes":[{"id":"a","label":"A","shape":"rect"},{"id":"b","label":"B","shape":"circle"}],"edges":[{"source":"a","target":"b"}]}"#;

    #[test]
    fn xyflow_valid_returns_signature() {
        let sig = xyflow_signature(VALID).unwrap();
        assert_eq!(sig, "n2|circle,rect|e1");
    }

    #[test]
    fn xyflow_rejects_bad_json_shape_and_dangling_edge() {
        assert!(xyflow_signature("{not json").is_err());
        assert!(xyflow_signature(
            r#"{"direction":"TD","nodes":[{"id":"a","label":"A","shape":"hex"}],"edges":[]}"#
        )
        .is_err());
        assert!(xyflow_signature(
            r#"{"direction":"LR","nodes":[{"id":"a","label":"A","shape":"rect"}],"edges":[{"source":"a","target":"z"}]}"#
        )
        .is_err());
        assert!(xyflow_signature(
            r#"{"direction":"DIAG","nodes":[],"edges":[]}"#
        )
        .is_err());
    }

    #[test]
    fn jaccard_identical_and_disjoint() {
        let a = shingle_set("the mental model is a closed loop control system", 3);
        assert!((jaccard(&a, &a) - 1.0).abs() < 1e-6);
        let b = shingle_set("entirely different words appearing nowhere alike here", 3);
        assert!(jaccard(&a, &b) < 0.05);
    }

    #[test]
    fn section_body_extracts_until_next_h2() {
        let md = "# T\n\n## Mental Model\n\nfirst para here.\n\n```rust\ncode\n```\n\nmore.\n\n## Next\n\nignored.";
        let body = section_body(md, "Mental Model").unwrap();
        assert!(body.contains("first para here."));
        assert!(body.contains("more."));
        assert!(!body.contains("ignored."));
        assert!(!body.contains("code")); // fenced block stripped
        assert!(section_body(md, "Runtime Internals").is_none());
    }
}
