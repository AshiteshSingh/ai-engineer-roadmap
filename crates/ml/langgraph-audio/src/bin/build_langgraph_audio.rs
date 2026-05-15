//! Build the audio-optimized AudioMeta JSON for a knowledge article.
//!
//! Two modes:
//!
//! 1. **Article mode** (default): rewrites a single markdown article as a
//!    short audio guide via one DeepSeek v4 call. Used by `/langgraph`.
//!
//! 2. **Outline mode** (`--outline <path>`): chapter-driven generation. The
//!    outline is a TOML file listing chapter titles, briefs, source file
//!    excerpts, and per-chapter target word counts. Each chapter is a
//!    separate DeepSeek call, with the cited source code spliced into the
//!    user prompt so the narration stays grounded in real identifier names,
//!    file paths, and numeric facts. Each chapter's raw output is cached
//!    under `data/<slug>.chapters/<NN>-<slug>.md` so a re-run skips API
//!    calls for chapters already on disk.
//!
//! Run from `apps/knowledge/`:
//!     pnpm ml:langgraph-audio
//!
//! Or directly from `apps/knowledge/ml/`:
//!     cargo run -p langgraph-audio --release --bin build-langgraph-audio
//!
//! Required env: `DEEPSEEK_API_KEY` (looked up via dotenvy from the workspace
//! root `.env`; falls back to the current process environment).

use std::path::{Path, PathBuf};

use clap::Parser;
use serde::Deserialize;
use tracing_subscriber::EnvFilter;

use langgraph_audio::{
    audio_meta::{AudioChapter, AudioMeta},
    markdown, prompts, wpm,
};

#[derive(Parser)]
#[command(
    name = "build-langgraph-audio",
    about = "Generate an AudioMeta JSON for a knowledge article via DeepSeek v4"
)]
struct Args {
    /// Source markdown article. Used in article mode; ignored in outline mode.
    #[arg(long, default_value = "../content/langgraph.md")]
    input: PathBuf,

    /// Where to write the AudioMeta JSON.
    #[arg(long, default_value = "../data/langgraph-audio.json")]
    output: PathBuf,

    /// Slug written into the AudioMeta. Article mode default; outline mode
    /// overrides this with the outline's `slug` field.
    #[arg(long, default_value = "langgraph")]
    slug: String,

    /// Display title shown in the audio player chip. Article mode default;
    /// outline mode overrides with the outline's `title` field.
    #[arg(long, default_value = "LangGraph — Audio Guide")]
    title: String,

    /// Article mode: target narration length in words.
    #[arg(long, default_value_t = 1800)]
    target_words: usize,

    /// Article mode: skip DeepSeek, read the script from `--script-cache`.
    #[arg(long)]
    use_cached_script: bool,

    /// Path used for `--use-cached-script` (article mode) and to write the
    /// final concatenated script (both modes).
    #[arg(long, default_value = "../data/langgraph-audio.script.md")]
    script_cache: PathBuf,

    /// Outline mode: path to a TOML outline. When set, the binary runs one
    /// DeepSeek call per chapter and writes per-chapter caches alongside the
    /// final script.
    #[arg(long)]
    outline: Option<PathBuf>,

    /// Outline mode: per-chapter cache directory. Defaults to
    /// `<script_cache parent>/<slug>.chapters/`. Chapters already on disk
    /// here are NOT regenerated.
    #[arg(long)]
    chapter_cache_dir: Option<PathBuf>,

    /// Outline mode: workspace root, used to resolve source-file paths in
    /// the outline. Default walks up to where `.env` lives.
    #[arg(long, default_value = "../../..")]
    workspace_root: PathBuf,

    /// Outline mode: regenerate every chapter even if a cached version
    /// exists. Useful when iterating on the prompt template.
    #[arg(long)]
    force_regenerate: bool,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")))
        .init();

    load_env();

    let args = Args::parse();

    let (script_raw, slug, title) = if let Some(outline_path) = &args.outline {
        run_outline_mode(&args, outline_path).await?
    } else {
        run_article_mode(&args).await?
    };

    // Write the final concatenated script for inspection / cached re-runs.
    if !args.script_cache.as_os_str().is_empty() {
        if let Some(parent) = args.script_cache.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(&args.script_cache, &script_raw)?;
        tracing::info!("wrote concatenated script → {}", args.script_cache.display());
    }

