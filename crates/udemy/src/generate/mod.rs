//! All-Rust content-generation pipeline: semantic retrieve (LanceDB
//! courses+chapters) -> LLM (deepseek) -> graded markdown article.
//!
//! Mirrors backend/knowledge_agent/article_generate_graph.py with the same
//! quality gates and `content/{slug}.md` contract, grounded on the Udemy corpus.

pub mod pipeline;
pub mod prompts;
pub mod quality;
pub mod retrieve;

pub use pipeline::{generate_article, GenerateConfig, GenerateOutcome};
pub use quality::{check_quality, Quality};
