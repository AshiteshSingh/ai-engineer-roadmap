//! LanceDB vector store for Udemy courses.
//!
//! Schema: course_id, title, url, description, instructor, level, rating,
//!   review_count, num_students, duration_hours, price, language, category,
//!   image_url, topics_json, indexed_at, vector(1024)

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

use crate::types::{Course, CourseSearchResult};

const TABLE: &str = "courses";

fn schema(dim: i32) -> Arc<Schema> {
    Arc::new(Schema::new(vec![
        Field::new("course_id", DataType::Utf8, false),
        Field::new("title", DataType::Utf8, false),
        Field::new("url", DataType::Utf8, false),
        Field::new("description", DataType::Utf8, false),
        Field::new("instructor", DataType::Utf8, false),
        Field::new("level", DataType::Utf8, false),
        Field::new("rating", DataType::Float32, false),
        Field::new("review_count", DataType::UInt32, false),
        Field::new("num_students", DataType::UInt32, false),
        Field::new("duration_hours", DataType::Float32, false),
        Field::new("price", DataType::Utf8, false),
        Field::new("language", DataType::Utf8, false),
        Field::new("category", DataType::Utf8, false),
        Field::new("image_url", DataType::Utf8, false),
        Field::new("topics_json", DataType::Utf8, false),
        Field::new("indexed_at", DataType::Float64, false),
        Field::new(
            "vector",
            DataType::FixedSizeList(
                Arc::new(Field::new("item", DataType::Float32, true)),
                dim,
            ),
            true,
        ),
    ]))
}

fn now_secs() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs_f64()
}

pub struct CourseStore {
    conn: Connection,
    dim: usize,
}

impl CourseStore {
    /// Open (or create) a Lance store at `path`.
    pub async fn connect(path: &str) -> Result<Self> {
        let conn = lancedb::connect(path).execute().await?;
        Ok(Self { conn, dim: 0 })
    }

    /// Ensure the table exists with the given vector dimension.
    async fn ensure_table(&mut self, dim: usize) -> Result<()> {
        if self.dim == 0 {
            self.dim = dim;
        }
        let tables = self.conn.table_names().execute().await?;
        if !tables.contains(&TABLE.to_string()) {
            let batch = RecordBatch::new_empty(schema(dim as i32));
            self.conn.create_table(TABLE, batch).execute().await?;
            info!("Created '{TABLE}' table (dim={dim})");
        }
        Ok(())
    }

    /// Insert courses that already have embeddings computed.
    pub async fn add(&mut self, courses: &[Course], vectors: &[Vec<f32>]) -> Result<usize> {
        assert_eq!(courses.len(), vectors.len());
        if courses.is_empty() {
            return Ok(0);
        }

        let dim = vectors[0].len();
        self.ensure_table(dim).await?;

        let n = courses.len();
        let ts = now_secs();

        let course_ids: Vec<&str> = courses.iter().map(|c| c.course_id.as_str()).collect();
        let titles: Vec<&str> = courses.iter().map(|c| c.title.as_str()).collect();
        let urls: Vec<&str> = courses.iter().map(|c| c.url.as_str()).collect();
        let descs: Vec<&str> = courses.iter().map(|c| c.description.as_str()).collect();
        let instructors: Vec<&str> = courses.iter().map(|c| c.instructor.as_str()).collect();
        let levels: Vec<&str> = courses.iter().map(|c| c.level.as_str()).collect();
        let ratings: Vec<f32> = courses.iter().map(|c| c.rating).collect();
        let review_counts: Vec<u32> = courses.iter().map(|c| c.review_count).collect();
        let num_students: Vec<u32> = courses.iter().map(|c| c.num_students).collect();
        let durations: Vec<f32> = courses.iter().map(|c| c.duration_hours).collect();
        let prices: Vec<&str> = courses.iter().map(|c| c.price.as_str()).collect();
        let languages: Vec<&str> = courses.iter().map(|c| c.language.as_str()).collect();
        let categories: Vec<&str> = courses.iter().map(|c| c.category.as_str()).collect();
        let images: Vec<&str> = courses.iter().map(|c| c.image_url.as_str()).collect();
        let topics: Vec<&str> = courses.iter().map(|c| c.topics_json.as_str()).collect();
        let timestamps: Vec<f64> = vec![ts; n];

        // Flatten vectors into one contiguous buffer.
        let mut flat: Vec<f32> = Vec::with_capacity(n * dim);
        for v in vectors {
            flat.extend_from_slice(v);
        }
        let values = Float32Array::from(flat);
        let field = Arc::new(Field::new("item", DataType::Float32, true));
        let vecs = FixedSizeListArray::try_new(field, dim as i32, Arc::new(values), None)?;

        let batch = RecordBatch::try_new(
            schema(dim as i32),
            vec![
                Arc::new(StringArray::from(course_ids)) as ArrayRef,
                Arc::new(StringArray::from(titles)),
                Arc::new(StringArray::from(urls)),
                Arc::new(StringArray::from(descs)),
                Arc::new(StringArray::from(instructors)),
                Arc::new(StringArray::from(levels)),
                Arc::new(Float32Array::from(ratings)),
                Arc::new(UInt32Array::from(review_counts)),
                Arc::new(UInt32Array::from(num_students)),
                Arc::new(Float32Array::from(durations)),
                Arc::new(StringArray::from(prices)),
                Arc::new(StringArray::from(languages)),
                Arc::new(StringArray::from(categories)),
                Arc::new(StringArray::from(images)),
                Arc::new(StringArray::from(topics)),
                Arc::new(Float64Array::from(timestamps)),
                Arc::new(vecs) as ArrayRef,
            ],
        )?;

        let table = self.conn.open_table(TABLE).execute().await?;
        table.add(vec![batch]).execute().await?;

        info!("Stored {} course embeddings", n);
        Ok(n)
    }

