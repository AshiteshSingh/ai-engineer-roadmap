use serde::{Deserialize, Serialize};

/// Mirrors `apps/knowledge/lib/audio.ts:AudioChapter` plus an extra `script`
/// field carrying the per-chapter narration text (so a downstream TTS step has
/// everything it needs to synthesize one segment at a time).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioChapter {
    pub index: usize,
    pub title: String,
    pub start_secs: u32,
    pub duration_secs: u32,
    pub script: String,
}

/// Mirrors `apps/knowledge/lib/audio.ts:AudioMeta`. The `full_script` field is
/// an extension; the TS interface ignores unknown keys.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioMeta {
    pub slug: String,
    pub title: String,
    pub voice: String,
    pub duration_secs: u32,
    pub file_size_bytes: u64,
    pub audio_url: String,
    pub chapters: Vec<AudioChapter>,
    pub full_script: String,
}

impl AudioMeta {
    pub fn save_json(&self, path: &std::path::Path) -> anyhow::Result<()> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let file = std::fs::File::create(path)?;
        serde_json::to_writer_pretty(file, self)?;
        Ok(())
    }
}
