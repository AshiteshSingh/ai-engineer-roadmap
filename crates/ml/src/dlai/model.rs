//! Serde model for `data/deeplearning/<slug>.json` (the scraper's output).

use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
pub struct ScrapedCourse {
    pub slug: String,
    #[serde(default)]
    pub provider: String,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub title: String,
    #[serde(default, rename = "scrapedAt")]
    pub scraped_at: String,
    #[serde(default)]
    pub lessons: Vec<ScrapedLesson>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ScrapedLesson {
    #[serde(default)]
    pub index: u32,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub url: String,
    #[serde(default, rename = "durationSecs")]
    pub duration_secs: Option<f64>,
    #[serde(default)]
    pub subtitles: Subtitles,
    #[serde(default, rename = "transcriptDom")]
    pub transcript_dom: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct Subtitles {
    #[serde(default)]
    pub source: String,
    #[serde(default)]
    pub cues: Vec<Cue>,
    #[serde(default)]
    pub text: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct Cue {
    #[serde(default)]
    pub start: f64,
    #[serde(default)]
    pub end: f64,
    #[serde(default)]
    pub text: String,
}

impl ScrapedCourse {
    /// Total runtime across lessons, in hours (0.0 when unknown).
    pub fn duration_hours(&self) -> f64 {
        let secs: f64 = self
            .lessons
            .iter()
            .filter_map(|l| l.duration_secs)
            .sum();
        (secs / 3600.0 * 100.0).round() / 100.0
    }

    /// Best-available plain transcript for a lesson: joined cue text, else the
    /// flat `subtitles.text`, else the DOM-scraped transcript.
    pub fn lesson_transcript(lesson: &ScrapedLesson) -> String {
        if !lesson.subtitles.cues.is_empty() {
            let joined = lesson
                .subtitles
                .cues
                .iter()
                .map(|c| c.text.trim())
                .filter(|t| !t.is_empty())
                .collect::<Vec<_>>()
                .join(" ");
            if !joined.trim().is_empty() {
                return joined;
            }
        }
        if !lesson.subtitles.text.trim().is_empty() {
            return lesson.subtitles.text.clone();
        }
        lesson.transcript_dom.clone()
    }
}
