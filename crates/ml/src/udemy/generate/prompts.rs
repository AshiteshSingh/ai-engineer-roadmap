//! Prompt templates — verbatim port of the Python
//! backend/knowledge_agent/article_generate_graph.py (lines 39-232), with the
//! xyflow JSON braces de-doubled (post-`str.format` form) and a `{grounding}`
//! block injected after the doctrine for research/outline/draft.

/// [KNOWLEDGE BASE DOCTRINE …] — prepended to every prompt (no tokens).
pub const CLOUDFLARE_DOCTRINE: &str = r#"[KNOWLEDGE BASE DOCTRINE — CLOUDFLARE WORKERS ONLY]
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

"#;

const RESEARCH_BODY: &str = r#"You are a technical researcher preparing material for an AI engineering knowledge base article.

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
"#;
const OUTLINE_BODY: &str = r#"You are an expert technical writer creating an outline for an AI engineering knowledge base article.

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
"#;
const DRAFT_BODY: &str = r#"You are an expert AI engineer and technical writer. Write a comprehensive knowledge base article.

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
  {
    "direction": "TD",
    "nodes": [
      {"id": "user", "label": "User Query", "shape": "circle"},
      {"id": "agent", "label": "Agent\nNode", "shape": "rect"},
      {"id": "decide", "label": "Has tool calls?", "shape": "diamond"},
      {"id": "tool", "label": "ToolNode", "shape": "rect"},
      {"id": "done", "label": "Response", "shape": "circle"}
    ],
    "edges": [
      {"source": "user", "target": "agent"},
      {"source": "agent", "target": "decide"},
      {"source": "decide", "target": "tool", "label": "yes"},
      {"source": "decide", "target": "done", "label": "no"},
      {"source": "tool", "target": "agent"}
    ]
  }
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
"#;
const REVIEW_BODY: &str = r#"You are a senior technical editor reviewing an AI engineering knowledge base article.

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
"#;
const REVISE_BODY: &str = r#"You are an expert AI engineer and technical writer. An article you wrote failed quality checks.

Topic: {topic}

Current article:
{draft}

Issues to fix:
{issues}

Revise the article to address ALL listed issues. Maintain the existing structure and content but expand, add code examples, add cross-references, or restructure as needed.

Output the complete revised article (full markdown, starting with `# Title`).
"#;

/// Replace only exact `{token}` occurrences for the given known tokens.
/// Unknown literal braces (the xyflow JSON example) are left untouched, and
/// substituted values are never re-scanned.
pub fn fill(template: &str, pairs: &[(&str, &str)]) -> String {
    let b = template.as_bytes();
    let mut out = String::with_capacity(template.len() + 4096);
    let mut i = 0usize;
    'outer: while i < template.len() {
        if b[i] == b'{' {
            let after = i + 1;
            for (tok, val) in pairs {
                let end = after + tok.len();
                if b[after..].starts_with(tok.as_bytes()) && b.get(end) == Some(&b'}') {
                    out.push_str(val);
                    i = end + 1;
                    continue 'outer;
                }
            }
        }
        let ch = template[i..].chars().next().unwrap();
        out.push(ch);
        i += ch.len_utf8();
    }
    out
}

fn doctrine_grounded(grounding: &str, body: &str) -> String {
    format!("{CLOUDFLARE_DOCTRINE}{grounding}\n\n{body}")
}

pub fn research_prompt(topic: &str, slug: &str, related: &str, grounding: &str) -> String {
    let body = fill(
        RESEARCH_BODY,
        &[("topic", topic), ("slug", slug), ("related_topics", related)],
    );
    doctrine_grounded(grounding, &body)
}

pub fn outline_prompt(
    topic: &str,
    slug: &str,
    category: &str,
    research: &str,
    existing_articles: &str,
    grounding: &str,
) -> String {
    let body = fill(
        OUTLINE_BODY,
        &[
            ("topic", topic),
            ("slug", slug),
            ("category", category),
            ("research", research),
            ("existing_articles", existing_articles),
        ],
    );
    doctrine_grounded(grounding, &body)
}

pub fn draft_prompt(
    topic: &str,
    slug: &str,
    outline: &str,
    research: &str,
    style_sample: &str,
    grounding: &str,
) -> String {
    let body = fill(
        DRAFT_BODY,
        &[
            ("topic", topic),
            ("slug", slug),
            ("outline", outline),
            ("research", research),
            ("style_sample", style_sample),
        ],
    );
    doctrine_grounded(grounding, &body)
}

pub fn review_prompt(topic: &str, draft: &str) -> String {
    let body = fill(REVIEW_BODY, &[("topic", topic), ("draft", draft)]);
    format!("{CLOUDFLARE_DOCTRINE}{body}")
}

pub fn revise_prompt(topic: &str, draft: &str, issues: &str) -> String {
    let body = fill(
        REVISE_BODY,
        &[("topic", topic), ("draft", draft), ("issues", issues)],
    );
    format!("{CLOUDFLARE_DOCTRINE}{body}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fill_replaces_known_tokens_only() {
        let t = "a {topic} b {slug} c {unknown} d";
        let out = fill(t, &[("topic", "X"), ("slug", "Y")]);
        assert_eq!(out, "a X b Y c {unknown} d");
    }

    #[test]
    fn draft_prompt_keeps_xyflow_json_braces() {
        let p = draft_prompt("T", "s", "OUT", "RES", "STY", "GROUND");
        assert!(p.contains("\"direction\": \"TD\""));
        assert!(p.contains("\"shape\": \"circle\""));
        assert!(!p.contains("{topic}") && !p.contains("{outline}"));
        assert!(p.starts_with("[KNOWLEDGE BASE DOCTRINE"));
        assert!(p.contains("GROUND"));
        assert!(p.contains("Topic: T"));
    }

    #[test]
    fn review_revise_have_no_grounding_and_fill_tokens() {
        let r = review_prompt("MyTopic", "DRAFT-BODY");
        assert!(r.contains("Topic: MyTopic") && r.contains("DRAFT-BODY"));
        assert!(!r.contains("{topic}") && !r.contains("{draft}"));
        let v = revise_prompt("MyTopic", "D", "- issue one");
        assert!(v.contains("- issue one") && !v.contains("{issues}"));
    }
}
