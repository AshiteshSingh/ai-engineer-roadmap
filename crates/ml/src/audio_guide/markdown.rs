//! Markdown → audio-friendly prose conversion for knowledge articles.
//!
//! Parses a single article into chapters keyed on H2 headings, strips
//! formatting / code / diagrams / tables that don't belong in narration, and
//! applies three audio-quality polish passes that the equivalent Python path
//! (`backend/scripts/build_audio_meta.py`) does not:
//!
//! 1. Bullet-line termination — list items that lose their leading `-`/`*`
//!    marker keep flowing into the next item without punctuation. We track
//!    which lines came from a bullet and append a period if they end open.
//! 2. Problem / Detection / Fix collapse — Common Pitfalls subsections are
//!    written as three labeled lines. Read aloud they are jarring; we fuse
//!    them into a single sentence.
//! 3. Glyph normalization — `→` becomes " to ", `…` becomes "...", `•` is
//!    dropped, smart quotes become ASCII.

use once_cell::sync::Lazy;
use regex::Regex;
use std::collections::HashSet;

/// H2 section titles (case-insensitive) we drop entirely. `comparison`
/// in the langgraph corpus is 100% markdown tables that vanish under
/// stripping and leaves only ghost H3 transitions.
pub fn skip_h2_titles() -> &'static HashSet<&'static str> {
    static SET: Lazy<HashSet<&'static str>> = Lazy::new(|| {
        ["cross-references", "see also", "further reading", "comparison"]
            .into_iter()
            .collect()
    });
    &SET
}

pub fn strip_frontmatter(md: &str) -> &str {
    if !md.starts_with("---") {
        return md;
    }
    if let Some(end) = md[3..].find("\n---") {
        let after = 3 + end + 4;
        md[after..].trim_start_matches('\n')
    } else {
        md
    }
}

/// Returns just the prose body — code, diagrams, tables, formatting stripped.
pub fn strip_markdown(text: &str) -> String {
    // Fenced code blocks of any language (```...```, including ```xyflow)
    static CODE_BLOCK: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?s)```.*?```").unwrap());
    // LaTeX display + inline math
    static DISPLAY_MATH: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?s)\$\$.*?\$\$").unwrap());
    static INLINE_MATH: Lazy<Regex> = Lazy::new(|| Regex::new(r"\$[^$\n]+\$").unwrap());
    // Images
    static IMAGES: Lazy<Regex> = Lazy::new(|| Regex::new(r"!\[[^\]]*\]\([^)]*\)").unwrap());
    // Links → keep the link text only
    static LINKS: Lazy<Regex> = Lazy::new(|| Regex::new(r"\[([^\]]*)\]\([^)]*\)").unwrap());
    // Headings — H3+ become spoken transitions, H1 collapsed to a sentence.
    static H4_PLUS: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?m)^####\s+(.+)$").unwrap());
    static H3: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?m)^###\s+(.+)$").unwrap());
    static H1: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?m)^#\s+(.+)$").unwrap());
    // Bold / italic
    static BOLD_STAR: Lazy<Regex> = Lazy::new(|| Regex::new(r"\*\*([^*]+)\*\*").unwrap());
    static BOLD_UNDER: Lazy<Regex> = Lazy::new(|| Regex::new(r"__([^_]+)__").unwrap());
    // Italic with word-boundary anchors so snake_case identifiers (e.g.
    // `send_email, execute_sql`) keep their underscores after the
    // earlier backtick-strip pass.
    static ITALIC_STAR: Lazy<Regex> =
        Lazy::new(|| Regex::new(r"(^|[^\w*])\*([^*\s][^*\n]*?[^*\s]|[^*\s])\*([^\w*]|$)").unwrap());
    static ITALIC_UNDER: Lazy<Regex> =
        Lazy::new(|| Regex::new(r"(^|[^\w_])_([^_\s][^_\n]*?[^_\s]|[^_\s])_([^\w_]|$)").unwrap());
    // Tables
    static TABLE_ROW: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?m)^\|.*\|$").unwrap());
    static TABLE_SEP: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?m)^\s*[-|:]+\s*$").unwrap());
    // Bullets / numbered lists. We strip the marker and remember the line was
    // a bullet so the caller can re-terminate it.
    static BULLET: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?m)^\s*[-*+]\s+").unwrap());
    static NUMBERED: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?m)^\s*\d+\.\s+").unwrap());
    // Inline backticks
    static BACKTICK: Lazy<Regex> = Lazy::new(|| Regex::new(r"`([^`]+)`").unwrap());
    // Markdown hard line-break (two trailing spaces + newline)
    static HARD_BREAK: Lazy<Regex> = Lazy::new(|| Regex::new(r"  +\n").unwrap());
    // Collapse 3+ blank lines
    static BLANK_LINES: Lazy<Regex> = Lazy::new(|| Regex::new(r"\n{3,}").unwrap());

    let mut s = text.to_owned();

    s = CODE_BLOCK.replace_all(&s, "").into_owned();
    s = DISPLAY_MATH.replace_all(&s, "").into_owned();
    s = INLINE_MATH.replace_all(&s, "").into_owned();
    s = IMAGES.replace_all(&s, "").into_owned();
    s = LINKS.replace_all(&s, "$1").into_owned();

    s = H4_PLUS
        .replace_all(&s, |caps: &regex::Captures| {
            let title = caps[1].trim_end_matches(|c: char| matches!(c, ' ' | '.' | '!' | '?' | ':' | ';' | ','));
            format!("Now, about {title}.")
        })
        .into_owned();
    s = H3
        .replace_all(&s, |caps: &regex::Captures| {
            let title = caps[1].trim_end_matches(|c: char| matches!(c, ' ' | '.' | '!' | '?' | ':' | ';' | ','));
            format!("Now, about {title}.")
        })
        .into_owned();
    s = H1.replace_all(&s, "$1.").into_owned();

    s = BOLD_STAR.replace_all(&s, "$1").into_owned();
    s = BOLD_UNDER.replace_all(&s, "$1").into_owned();
    s = ITALIC_STAR.replace_all(&s, "$1$2$3").into_owned();
    s = ITALIC_UNDER.replace_all(&s, "$1$2$3").into_owned();

    s = TABLE_ROW.replace_all(&s, "").into_owned();
    s = TABLE_SEP.replace_all(&s, "").into_owned();

    // Mark bullet-stripped lines so the polish pass can re-terminate them.
    // We use a sentinel char that won't appear in real prose; it's removed at
    // the end of `polish_for_audio`.
    s = BULLET.replace_all(&s, "\u{1}").into_owned();
    s = NUMBERED.replace_all(&s, "\u{1}").into_owned();

    s = BACKTICK.replace_all(&s, "$1").into_owned();
    s = HARD_BREAK.replace_all(&s, "\n").into_owned();
    s = BLANK_LINES.replace_all(&s, "\n\n").into_owned();

    s.trim().to_owned()
}

