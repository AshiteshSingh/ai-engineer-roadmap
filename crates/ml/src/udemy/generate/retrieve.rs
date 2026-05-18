//! Retrieval grounding: embed the topic, semantic-search the Udemy LanceDB
//! `courses` + `chapters` tables, and format a deterministic context block
//! injected into the research/outline/draft prompts.

use anyhow::Result;

use crate::udemy::embed::embed_one;
use crate::udemy::store::CourseStore;
use crate::udemy::types::{ChapterSearchResult, CourseSearchResult};

/// Semantic-retrieval results used to ground generation.
pub struct Grounding {
    pub courses: Vec<CourseSearchResult>,
    pub chapters: Vec<ChapterSearchResult>,
}

/// Embed `query` via the embed-server, then retrieve top courses + chapters.
pub async fn ground(
    store: &CourseStore,
    http: &reqwest::Client,
    embed_url: &str,
    query: &str,
    top_courses: usize,
    top_chapters: usize,
) -> Result<Grounding> {
    let vec = embed_one(http, embed_url, query).await?;
    ground_with_vec(store, vec, top_courses, top_chapters).await
}

/// LanceDB half (no network) — unit-testable.
pub async fn ground_with_vec(
    store: &CourseStore,
    query_vec: Vec<f32>,
    top_courses: usize,
    top_chapters: usize,
) -> Result<Grounding> {
    let courses = store.search(query_vec.clone(), top_courses).await?;
    let chapters = store.search_chapters(query_vec, top_chapters).await?;
    Ok(Grounding { courses, chapters })
}

/// Deterministic markdown block. Empty corpus -> graceful fallback line.
pub fn format_grounding(g: &Grounding) -> String {
    if g.courses.is_empty() && g.chapters.is_empty() {
        return "No Udemy grounding available; rely on general knowledge.".to_string();
    }
    let mut s = String::new();
    s.push_str("[UDEMY KNOWLEDGE GROUND TRUTH — derived from the Udemy course corpus]\n");
    if !g.courses.is_empty() {
        s.push_str("Relevant courses (semantic match):\n");
        for r in &g.courses {
            let c = &r.course;
            let desc: String = c.description.chars().take(240).collect();
            s.push_str(&format!(
                "- {} ({}, {:.1}★, {}) — {}\n",
                c.title, c.level, c.rating, c.instructor, desc
            ));
        }
    }
    if !g.chapters.is_empty() {
        s.push_str("Relevant curriculum chapters (what real courses teach, in order):\n");
        for r in &g.chapters {
            let ch = &r.chapter;
            s.push_str(&format!(
                "- [{}] §{} {}\n",
                ch.course_title,
                ch.chapter_index + 1,
                ch.title
            ));
        }
    }
    s.push_str("Use these as factual grounding for scope, terminology, and the topics practitioners expect. Do not cite Udemy or course names in the article body.\n");
    s.push_str("[END GROUND TRUTH]");
    s
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::udemy::types::{Chapter, Course};

    fn course(id: &str) -> Course {
        Course {
            course_id: id.into(),
            title: format!("Course {id}"),
            url: format!("https://www.udemy.com/course/{id}/"),
            description: "x".repeat(400),
            instructor: "Jane Doe".into(),
            level: "All Levels".into(),
            rating: 4.5,
            review_count: 1,
            num_students: 1,
            duration_hours: 1.0,
            price: "Free".into(),
            language: "English".into(),
            category: "Dev".into(),
            image_url: "img".into(),
            topics_json: "[]".into(),
        }
    }

    #[tokio::test]
    async fn ground_with_vec_retrieves_courses_and_chapters() {
        use crate::udemy::store::CourseStore;
        use crate::udemy::types::Chapter;

        let dir = tempfile::tempdir().unwrap();
        let mut store = CourseStore::connect(dir.path().to_str().unwrap())
            .await
            .unwrap();

        let courses = vec![course("a"), course("b")];
        let cvecs = vec![vec![1.0, 0.0, 0.0, 0.0], vec![0.0, 1.0, 0.0, 0.0]];
        store.add(&courses, &cvecs).await.unwrap();

        let chapters = vec![
            Chapter {
                course_id: "a".into(),
                course_title: "Course a".into(),
                chapter_index: 0,
                title: "Evaluation".into(),
            },
            Chapter {
                course_id: "b".into(),
                course_title: "Course b".into(),
                chapter_index: 0,
                title: "Vectors".into(),
            },
        ];
        let chvecs = vec![vec![1.0, 0.0, 0.0, 0.0], vec![0.0, 1.0, 0.0, 0.0]];
        store.add_chapters(&chapters, &chvecs).await.unwrap();

        let g = ground_with_vec(&store, vec![0.95, 0.05, 0.0, 0.0], 2, 2)
            .await
            .unwrap();
        assert_eq!(g.courses.len(), 2);
        assert_eq!(g.courses[0].course.course_id, "a", "nearest course first");
        assert!(g.chapters.iter().any(|c| c.chapter.title == "Evaluation"));
        let block = format_grounding(&g);
        assert!(block.starts_with("[UDEMY KNOWLEDGE GROUND TRUTH"));
        assert!(block.contains("Course a"));
        assert!(block.contains("§1 Evaluation"));
    }

    #[test]
    fn empty_grounding_fallback() {
        let g = Grounding { courses: vec![], chapters: vec![] };
        assert_eq!(
            format_grounding(&g),
            "No Udemy grounding available; rely on general knowledge."
        );
    }

    #[test]
    fn formats_courses_and_chapters_deterministically() {
        let g = Grounding {
            courses: vec![CourseSearchResult { course: course("a"), score: 0.9 }],
            chapters: vec![ChapterSearchResult {
                chapter: Chapter {
                    course_id: "a".into(),
                    course_title: "Course a".into(),
                    chapter_index: 2,
                    title: "Evaluation".into(),
                },
                score: 0.8,
            }],
        };
        let out = format_grounding(&g);
        assert!(out.starts_with("[UDEMY KNOWLEDGE GROUND TRUTH"));
        assert!(out.contains("[Course a] §3 Evaluation"));
        assert!(out.trim_end().ends_with("[END GROUND TRUTH]"));
        // description truncated to 240 chars
        let line = out.lines().find(|l| l.starts_with("- Course a (")).unwrap();
        assert!(line.matches('x').count() <= 240);
    }
}
