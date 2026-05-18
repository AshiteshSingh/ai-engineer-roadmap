//! Dedicated SQLite course store (`data/courses.db`).
//!
//! Replaces the Neon Postgres `external_courses` / `lesson_courses` /
//! `course_reviews` tables the retired Python `seed_topic_courses.py` and the
//! TS scripts wrote to. It lives in its **own** file — *not* `knowledge.db` —
//! because `seed:content` deletes and rebuilds `knowledge.db` from markdown on
//! every `content:build`, which would otherwise wipe scraped/reviewed courses.
//!
//! `crates/ml/core/src/bin/export_content.rs` reads this file and emits
//! `data/content/courses.json` + `course-reviews.json`; the Next.js frontend
//! reads those JSON files (`lib/db/queries.ts`). Keep this schema byte-for-byte
//! in sync with `src/db/courses-sqlite.ts` (the TS writers) — both run
//! `CREATE TABLE IF NOT EXISTS`, so column names/types must match what
//! `knowledge_ml_core::sqlite::load_external_courses` / `load_course_reviews`
//! select. Shared by `seed-topic-courses` (knowledge-ml-server) and the
//! `udemy rag-seed` bin (crates/udemy).

use rusqlite::{params, Connection};
use serde_json::Value;

/// Idempotent DDL. Mirrors `src/db/courses-sqlite.ts::COURSE_SCHEMA`.
pub const COURSE_SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS external_courses (
  id             TEXT PRIMARY KEY,
  title          TEXT NOT NULL,
  url            TEXT NOT NULL UNIQUE,
  provider       TEXT NOT NULL,
  description    TEXT,
  level          TEXT,
  rating         REAL,
  review_count   INTEGER,
  duration_hours REAL,
  is_free        INTEGER NOT NULL DEFAULT 1,
  enrolled       INTEGER,
  image_url      TEXT,
  language       TEXT NOT NULL DEFAULT 'English',
  topic_group    TEXT,
  metadata       TEXT NOT NULL DEFAULT '{}',
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS external_courses_provider_idx ON external_courses(provider);

CREATE TABLE IF NOT EXISTS lesson_courses (
  lesson_slug TEXT NOT NULL,
  course_id   TEXT NOT NULL REFERENCES external_courses(id) ON DELETE CASCADE,
  relevance   REAL NOT NULL DEFAULT 1.0,
  PRIMARY KEY (lesson_slug, course_id)
);
CREATE INDEX IF NOT EXISTS lesson_courses_slug_idx ON lesson_courses(lesson_slug);

CREATE TABLE IF NOT EXISTS course_reviews (
  id                          TEXT PRIMARY KEY,
  course_id                   TEXT NOT NULL UNIQUE REFERENCES external_courses(id) ON DELETE CASCADE,
  pedagogy_score              INTEGER,
  technical_accuracy_score    INTEGER,
  content_depth_score         INTEGER,
  practical_application_score INTEGER,
  instructor_clarity_score    INTEGER,
  curriculum_fit_score        INTEGER,
  prerequisites_score         INTEGER,
  ai_domain_relevance_score   INTEGER,
  community_health_score      INTEGER,
  value_proposition_score     INTEGER,
  aggregate_score             REAL,
  verdict                     TEXT,
  summary                     TEXT,
  expert_details              TEXT,
  model_version               TEXT NOT NULL DEFAULT 'deepseek-chat',
  reviewed_at                 TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS course_reviews_course_idx ON course_reviews(course_id);
";

/// Open (creating if needed) the course DB and ensure the schema exists.
pub fn open(path: &std::path::Path) -> anyhow::Result<Connection> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let conn = Connection::open(path)?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    conn.execute_batch(COURSE_SCHEMA)?;
    Ok(conn)
}

fn opt_str(v: Option<&Value>) -> Option<String> {
    match v {
        Some(Value::String(s)) if !s.is_empty() => Some(s.clone()),
        _ => None,
    }
}

fn opt_f64(v: Option<&Value>) -> Option<f64> {
    v.and_then(Value::as_f64)
}

fn opt_i64(v: Option<&Value>) -> Option<i64> {
    v.and_then(|x| x.as_i64().or_else(|| x.as_f64().map(|f| f as i64)))
}

/// `seed_topic_courses.py::slim_metadata` — drop bulky fields, cap lists.
pub fn slim_metadata(course: &Value) -> Value {
    let mut meta = course
        .get("metadata")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    meta.remove("requirements");
    meta.remove("targetAudience");
    if let Some(Value::Array(a)) = meta.get("whatYoullLearn") {
        meta.insert(
            "whatYoullLearn".into(),
            Value::Array(a.iter().take(8).cloned().collect()),
        );
    }
    if let Some(Value::Array(a)) = meta.get("curriculum") {
        meta.insert(
            "curriculum".into(),
            Value::Array(a.iter().take(20).cloned().collect()),
        );
    }
    Value::Object(meta)
}

/// Upsert one scraped course (conflict on `url`), returning its row id.
/// Mirrors the Python `UPSERT_COURSE_SQL` column-for-column.
pub fn upsert_course(
    conn: &Connection,
    course: &Value,
    topic_group: &str,
) -> anyhow::Result<String> {
    let c = course.as_object().cloned().unwrap_or_default();
    let title = opt_str(c.get("title")).unwrap_or_default();
    let url = opt_str(c.get("url")).ok_or_else(|| anyhow::anyhow!("course has no url"))?;
    let description = opt_str(c.get("description")).map(|d| d.chars().take(1500).collect::<String>());
    let level = opt_str(c.get("level"));
    let rating = opt_f64(c.get("rating"));
    let review_count = opt_i64(c.get("reviewCount"));
    let duration_hours = opt_f64(c.get("durationHours"));
    let is_free = c.get("isFree").and_then(Value::as_bool).unwrap_or(false);
    let enrolled = opt_i64(c.get("enrolled"));
    let image_url = opt_str(c.get("imageUrl"));
    let language = opt_str(c.get("language")).unwrap_or_else(|| "English".to_string());
    let metadata = serde_json::to_string(&slim_metadata(course))?;
    let id = uuid::Uuid::new_v4().to_string();

    let row_id: String = conn.query_row(
        "INSERT INTO external_courses (
            id, title, url, provider, description, level, rating, review_count,
            duration_hours, is_free, enrolled, image_url, language, topic_group,
            metadata, created_at, updated_at
         ) VALUES (
            ?1, ?2, ?3, 'Udemy', ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13,
            ?14, datetime('now'), datetime('now')
         )
         ON CONFLICT(url) DO UPDATE SET
            title = excluded.title,
            provider = excluded.provider,
            description = excluded.description,
            level = excluded.level,
            rating = excluded.rating,
            review_count = excluded.review_count,
            duration_hours = excluded.duration_hours,
            is_free = excluded.is_free,
            enrolled = excluded.enrolled,
            image_url = excluded.image_url,
            language = excluded.language,
            topic_group = excluded.topic_group,
            metadata = excluded.metadata,
            updated_at = datetime('now')
         RETURNING id",
        params![
            id,
            title,
            url,
            description,
            level,
            rating,
            review_count,
            duration_hours,
            i64::from(is_free),
            enrolled,
            image_url,
            language,
            topic_group,
            metadata,
        ],
        |r| r.get(0),
    )?;
    Ok(row_id)
}

