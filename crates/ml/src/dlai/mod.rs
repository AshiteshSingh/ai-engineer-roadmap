//! DeepLearning.AI scraped-course ingestion.
//!
//! Reads the per-course JSON produced by
//! `scripts/scrape-deeplearning-course.ts` (`data/deeplearning/<slug>.json`)
//! and feeds it into the existing Rust pipeline:
//!   * windowed + timestamped transcript chunks → LanceDB ([`store`])
//!   * a lexical corpus consumed by the chat retrieval path
//!   * `external_courses` / `lesson_courses` rows in `courses.db`
//!
//! See the `seed-dl-transcripts` bin for the orchestration.

pub mod chunk;
pub mod model;
pub mod store;
