//! `article_generate` — 1:1 port of
//! `backend/knowledge_agent/article_generate_graph.py`.
//!
//! Sequential pipeline: research → outline → draft → review → (revise loop,
//! ≤2) → finalize. `pyformat` reproduces Python `str.format` exactly for these
//! templates (`{{`/`}}` → literal braces, `{name}` → field; inserted values
//! are never re-scanned). `check_quality` mirrors the regex gate field-for-
//! field. The final object merges input + every node's output (LangGraph
//! `ainvoke` shape) so `scripts/generate_article.py` reads identical keys.

use deepseek::{DeepSeekClient, HttpClient};
use regex::Regex;
use serde_json::{json, Map, Value};

use super::{ask, as_object, merge, msg};

const MAX_REVISIONS: i64 = 2;
const MIN_WORD_COUNT: usize = 1500;
const MIN_CODE_BLOCKS: usize = 2;
const MIN_CROSS_REFS: usize = 1;
const MIN_MERMAID_BLOCKS: usize = 5;

// ── Prompt templates (verbatim; flush-left so the raw string has no indent) ─

const DOCTRINE: &str = r####"[KNOWLEDGE BASE DOCTRINE — CLOUDFLARE WORKERS ONLY]
This is the "AI Engineer on Cloudflare" roadmap. Teach the topic ONLY through the
Cloudflare Workers edge platform. The default — and unless the topic is explicitly
about another platform, the ONLY — building blocks are:
- Workers: serverless compute that runs all application/agent logic at the edge
- Workers AI: chat + embedding model inference via the env.AI binding (no external LLM API)
- AI Gateway: caching, rate-limiting, fallback and observability for model traffic
- Vectorize: the vector database for embeddings and semantic search
- D1: serverless SQLite for application state, metadata and agent checkpoints
- R2: object storage for documents, datasets and artifacts
- KV: low-latency key-value cache for sessions and hot config
- Durable Objects: single-threaded stateful coordination for long-lived agents
- Queues: async/background jobs and fan-out
- Workflows: durable, multi-step orchestration of AI pipelines
- Pages: frontend hosting; Wrangler: local dev, bindings and deploy

Python code MUST prefer these packages (assume they are installed):
- langchain-cloudflare: ChatCloudflareWorkersAI, CloudflareWorkersAIEmbeddings, CloudflareVectorize
- langgraph-checkpoint-cloudflare-d1: CloudflareD1Saver, AsyncCloudflareD1Saver (LangGraph checkpoints on D1)
- langmem-cloudflare-vectorize: CloudflareVectorizeLangmemStore (long-term agent memory on Vectorize)

Show realistic wrangler.toml / wrangler.jsonc binding snippets where a service is used.
Do NOT present OpenAI/Anthropic SDKs, Pinecone/Chroma/pgvector, raw Postgres/Redis, or
AWS/GCP/Azure as the primary stack. They may appear ONLY as a one-line contrast
("off the edge you'd reach for X; here we use the Cloudflare equivalent Y"). Every
runnable example, diagram and pattern must be expressible on Cloudflare Workers.
[END DOCTRINE]

"####;

const RESEARCH_BODY: &str = r####"You are a technical researcher preparing material for an AI engineering knowledge base article.

Topic: {topic}
Slug: {slug}

Research this topic thoroughly. Provide:
1. Core concepts and definitions
2. How it works technically (internals, data flow, architecture)
3. Key patterns and best practices used in production
4. Common pitfalls and how to avoid them
5. How this topic relates to: {related_topics}
6. Recent developments and current state of the art

Be specific and technical. Include concrete details that would be useful for an AI engineer.
Output your research as structured notes.
"####;

const OUTLINE_BODY: &str = r####"You are an expert technical writer creating an outline for an AI engineering knowledge base article.

Topic: {topic}
Slug: {slug}
Category: {category}

Research notes:
{research}

Existing articles in this knowledge base for cross-referencing:
{existing_articles}

Create a detailed outline for this article. The article must follow a "simple-first, then deep" arc:

