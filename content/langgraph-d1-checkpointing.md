# LangGraph Checkpointing on Cloudflare D1: Durable State & Resumable Graphs

A LangGraph agent that forgets everything between requests is a toy. **Checkpointing** is the mechanism that makes it durable: after every super-step the graph serializes its state and writes it to a store keyed by a thread id, so the next request — possibly on a different machine, possibly days later — reloads exactly where it left off. This is the foundation under conversation memory, [human-in-the-loop](/langgraph-human-in-the-loop) pauses, and time-travel debugging. This lesson explains the checkpointer contract and implements one on Cloudflare D1, the edge SQLite database, behind a Workers handler. For the graph execution model see [LangGraph](/langgraph); for long-term semantic memory layered on top see [Long-Term Memory with LangMem & Vectorize](/langmem-vectorize-memory).

## Mental Model

### What problem does it solve?

Serverless and edge runtimes are stateless by design: an isolate can be created and destroyed between any two requests, and there are no in-process variables that survive. An agent loop, however, is inherently stateful — it accumulates messages, tool results, and plan progress. Without external persistence, every request restarts the agent from zero, which is both wrong (no memory) and expensive (re-running work). A checkpointer externalizes the graph's state to durable storage so the agent is stateful even though the runtime is not.

### The save-game analogy

A checkpointer is a save-game system. The graph plays until a checkpoint — a super-step boundary — then writes a save file tagged with the thread id (the "save slot"). Closing the game (the request ending, the isolate evicting) loses nothing. Loading the slot restores the full world: messages, variables, where the cursor sits in the graph. Multiple slots per game let you branch from any past save, which is exactly time travel. D1 is the disk those save files live on.

### A D1 checkpointer skeleton

```python
class D1Saver(BaseCheckpointSaver):
    def put(self, config, checkpoint, metadata, new_versions):
        tid = config["configurable"]["thread_id"]
        cid = checkpoint["id"]
        d1.prepare(
          "INSERT INTO checkpoints(thread_id,checkpoint_id,parent_id,state) VALUES(?,?,?,?)"
        ).bind(tid, cid, checkpoint.get("parent_id"), dumps(checkpoint)).run()
        return {"configurable": {"thread_id": tid, "checkpoint_id": cid}}

    def get_tuple(self, config):
        tid = config["configurable"]["thread_id"]
        row = d1.prepare(
          "SELECT state FROM checkpoints WHERE thread_id=? ORDER BY rowid DESC LIMIT 1"
        ).bind(tid).first()
        return loads(row["state"]) if row else None
```

`put` persists a checkpoint; `get_tuple` loads the latest for a thread. Wiring this saver into `graph.compile(checkpointer=D1Saver())` makes every run resumable. The diagram traces a write.

```xyflow
{
  "direction": "LR",
  "nodes": [
    {"id": "node", "label": "node returns state delta", "shape": "rect"},
    {"id": "red", "label": "reducers merge channels", "shape": "rect"},
    {"id": "snap", "label": "snapshot at super-step", "shape": "rect"},
    {"id": "ser", "label": "serialize checkpoint", "shape": "rect"},
    {"id": "d1", "label": "D1: INSERT row", "shape": "stadium"}
  ],
  "edges": [
    {"source": "node", "target": "red"},
    {"source": "red", "target": "snap", "label": "one per super-step"},
    {"source": "snap", "target": "ser"},
    {"source": "ser", "target": "d1", "label": "thread_id key"}
  ]
}
```

## Core Concepts

### The BaseCheckpointSaver contract

