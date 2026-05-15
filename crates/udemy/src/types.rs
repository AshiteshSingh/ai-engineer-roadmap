//! Udemy course data model.

use serde::{Deserialize, Serialize};

/// A Udemy course scraped from a course page.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Course {
    /// Slug derived from the URL path, e.g. "docker-and-kubernetes-the-complete-guide"
    pub course_id: String,
    pub title: String,
    pub url: String,
    pub description: String,
    pub instructor: String,
    /// "Beginner" | "Intermediate" | "Advanced" | "All Levels"
    pub level: String,
    pub rating: f32,
    pub review_count: u32,
    pub num_students: u32,
    pub duration_hours: f32,
    /// e.g. "$19.99" or "Free"
    pub price: String,
    pub language: String,
    pub category: String,
    pub image_url: String,
    /// JSON array of "what you'll learn" topics
    pub topics_json: String,
}

impl Course {
    /// Build the text used for embedding — rich signal for semantic search.
    pub fn embed_text(&self) -> String {
        let topics = serde_json::from_str::<Vec<String>>(&self.topics_json)
            .unwrap_or_default()
            .join(", ");

        let mut text = format!("{}\n\n{}", self.title, self.description);
        if !self.instructor.is_empty() {
            text.push_str(&format!("\n\nInstructor: {}.", self.instructor));
        }
        if !self.level.is_empty() {
            text.push_str(&format!(" Level: {}.", self.level));
        }
        if !topics.is_empty() {
            text.push_str(&format!(" Topics: {}.", topics));
        }
        text
    }
}

/// A course returned from a vector search, with similarity score.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CourseSearchResult {
    pub course: Course,
    pub score: f32,
}

// ── Crawler output types ────────────────────────────────────────────────────

/// JSON output matching the `external_courses` table schema.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExternalCourseJson {
    pub title: String,
    pub url: String,
    pub provider: String,
    pub description: Option<String>,
    pub level: Option<String>,
    pub rating: Option<f64>,
    pub review_count: Option<u32>,
    pub duration_hours: Option<f64>,
    pub is_free: bool,
    pub enrolled: Option<u32>,
    pub image_url: Option<String>,
    pub language: String,
    pub topic_group: String,
    pub metadata: serde_json::Value,
    pub slug_mappings: Vec<SlugMapping>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlugMapping {
    pub slug: String,
    pub relevance: f32,
}

/// Aggregate statistics for a crawl run.
#[derive(Debug, Default, Serialize, Deserialize)]
pub struct CrawlStats {
    pub topics_crawled: usize,
    pub topics_blocked: usize,
    pub courses_discovered: usize,
    pub courses_fetched: usize,
    pub courses_blocked: usize,
    pub courses_irrelevant: usize,
    pub courses_saved: usize,
    pub courses_failed: usize,
    pub elapsed_secs: f64,
}

impl std::fmt::Display for CrawlStats {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        writeln!(f, "Topics crawled:      {}", self.topics_crawled)?;
        writeln!(f, "Topics blocked:      {}", self.topics_blocked)?;
        writeln!(f, "Courses discovered:  {}", self.courses_discovered)?;
        writeln!(f, "Courses fetched:     {}", self.courses_fetched)?;
        writeln!(f, "Courses blocked:     {}", self.courses_blocked)?;
        writeln!(f, "Courses irrelevant:  {}", self.courses_irrelevant)?;
        writeln!(f, "Courses saved:       {}", self.courses_saved)?;
        writeln!(f, "Courses failed:      {}", self.courses_failed)?;
        write!(f, "Elapsed:             {:.1}s", self.elapsed_secs)
    }
}