1. `# Title` — concise, descriptive
2. **Opening paragraph** (no heading): one paragraph that explains what this is, why it matters, and sets context. Avoid jargon here.
3. `## Mental Model` — **plain-English first**. Build intuition before any code. Three short subsections:
   - `### What problem does it solve?` — contrast with the naive/linear approach
   - `### The whiteboard analogy` — a concrete visual analogy (~120 words) ending with a `xyflow` JSON diagram
   - `### Hello-world in ~10 lines` — minimum viable example with a matching `xyflow` JSON diagram
4. `## Core Concepts` — definitions, type signatures, foundational primitives. Each major primitive gets a `xyflow` diagram alongside the code.
5. `## How It Works` — technical sections with Python code examples and `xyflow` diagrams illustrating control flow / state changes.
6. `## Runtime Internals` — **deep-dive** section: explain the underlying execution model (e.g., for LangGraph: Pregel/BSP supersteps, channels, deterministic replay). This is "why it works the way it does," not just "what the API is."
7. `## Patterns` — practical production patterns with at least one `xyflow` diagram per pattern (e.g., fan-out, supervisor, HITL).
8. `## Common Pitfalls` — what goes wrong and how to detect it.
9. `## Comparison` with alternatives (if applicable).

For each section, note:
- Key points to cover
- Code examples needed — match the topic's natural language: SQL for database topics, Python for LLM/agent topics (LangGraph, agents), TypeScript where the API is JS-only. For LangGraph articles specifically, all examples must be Python.
- **Diagrams**: every conceptual section must specify at least one `xyflow` JSON diagram — total target ≥ 6 diagrams across the article. Do NOT use mermaid; use the xyflow JSON fence described in the draft prompt.
- Cross-references to related articles using markdown links like [Article Title](/slug)

Output the outline as markdown with section headers and bullet points under each.
"####;

const DRAFT_BODY: &str = r####"You are an expert AI engineer and technical writer. Write a comprehensive knowledge base article.

Topic: {topic}
Slug: {slug}

Outline:
{outline}

Research notes:
{research}

Style reference (match this tone, depth, and format):
---
{style_sample}
---

Structural requirements:
- Start with `# Title` — a clear, descriptive title
- Opening paragraph: explain what this is, why it matters, cross-reference related articles
- **Second section MUST be `## Mental Model`** with the three subsections from the outline (problem, analogy, hello-world). Build intuition before any deep API material.
- Use `##` for major sections, `###` for subsections
- Include a `## Runtime Internals` deep-dive section that explains the execution model, not just the API surface
- Cross-reference at least 2 related articles as [Title](/slug) links

Code requirements:
- Include at least 3 real, working code examples in the language natural to the topic: **SQL** for database articles (PostgreSQL, MySQL, query optimization), **Python** for LLM/agent articles (LangGraph, agents, ML), **TypeScript** where the API is JS-only. Do not force Python into a SQL article or vice versa.
- Use ```python or ```typescript code fences with proper syntax
- Include tables for comparisons using markdown pipe syntax

Diagram requirements (CRITICAL — use xyflow, NOT mermaid):
- Include **at least 5 interactive graph diagrams** using the ```xyflow code fence with strict JSON inside
- Each xyflow block is rendered as a draggable React Flow graph by the knowledge app — DO NOT write mermaid syntax, DO NOT use ```mermaid fences
- The JSON schema is exactly:

  ```xyflow
  {{
    "direction": "TD",
    "nodes": [
      {{"id": "user", "label": "User Query", "shape": "circle"}},
      {{"id": "agent", "label": "Agent\nNode", "shape": "rect"}},
      {{"id": "decide", "label": "Has tool calls?", "shape": "diamond"}},
      {{"id": "tool", "label": "ToolNode", "shape": "rect"}},
      {{"id": "done", "label": "Response", "shape": "circle"}}
    ],
    "edges": [
      {{"source": "user", "target": "agent"}},
      {{"source": "agent", "target": "decide"}},
      {{"source": "decide", "target": "tool", "label": "yes"}},
      {{"source": "decide", "target": "done", "label": "no"}},
      {{"source": "tool", "target": "agent"}}
    ]
  }}
  ```