/// Link a course to a lesson slug (conflict on the composite key updates
/// relevance). Mirrors the Python `UPSERT_LESSON_COURSE_SQL`.
pub fn link_lesson_course(
    conn: &Connection,
    lesson_slug: &str,
    course_id: &str,
    relevance: f64,
) -> anyhow::Result<()> {
    conn.execute(
        "INSERT INTO lesson_courses (lesson_slug, course_id, relevance)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(lesson_slug, course_id) DO UPDATE SET relevance = excluded.relevance",
        params![lesson_slug, course_id, relevance],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tempfile::TempDir;

    #[test]
    fn schema_is_idempotent_and_upsert_roundtrips() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("courses.db");
        let conn = open(&path).unwrap();
        // second open must not error (CREATE IF NOT EXISTS)
        drop(open(&path).unwrap());

        let course = json!({
            "title": "Public Speaking 101",
            "url": "https://www.udemy.com/course/ps101/",
            "description": "x".repeat(2000),
            "level": "Beginner",
            "rating": 4.6,
            "reviewCount": 1234,
            "durationHours": 3.5,
            "isFree": false,
            "enrolled": 50000,
            "imageUrl": "https://img/ps.jpg",
            "language": "English",
            "metadata": {
                "requirements": ["none"],
                "targetAudience": ["all"],
                "whatYoullLearn": (0..20).collect::<Vec<_>>(),
                "curriculum": (0..40).collect::<Vec<_>>(),
                "subtitle": "speak well"
            }
        });

        let id = upsert_course(&conn, &course, "Communication Skills").unwrap();
        link_lesson_course(&conn, "public-speaking", &id, 0.9).unwrap();

        // Re-upsert same url → same id (conflict path).
        let id2 = upsert_course(&conn, &course, "Communication Skills").unwrap();
        assert_eq!(id, id2);

        let (desc_len, meta): (usize, String) = conn
            .query_row(
                "SELECT length(description), metadata FROM external_courses WHERE id = ?1",
                [&id],
                |r| Ok((r.get::<_, i64>(0)? as usize, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(desc_len, 1500, "description truncated to 1500 chars");
        let m: Value = serde_json::from_str(&meta).unwrap();
        assert!(m.get("requirements").is_none());
        assert!(m.get("targetAudience").is_none());
        assert_eq!(m["whatYoullLearn"].as_array().unwrap().len(), 8);
        assert_eq!(m["curriculum"].as_array().unwrap().len(), 20);

        let n: i64 = conn
            .query_row(
                "SELECT count(*) FROM lesson_courses WHERE lesson_slug='public-speaking'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(n, 1);
    }
}
