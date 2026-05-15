# Dynamic Context Assembly: Runtime Composition for LLM Applications

Every LLM call is a function of its context. The quality of a model's response is bounded not by its weights but by the information assembled around the user's query at the moment of inference. Dynamic context assembly is the engineering discipline of composing that context at runtime -- pulling from multiple heterogeneous sources (RAG results, tool outputs, user state, system configuration, conversation history), ranking and filtering the material, fitting it within a token budget, and delivering a coherent prompt that maximizes the probability of a correct, grounded response.

Static prompts are a solved problem. The hard problem -- the one that determines whether production AI systems actually work -- is assembling the right context, from the right sources, in the right order, at the right time, for every single request. This article examines that problem end to end: the assembly pipeline architecture, source taxonomy, ranking strategies, template engines, context routing, multi-source retrieval patterns, tool result injection, the write-time versus read-time tradeoff, and the production infrastructure that ties it all together. For foundational concepts on context window mechanics and budget planning, see [Context Engineering](/context-engineering).

## The Assembly Pipeline

Dynamic context assembly follows a five-stage pipeline. Each stage is a distinct concern with its own failure modes and optimization surface:

```
                         Dynamic Context Assembly Pipeline

  ┌──────────┐    ┌──────────────┐    ┌──────────┐    ┌────────────┐    ┌──────────┐
  │  GATHER   │───>│ RANK/FILTER  │───>│  FORMAT  │───>│ BUDGET-FIT │───>│ ASSEMBLE │
  │  Sources  │    │  & Dedupe    │    │  & Adapt │    │  & Trim    │    │  Prompt  │
  └──────────┘    └──────────────┘    └──────────┘    └────────────┘    └──────────┘
       │                 │                  │                │                │
  Parallel fetch    Relevance score    Markdown/XML      Token count      Position
  from N sources    + dedup + prune    conversion        + truncation     + serialize
```

**Stage 1: Gather** -- Fetch candidate context from all relevant sources in parallel: vector search results, API calls, cached user state, system configuration, conversation history, and tool schemas.

**Stage 2: Rank and Filter** -- Score each piece of retrieved context for relevance to the current query. Deduplicate overlapping content. Apply freshness weighting and source priority rules. Discard anything below a relevance threshold.

**Stage 3: Format** -- Convert raw data from heterogeneous sources into a consistent format the model can parse effectively. This might mean converting database rows to markdown tables, API responses to structured summaries, or tool schemas to function definitions.

**Stage 4: Budget-Fit** -- Count tokens for each formatted context block. If the total exceeds the token budget, apply truncation strategies: trim low-priority blocks, summarize long sections, or drop entire sources in priority order.

**Stage 5: Assemble** -- Arrange the surviving context blocks into their final positions within the prompt. Apply positional strategy (critical information at the start and end, per the "lost in the middle" findings). Serialize into the final message array sent to the model.

### A Complete Pipeline in Python

```python
from dataclasses import dataclass, field
from enum import Enum
from typing import Any
import asyncio
import tiktoken

class SourceType(str, Enum):
    STATIC = "static"           # System prompts, tool schemas
    SEMI_STATIC = "semi_static" # User profile, preferences
    DYNAMIC = "dynamic"         # RAG results, API responses, tool outputs

class Priority(int, Enum):
    CRITICAL = 0    # System prompt -- never drop
    HIGH = 1        # User profile, active tool schemas
    MEDIUM = 2      # RAG results, conversation history
    LOW = 3         # Supplementary context, examples

@dataclass
class ContextBlock:
    source: str
    content: str
    source_type: SourceType
    priority: Priority
    relevance_score: float = 1.0
    token_count: int = 0
    metadata: dict[str, Any] = field(default_factory=dict)

class ContextAssembler:
    def __init__(self, model: str = "gpt-4o", max_tokens: int = 8000):
        self.encoder = tiktoken.encoding_for_model(model)
        self.max_tokens = max_tokens
        self.gatherers: list = []
        self.ranker = None
        self.formatter = None

    def count_tokens(self, text: str) -> int:
        return len(self.encoder.encode(text))

    async def gather(self, query: str, context: dict[str, Any]) -> list[ContextBlock]:
        """Stage 1: Parallel fetch from all registered sources."""
        tasks = [g.fetch(query, context) for g in self.gatherers]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        blocks = []
        for result in results:
            if isinstance(result, Exception):
                # Log but do not crash -- partial context is better than none
                continue
            blocks.extend(result)

        return blocks

    def rank_and_filter(
        self, blocks: list[ContextBlock], query: str
    ) -> list[ContextBlock]:
        """Stage 2: Score, deduplicate, prune."""
        if self.ranker:
            blocks = self.ranker.score(blocks, query)

        # Deduplicate by content hash
        seen_hashes: set[int] = set()
        unique_blocks = []
        for block in blocks:
            content_hash = hash(block.content.strip())
            if content_hash not in seen_hashes:
                seen_hashes.add(content_hash)
                unique_blocks.append(block)

        # Filter by minimum relevance threshold
        filtered = [b for b in unique_blocks if b.relevance_score >= 0.3]

        # Sort by priority first, then relevance score descending
        filtered.sort(key=lambda b: (b.priority.value, -b.relevance_score))
        return filtered

    def format_blocks(self, blocks: list[ContextBlock]) -> list[ContextBlock]:
        """Stage 3: Normalize content format."""
        for block in blocks:
            if self.formatter:
                block.content = self.formatter.format(block)
            block.token_count = self.count_tokens(block.content)
        return blocks

    def budget_fit(self, blocks: list[ContextBlock]) -> list[ContextBlock]:
        """Stage 4: Fit within token budget, dropping lowest priority first."""
        total = sum(b.token_count for b in blocks)

        if total <= self.max_tokens:
            return blocks

        # Drop from the tail (lowest priority, lowest relevance)
        fitted = []
        running_total = 0
        for block in blocks:
            if block.priority == Priority.CRITICAL:
                # Never drop critical blocks
                fitted.append(block)
                running_total += block.token_count
                continue

            if running_total + block.token_count <= self.max_tokens:
                fitted.append(block)
                running_total += block.token_count

        return fitted

    def assemble(self, blocks: list[ContextBlock]) -> list[dict[str, str]]:
        """Stage 5: Arrange into final prompt messages."""
        system_parts = []
        context_parts = []

        for block in blocks:
            if block.priority == Priority.CRITICAL:
                system_parts.append(block.content)
            else:
                context_parts.append(
                    f"<context source=\"{block.source}\">\n"
                    f"{block.content}\n"
                    f"</context>"
                )

        messages = []
        if system_parts:
            messages.append({
                "role": "system",
                "content": "\n\n".join(system_parts),
            })
        if context_parts:
            messages.append({
                "role": "system",
                "content": "## Retrieved Context\n\n"
                + "\n\n".join(context_parts),
            })

        return messages

    async def run(
        self, query: str, context: dict[str, Any]
    ) -> list[dict[str, str]]:
        """Execute the full pipeline."""
        blocks = await self.gather(query, context)
        blocks = self.rank_and_filter(blocks, query)
        blocks = self.format_blocks(blocks)
        blocks = self.budget_fit(blocks)
        return self.assemble(blocks)
```

This pipeline structure -- gather, rank, format, budget-fit, assemble -- is the backbone of every production context assembly system. The specific implementations at each stage vary by application, but the stages themselves are universal.

## Source Taxonomy