/// Audio-quality polish: bullet-line termination, Problem/Detection/Fix
/// collapse, glyph normalization. Operates on prose already passed through
/// `strip_markdown`.
pub fn polish_for_audio(text: &str) -> String {
    let mut s = text.to_owned();

    // (1) Bullet termination — lines that begin with the \u{1} sentinel left
    // by `strip_markdown` are former list items. If they don't already end
    // with terminal punctuation, append a period.
    let bullet_lines = Regex::new(r"(?m)^\u{1}([^\n]*)$").unwrap();
    s = bullet_lines
        .replace_all(&s, |caps: &regex::Captures| {
            let body = caps[1].trim_end();
            let needs_period = !matches!(
                body.chars().last(),
                Some('.' | '!' | '?' | ':' | ';' | ',' | '—')
            );
            if needs_period && !body.is_empty() {
                format!("{body}.")
            } else {
                body.to_owned()
            }
        })
        .into_owned();

    // (2) Problem / Detection / Fix collapse — common in Pitfalls sections.
    // Three forms supported:
    //   - Problem + Detection + Fix
    //   - Problem + Fix
    //   - lone Problem (rare, leave as a sentence)
    let pdf = Regex::new(
        r"(?m)^Problem:\s*(?P<p>[^\n]+?)\s*\n\s*Detection:\s*(?P<d>[^\n]+?)\s*\n\s*Fix:\s*(?P<f>[^\n]+?)\s*$",
    )
    .unwrap();
    s = pdf
        .replace_all(&s, |caps: &regex::Captures| {
            let p = strip_trailing_dot(&caps["p"]);
            let d = strip_trailing_dot(&caps["d"]);
            let f = ensure_terminal_period(&caps["f"]);
            format!("{p} — you'll see {d}. {f}")
        })
        .into_owned();

    let pf = Regex::new(r"(?m)^Problem:\s*(?P<p>[^\n]+?)\s*\n\s*Fix:\s*(?P<f>[^\n]+?)\s*$").unwrap();
    s = pf
        .replace_all(&s, |caps: &regex::Captures| {
            let p = strip_trailing_dot(&caps["p"]);
            let f = ensure_terminal_period(&caps["f"]);
            format!("{p}. {f}")
        })
        .into_owned();

    // Two consecutive `Problem:` lines (no Detection between) — collapse the
    // pair into one sentence so the following Fix can still attach.
    let pp_fix = Regex::new(
        r"(?m)^Problem:\s*(?P<p1>[^\n]+?)\s*\n\s*Problem:\s*(?P<p2>[^\n]+?)\s*\n\s*Fix:\s*(?P<f>[^\n]+?)\s*$",
    )
    .unwrap();
    s = pp_fix
        .replace_all(&s, |caps: &regex::Captures| {
            let p1 = strip_trailing_dot(&caps["p1"]);
            let p2 = strip_trailing_dot(&caps["p2"]);
            let f = ensure_terminal_period(&caps["f"]);
            format!("{p1}; also, {p2}. {f}")
        })
        .into_owned();

    // (3) Glyph normalization.
    s = s.replace('→', " to ");
    s = s.replace('…', "...");
    s = s.replace('•', "");
    s = s.replace('“', "\"").replace('”', "\"");
    s = s.replace('‘', "'").replace('’', "'");
    // Strip remaining sentinel markers (defensive — bullet pass should have
    // consumed them, but a bullet at end-of-input can slip through).
    s = s.replace('\u{1}', "");
    // Collapse repeated spaces introduced by glyph rewrites.
    let multi_space = Regex::new(r" {2,}").unwrap();
    s = multi_space.replace_all(&s, " ").into_owned();
    // Re-collapse stray blank-line runs.
    let blank = Regex::new(r"\n{3,}").unwrap();
    s = blank.replace_all(&s, "\n\n").into_owned();

    s.trim().to_owned()
}

