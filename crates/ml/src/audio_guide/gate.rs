//! Audio-quality & audio-experience gate.
//!
//! Turns the English rules in [`crate::audio_guide::prompts::SYSTEM_PROMPT`] into machine
//! checks over a generated [`AudioMeta`]. Pure (no I/O): callers either fail
//! fast in `build-audio-guide` (bail before `save_json`) or scan the
//! on-disk corpus via the `audio-gate` bin. Mirrors the tier/issue/worklist
//! shape of `crates/ml/core/src/bin/content_gate.rs`.
//!
//! Crisp rules are **hard failures** (`failures`, flip `ok`); the two
//! false-positive-prone heuristics — acronym-expanded-on-first-use and
//! numbers-under-twenty-spelled-out — plus sentence-length variety are
//! **warn-only** (`warnings`, never affect `ok`).

use once_cell::sync::Lazy;
use regex::Regex;
use serde::Serialize;

use crate::audio_guide::audio_meta::AudioMeta;
use crate::audio_guide::wpm;

// ── Thresholds (content_gate.rs style: all knobs in one place) ───────────

/// Minimum usable chapters for a real audio guide.
pub const MIN_CHAPTERS: usize = 3;
/// Floor per chapter — above `build_meta`'s 12-word drop so a chapter that
/// survived generation but is still a stub gets caught.
pub const MIN_WORDS_PER_CHAPTER: usize = 40;
/// A guide shorter than this is not worth a player.
pub const MIN_TOTAL_WORDS: usize = 400;
/// SYSTEM_PROMPT: chapter titles are five words or fewer.
pub const MAX_TITLE_WORDS: usize = 5;
/// Defensive upper bound on title length (chunker auto-titles cap ~72).
pub const MAX_TITLE_CHARS: usize = 72;
/// Warn-only: coefficient of variation of per-sentence word counts below
/// this reads as monotone ("vary sentence length").
pub const SENTENCE_CV_MIN: f64 = 0.30;
/// Warn-only: only judge variety on chapters with enough sentences to be
/// statistically meaningful.
pub const SENTENCE_CV_MIN_SENTENCES: usize = 5;

// ── Serialized report shapes (mirror content_gate LessonReport) ──────────

#[derive(Debug, Clone, Serialize)]
pub struct AudioViolation {
    /// `None` = whole-meta scope; `Some(i)` = chapter index.
    pub chapter: Option<usize>,
    pub rule: &'static str,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct AudioMetrics {
    pub chapters: usize,
    pub total_words: usize,
    pub total_duration_secs: u32,
    pub mean_words_per_chapter: usize,
    pub sentence_len_cv: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct AudioGateReport {
    pub slug: String,
    pub title: String,
    pub ok: bool,
    pub failures: Vec<AudioViolation>,
    pub warnings: Vec<AudioViolation>,
    pub metrics: AudioMetrics,
}

// ── Compiled patterns ────────────────────────────────────────────────────

static CODE_FENCE: Lazy<Regex> = Lazy::new(|| Regex::new(r"```|~~~").unwrap());
static MD_BULLET: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?m)^\s*(?:[-*+]\s+|\d+\.\s+)").unwrap());
static MD_HEADING: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?m)^\s*#{1,6}\s+\S").unwrap());
static MD_LINK: Lazy<Regex> = Lazy::new(|| Regex::new(r"!?\[[^\]]*\]\([^)]*\)").unwrap());
static TABLE_SEP: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?m)^\s*\|?\s*:?-{3,}").unwrap());
static VISUAL_PHRASE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)\b(see the (diagram|figure|chart|graph)|(diagram|figure) (above|below)|in the diagram|as shown (above|below|in)|picture (above|below))\b").unwrap()
});
static CLOSING_PHRASE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)\b(in conclusion|to summari[sz]e|in summary|to wrap up|as we[''’]ve seen|in this (guide|script|chapter|episode))\b").unwrap()
});
static SENTENCE_SPLIT: Lazy<Regex> = Lazy::new(|| Regex::new(r"[.!?]+(?:\s|$)").unwrap());
static ACRONYM: Lazy<Regex> = Lazy::new(|| Regex::new(r"\b[A-Z]{2,6}\b").unwrap());
static SMALL_NUM: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?:^|[^\w./$-])(\d{1,2})(?:[^\w./%x-]|$)").unwrap());

