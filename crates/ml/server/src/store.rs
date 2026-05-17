//! LanceDB vector store for lesson sections.
//!
//! Schema: lesson_slug, lesson_title, heading, content, vector[1024].
//! Adapted from `crates/ml/topic-miner/src/store.rs` (same LanceDB 0.27 /
//! Arrow 57 API), using `anyhow::Result` instead of a candle-coupled error.

use std::sync::Arc;

use arrow_array::{
    Array, ArrayRef, FixedSizeListArray, Float32Array, RecordBatch, StringArray,
};
use arrow_schema::{DataType, Field, Schema};
use futures::TryStreamExt;
use lancedb::query::{ExecutableQuery, QueryBase};
use lancedb::Connection;
use tracing::info;

/// Embedding dimension — must match the embed server (`bge-large` = 1024).
pub const DIM: usize = 1024;
const TABLE: &str = "sections";

/// A lesson section to index.
#[derive(Debug, Clone)]
pub struct Section {
    pub lesson_slug: String,
    pub lesson_title: String,
    pub heading: String,
    pub content: String,
}

/// A row returned from a vector search (score = 1/(1+distance)).
#[derive(Debug, Clone)]
pub struct SectionHit {
    pub lesson_slug: String,
    pub lesson_title: String,
    pub heading: String,
    pub content: String,
    pub score: f32,
}

fn schema() -> Arc<Schema> {
    Arc::new(Schema::new(vec![
        Field::new("lesson_slug", DataType::Utf8, false),
        Field::new("lesson_title", DataType::Utf8, false),
        Field::new("heading", DataType::Utf8, false),
        Field::new("content", DataType::Utf8, false),
        Field::new(
            "vector",
            DataType::FixedSizeList(
                Arc::new(Field::new("item", DataType::Float32, true)),
                DIM as i32,
            ),
            true,
        ),
    ]))
}

pub struct SectionStore {
    conn: Connection,
}

impl SectionStore {
    /// Open (or create an empty) Lance store at `path`. The server uses this:
    /// if the index was never built the `sections` table simply has 0 rows
    /// and vector search returns nothing (lexical SQLite search still works).
    pub async fn connect(path: &str) -> anyhow::Result<Self> {
        let conn = lancedb::connect(path).execute().await?;

        let tables = conn.table_names().execute().await?;
        if !tables.contains(&TABLE.to_string()) {
            let batch = RecordBatch::new_empty(schema());
            conn.create_table(TABLE, batch).execute().await?;
            info!("created '{TABLE}' table in {path}");
        }

        Ok(Self { conn })
    }

    /// Insert sections that already have embeddings computed.
    pub async fn add(&self, sections: &[Section], vectors: &[Vec<f32>]) -> anyhow::Result<usize> {
        assert_eq!(sections.len(), vectors.len());
        if sections.is_empty() {
            return Ok(0);
        }

        let n = sections.len();
        let slugs: Vec<&str> = sections.iter().map(|s| s.lesson_slug.as_str()).collect();
        let titles: Vec<&str> = sections.iter().map(|s| s.lesson_title.as_str()).collect();
        let headings: Vec<&str> = sections.iter().map(|s| s.heading.as_str()).collect();
        let contents: Vec<&str> = sections.iter().map(|s| s.content.as_str()).collect();

        let mut flat: Vec<f32> = Vec::with_capacity(n * DIM);
        for v in vectors {
            anyhow::ensure!(
                v.len() == DIM,
                "embedding dimension {} != expected {DIM}",
                v.len()
            );
            flat.extend_from_slice(v);
        }
        let values = Float32Array::from(flat);
        let field = Arc::new(Field::new("item", DataType::Float32, true));
        let vecs = FixedSizeListArray::try_new(field, DIM as i32, Arc::new(values), None)?;

        let batch = RecordBatch::try_new(
            schema(),
            vec![
                Arc::new(StringArray::from(slugs)) as ArrayRef,
                Arc::new(StringArray::from(titles)) as ArrayRef,
                Arc::new(StringArray::from(headings)) as ArrayRef,
                Arc::new(StringArray::from(contents)) as ArrayRef,
                Arc::new(vecs) as ArrayRef,
            ],
        )?;

        let table = self.conn.open_table(TABLE).execute().await?;
        table.add(vec![batch]).execute().await?;

        info!("stored {n} section embeddings");
        Ok(n)
    }

