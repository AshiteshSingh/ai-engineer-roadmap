//! Article quality gate — byte-faithful port of the Python `check_quality`
//! in backend/knowledge_agent/article_generate_graph.py (lines 235-279).

use std::sync::LazyLock;

use regex::Regex;

const MIN_WORD_COUNT: usize = 1500;
const MIN_CODE_BLOCKS: usize = 2;
const MIN_CROSS_REFS: usize = 1;
const MIN_XYFLOW_BLOCKS: usize = 5;

static RE_CODE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"```\w+").unwrap());
static RE_XREF: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\]\(/[\w-]+\)").unwrap());
static RE_SECTION: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?m)^## ").unwrap());
static RE_XYFLOW: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"```xyflow\b").unwrap());
static RE_MERMAID: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"```mermaid\b").unwrap());
static RE_MENTAL: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?m)^##\s+Mental Model\b").unwrap());
static RE_RUNTIME: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?m)^##\s+Runtime Internals\b").unwrap());

/// Result of the quality gate. `ok` mirrors Python `len(issues) == 0`.
#[derive(Debug, Clone)]
pub struct Quality {
    pub ok: bool,
    pub issues: Vec<String>,
    pub word_count: usize,
    pub code_blocks: usize,
    pub cross_refs: usize,
    pub xyflow_blocks: usize,
}

/// Mirrors Python `check_quality` regex-for-regex.
pub fn check_quality(content: &str) -> Quality {
    let word_count = content.split_whitespace().count();
    let code_blocks = RE_CODE.find_iter(content).count();
    let cross_refs = RE_XREF.find_iter(content).count();
    let has_title = content.trim_start().starts_with("# ");
    let section_count = RE_SECTION.find_iter(content).count();
    let xyflow_blocks = RE_XYFLOW.find_iter(content).count();
    let mermaid_blocks = RE_MERMAID.find_iter(content).count();
    let has_mental_model = RE_MENTAL.is_match(content);
    let has_runtime_internals = RE_RUNTIME.is_match(content);

    let mut issues: Vec<String> = Vec::new();
    if word_count < MIN_WORD_COUNT {
        issues.push(format!("Too short: {word_count} words (min {MIN_WORD_COUNT})"));
    }
    if code_blocks < MIN_CODE_BLOCKS {
        issues.push(format!(
            "Too few code examples: {code_blocks} (min {MIN_CODE_BLOCKS})"
        ));
    }
    if cross_refs < MIN_CROSS_REFS {
        issues.push(format!(
            "Missing cross-references: {cross_refs} (min {MIN_CROSS_REFS})"
        ));
    }
    if !has_title {
        issues.push("Missing # title on first line".to_string());
    }
    if section_count < 3 {
        issues.push("Fewer than 3 ## sections".to_string());
    }
    if xyflow_blocks < MIN_XYFLOW_BLOCKS {
        issues.push(format!(
            "Too few xyflow diagrams: {xyflow_blocks} (min {MIN_XYFLOW_BLOCKS}). Use ```xyflow JSON fences, not ```mermaid."
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

    Quality {
        ok: issues.is_empty(),
        issues,
        word_count,
        code_blocks,
        cross_refs,
        xyflow_blocks,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn good_article() -> String {
        let mut s = String::from("# Title\n\nIntro paragraph.\n\n");
        s.push_str("## Mental Model\n\ntext [ref](/other-slug)\n\n");
        s.push_str("## Runtime Internals\n\ndeep dive\n\n");
        s.push_str("## Patterns\n\nmore\n\n");
        s.push_str("```python\nprint(1)\n```\n\n```python\nprint(2)\n```\n\n");
        for _ in 0..5 {
            s.push_str("```xyflow\n{\"direction\":\"TD\",\"nodes\":[],\"edges\":[]}\n```\n\n");
        }
        s.push_str(&"word ".repeat(1600));
        s
    }

    #[test]
    fn passes_when_all_gates_met() {
        let q = check_quality(&good_article());
        assert!(q.ok, "expected ok, issues: {:?}", q.issues);
        assert!(q.word_count >= 1500 && q.code_blocks >= 2 && q.xyflow_blocks >= 5);
    }

    #[test]
    fn flags_each_missing_gate() {
        let q = check_quality("no title here");
        assert!(!q.ok);
        assert!(q.issues.iter().any(|i| i.starts_with("Too short:")));
        assert!(q.issues.iter().any(|i| i == "Missing # title on first line"));
        assert!(q.issues.iter().any(|i| i.contains("Missing `## Mental Model`")));
        assert!(q.issues.iter().any(|i| i.contains("Missing `## Runtime Internals`")));
    }

    #[test]
    fn mermaid_is_rejected() {
        let mut a = good_article();
        a.push_str("\n```mermaid\ngraph TD\n```\n");
        let q = check_quality(&a);
        assert!(!q.ok && q.issues.iter().any(|i| i.contains("```mermaid block(s)")));
    }

    #[test]
    fn triple_hash_does_not_satisfy_mental_model() {
        let a = good_article()
            .replace("## Mental Model", "### Mental Model")
            .replace("## Patterns", "## A\n\n## B");
        let q = check_quality(&a);
        assert!(q.issues.iter().any(|i| i.contains("Missing `## Mental Model`")));
    }

    #[test]
    fn issue_order_matches_python_exactly() {
        // Fails every gate; locks the exact ordered issue strings (and the
        // count interpolations) against the Python check_quality push order.
        let q = check_quality("no title\n\n```mermaid\ngraph\n```\n");
        assert_eq!(
            q.issues,
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
        assert!(!q.ok);
    }

    #[test]
    fn byte_parity_edge_cases() {
        // bare ``` fence (no language) is NOT counted; tagged fences ARE
        let q = check_quality("```\nno lang\n```\n```python\nx\n```");
        assert_eq!(q.code_blocks, 1);

        // `### ` and `##x` must NOT count as `## ` sections (only "## real")
        let q2 = check_quality("# T\n### a\n### b\n##c\n## real\n");
        assert!(q2.issues.iter().any(|i| i == "Fewer than 3 ## sections"));

        // cross-refs: only `](/kebab_slug)` counts — not nested paths or URLs
        let q3 = check_quality("[a](/good-1) [b](/a/b) [c](https://x.com) [d](/also_ok2)");
        assert_eq!(q3.cross_refs, 2);

        // xyflow vs mermaid counted independently and by the \b boundary
        let q4 = check_quality("```xyflow\n{}\n```\n```xyflowish\n```\n```mermaid\n```");
        assert_eq!(q4.xyflow_blocks, 1, "```xyflowish must not match ```xyflow\\b");
    }

    #[test]
    fn leading_whitespace_title_ok() {
        let q = check_quality("\n\n# Title\n");
        assert!(!q.issues.iter().any(|i| i == "Missing # title on first line"));
    }
}