- `direction` must be `"TD"` (top-down) or `"LR"` (left-right). TD for hierarchical flows, LR for pipelines.
- `shape` must be one of: `"rect"` (default), `"circle"` (start/end states), `"diamond"` (decisions), `"stadium"` (events).
- Edges MUST reference existing node ids in the same block.
- Use `\n` inside labels for line breaks.
- Optional `"label"` on edges for branch conditions.
- Output **valid JSON only** inside the xyflow fence — no comments, no trailing commas. The renderer uses JSON.parse().

Diagram placement:
- One xyflow block in the whiteboard analogy subsection
- One xyflow block matching the hello-world code
- One xyflow block per major Core Concept primitive that has control flow (e.g., conditional routing, fan-out)
- One xyflow block in Runtime Internals showing the execution loop / superstep model
- One xyflow block per pattern in `## Patterns`

Audience & length:
- Write for an intermediate-to-senior AI engineer audience, but the Mental Model section should be approachable to a beginner
- Be specific and technical in the deep sections — no hand-waving or filler
- Target 2500–4500 words
- No frontmatter, no YAML headers — just pure markdown starting with `# Title`

Write the complete article now.
"####;

const REVIEW_BODY: &str = r####"You are a senior technical editor reviewing an AI engineering knowledge base article.

Topic: {topic}
Draft:
{draft}

Review this article and produce an improved final version. Check for:
1. Technical accuracy — are claims correct? Are code examples valid?
2. Completeness — are important aspects of the topic missing?
3. Code quality — do examples use best practices? Are they runnable?
4. Structure — does the flow make sense? Are sections well-organized?
5. Cross-references — are links to related articles using correct /slug format?
6. Conciseness — remove filler, tighten prose, keep it dense with information
7. Tables and comparisons — are they clear and accurate?

Output the final, improved version of the full article (complete markdown, starting with `# Title`).
Do NOT output review notes — output the final article directly.
"####;

const REVISE_BODY: &str = r####"You are an expert AI engineer and technical writer. An article you wrote failed quality checks.

Topic: {topic}

Current article:
{draft}

Issues to fix:
{issues}

Revise the article to address ALL listed issues. Maintain the existing structure and content but expand, add code examples, add cross-references, or restructure as needed.

Output the complete revised article (full markdown, starting with `# Title`).
"####;

/// Python `str.format` for these templates: `{{`→`{`, `}}`→`}`,
/// `{ident}`→field. Unknown `{...}` is left verbatim (defensive — our
/// templates only use known fields). Inserted values are not re-scanned.
fn pyformat(template: &str, fields: &[(&str, &str)]) -> String {
    let bytes = template.as_bytes();
    let mut out = String::with_capacity(template.len() + 256);
    let mut i = 0;
    while i < bytes.len() {
        let c = bytes[i] as char;
        if c == '{' {
            if i + 1 < bytes.len() && bytes[i + 1] == b'{' {
                out.push('{');
                i += 2;
                continue;
            }
            if let Some(close) = template[i + 1..].find('}') {
                let name = &template[i + 1..i + 1 + close];
                if let Some((_, v)) = fields.iter().find(|(k, _)| *k == name) {
                    out.push_str(v);
                    i = i + 1 + close + 1;
                    continue;
                }
            }
            out.push('{');
            i += 1;
        } else if c == '}' {
            if i + 1 < bytes.len() && bytes[i + 1] == b'}' {
                out.push('}');
                i += 2;
                continue;
            }
            out.push('}');
            i += 1;
        } else {
            out.push(c);
            i += 1;
        }
    }
    out
}

fn sfield(state: &Map<String, Value>, key: &str) -> String {
    match state.get(key) {
        None => String::new(),
        Some(Value::Null) => "None".into(),
        Some(Value::String(s)) => s.clone(),
        Some(Value::Bool(b)) => if *b { "True" } else { "False" }.into(),
        Some(Value::Number(n)) => n.to_string(),
        Some(other) => other.to_string(),
    }
}

