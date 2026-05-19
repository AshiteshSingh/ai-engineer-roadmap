//! Windowed, timestamped transcript chunker.
//!
//! Caption cues are tiny (a few words each), so we accumulate them into
//! ~`TARGET_WORDS` windows with a small rolling overlap, carrying the
//! start/end seconds of the span so citations can deep-link to the video.

use crate::dlai::model::{ScrapedCourse, ScrapedLesson};

pub const TARGET_WORDS: usize = 250;
pub const OVERLAP_WORDS: usize = 40;

#[derive(Debug, Clone)]
pub struct TranscriptChunk {
    pub course_slug: String,
    pub course_title: String,
    pub course_url: String,
    pub lesson_index: u32,
    pub lesson_title: String,
    pub lesson_url: String,
    pub chunk_index: u32,
    pub start_secs: f64,
    pub end_secs: f64,
    pub text: String,
}

/// One `(start, end, word)` triple per token, so windows can be cut on word
/// boundaries while still tracking the timestamp of the cue each word came
/// from.
struct TimedWord {
    start: f64,
    end: f64,
    word: String,
}

fn timed_words(lesson: &ScrapedLesson) -> Vec<TimedWord> {
    let mut out = Vec::new();
    if !lesson.subtitles.cues.is_empty() {
        for c in &lesson.subtitles.cues {
            let t = c.text.trim();
            if t.is_empty() {
                continue;
            }
            for w in t.split_whitespace() {
                out.push(TimedWord {
                    start: c.start,
                    end: c.end,
                    word: w.to_string(),
                });
            }
        }
        if !out.is_empty() {
            return out;
        }
    }
    // Fallback: no usable cues — chunk the flat transcript with no timestamps.
    let body = ScrapedCourse::lesson_transcript(lesson);
    let dur = lesson.duration_secs.unwrap_or(0.0);
    for w in body.split_whitespace() {
        out.push(TimedWord {
            start: 0.0,
            end: dur,
            word: w.to_string(),
        });
    }
    out
}

/// Chunk every lesson in a course into overlapping timestamped windows.
pub fn chunk_course(course: &ScrapedCourse) -> Vec<TranscriptChunk> {
    let mut out = Vec::new();
    for lesson in &course.lessons {
        let words = timed_words(lesson);
        if words.is_empty() {
            continue;
        }

        let mut chunk_index = 0u32;
        let mut i = 0usize;
        while i < words.len() {
            let end = (i + TARGET_WORDS).min(words.len());
            let slice = &words[i..end];
            let text = slice
                .iter()
                .map(|w| w.word.as_str())
                .collect::<Vec<_>>()
                .join(" ");
            if !text.trim().is_empty() {
                out.push(TranscriptChunk {
                    course_slug: course.slug.clone(),
                    course_title: course.title.clone(),
                    course_url: course.url.clone(),
                    lesson_index: lesson.index,
                    lesson_title: lesson.title.clone(),
                    lesson_url: lesson.url.clone(),
                    chunk_index,
                    start_secs: slice.first().map(|w| w.start).unwrap_or(0.0),
                    end_secs: slice.last().map(|w| w.end).unwrap_or(0.0),
                    text,
                });
                chunk_index += 1;
            }
            if end == words.len() {
                break;
            }
            // Step forward leaving a rolling overlap for context continuity.
            i += TARGET_WORDS.saturating_sub(OVERLAP_WORDS).max(1);
        }
    }
    out
}

/// `hh:mm:ss`-ish label for a second offset (used in section headings).
pub fn fmt_ts(secs: f64) -> String {
    let s = secs.max(0.0).round() as u64;
    let (h, m, sec) = (s / 3600, (s % 3600) / 60, s % 60);
    if h > 0 {
        format!("{h}:{m:02}:{sec:02}")
    } else {
        format!("{m}:{sec:02}")
    }
}