/// Acronyms common enough in engineering prose that demanding an inline
/// expansion would only generate noise. Warn-only path, so this just trims it.
const ACRONYM_ALLOWLIST: &[&str] = &[
    "API", "JSON", "HTTP", "HTTPS", "SQL", "GPU", "CPU", "URL", "URI", "RAM",
    "OS", "ID", "AI", "ML", "PDF", "CSV", "HTML", "CSS", "TCP", "UDP", "DNS",
    "SSD", "IO", "UI", "UX", "CLI", "SDK", "REST", "YAML", "XML", "JWT",
];

// ── Helpers ──────────────────────────────────────────────────────────────

fn word_count(s: &str) -> usize {
    wpm::count_words(s)
}

/// Canonical `full_script` as `build_meta` would emit it, so a divergence
/// between the spoken transcript and the per-chapter scripts is caught.
fn canonical_full_script(meta: &AudioMeta) -> String {
    meta.chapters
        .iter()
        .map(|c| format!("## {}\n\n{}", c.title, c.script))
        .collect::<Vec<_>>()
        .join("\n\n")
}

fn sentence_lengths(text: &str) -> Vec<usize> {
    SENTENCE_SPLIT
        .split(text)
        .map(|s| s.split_whitespace().count())
        .filter(|&n| n > 0)
        .collect()
}

fn coefficient_of_variation(lengths: &[usize]) -> f64 {
    if lengths.len() < 2 {
        return 0.0;
    }
    let n = lengths.len() as f64;
    let mean = lengths.iter().sum::<usize>() as f64 / n;
    if mean == 0.0 {
        return 0.0;
    }
    let var = lengths.iter().map(|&l| (l as f64 - mean).powi(2)).sum::<f64>() / n;
    var.sqrt() / mean
}

/// Scan one chapter's `script` for the crisp "plain prose only" / phrase
/// rules. `full_script` deliberately is NOT run through this — it contains
/// the `## <title>` chapter delimiters by design; its integrity is checked
/// separately against [`canonical_full_script`].
fn scan_prose(idx: usize, script: &str, out: &mut Vec<AudioViolation>) {
    let push = |out: &mut Vec<AudioViolation>, rule, detail: String| {
        out.push(AudioViolation { chapter: Some(idx), rule, detail });
    };
    if script.contains('`') {
        push(out, "no-backtick", "inline backtick in narration".into());
    }
    if CODE_FENCE.is_match(script) {
        push(out, "no-code-fence", "``` / ~~~ code fence in narration".into());
    }
    if script.contains('|') {
        push(out, "no-pipe", "pipe character (table) in narration".into());
    }
    if let Some(m) = MD_BULLET.find(script) {
        push(out, "no-bullet-list", format!("markdown list marker: {:?}", m.as_str().trim()));
    }
    if MD_HEADING.is_match(script) {
        push(out, "no-heading", "markdown heading inside chapter body".into());
    }
    if let Some(m) = MD_LINK.find(script) {
        push(out, "no-md-link", format!("markdown link/image syntax: {:?}", m.as_str()));
    }
    if TABLE_SEP.is_match(script) {
        push(out, "no-table", "markdown table separator row".into());
    }
    if let Some(m) = VISUAL_PHRASE.find(script) {
        push(out, "no-visual-ref", format!("visual reference: {:?}", m.as_str()));
    }
    if let Some(m) = CLOSING_PHRASE.find(script) {
        push(out, "no-closing-summary", format!("closing/meta phrase: {:?}", m.as_str()));
    }
}

