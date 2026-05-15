"""Article-generate graph: research → outline → draft → review → revise (loop) → done.

Input (all resolved by the caller — container has no filesystem access to the repo):
    slug, topic: identifier + human-readable topic name
    category: lesson category string
    related_topics: comma-separated related slugs (from catalog)
    existing_articles: markdown bullet list of existing articles (for cross-refs)
    style_sample: ~2000-char excerpt of an existing article (style reference)

Output:
    final: complete markdown article
    word_count, revisions: quality metrics
    quality: {ok, issues, wordCount, codeBlocks, crossRefs}

Ports apps/knowledge/src/mastra/workflows/generate-article.ts. Filesystem save
moved to the CLI wrapper since the container can't write to the repo.
"""

from __future__ import annotations

import re
from typing import Any

from langgraph.graph import END, START, StateGraph

from .llm import make_llm
from .state import ArticleGenerateState

MAX_REVISIONS = 2
MIN_WORD_COUNT = 1500
MIN_CODE_BLOCKS = 2
MIN_CROSS_REFS = 1
MIN_MERMAID_BLOCKS = 5

# Every article in this knowledge base teaches AI engineering EXCLUSIVELY through
# the Cloudflare Workers edge stack. This doctrine is prepended to every prompt so
# research, outline, draft, review and revision all stay on the edge. Keep it free
# of curly braces — these strings are consumed by str.format().
CLOUDFLARE_DOCTRINE = """[KNOWLEDGE BASE DOCTRINE — CLOUDFLARE WORKERS ONLY]
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

"""


RESEARCH_PROMPT = CLOUDFLARE_DOCTRINE + """You are a technical researcher preparing material for an AI engineering knowledge base article.

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
"""

OUTLINE_PROMPT = CLOUDFLARE_DOCTRINE + """You are an expert technical writer creating an outline for an AI engineering knowledge base article.

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
"""

DRAFT_PROMPT = CLOUDFLARE_DOCTRINE + """You are an expert AI engineer and technical writer. Write a comprehensive knowledge base article.

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
      {{"id": "agent", "label": "Agent\\nNode", "shape": "rect"}},
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
- Use `\\n` inside labels for line breaks.
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
"""

REVIEW_PROMPT = CLOUDFLARE_DOCTRINE + """You are a senior technical editor reviewing an AI engineering knowledge base article.

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
"""

REVISE_PROMPT = CLOUDFLARE_DOCTRINE + """You are an expert AI engineer and technical writer. An article you wrote failed quality checks.

Topic: {topic}

Current article:
{draft}

Issues to fix:
{issues}

Revise the article to address ALL listed issues. Maintain the existing structure and content but expand, add code examples, add cross-references, or restructure as needed.

Output the complete revised article (full markdown, starting with `# Title`).
"""


def check_quality(content: str) -> dict[str, Any]:
    words = [w for w in re.split(r"\s+", content) if w]
    word_count = len(words)
    code_blocks = len(re.findall(r"```\w+", content))
    cross_refs = len(re.findall(r"\]\(/[\w-]+\)", content))
    has_title = content.lstrip().startswith("# ")
    section_count = len(re.findall(r"^## ", content, flags=re.MULTILINE))
    xyflow_blocks = len(re.findall(r"```xyflow\b", content))
    mermaid_blocks = len(re.findall(r"```mermaid\b", content))
    has_mental_model = bool(re.search(r"^##\s+Mental Model\b", content, flags=re.MULTILINE))
    has_runtime_internals = bool(re.search(r"^##\s+Runtime Internals\b", content, flags=re.MULTILINE))

    issues: list[str] = []
    if word_count < MIN_WORD_COUNT:
        issues.append(f"Too short: {word_count} words (min {MIN_WORD_COUNT})")
    if code_blocks < MIN_CODE_BLOCKS:
        issues.append(f"Too few code examples: {code_blocks} (min {MIN_CODE_BLOCKS})")
    if cross_refs < MIN_CROSS_REFS:
        issues.append(f"Missing cross-references: {cross_refs} (min {MIN_CROSS_REFS})")
    if not has_title:
        issues.append("Missing # title on first line")
    if section_count < 3:
        issues.append("Fewer than 3 ## sections")
    if xyflow_blocks < MIN_MERMAID_BLOCKS:
        issues.append(
            f"Too few xyflow diagrams: {xyflow_blocks} (min {MIN_MERMAID_BLOCKS}). "
            "Use ```xyflow JSON fences, not ```mermaid."
        )
    if mermaid_blocks > 0:
        issues.append(
            f"Found {mermaid_blocks} ```mermaid block(s) — replace each with a ```xyflow JSON diagram."
        )
    if not has_mental_model:
        issues.append("Missing `## Mental Model` section (required as the second-level section before Core Concepts).")
    if not has_runtime_internals:
        issues.append("Missing `## Runtime Internals` deep-dive section.")

    return {
        "ok": len(issues) == 0,
        "issues": issues,
        "wordCount": word_count,
        "codeBlocks": code_blocks,
        "crossRefs": cross_refs,
        "xyflowBlocks": xyflow_blocks,
    }