A checkpointer implements four operations: `put` (write a checkpoint), `put_writes` (record pending channel writes for crash safety mid-step), `get_tuple` (load a specific or latest checkpoint), and `list` (enumerate a thread's history for time travel). Implement all four against D1 and the entire LangGraph durability surface — memory, resume, replay — works unchanged. The graph never calls D1 directly; it only knows the contract, the same substitutability principle as retrievers in [LangChain Tools & Retrievers](/langchain-tools-retrievers).

### Thread isolation and the checkpoint chain

Every run carries `config={"configurable": {"thread_id": ...}}`. All of that thread's checkpoints share the key and form a parent-linked chain: each checkpoint stores its `parent_id`, so the history is a tree (linear normally, branching after a time-travel fork). Strict thread isolation is a correctness *and* security property — one tenant must never load another's checkpoint.

```xyflow
{
  "direction": "TD",
  "nodes": [
    {"id": "t1", "label": "thread A chain", "shape": "rect"},
    {"id": "a0", "label": "ckpt A0", "shape": "circle"},
    {"id": "a1", "label": "ckpt A1 (parent A0)", "shape": "circle"},
    {"id": "a2", "label": "ckpt A2 (parent A1)", "shape": "circle"},
    {"id": "t2", "label": "thread B chain (isolated)", "shape": "rect"},
    {"id": "b0", "label": "ckpt B0", "shape": "circle"}
  ],
  "edges": [
    {"source": "t1", "target": "a0"},
    {"source": "a0", "target": "a1"},
    {"source": "a1", "target": "a2"},
    {"source": "t2", "target": "b0"},
    {"source": "a2", "target": "t1", "label": "latest pointer"}
  ]
}
```

## How It Works

### A super-step is the commit boundary

LangGraph executes in Pregel super-steps: all nodes scheduled in a step run, their state deltas are merged by channel reducers, then one checkpoint is written. This makes persistence atomic at the step level — a crash mid-step loses at most that step's uncommitted work, and `put_writes` even narrows that by recording in-flight writes. Resuming reads the latest checkpoint, rebuilds the channel state, and continues from the next scheduled node.

```xyflow
{
  "direction": "LR",
  "nodes": [
    {"id": "req2", "label": "new request, same thread", "shape": "stadium"},
    {"id": "load", "label": "get_tuple(thread_id)", "shape": "rect"},
    {"id": "hyd", "label": "hydrate channels", "shape": "rect"},
    {"id": "pos", "label": "restore graph cursor", "shape": "diamond"},
    {"id": "go", "label": "continue next super-step", "shape": "stadium"}
  ],
  "edges": [
    {"source": "req2", "target": "load"},
    {"source": "load", "target": "hyd", "label": "deserialize"},
    {"source": "hyd", "target": "pos"},
    {"source": "pos", "target": "go", "label": "resume point"}
  ]
}
```

### D1 schema and indexing

Model checkpoints as `checkpoints(thread_id, checkpoint_id, parent_id, state, created_at)` plus a `writes` table for `put_writes`. Index `(thread_id, rowid)` so "latest for thread" and "history of thread" are single index scans. D1's SQLite semantics give you transactional `put` and cheap range reads at the edge — fast enough that checkpoint write latency is dominated by serialization, not the database.

## Runtime Internals

The state is serialized with LangGraph's serde, which handles messages and most Python objects; large blobs (retrieved documents, file contents) should be stored by reference, not inlined, or every checkpoint balloons. On Workers, D1 calls are async and bounded by the request's CPU budget, so keep the serialized state lean — this is where the shared-vs-private state discipline from [LangGraph Multi-Agent Topologies](/langgraph-multi-agent) directly controls cost. Concurrent resumes on one thread must be serialized (a Durable Object per thread) or two checkpoint chains race and diverge.

### Pruning and compaction

A thread that lives for months accumulates thousands of checkpoints, and naive retention makes both storage and the "load latest" query slow. The fix is a compaction policy run as a scheduled Worker: keep the most recent N checkpoints for fast resume, keep any checkpoint explicitly tagged (a time-travel anchor, an audited approval point), and delete the dense middle. Compaction is safe precisely because checkpoints form a parent-linked chain — collapsing a run of intermediate nodes loses only replay granularity, never the current state, since the latest checkpoint is always self-contained. Tagging is the key discipline: an untagged checkpoint is disposable history, a tagged one is a durable anchor you can fork from later. This bounds a thread's storage to a predictable ceiling regardless of conversation length, the same retention thinking that governs long-term recall in [Long-Term Memory with LangMem & Vectorize](/langmem-vectorize-memory).

```xyflow
{
  "direction": "LR",
  "nodes": [
    {"id": "cron", "label": "scheduled compaction", "shape": "stadium"},
    {"id": "scan", "label": "scan thread chain", "shape": "rect"},
    {"id": "keep", "label": "keep: recent N + tagged", "shape": "diamond"},
    {"id": "drop", "label": "delete dense middle", "shape": "rect"},
    {"id": "small", "label": "bounded D1 footprint", "shape": "stadium"}
  ],
  "edges": [
    {"source": "cron", "target": "scan"},
    {"source": "scan", "target": "keep"},
    {"source": "keep", "target": "drop", "label": "untagged old"},
    {"source": "keep", "target": "small", "label": "anchors stay"},
    {"source": "drop", "target": "small"}
  ]
}
```

### Crash safety with put_writes

A super-step can fail *between* a node finishing and the checkpoint committing — an isolate eviction, a D1 timeout. `put_writes` narrows that window: as each node's channel writes are produced they are recorded as pending rows tagged with the in-progress checkpoint id, before the consolidated `put`. On resume, LangGraph replays pending writes that were recorded but never folded into a committed checkpoint, so at most a partial step is redone rather than lost. Implementing `put_writes` against a D1 `writes(thread_id, checkpoint_id, channel, value)` table is what turns "mostly durable" into "actually durable" under real edge failure modes, and it is the storage-level analogue of the deterministic replay that makes [LangGraph](/langgraph) super-steps idempotent.

```xyflow
{
  "direction": "TD",
  "nodes": [
    {"id": "step", "label": "super-step running", "shape": "rect"},
    {"id": "pw", "label": "put_writes: pending rows", "shape": "rect"},
    {"id": "crash", "label": "crash before put?", "shape": "diamond"},
    {"id": "replay", "label": "resume: replay pending", "shape": "rect"},
    {"id": "commit", "label": "put: consolidated checkpoint", "shape": "stadium"}
  ],
  "edges": [
    {"source": "step", "target": "pw", "label": "per channel write"},
    {"source": "pw", "target": "crash"},
    {"source": "crash", "target": "replay", "label": "yes"},
    {"source": "crash", "target": "commit", "label": "no"},
    {"source": "replay", "target": "commit", "label": "re-fold"}
  ]
}
```

## Common Pitfalls

**No checkpointer in production.** Compiling without one means no memory and no resume — every request is amnesiac. **Unbounded growth.** Never pruning makes a long-lived thread's table huge and serialization slow; add a retention/compaction job that keeps the latest plus tagged checkpoints. **Fat state.** Inlining big documents into state multiplies storage per super-step; store references. **Thread-id collisions.** Deriving `thread_id` from a non-unique value cross-contaminates conversations. **Ignoring put_writes.** Skipping it widens the crash-loss window from one write to a whole super-step.

## Comparison

D1 versus an in-memory saver: in-memory is fine for tests but loses everything on isolate eviction, which on the edge is constant. D1 versus external Postgres: Postgres is feature-rich but adds a network hop and a connection from every colo; D1 is co-located with the Worker and SQLite-simple, ideal when state is per-thread and modest. Versus rolling your own session store, the `BaseCheckpointSaver` contract also gives you time travel and `put_writes` crash safety for free — re-implementing those by hand is exactly the wheel LangGraph already turned.

## Cross-References

- [LangGraph](/langgraph) — super-steps and channels, the model checkpointing serializes
- [LangGraph Human-in-the-Loop](/langgraph-human-in-the-loop) — pause/resume built on checkpoints
- [Long-Term Memory with LangMem & Vectorize](/langmem-vectorize-memory) — semantic memory above checkpoints
- [Agent Memory](/agent-memory) and [Memory Architectures](/memory-architectures) — the broader memory stack
- [Edge Deployment](/edge-deployment) — running stateful graphs on stateless runtimes
