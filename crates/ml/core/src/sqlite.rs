//! Read/serialize the canonical SQLite store (`data/knowledge.db`).
//!
//! Rust is the only thing that touches SQLite. Next.js consumes the JSON
//! exported here; routing (`getUrlPath`) and the `excerpt`/`difficulty`
//! defaults are applied in `lib/content-json.ts`, so URL rules are not
//! duplicated in Rust.

use std::path::Path;

use rusqlite::{Connection, OpenFlags};
use serde::Serialize;

use crate::parser::excerpt_from_markdown;
use crate::types::Lesson;

/// Open the content database read-only.
pub fn open_ro(db_path: &Path) -> anyhow::Result<Connection> {
    Connection::open_with_flags(
        db_path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|e| anyhow::anyhow!("opening {}: {e}", db_path.display()))
}

/// Load all lessons from `db_path`, ordered by slug. `excerpt` is derived
/// from the markdown `content` using the same heuristic as the markdown
/// loader so the embedding text stays identical.
pub fn load_lessons_from_sqlite(db_path: &Path) -> anyhow::Result<Vec<Lesson>> {
    let conn = open_ro(db_path)?;
    let mut stmt = conn.prepare(
        "SELECT l.slug, l.title, l.content, l.word_count, c.name AS category
         FROM lessons l
         JOIN categories c ON c.id = l.category_id
         ORDER BY l.slug",
    )?;
    let rows = stmt.query_map([], |row| {
        let slug: String = row.get(0)?;
        let title: String = row.get(1)?;
        let content: String = row.get(2)?;
        let word_count: i64 = row.get(3)?;
        let category: String = row.get(4)?;
        Ok((slug, title, content, word_count, category))
    })?;

    let mut lessons = Vec::new();
    for row in rows {
        let (slug, title, content, word_count, category) = row?;
        let excerpt = excerpt_from_markdown(&content, 200);
        lessons.push(Lesson {
            slug,
            title,
            excerpt,
            content,
            category,
            word_count: word_count.max(0) as usize,
        });
    }
    Ok(lessons)
}

