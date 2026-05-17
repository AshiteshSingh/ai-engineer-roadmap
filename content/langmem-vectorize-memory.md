# Long-Term Agent Memory with LangMem & Cloudflare Vectorize

Checkpointing remembers *this* conversation; it does not let an agent recall what a user told it last month. That requires **long-term memory**: durable, cross-thread knowledge an agent writes during one session and retrieves in another. LangMem is LangGraph's memory layer for exactly this — a typed store with semantic search — and on Cloudflare it is backed by [Vectorize](/vectorize-rag) for embeddings and [D1 checkpointing](/langgraph-d1-checkpointing) for the thread-scoped half. This lesson covers the memory taxonomy, the write and read paths, and consolidation. For the graph it plugs into see [LangGraph](/langgraph); for the underlying theory see [Agent Memory](/agent-memory) and [Memory Architectures](/memory-architectures).

## Mental Model

### What problem does it solve?

Conversation state lives in a thread's checkpoint and dies with that thread's relevance. But "the user prefers metric units", "this customer is on the enterprise plan", "last time we tried approach X and it failed" must outlive any single conversation and be retrievable by *meaning*, not by thread id. Long-term memory is a separate store, keyed by namespace (a user, an organization), holding facts the agent decides are worth keeping and recalls semantically when relevant. It is the difference between an assistant that re-introduces itself every session and one that knows you.

### The notebook analogy

A checkpoint is the agent's working scratchpad for the current task — wiped between tasks. Long-term memory is a notebook the agent keeps on a shelf, organized by person. After a meaningful exchange it jots a note. Before answering a new question it flips to the relevant pages — found not by page number but by topic. Over time it also tidies the notebook, merging duplicate notes and discarding stale ones. Vectorize is the index that makes "flip to the relevant pages" a similarity search instead of a linear scan.

### Writing a memory in ~10 lines

```python
from langmem import create_memory_store_manager

mem = create_memory_store_manager(store=vectorize_store, namespace=("user", "{user_id}"))

def remember(state):
    mem.put(
        key="pref-units",
        value={"fact": "User prefers metric units", "source": state["thread_id"]},
        embed="User prefers metric units",
    )
    return {}
```

`put` writes a typed memory under a namespace and stores its embedding in Vectorize so it is later findable by meaning. The diagram traces that write path.

```xyflow
{
  "direction": "LR",
  "nodes": [
    {"id": "turn", "label": "conversation turn", "shape": "stadium"},
    {"id": "extract", "label": "extract salient fact (LLM)", "shape": "rect"},
    {"id": "dedupe", "label": "dedupe vs existing", "shape": "diamond"},
    {"id": "embed", "label": "embed (Workers AI)", "shape": "rect"},
    {"id": "vz", "label": "Vectorize upsert + D1 row", "shape": "stadium"}
  ],
  "edges": [
    {"source": "turn", "target": "extract"},
    {"source": "extract", "target": "dedupe"},
    {"source": "dedupe", "target": "embed", "label": "new/changed"},
    {"source": "dedupe", "target": "turn", "label": "duplicate → skip"},
    {"source": "embed", "target": "vz", "label": "namespace key"}
  ]
}
```

## Core Concepts

### The memory taxonomy

Long-term memory splits into three kinds. **Semantic**: facts ("user is a Python developer"). **Episodic**: events ("on 3 May the deploy failed due to a missing secret"). **Procedural**: learned how-to ("for this account, always confirm before refunds"). They differ in write trigger and retrieval use: semantic memory is queried for personalization, episodic for "have we seen this before", procedural for behavior shaping. Modeling the kind explicitly keeps recall precise.

```xyflow
{
  "direction": "TD",
  "nodes": [
    {"id": "mem", "label": "long-term memory", "shape": "rect"},
    {"id": "sem", "label": "semantic: facts", "shape": "rect"},
    {"id": "epi", "label": "episodic: events", "shape": "rect"},
    {"id": "pro", "label": "procedural: how-to", "shape": "rect"},
    {"id": "use", "label": "injected into prompt by kind", "shape": "stadium"}
  ],
  "edges": [
    {"source": "mem", "target": "sem"},
    {"source": "mem", "target": "epi"},
    {"source": "mem", "target": "pro"},
    {"source": "sem", "target": "use", "label": "personalize"},
    {"source": "epi", "target": "use", "label": "recall prior"},
    {"source": "pro", "target": "use", "label": "shape behavior"}
  ]
}
```

### Hot path vs background writes

There are two write strategies. **Hot-path**: extract and store memories synchronously in the turn — accurate and immediate but adds latency. **Background**: enqueue the transcript and let a separate consumer (a Cloudflare Queue worker) extract memories asynchronously — zero added latency at the cost of eventual consistency. Production systems usually run background writes with a small synchronous fast path for explicit "remember that" requests.

## How It Works

### The read path: recall before reason

At graph entry, before the model plans, a memory node embeds the current query, searches Vectorize within the user's namespace, and injects the top memories into the system prompt. This is retrieval-augmented *personalization*: structurally the same as [RAG](/rag) but the corpus is the user's own history rather than a document set. Scoping the search to the namespace is what keeps one user's memories out of another's context.