Not all context is created equal. Sources differ in volatility, retrieval cost, relevance to the current query, and the consequences of omitting them. A robust taxonomy helps you reason about these tradeoffs.

### Static Sources

Static context changes rarely -- on the order of application deploys, not per-request. It is precomputed, costs nothing to "retrieve" at runtime, and forms the bedrock of the prompt.

**System prompts**: The model's role definition, behavioral constraints, output format specifications, and guardrails. These are the most heavily tested context blocks in any application. Changes to system prompts should go through the same review process as code changes. See [Context Engineering](/context-engineering) for budget allocation heuristics.

**Tool schemas**: Function definitions, parameter types, and descriptions that enable tool use. For applications with many tools, the schema set itself becomes a context budget problem -- a system with 50 tools may spend 3,000-5,000 tokens on schemas alone. Strategies for managing this are covered in the context routing section below.

**Few-shot examples**: Pre-selected demonstrations of correct input-output pairs. While the examples themselves are static, which examples to include may be dynamically selected based on query similarity, making them semi-static in practice.

```python
class StaticSourceGatherer:
    """Loads precomputed, rarely-changing context."""

    def __init__(self, system_prompt: str, tool_schemas: list[dict]):
        self.system_prompt = system_prompt
        self.tool_schemas = tool_schemas

    async def fetch(
        self, query: str, context: dict
    ) -> list[ContextBlock]:
        blocks = [
            ContextBlock(
                source="system_prompt",
                content=self.system_prompt,
                source_type=SourceType.STATIC,
                priority=Priority.CRITICAL,
            ),
        ]

        # Only include tool schemas if tools are enabled for this request
        if context.get("tools_enabled", True):
            schema_text = self._format_tool_schemas(self.tool_schemas)
            blocks.append(ContextBlock(
                source="tool_schemas",
                content=schema_text,
                source_type=SourceType.STATIC,
                priority=Priority.HIGH,
            ))

        return blocks

    def _format_tool_schemas(self, schemas: list[dict]) -> str:
        lines = ["## Available Tools\n"]
        for schema in schemas:
            lines.append(f"### {schema['name']}")
            lines.append(f"{schema['description']}")
            lines.append(f"Parameters: {schema['parameters']}\n")
        return "\n".join(lines)
```

### Semi-Static Sources

Semi-static context changes per-session or per-user but not per-request. It can be cached aggressively -- typically loaded once when a session begins and refreshed periodically.

**User profile**: Name, role, organization, timezone, language preferences. This information personalizes the model's responses without requiring per-query retrieval.

**User preferences**: Output format preferences (verbose vs. concise, technical vs. simplified), domain-specific settings (preferred programming language, framework), and interaction history summaries.

**Session state**: The accumulated state of a multi-turn conversation -- not the raw message history (which is dynamic) but derived state like "the user is working on a Python FastAPI project" or "we are debugging a database connection issue."

**Application configuration**: Feature flags, tenant-specific settings, model routing rules. These may change between deploys but are constant within a single request's lifecycle.

```python
class UserContextGatherer:
    """Loads user-scoped, session-cached context."""

    def __init__(self, user_service, cache):
        self.user_service = user_service
        self.cache = cache

    async def fetch(
        self, query: str, context: dict
    ) -> list[ContextBlock]:
        user_id = context.get("user_id")
        if not user_id:
            return []

        # Check cache first -- user profile changes rarely
        cache_key = f"user_context:{user_id}"
        cached = await self.cache.get(cache_key)
        if cached:
            return cached

        profile = await self.user_service.get_profile(user_id)
        preferences = await self.user_service.get_preferences(user_id)

        blocks = [
            ContextBlock(
                source="user_profile",
                content=(
                    f"User: {profile.name}\n"
                    f"Role: {profile.role}\n"
                    f"Organization: {profile.org}\n"
                    f"Timezone: {profile.timezone}"
                ),
                source_type=SourceType.SEMI_STATIC,
                priority=Priority.HIGH,
                metadata={"user_id": user_id},
            ),
        ]

        if preferences:
            blocks.append(ContextBlock(
                source="user_preferences",
                content=f"Preferences: {preferences.to_prompt_text()}",
                source_type=SourceType.SEMI_STATIC,
                priority=Priority.MEDIUM,
            ))

        await self.cache.set(cache_key, blocks, ttl=300)  # 5 min cache
        return blocks
```

### Dynamic Sources

Dynamic context is the most expensive and the most valuable. It is retrieved fresh for every request, and its relevance to the current query is what separates a generic response from a grounded one.

**RAG results**: Documents or document chunks retrieved from a vector database, keyword index, or hybrid search system based on the user's current query. The quality of RAG results depends on the full retrieval pipeline -- embedding model, chunking strategy, search algorithm, and reranking. See [Retrieval Strategies](/retrieval-strategies) and [Advanced RAG](/advanced-rag) for detailed treatment.

**API responses**: Live data fetched from external services: current stock prices, weather, order status, database query results. These responses are inherently ephemeral and cannot be cached for long.

**Tool outputs**: Results from tool calls in previous turns of the conversation. A code execution result, a search engine response, or a database query output all need to be formatted and injected into context for the model to reason over.

**Conversation history**: The raw message history of the current conversation. For long conversations, this is the fastest-growing context source and the most common cause of context window exhaustion. Strategies include sliding window truncation, summarization of older turns, and selective retention of turns containing key decisions.

```python
class RAGGatherer:
    """Retrieves and scores relevant documents for the current query."""

    def __init__(self, vector_store, reranker=None, top_k: int = 5):
        self.vector_store = vector_store
        self.reranker = reranker
        self.top_k = top_k

    async def fetch(
        self, query: str, context: dict
    ) -> list[ContextBlock]:
        # Initial retrieval -- cast a wide net
        candidates = await self.vector_store.similarity_search(
            query, k=self.top_k * 3
        )

        # Rerank if available
        if self.reranker:
            candidates = await self.reranker.rerank(query, candidates)
            candidates = candidates[: self.top_k]
        else:
            candidates = candidates[: self.top_k]

        blocks = []
        for doc in candidates:
            blocks.append(ContextBlock(
                source=f"rag:{doc.metadata.get('source', 'unknown')}",
                content=doc.page_content,
                source_type=SourceType.DYNAMIC,
                priority=Priority.MEDIUM,
                relevance_score=doc.metadata.get("score", 0.5),
                metadata={
                    "doc_id": doc.metadata.get("id"),
                    "chunk_index": doc.metadata.get("chunk_index"),
                    "source_url": doc.metadata.get("url"),
                },
            ))

        return blocks
```

### Source Interaction Diagram

The following diagram shows how the three source categories interact with the assembly pipeline, including their typical cache behaviors:

```
                          Source Categories
  ┌───────────────────┬───────────────────┬───────────────────┐
  │     STATIC        │   SEMI-STATIC     │     DYNAMIC       │
  │                   │                   │                   │
  │  System Prompt    │  User Profile     │  RAG Results      │
  │  Tool Schemas     │  Preferences      │  API Responses    │
  │  Few-shot Pool    │  Session State    │  Tool Outputs     │
  │  Guardrails       │  App Config       │  Conv. History    │
  │                   │                   │                   │
  │  Cache: deploy    │  Cache: session   │  Cache: none/ttl  │
  │  Cost: ~0         │  Cost: low        │  Cost: high       │
  │  Volatility: none │  Volatility: low  │  Volatility: high │
  └────────┬──────────┴────────┬──────────┴────────┬──────────┘
           │                   │                   │
           └───────────────────┼───────────────────┘
                               │
                       ┌───────▼───────┐
                       │   ASSEMBLER   │
                       │  (per-request) │
                       └───────────────┘
```