fn scan_heuristics(idx: usize, script: &str, seen_acronyms: &mut Vec<String>, out: &mut Vec<AudioViolation>) {
    // Sentence-length variety.
    let lens = sentence_lengths(script);
    if lens.len() >= SENTENCE_CV_MIN_SENTENCES {
        let cv = coefficient_of_variation(&lens);
        if cv < SENTENCE_CV_MIN {
            out.push(AudioViolation {
                chapter: Some(idx),
                rule: "sentence-variety",
                detail: format!("monotone cadence (cv {cv:.2} < {SENTENCE_CV_MIN:.2})"),
            });
        }
    }
    // Acronym expanded on first use (across the whole guide).
    for m in ACRONYM.find_iter(script) {
        let tok = m.as_str();
        if ACRONYM_ALLOWLIST.contains(&tok) || seen_acronyms.iter().any(|s| s == tok) {
            continue;
        }
        seen_acronyms.push(tok.to_string());
        let tail = &script[m.end()..script.len().min(m.end() + 48)];
        let expanded = tail.starts_with(" —")
            || tail.starts_with(" (")
            || tail.starts_with(", short for")
            || tail.starts_with(" short for")
            || tail.starts_with(" or ");
        if !expanded {
            out.push(AudioViolation {
                chapter: Some(idx),
                rule: "acronym-first-use",
                detail: format!("`{tok}` not expanded on first use"),
            });
        }
    }
    // Numbers under twenty as digits.
    for c in SMALL_NUM.captures_iter(script) {
        if let Some(g) = c.get(1) {
            if let Ok(n) = g.as_str().parse::<u32>() {
                if n < 20 {
                    out.push(AudioViolation {
                        chapter: Some(idx),
                        rule: "number-spelling",
                        detail: format!("digit {n} under twenty (spell it out)"),
                    });
                }
            }
        }
    }
}

// ── Entry point ──────────────────────────────────────────────────────────

