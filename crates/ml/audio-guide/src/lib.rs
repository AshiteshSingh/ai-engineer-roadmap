pub mod audio_meta;
pub mod chunker;
pub mod gate;
pub mod llm;
pub mod markdown;
pub mod prompts;
pub mod wpm;

pub use audio_meta::{AudioChapter, AudioMeta};
pub use gate::{gate_audio, AudioGateReport, AudioMetrics, AudioViolation};
pub use chunker::{chunk_into_chapters, ChunkerOptions};
pub use llm::QuantizedQwen;
pub use markdown::{polish_for_audio, skip_h2_titles, split_chapters, strip_frontmatter, strip_markdown};
pub use wpm::{estimate_secs, NARRATION_WPM};