## Ranking and Filtering

The ranking stage is where signal is separated from noise. Feeding the model every retrieved document, every prior message, and every tool schema available is the fastest path to degraded performance. Effective ranking requires multiple scoring dimensions.

### Relevance Scoring

The primary axis: how closely does this context block relate to the current query? For RAG results, this comes directly from the retrieval pipeline (vector similarity score, reranker score, BM25 score). For other sources, relevance scoring requires different strategies:

```python
from typing import Protocol

class RelevanceScorer(Protocol):
    async def score(
        self, blocks: list[ContextBlock], query: str
    ) -> list[ContextBlock]:
        ...

class HybridRelevanceScorer:
    """Combines embedding similarity with keyword overlap."""

    def __init__(self, embedding_model, keyword_weight: float = 0.3):
        self.embedding_model = embedding_model
        self.keyword_weight = keyword_weight

    async def score(
        self, blocks: list[ContextBlock], query: str
    ) -> list[ContextBlock]:
        query_embedding = await self.embedding_model.embed(query)
        query_terms = set(query.lower().split())

        for block in blocks:
            # Skip blocks that already have retrieval scores
            if block.source.startswith("rag:"):
                continue

            # Semantic similarity
            block_embedding = await self.embedding_model.embed(block.content)
            semantic_score = cosine_similarity(query_embedding, block_embedding)

            # Keyword overlap (Jaccard-like)
            block_terms = set(block.content.lower().split())
            overlap = len(query_terms & block_terms)
            keyword_score = overlap / max(len(query_terms), 1)

            block.relevance_score = (
                (1 - self.keyword_weight) * semantic_score
                + self.keyword_weight * keyword_score
            )

        return blocks
```

### Deduplication

When multiple sources return overlapping content -- a RAG result that substantially overlaps with a previous tool output, or two document chunks from the same source -- deduplication prevents wasting tokens on redundant information.

Simple hash-based deduplication catches exact duplicates. For near-duplicate detection, use MinHash or simhash:

```python
from datasketch import MinHash, MinHashLSH

class SemanticDeduplicator:
    """Remove near-duplicate context blocks using MinHash LSH."""

    def __init__(self, threshold: float = 0.7, num_perm: int = 128):
        self.threshold = threshold
        self.num_perm = num_perm

    def deduplicate(self, blocks: list[ContextBlock]) -> list[ContextBlock]:
        lsh = MinHashLSH(threshold=self.threshold, num_perm=self.num_perm)
        unique_blocks = []

        for i, block in enumerate(blocks):
            mh = MinHash(num_perm=self.num_perm)
            # Shingle the content into 3-word windows
            words = block.content.lower().split()
            for j in range(len(words) - 2):
                shingle = " ".join(words[j : j + 3])
                mh.update(shingle.encode("utf-8"))

            key = f"block_{i}"
            # Check if a near-duplicate already exists
            if not lsh.query(mh):
                lsh.insert(key, mh)
                unique_blocks.append(block)

        return unique_blocks
```

### Freshness Weighting

For applications where temporal recency matters -- news, support tickets, changelog entries -- freshness should influence ranking. A common pattern is exponential decay:

```python
import math
from datetime import datetime, timezone

def freshness_weight(
    created_at: datetime,
    half_life_hours: float = 24.0,
    now: datetime | None = None,
) -> float:
    """Exponential decay weight based on content age.

    A document created `half_life_hours` ago receives weight 0.5.
    A document created 2 * half_life_hours ago receives weight 0.25.
    """
    now = now or datetime.now(timezone.utc)
    age_hours = (now - created_at).total_seconds() / 3600
    return math.exp(-math.log(2) * age_hours / half_life_hours)

def apply_freshness(
    blocks: list[ContextBlock], half_life_hours: float = 24.0
) -> list[ContextBlock]:
    for block in blocks:
        created_at = block.metadata.get("created_at")
        if created_at:
            weight = freshness_weight(created_at, half_life_hours)
            block.relevance_score *= weight
    return blocks
```

### Source Priority Rules

Different applications assign different priority hierarchies. An enterprise knowledge assistant might prioritize internal documentation over web search results. A coding assistant might prioritize the user's own codebase over generic documentation. Source priority acts as a tiebreaker when relevance scores are close and as a hard constraint when budget is tight:

```
Priority Resolution Order:

1. CRITICAL (never dropped)
   - System prompt
   - Safety guardrails

2. HIGH (dropped only under extreme budget pressure)
   - Active tool schemas (tools the model is likely to call)
   - User profile / session state

3. MEDIUM (standard relevance-based ranking)
   - RAG results from primary knowledge base
   - Recent conversation history (last 3-5 turns)

4. LOW (first to be dropped)
   - RAG results from supplementary sources
   - Older conversation history
   - Background examples
   - Inactive tool schemas
```

## Template Engines and Prompt Builders

The formatting and assembly stages benefit from structured templating. Hardcoded string concatenation works for simple prompts but becomes unmanageable as context complexity grows.

### Jinja2 Templates (Python)

Jinja2 is the most widely used template engine for prompt construction in Python. Its conditional blocks, loops, and filters map naturally to dynamic context assembly:

```python
from jinja2 import Environment, BaseLoader

PROMPT_TEMPLATE = """
You are {{ role }}.

{% if guidelines %}
## Guidelines
{% for guideline in guidelines %}
- {{ guideline }}
{% endfor %}
{% endif %}

{% if context_blocks %}
## Retrieved Context
{% for block in context_blocks %}
<context source="{{ block.source }}" relevance="{{ '%.2f'|format(block.relevance_score) }}">
{{ block.content }}
</context>
{% endfor %}
{% endif %}

{% if conversation_history %}
## Conversation History
{% for msg in conversation_history[-max_history_turns:] %}
{{ msg.role }}: {{ msg.content }}
{% endfor %}
{% endif %}

{% if tools %}
## Available Tools
{% for tool in tools %}
### {{ tool.name }}
{{ tool.description }}
Parameters: {{ tool.parameters | tojson }}
{% endfor %}
{% endif %}

## Current Request
{{ user_query }}
""".strip()


class JinjaPromptBuilder:
    def __init__(self):
        self.env = Environment(loader=BaseLoader())

    def build(
        self,
        role: str,
        guidelines: list[str],
        context_blocks: list[ContextBlock],
        conversation_history: list[dict],
        tools: list[dict],
        user_query: str,
        max_history_turns: int = 5,
    ) -> str:
        template = self.env.from_string(PROMPT_TEMPLATE)
        return template.render(
            role=role,
            guidelines=guidelines,
            context_blocks=context_blocks,
            conversation_history=conversation_history,
            tools=tools,
            user_query=user_query,
            max_history_turns=max_history_turns,
        )
```

### Programmatic Builders (TypeScript)

In TypeScript applications, a builder pattern with method chaining provides type safety and IDE support that string templates cannot:

