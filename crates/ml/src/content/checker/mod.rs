//! Shared, config-driven content checking engine.
//!
//! `bin/content_gate.rs` and `bin/hub_gate.rs` both consume this instead of
//! re-implementing the structure / relation / quality tiers. Thresholds
//! come from [`crate::content::profiles`]; with the built-in `deep-dive` profile the
//! engine is byte-identical to the pre-refactor `content-gate`.

pub mod engine;
pub mod scan;

pub use engine::{run_content, EngineReport, LessonOutcome};
pub use scan::{structure_check, ContentMetrics};
