//! RAG retrieval: SQLite lexical search + LanceDB vector search, merged with
//! caller-supplied snippets. Snippet text mirrors `app/api/chat/route.ts`
//! (`[<lesson_title> > <heading>]\n<content>`) so the LLM sees a consistent
//! context format regardless of source.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use rusqlite::{Connection, OpenFlags};
use serde::Deserialize;
use tracing::warn;

use crate::store::{Section, SectionHit, SectionStore, DIM};

/// Max excerpts handed to the model.
pub const MAX_SNIPPETS: usize = 6;
/// Per-snippet content cap (chars).
const SNIPPET_CHARS: usize = 700;

// ── Embed server client ───────────────────────────────────────────────────

#[derive(Deserialize)]
struct EmbedResponse {
    data: Vec<EmbedDatum>,
}

#[derive(Deserialize)]
struct EmbedDatum {
    embedding: Vec<f32>,
    #[serde(default)]
    index: usize,
}

/// Embed a single string via the candle embed server.
pub async fn embed_one(
    client: &reqwest::Client,
    embed_url: &str,
    text: &str,
) -> anyhow::Result<Vec<f32>> {
    let mut v = embed_batch(client, embed_url, &[text.to_string()]).await?;
    v.pop()
        .ok_or_else(|| anyhow::anyhow!("embed server returned no data"))
}

/// Embed a batch; output is index-aligned to `texts`.
pub async fn embed_batch(
    client: &reqwest::Client,
    embed_url: &str,
    texts: &[String],
) -> anyhow::Result<Vec<Vec<f32>>> {
    if texts.is_empty() {
        return Ok(Vec::new());
    }
    let url = format!("{}/embed", embed_url.trim_end_matches('/'));
    let resp = client
        .post(&url)
        .json(&serde_json::json!({ "input": texts }))
        .send()
        .await?;
    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        anyhow::bail!("embed server {status}: {body}");
    }
    let parsed: EmbedResponse = resp.json().await?;

    let mut out = vec![Vec::new(); texts.len()];
    for d in parsed.data {
        if d.index < out.len() {
            out[d.index] = d.embedding;
        }
    }
    for (i, e) in out.iter().enumerate() {
        anyhow::ensure!(
            e.len() == DIM,
            "embedding {i} has dim {} != expected {DIM}",
            e.len()
        );
    }
    Ok(out)
}

// ── SQLite content access ─────────────────────────────────────────────────

fn open_ro(db_path: &Path) -> anyhow::Result<Connection> {
    Connection::open_with_flags(
        db_path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|e| anyhow::anyhow!("opening {}: {e}", db_path.display()))
}