```typescript
interface ContextBlock {
  source: string;
  content: string;
  priority: number;
  relevanceScore: number;
  tokenCount: number;
}

interface AssembledPrompt {
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  totalTokens: number;
  droppedBlocks: ContextBlock[];
}

class PromptBuilder {
  private systemParts: string[] = [];
  private contextBlocks: ContextBlock[] = [];
  private history: Array<{ role: string; content: string }> = [];
  private userQuery = "";
  private maxTokens: number;

  constructor(maxTokens: number = 8000) {
    this.maxTokens = maxTokens;
  }

  system(text: string): this {
    this.systemParts.push(text);
    return this;
  }

  context(blocks: ContextBlock[]): this {
    this.contextBlocks.push(...blocks);
    return this;
  }

  conversationHistory(
    messages: Array<{ role: string; content: string }>
  ): this {
    this.history = messages;
    return this;
  }

  query(text: string): this {
    this.userQuery = text;
    return this;
  }

  build(): AssembledPrompt {
    // Sort by priority (ascending) then relevance (descending)
    const sorted = [...this.contextBlocks].sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return b.relevanceScore - a.relevanceScore;
    });

    const included: ContextBlock[] = [];
    const dropped: ContextBlock[] = [];
    let tokenBudget = this.maxTokens;

    // Reserve space for system prompt and user query
    const systemText = this.systemParts.join("\n\n");
    const systemTokens = estimateTokens(systemText);
    const queryTokens = estimateTokens(this.userQuery);
    tokenBudget -= systemTokens + queryTokens;

    // Fit context blocks within remaining budget
    for (const block of sorted) {
      if (block.tokenCount <= tokenBudget) {
        included.push(block);
        tokenBudget -= block.tokenCount;
      } else {
        dropped.push(block);
      }
    }

    // Build messages array
    const messages: AssembledPrompt["messages"] = [];

    if (systemText) {
      let content = systemText;
      if (included.length > 0) {
        const contextSection = included
          .map(
            (b) =>
              `<context source="${b.source}">\n${b.content}\n</context>`
          )
          .join("\n\n");
        content += `\n\n## Retrieved Context\n\n${contextSection}`;
      }
      messages.push({ role: "system", content });
    }

    // Add conversation history
    for (const msg of this.history) {
      messages.push({
        role: msg.role as "user" | "assistant",
        content: msg.content,
      });
    }

    // Add current query
    messages.push({ role: "user", content: this.userQuery });

    return {
      messages,
      totalTokens: this.maxTokens - tokenBudget,
      droppedBlocks: dropped,
    };
  }
}

function estimateTokens(text: string): number {
  // Rough estimate: 1 token per 4 characters for English
  return Math.ceil(text.length / 4);
}
```

### XML Tags vs. Markdown Headers

A critical formatting decision is how to delimit context sections. Two dominant patterns exist:

**XML tags** -- Used by Anthropic's Claude and adopted widely. XML tags provide unambiguous boundaries and support attributes for metadata:

```
<context source="knowledge_base" relevance="0.92">
PostgreSQL supports JSONB columns with GIN indexes for efficient
containment queries using the @> operator.
</context>
```

**Markdown headers** -- Used by many OpenAI-based systems. More natural to read but boundaries are implicit:

```
## Knowledge Base Result (relevance: 0.92)

PostgreSQL supports JSONB columns with GIN indexes for efficient
containment queries using the @> operator.
```

In practice, XML tags produce more reliable context boundary detection by models, particularly when context blocks are long or contain their own markdown formatting. The recommendation is to use XML tags for context block delimiters and markdown for structure within blocks.

## Context Routing

Not every query needs the same context strategy. A factual question ("What is the default port for PostgreSQL?") needs different context from a creative task ("Write a marketing email for our new product") or a code generation task ("Implement a rate limiter in Go"). Context routing selects the appropriate assembly strategy based on query classification.

### Router Architecture

```
                           Context Router

                        ┌──────────────┐
              ┌─────────│ Query Classifier │─────────┐
              │         └──────────────┘         │
              │                │                 │
              ▼                ▼                 ▼
     ┌────────────┐   ┌────────────┐   ┌────────────┐
     │  FACTUAL   │   │  CREATIVE  │   │    CODE    │
     │  Strategy  │   │  Strategy  │   │  Strategy  │
     ├────────────┤   ├────────────┤   ├────────────┤
     │ RAG: heavy │   │ RAG: light │   │ RAG: heavy │
     │ Tools: few │   │ Tools: none│   │ Tools: many│
     │ History:   │   │ History:   │   │ History:   │
     │   minimal  │   │   full     │   │   recent   │
     │ Examples:  │   │ Examples:  │   │ Examples:  │
     │   citation │   │   style    │   │   code     │
     └────────────┘   └────────────┘   └────────────┘
```

```python
from enum import Enum
from pydantic import BaseModel

class QueryCategory(str, Enum):
    FACTUAL = "factual"
    CREATIVE = "creative"
    CODE = "code"
    ANALYTICAL = "analytical"
    CONVERSATIONAL = "conversational"

class ContextStrategy(BaseModel):
    """Defines how context is assembled for a query category."""
    rag_enabled: bool = True
    rag_top_k: int = 5
    tools_enabled: bool = True
    tool_filter: list[str] | None = None  # None = all tools
    max_history_turns: int = 5
    include_examples: bool = False
    example_type: str | None = None
    token_budget: int = 8000

# Strategy registry
STRATEGIES: dict[QueryCategory, ContextStrategy] = {
    QueryCategory.FACTUAL: ContextStrategy(
        rag_enabled=True,
        rag_top_k=8,           # More documents for factual grounding
        tools_enabled=False,    # No tools needed for fact lookup
        max_history_turns=2,    # Minimal history
        include_examples=True,
        example_type="citation",
        token_budget=6000,
    ),
    QueryCategory.CREATIVE: ContextStrategy(
        rag_enabled=False,      # Minimal retrieval for creative tasks
        tools_enabled=False,
        max_history_turns=10,   # Full history for creative continuity
        include_examples=True,
        example_type="style",
        token_budget=4000,      # More output budget for generation
    ),
    QueryCategory.CODE: ContextStrategy(
        rag_enabled=True,
        rag_top_k=5,
        tools_enabled=True,
        tool_filter=["execute_code", "search_codebase", "read_file"],
        max_history_turns=5,
        include_examples=True,
        example_type="code",
        token_budget=10000,     # Code tasks need more context
    ),
    QueryCategory.ANALYTICAL: ContextStrategy(
        rag_enabled=True,
        rag_top_k=10,
        tools_enabled=True,
        tool_filter=["query_database", "run_calculation"],
        max_history_turns=3,
        token_budget=8000,
    ),
    QueryCategory.CONVERSATIONAL: ContextStrategy(
        rag_enabled=False,
        tools_enabled=False,
        max_history_turns=15,   # Heavy history for conversational
        token_budget=4000,
    ),
}

class ContextRouter:
    def __init__(self, classifier, strategies=STRATEGIES):
        self.classifier = classifier
        self.strategies = strategies

    async def route(self, query: str) -> ContextStrategy:
        category = await self.classifier.classify(query)
        return self.strategies.get(
            category,
            ContextStrategy()  # Fallback to defaults
        )
```

### Adaptive Strategy Selection

For more sophisticated routing, use the model itself to classify the query and select a strategy. This is a classic case of "cheap model for routing, expensive model for generation" -- see [Production Patterns](/production-patterns) for the router pattern in detail:

```python
async def classify_query(query: str, client) -> QueryCategory:
    """Use a small, fast model to classify the query type."""
    response = await client.chat.completions.create(
        model="gpt-4o-mini",  # Fast, cheap classifier
        messages=[
            {
                "role": "system",
                "content": (
                    "Classify the user's query into exactly one category: "
                    "factual, creative, code, analytical, conversational. "
                    "Respond with only the category name."
                ),
            },
            {"role": "user", "content": query},
        ],
        max_tokens=10,
        temperature=0,
    )
    category_str = response.choices[0].message.content.strip().lower()
    try:
        return QueryCategory(category_str)
    except ValueError:
        return QueryCategory.CONVERSATIONAL  # Safe default