/// Gate one [`AudioMeta`]. `ok == failures.is_empty()`.
pub fn gate_audio(meta: &AudioMeta) -> AudioGateReport {
    let mut failures: Vec<AudioViolation> = Vec::new();
    let mut warnings: Vec<AudioViolation> = Vec::new();

    let whole = |rule, detail: String| AudioViolation { chapter: None, rule, detail };

    if meta.slug.trim().is_empty() {
        failures.push(whole("meta-slug", "empty slug".into()));
    }
    if meta.title.trim().is_empty() {
        failures.push(whole("meta-title", "empty title".into()));
    }
    if meta.chapters.len() < MIN_CHAPTERS {
        failures.push(whole(
            "min-chapters",
            format!("{} chapters (min {MIN_CHAPTERS})", meta.chapters.len()),
        ));
    }
    if meta.duration_secs == 0 {
        failures.push(whole("zero-duration", "duration_secs is 0".into()));
    }
    // pending-tts ⇔ no audio_url.
    let pending = meta.voice == "pending-tts";
    if pending != meta.audio_url.is_empty() {
        failures.push(whole(
            "tts-state",
            format!("voice={:?} but audio_url={:?}", meta.voice, meta.audio_url),
        ));
    }

    let mut total_words = 0usize;
    let mut cumulative: u32 = 0;
    let mut all_sentence_lens: Vec<usize> = Vec::new();
    let mut titles_seen: Vec<&str> = Vec::new();
    let mut seen_acronyms: Vec<String> = Vec::new();

    for (i, ch) in meta.chapters.iter().enumerate() {
        if ch.index != i {
            failures.push(whole(
                "chapter-index",
                format!("chapter at position {i} has index {}", ch.index),
            ));
        }
        let t = ch.title.trim();
        if t.is_empty() {
            failures.push(AudioViolation { chapter: Some(i), rule: "title-empty", detail: "empty chapter title".into() });
        } else {
            if t.split_whitespace().count() > MAX_TITLE_WORDS {
                failures.push(AudioViolation {
                    chapter: Some(i),
                    rule: "title-too-long",
                    detail: format!("title {} words (max {MAX_TITLE_WORDS}): {t:?}", t.split_whitespace().count()),
                });
            }
            if t.chars().count() > MAX_TITLE_CHARS {
                failures.push(AudioViolation { chapter: Some(i), rule: "title-too-long", detail: format!("title {} chars (max {MAX_TITLE_CHARS})", t.chars().count()) });
            }
            if titles_seen.contains(&t) {
                failures.push(AudioViolation { chapter: Some(i), rule: "title-duplicate", detail: format!("duplicate title {t:?}") });
            }
            titles_seen.push(t);
        }

        let words = word_count(&ch.script);
        total_words += words;
        if words < MIN_WORDS_PER_CHAPTER {
            failures.push(AudioViolation {
                chapter: Some(i),
                rule: "chapter-too-short",
                detail: format!("{words} words (min {MIN_WORDS_PER_CHAPTER})"),
            });
        }

        // start_secs must be the running sum of prior durations.
        if ch.start_secs != cumulative {
            failures.push(AudioViolation {
                chapter: Some(i),
                rule: "start-secs",
                detail: format!("start_secs {} != cumulative {cumulative}", ch.start_secs),
            });
        }
        // duration must match the WPM estimate of its own script.
        let expect = wpm::estimate_secs(words);
        if ch.duration_secs != expect {
            failures.push(AudioViolation {
                chapter: Some(i),
                rule: "duration-mismatch",
                detail: format!("duration_secs {} != estimate {expect} for {words}w", ch.duration_secs),
            });
        }
        cumulative = cumulative.saturating_add(ch.duration_secs);

        scan_prose(i, &ch.script, &mut failures);
        scan_heuristics(i, &ch.script, &mut seen_acronyms, &mut warnings);
        all_sentence_lens.extend(sentence_lengths(&ch.script));
    }

    if total_words < MIN_TOTAL_WORDS {
        failures.push(whole(
            "min-total-words",
            format!("{total_words} total words (min {MIN_TOTAL_WORDS})"),
        ));
    }
    if !meta.chapters.is_empty() && meta.duration_secs != cumulative {
        failures.push(whole(
            "total-duration",
            format!("duration_secs {} != sum of chapters {cumulative}", meta.duration_secs),
        ));
    }
    if meta.full_script != canonical_full_script(meta) {
        failures.push(whole(
            "full-script-integrity",
            "full_script != canonical join of chapter titles+scripts".into(),
        ));
    }

    let chapters = meta.chapters.len();
    let metrics = AudioMetrics {
        chapters,
        total_words,
        total_duration_secs: cumulative,
        mean_words_per_chapter: if chapters == 0 { 0 } else { total_words / chapters },
        sentence_len_cv: coefficient_of_variation(&all_sentence_lens),
    };

    AudioGateReport {
        slug: meta.slug.clone(),
        title: meta.title.clone(),
        ok: failures.is_empty(),
        failures,
        warnings,
        metrics,
    }
}