    let meta = build_meta(&script_raw, &slug, &title)?;
    meta.save_json(&args.output)?;

    let total_words: usize = meta
        .chapters
        .iter()
        .map(|c| wpm::count_words(&c.script))
        .sum();
    tracing::info!(
        "wrote {} — {} chapters, {} words, ~{}s ({}m {}s)",
        args.output.display(),
        meta.chapters.len(),
        total_words,
        meta.duration_secs,
        meta.duration_secs / 60,
        meta.duration_secs % 60,
    );
    for ch in &meta.chapters {
        let words = wpm::count_words(&ch.script);
        tracing::info!(
            "  ch{:02} [{:>4}s, {:>4}w] {}",
            ch.index,
            ch.duration_secs,
            words,
            ch.title
        );
    }

    Ok(())
}

async fn run_article_mode(args: &Args) -> anyhow::Result<(String, String, String)> {
    let article = std::fs::read_to_string(&args.input)
        .map_err(|e| anyhow::anyhow!("reading {}: {e}", args.input.display()))?;

    let script_raw = if args.use_cached_script {
        tracing::info!("reading cached script from {}", args.script_cache.display());
        std::fs::read_to_string(&args.script_cache)
            .map_err(|e| anyhow::anyhow!("reading cached script {}: {e}", args.script_cache.display()))?
    } else {
        generate_with_deepseek(&article, &args.title, args.target_words).await?
    };

    Ok((script_raw, args.slug.clone(), args.title.clone()))
}

async fn run_outline_mode(
    args: &Args,
    outline_path: &Path,
) -> anyhow::Result<(String, String, String)> {
    let raw_toml = std::fs::read_to_string(outline_path)
        .map_err(|e| anyhow::anyhow!("reading outline {}: {e}", outline_path.display()))?;
    let outline: Outline = toml::from_str(&raw_toml)
        .map_err(|e| anyhow::anyhow!("parsing outline {}: {e}", outline_path.display()))?;

    if outline.chapters.is_empty() {
        anyhow::bail!("outline {} has zero chapters", outline_path.display());
    }

    let cache_dir = args
        .chapter_cache_dir
        .clone()
        .unwrap_or_else(|| {
            let parent = args
                .script_cache
                .parent()
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from("."));
            parent.join(format!("{}.chapters", outline.slug))
        });
    std::fs::create_dir_all(&cache_dir)?;

    let workspace_root = args.workspace_root.canonicalize().map_err(|e| {
        anyhow::anyhow!("resolving workspace root {}: {e}", args.workspace_root.display())
    })?;
    tracing::info!("workspace root: {}", workspace_root.display());

    let client = deepseek::client_from_env()?;
    let total = outline.chapters.len();
    let default_target = outline.default_target_words.unwrap_or(1100);

    let mut chapter_blocks: Vec<String> = Vec::with_capacity(total);
    for (idx, ch) in outline.chapters.iter().enumerate() {
        let cache_path = cache_dir.join(chapter_cache_filename(idx, &ch.title));
        let body = if cache_path.exists() && !args.force_regenerate {
            tracing::info!(
                "ch{:02} cached: {} ({})",
                idx,
                ch.title,
                cache_path.display()
            );
            std::fs::read_to_string(&cache_path)?
        } else {
            tracing::info!(
                "ch{:02} generating: {} (target ≈ {} words)",
                idx,
                ch.title,
                ch.target_words.unwrap_or(default_target)
            );
            let sources = gather_sources(&workspace_root, &ch.sources)?;
            let user = chapter_user_prompt(ch, ch.target_words.unwrap_or(default_target), &sources);
            let out = deepseek::reason_with_retry(&client, prompts::SYSTEM_PROMPT, &user).await?;
            let body = strip_chapter_heading(&out.content, &ch.title);
            std::fs::write(&cache_path, &body)?;
            tracing::info!(
                "ch{:02} wrote: {} ({} chars, {} chars reasoning)",
                idx,
                cache_path.display(),
                out.content.len(),
                out.reasoning.len()
            );
            body
        };
        chapter_blocks.push(format!("## {}\n\n{}", ch.title.trim(), body.trim()));
    }

    let script = chapter_blocks.join("\n\n");
    Ok((script, outline.slug.clone(), outline.title.clone()))
}