```

## Multi-Source Retrieval Patterns

Production systems rarely query a single knowledge base. A customer support agent might search product documentation, past support tickets, the customer's order history, and a FAQ database simultaneously. Coordinating multiple retrieval sources is a core challenge.

### Parallel Fetch

The simplest pattern: fire all retrieval calls concurrently and merge results. Latency is bounded by the slowest source rather than the sum of all sources.

```python
import asyncio
from typing import Any

async def parallel_fetch(
    query: str,
    sources: list[dict[str, Any]],
    timeout: float = 3.0,
) -> list[ContextBlock]:
    """Fetch from multiple sources in parallel with timeout."""

    async def fetch_with_timeout(source):
        try:
            return await asyncio.wait_for(
                source["fetcher"].fetch(query),
                timeout=timeout,
            )
        except asyncio.TimeoutError:
            # Source timed out -- return empty rather than crash
            return []
        except Exception:
            # Source failed -- degrade gracefully
            return []

    tasks = [fetch_with_timeout(s) for s in sources]
    results = await asyncio.gather(*tasks)

    # Flatten and tag with source metadata
    blocks = []
    for source, result in zip(sources, results):
        for block in result:
            block.metadata["retrieval_source"] = source["name"]
            blocks.append(block)

    return blocks
```

### Cascading Retrieval

When you need high-precision results but want to avoid unnecessary API calls, cascading retrieval tries sources in priority order and stops when enough results are found:

```python
async def cascading_fetch(
    query: str,
    sources: list[dict],      # Ordered by priority
    min_results: int = 3,
    min_relevance: float = 0.7,
) -> list[ContextBlock]:
    """Try sources in order, stopping when we have enough good results."""
    all_blocks = []

    for source in sources:
        try:
            blocks = await source["fetcher"].fetch(query)
            high_quality = [
                b for b in blocks if b.relevance_score >= min_relevance
            ]
            all_blocks.extend(high_quality)

            if len(all_blocks) >= min_results:
                break  # We have enough good results
        except Exception:
            continue  # Try next source

    return all_blocks
```

This pattern is particularly effective when you have a fast, high-quality primary source (like a curated FAQ) and slower, broader secondary sources (like a full document index). Many queries are answered by the FAQ alone, and the document index is only consulted when the FAQ falls short.

### Federated Search

For organizations with multiple knowledge bases managed by different teams, federated search sends the query to all sources, normalizes the scores across sources, and merges the results:

```python
class FederatedSearcher:
    """Search across multiple knowledge bases with score normalization."""

    def __init__(self, sources: dict[str, Any]):
        self.sources = sources

    async def search(
        self, query: str, top_k: int = 10
    ) -> list[ContextBlock]:
        # Fetch from all sources in parallel
        tasks = {
            name: source.search(query, k=top_k)
            for name, source in self.sources.items()
        }
        raw_results = {}
        for name, task in tasks.items():
            try:
                raw_results[name] = await task
            except Exception:
                raw_results[name] = []

        # Normalize scores within each source to [0, 1]
        normalized_blocks = []
        for name, blocks in raw_results.items():
            if not blocks:
                continue

            scores = [b.relevance_score for b in blocks]
            min_score = min(scores)
            max_score = max(scores)
            score_range = max_score - min_score

            for block in blocks:
                if score_range > 0:
                    block.relevance_score = (
                        (block.relevance_score - min_score) / score_range
                    )
                else:
                    block.relevance_score = 1.0

                block.metadata["federation_source"] = name
                normalized_blocks.append(block)

        # Sort by normalized score and return top_k
        normalized_blocks.sort(
            key=lambda b: b.relevance_score, reverse=True
        )
        return normalized_blocks[:top_k]
```

The normalization step is essential. Different retrieval systems produce scores on different scales: cosine similarity ranges from -1 to 1, BM25 scores are unbounded, and reranker scores might be logits. Without normalization, one source's scores can dominate the merged ranking regardless of actual relevance.

## Tool Result Injection

When an LLM calls a tool, the tool's output must be injected back into the context for the next reasoning step. This injection is itself a context assembly problem: tool outputs vary wildly in size and format, and naive injection can consume the entire context budget.

### Formatting Tool Outputs

Raw tool outputs are rarely prompt-ready. A database query might return 500 rows. An API response might include deeply nested JSON with irrelevant fields. A code execution result might include verbose stack traces. The formatting layer transforms these into context-efficient representations:

```python
class ToolOutputFormatter:
    """Format tool outputs for context injection."""

    MAX_TABLE_ROWS = 20
    MAX_JSON_DEPTH = 3
    MAX_OUTPUT_TOKENS = 1500

    def format(self, tool_name: str, raw_output: Any) -> str:
        if tool_name == "query_database":
            return self._format_db_result(raw_output)
        elif tool_name == "execute_code":
            return self._format_code_result(raw_output)
        elif tool_name == "search_web":
            return self._format_search_results(raw_output)
        else:
            return self._format_generic(raw_output)

    def _format_db_result(self, result: dict) -> str:
        rows = result.get("rows", [])
        columns = result.get("columns", [])

        if not rows:
            return "Query returned no results."

        # Truncate to max rows
        truncated = len(rows) > self.MAX_TABLE_ROWS
        display_rows = rows[: self.MAX_TABLE_ROWS]

        # Format as markdown table
        header = "| " + " | ".join(columns) + " |"
        separator = "| " + " | ".join(["---"] * len(columns)) + " |"
        body = "\n".join(
            "| " + " | ".join(str(v) for v in row) + " |"
            for row in display_rows
        )

        table = f"{header}\n{separator}\n{body}"

        if truncated:
            table += f"\n\n*Showing {self.MAX_TABLE_ROWS} of {len(rows)} rows.*"

        return table

    def _format_code_result(self, result: dict) -> str:
        output = result.get("stdout", "")
        error = result.get("stderr", "")
        exit_code = result.get("exit_code", 0)

        parts = []
        if output:
            # Truncate very long outputs
            if len(output) > 2000:
                output = output[:1000] + "\n...[truncated]...\n" + output[-500:]
            parts.append(f"Output:\n```\n{output}\n```")

        if error:
            parts.append(f"Errors:\n```\n{error}\n```")

        if exit_code != 0:
            parts.append(f"Exit code: {exit_code}")

        return "\n\n".join(parts) if parts else "No output."

    def _format_search_results(self, results: list[dict]) -> str:
        formatted = []
        for i, result in enumerate(results[:5], 1):
            formatted.append(
                f"{i}. **{result['title']}**\n"
                f"   {result['snippet']}\n"
                f"   Source: {result['url']}"
            )
        return "\n\n".join(formatted)

    def _format_generic(self, output: Any) -> str:
        if isinstance(output, str):
            text = output
        else:
            text = json.dumps(output, indent=2, default=str)

        if len(text) > 3000:
            text = text[:1500] + "\n...[truncated]...\n" + text[-1000:]

        return text
