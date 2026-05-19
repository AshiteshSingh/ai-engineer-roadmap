//! LanceDB vector store for DeepLearning.AI transcript chunks.
//!
//! One table, `dl_transcript_chunks`, modeled on [`crate::udemy::store`].
//! Re-runs are idempotent: the table is dropped and rebuilt from scratch.

use std::sync::Arc;

use anyhow::Result;
use arrow_array::{
    Array, ArrayRef, FixedSizeListArray, Float32Array, Float64Array, RecordBatch, StringArray,
    UInt32Array,
};
use arrow_schema::{DataType, Field, Schema};
use futures::TryStreamExt;
use lancedb::query::{ExecutableQuery, QueryBase};
use lancedb::Connection;
use tracing::info;

use crate::dlai::chunk::TranscriptChunk;

const TABLE: &str = "dl_transcript_chunks";

fn schema(dim: i32) -> Arc<Schema> {
    Arc::new(Schema::new(vec![
        Field::new("course_slug", DataType::Utf8, false),
        Field::new("course_title", DataType::Utf8, false),
        Field::new("course_url", DataType::Utf8, false),
        Field::new("lesson_index", DataType::UInt32, false),
        Field::new("lesson_title", DataType::Utf8, false),
        Field::new("lesson_url", DataType::Utf8, false),
        Field::new("chunk_index", DataType::UInt32, false),
        Field::new("start_secs", DataType::Float64, false),
        Field::new("end_secs", DataType::Float64, false),
        Field::new("text", DataType::Utf8, false),
        Field::new(
            "vector",
            DataType::FixedSizeList(Arc::new(Field::new("item", DataType::Float32, true)), dim),
            true,
        ),
    ]))
}

pub struct TranscriptStore {
    conn: Connection,
}

impl TranscriptStore {
    pub async fn connect(path: &str) -> Result<Self> {
        let conn = lancedb::connect(path).execute().await?;
        Ok(Self { conn })
    }

    /// Drop the table if present so a re-run fully replaces prior data.
    pub async fn reset(&self) -> Result<()> {
        let tables = self.conn.table_names().execute().await?;
        if tables.contains(&TABLE.to_string()) {
            self.conn.drop_table(TABLE, &[]).await?;
            info!("Dropped existing '{TABLE}' table");
        }
        Ok(())
    }

    /// Insert chunks that already have embeddings computed.
    pub async fn add(&self, chunks: &[TranscriptChunk], vectors: &[Vec<f32>]) -> Result<usize> {
        if chunks.len() != vectors.len() {
            anyhow::bail!(
                "chunks.len()={} != vectors.len()={}",
                chunks.len(),
                vectors.len()
            );
        }
        if chunks.is_empty() {
            return Ok(0);
        }
        let dim = vectors[0].len();
        if dim == 0 {
            anyhow::bail!("embedding vectors have zero dimension");
        }
        if let Some(bad) = vectors.iter().position(|v| v.len() != dim) {
            anyhow::bail!("vector {bad} has dim {} != expected {dim}", vectors[bad].len());
        }

        let tables = self.conn.table_names().execute().await?;
        if !tables.contains(&TABLE.to_string()) {
            let empty = RecordBatch::new_empty(schema(dim as i32));
            self.conn.create_table(TABLE, empty).execute().await?;
            info!("Created '{TABLE}' table (dim={dim})");
        }

        let n = chunks.len();
        let course_slugs: Vec<&str> = chunks.iter().map(|c| c.course_slug.as_str()).collect();
        let course_titles: Vec<&str> = chunks.iter().map(|c| c.course_title.as_str()).collect();
        let course_urls: Vec<&str> = chunks.iter().map(|c| c.course_url.as_str()).collect();
        let lesson_idxs: Vec<u32> = chunks.iter().map(|c| c.lesson_index).collect();
        let lesson_titles: Vec<&str> = chunks.iter().map(|c| c.lesson_title.as_str()).collect();
        let lesson_urls: Vec<&str> = chunks.iter().map(|c| c.lesson_url.as_str()).collect();
        let chunk_idxs: Vec<u32> = chunks.iter().map(|c| c.chunk_index).collect();
        let starts: Vec<f64> = chunks.iter().map(|c| c.start_secs).collect();
        let ends: Vec<f64> = chunks.iter().map(|c| c.end_secs).collect();
        let texts: Vec<&str> = chunks.iter().map(|c| c.text.as_str()).collect();

        let mut flat: Vec<f32> = Vec::with_capacity(n * dim);
        for v in vectors {
            flat.extend_from_slice(v);
        }
        let field = Arc::new(Field::new("item", DataType::Float32, true));
        let vecs = FixedSizeListArray::try_new(
            field,
            dim as i32,
            Arc::new(Float32Array::from(flat)),
            None,
        )?;

        let batch = RecordBatch::try_new(
            schema(dim as i32),
            vec![
                Arc::new(StringArray::from(course_slugs)) as ArrayRef,
                Arc::new(StringArray::from(course_titles)),
                Arc::new(StringArray::from(course_urls)),
                Arc::new(UInt32Array::from(lesson_idxs)),
                Arc::new(StringArray::from(lesson_titles)),
                Arc::new(StringArray::from(lesson_urls)),
                Arc::new(UInt32Array::from(chunk_idxs)),
                Arc::new(Float64Array::from(starts)),
                Arc::new(Float64Array::from(ends)),
                Arc::new(StringArray::from(texts)),
                Arc::new(vecs) as ArrayRef,
            ],
        )?;

        let table = self.conn.open_table(TABLE).execute().await?;
        table.add(vec![batch]).execute().await?;
        info!("Stored {n} transcript-chunk embeddings");
        Ok(n)
    }