fn chapter_cache_filename(idx: usize, title: &str) -> String {
    let slug: String = title
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c.to_ascii_lowercase() } else { '-' })
        .collect();
    let slug = slug.trim_matches('-').replace("--", "-");
    format!("{:02}-{}.md", idx, slug)
}

fn gather_sources(
    workspace_root: &Path,
    refs: &[SourceRef],
) -> anyhow::Result<String> {
    let mut out = String::new();
    for r in refs {
        let abs = workspace_root.join(&r.path);
        let raw = std::fs::read_to_string(&abs)
            .map_err(|e| anyhow::anyhow!("reading source {}: {e}", abs.display()))?;
        let (start, end) = parse_line_range(&r.lines, raw.lines().count())?;
        let snippet: String = raw
            .lines()
            .enumerate()
            .filter(|(i, _)| *i + 1 >= start && *i + 1 <= end)
            .map(|(_, line)| line)
            .collect::<Vec<_>>()
            .join("\n");
        out.push_str(&format!(
            "# {}:{}-{}\n{}\n\n",
            r.path, start, end, snippet
        ));
    }
    Ok(out)
}

fn parse_line_range(spec: &str, max_lines: usize) -> anyhow::Result<(usize, usize)> {
    let (s, e) = spec
        .split_once('-')
        .ok_or_else(|| anyhow::anyhow!("invalid line range `{spec}` (expected `start-end`)"))?;
    let start: usize = s.trim().parse().map_err(|_| anyhow::anyhow!("bad start in `{spec}`"))?;
    let end: usize = e.trim().parse().map_err(|_| anyhow::anyhow!("bad end in `{spec}`"))?;
    if start == 0 || end < start {
        anyhow::bail!("invalid line range `{spec}` (1-indexed, end >= start)");
    }
    Ok((start, end.min(max_lines.max(1))))
}

fn chapter_user_prompt(ch: &ChapterSpec, target_words: usize, sources: &str) -> String {
    format!(
        "Write a single chapter of an audio guide titled \"{title}\".\n\n\
         The chapter title is \"{title_only}\". Target length: approximately {target} words.\n\n\
         What to cover (chapter brief):\n{brief}\n\n\
         Source code excerpts to ground the narration in. Quote identifier names, file paths, \
         line numbers, and numeric facts from these excerpts verbatim. Do not invent identifiers, \
         file paths, or numbers that are not present in these excerpts. Do not paraphrase code \
         identifiers into English unless explicitly told to in the system prompt's audio-first \
         rules (e.g. `operator.add` becomes \"operator dot add\" because that's how it's spoken):\n\n\
         --- BEGIN SOURCE EXCERPTS ---\n{sources}\n--- END SOURCE EXCERPTS ---\n\n\
         Output ONLY the chapter body as plain prose. Do NOT include a `## {title_only}` heading \
         line at the top — the binary attaches the heading. Do NOT add a chapter number, preamble, \
         transition into a next chapter, or closing summary. Follow the system prompt's audio-first \
         rules to the letter.",
        title = ch.title,
        title_only = ch.title,
        target = target_words,
        brief = ch.brief.trim(),
        sources = sources.trim_end(),
    )
}

/// If DeepSeek leaks a `## <title>` line at the start despite the instruction,
/// strip it so the caller can attach exactly one canonical heading.
fn strip_chapter_heading<'a>(text: &'a str, title: &str) -> String {
    let lower_title = title.trim().to_ascii_lowercase();
    let trimmed = text.trim_start();
    let leading = trimmed
        .lines()
        .next()
        .map(|l| l.trim().to_ascii_lowercase())
        .unwrap_or_default();
    if leading == format!("## {lower_title}") || leading == lower_title {
        let after_first = trimmed.lines().skip(1).collect::<Vec<_>>().join("\n");
        return after_first.trim_start().to_owned();
    }
    trimmed.to_owned()
}

#[derive(Deserialize)]
struct Outline {
    slug: String,
    title: String,
    default_target_words: Option<usize>,
    chapters: Vec<ChapterSpec>,
}