/// Port of `article_generate_graph.py::check_quality`.
pub fn check_quality(content: &str) -> Value {
    let word_count = content.split_whitespace().count();
    let code_blocks = Regex::new(r"```\w+").unwrap().find_iter(content).count();
    let cross_refs = Regex::new(r"\]\(/[\w-]+\)")
        .unwrap()
        .find_iter(content)
        .count();
    let has_title = content.trim_start().starts_with("# ");
    let section_count = Regex::new(r"(?m)^## ").unwrap().find_iter(content).count();
    let xyflow_blocks = Regex::new(r"```xyflow\b")
        .unwrap()
        .find_iter(content)
        .count();
    let mermaid_blocks = Regex::new(r"```mermaid\b")
        .unwrap()
        .find_iter(content)
        .count();
    let has_mental_model = Regex::new(r"(?m)^##\s+Mental Model\b")
        .unwrap()
        .is_match(content);
    let has_runtime_internals = Regex::new(r"(?m)^##\s+Runtime Internals\b")
        .unwrap()
        .is_match(content);

    let mut issues: Vec<String> = Vec::new();
    if word_count < MIN_WORD_COUNT {
        issues.push(format!(
            "Too short: {word_count} words (min {MIN_WORD_COUNT})"
        ));
    }
    if code_blocks < MIN_CODE_BLOCKS {
        issues.push(format!(
            "Too few code examples: {code_blocks} (min {MIN_CODE_BLOCKS})"
        ));
    }
    if cross_refs < MIN_CROSS_REFS {
        issues.push(format!(
            "Missing cross-references: {cross_refs} (min {MIN_CROSS_REFS})"
        ));
    }
    if !has_title {
        issues.push("Missing # title on first line".to_string());
    }
    if section_count < 3 {
        issues.push("Fewer than 3 ## sections".to_string());
    }
    if xyflow_blocks < MIN_MERMAID_BLOCKS {
        issues.push(format!(
            "Too few xyflow diagrams: {xyflow_blocks} (min {MIN_MERMAID_BLOCKS}). Use ```xyflow JSON fences, not ```mermaid."
        ));
    }
    if mermaid_blocks > 0 {
        issues.push(format!(
            "Found {mermaid_blocks} ```mermaid block(s) — replace each with a ```xyflow JSON diagram."
        ));
    }
    if !has_mental_model {
        issues.push("Missing `## Mental Model` section (required as the second-level section before Core Concepts).".to_string());
    }
    if !has_runtime_internals {
        issues.push("Missing `## Runtime Internals` deep-dive section.".to_string());
    }

    json!({
        "ok": issues.is_empty(),
        "issues": issues,
        "wordCount": word_count,
        "codeBlocks": code_blocks,
        "crossRefs": cross_refs,
        "xyflowBlocks": xyflow_blocks,
    })
}