    /// Top-k semantic search.
    pub async fn search(
        &self,
        query_vec: Vec<f32>,
        top_k: usize,
    ) -> anyhow::Result<Vec<SectionHit>> {
        let table = self.conn.open_table(TABLE).execute().await?;

        let stream = table
            .vector_search(query_vec)?
            .limit(top_k)
            .execute()
            .await?;
        let batches: Vec<RecordBatch> = stream.try_collect().await?;

        let mut results = Vec::new();
        for batch in &batches {
            let get_str = |col: &str| -> Vec<String> {
                batch
                    .column_by_name(col)
                    .and_then(|c| c.as_any().downcast_ref::<StringArray>())
                    .map(|a| (0..a.len()).map(|i| a.value(i).to_string()).collect())
                    .unwrap_or_default()
            };

            let slugs = get_str("lesson_slug");
            let titles = get_str("lesson_title");
            let headings = get_str("heading");
            let contents = get_str("content");
            let dists: Vec<f32> = batch
                .column_by_name("_distance")
                .and_then(|c| c.as_any().downcast_ref::<Float32Array>())
                .map(|a| (0..a.len()).map(|i| a.value(i)).collect())
                .unwrap_or_else(|| vec![1.0; batch.num_rows()]);

            for i in 0..batch.num_rows() {
                results.push(SectionHit {
                    lesson_slug: slugs.get(i).cloned().unwrap_or_default(),
                    lesson_title: titles.get(i).cloned().unwrap_or_default(),
                    heading: headings.get(i).cloned().unwrap_or_default(),
                    content: contents.get(i).cloned().unwrap_or_default(),
                    score: 1.0 / (1.0 + dists.get(i).copied().unwrap_or(1.0)),
                });
            }
        }

        results.sort_by(|a, b| {
            b.score
                .partial_cmp(&a.score)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        Ok(results)
    }

    /// Total rows in the `sections` table.
    pub async fn count(&self) -> anyhow::Result<usize> {
        let table = self.conn.open_table(TABLE).execute().await?;
        Ok(table.count_rows(None).await?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn sec(slug: &str, heading: &str) -> Section {
        Section {
            lesson_slug: slug.to_string(),
            lesson_title: format!("{slug} title"),
            heading: heading.to_string(),
            content: format!("content about {heading}"),
        }
    }

    #[tokio::test]
    async fn connect_creates_empty_table() {
        let dir = TempDir::new().unwrap();
        let store = SectionStore::connect(dir.path().to_str().unwrap())
            .await
            .unwrap();
        assert_eq!(store.count().await.unwrap(), 0);
    }

    #[tokio::test]
    async fn add_and_search_ranks_nearest() {
        let dir = TempDir::new().unwrap();
        let store = SectionStore::connect(dir.path().to_str().unwrap())
            .await
            .unwrap();

        let sections = vec![sec("rag", "Retrieval"), sec("agents", "Tool use")];
        let mut v1 = vec![0.1f32; DIM];
        v1[0] = 1.0;
        let mut v2 = vec![0.1f32; DIM];
        v2[1] = 1.0;
        store.add(&sections, &[v1.clone(), v2]).await.unwrap();
        assert_eq!(store.count().await.unwrap(), 2);

        let hits = store.search(v1, 2).await.unwrap();
        assert_eq!(hits.len(), 2);
        assert_eq!(hits[0].lesson_slug, "rag");
        assert!(hits[0].score > 0.0);
    }

    #[tokio::test]
    async fn add_rejects_wrong_dim() {
        let dir = TempDir::new().unwrap();
        let store = SectionStore::connect(dir.path().to_str().unwrap())
            .await
            .unwrap();
        let err = store
            .add(&[sec("x", "h")], &[vec![0.0f32; 8]])
            .await
            .unwrap_err();
        assert!(err.to_string().contains("dimension"));
    }
}
