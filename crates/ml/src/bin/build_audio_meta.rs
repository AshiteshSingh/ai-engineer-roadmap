//! Deterministic markdown → AudioMeta JSON. 1:1 port of the retired
//! `backend/scripts/build_audio_meta.py` (no LLM, no candle at runtime —
//! reuses the tested `markdown`/`wpm`/`audio_meta` modules).
//!
//! H2 (`## `) headings define chapter boundaries; the leading article H1 and
//! a fixed set of navigation-only H2s are dropped; code/diagrams/tables/inline
//! formatting are stripped so the script reads cleanly to a TTS voice.
//!
//!   cd crates/ml && cargo run -p audio-guide --release \
//!       --bin build-audio-meta -- \
//!       --slug langgraph --title "LangGraph — Audio Guide" \
//!       --input ../../content/langgraph.md --output ../../data/langgraph-audio.json

use std::path::PathBuf;

use clap::Parser;
use aer_ml::audio_guide::{
    audio_meta::{AudioChapter, AudioMeta},
    markdown, wpm,
};
use regex::Regex;
use tracing_subscriber::EnvFilter;

#[derive(Parser)]
#[command(name = "build-audio-meta")]
struct Args {
    #[arg(long)]
    slug: String,
    #[arg(long)]
    title: String,
    #[arg(long)]
    input: PathBuf,
    #[arg(long)]
    output: PathBuf,
}

fn build_audio_meta(md_path: &PathBuf, slug: &str, title: &str) -> anyhow::Result<AudioMeta> {
    let raw = std::fs::read_to_string(md_path)
        .map_err(|e| anyhow::anyhow!("reading {}: {e}", md_path.display()))?;
    let md = markdown::strip_frontmatter(&raw);

    // Drop the article's leading H1 — chapters open at the first H2. Any
    // pre-H2 lead-in folds into "Introduction" inside split_chapters.
    let h1_lead = Regex::new(r"\A#\s+[^\n]+\n+").unwrap();
    let md = h1_lead.replacen(md, 1, "");

    let mut chapters: Vec<AudioChapter> = Vec::new();
    let mut cumulative: u32 = 0;
    let mut full_script_parts: Vec<String> = Vec::new();

    for (raw_title, raw_body) in markdown::split_chapters(&md) {
        if markdown::skip_h2_titles().contains(raw_title.trim().to_lowercase().as_str()) {
            continue;
        }
        let body = markdown::strip_markdown(&raw_body);
        if body.is_empty() {
            continue;
        }
        let words = wpm::count_words(&body);
        if words < 12 {
            // Skip near-empty stub sections (one-liners that survived stripping).
            continue;
        }
        // Floor estimate (`wpm::estimate_secs`) — must match the audio gate's
        // `duration-mismatch` recompute (gate.rs uses the same fn) and the
        // system-wide convention (build-audio-guide, old TS vitrifi builder).
        let duration = wpm::estimate_secs(words);
        chapters.push(AudioChapter {
            index: chapters.len(),
            title: raw_title.clone(),
            start_secs: cumulative,
            duration_secs: duration,
            script: body.clone(),
        });
        cumulative += duration;
        full_script_parts.push(format!("## {raw_title}\n\n{body}"));
    }

    Ok(AudioMeta {
        slug: slug.to_string(),
        title: title.to_string(),
        voice: "pending-tts".to_string(),
        duration_secs: cumulative,
        file_size_bytes: 0,
        audio_url: String::new(),
        chapters,
        full_script: full_script_parts.join("\n\n"),
    })
}

fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .init();
    let args = Args::parse();

    let meta = build_audio_meta(&args.input, &args.slug, &args.title)?;
    meta.save_json(&args.output)?;

    let total_words: usize = meta
        .chapters
        .iter()
        .map(|c| wpm::count_words(&c.script))
        .sum();
    println!(
        "wrote {} — {} chapters, {} words, ~{}s ({}m {}s)",
        args.output.display(),
        meta.chapters.len(),
        total_words,
        meta.duration_secs,
        meta.duration_secs / 60,
        meta.duration_secs % 60
    );
    for ch in &meta.chapters {
        let words = wpm::count_words(&ch.script);
        println!(
            "  ch{:02} [{:>3}s, {:>4}w] {}",
            ch.index, ch.duration_secs, words, ch.title
        );
    }
    Ok(())
}