```

### Handling Large Tool Responses

When a tool returns data that exceeds the context budget -- a large file, a verbose API response, or a long database result set -- you have several strategies:

**Truncation with summary**: Truncate the raw output but prepend a summary of the full result:

```python
async def summarize_and_truncate(
    tool_output: str,
    max_tokens: int,
    llm_client,
) -> str:
    """If tool output exceeds budget, summarize then include key details."""
    output_tokens = count_tokens(tool_output)

    if output_tokens <= max_tokens:
        return tool_output

    # Use a fast model to summarize
    summary = await llm_client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{
            "role": "system",
            "content": (
                "Summarize the following tool output concisely, "
                "preserving all key data points, numbers, and findings."
            ),
        }, {
            "role": "user",
            "content": tool_output[:8000],  # Feed what fits
        }],
        max_tokens=max_tokens // 2,
    )

    return (
        f"[Summary of full output ({output_tokens} tokens)]\n"
        f"{summary.choices[0].message.content}\n\n"
        f"[First portion of raw output]\n"
        f"{tool_output[:max_tokens // 4 * 4]}"  # Rough char estimate
    )
```

**Selective extraction**: For structured data, extract only the fields relevant to the current query:

```python
def extract_relevant_fields(
    data: dict, query: str, max_fields: int = 20
) -> dict:
    """Extract only the fields most likely relevant to the query."""
    query_terms = set(query.lower().split())

    def score_key(key: str) -> float:
        key_terms = set(key.lower().replace("_", " ").split())
        return len(query_terms & key_terms) / max(len(query_terms), 1)

    # Score and rank all fields
    scored = [(key, score_key(key), value) for key, value in flatten(data)]
    scored.sort(key=lambda x: x[1], reverse=True)

    # Return top fields
    return {key: value for key, _, value in scored[:max_fields]}
```

## Write-Time vs. Read-Time Context

A fundamental architectural choice is when context is prepared: at write time (when data enters the system) or at read time (when a query is processed).

### Write-Time Context (Pre-computed)

Write-time context is computed ahead of the query: document summaries generated during ingestion, entity extractions stored alongside raw documents, pre-built knowledge graph entries. The context is ready to serve instantly at query time.

```
Write-Time Pipeline:

  Document Ingested
        │
        ├──> Chunk + Embed           (for vector search)
        ├──> Extract Entities         (for structured queries)
        ├──> Generate Summary         (for context-efficient retrieval)
        ├──> Classify Topics          (for routing)
        └──> Compute Relationships    (for graph queries)
        │
        ▼
  Pre-computed Context Store
  (ready for instant retrieval)
```

**Advantages**:
- Zero latency at query time for the pre-computed artifacts
- Amortizes expensive LLM calls across many queries
- Enables offline quality verification of summaries and extractions
- Predictable query-time costs

**Disadvantages**:
- Staleness: pre-computed context may not reflect the most recent understanding
- Storage cost: every transformation adds to storage requirements
- Inflexibility: the pre-computed artifacts are query-agnostic -- they cannot be tailored to a specific question
- Recomputation cost: when the summarization model improves, all summaries must be regenerated

```python
class WriteTimeProcessor:
    """Pre-compute context artifacts at document ingestion time."""

    def __init__(self, llm_client, embedding_model, entity_extractor):
        self.llm = llm_client
        self.embedder = embedding_model
        self.extractor = entity_extractor

    async def process_document(self, doc: Document) -> ProcessedDocument:
        # Run all pre-computations in parallel
        summary_task = self._generate_summary(doc.content)
        entities_task = self._extract_entities(doc.content)
        embedding_task = self._embed_chunks(doc.chunks)
        topics_task = self._classify_topics(doc.content)

        summary, entities, embeddings, topics = await asyncio.gather(
            summary_task, entities_task, embedding_task, topics_task
        )

        return ProcessedDocument(
            id=doc.id,
            content=doc.content,
            chunks=doc.chunks,
            summary=summary,                  # Ready-to-serve summary
            entities=entities,                # Structured extractions
            chunk_embeddings=embeddings,      # Vector representations
            topics=topics,                    # Topic classifications
            processed_at=datetime.now(timezone.utc),
        )

    async def _generate_summary(self, content: str) -> str:
        response = await self.llm.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{
                "role": "system",
                "content": (
                    "Summarize this document in 2-3 sentences. "
                    "Focus on key facts, numbers, and conclusions."
                ),
            }, {
                "role": "user",
                "content": content[:6000],
            }],
            max_tokens=200,
        )
        return response.choices[0].message.content
```

### Read-Time Context (On-Demand)

Read-time context is assembled fresh for every query. The raw documents are retrieved and then transformed in the context of the specific question being asked.

```
Read-Time Pipeline:

  Query Received
        │
        ├──> Retrieve Raw Documents   (vector/keyword search)
        ├──> Query-Aware Summarize    (summarize w.r.t. query)
        ├──> Extract Query-Relevant   (pull only relevant facts)
        └──> Format for Context       (adapt to output format)
        │
        ▼
  Query-Specific Context
  (tailored to this exact request)
```

**Advantages**:
- Maximum relevance: every piece of context is selected and shaped for the specific query
- Always fresh: no staleness issues, always uses the latest data
- Flexible: can adapt to any query type without pre-computation
- No storage overhead for pre-computed artifacts

**Disadvantages**:
- Higher latency: summarization and extraction happen in the request path
- Higher cost: LLM calls for every query
- Variable quality: real-time summarization may produce inconsistent results under load
- Latency unpredictability: complex queries trigger more processing

```python
class ReadTimeAssembler:
    """Assemble context on-demand, tailored to the specific query."""

    def __init__(self, retriever, llm_client, max_context_tokens: int = 4000):
        self.retriever = retriever
        self.llm = llm_client
        self.max_context_tokens = max_context_tokens

    async def assemble(self, query: str) -> list[ContextBlock]:
        # Retrieve raw documents
        docs = await self.retriever.search(query, k=10)

        # Query-aware summarization: summarize each doc w.r.t. the query
        tasks = [
            self._query_aware_summarize(query, doc) for doc in docs
        ]
        summaries = await asyncio.gather(*tasks)

        blocks = []
        for doc, summary in zip(docs, summaries):
            blocks.append(ContextBlock(
                source=f"doc:{doc.id}",
                content=summary,
                source_type=SourceType.DYNAMIC,
                priority=Priority.MEDIUM,
                relevance_score=doc.score,
                metadata={"original_length": len(doc.content)},
            ))

        return blocks

    async def _query_aware_summarize(
        self, query: str, doc
    ) -> str:
        response = await self.llm.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{
                "role": "system",
                "content": (
                    "Extract the information from this document that is "
                    "most relevant to answering the user's question. "
                    "Be concise -- include only directly relevant facts."
                ),
            }, {
                "role": "user",
                "content": (
                    f"Question: {query}\n\n"
                    f"Document:\n{doc.content[:4000]}"
                ),
            }],
            max_tokens=300,
        )
        return response.choices[0].message.content
```

### The Hybrid Approach

Most production systems combine both strategies. Write-time processing handles the expensive, query-independent transformations (chunking, embedding, entity extraction), while read-time processing handles the query-specific work (re-ranking, query-aware summarization, context formatting):

```
Hybrid Pipeline:

  Write Time (ingestion):          Read Time (query):
  ┌─────────────────────┐         ┌─────────────────────────┐
  │ Chunk + Embed       │         │ Vector Search            │
  │ Extract Entities    │   ───>  │ Rerank w.r.t. Query     │
  │ Generate Summary    │         │ Query-Aware Filter       │
  │ Store Metadata      │         │ Format + Budget-Fit     │
  └─────────────────────┘         └─────────────────────────┘
                                         │
                                         ▼
                                  Assembled Context