    /// Semantic search: pass a pre-computed query vector.
    pub async fn search(
        &self,
        query_vec: Vec<f32>,
        top_k: usize,
    ) -> Result<Vec<CourseSearchResult>> {
        let table = self.conn.open_table(TABLE).execute().await?;

        let stream = table.vector_search(query_vec)?.limit(top_k).execute().await?;

        let batches: Vec<RecordBatch> = stream.try_collect().await?;

        let mut results = Vec::new();
        for batch in &batches {
            for i in 0..batch.num_rows() {
                let course = course_from_batch(batch, i);
                let dist = batch
                    .column_by_name("_distance")
                    .and_then(|c| c.as_any().downcast_ref::<Float32Array>())
                    .map(|c| c.value(i))
                    .unwrap_or(1.0);
                let score = 1.0 / (1.0 + dist);
                results.push(CourseSearchResult { course, score });
            }
        }

        results.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
        Ok(results)
    }

    /// Returns the set of `course_id` values already in the store.
    pub async fn existing_ids(&self) -> Result<std::collections::HashSet<String>> {
        let tables = self.conn.table_names().execute().await?;
        if !tables.contains(&TABLE.to_string()) {
            return Ok(Default::default());
        }
        let table = self.conn.open_table(TABLE).execute().await?;
        let stream = table
            .query()
            .select(lancedb::query::Select::columns(&["course_id"]))
            .execute()
            .await?;
        let batches: Vec<RecordBatch> = stream.try_collect().await?;
        let mut ids = std::collections::HashSet::new();
        for batch in &batches {
            if let Some(col) = batch.column_by_name("course_id") {
                if let Some(arr) = col.as_any().downcast_ref::<StringArray>() {
                    for i in 0..arr.len() {
                        ids.insert(arr.value(i).to_string());
                    }
                }
            }
        }
        Ok(ids)
    }

    /// Total rows in the courses table (0 if table doesn't exist yet).
    pub async fn count(&self) -> Result<usize> {
        let tables = self.conn.table_names().execute().await?;
        if !tables.contains(&TABLE.to_string()) {
            return Ok(0);
        }
        let table = self.conn.open_table(TABLE).execute().await?;
        Ok(table.count_rows(None).await?)
    }
}

/// Extract a `Course` from a RecordBatch row.
fn course_from_batch(batch: &RecordBatch, i: usize) -> Course {
    let get_str = |name: &str| -> String {
        batch
            .column_by_name(name)
            .and_then(|c| c.as_any().downcast_ref::<StringArray>())
            .map(|c| c.value(i).to_string())
            .unwrap_or_default()
    };

    let get_f32 = |name: &str| -> f32 {
        batch
            .column_by_name(name)
            .and_then(|c| c.as_any().downcast_ref::<Float32Array>())
            .map(|c| c.value(i))
            .unwrap_or(0.0)
    };

    let get_u32 = |name: &str| -> u32 {
        batch
            .column_by_name(name)
            .and_then(|c| c.as_any().downcast_ref::<UInt32Array>())
            .map(|c| c.value(i))
            .unwrap_or(0)
    };

    Course {
        course_id: get_str("course_id"),
        title: get_str("title"),
        url: get_str("url"),
        description: get_str("description"),
        instructor: get_str("instructor"),
        level: get_str("level"),
        rating: get_f32("rating"),
        review_count: get_u32("review_count"),
        num_students: get_u32("num_students"),
        duration_hours: get_f32("duration_hours"),
        price: get_str("price"),
        language: get_str("language"),
        category: get_str("category"),
        image_url: get_str("image_url"),
        topics_json: get_str("topics_json"),
    }
}