fn strip_trailing_dot(s: &str) -> String {
    s.trim_end_matches(|c: char| matches!(c, ' ' | '.')).to_owned()
}

fn ensure_terminal_period(s: &str) -> String {
    let trimmed = s.trim_end();
    if matches!(trimmed.chars().last(), Some('.' | '!' | '?')) {
        trimmed.to_owned()
    } else {
        format!("{trimmed}.")
    }
}

/// Split markdown on H2 headings into `(title, body)` pairs. Content before
/// the first H2 is grouped under "Introduction" so the opening paragraphs
/// don't get dropped.
pub fn split_chapters(md: &str) -> Vec<(String, String)> {
    let mut chapters: Vec<(String, String)> = Vec::new();
    let mut current_title = "Introduction".to_string();
    let mut current_body = String::new();

    for line in md.lines() {
        if let Some(rest) = line.strip_prefix("## ") {
            if rest.starts_with('#') {
                // Was actually `### ` (H3) — keep accumulating.
                current_body.push_str(line);
                current_body.push('\n');
                continue;
            }
            let body = current_body.trim().to_owned();
            if !body.is_empty() {
                chapters.push((current_title.clone(), body));
            }
            current_title = rest.trim().to_owned();
            current_body.clear();
        } else {
            current_body.push_str(line);
            current_body.push('\n');
        }
    }

    let body = current_body.trim().to_owned();
    if !body.is_empty() {
        chapters.push((current_title, body));
    }

    chapters
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frontmatter_stripped() {
        let md = "---\ntitle: x\n---\nhello";
        assert_eq!(strip_frontmatter(md), "hello");
    }

    #[test]
    fn snake_case_identifiers_survive() {
        let raw = "Use `send_email, execute_sql, delete_data` carefully.";
        let out = strip_markdown(raw);
        assert!(out.contains("send_email"), "got: {out}");
        assert!(out.contains("execute_sql"), "got: {out}");
    }

    #[test]
    fn bullet_lines_get_periods() {
        let raw = "Things to remember:\n- first item\n- second item\n";
        let polished = polish_for_audio(&strip_markdown(raw));
        assert!(polished.contains("first item."), "got: {polished}");
        assert!(polished.contains("second item."), "got: {polished}");
    }

    #[test]
    fn problem_detection_fix_collapse() {
        let raw =
            "Problem: Two nodes write to the same key.\nDetection: state missing data.\nFix: define reducers.";
        let polished = polish_for_audio(&strip_markdown(raw));
        assert!(!polished.contains("Problem:"), "got: {polished}");
        assert!(!polished.contains("Detection:"), "got: {polished}");
        assert!(!polished.contains("Fix:"), "got: {polished}");
        assert!(polished.contains("define reducers"), "got: {polished}");
    }

    #[test]
    fn arrows_become_words() {
        let raw = "Pipeline: input → llm → output";
        let polished = polish_for_audio(&strip_markdown(raw));
        assert!(!polished.contains('→'), "got: {polished}");
        assert!(polished.contains(" to "), "got: {polished}");
    }

    #[test]
    fn h3_becomes_now_about() {
        let raw = "## Section\n\n### What problem does it solve?\n\nbody text here";
        let out = strip_markdown(raw);
        assert!(out.contains("Now, about What problem does it solve."), "got: {out}");
        // No double-punctuation from the question mark.
        assert!(!out.contains("solve?."), "got: {out}");
    }

    #[test]
    fn comparison_skipped_via_helper() {
        assert!(skip_h2_titles().contains("comparison"));
        assert!(skip_h2_titles().contains("cross-references"));
    }

    #[test]
    fn split_groups_pre_h2_as_intro() {
        let md = "Opening sentence.\n\n## First\n\nbody";
        let chapters = split_chapters(md);
        assert_eq!(chapters[0].0, "Introduction");
        assert!(chapters[0].1.contains("Opening sentence"));
        assert_eq!(chapters[1].0, "First");
    }
}