/* ── JSON export wire format ─────────────────────────────────────── */

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryRecord {
    pub name: String,
    pub slug: String,
    pub icon: String,
    pub description: String,
    pub gradient_from: String,
    pub gradient_to: String,
    pub sort_order: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LessonMeta {
    pub slug: String,
    pub number: i64,
    pub title: String,
    pub category: String,
    pub word_count: i64,
    pub reading_time_min: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LessonFull {
    pub slug: String,
    pub number: i64,
    pub title: String,
    pub category: String,
    pub word_count: i64,
    pub reading_time_min: i64,
    pub content: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentIndex {
    pub categories: Vec<CategoryRecord>,
    pub lessons: Vec<LessonMeta>,
    pub total_word_count: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SectionRecord {
    pub lesson_slug: String,
    pub lesson_title: String,
    pub heading: String,
    pub content: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobRecord {
    pub slug: String,
    pub company: String,
    pub position: String,
    pub location: Option<String>,
    pub url: Option<String>,
    pub description: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalCourseRecord {
    pub id: String,
    pub title: String,
    pub url: String,
    pub provider: String,
    pub description: Option<String>,
    pub level: Option<String>,
    pub rating: Option<f64>,
    pub review_count: Option<i64>,
    pub duration_hours: Option<f64>,
    pub is_free: bool,
    pub topic_group: Option<String>,
}

/// One row of the `lesson_courses` junction — joins a scraped course to a
/// lesson slug (e.g. `rag`, `embeddings`) with a 0–1 relevance score.
/// Exported to `data/content/lesson-courses.json` so the frontend can show
/// per-lesson "related courses" rails on /rag pages.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LessonCourse {
    pub lesson_slug: String,
    pub course_id: String,
    pub relevance: f64,
}

pub fn load_categories(conn: &Connection) -> anyhow::Result<Vec<CategoryRecord>> {
    let mut stmt = conn.prepare(
        "SELECT name, slug, icon, description, gradient_from, gradient_to, sort_order
         FROM categories ORDER BY sort_order",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(CategoryRecord {
            name: r.get(0)?,
            slug: r.get(1)?,
            icon: r.get(2)?,
            description: r.get(3)?,
            gradient_from: r.get(4)?,
            gradient_to: r.get(5)?,
            sort_order: r.get(6)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn load_lesson_meta(conn: &Connection) -> anyhow::Result<Vec<LessonMeta>> {
    let mut stmt = conn.prepare(
        "SELECT l.slug, l.number, l.title, c.name, l.word_count, l.reading_time_min
         FROM lessons l JOIN categories c ON c.id = l.category_id
         ORDER BY l.number",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(LessonMeta {
            slug: r.get(0)?,
            number: r.get(1)?,
            title: r.get(2)?,
            category: r.get(3)?,
            word_count: r.get(4)?,
            reading_time_min: r.get(5)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn load_lesson_full(conn: &Connection) -> anyhow::Result<Vec<LessonFull>> {
    let mut stmt = conn.prepare(
        "SELECT l.slug, l.number, l.title, c.name, l.word_count, l.reading_time_min, l.content
         FROM lessons l JOIN categories c ON c.id = l.category_id
         ORDER BY l.number",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(LessonFull {
            slug: r.get(0)?,
            number: r.get(1)?,
            title: r.get(2)?,
            category: r.get(3)?,
            word_count: r.get(4)?,
            reading_time_min: r.get(5)?,
            content: r.get(6)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// All lesson sections — the corpus for the JS search index (replaces FTS5).
pub fn load_sections(conn: &Connection) -> anyhow::Result<Vec<SectionRecord>> {
    let mut stmt = conn.prepare(
        "SELECT l.slug, l.title, ls.heading, ls.content
         FROM lesson_sections ls JOIN lessons l ON l.id = ls.lesson_id
         ORDER BY l.number, ls.section_order",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(SectionRecord {
            lesson_slug: r.get(0)?,
            lesson_title: r.get(1)?,
            heading: r.get(2)?,
            content: r.get(3)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn load_jobs(conn: &Connection) -> anyhow::Result<Vec<JobRecord>> {
    let mut stmt = match conn.prepare(
        "SELECT slug, company, position, location, url, description
         FROM public_jobs ORDER BY created_at DESC",
    ) {
        Ok(s) => s,
        Err(_) => return Ok(Vec::new()),
    };
    let rows = stmt.query_map([], |r| {
        Ok(JobRecord {
            slug: r.get(0)?,
            company: r.get(1)?,
            position: r.get(2)?,
            location: r.get(3)?,
            url: r.get(4)?,
            description: r.get(5)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// External courses. Returns `[]` if the table is absent (never populated).
pub fn load_external_courses(conn: &Connection) -> anyhow::Result<Vec<ExternalCourseRecord>> {
    let mut stmt = match conn.prepare(
        "SELECT id, title, url, provider, description, level, rating,
                review_count, duration_hours, is_free, topic_group
         FROM external_courses",
    ) {
        Ok(s) => s,
        Err(_) => return Ok(Vec::new()),
    };
    let rows = stmt.query_map([], |r| {
        Ok(ExternalCourseRecord {
            id: r.get(0)?,
            title: r.get(1)?,
            url: r.get(2)?,
            provider: r.get(3)?,
            description: r.get(4)?,
            level: r.get(5)?,
            rating: r.get(6)?,
            review_count: r.get(7)?,
            duration_hours: r.get(8)?,
            is_free: r.get::<_, i64>(9).unwrap_or(0) != 0,
            topic_group: r.get(10)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// Course reviews as raw JSON objects. Returns `[]` if the table is absent.
pub fn load_course_reviews(conn: &Connection) -> anyhow::Result<Vec<serde_json::Value>> {
    let mut stmt = match conn.prepare("SELECT * FROM course_reviews") {
        Ok(s) => s,
        Err(_) => return Ok(Vec::new()),
    };
    let cols: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
    let rows = stmt.query_map([], |row| {
        let mut obj = serde_json::Map::new();
        for (i, name) in cols.iter().enumerate() {
            let v = match row.get_ref(i)? {
                rusqlite::types::ValueRef::Null => serde_json::Value::Null,
                rusqlite::types::ValueRef::Integer(n) => serde_json::Value::from(n),
                rusqlite::types::ValueRef::Real(f) => serde_json::Value::from(f),
                rusqlite::types::ValueRef::Text(t) => {
                    serde_json::Value::from(String::from_utf8_lossy(t).to_string())
                }
                rusqlite::types::ValueRef::Blob(_) => serde_json::Value::Null,
            };
            obj.insert(name.clone(), v);
        }
        Ok(serde_json::Value::Object(obj))
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// Lesson↔course links. Returns `[]` if the table is absent.
pub fn load_lesson_courses(conn: &Connection) -> anyhow::Result<Vec<LessonCourse>> {
    let mut stmt =
        match conn.prepare("SELECT lesson_slug, course_id, relevance FROM lesson_courses") {
            Ok(s) => s,
            Err(_) => return Ok(Vec::new()),
        };
    let rows = stmt.query_map([], |r| {
        Ok(LessonCourse {
            lesson_slug: r.get(0)?,
            course_id: r.get(1)?,
            relevance: r.get::<_, f64>(2).unwrap_or(1.0),
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn load_content_index(conn: &Connection) -> anyhow::Result<ContentIndex> {
    let categories = load_categories(conn)?;
    let lessons = load_lesson_meta(conn)?;
    let total_word_count = lessons.iter().map(|l| l.word_count.max(0)).sum();
    Ok(ContentIndex {
        categories,
        lessons,
        total_word_count,
    })
}