pub async fn run<H: HttpClient>(
    input: Value,
    client: &DeepSeekClient<H>,
    model: &str,
    temp: f64,
) -> anyhow::Result<Value> {
    let state = as_object(input);
    let topic = sfield(&state, "topic");
    let slug = sfield(&state, "slug");
    let category = sfield(&state, "category");
    let related_topics = sfield(&state, "related_topics");
    let existing_articles = sfield(&state, "existing_articles");
    let style_sample = sfield(&state, "style_sample");

    let one = |body: &str, fields: &[(&str, &str)]| {
        pyformat(&format!("{DOCTRINE}{body}"), fields)
    };

    // research → outline → draft
    let research = ask(
        client,
        model,
        temp,
        vec![msg(
            "user",
            one(
                RESEARCH_BODY,
                &[
                    ("topic", &topic),
                    ("slug", &slug),
                    ("related_topics", &related_topics),
                ],
            ),
        )],
    )
    .await?;

    let outline = ask(
        client,
        model,
        temp,
        vec![msg(
            "user",
            one(
                OUTLINE_BODY,
                &[
                    ("topic", &topic),
                    ("slug", &slug),
                    ("category", &category),
                    ("research", &research),
                    ("existing_articles", &existing_articles),
                ],
            ),
        )],
    )
    .await?;

    let draft = ask(
        client,
        model,
        temp,
        vec![msg(
            "user",
            one(
                DRAFT_BODY,
                &[
                    ("topic", &topic),
                    ("slug", &slug),
                    ("outline", &outline),
                    ("research", &research),
                    ("style_sample", &style_sample),
                ],
            ),
        )],
    )
    .await?;

    // review (revision=0)
    let mut final_md = ask(
        client,
        model,
        temp,
        vec![msg(
            "user",
            one(REVIEW_BODY, &[("topic", &topic), ("draft", &draft)]),
        )],
    )
    .await?;
    let mut quality = check_quality(&final_md);
    let mut revision: i64 = 0;

    // revise loop — mirrors the conditional edges (≤ MAX_REVISIONS passes)
    while !quality["ok"].as_bool().unwrap_or(false) && revision < MAX_REVISIONS {
        let issues = quality["issues"]
            .as_array()
            .map(|a| {
                a.iter()
                    .map(|i| format!("- {}", i.as_str().unwrap_or("")))
                    .collect::<Vec<_>>()
                    .join("\n")
            })
            .unwrap_or_default();
        final_md = ask(
            client,
            model,
            temp,
            vec![msg(
                "user",
                one(
                    REVISE_BODY,
                    &[
                        ("topic", &topic),
                        ("draft", &final_md),
                        ("issues", &issues),
                    ],
                ),
            )],
        )
        .await?;
        quality = check_quality(&final_md);
        revision += 1;
    }

    // finalize
    let word_count = quality["wordCount"].clone();

    Ok(merge(
        state,
        vec![
            ("research", json!(research)),
            ("outline", json!(outline)),
            ("draft", json!(draft)),
            ("final", json!(final_md)),
            ("quality", quality),
            ("revision", json!(revision)),
            ("word_count", word_count),
            ("revisions", json!(revision)),
        ],
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pyformat_unescapes_braces_and_substitutes() {
        let t = "a {topic} b {{lit}} c {slug}";
        let s = pyformat(t, &[("topic", "T"), ("slug", "S")]);
        assert_eq!(s, "a T b {lit} c S");
    }

    #[test]
    fn pyformat_keeps_xyflow_json_literal() {
        let out = pyformat(DRAFT_BODY, &[
            ("topic", "X"), ("slug", "y"),
            ("outline", "O"), ("research", "R"), ("style_sample", "Z"),
        ]);
        assert!(out.contains(r#"{"id": "user", "label": "User Query", "shape": "circle"}"#));
        assert!(out.contains(r#""label": "Agent\nNode""#));
        assert!(out.contains("Topic: X"));
        assert!(!out.contains("{topic}"));
    }

    #[test]
    fn check_quality_flags_thin_article() {
        let q = check_quality("no title here");
        assert_eq!(q["ok"], false);
        let issues = q["issues"].as_array().unwrap();
        assert!(issues.iter().any(|i| i.as_str().unwrap().starts_with("Too short:")));
        assert!(issues
            .iter()
            .any(|i| i.as_str().unwrap() == "Missing # title on first line"));
        assert!(issues.iter().any(|i| i
            .as_str()
            .unwrap()
            .contains("Use ```xyflow JSON fences, not ```mermaid.")));
    }

    #[test]
    fn check_quality_counts_blocks_and_refs() {
        let md = format!(
            "# Title\n\n## Mental Model\n\n## Runtime Internals\n\n## Three\n\n\
             [a](/x) [b](/y)\n```python\nx=1\n```\n{}",
            "```xyflow\n{}\n```\n".repeat(5)
        );
        let q = check_quality(&md);
        assert_eq!(q["crossRefs"], 2);
        assert_eq!(q["xyflowBlocks"], 5);
        assert!(q["codeBlocks"].as_u64().unwrap() >= 6);
    }
}
