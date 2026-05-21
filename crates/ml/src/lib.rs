//! Unified Rust crate for the AI-engineer-roadmap knowledge app.
//!
//! Consolidates the six former crates (knowledge-ml-core, knowledge-ml-server,
//! topic-miner, audio-guide, knowledge-bkt, udemy) into one package; each is
//! now a top-level module namespace. Binaries live in `src/bin/` and reference
//! the library as `aer_ml::<namespace>::...`.
//!
//! - [`content`]     — former `knowledge-ml-core` (renamed to avoid the std
//!                      `core` footgun): courses/parser/seed/similarity/
//!                      readability/sqlite/vocab/types/profiles/checker.
//! - [`server`]      — former `knowledge-ml-server`: LangGraph backend port
//!                      (graphs/json/llm/retrieval/store + chat wire API).
//! - [`topic_miner`] — former `topic-miner`: codebase scanner -> topics.
//! - [`audio_guide`] — former `audio-guide`: markdown -> audio narration.
//! - [`bkt`]         — former `knowledge-bkt`: Bayesian Knowledge Tracing.
//! - [`udemy`]       — former `udemy`: course scraping/embedding/generation
//!                      (Udemy + Coursera + DeepLearning.AI sources).

pub mod content;
pub mod d1;
pub mod server;
pub mod topic_miner;
pub mod audio_guide;
pub mod bkt;
pub mod udemy;
pub mod dlai;