#[derive(Deserialize)]
struct ChapterSpec {
    title: String,
    brief: String,
    target_words: Option<usize>,
    #[serde(default)]
    sources: Vec<SourceRef>,
}

#[derive(Deserialize)]
struct SourceRef {
    path: String,
    lines: String,
}

/// Load `DEEPSEEK_API_KEY` from the workspace root `.env` if not already set
/// in the process environment.
fn load_env() {
    let candidates = [
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../../.env"),
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../.env.local"),
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../.env.local"),
    ];
    for path in &candidates {
        if path.exists() {
            let _ = dotenvy::from_filename(path);
            tracing::debug!("loaded env from {}", path.display());
        }
    }
}

async fn generate_with_deepseek(
    article: &str,
    title: &str,
    target_words: usize,
) -> anyhow::Result<String> {
    let client = deepseek::client_from_env()?;
    let user = user_prompt_from_article(article, title, target_words);

    tracing::info!(
        "calling DeepSeek (target ≈ {} words, article {} bytes)…",
        target_words,
        article.len()
    );
    let out = deepseek::reason_with_retry(&client, prompts::SYSTEM_PROMPT, &user).await?;
    tracing::info!(
        "DeepSeek returned {} chars of content ({} chars reasoning)",
        out.content.len(),
        out.reasoning.len()
    );
    Ok(out.content)
}

fn user_prompt_from_article(article: &str, title: &str, target_words: usize) -> String {
    format!(
        "Rewrite the following technical article as a faithful audio guide titled \"{title}\" of \
         approximately {target_words} words.\n\nFollow the system prompt rules exactly. Every \
         major idea from the article must be covered. Do not invent material that is not in the \
         article. Each major H2 section of the article becomes one chapter in the narration; \
         start each chapter with a single line `## <Chapter Title>` (five words or fewer) \
         followed by a blank line and the prose body. Skip H2 sections that are pure tables, \
         see-also lists, or cross-references — those don't read well as audio. Begin with the \
         first chapter heading directly; no preamble, no closing summary.\n\n--- ARTICLE \
         MARKDOWN ---\n{article}\n--- END ARTICLE ---"
    )
}

fn build_meta(script_raw: &str, slug: &str, title: &str) -> anyhow::Result<AudioMeta> {
    let script = strip_script_preamble(script_raw);
    let skip = markdown::skip_h2_titles();

    let mut chapters: Vec<AudioChapter> = Vec::new();
    let mut cumulative: u32 = 0;
    let mut full_script_parts: Vec<String> = Vec::new();

    for (raw_title, raw_body) in markdown::split_chapters(script) {
        if raw_title == "Introduction" && raw_body.is_empty() {
            continue;
        }
        if skip.contains(raw_title.to_ascii_lowercase().as_str()) {
            tracing::debug!("skip h2: {raw_title}");
            continue;
        }
        let stripped = markdown::strip_markdown(&raw_body);
        let polished = markdown::polish_for_audio(&stripped);
        let words = wpm::count_words(&polished);
        if words < 12 {
            tracing::debug!("drop short chapter ({words}w): {raw_title}");
            continue;
        }
        let duration = wpm::estimate_secs(words);
        let index = chapters.len();
        full_script_parts.push(format!("## {raw_title}\n\n{polished}"));
        chapters.push(AudioChapter {
            index,
            title: raw_title,
            start_secs: cumulative,
            duration_secs: duration,
            script: polished,
        });
        cumulative += duration;
    }

    if chapters.is_empty() {
        anyhow::bail!(
            "DeepSeek output produced zero usable chapters — script preview:\n---\n{}\n---",
            script_raw.chars().take(400).collect::<String>()
        );
    }

    Ok(AudioMeta {
        slug: slug.to_owned(),
        title: title.to_owned(),
        voice: "pending-tts".to_string(),
        duration_secs: cumulative,
        file_size_bytes: 0,
        audio_url: String::new(),
        chapters,
        full_script: full_script_parts.join("\n\n"),
    })
}

/// Strip any preamble before the first H2.
fn strip_script_preamble(s: &str) -> &str {
    match s.find("\n## ") {
        Some(_) if s.trim_start().starts_with("## ") => s.trim_start(),
        Some(idx) => &s[idx + 1..],
        None => s,
    }
}