```xyflow
{
  "direction": "LR",
  "nodes": [
    {"id": "q", "label": "incoming query", "shape": "stadium"},
    {"id": "ns", "label": "scope to namespace", "shape": "diamond"},
    {"id": "search", "label": "Vectorize ANN search", "shape": "rect"},
    {"id": "rank", "label": "rank + recency decay", "shape": "rect"},
    {"id": "inject", "label": "inject into system prompt", "shape": "rect"},
    {"id": "plan", "label": "agent plans with memory", "shape": "stadium"}
  ],
  "edges": [
    {"source": "q", "target": "ns"},
    {"source": "ns", "target": "search", "label": "user/org key"},
    {"source": "search", "target": "rank"},
    {"source": "rank", "target": "inject", "label": "top-k"},
    {"source": "inject", "target": "plan"}
  ]
}
```

### Consolidation and reflection

Raw memories accumulate redundancy and contradiction. A periodic reflection job reads a namespace's memories and rewrites them: merge duplicates, supersede outdated facts ("now prefers imperial"), and abstract many episodes into a procedural rule. This keeps recall sharp and storage bounded, and it is where memory quality is actually won — much like compaction in [LangGraph Checkpointing on Cloudflare D1](/langgraph-d1-checkpointing).

```xyflow
{
  "direction": "TD",
  "nodes": [
    {"id": "cron", "label": "scheduled reflection", "shape": "stadium"},
    {"id": "load", "label": "load namespace memories", "shape": "rect"},
    {"id": "cluster", "label": "cluster similar", "shape": "rect"},
    {"id": "merge", "label": "merge / supersede (LLM)", "shape": "diamond"},
    {"id": "write", "label": "rewrite Vectorize + D1", "shape": "stadium"}
  ],
  "edges": [
    {"source": "cron", "target": "load"},
    {"source": "load", "target": "cluster"},
    {"source": "cluster", "target": "merge"},
    {"source": "merge", "target": "write", "label": "consolidated set"},
    {"source": "merge", "target": "load", "label": "iterate"}
  ]
}
```

## Runtime Internals

LangMem stores each memory as a row (id, namespace, kind, value, created_at) plus a vector in Vectorize tagged with the same namespace and id, so a similarity hit maps back to the full record in D1. Writes are idempotent on a stable key so re-running a background consumer does not duplicate. Recency decay multiplies similarity score by a time factor so a year-old fact does not outrank yesterday's correction at equal semantic distance — the embedding model must match the one used in [Embeddings](/embeddings) at index time or recall silently degrades.

### The dual-store join

A subtle but load-bearing detail is that long-term memory is *two* stores kept in agreement: Vectorize holds the embedding for similarity search, D1 holds the authoritative record (kind, value, timestamps, source thread). The vector is only an index into the truth; answering from the vector's stored metadata alone drifts the moment a memory is edited or consolidated. The correct read path is search-then-fetch: ANN over Vectorize returns ids, then a single batched D1 read hydrates the full, current records by id, scoped to the namespace. The correct write path is the inverse and must be ordered — write D1 first, then upsert Vectorize — so a crash between them leaves an unindexed-but-true memory (recoverable by a reconciliation sweep) rather than an indexed pointer to nothing (a hard recall error). This ordering discipline is the memory-layer equivalent of the commit-boundary reasoning in [LangGraph Checkpointing on Cloudflare D1](/langgraph-d1-checkpointing), and getting it wrong is the most common source of "the agent remembers a fact it was told to forget."

```xyflow
{
  "direction": "LR",
  "nodes": [
    {"id": "q", "label": "recall query", "shape": "stadium"},
    {"id": "ann", "label": "Vectorize ANN → ids", "shape": "rect"},
    {"id": "fetch", "label": "D1 batched fetch by id", "shape": "rect"},
    {"id": "fresh", "label": "current records (post-edit)", "shape": "diamond"},
    {"id": "use", "label": "inject truth, not index", "shape": "stadium"}
  ],
  "edges": [
    {"source": "q", "target": "ann", "label": "embed + search"},
    {"source": "ann", "target": "fetch", "label": "ids only"},
    {"source": "fetch", "target": "fresh"},
    {"source": "fresh", "target": "use", "label": "authoritative"},
    {"source": "ann", "target": "fresh", "label": "score for rank"}
  ]
}
```

## Common Pitfalls

**Storing everything.** Persisting every turn floods recall with noise; extract only salient, durable facts. **No namespace scoping.** A global memory store leaks users into each other and is a privacy breach. **Never consolidating.** Unmerged memories contradict and bloat, and recall returns stale facts. **Embedding drift.** Changing the embedding model without re-indexing breaks similarity. **Hot-path everything.** Synchronous extraction on every turn taxes latency; move it to a Queue consumer. **Ignoring recency.** Without decay, superseded facts resurface and the agent regresses.

## Comparison

Long-term memory versus checkpointing: checkpoints are thread-scoped, complete, and structural; long-term memory is cross-thread, selective, and semantic — you need both. Versus stuffing history into the prompt, memory retrieves only what is relevant, bounding tokens and cost. Versus a plain vector store, LangMem adds the namespace model, memory kinds, and consolidation lifecycle that turn raw vectors into usable agent recall — the same gap as between a raw index and a real retriever in [LangChain Tools & Retrievers](/langchain-tools-retrievers).

## Cross-References

- [Agent Memory](/agent-memory) and [Memory Architectures](/memory-architectures) — memory theory and design
- [LangGraph Checkpointing on Cloudflare D1](/langgraph-d1-checkpointing) — the thread-scoped half of the stack
- [Vectorize-backed RAG on Workers](/vectorize-rag) and [Embeddings](/embeddings) — the semantic substrate
- [LangGraph](/langgraph) — the graph long-term memory hangs off
- [Context Engineering](/context-engineering) — deciding what to recall into the window
