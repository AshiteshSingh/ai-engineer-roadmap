//! Parse lesson markdown files from the knowledge app's content/ directory.

use std::path::Path;

use walkdir::WalkDir;

use crate::types::Lesson;

/// Extract the H1 title from markdown content.
fn extract_title(content: &str) -> String {
    content
        .lines()
        .find_map(|l| l.strip_prefix("# "))
        .unwrap_or("Untitled")
        .trim()
        .to_string()
}

/// Extract the first substantive paragraph (non-heading, non-code, non-table).
fn extract_excerpt(content: &str, max_len: usize) -> String {
    let mut past_title = false;
    for line in content.lines() {
        if !past_title {
            if line.starts_with("# ") {
                past_title = true;
            }
            continue;
        }
        let t = line.trim();
        if t.is_empty()
            || t.starts_with('#')
            || t.starts_with("```")
            || t.starts_with('|')
            || t.starts_with('-')
            || t.starts_with('>')
        {
            continue;
        }
        // Strip inline markdown
        let plain = t
            .replace("**", "")
            .replace('*', "")
            .replace('`', "");
        // Simple link stripping [text](url) -> text
        let plain = regex_strip_links(&plain);
        if plain.len() < 30 {
            continue;
        }
        return if plain.len() > max_len {
            plain[..max_len]
                .rsplit_once(' ')
                .map(|(s, _)| format!("{s}\u{2026}"))
                .unwrap_or_else(|| plain[..max_len].to_string())
        } else {
            plain
        };
    }
    String::new()
}

fn regex_strip_links(s: &str) -> String {
    // Replace [text](url) with text -- simple state-machine approach
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '[' {
            let mut inner = String::new();
            for ch in chars.by_ref() {
                if ch == ']' {
                    break;
                }
                inner.push(ch);
            }
            // Consume (url) if present
            if chars.peek() == Some(&'(') {
                chars.next();
                for ch in chars.by_ref() {
                    if ch == ')' {
                        break;
                    }
                }
            }
            out.push_str(&inner);
        } else {
            out.push(c);
        }
    }
    out
}

/// Infer category from the file slug using the same ranges as articles.ts.
fn category_from_slug(slug: &str) -> &'static str {
    match slug {
        s if matches!(s, "transformer-architecture"|"scaling-laws"|"tokenization"|"model-architectures"|"inference-optimization"|"pretraining-data"|"embeddings") => "Foundations & Architecture",
        s if matches!(s, "prompt-engineering-fundamentals"|"few-shot-chain-of-thought"|"system-prompts"|"structured-output"|"prompt-optimization"|"adversarial-prompting") => "Prompting & In-Context Learning",
        s if matches!(s, "embedding-models"|"vector-databases"|"chunking-strategies"|"retrieval-strategies"|"advanced-rag"|"rag-evaluation") => "RAG & Retrieval",
        s if matches!(s, "fine-tuning-fundamentals"|"lora-adapters"|"rlhf-preference"|"dataset-curation"|"continual-learning"|"distillation-compression") => "Fine-tuning & Training",
        s if matches!(s, "context-engineering"|"context-window-management"|"memory-architectures"|"prompt-caching"|"dynamic-context-assembly"|"context-compression") => "Context Engineering",
        s if matches!(s, "function-calling"|"agent-architectures"|"multi-agent-systems"|"agent-memory"|"code-agents"|"agent-evaluation"|"agent-harnesses"|"agent-orchestration"|"agent-sdks"|"agent-debugging") => "Agents & Harnesses",
        s if matches!(s, "eval-fundamentals"|"benchmark-design"|"llm-as-judge"|"human-evaluation"|"red-teaming"|"eval-frameworks-comparison"|"deepeval-synthesizer") => "Evals & Testing",
        s if matches!(s, "llm-serving"|"scaling-load-balancing"|"cost-optimization"|"observability"|"edge-deployment"|"ai-gateway") => "Infrastructure & Deployment",
        s if matches!(s, "constitutional-ai"|"guardrails-filtering"|"hallucination-mitigation"|"bias-fairness"|"ai-governance"|"interpretability"|"ci-cd-ai") => "Safety & Alignment",
        s if matches!(s, "vision-language-models"|"audio-speech-ai"|"ai-for-code"|"conversational-ai") => "Multimodal AI",
        s if matches!(s, "search-recommendations"|"production-patterns"|"langgraph"|"langgraph-red-teaming"|"llamaindex"|"ai-engineer-roadmap") => "Applied AI & Production",
        s if matches!(s, "aws"|"azure"|"gcp"|"docker"|"kubernetes") => "Cloud Platforms",
        s if s.starts_with("aws-") || s == "dynamodb-data-services" => "AWS Deep Dives",
        s if matches!(s, "microservices"|"ci-cd"|"nodejs"|"solid-principles"|"acid-properties") => "Software Engineering",
        _ => "Other",
    }
}

/// Load all `.md` files under `content_dir` into `Lesson` structs.
pub fn load_lessons(content_dir: &Path) -> anyhow::Result<Vec<Lesson>> {
    let mut lessons = Vec::new();

    for entry in WalkDir::new(content_dir)
        .max_depth(1)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().and_then(|x| x.to_str()) == Some("md"))
    {
        let path = entry.path();
        let slug = path
            .file_stem()
            .and_then(|s| s.to_str())
            .ok_or_else(|| anyhow::anyhow!("bad filename: {}", path.display()))?
            .to_string();

        let content = std::fs::read_to_string(path)?;
        let title = extract_title(&content);
        let excerpt = extract_excerpt(&content, 200);
        let word_count = content.split_whitespace().count();
        let category = category_from_slug(&slug).to_string();

        lessons.push(Lesson {
            slug,
            title,
            excerpt,
            content,
            category,
            word_count,
        });
    }

    lessons.sort_by(|a, b| a.slug.cmp(&b.slug));
    Ok(lessons)
}
