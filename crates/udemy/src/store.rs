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

use crate::types::{Chapter, ChapterSearchResult, Course, CourseSearchResult};

const TABLE: &str = "courses";
const CHAPTERS_TABLE: &str = "chapters";

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
            DataType::FixedSizeList(Arc::new(Field::new("item", DataType::Float32, true)), dim),
            true,
        ),
    ]))
}

fn chapters_schema(dim: i32) -> Arc<Schema> {
    Arc::new(Schema::new(vec![
        Field::new("course_id", DataType::Utf8, false),
        Field::new("course_title", DataType::Utf8, false),
        Field::new("chapter_index", DataType::UInt32, false),
        Field::new("title", DataType::Utf8, false),
        Field::new("indexed_at", DataType::Float64, false),
        Field::new(
            "vector",
            DataType::FixedSizeList(Arc::new(Field::new("item", DataType::Float32, true)), dim),
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
        if courses.len() != vectors.len() {
            anyhow::bail!(
                "courses.len()={} != vectors.len()={}",
                courses.len(),
                vectors.len()
            );
        }
        if courses.is_empty() {
            return Ok(0);
        }

        let dim = vectors[0].len();
        if dim == 0 {
            anyhow::bail!("embedding vectors have zero dimension");
        }
        if let Some(bad) = vectors.iter().position(|v| v.len() != dim) {
            anyhow::bail!(
                "vector {bad} has dim {} != expected {dim}",
                vectors[bad].len()
            );
        }
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

        let stream = table
            .vector_search(query_vec)?
            .limit(top_k)
            .execute()
            .await?;

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

        results.sort_by(|a, b| {
            b.score
                .partial_cmp(&a.score)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
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

    /// Ensure the `chapters` table exists with the given vector dimension.
    async fn ensure_chapters_table(&self, dim: usize) -> Result<()> {
        let tables = self.conn.table_names().execute().await?;
        if !tables.contains(&CHAPTERS_TABLE.to_string()) {
            let batch = RecordBatch::new_empty(chapters_schema(dim as i32));
            self.conn
                .create_table(CHAPTERS_TABLE, batch)
                .execute()
                .await?;
            info!("Created '{CHAPTERS_TABLE}' table (dim={dim})");
        }
        Ok(())
    }

    /// Insert chapter rows that already have embeddings computed.
    pub async fn add_chapters(
        &self,
        chapters: &[Chapter],
        vectors: &[Vec<f32>],
    ) -> Result<usize> {
        if chapters.len() != vectors.len() {
            anyhow::bail!(
                "chapters.len()={} != vectors.len()={}",
                chapters.len(),
                vectors.len()
            );
        }
        if chapters.is_empty() {
            return Ok(0);
        }
        let dim = vectors[0].len();
        if dim == 0 {
            anyhow::bail!("embedding vectors have zero dimension");
        }
        if let Some(bad) = vectors.iter().position(|v| v.len() != dim) {
            anyhow::bail!(
                "vector {bad} has dim {} != expected {dim}",
                vectors[bad].len()
            );
        }
        self.ensure_chapters_table(dim).await?;

        let n = chapters.len();
        let ts = now_secs();
        let course_ids: Vec<&str> = chapters.iter().map(|c| c.course_id.as_str()).collect();
        let course_titles: Vec<&str> =
            chapters.iter().map(|c| c.course_title.as_str()).collect();
        let idxs: Vec<u32> = chapters.iter().map(|c| c.chapter_index).collect();
        let titles: Vec<&str> = chapters.iter().map(|c| c.title.as_str()).collect();
        let timestamps: Vec<f64> = vec![ts; n];

        let mut flat: Vec<f32> = Vec::with_capacity(n * dim);
        for v in vectors {
            flat.extend_from_slice(v);
        }
        let values = Float32Array::from(flat);
        let field = Arc::new(Field::new("item", DataType::Float32, true));
        let vecs = FixedSizeListArray::try_new(field, dim as i32, Arc::new(values), None)?;

        let batch = RecordBatch::try_new(
            chapters_schema(dim as i32),
            vec![
                Arc::new(StringArray::from(course_ids)) as ArrayRef,
                Arc::new(StringArray::from(course_titles)),
                Arc::new(UInt32Array::from(idxs)),
                Arc::new(StringArray::from(titles)),
                Arc::new(Float64Array::from(timestamps)),
                Arc::new(vecs) as ArrayRef,
            ],
        )?;
        let table = self.conn.open_table(CHAPTERS_TABLE).execute().await?;
        table.add(vec![batch]).execute().await?;
        info!("Stored {n} chapter embeddings");
        Ok(n)
    }

    /// All chapters for a course, ordered by `chapter_index`.
    pub async fn chapters_for_course(&self, course_id: &str) -> Result<Vec<Chapter>> {
        let tables = self.conn.table_names().execute().await?;
        if !tables.contains(&CHAPTERS_TABLE.to_string()) {
            return Ok(Vec::new());
        }
        let table = self.conn.open_table(CHAPTERS_TABLE).execute().await?;
        let predicate = format!("course_id = '{}'", course_id.replace('\'', "''"));
        let stream = table.query().only_if(predicate).execute().await?;
        let batches: Vec<RecordBatch> = stream.try_collect().await?;
        let mut out = Vec::new();
        for batch in &batches {
            for i in 0..batch.num_rows() {
                out.push(chapter_from_batch(batch, i));
            }
        }
        out.sort_by_key(|c| c.chapter_index);
        Ok(out)
    }

    /// Semantic search over chapters across all courses.
    pub async fn search_chapters(
        &self,
        query_vec: Vec<f32>,
        top_k: usize,
    ) -> Result<Vec<ChapterSearchResult>> {
        let table = self.conn.open_table(CHAPTERS_TABLE).execute().await?;
        let stream = table
            .vector_search(query_vec)?
            .limit(top_k)
            .execute()
            .await?;
        let batches: Vec<RecordBatch> = stream.try_collect().await?;
        let mut results = Vec::new();
        for batch in &batches {
            for i in 0..batch.num_rows() {
                let chapter = chapter_from_batch(batch, i);
                let dist = batch
                    .column_by_name("_distance")
                    .and_then(|c| c.as_any().downcast_ref::<Float32Array>())
                    .map(|c| c.value(i))
                    .unwrap_or(1.0);
                let score = 1.0 / (1.0 + dist);
                results.push(ChapterSearchResult { chapter, score });
            }
        }
        results.sort_by(|a, b| {
            b.score
                .partial_cmp(&a.score)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        Ok(results)
    }

    /// Total rows in the chapters table (0 if it doesn't exist yet).
    pub async fn count_chapters(&self) -> Result<usize> {
        let tables = self.conn.table_names().execute().await?;
        if !tables.contains(&CHAPTERS_TABLE.to_string()) {
            return Ok(0);
        }
        let table = self.conn.open_table(CHAPTERS_TABLE).execute().await?;
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

/// Extract a `Chapter` from a RecordBatch row.
fn chapter_from_batch(batch: &RecordBatch, i: usize) -> Chapter {
    let get_str = |name: &str| -> String {
        batch
            .column_by_name(name)
            .and_then(|c| c.as_any().downcast_ref::<StringArray>())
            .map(|c| c.value(i).to_string())
            .unwrap_or_default()
    };
    let chapter_index = batch
        .column_by_name("chapter_index")
        .and_then(|c| c.as_any().downcast_ref::<UInt32Array>())
        .map(|c| c.value(i))
        .unwrap_or(0);
    Chapter {
        course_id: get_str("course_id"),
        course_title: get_str("course_title"),
        chapter_index,
        title: get_str("title"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn chapter(course: &str, idx: u32, title: &str) -> Chapter {
        Chapter {
            course_id: course.into(),
            course_title: format!("Course {course}"),
            chapter_index: idx,
            title: title.into(),
        }
    }

    #[tokio::test]
    async fn chapters_store_extract_and_search() {
        let dir = tempfile::tempdir().expect("tempdir");
        let store = CourseStore::connect(dir.path().to_str().unwrap())
            .await
            .expect("connect");

        let chapters = vec![
            chapter("a", 1, "Intro to RAG"),
            chapter("a", 0, "Evaluation with LangSmith"),
            chapter("b", 0, "Vector stores"),
        ];
        let vectors = vec![
            vec![0.0, 1.0, 0.0, 0.0],
            vec![1.0, 0.0, 0.0, 0.0],
            vec![0.0, 0.0, 1.0, 0.0],
        ];
        let n = store
            .add_chapters(&chapters, &vectors)
            .await
            .expect("add_chapters");
        assert_eq!(n, 3);
        assert_eq!(store.count_chapters().await.expect("count"), 3);

        let a = store.chapters_for_course("a").await.expect("of course");
        assert_eq!(a.len(), 2);
        assert_eq!(a[0].chapter_index, 0, "must be ordered by index");
        assert_eq!(a[0].title, "Evaluation with LangSmith");
        assert_eq!(a[1].chapter_index, 1);

        let hits = store
            .search_chapters(vec![0.95, 0.05, 0.0, 0.0], 3)
            .await
            .expect("search");
        assert_eq!(hits.len(), 3);
        assert_eq!(hits[0].chapter.title, "Evaluation with LangSmith");
        assert!(hits[0].score >= hits[1].score);

        assert!(store
            .add_chapters(&[chapter("c", 0, "x")], &[])
            .await
            .is_err());
        assert!(store
            .chapters_for_course("missing")
            .await
            .expect("missing ok")
            .is_empty());
    }

    fn course(id: &str) -> Course {
        Course {
            course_id: id.to_string(),
            title: format!("Course {id}"),
            url: format!("https://www.udemy.com/course/{id}/"),
            description: "desc".to_string(),
            instructor: "Jane Doe".to_string(),
            level: "All Levels".to_string(),
            rating: 4.5,
            review_count: 100,
            num_students: 1000,
            duration_hours: 3.0,
            price: "Free".to_string(),
            language: "English".to_string(),
            category: "Development".to_string(),
            image_url: "img".to_string(),
            topics_json: "[]".to_string(),
        }
    }

    async fn store_in(dir: &std::path::Path) -> CourseStore {
        CourseStore::connect(dir.to_str().expect("utf-8 tempdir path"))
            .await
            .expect("connect")
    }

    #[tokio::test]
    async fn add_count_existing_ids_and_search() {
        let dir = tempfile::tempdir().expect("tempdir");
        let mut store = store_in(dir.path()).await;

        let courses = vec![course("a"), course("b")];
        let vectors = vec![vec![1.0, 0.0, 0.0, 0.0], vec![0.0, 1.0, 0.0, 0.0]];

        let added = store.add(&courses, &vectors).await.expect("add");
        assert_eq!(added, 2);
        assert_eq!(store.count().await.expect("count"), 2);

        let ids = store.existing_ids().await.expect("existing_ids");
        assert!(ids.contains("a") && ids.contains("b"), "got {ids:?}");

        let results = store
            .search(vec![0.9, 0.1, 0.0, 0.0], 2)
            .await
            .expect("search");
        assert_eq!(results.len(), 2);
        assert_eq!(
            results[0].course.course_id, "a",
            "nearest course should rank first"
        );
        assert!(
            results[0].score >= results[1].score,
            "results must be sorted by score desc"
        );
    }

    #[tokio::test]
    async fn add_empty_is_noop() {
        let dir = tempfile::tempdir().expect("tempdir");
        let mut store = store_in(dir.path()).await;
        assert_eq!(store.add(&[], &[]).await.expect("add empty"), 0);
        assert_eq!(store.count().await.expect("count"), 0);
    }

    #[tokio::test]
    async fn add_length_mismatch_is_err() {
        let dir = tempfile::tempdir().expect("tempdir");
        let mut store = store_in(dir.path()).await;
        let err = store
            .add(&[course("a")], &[])
            .await
            .expect_err("length mismatch must error");
        assert!(err.to_string().contains("!="), "got: {err}");
    }

    #[tokio::test]
    async fn add_ragged_dims_is_err() {
        let dir = tempfile::tempdir().expect("tempdir");
        let mut store = store_in(dir.path()).await;
        let courses = vec![course("a"), course("b")];
        let vectors = vec![vec![1.0, 0.0, 0.0, 0.0], vec![1.0, 0.0, 0.0]];
        let err = store
            .add(&courses, &vectors)
            .await
            .expect_err("ragged dims must error");
        assert!(err.to_string().contains("dim"), "got: {err}");
    }
}
