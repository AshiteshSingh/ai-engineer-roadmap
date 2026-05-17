use crate::audio_meta::AudioChapter;
use crate::wpm::{count_words, estimate_secs};

pub struct ChunkerOptions {
    /// Adjacent paragraphs whose cosine similarity is at least this value are
    /// merged into the same chapter.
    pub similarity_threshold: f32,
    /// Hard cap on chapter count; if the embedding-driven merge produces more
    /// chapters than this, the lowest-boundary-strength splits are dropped.
    pub max_chapters: usize,
    /// Lower bound — adjacent paragraphs are force-merged until each chapter
    /// has at least this many words.
    pub min_words_per_chapter: usize,
}

impl Default for ChunkerOptions {
    fn default() -> Self {
        Self {
            similarity_threshold: 0.78,
            max_chapters: 12,
            min_words_per_chapter: 60,
        }
    }
}

/// Paragraph slice tagged with an optional `## Title` marker emitted by the
/// LLM. The marker is stripped from `text` before assembly so it never lands
/// in the narration.
struct Paragraph {
    text: String,
    explicit_title: Option<String>,
}

fn split_paragraphs(script: &str) -> Vec<Paragraph> {
    let mut out = Vec::new();
    for chunk in script.split("\n\n") {
        let trimmed = chunk.trim();
        if trimmed.is_empty() {
            continue;
        }
        let mut explicit_title = None;
        let body = if let Some(rest) = trimmed.strip_prefix("## ") {
            // First newline separates the title line from the paragraph body.
            let (title_line, rest_body) = match rest.split_once('\n') {
                Some((t, b)) => (t, b),
                None => (rest, ""),
            };
            explicit_title = Some(title_line.trim().to_string());
            rest_body.trim().to_string()
        } else {
            trimmed.to_string()
        };
        if body.is_empty() {
            // Title-only paragraph — skip; the next paragraph will pick up the title.
            if let Some(t) = explicit_title {
                out.push(Paragraph {
                    text: String::new(),
                    explicit_title: Some(t),
                });
            }
            continue;
        }
        out.push(Paragraph {
            text: body,
            explicit_title,
        });
    }
    // Collapse leading title-only paragraphs into the following one.
    let mut collapsed: Vec<Paragraph> = Vec::with_capacity(out.len());
    let mut pending_title: Option<String> = None;
    for p in out {
        if p.text.is_empty() {
            pending_title = p.explicit_title.or(pending_title);
            continue;
        }
        let title = p.explicit_title.or_else(|| pending_title.take());
        collapsed.push(Paragraph {
            text: p.text,
            explicit_title: title,
        });
    }
    collapsed
}

fn first_sentence(text: &str, max_chars: usize) -> String {
    let end = text
        .find(|c: char| c == '.' || c == '!' || c == '?')
        .map(|i| i + 1)
        .unwrap_or(text.len());
    let mut title = text[..end].trim().to_string();
    if title.len() > max_chars {
        title.truncate(max_chars);
        // Avoid mid-grapheme break — fall back to char boundary.
        while !title.is_char_boundary(title.len()) && !title.is_empty() {
            title.pop();
        }
        title.push('…');
    }
    title
}

fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    let dot: f32 = a.iter().zip(b.iter()).map(|(x, y)| x * y).sum();
    let norm_a: f32 = a.iter().map(|x| x * x).sum::<f32>().sqrt();
    let norm_b: f32 = b.iter().map(|x| x * x).sum::<f32>().sqrt();
    if norm_a == 0.0 || norm_b == 0.0 {
        return 0.0;
    }
    dot / (norm_a * norm_b)
}