```

This hybrid model gives you the latency benefits of pre-computation for the heavy operations while preserving query-specific tailoring for the final assembly.

## Production Patterns

### Context Assembly Middleware

In production systems, context assembly should be a middleware layer that sits between the application logic and the LLM API call. This separation enables testing, monitoring, and swapping assembly strategies without touching application code:

```typescript
// TypeScript middleware pattern for context assembly

type MiddlewareFn = (
  ctx: AssemblyContext,
  next: () => Promise<void>
) => Promise<void>;

interface AssemblyContext {
  query: string;
  userId: string;
  strategy: ContextStrategy;
  blocks: ContextBlock[];
  messages: Array<{ role: string; content: string }>;
  metadata: Record<string, unknown>;
}

class ContextPipeline {
  private middlewares: MiddlewareFn[] = [];

  use(fn: MiddlewareFn): this {
    this.middlewares.push(fn);
    return this;
  }

  async execute(ctx: AssemblyContext): Promise<AssemblyContext> {
    let index = 0;

    const next = async (): Promise<void> => {
      if (index < this.middlewares.length) {
        const middleware = this.middlewares[index++];
        await middleware(ctx, next);
      }
    };

    await next();
    return ctx;
  }
}

// Usage
const pipeline = new ContextPipeline()
  .use(routingMiddleware)         // Classify query, select strategy
  .use(userContextMiddleware)     // Load user profile + preferences
  .use(ragMiddleware)             // Retrieve relevant documents
  .use(historyMiddleware)         // Load conversation history
  .use(toolSchemaMiddleware)      // Include relevant tool schemas
  .use(rankingMiddleware)         // Score and rank all blocks
  .use(deduplicationMiddleware)   // Remove near-duplicates
  .use(budgetFitMiddleware)       // Fit within token budget
  .use(formattingMiddleware)      // Format into final messages
  .use(loggingMiddleware);        // Log assembly metrics

// Middleware example: RAG retrieval
const ragMiddleware: MiddlewareFn = async (ctx, next) => {
  if (ctx.strategy.ragEnabled) {
    const results = await vectorStore.search(ctx.query, {
      topK: ctx.strategy.ragTopK,
      filter: ctx.strategy.ragFilter,
    });

    for (const result of results) {
      ctx.blocks.push({
        source: `rag:${result.metadata.collection}`,
        content: result.content,
        priority: 2,
        relevanceScore: result.score,
        tokenCount: estimateTokens(result.content),
      });
    }
  }

  await next();
};
```

### A/B Testing Context Strategies

Context strategy changes are model behavior changes. They should be A/B tested with the same rigor as UI changes. The key metric is not just task completion but also context efficiency -- are you achieving the same quality with fewer tokens?

```python
import random
import hashlib
from dataclasses import dataclass

@dataclass
class Experiment:
    name: str
    control: ContextStrategy
    treatment: ContextStrategy
    traffic_pct: float = 0.1  # 10% of traffic gets treatment

class ContextExperimentRouter:
    """Route users to context strategy experiments."""

    def __init__(self, experiments: list[Experiment]):
        self.experiments = {e.name: e for e in experiments}

    def get_strategy(
        self, user_id: str, experiment_name: str
    ) -> tuple[ContextStrategy, str]:
        """Returns (strategy, variant) for a user in an experiment."""
        experiment = self.experiments[experiment_name]

        # Deterministic assignment based on user_id
        hash_val = hashlib.sha256(
            f"{user_id}:{experiment_name}".encode()
        ).hexdigest()
        bucket = int(hash_val[:8], 16) / 0xFFFFFFFF

        if bucket < experiment.traffic_pct:
            return experiment.treatment, "treatment"
        else:
            return experiment.control, "control"

# Example experiment: test whether query-aware summarization
# improves answer quality
experiment = Experiment(
    name="query_aware_summaries",
    control=ContextStrategy(
        rag_enabled=True,
        rag_top_k=5,
        token_budget=6000,
        # Control: return raw chunks
    ),
    treatment=ContextStrategy(
        rag_enabled=True,
        rag_top_k=5,
        token_budget=6000,
        # Treatment: query-aware summarization enabled
        post_retrieval_summarize=True,
    ),
    traffic_pct=0.2,  # 20% see treatment
)
```

### Monitoring Context Quality

You cannot improve what you do not measure. Context quality monitoring tracks several dimensions:

**Token utilization**: What fraction of the budget is actually used? Consistently low utilization suggests the pipeline is not finding enough relevant content. Consistently hitting the ceiling suggests the budget is too tight.

**Source distribution**: Which sources contribute to the final context? If RAG results are always being dropped in favor of conversation history, either your retrieval quality is low or your history management needs work.

**Relevance score distribution**: Are the final context blocks high-relevance or are you padding with low-quality content?

**Drop rate**: How many retrieved blocks are dropped during budget-fitting? A high drop rate means you are doing unnecessary work in the gather stage.

```python
import time
from dataclasses import dataclass, field

@dataclass
class AssemblyMetrics:
    """Metrics collected during a single context assembly."""
    timestamp: float = field(default_factory=time.time)
    query_category: str = ""
    total_gathered: int = 0
    total_after_ranking: int = 0
    total_after_budget: int = 0
    tokens_used: int = 0
    token_budget: int = 0
    budget_utilization: float = 0.0
    sources_contributing: list[str] = field(default_factory=list)
    dropped_blocks: int = 0
    avg_relevance_score: float = 0.0
    assembly_latency_ms: float = 0.0
    gather_latency_ms: float = 0.0
    rank_latency_ms: float = 0.0

class MetricsCollector:
    """Collects and exports context assembly metrics."""

    def __init__(self, exporter=None):
        self.exporter = exporter

    def record(self, metrics: AssemblyMetrics):
        # Compute derived metrics
        metrics.budget_utilization = (
            metrics.tokens_used / max(metrics.token_budget, 1)
        )
        metrics.dropped_blocks = (
            metrics.total_after_ranking - metrics.total_after_budget
        )

        if self.exporter:
            self.exporter.emit(metrics)

    def wrap_pipeline(self, assembler: ContextAssembler):
        """Decorator-style instrumentation of the assembly pipeline."""
        original_run = assembler.run

        async def instrumented_run(query, context):
            metrics = AssemblyMetrics()
            start = time.perf_counter()

            # Instrument gather
            t0 = time.perf_counter()
            blocks = await assembler.gather(query, context)
            metrics.gather_latency_ms = (time.perf_counter() - t0) * 1000
            metrics.total_gathered = len(blocks)

            # Instrument rank
            t0 = time.perf_counter()
            blocks = assembler.rank_and_filter(blocks, query)
            metrics.rank_latency_ms = (time.perf_counter() - t0) * 1000
            metrics.total_after_ranking = len(blocks)

            # Format
            blocks = assembler.format_blocks(blocks)

            # Budget fit
            blocks = assembler.budget_fit(blocks)
            metrics.total_after_budget = len(blocks)
            metrics.tokens_used = sum(b.token_count for b in blocks)
            metrics.token_budget = assembler.max_tokens

            # Track contributing sources
            metrics.sources_contributing = list(
                set(b.source for b in blocks)
            )
            if blocks:
                metrics.avg_relevance_score = sum(
                    b.relevance_score for b in blocks
                ) / len(blocks)

            # Assemble
            result = assembler.assemble(blocks)
            metrics.assembly_latency_ms = (
                (time.perf_counter() - start) * 1000
            )

            self.record(metrics)
            return result

        assembler.run = instrumented_run
        return assembler