/// Every lesson section — the corpus the LanceDB index is built from. Same
/// query/order as `knowledge_ml_core::sqlite::load_sections`.
pub fn load_all_sections(db_path: &Path) -> anyhow::Result<Vec<Section>> {
    let conn = open_ro(db_path)?;
    let mut stmt = conn.prepare(
        "SELECT l.slug, l.title, ls.heading, ls.content
         FROM lesson_sections ls JOIN lessons l ON l.id = ls.lesson_id
         ORDER BY l.number, ls.section_order",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(Section {
            lesson_slug: r.get(0)?,
            lesson_title: r.get(1)?,
            heading: r.get(2)?,
            content: r.get(3)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

fn tokenize(query: &str) -> Vec<String> {
    let mut seen = HashSet::new();
    query
        .to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|t| t.len() >= 3)
        .filter(|t| seen.insert(t.to_string()))
        .take(8)
        .map(|t| t.to_string())
        .collect()
}

/// Lexical fallback search over `lesson_sections`. Ranks by how many distinct
/// query tokens appear in the section (title/heading/content), normalized to
/// `[0, 1]` so scores are comparable with vector hits.
pub fn sqlite_search(
    db_path: &Path,
    query: &str,
    limit: usize,
) -> anyhow::Result<Vec<SectionHit>> {
    let tokens = tokenize(query);
    if tokens.is_empty() {
        return Ok(Vec::new());
    }

    let conn = open_ro(db_path)?;
    let clause = tokens
        .iter()
        .enumerate()
        .map(|(i, _)| {
            let p = i + 1;
            format!("(lower(ls.content) LIKE ?{p} OR lower(ls.heading) LIKE ?{p} OR lower(l.title) LIKE ?{p})")
        })
        .collect::<Vec<_>>()
        .join(" OR ");
    let sql = format!(
        "SELECT l.slug, l.title, ls.heading, ls.content
         FROM lesson_sections ls JOIN lessons l ON l.id = ls.lesson_id
         WHERE {clause}
         LIMIT 300"
    );

    let like_params: Vec<String> = tokens.iter().map(|t| format!("%{t}%")).collect();
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(rusqlite::params_from_iter(like_params.iter()), |r| {
        let slug: String = r.get(0)?;
        let title: String = r.get(1)?;
        let heading: String = r.get(2)?;
        let content: String = r.get(3)?;
        Ok((slug, title, heading, content))
    })?;

    let mut hits = Vec::new();
    for row in rows {
        let (lesson_slug, lesson_title, heading, content) = row?;
        let hay = format!(
            "{} {} {}",
            content.to_lowercase(),
            heading.to_lowercase(),
            lesson_title.to_lowercase()
        );
        let matched = tokens.iter().filter(|t| hay.contains(t.as_str())).count();
        if matched == 0 {
            continue;
        }
        hits.push(SectionHit {
            lesson_slug,
            lesson_title,
            heading,
            content,
            score: matched as f32 / tokens.len() as f32,
        });
    }
    hits.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    hits.truncate(limit);
    Ok(hits)
}

// ── Snippet formatting ────────────────────────────────────────────────────

fn truncate_chars(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    let mut out: String = s.chars().take(max).collect();
    out.push('…');
    out
}

fn format_snippet(hit: &SectionHit) -> String {
    format!(
        "[{} > {}]\n{}",
        hit.lesson_title,
        hit.heading,
        truncate_chars(hit.content.trim(), SNIPPET_CHARS)
    )
}

// ── Retriever ─────────────────────────────────────────────────────────────

pub struct Retriever {
    db_path: PathBuf,
    store: SectionStore,
    embed_url: String,
    http: reqwest::Client,
}

impl Retriever {
    pub async fn new(
        db_path: impl Into<PathBuf>,
        lancedb_path: &str,
        embed_url: String,
    ) -> anyhow::Result<Self> {
        Ok(Self {
            db_path: db_path.into(),
            store: SectionStore::connect(lancedb_path).await?,
            embed_url,
            http: reqwest::Client::new(),
        })
    }

    /// Build the merged context. Caller snippets (from the Next.js Postgres
    /// search layer) are kept first and most-trusted; vector and lexical hits
    /// fill the rest. Never errors — retrieval is best-effort.
    pub async fn retrieve(&self, query: &str, caller_snippets: &[String]) -> Vec<String> {
        let mut out: Vec<String> = Vec::new();
        let mut seen: HashSet<String> = HashSet::new();

        for s in caller_snippets {
            let key = s.trim().to_string();
            if !key.is_empty() && seen.insert(key) {
                out.push(s.clone());
            }
        }

        // Vector search (best-effort: skip on embed/store failure).
        match embed_one(&self.http, &self.embed_url, query).await {
            Ok(qv) => match self.store.search(qv, MAX_SNIPPETS).await {
                Ok(hits) => self.absorb(hits, &mut out, &mut seen),
                Err(e) => warn!("lancedb search failed: {e}"),
            },
            Err(e) => warn!("query embed failed (vector search skipped): {e}"),
        }

        // Lexical fallback / supplement.
        match sqlite_search(&self.db_path, query, MAX_SNIPPETS) {
            Ok(hits) => self.absorb(hits, &mut out, &mut seen),
            Err(e) => warn!("sqlite search failed: {e}"),
        }

        out.truncate(MAX_SNIPPETS);
        out
    }

    fn absorb(&self, hits: Vec<SectionHit>, out: &mut Vec<String>, seen: &mut HashSet<String>) {
        for h in hits {
            if out.len() >= MAX_SNIPPETS {
                break;
            }
            let key = format!("{}#{}", h.lesson_slug, h.heading);
            if seen.insert(key) {
                out.push(format_snippet(&h));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;
    use tempfile::TempDir;

    fn fixture_db(dir: &TempDir) -> PathBuf {
        let path = dir.path().join("knowledge.db");
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(
            "CREATE TABLE categories (id INTEGER PRIMARY KEY, name TEXT);
             CREATE TABLE lessons (id INTEGER PRIMARY KEY, slug TEXT, number INTEGER,
                 title TEXT, category_id INTEGER);
             CREATE TABLE lesson_sections (id INTEGER PRIMARY KEY, lesson_id INTEGER,
                 heading TEXT, content TEXT, section_order INTEGER);
             INSERT INTO categories VALUES (1,'Core');
             INSERT INTO lessons VALUES (1,'rag',1,'Retrieval Augmented Generation',1);
             INSERT INTO lesson_sections VALUES
                 (1,1,'Overview','RAG retrieves documents then conditions generation on them.',1),
                 (2,1,'Chunking','Chunk size affects retrieval recall and precision.',2);",
        )
        .unwrap();
        path
    }

    #[test]
    fn tokenize_filters_short_and_dupes() {
        let t = tokenize("What is a RAG, a RAG pipeline?");
        assert!(t.contains(&"rag".to_string()));
        assert!(t.contains(&"pipeline".to_string()));
        assert!(!t.contains(&"is".to_string())); // < 3 chars
        assert_eq!(t.iter().filter(|x| *x == "rag").count(), 1);
    }

    #[test]
    fn sqlite_search_ranks_and_formats() {
        let dir = TempDir::new().unwrap();
        let db = fixture_db(&dir);
        let hits = sqlite_search(&db, "rag retrieval generation", 5).unwrap();
        assert!(!hits.is_empty());
        assert_eq!(hits[0].lesson_slug, "rag");
        let snip = format_snippet(&hits[0]);
        assert!(snip.starts_with("[Retrieval Augmented Generation > "));
    }

    #[test]
    fn sqlite_search_empty_query_returns_nothing() {
        let dir = TempDir::new().unwrap();
        let db = fixture_db(&dir);
        assert!(sqlite_search(&db, "a an", 5).unwrap().is_empty());
    }

    #[tokio::test]
    async fn retrieve_keeps_caller_snippets_when_embed_unreachable() {
        let dir = TempDir::new().unwrap();
        let db = fixture_db(&dir);
        let lance = dir.path().join("lancedb");
        let r = Retriever::new(
            db,
            lance.to_str().unwrap(),
            "http://127.0.0.1:1".to_string(), // unreachable embed server
        )
        .await
        .unwrap();

        let caller = vec!["[Caller > X]\nprovided context".to_string()];
        let snippets = r.retrieve("rag retrieval", &caller).await;
        assert!(snippets.iter().any(|s| s.contains("provided context")));
        // Lexical fallback still contributes from SQLite.
        assert!(snippets.iter().any(|s| s.contains("RAG retrieves documents")));
        assert!(snippets.len() <= MAX_SNIPPETS);
    }
}
