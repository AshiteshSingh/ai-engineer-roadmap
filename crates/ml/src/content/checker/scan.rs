//! Pure byte/markdown scanners shared by the content gate and `hub-gate`.
//!
//! Moved **verbatim** from `bin/content_gate.rs` (only `structure_check` is
//! now profile-driven: each literal threshold became a `StructureCfg`
//! field). With the built-in `deep-dive` profile every threshold equals the
//! historical constant, so the emitted issue strings and their order are
//! byte-identical to the pre-refactor gate.

use std::collections::hash_map::DefaultHasher;
use std::collections::HashSet;
use std::hash::{Hash, Hasher};

use crate::content::profiles::StructureCfg;

/// Per-lesson structural metrics (serialized into the worklist as `metrics`).
#[derive(Debug, Clone, Copy)]
pub struct ContentMetrics {
    pub word_count: usize,
    pub code_blocks: usize,
    pub cross_refs: usize,
}

// ── Byte-level scanners (ASCII patterns; UTF-8 safe) ─────────────────

#[inline]
pub fn is_word(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_'
}

#[inline]
pub fn is_word_or_dash(b: u8) -> bool {
    is_word(b) || b == b'-'
}

/// Count of ```<lang> opening fences — re.findall(r"```\w+").
pub fn count_code_blocks(b: &[u8]) -> usize {
    let mut c = 0;
    for i in 0..b.len() {
        if i + 3 < b.len() && b[i] == b'`' && b[i + 1] == b'`' && b[i + 2] == b'`' && is_word(b[i + 3]) {
            c += 1;
        }
    }
    c
}

/// Count of ```<tag> fences with a trailing word boundary — re.findall(r"```tag\b").
pub fn count_fenced_tag(b: &[u8], tag: &[u8]) -> usize {
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
pub fn extract_links(b: &[u8]) -> Vec<String> {
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
pub fn has_h2_phrase(content: &str, phrase: &str) -> bool {
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
pub fn is_relation_heading(line: &str) -> Option<bool> {
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

// ── Structure gate (profile-driven port of check_quality) ────────────

/// Port of the historical `structure_check`. Each former `const` is now a
/// [`StructureCfg`] field; with `deep-dive` the values, conditions, push
/// order and message text are byte-identical to the pre-refactor gate.
pub fn structure_check(content: &str, s: &StructureCfg) -> (Vec<String>, ContentMetrics) {
    let b = content.as_bytes();
    let word_count = content.split_whitespace().count();
    let code_blocks = count_code_blocks(b);
    let cross_refs = extract_links(b).len();
    let has_title = content.trim_start().starts_with("# ");
    let section_count = content.lines().filter(|l| l.starts_with("## ")).count();
    let mermaid_blocks = count_fenced_tag(b, b"```mermaid");
    let has_mental_model = has_h2_phrase(content, "Mental Model");
    let has_runtime_internals = has_h2_phrase(content, "Runtime Internals");

    let mut issues: Vec<String> = Vec::new();
    if word_count < s.min_word_count {
        issues.push(format!("Too short: {word_count} words (min {})", s.min_word_count));
    }
    if code_blocks < s.min_code_blocks {
        issues.push(format!("Too few code examples: {code_blocks} (min {})", s.min_code_blocks));
    }
    if cross_refs < s.min_cross_refs {
        issues.push(format!("Missing cross-references: {cross_refs} (min {})", s.min_cross_refs));
    }
    if s.require_h1 && !has_title {
        issues.push("Missing # title on first line".to_string());
    }
    if section_count < s.min_h2_sections {
        issues.push(format!("Fewer than {} ## sections", s.min_h2_sections));
    }
    if s.reject_mermaid && mermaid_blocks > 0 {
        issues.push(format!(
            "Found {mermaid_blocks} ```mermaid block(s) — replace each with a ```xyflow JSON diagram."
        ));
    }
    if s.require_mental_model && !has_mental_model {
        issues.push(
            "Missing `## Mental Model` section (required as the second-level section before Core Concepts).".to_string(),
        );
    }
    if s.require_runtime_internals && !has_runtime_internals {
        issues.push("Missing `## Runtime Internals` deep-dive section.".to_string());
    }

    (
        issues,
        ContentMetrics { word_count, code_blocks, cross_refs },
    )
}

/// Links grouped by whether they sit inside a Related/Prerequisite section.
pub struct LinkSets {
    pub all: Vec<String>,
    pub in_relation_section: Vec<String>,
}

pub fn collect_links(content: &str) -> LinkSets {
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

pub fn parse_lesson_slugs(articles_ts: &std::path::Path) -> Option<Vec<String>> {
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
pub fn is_h2(line: &str) -> bool {
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
pub fn section_body(content: &str, heading: &str) -> Option<String> {
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
pub fn strip_fences(s: &str) -> String {
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
pub fn prose_words(text: &str) -> usize {
    strip_fences(text)
        .split_whitespace()
        .filter(|w| !w.chars().all(|c| c == '#'))
        .count()
}

/// Lowercased alphanumeric-token k-shingle set, hashed to u64.
pub fn shingle_set(text: &str, k: usize) -> HashSet<u64> {
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

pub fn jaccard(a: &HashSet<u64>, b: &HashSet<u64>) -> f32 {
    if a.is_empty() || b.is_empty() {
        return 0.0;
    }
    let inter = a.intersection(b).count() as f32;
    let uni = a.union(b).count() as f32;
    inter / uni
}

/// Extract each ```xyflow fenced block's body.
pub fn xyflow_bodies(content: &str) -> Vec<String> {
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
pub fn xyflow_signature(body: &str) -> Result<String, String> {
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

    #[test]
    fn deep_dive_structure_issue_strings_unchanged() {
        // Drift guard: mirrors udemy's `issue_order_matches_python_exactly`
        // (crates/udemy/src/generate/quality.rs) — same fixture, same
        // expected ordered strings. udemy is a separate workspace so it
        // cannot depend on this crate; if the engine's deep-dive structure
        // tier ever diverges from udemy's Python-faithful gate, this fails.
        let s = crate::content::profiles::Profile::deep_dive().structure;
        let (issues, _m) = structure_check("no title\n\n```mermaid\ngraph\n```\n", &s);
        assert_eq!(
            issues,
            vec![
                "Too short: 5 words (min 1500)".to_string(),
                "Too few code examples: 1 (min 2)".to_string(),
                "Missing cross-references: 0 (min 1)".to_string(),
                "Missing # title on first line".to_string(),
                "Fewer than 3 ## sections".to_string(),
                "Too few xyflow diagrams: 0 (min 5). Use ```xyflow JSON fences, not ```mermaid.".to_string(),
                "Found 1 ```mermaid block(s) — replace each with a ```xyflow JSON diagram.".to_string(),
                "Missing `## Mental Model` section (required as the second-level section before Core Concepts).".to_string(),
                "Missing `## Runtime Internals` deep-dive section.".to_string(),
            ]
        );
    }
}
