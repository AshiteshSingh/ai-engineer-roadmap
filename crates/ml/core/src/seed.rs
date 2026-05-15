//! Build the canonical SQLite store (`data/knowledge.db`) from `content/*.md`
//! plus `data/roadmap-meta.json` (category metadata + lesson ordering dumped
//! from `lib/articles.ts`). Replaces the old TS `seed-sqlite.ts` — Rust is
//! now the only thing that reads or writes SQLite.
//!
//! Tables: `categories`, `lessons`, `lesson_sections`, `public_jobs`.
//! (No FTS5 — search runs in JS over exported JSON. No embeddings.)

use std::collections::HashMap;
use std::fs;
use std::path::Path;

use rusqlite::{params, Connection};
use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryMeta {
    pub name: String,
    pub slug: String,
    pub icon: String,
    pub description: String,
    pub gradient_from: String,
    pub gradient_to: String,
    pub sort_order: i64,
    pub lesson_range_lo: i64,
    pub lesson_range_hi: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoadmapMeta {
    pub categories: Vec<CategoryMeta>,
    pub lesson_number: HashMap<String, i64>,
}

#[derive(Debug, Deserialize)]
struct JobJson {
    slug: String,
    company: String,
    position: String,
    location: Option<String>,
    url: Option<String>,
    description: String,
}

fn extract_title(content: &str) -> String {
    content
        .lines()
        .find_map(|l| l.strip_prefix("# "))
        .unwrap_or("Untitled")
        .trim()
        .to_string()
}

struct Section {
    heading: String,
    heading_level: i64,
    content: String,
    word_count: i64,
}

/// Port of seed-sqlite.ts `splitSections`: split markdown by H2/H3.
fn split_sections(markdown: &str) -> Vec<Section> {
    let mut sections = Vec::new();
    let mut heading = "Introduction".to_string();
    let mut level: i64 = 2;
    let mut buf: Vec<&str> = Vec::new();
    let mut past_title = false;

    fn flush(heading: &str, level: i64, buf: &[&str], out: &mut Vec<Section>) {
        let content = buf.join("\n").trim().to_string();
        if !content.is_empty() {
            let word_count = content.split_whitespace().count() as i64;
            out.push(Section {
                heading: heading.to_string(),
                heading_level: level,
                content,
                word_count,
            });
        }
    }

    for line in markdown.lines() {
        if !past_title && line.starts_with("# ") {
            past_title = true;
            continue;
        }
        let trimmed = line.trim_start();
        let hashes = trimmed.chars().take_while(|&c| c == '#').count();
        let is_h23 = (hashes == 2 || hashes == 3)
            && trimmed[hashes..].starts_with(' ')
            && !trimmed[hashes..].trim().is_empty();
        if is_h23 {
            flush(&heading, level, &buf, &mut sections);
            past_title = true;
            heading = trimmed[hashes..].trim().to_string();
            level = hashes as i64;
            buf.clear();
        } else {
            buf.push(line);
        }
    }
    flush(&heading, level, &buf, &mut sections);
    sections
}

fn category_for(number: i64, meta: &RoadmapMeta) -> Option<&CategoryMeta> {
    meta.categories
        .iter()
        .find(|c| number >= c.lesson_range_lo && number <= c.lesson_range_hi)
}

fn create_tables(conn: &Connection) -> anyhow::Result<()> {
    conn.execute_batch(
        "
        CREATE TABLE categories (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE,
          slug TEXT NOT NULL UNIQUE,
          icon TEXT NOT NULL,
          description TEXT NOT NULL,
          gradient_from TEXT NOT NULL,
          gradient_to TEXT NOT NULL,
          sort_order INTEGER NOT NULL,
          lesson_range_lo INTEGER NOT NULL,
          lesson_range_hi INTEGER NOT NULL
        );
        CREATE TABLE lessons (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          slug TEXT NOT NULL UNIQUE,
          number INTEGER NOT NULL UNIQUE,
          title TEXT NOT NULL,
          category_id INTEGER NOT NULL REFERENCES categories(id),
          word_count INTEGER NOT NULL DEFAULT 0,
          reading_time_min INTEGER NOT NULL DEFAULT 1,
          content TEXT NOT NULL
        );
        CREATE INDEX lessons_number_idx ON lessons(number);
        CREATE TABLE lesson_sections (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          lesson_id INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
          heading TEXT NOT NULL,
          heading_level INTEGER NOT NULL DEFAULT 2,
          content TEXT NOT NULL,
          section_order INTEGER NOT NULL,
          word_count INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX lesson_sections_lesson_idx ON lesson_sections(lesson_id);
        CREATE TABLE public_jobs (
          id TEXT PRIMARY KEY,
          slug TEXT NOT NULL UNIQUE,
          company TEXT NOT NULL,
          position TEXT NOT NULL,
          location TEXT,
          url TEXT,
          description TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );
        ",
    )?;
    Ok(())
}

/// Seed `db_path` from markdown + roadmap meta + job JSON. Recreates the file.
/// Returns `(categories, lessons, sections, jobs)` counts.
pub fn seed_content(
    db_path: &Path,
    content_dir: &Path,
    meta_path: &Path,
    jobs_dir: &Path,
) -> anyhow::Result<(usize, usize, usize, usize)> {
    let meta: RoadmapMeta = serde_json::from_str(&fs::read_to_string(meta_path)?)?;

    if let Some(parent) = db_path.parent() {
        fs::create_dir_all(parent)?;
    }
    for suffix in ["", "-wal", "-shm"] {
        let _ = fs::remove_file(format!("{}{}", db_path.display(), suffix));
    }

    let mut conn = Connection::open(db_path)?;
    conn.pragma_update(None, "journal_mode", "DELETE")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    create_tables(&conn)?;

    let tx = conn.transaction()?;

    let mut cat_id_by_name: HashMap<String, i64> = HashMap::new();
    for c in &meta.categories {
        tx.execute(
            "INSERT INTO categories (name, slug, icon, description, gradient_from, gradient_to, sort_order, lesson_range_lo, lesson_range_hi)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
            params![c.name, c.slug, c.icon, c.description, c.gradient_from, c.gradient_to, c.sort_order, c.lesson_range_lo, c.lesson_range_hi],
        )?;
        cat_id_by_name.insert(c.name.clone(), tx.last_insert_rowid());
    }

    let mut entries: Vec<_> = fs::read_dir(content_dir)?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.extension().and_then(|x| x.to_str()) == Some("md"))
        .collect();
    entries.sort();

    let mut lesson_count = 0usize;
    let mut section_count = 0usize;
    for path in entries {
        let slug = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or_default()
            .to_string();
        let Some(&number) = meta.lesson_number.get(&slug) else {
            continue;
        };
        let Some(cat) = category_for(number, &meta) else {
            continue;
        };
        let cat_id = cat_id_by_name[&cat.name];

        let content = fs::read_to_string(&path)?;
        let title = extract_title(&content);
        let word_count = content.split_whitespace().count() as i64;
        let reading_time_min = std::cmp::max(1, ((word_count as f64) / 200.0).round() as i64);

        tx.execute(
            "INSERT INTO lessons (slug, number, title, category_id, word_count, reading_time_min, content)
             VALUES (?1,?2,?3,?4,?5,?6,?7)",
            params![slug, number, title, cat_id, word_count, reading_time_min, content],
        )?;
        let lesson_id = tx.last_insert_rowid();
        lesson_count += 1;

        for (i, s) in split_sections(&content).into_iter().enumerate() {
            tx.execute(
                "INSERT INTO lesson_sections (lesson_id, heading, heading_level, content, section_order, word_count)
                 VALUES (?1,?2,?3,?4,?5,?6)",
                params![lesson_id, s.heading, s.heading_level, s.content, i as i64, s.word_count],
            )?;
            section_count += 1;
        }
    }

    let mut job_count = 0usize;
    if jobs_dir.is_dir() {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        for entry in fs::read_dir(jobs_dir)?.filter_map(|e| e.ok()) {
            let p = entry.path();
            if p.extension().and_then(|x| x.to_str()) != Some("json") {
                continue;
            }
            let job: JobJson = serde_json::from_str(&fs::read_to_string(&p)?)?;
            tx.execute(
                "INSERT OR REPLACE INTO public_jobs (id, slug, company, position, location, url, description, created_at)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
                params![job.slug, job.slug, job.company, job.position, job.location, job.url, job.description, now],
            )?;
            job_count += 1;
        }
    }

    tx.commit()?;
    Ok((meta.categories.len(), lesson_count, section_count, job_count))
}
