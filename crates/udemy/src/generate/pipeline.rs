//! The async content-generation pipeline — mirrors the Python article graph
//! (research -> outline -> draft -> review -> revise<=2 -> finalize), grounded
//! on Udemy LanceDB retrieval, writing `content/{slug}.md`.

use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use deepseek::{
    build_request, client_from_env, user_msg, DeepSeekClient, DeepSeekModel, EffortLevel,
    ReqwestClient,
};
use tracing::info;

use crate::embed;
use crate::generate::prompts;
use crate::generate::quality::{check_quality, Quality};
use crate::generate::retrieve::{format_grounding, ground};
use crate::store::CourseStore;

pub struct GenerateConfig {
    pub slug: String,
    pub topic: String,
    pub category: String,
    pub related_topics: String,
    pub db_path: String,
    pub embed_url: String,
    pub content_dir: PathBuf,
    pub model_alias: Option<String>,
    pub top_courses: usize,
    pub top_chapters: usize,
    pub max_revisions: usize,
    pub max_tokens: u32,
    pub no_write: bool,
}

pub struct GenerateOutcome {
    pub final_text: String,
    pub word_count: usize,
    pub revisions: usize,
    pub quality: Quality,
    pub out_path: Option<PathBuf>,
}

#[derive(Debug, PartialEq)]
enum Route {
    Revise,
    Finalize,
}

fn after_revise(q: &Quality, revision: usize, max_revisions: usize) -> Route {
    if q.ok || revision >= max_revisions {
        Route::Finalize
    } else {
        Route::Revise
    }
}

