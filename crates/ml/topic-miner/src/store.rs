//! LanceDB vector store for extracted topics.
//!
//! Schema: slug, title, description, category, evidence (JSON), source_count, vector[1024]

use std::sync::Arc;

use arrow_array::{
    Array, ArrayRef, FixedSizeListArray, Float32Array, RecordBatch, StringArray, UInt32Array,
};
use arrow_schema::{DataType, Field, Schema};
use futures::TryStreamExt;
use lancedb::query::{ExecutableQuery, QueryBase};
use lancedb::Connection;
use tracing::info;

use crate::error::Result;
use crate::topic::{Evidence, Topic};

const TABLE: &str = "topics";
const DIM: usize = 1024;

fn schema() -> Arc<Schema> {
    Arc::new(Schema::new(vec![
        Field::new("slug", DataType::Utf8, false),
        Field::new("title", DataType::Utf8, false),
        Field::new("description", DataType::Utf8, false),
        Field::new("category", DataType::Utf8, false),
        Field::new("evidence", DataType::Utf8, false), // JSON string
        Field::new("source_count", DataType::UInt32, false),
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

pub struct TopicStore {
    conn: Connection,
}

impl TopicStore {
    /// Open (or create) a Lance store at `path`.
    pub async fn connect(path: &str) -> Result<Self> {
        let conn = lancedb::connect(path).execute().await?;

        let tables = conn.table_names().execute().await?;
        if !tables.contains(&TABLE.to_string()) {
            let batch = RecordBatch::new_empty(schema());
            conn.create_table(TABLE, batch).execute().await?;
            info!("Created '{TABLE}' table in {path}");
        }

        Ok(Self { conn })
    }

    /// Insert topics that already have embeddings computed.
    pub async fn add(&self, topics: &[Topic], vectors: &[Vec<f32>]) -> Result<usize> {
        assert_eq!(topics.len(), vectors.len());
        if topics.is_empty() {
            return Ok(0);
        }

        let n = topics.len();
        let slugs: Vec<&str> = topics.iter().map(|t| t.slug.as_str()).collect();
        let titles: Vec<&str> = topics.iter().map(|t| t.title.as_str()).collect();
        let descs: Vec<&str> = topics.iter().map(|t| t.description.as_str()).collect();
        let cats: Vec<&str> = topics.iter().map(|t| t.category.as_str()).collect();
        let evidence_json: Vec<String> = topics
            .iter()
            .map(|t| serde_json::to_string(&t.evidence).unwrap_or_else(|_| "[]".to_string()))
            .collect();
        let evidence_refs: Vec<&str> = evidence_json.iter().map(|s| s.as_str()).collect();
        let counts: Vec<u32> = topics.iter().map(|t| t.source_count as u32).collect();

        // Flatten vectors into contiguous buffer.
        let mut flat: Vec<f32> = Vec::with_capacity(n * DIM);
        for v in vectors {
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
                Arc::new(StringArray::from(descs)) as ArrayRef,
                Arc::new(StringArray::from(cats)) as ArrayRef,
                Arc::new(StringArray::from(evidence_refs)) as ArrayRef,
                Arc::new(UInt32Array::from(counts)) as ArrayRef,
                Arc::new(vecs) as ArrayRef,
            ],
        )?;

        let table = self.conn.open_table(TABLE).execute().await?;
        table.add(vec![batch]).execute().await?;

        info!("Stored {n} topic embeddings");
        Ok(n)
    }

    /// Semantic search over topics.
    pub async fn search(&self, query_vec: Vec<f32>, top_k: usize) -> Result<Vec<SearchResult>> {
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

            let slugs = get_str("slug");
            let titles = get_str("title");
            let descs = get_str("description");
            let cats = get_str("category");
            let evidence_strs = get_str("evidence");
            let dists: Vec<f32> = batch
                .column_by_name("_distance")
                .and_then(|c| c.as_any().downcast_ref::<Float32Array>())
                .map(|a| (0..a.len()).map(|i| a.value(i)).collect())
                .unwrap_or_else(|| vec![1.0; batch.num_rows()]);
            let counts: Vec<u32> = batch
                .column_by_name("source_count")
                .and_then(|c| c.as_any().downcast_ref::<UInt32Array>())
                .map(|a| (0..a.len()).map(|i| a.value(i)).collect())
                .unwrap_or_else(|| vec![0; batch.num_rows()]);

            for i in 0..batch.num_rows() {
                let evidence: Vec<Evidence> = evidence_strs
                    .get(i)
                    .and_then(|s| serde_json::from_str(s).ok())
                    .unwrap_or_default();

                results.push(SearchResult {
                    slug: slugs.get(i).cloned().unwrap_or_default(),
                    title: titles.get(i).cloned().unwrap_or_default(),
                    description: descs.get(i).cloned().unwrap_or_default(),
                    category: cats.get(i).cloned().unwrap_or_default(),
                    evidence,
                    source_count: counts.get(i).copied().unwrap_or(0) as usize,
                    score: 1.0 / (1.0 + dists.get(i).copied().unwrap_or(1.0)),
                });
            }
        }

        results.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
        Ok(results)
    }

    /// Total rows in the topics table.
    pub async fn count(&self) -> Result<usize> {
        let table = self.conn.open_table(TABLE).execute().await?;
        Ok(table.count_rows(None).await?)
    }
}

/// A row returned from a vector search.
#[derive(Debug, Clone)]
pub struct SearchResult {
    pub slug: String,
    pub title: String,
    pub description: String,
    pub category: String,
    pub evidence: Vec<Evidence>,
    pub source_count: usize,
    pub score: f32,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::topic::Evidence;
    use tempfile::TempDir;

    fn fake_topic(slug: &str, title: &str, category: &str, source_count: usize) -> Topic {
        Topic {
            slug: slug.to_string(),
            title: title.to_string(),
            description: format!("{title} is used in {source_count} files."),
            category: category.to_string(),
            evidence: vec![Evidence {
                file: "test.ts".to_string(),
                line: 1,
                snippet: "test snippet".to_string(),
            }],
            source_count,
        }
    }

    fn fake_vector() -> Vec<f32> {
        vec![0.0f32; DIM]
    }

    #[tokio::test]
    async fn connect_creates_table() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().to_str().unwrap();
        let store = TopicStore::connect(path).await.unwrap();
        let count = store.count().await.unwrap();
        assert_eq!(count, 0);
    }

    #[tokio::test]
    async fn connect_idempotent() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().to_str().unwrap();
        let _store1 = TopicStore::connect(path).await.unwrap();
        let store2 = TopicStore::connect(path).await.unwrap();
        assert_eq!(store2.count().await.unwrap(), 0);
    }

    #[tokio::test]
    async fn add_and_count() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().to_str().unwrap();
        let store = TopicStore::connect(path).await.unwrap();

        let topics = vec![
            fake_topic("react", "React", "Frontend", 5),
            fake_topic("typescript", "TypeScript", "Languages", 10),
        ];
        let vectors = vec![fake_vector(), fake_vector()];

        let added = store.add(&topics, &vectors).await.unwrap();
        assert_eq!(added, 2);

        let count = store.count().await.unwrap();
        assert_eq!(count, 2);
    }

    #[tokio::test]
    async fn add_empty_returns_zero() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().to_str().unwrap();
        let store = TopicStore::connect(path).await.unwrap();

        let added = store.add(&[], &[]).await.unwrap();
        assert_eq!(added, 0);
    }

    #[tokio::test]
    async fn search_returns_results() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().to_str().unwrap();
        let store = TopicStore::connect(path).await.unwrap();

        let topics = vec![
            fake_topic("react", "React", "Frontend", 5),
            fake_topic("vue", "Vue.js", "Frontend", 3),
        ];
        // Give them slightly different vectors so search can rank them
        let mut v1 = vec![0.1f32; DIM];
        v1[0] = 1.0;
        let mut v2 = vec![0.1f32; DIM];
        v2[1] = 1.0;

        store.add(&topics, &vec![v1.clone(), v2]).await.unwrap();

        let results = store.search(v1, 2).await.unwrap();
        assert_eq!(results.len(), 2);
        // The first result should be "react" since the query vector matches v1
        assert_eq!(results[0].slug, "react");
        assert!(results[0].score > 0.0);
        assert!(!results[0].evidence.is_empty());
    }

    #[test]
    fn schema_has_correct_fields() {
        let s = schema();
        assert_eq!(s.fields().len(), 7);
        assert!(s.field_with_name("slug").is_ok());
        assert!(s.field_with_name("title").is_ok());
        assert!(s.field_with_name("description").is_ok());
        assert!(s.field_with_name("category").is_ok());
        assert!(s.field_with_name("evidence").is_ok());
        assert!(s.field_with_name("source_count").is_ok());
        assert!(s.field_with_name("vector").is_ok());
    }
}