async def _ask(llm, prompt: str) -> str:
    resp = await llm.ainvoke([{"role": "user", "content": prompt}])
    return str(resp.content)


async def research_node(state: ArticleGenerateState) -> dict:
    llm = make_llm()
    content = await _ask(
        llm,
        RESEARCH_PROMPT.format(
            topic=state.get("topic", ""),
            slug=state.get("slug", ""),
            related_topics=state.get("related_topics", ""),
        ),
    )
    return {"research": content}


async def outline_node(state: ArticleGenerateState) -> dict:
    llm = make_llm()
    content = await _ask(
        llm,
        OUTLINE_PROMPT.format(
            topic=state.get("topic", ""),
            slug=state.get("slug", ""),
            category=state.get("category", ""),
            research=state.get("research", ""),
            existing_articles=state.get("existing_articles", ""),
        ),
    )
    return {"outline": content}


async def draft_node(state: ArticleGenerateState) -> dict:
    llm = make_llm()
    content = await _ask(
        llm,
        DRAFT_PROMPT.format(
            topic=state.get("topic", ""),
            slug=state.get("slug", ""),
            outline=state.get("outline", ""),
            research=state.get("research", ""),
            style_sample=state.get("style_sample", ""),
        ),
    )
    return {"draft": content}


async def review_node(state: ArticleGenerateState) -> dict:
    llm = make_llm()
    final = await _ask(
        llm,
        REVIEW_PROMPT.format(topic=state.get("topic", ""), draft=state.get("draft", "")),
    )
    quality = check_quality(final)
    return {"final": final, "quality": quality, "revision": 0}


async def revise_node(state: ArticleGenerateState) -> dict:
    quality = state.get("quality") or {}
    if quality.get("ok"):
        return {}
    issues = "\n".join(f"- {i}" for i in quality.get("issues", []))
    llm = make_llm()
    revised = await _ask(
        llm,
        REVISE_PROMPT.format(
            topic=state.get("topic", ""),
            draft=state.get("final", ""),
            issues=issues,
        ),
    )
    new_quality = check_quality(revised)
    return {
        "final": revised,
        "quality": new_quality,
        "revision": int(state.get("revision", 0)) + 1,
    }


def _after_revise(state: ArticleGenerateState) -> str:
    quality = state.get("quality") or {}
    revision = int(state.get("revision", 0))
    if quality.get("ok") or revision >= MAX_REVISIONS:
        return "finalize"
    return "revise"


async def finalize_node(state: ArticleGenerateState) -> dict:
    quality = state.get("quality") or {}
    return {
        "word_count": int(quality.get("wordCount", 0)),
        "revisions": int(state.get("revision", 0)),
    }


def build_graph(checkpointer: Any = None) -> Any:
    builder = StateGraph(ArticleGenerateState)
    builder.add_node("research", research_node)
    builder.add_node("outline", outline_node)
    builder.add_node("draft", draft_node)
    builder.add_node("review", review_node)
    builder.add_node("revise", revise_node)
    builder.add_node("finalize", finalize_node)

    builder.add_edge(START, "research")
    builder.add_edge("research", "outline")
    builder.add_edge("outline", "draft")
    builder.add_edge("draft", "review")
    builder.add_conditional_edges(
        "review", _after_revise, {"revise": "revise", "finalize": "finalize"}
    )
    builder.add_conditional_edges(
        "revise", _after_revise, {"revise": "revise", "finalize": "finalize"}
    )
    builder.add_edge("finalize", END)
    return builder.compile(checkpointer=checkpointer)


graph = build_graph()