```

### Context Caching

For applications with high request volume, caching assembled context for identical or similar queries reduces both latency and cost. The challenge is defining "similar enough" -- two queries might retrieve different RAG results but share the same user profile and tool schemas.

```python
import hashlib

class ContextCache:
    """Cache assembled context with configurable cache keys."""

    def __init__(self, store, ttl: int = 60):
        self.store = store
        self.ttl = ttl

    def cache_key(
        self,
        query: str,
        user_id: str,
        strategy_name: str,
    ) -> str:
        """Generate cache key from query + user + strategy."""
        raw = f"{query}:{user_id}:{strategy_name}"
        return hashlib.sha256(raw.encode()).hexdigest()

    async def get_or_assemble(
        self,
        query: str,
        user_id: str,
        strategy_name: str,
        assembler,
        context: dict,
    ) -> list[dict]:
        key = self.cache_key(query, user_id, strategy_name)

        cached = await self.store.get(key)
        if cached is not None:
            return cached

        result = await assembler.run(query, context)
        await self.store.set(key, result, ttl=self.ttl)
        return result
```

Be cautious with context caching. Cached context is by definition stale -- if the underlying data changes between cache set and cache hit, the model reasons over outdated information. Short TTLs (30-120 seconds) and cache invalidation on known data changes are essential.

## End-to-End Example: Customer Support Agent

Putting all the pieces together, here is how a production customer support agent assembles context for each query. This example demonstrates the full pipeline from query reception to final prompt:

```python
class SupportAgentContextAssembler:
    """Full context assembly for a customer support agent."""

    def __init__(self, config):
        self.assembler = ContextAssembler(
            model=config.model,
            max_tokens=config.max_context_tokens,
        )

        # Register gatherers
        self.assembler.gatherers = [
            StaticSourceGatherer(
                system_prompt=config.system_prompt,
                tool_schemas=config.tool_schemas,
            ),
            UserContextGatherer(
                user_service=config.user_service,
                cache=config.cache,
            ),
            RAGGatherer(
                vector_store=config.docs_vector_store,
                reranker=config.reranker,
                top_k=5,
            ),
            TicketHistoryGatherer(
                ticket_service=config.ticket_service,
                max_tickets=3,
            ),
            ConversationHistoryGatherer(
                max_turns=config.max_history_turns,
            ),
        ]

        # Configure ranker
        self.assembler.ranker = HybridRelevanceScorer(
            embedding_model=config.embedding_model,
        )

        # Configure formatter
        self.assembler.formatter = SupportContextFormatter()

        # Router
        self.router = ContextRouter(
            classifier=QueryClassifier(config.classifier_model),
        )

        # Metrics
        self.metrics = MetricsCollector(exporter=config.metrics_exporter)
        self.metrics.wrap_pipeline(self.assembler)

    async def handle_query(
        self,
        query: str,
        user_id: str,
        conversation_id: str,
    ) -> list[dict[str, str]]:
        # Step 1: Route to determine strategy
        strategy = await self.router.route(query)

        # Step 2: Build context dict for gatherers
        context = {
            "user_id": user_id,
            "conversation_id": conversation_id,
            "strategy": strategy,
            "tools_enabled": strategy.tools_enabled,
        }

        # Step 3: Run the assembly pipeline
        messages = await self.assembler.run(query, context)

        # Step 4: Append the user's query as the final message
        messages.append({"role": "user", "content": query})

        return messages
```

The assembled context for a typical support query might look like:

```
┌──────────────────────────────────────────────────────────┐
│ System Message                                           │
│                                                          │
│ You are a customer support agent for Acme Corp...        │
│ [system prompt: 400 tokens]                              │
│                                                          │
│ ## User Context                                          │
│ Name: Jane Smith | Plan: Enterprise | Since: 2023-01     │
│ Preferences: Technical, concise responses                │
│ [user context: 150 tokens]                               │
│                                                          │
│ ## Retrieved Context                                     │
│ <context source="docs" relevance="0.94">                 │
│   Billing FAQ: Enterprise plans are billed annually...   │
│ </context>                                               │
│ <context source="docs" relevance="0.87">                 │
│   Upgrade process: To upgrade from Pro to Enterprise...  │
│ </context>                                               │
│ <context source="tickets" relevance="0.81">              │
│   Previous ticket #4521: User asked about invoice...     │
│ </context>                                               │
│ [retrieved context: 2100 tokens]                         │
│                                                          │
│ ## Available Tools                                       │
│ - lookup_order(order_id) - Find order details            │
│ - create_ticket(subject, body) - Create support ticket   │
│ - escalate(reason) - Escalate to human agent             │
│ [tool schemas: 600 tokens]                               │
├──────────────────────────────────────────────────────────┤
│ Conversation History (last 3 turns)                      │
│ [history: 800 tokens]                                    │
├──────────────────────────────────────────────────────────┤
│ User: Can I get a refund for the unused months on my     │
│       annual plan?                                       │
│ [query: 20 tokens]                                       │
├──────────────────────────────────────────────────────────┤
│ Total: ~4070 tokens / 8000 budget (51% utilization)      │
└──────────────────────────────────────────────────────────┘
```

## Common Pitfalls

**Over-stuffing context**: The instinct is to include everything that might be relevant. Resist it. Every token of irrelevant context dilutes the model's attention on the tokens that matter. A focused 3,000-token context consistently outperforms a bloated 30,000-token context with 10% signal density.

**Ignoring position effects**: The "lost in the middle" phenomenon (Liu et al., 2023) is real and measurable. Place your most critical context at the very beginning of the system message and the user's query at the end. The middle is for supplementary material that is helpful but not essential.

**No graceful degradation**: When a context source fails (vector DB timeout, API error, empty retrieval results), the system should degrade gracefully -- serve a response with partial context rather than returning an error. The pipeline's error handling at the gather stage is not optional.

**Static token budgets**: A fixed 8,000-token budget might be right for 80% of queries but catastrophically wrong for the other 20%. Complex analytical queries might need 15,000 tokens of context. Simple FAQ lookups might need 2,000. Let the context router adjust budgets per query type.

**Skipping deduplication**: When you query multiple sources, duplicate or near-duplicate content is inevitable. Two different document chunks from the same source page, a RAG result that matches a tool output -- these waste tokens and can confuse the model by implying that the duplicated content is especially important.

**No monitoring**: Without metrics on token utilization, source distribution, drop rates, and assembly latency, you are flying blind. Context assembly bugs are insidious -- they don't crash the application, they just quietly degrade response quality.

## Connections to Other Topics

Dynamic context assembly is the runtime orchestration layer that ties together many of the concepts covered in this series:

- **Context engineering** ([Context Engineering](/context-engineering)): The theoretical foundation -- window mechanics, budget planning, positioning
- **Retrieval** ([Retrieval Strategies](/retrieval-strategies), [Advanced RAG](/advanced-rag)): The primary source of dynamic context -- how documents are found and ranked
- **Agent design** ([Agent Architectures](/agent-architectures)): Agents are the most complex context assembly problem -- tool results, multi-step reasoning, and evolving state all feed back into context
- **Production infrastructure** ([Production Patterns](/production-patterns)): Context assembly middleware, A/B testing, monitoring, and caching are production engineering concerns
- **Evaluation** ([RAG Evaluation](/rag-evaluation)): Measuring whether your assembled context actually helps the model produce better answers

The assembly pipeline is where these concerns converge. Getting it right -- building a system that reliably gathers the right information, filters the noise, fits the budget, and positions content for maximum model attention -- is the difference between an LLM application that works in demos and one that works in production.
