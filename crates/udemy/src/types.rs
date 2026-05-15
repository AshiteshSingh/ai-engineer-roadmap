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

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_course() -> Course {
        Course {
            course_id: "rust-101".to_string(),
            title: "Rust 101".to_string(),
            url: "https://www.udemy.com/course/rust-101/".to_string(),
            description: "Intro to Rust.".to_string(),
            instructor: "Jane Doe".to_string(),
            level: "Beginner".to_string(),
            rating: 4.7,
            review_count: 321,
            num_students: 9000,
            duration_hours: 8.5,
            price: "$19.99".to_string(),
            language: "English".to_string(),
            category: "Development".to_string(),
            image_url: "https://img/x.jpg".to_string(),
            topics_json: "[\"Ownership\",\"Traits\"]".to_string(),
        }
    }

    #[test]
    fn embed_text_includes_topics_instructor_and_level() {
        let text = sample_course().embed_text();
        assert!(text.starts_with("Rust 101\n\nIntro to Rust."));
        assert!(text.contains("Instructor: Jane Doe."));
        assert!(text.contains("Level: Beginner."));
        assert!(text.contains("Topics: Ownership, Traits."));
    }

    #[test]
    fn embed_text_omits_empty_optional_segments() {
        let mut c = sample_course();
        c.instructor = String::new();
        c.level = String::new();
        c.topics_json = "[]".to_string();
        let text = c.embed_text();
        assert!(!text.contains("Instructor:"));
        assert!(!text.contains("Level:"));
        assert!(!text.contains("Topics:"));
    }

    #[test]
    fn embed_text_tolerates_malformed_topics_json() {
        for bad in ["not json", "{}", ""] {
            let mut c = sample_course();
            c.topics_json = bad.to_string();
            let text = c.embed_text(); // must not panic
            assert!(!text.contains("Topics:"), "bad input {bad:?}");
        }
    }

    #[test]
    fn course_serde_round_trip() {
        let c = sample_course();
        let json = serde_json::to_string(&c).unwrap();
        let back: Course = serde_json::from_str(&json).unwrap();
        assert_eq!(back.course_id, c.course_id);
        assert_eq!(back.rating, c.rating);
        assert_eq!(back.topics_json, c.topics_json);
    }

    #[test]
    fn course_search_result_serde_round_trip() {
        let r = CourseSearchResult {
            course: sample_course(),
            score: 0.87,
        };
        let json = serde_json::to_string(&r).unwrap();
        let back: CourseSearchResult = serde_json::from_str(&json).unwrap();
        assert_eq!(back.course.course_id, r.course.course_id);
        assert!((back.score - r.score).abs() < 1e-6);
    }

    #[test]
    fn external_course_json_serde_round_trip() {
        let ext = ExternalCourseJson {
            title: "T".to_string(),
            url: "u".to_string(),
            provider: "udemy".to_string(),
            description: None,
            level: Some("Beginner".to_string()),
            rating: None,
            review_count: None,
            duration_hours: Some(3.0),
            is_free: true,
            enrolled: Some(10),
            image_url: None,
            language: "English".to_string(),
            topic_group: "RAG & Vector Search".to_string(),
            metadata: serde_json::Value::Null,
            slug_mappings: vec![SlugMapping {
                slug: "rag".to_string(),
                relevance: 0.9,
            }],
        };
        let json = serde_json::to_string(&ext).unwrap();
        let back: ExternalCourseJson = serde_json::from_str(&json).unwrap();
        assert_eq!(back.title, ext.title);
        assert_eq!(back.description, None);
        assert!(back.is_free);
        assert_eq!(back.slug_mappings.len(), 1);
        assert_eq!(back.slug_mappings[0].slug, "rag");
    }

    #[test]
    fn crawl_stats_display_has_labels_and_elapsed() {
        let stats = CrawlStats {
            topics_crawled: 3,
            courses_saved: 7,
            elapsed_secs: 1.25,
            ..Default::default()
        };
        let s = stats.to_string();
        assert!(s.contains("Topics crawled:"));
        assert!(s.contains("Courses saved:"));
        assert!(s.contains(&format!("Elapsed:             {:.1}s", stats.elapsed_secs)));
    }
}