// ── Tests ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio_guide::audio_meta::AudioChapter;

    /// Build a well-formed meta whose durations/start_secs/full_script are
    /// internally consistent, from `(title, script)` pairs.
    fn meta_from(parts: &[(&str, &str)]) -> AudioMeta {
        let mut chapters = Vec::new();
        let mut cum = 0u32;
        for (i, (t, s)) in parts.iter().enumerate() {
            let w = wpm::count_words(s);
            let d = wpm::estimate_secs(w);
            chapters.push(AudioChapter {
                index: i,
                title: (*t).to_string(),
                start_secs: cum,
                duration_secs: d,
                script: (*s).to_string(),
            });
            cum += d;
        }
        let full = chapters
            .iter()
            .map(|c| format!("## {}\n\n{}", c.title, c.script))
            .collect::<Vec<_>>()
            .join("\n\n");
        AudioMeta {
            slug: "t".into(),
            title: "T — Audio Guide".into(),
            voice: "pending-tts".into(),
            duration_secs: cum,
            file_size_bytes: 0,
            audio_url: String::new(),
            chapters,
            full_script: full,
        }
    }

    /// ~150 words of clean, varied prose: clears MIN_WORDS_PER_CHAPTER and,
    /// over three chapters, MIN_TOTAL_WORDS. No backticks, pipes, digits,
    /// acronyms, markdown, or closing/visual phrases.
    const CLEAN: &str = "You start with a plan. The plan is short. \
        Then you build the thing carefully, weighing every option against the \
        constraints you actually care about, because the wrong default here \
        is expensive to undo later. It works. You ship it, and then you watch \
        how real traffic behaves before deciding what to tune next. Latency \
        matters, but so does the cost of every call you make on the hot path. \
        When the numbers drift, you do not panic. You form a hypothesis, you \
        change one thing, and you measure again with the same workload as \
        before. Most of the time the bottleneck is not where you guessed. The \
        fix is usually smaller than the investigation that found it. Good \
        systems are mostly boring on purpose, and the boring parts are what \
        let you sleep at night. You keep the interface narrow so the next \
        person can reason about it without reading every single line you \
        wrote down for them.";

    #[test]
    fn clean_guide_passes_with_no_failures() {
        let m = meta_from(&[("Mental Model", CLEAN), ("The Core Loop", CLEAN), ("When To Use", CLEAN)]);
        let r = gate_audio(&m);
        assert!(r.ok, "expected ok, failures: {:?}", r.failures);
    }

    #[test]
    fn backtick_pipe_fence_bullet_heading_each_fail() {
        for (bad, rule) in [
            (format!("{CLEAN} use the `foo` call"), "no-backtick"),
            (format!("{CLEAN} a | b table"), "no-pipe"),
            (format!("{CLEAN}\n```\ncode\n```"), "no-code-fence"),
            (format!("{CLEAN}\n- one\n- two"), "no-bullet-list"),
            (format!("{CLEAN}\n## Sneaky Heading"), "no-heading"),
            (format!("{CLEAN} see [docs](http://x)"), "no-md-link"),
            (format!("{CLEAN} in conclusion that is all"), "no-closing-summary"),
            (format!("{CLEAN} see the diagram above for this"), "no-visual-ref"),
        ] {
            let m = meta_from(&[("A", &bad), ("B", CLEAN), ("C", CLEAN)]);
            let r = gate_audio(&m);
            assert!(!r.ok && r.failures.iter().any(|f| f.rule == rule), "rule {rule} not caught for {bad:?}: {:?}", r.failures);
        }
    }

    #[test]
    fn long_title_fails() {
        let m = meta_from(&[("This Title Has Way Too Many Words", CLEAN), ("B", CLEAN), ("C", CLEAN)]);
        let r = gate_audio(&m);
        assert!(r.failures.iter().any(|f| f.rule == "title-too-long"));
    }

    #[test]
    fn duration_and_full_script_tampering_fail() {
        let mut m = meta_from(&[("A", CLEAN), ("B", CLEAN), ("C", CLEAN)]);
        m.chapters[1].duration_secs += 7;
        let r = gate_audio(&m);
        assert!(r.failures.iter().any(|f| f.rule == "duration-mismatch"));

        let mut m2 = meta_from(&[("A", CLEAN), ("B", CLEAN), ("C", CLEAN)]);
        m2.full_script.push_str(" tampered");
        let r2 = gate_audio(&m2);
        assert!(r2.failures.iter().any(|f| f.rule == "full-script-integrity"));
    }

    #[test]
    fn short_chapter_and_too_few_chapters_fail() {
        let m = meta_from(&[("A", "too short"), ("B", CLEAN), ("C", CLEAN)]);
        let r = gate_audio(&m);
        assert!(r.failures.iter().any(|f| f.rule == "chapter-too-short"));

        let m2 = meta_from(&[("A", CLEAN), ("B", CLEAN)]);
        let r2 = gate_audio(&m2);
        assert!(r2.failures.iter().any(|f| f.rule == "min-chapters"));
    }

    #[test]
    fn heuristics_warn_but_do_not_block() {
        // Unexpanded acronym + bare digit → warnings, still ok.
        let s = format!("{CLEAN} The DAG has 7 stages you should know about.");
        let m = meta_from(&[("A", &s), ("B", CLEAN), ("C", CLEAN)]);
        let r = gate_audio(&m);
        assert!(r.ok, "heuristics must not block: {:?}", r.failures);
        assert!(r.warnings.iter().any(|w| w.rule == "acronym-first-use"));
        assert!(r.warnings.iter().any(|w| w.rule == "number-spelling"));
    }
}