/// Title-case each space-separated word (first char upper, rest unchanged).
fn titleize(s: &str) -> String {
    s.split(' ')
        .map(|w| {
            let mut c = w.chars();
            match c.next() {
                Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// Mirrors generate_article.py humanize_slug: `-`/`_` -> space, Title Case.
pub fn humanize_slug(slug: &str) -> String {
    titleize(&slug.replace(['-', '_'], " "))
}

/// Mirrors the Python existing-article link title: only `-` -> space, title.
fn link_title(stem: &str) -> String {
    titleize(&stem.replace('-', " "))
}

fn gather_existing_articles(content_dir: &Path, current_slug: &str) -> String {
    let mut stems: Vec<String> = Vec::new();
    if let Ok(rd) = std::fs::read_dir(content_dir) {
        for e in rd.flatten() {
            if !e.file_type().map(|t| t.is_file()).unwrap_or(false) {
                continue;
            }
            let p = e.path();
            if p.extension().and_then(|x| x.to_str()) == Some("md") {
                if let Some(stem) = p.file_stem().and_then(|x| x.to_str()) {
                    stems.push(stem.to_string());
                }
            }
        }
    }
    stems.sort();
    stems
        .iter()
        .filter(|s| s.as_str() != current_slug)
        .take(40)
        .map(|s| format!("- [{}](/{})", link_title(s), s))
        .collect::<Vec<_>>()
        .join("\n")
}

fn pick_style_sample(content_dir: &Path, current_slug: &str) -> String {
    let mut best: Option<(u64, PathBuf)> = None;
    if let Ok(rd) = std::fs::read_dir(content_dir) {
        for e in rd.flatten() {
            if !e.file_type().map(|t| t.is_file()).unwrap_or(false) {
                continue;
            }
            let p = e.path();
            if p.extension().and_then(|x| x.to_str()) != Some("md") {
                continue;
            }
            if p.file_stem().and_then(|x| x.to_str()) == Some(current_slug) {
                continue;
            }
            let len = e.metadata().map(|m| m.len()).unwrap_or(0);
            if best.as_ref().map(|(b, _)| len > *b).unwrap_or(true) {
                best = Some((len, p));
            }
        }
    }
    match best {
        Some((_, p)) => std::fs::read_to_string(&p)
            .unwrap_or_default()
            .chars()
            .take(2000)
            .collect(),
        None => String::new(),
    }
}

/// Extract the assistant text from a chat response, rejecting an
/// empty/whitespace body so a degenerate LLM reply fails fast and loud
/// instead of silently producing a broken article that burns a revise cycle.
fn extract_content(resp: deepseek::ChatResponse) -> Result<String> {
    let choice = resp
        .choices
        .into_iter()
        .next()
        .context("no choices in DeepSeek response")?;
    let content = choice.message.content.as_str().to_string();
    if content.trim().is_empty() {
        anyhow::bail!("DeepSeek returned empty content");
    }
    Ok(content)
}

async fn ask(
    client: &DeepSeekClient<ReqwestClient>,
    model: &DeepSeekModel,
    prompt: &str,
    max_tokens: u32,
) -> Result<String> {
    let mut req = build_request(model, vec![user_msg(prompt)], None, &EffortLevel::Max);
    req.max_tokens = Some(max_tokens);
    req.temperature = Some(0.2);
    let delays = [0u64, 1, 2, 4];
    let mut last: Option<String> = None;
    for (attempt, &d) in delays.iter().enumerate() {
        if d > 0 {
            tokio::time::sleep(std::time::Duration::from_secs(d)).await;
        }
        match client.chat(&req).await {
            Ok(resp) => return extract_content(resp),
            Err(e) => {
                let msg = e.to_string();
                let retryable = msg.contains("API error (5")
                    || msg.contains("HTTP error")
                    || msg.contains("connection")
                    || msg.contains("timed out");
                if !retryable || attempt == delays.len() - 1 {
                    return Err(anyhow::anyhow!("DeepSeek call failed: {msg}"));
                }
                last = Some(msg);
            }
        }
    }
    Err(anyhow::anyhow!(
        "DeepSeek call failed: {}",
        last.unwrap_or_default()
    ))
}

/// Reject a slug that is not a simple kebab token, so the `{slug}.md` write
/// can never escape `content_dir` (path traversal) or yield odd filenames.
fn validate_slug(slug: &str) -> Result<()> {
    if slug.is_empty()
        || !slug
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
    {
        anyhow::bail!(
            "invalid --slug {slug:?}: expected a non-empty kebab slug [a-z0-9-] (no '/', '.', spaces, uppercase)"
        );
    }
    Ok(())
}

/// Fail fast on a bad output directory *before* spending any LLM tokens
/// (skipped when `no_write`, where the directory is never touched).
fn ensure_writable_dir(dir: &std::path::Path, no_write: bool) -> Result<()> {
    if no_write {
        return Ok(());
    }
    if !dir.is_dir() {
        anyhow::bail!(
            "content_dir does not exist or is not a directory: {} (create it, or pass --content-dir / --no-write)",
            dir.display()
        );
    }
    Ok(())
}

/// Run the full pipeline. Requires a reachable embed-server, `DEEPSEEK_API_KEY`
/// in the environment, and a populated LanceDB at `cfg.db_path`.
pub async fn generate_article(cfg: GenerateConfig) -> Result<GenerateOutcome> {
    validate_slug(&cfg.slug)?;
    ensure_writable_dir(&cfg.content_dir, cfg.no_write)?;
    let http = reqwest::Client::new();
    embed::health(&http, &cfg.embed_url).await?;
    let client = client_from_env()?;
    let model = cfg
        .model_alias
        .as_deref()
        .map(DeepSeekModel::from_alias)
        .unwrap_or_default();
    let store = CourseStore::connect(&cfg.db_path).await?;

    let existing_articles = gather_existing_articles(&cfg.content_dir, &cfg.slug);
    let style_sample = pick_style_sample(&cfg.content_dir, &cfg.slug);

    let query = format!("{} {}", cfg.topic, cfg.related_topics);
    let g = ground(
        &store,
        &http,
        &cfg.embed_url,
        query.trim(),
        cfg.top_courses,
        cfg.top_chapters,
    )
    .await?;
    info!(
        "grounding: {} courses, {} chapters",
        g.courses.len(),
        g.chapters.len()
    );
    let grounding = format_grounding(&g);

    let research = ask(
        &client,
        &model,
        &prompts::research_prompt(&cfg.topic, &cfg.slug, &cfg.related_topics, &grounding),
        cfg.max_tokens,
    )
    .await?;
    info!("research done ({} chars)", research.len());

    let outline = ask(
        &client,
        &model,
        &prompts::outline_prompt(
            &cfg.topic,
            &cfg.slug,
            &cfg.category,
            &research,
            &existing_articles,
            &grounding,
        ),
        cfg.max_tokens,
    )
    .await?;
    info!("outline done ({} chars)", outline.len());

    let draft = ask(
        &client,
        &model,
        &prompts::draft_prompt(
            &cfg.topic,
            &cfg.slug,
            &outline,
            &research,
            &style_sample,
            &grounding,
        ),
        cfg.max_tokens,
    )
    .await?;
    info!("draft done ({} chars)", draft.len());

    let mut final_text = ask(
        &client,
        &model,
        &prompts::review_prompt(&cfg.topic, &draft),
        cfg.max_tokens,
    )
    .await?;
    let mut quality = check_quality(&final_text);
    let mut revision = 0usize;

    while after_revise(&quality, revision, cfg.max_revisions) == Route::Revise {
        let issues = quality
            .issues
            .iter()
            .map(|i| format!("- {i}"))
            .collect::<Vec<_>>()
            .join("\n");
        info!(
            "revision {} — {} issue(s)",
            revision + 1,
            quality.issues.len()
        );
        final_text = ask(
            &client,
            &model,
            &prompts::revise_prompt(&cfg.topic, &final_text, &issues),
            cfg.max_tokens,
        )
        .await?;
        quality = check_quality(&final_text);
        revision += 1;
    }

    let out_path = if cfg.no_write {
        None
    } else {
        let p = cfg.content_dir.join(format!("{}.md", cfg.slug));
        std::fs::write(&p, &final_text)
            .with_context(|| format!("writing {}", p.display()))?;
        Some(p)
    };

    Ok(GenerateOutcome {
        word_count: quality.word_count,
        revisions: revision,
        final_text,
        quality,
        out_path,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::generate::quality::check_quality;

    #[test]
    fn extract_content_rejects_empty_and_no_choices() {
        use deepseek::{assistant_msg, ChatResponse, Choice};
        let mk = |c: &str| ChatResponse {
            id: "x".into(),
            choices: vec![Choice {
                index: 0,
                message: assistant_msg(c),
                finish_reason: None,
            }],
            usage: None,
        };
        assert_eq!(extract_content(mk("hello world")).unwrap(), "hello world");
        assert!(extract_content(mk("   \n  ")).is_err());
        assert!(extract_content(ChatResponse {
            id: "x".into(),
            choices: vec![],
            usage: None,
        })
        .is_err());
    }

    #[test]
    fn humanize_and_link_title() {
        assert_eq!(humanize_slug("agent-memory-systems"), "Agent Memory Systems");
        assert_eq!(humanize_slug("rag_pipeline"), "Rag Pipeline");
        assert_eq!(link_title("vector-search"), "Vector Search");
    }

    #[test]
    fn after_revise_truth_table() {
        let ok = check_quality(&format!(
            "# T\n\n## Mental Model\n\n[x](/y)\n\n## Runtime Internals\n\n## P\n\n```python\n1\n```\n\n```python\n2\n```\n\n{}\n{}",
            "```xyflow\n{}\n```\n".repeat(5),
            "w ".repeat(1600)
        ));
        assert!(ok.ok);
        let bad = check_quality("too short");
        assert!(!bad.ok);
        assert_eq!(after_revise(&ok, 0, 2), Route::Finalize);
        assert_eq!(after_revise(&bad, 0, 2), Route::Revise);
        assert_eq!(after_revise(&bad, 1, 2), Route::Revise);
        assert_eq!(after_revise(&bad, 2, 2), Route::Finalize);
        assert_eq!(after_revise(&ok, 2, 2), Route::Finalize);
    }

    #[test]
    fn validate_slug_rejects_traversal_and_junk() {
        assert!(validate_slug("agent-memory-systems").is_ok());
        assert!(validate_slug("rag2").is_ok());
        assert!(validate_slug("").is_err());
        assert!(validate_slug("../etc/passwd").is_err());
        assert!(validate_slug("a/b").is_err());
        assert!(validate_slug("Has Space").is_err());
        assert!(validate_slug("Upper").is_err());
        assert!(validate_slug("dot.name").is_err());
    }

    #[test]
    fn ensure_writable_dir_checks() {
        let d = tempfile::tempdir().unwrap();
        assert!(ensure_writable_dir(d.path(), false).is_ok());
        let missing = d.path().join("nope");
        assert!(ensure_writable_dir(&missing, false).is_err());
        // skipped entirely when no_write
        assert!(ensure_writable_dir(&missing, true).is_ok());
    }

    #[test]
    fn inputs_skip_non_file_md_entries() {
        let d = tempfile::tempdir().unwrap();
        std::fs::write(d.path().join("real-one.md"), "hello".repeat(50)).unwrap();
        std::fs::create_dir(d.path().join("weird.md")).unwrap();
        let ga = gather_existing_articles(d.path(), "cur");
        assert!(ga.contains("- [Real One](/real-one)"));
        assert!(!ga.contains("weird"));
        let ss = pick_style_sample(d.path(), "cur");
        assert!(ss.starts_with("hello"));
    }

    #[test]
    fn gather_and_pick_use_tempdir() {
        let d = tempfile::tempdir().unwrap();
        std::fs::write(d.path().join("alpha-one.md"), "a".repeat(50)).unwrap();
        std::fs::write(d.path().join("beta-two.md"), "b".repeat(5000)).unwrap();
        std::fs::write(d.path().join("cur.md"), "c").unwrap();
        std::fs::write(d.path().join("notes.txt"), "x").unwrap();
        let ga = gather_existing_articles(d.path(), "cur");
        assert!(ga.contains("- [Alpha One](/alpha-one)"));
        assert!(ga.contains("- [Beta Two](/beta-two)"));
        assert!(!ga.contains("cur"));
        let ss = pick_style_sample(d.path(), "cur");
        assert!(ss.starts_with('b') && ss.len() <= 2000);
    }
}