    pub async fn count(&self) -> Result<usize> {
        let tables = self.conn.table_names().execute().await?;
        if !tables.contains(&TABLE.to_string()) {
            return Ok(0);
        }
        let table = self.conn.open_table(TABLE).execute().await?;
        Ok(table.count_rows(None).await?)
    }

    /// Semantic search over transcript chunks (pre-computed query vector).
    pub async fn search(
        &self,
        query_vec: Vec<f32>,
        top_k: usize,
    ) -> Result<Vec<(TranscriptChunk, f32)>> {
        let table = self.conn.open_table(TABLE).execute().await?;
        let stream = table
            .vector_search(query_vec)?
            .limit(top_k)
            .execute()
            .await?;
        let batches: Vec<RecordBatch> = stream.try_collect().await?;
        let mut out = Vec::new();
        for batch in &batches {
            for i in 0..batch.num_rows() {
                let dist = batch
                    .column_by_name("_distance")
                    .and_then(|c| c.as_any().downcast_ref::<Float32Array>())
                    .map(|c| c.value(i))
                    .unwrap_or(1.0);
                out.push((chunk_from_batch(batch, i), 1.0 / (1.0 + dist)));
            }
        }
        out.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        Ok(out)
    }
}

fn chunk_from_batch(batch: &RecordBatch, i: usize) -> TranscriptChunk {
    let s = |name: &str| -> String {
        batch
            .column_by_name(name)
            .and_then(|c| c.as_any().downcast_ref::<StringArray>())
            .map(|c| c.value(i).to_string())
            .unwrap_or_default()
    };
    let u = |name: &str| -> u32 {
        batch
            .column_by_name(name)
            .and_then(|c| c.as_any().downcast_ref::<UInt32Array>())
            .map(|c| c.value(i))
            .unwrap_or(0)
    };
    let f = |name: &str| -> f64 {
        batch
            .column_by_name(name)
            .and_then(|c| c.as_any().downcast_ref::<Float64Array>())
            .map(|c| c.value(i))
            .unwrap_or(0.0)
    };
    TranscriptChunk {
        course_slug: s("course_slug"),
        course_title: s("course_title"),
        course_url: s("course_url"),
        lesson_index: u("lesson_index"),
        lesson_title: s("lesson_title"),
        lesson_url: s("lesson_url"),
        chunk_index: u("chunk_index"),
        start_secs: f("start_secs"),
        end_secs: f("end_secs"),
        text: s("text"),
    }
}
