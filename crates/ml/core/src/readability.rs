use serde::{Deserialize, Serialize};

use crate::types::Lesson;
use crate::vocab;

// ── Types ────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DifficultyLevel {
    Beginner,
    Intermediate,
    Advanced,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReadabilityMetrics {
    pub flesch_kincaid_grade: f32,
    pub gunning_fog: f32,
    pub avg_sentence_length: f32,
    pub avg_syllables_per_word: f32,
    pub technical_term_density: f32,
    pub code_block_ratio: f32,
    pub formula_density: f32,
    pub difficulty: DifficultyLevel,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SectionReadability {
    pub heading: String,
    pub metrics: ReadabilityMetrics,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LessonReadability {
    pub slug: String,
    pub overall: ReadabilityMetrics,
    pub sections: Vec<SectionReadability>,
}

// ── Syllable counting (Hunt algorithm) ───────────────────────────────────────

fn is_vowel(c: char) -> bool {
    matches!(c, 'a' | 'e' | 'i' | 'o' | 'u' | 'y')
}

pub fn count_syllables(word: &str) -> usize {
    let lower = word.to_lowercase();
    let chars: Vec<char> = lower.chars().filter(|c| c.is_alphabetic()).collect();
    if chars.is_empty() {
        return 1;
    }

    let mut count = 0usize;
    let mut prev_vowel = false;

    for &c in &chars {
        if is_vowel(c) {
            if !prev_vowel {
                count += 1;
            }
            prev_vowel = true;
        } else {
            prev_vowel = false;
        }
    }

    // If ends in 'e' and we counted more than 1, subtract 1 (silent e)
    if chars.last() == Some(&'e') && count > 1 {
        count -= 1;
    }

    count.max(1)
}

// ── Markdown stripping ───────────────────────────────────────────────────────

pub fn strip_markdown(text: &str) -> String {
    let mut result = String::with_capacity(text.len());
    let mut in_code_block = false;

    for line in text.lines() {
        let trimmed = line.trim();

        // Toggle fenced code blocks
        if trimmed.starts_with("```") {
            in_code_block = !in_code_block;
            continue;
        }
        if in_code_block {
            continue;
        }

        // Remove heading markers
        let line_content = if trimmed.starts_with('#') {
            trimmed.trim_start_matches('#').trim()
        } else {
            trimmed
        };

        // Remove images ![alt](url)
        let line_content = remove_images(line_content);
        // Remove links [text](url) -> text
        let line_content = remove_links(&line_content);
        // Remove inline code
        let line_content = remove_inline_code(&line_content);
        // Remove bold/italic markers
        let line_content = line_content.replace("**", "").replace('*', "");
        // Remove HTML tags
        let line_content = remove_html_tags(&line_content);

        if !line_content.trim().is_empty() {
            result.push_str(line_content.trim());
            result.push('\n');
        }
    }

    result
}

fn remove_images(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();

    while let Some(c) = chars.next() {
        if c == '!' && chars.peek() == Some(&'[') {
            // Skip ![alt](url)
            chars.next(); // skip '['
            // Skip until ']'
            for ch in chars.by_ref() {
                if ch == ']' {
                    break;
                }
            }
            // Skip (url) if present
            if chars.peek() == Some(&'(') {
                chars.next();
                for ch in chars.by_ref() {
                    if ch == ')' {
                        break;
                    }
                }
            }
        } else {
            out.push(c);
        }
    }
    out
}

fn remove_links(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();

    while let Some(c) = chars.next() {
        if c == '[' {
            let mut inner = String::new();
            for ch in chars.by_ref() {
                if ch == ']' {
                    break;
                }
                inner.push(ch);
            }
            if chars.peek() == Some(&'(') {
                chars.next();
                for ch in chars.by_ref() {
                    if ch == ')' {
                        break;
                    }
                }
            }
            out.push_str(&inner);
        } else {
            out.push(c);
        }
    }
    out
}

fn remove_inline_code(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut in_code = false;

    for c in text.chars() {
        if c == '`' {
            in_code = !in_code;
        } else if !in_code {
            out.push(c);
        }
    }
    out
}

fn remove_html_tags(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut in_tag = false;

    for c in text.chars() {
        if c == '<' {
            in_tag = true;
        } else if c == '>' {
            in_tag = false;
        } else if !in_tag {
            out.push(c);
        }
    }
    out
}

// ── Counting helpers ─────────────────────────────────────────────────────────

pub fn count_code_blocks(text: &str) -> usize {
    text.lines()
        .filter(|l| l.trim().starts_with("```"))
        .count()
        / 2
}

pub fn count_formulas(text: &str) -> usize {
    let mut count = 0usize;
    let mut chars = text.chars().peekable();
    let mut in_display_math = false;
    let mut in_inline_math = false;

    while let Some(c) = chars.next() {
        if c == '$' {
            if chars.peek() == Some(&'$') {
                chars.next(); // consume second $
                if in_display_math {
                    in_display_math = false;
                    // closing $$ already counted on open
                } else {
                    in_display_math = true;
                    count += 1;
                }
            } else if !in_display_math {
                if in_inline_math {
                    in_inline_math = false;
                    // closing $ already counted on open
                } else {
                    in_inline_math = true;
                    count += 1;
                }
            }
        }
    }
    count
}

pub fn count_sentences(text: &str) -> usize {
    let count = text
        .chars()
        .zip(text.chars().skip(1).chain(std::iter::once(' ')))
        .filter(|&(c, next)| {
            (c == '.' || c == '!' || c == '?')
                && (next == ' ' || next == '\n' || next == '\r')
        })
        .count();
    count.max(1)
}

// ── Main analysis ────────────────────────────────────────────────────────────

pub fn analyze(text: &str) -> ReadabilityMetrics {
    let plain = strip_markdown(text);
    let words: Vec<&str> = plain.split_whitespace().collect();
    let total_words = words.len().max(1) as f32;
    let total_sentences = count_sentences(&plain) as f32;
    let total_lines = text.lines().count().max(1) as f32;

    let total_syllables: usize = words.iter().map(|w| count_syllables(w)).sum();
    let complex_words = words.iter().filter(|w| count_syllables(w) >= 3).count() as f32;

    let avg_sentence_length = total_words / total_sentences;
    let avg_syllables_per_word = total_syllables as f32 / total_words;

    let flesch_kincaid_grade =
        0.39 * avg_sentence_length + 11.8 * avg_syllables_per_word - 15.59;
    let gunning_fog =
        0.4 * (avg_sentence_length + 100.0 * complex_words / total_words);

    let technical_words = words.iter().filter(|w| vocab::is_technical(w)).count() as f32;
    let technical_term_density = technical_words / total_words;

    let code_blocks = count_code_blocks(text) as f32;
    let code_block_ratio = code_blocks / total_lines;

    let formula_count = count_formulas(text) as f32;
    let formula_density = formula_count / total_words;

    let difficulty = classify_difficulty(
        flesch_kincaid_grade,
        technical_term_density,
        code_block_ratio,
        formula_density,
    );

    ReadabilityMetrics {
        flesch_kincaid_grade,
        gunning_fog,
        avg_sentence_length,
        avg_syllables_per_word,
        technical_term_density,
        code_block_ratio,
        formula_density,
        difficulty,
    }
}

fn classify_difficulty(
    fk_grade: f32,
    tech_density: f32,
    code_ratio: f32,
    formula_density: f32,
) -> DifficultyLevel {
    let score = 0.3 * (fk_grade / 20.0)
        + 0.3 * (tech_density * 10.0)
        + 0.2 * (code_ratio * 5.0)
        + 0.2 * (formula_density * 20.0);

    if score < 0.33 {
        DifficultyLevel::Beginner
    } else if score < 0.66 {
        DifficultyLevel::Intermediate
    } else {
        DifficultyLevel::Advanced
    }
}

// ── Lesson-level analysis ────────────────────────────────────────────────────

pub fn analyze_lesson(lesson: &Lesson) -> LessonReadability {
    let overall = analyze(&lesson.content);

    // Split on H2 headings to get sections
    let mut sections = Vec::new();
    let parts: Vec<&str> = lesson.content.split("\n## ").collect();

    for (i, part) in parts.iter().enumerate() {
        if i == 0 {
            // The part before the first ## heading -- skip or use intro
            continue;
        }
        let heading = part
            .lines()
            .next()
            .unwrap_or("Untitled Section")
            .trim()
            .to_string();
        let metrics = analyze(part);
        sections.push(SectionReadability { heading, metrics });
    }

    LessonReadability {
        slug: lesson.slug.clone(),
        overall,
        sections,
    }
}

// ── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn syllable_hello() {
        assert_eq!(count_syllables("hello"), 2);
    }

    #[test]
    fn syllable_the() {
        assert_eq!(count_syllables("the"), 1);
    }

    #[test]
    fn syllable_extraordinary() {
        // Hunt algorithm: vowel groups in "extraordinary" are {e},{ao},{i},{a},{y} = 5
        // (The "ao" in "traor" is counted as one vowel group.)
        let count = count_syllables("extraordinary");
        assert_eq!(count, 5, "Expected 5 syllables for 'extraordinary', got {count}");
    }

    #[test]
    fn strip_markdown_removes_code_blocks() {
        let md = "Hello world.\n\n```python\nprint('hi')\n```\n\nAfter code.";
        let stripped = strip_markdown(md);
        assert!(!stripped.contains("print"));
        assert!(stripped.contains("Hello world"));
        assert!(stripped.contains("After code"));
    }

    #[test]
    fn strip_markdown_removes_formatting() {
        let md = "This is **bold** and *italic* and `code`.";
        let stripped = strip_markdown(md);
        assert!(!stripped.contains("**"));
        assert!(!stripped.contains('*'));
        assert!(!stripped.contains('`'));
        assert!(stripped.contains("bold"));
        assert!(stripped.contains("italic"));
    }

    #[test]
    fn strip_markdown_removes_links() {
        let md = "Check [this link](https://example.com) out.";
        let stripped = strip_markdown(md);
        assert!(stripped.contains("this link"));
        assert!(!stripped.contains("https://"));
    }

    #[test]
    fn analyze_simple_text() {
        let text = "The cat sat on the mat. The dog ran in the park. Birds fly in the sky.";
        let metrics = analyze(text);
        assert!(metrics.flesch_kincaid_grade < 5.0, "Simple text should have low FK grade");
        assert!(metrics.avg_sentence_length < 10.0);
        assert_eq!(metrics.difficulty, DifficultyLevel::Beginner);
    }

    #[test]
    fn difficulty_classification_beginner() {
        let level = classify_difficulty(5.0, 0.0, 0.0, 0.0);
        assert_eq!(level, DifficultyLevel::Beginner);
    }

    #[test]
    fn difficulty_classification_advanced() {
        let level = classify_difficulty(18.0, 0.15, 0.1, 0.05);
        assert_eq!(level, DifficultyLevel::Advanced);
    }

    #[test]
    fn count_sentences_basic() {
        let text = "Hello world. How are you? I am fine! Good.";
        // "Good." is at end -- the next char after '.' is ' ' (from chain)
        assert_eq!(count_sentences(text), 4);
    }

    #[test]
    fn count_code_blocks_basic() {
        let text = "Some text\n\n```python\ncode\n```\n\nMore\n\n```js\ncode\n```\n";
        assert_eq!(count_code_blocks(text), 2);
    }

    #[test]
    fn count_formulas_basic() {
        let text = "The formula $E = mc^2$ and also $$\\sum_{i=1}^{n}$$ here.";
        assert_eq!(count_formulas(text), 2);
    }
}