/// Chunk an LLM-authored narration script into audio chapters.
///
/// Adjacent paragraphs are embedded with `model`; pairs whose cosine
/// similarity exceeds `opts.similarity_threshold` stay in the same chapter.
/// Explicit `## Title` markers emitted by the model win over auto-generated
/// titles when they survive a merge.
pub fn chunk_into_chapters(
    script: &str,
    model: &candle::EmbeddingModel,
    opts: &ChunkerOptions,
) -> anyhow::Result<Vec<AudioChapter>> {
    let paragraphs = split_paragraphs(script);
    if paragraphs.is_empty() {
        return Ok(Vec::new());
    }

    // Embed each paragraph individually so we can compute pairwise
    // similarity between *adjacent* paragraphs only.
    let texts: Vec<&str> = paragraphs.iter().map(|p| p.text.as_str()).collect();
    let mut embeddings: Vec<Vec<f32>> = Vec::with_capacity(texts.len());
    for chunk in texts.chunks(8) {
        let tensor = model.embed(chunk)?;
        for i in 0..chunk.len() {
            embeddings.push(tensor.get(i)?.to_vec1::<f32>()?);
        }
    }

    // Boundary indices: position `i` means "split before paragraph i".
    // The first paragraph always starts a chapter, so 0 is implicit.
    let mut boundaries: Vec<(usize, f32)> = (1..paragraphs.len())
        .map(|i| {
            let sim = cosine_similarity(&embeddings[i - 1], &embeddings[i]);
            (i, sim)
        })
        .collect();

    // Start with every adjacent pair below threshold as a split.
    let mut splits: Vec<usize> = boundaries
        .iter()
        .filter(|(_, sim)| *sim < opts.similarity_threshold)
        .map(|(i, _)| *i)
        .collect();

    // Cap chapter count: keep the lowest-similarity splits (strongest topic
    // boundaries) up to max_chapters - 1.
    if splits.len() + 1 > opts.max_chapters {
        boundaries.sort_by(|a, b| {
            a.1.partial_cmp(&b.1)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        let keep = opts.max_chapters.saturating_sub(1);
        splits = boundaries.iter().take(keep).map(|(i, _)| *i).collect();
        splits.sort_unstable();
    }

    // Drop splits that would leave a chapter below min_words. Single pass:
    // walk in order and only commit a split if the left half (since the last
    // committed split) already has enough words *and* the right half (to the
    // next candidate split, or end) will have enough.
    let words_per_para: Vec<usize> =
        paragraphs.iter().map(|p| count_words(&p.text)).collect();
    let mut filtered: Vec<usize> = Vec::with_capacity(splits.len());
    let mut last = 0usize;
    for (i, &split_at) in splits.iter().enumerate() {
        let left: usize = words_per_para[last..split_at].iter().sum();
        let next = splits.get(i + 1).copied().unwrap_or(paragraphs.len());
        let right: usize = words_per_para[split_at..next].iter().sum();
        if left >= opts.min_words_per_chapter && right >= opts.min_words_per_chapter {
            filtered.push(split_at);
            last = split_at;
        }
    }
    splits = filtered;

    // Materialize chapters.
    let mut starts = vec![0usize];
    starts.extend(&splits);
    let mut chapters = Vec::with_capacity(starts.len());
    let mut cursor_secs: u32 = 0;
    for (idx, &start) in starts.iter().enumerate() {
        let end = starts.get(idx + 1).copied().unwrap_or(paragraphs.len());
        let slice = &paragraphs[start..end];
        let title = slice
            .iter()
            .find_map(|p| p.explicit_title.clone())
            .unwrap_or_else(|| first_sentence(&slice[0].text, 72));
        let script: String = slice
            .iter()
            .map(|p| p.text.as_str())
            .collect::<Vec<_>>()
            .join("\n\n");
        let words = count_words(&script);
        let duration = estimate_secs(words);
        chapters.push(AudioChapter {
            index: idx,
            title,
            start_secs: cursor_secs,
            duration_secs: duration,
            script,
        });
        cursor_secs += duration;
    }
    Ok(chapters)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn split_paragraphs_extracts_explicit_titles() {
        let script = "## Intro\n\nThis is the first paragraph.\n\n## Body\n\nSecond paragraph here.";
        let paras = split_paragraphs(script);
        assert_eq!(paras.len(), 2);
        assert_eq!(paras[0].explicit_title.as_deref(), Some("Intro"));
        assert_eq!(paras[1].explicit_title.as_deref(), Some("Body"));
        assert_eq!(paras[0].text, "This is the first paragraph.");
    }

    #[test]
    fn first_sentence_truncates_long_titles() {
        let t = first_sentence(
            "LangGraph is a framework for building stateful applications.",
            30,
        );
        assert!(t.ends_with('…') || t.len() <= 31);
    }

    #[test]
    fn first_sentence_respects_punctuation() {
        let t = first_sentence("Hello world. Second.", 80);
        assert_eq!(t, "Hello world.");
    }
}
