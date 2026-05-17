# Streaming & Observability for LangGraph: SSE, Stream Modes & LangSmith Tracing

A graph that returns one blob after thirty seconds feels broken even when it is working. Streaming fixes the *experience*; observability fixes the *operability*. LangGraph treats both as first-class: it emits structured events at every node and channel, which you bridge to a browser as Server-Sent Events and to a backend as traces. This lesson covers the stream modes, the `astream_events` feed, an SSE bridge on Cloudflare Workers, and tracing through LangSmith and the [AI Gateway](/ai-gateway). It builds on the graph model in [LangGraph](/langgraph) and complements replay-based debugging in [Agent Debugging & Observability](/agent-debugging).

## Mental Model

### What problem does it solve?

Two distinct needs share one mechanism. Users need *progressive output* — tokens as they generate, "calling tool…" status, partial results — or perceived latency tanks. Operators need *causal visibility* — which node ran, with what input, how many tokens, why it branched, where it failed — or production incidents are unsolvable. Both are answered by the graph reporting what it is doing as it does it. Streaming is that report rendered for a human at a screen; tracing is the same report persisted for an engineer after the fact.

### The control-tower analogy

A LangGraph run is a flight. The passenger wants a moving map: where are we, how long left (streaming). The control tower wants the full track log: every heading change, altitude, and radio call, timestamped and replayable (tracing). The aircraft emits one stream of telemetry; the cockpit display and the tower recorder are two consumers of it. LangGraph is the telemetry bus; SSE is the cockpit display, LangSmith is the tower recorder.

### Streaming in ~8 lines

```python
async def handler(request):
    async def gen():
        async for mode, chunk in app.astream(inp, stream_mode=["updates", "messages"]):
            yield f"event: {mode}\ndata: {json.dumps(chunk, default=str)}\n\n"
    return Response(gen(), headers={"content-type": "text/event-stream"})
```

`astream` with multiple modes yields `(mode, chunk)` pairs; each becomes one SSE frame. The browser's `EventSource` dispatches by `event:` name. The diagram traces the path from node to pixel.

```xyflow
{
  "direction": "LR",
  "nodes": [
    {"id": "node", "label": "node executes", "shape": "rect"},
    {"id": "bus", "label": "LangGraph event bus", "shape": "rect"},
    {"id": "astream", "label": "astream(stream_mode=[...])", "shape": "rect"},
    {"id": "sse", "label": "Workers ReadableStream", "shape": "rect"},
    {"id": "es", "label": "browser EventSource", "shape": "stadium"}
  ],
  "edges": [
    {"source": "node", "target": "bus", "label": "emit"},
    {"source": "bus", "target": "astream"},
    {"source": "astream", "target": "sse", "label": "(mode, chunk)"},
    {"source": "sse", "target": "es", "label": "text/event-stream"}
  ]
}
```

## Core Concepts

### The five stream modes

`stream_mode` selects what the graph reports. **values**: the full state after each super-step — simplest, heaviest. **updates**: only the state delta per node — ideal for "node X finished". **messages**: LLM tokens as they generate, for typewriter output. **debug**: every internal event, for development. **custom**: whatever a node emits via the stream writer, for app-specific progress ("downloaded 3/10"). You can request several at once and route each to a different UI surface.

```xyflow
{
  "direction": "TD",
  "nodes": [
    {"id": "run", "label": "graph run", "shape": "stadium"},
    {"id": "val", "label": "values: full state", "shape": "rect"},
    {"id": "upd", "label": "updates: deltas", "shape": "rect"},
    {"id": "msg", "label": "messages: tokens", "shape": "rect"},
    {"id": "cus", "label": "custom: app progress", "shape": "rect"},
    {"id": "ui", "label": "UI surfaces", "shape": "stadium"}
  ],
  "edges": [
    {"source": "run", "target": "val"},
    {"source": "run", "target": "upd"},
    {"source": "run", "target": "msg"},
    {"source": "run", "target": "cus"},
    {"source": "msg", "target": "ui", "label": "chat bubble"},
    {"source": "upd", "target": "ui", "label": "step list"},
    {"source": "cus", "target": "ui", "label": "progress bar"}
  ]
}
```

### astream_events: the structured feed

`astream_events` is a finer feed than the modes: it yields typed events — `on_chat_model_start/stream/end`, `on_tool_start/end`, `on_retriever_end` — each with a run id, parent id, name, and tags. This is the canonical source for both rich UIs and traces because the parent/child run ids reconstruct the exact call tree.

## How It Works

### From events to a trace tree

Each event carries a run id and a parent run id. Accumulating them yields a tree: the root run, its node children, each node's model and tool calls beneath. LangSmith ingests this tree and renders a waterfall — durations, token counts, inputs and outputs per span. The same tree, sampled, is what you alert on in production. This is the structured counterpart to the replay debugging in [Agent Debugging & Observability](/agent-debugging).

```xyflow
{
  "direction": "TD",
  "nodes": [
    {"id": "root", "label": "run: graph invoke", "shape": "stadium"},
    {"id": "n1", "label": "span: planner node", "shape": "rect"},
    {"id": "m1", "label": "span: model call", "shape": "circle"},
    {"id": "n2", "label": "span: tool node", "shape": "rect"},
    {"id": "t1", "label": "span: search tool", "shape": "circle"},
    {"id": "ls", "label": "LangSmith waterfall", "shape": "stadium"}
  ],
  "edges": [
    {"source": "root", "target": "n1", "label": "child"},
    {"source": "n1", "target": "m1", "label": "child"},
    {"source": "root", "target": "n2", "label": "child"},
    {"source": "n2", "target": "t1", "label": "child"},
    {"source": "root", "target": "ls", "label": "export tree"}
  ]
}
```

### Dual telemetry on the edge

On Cloudflare, two sinks coexist. The [AI Gateway](/ai-gateway) sits in front of model calls and logs every request, token count, cost, and cache hit at the network layer — provider-agnostic, zero app code. LangSmith captures the graph-level semantic trace — which node, why this branch. Gateway answers "what did we spend"; LangSmith answers "what did the agent think". Wiring both gives cost and reasoning visibility from one run.

```xyflow
{
  "direction": "LR",
  "nodes": [
    {"id": "graph", "label": "LangGraph run", "shape": "stadium"},
    {"id": "cb", "label": "tracing callback", "shape": "rect"},
    {"id": "ls", "label": "LangSmith: semantic trace", "shape": "rect"},
    {"id": "gw", "label": "AI Gateway: cost/latency", "shape": "rect"},
    {"id": "dash", "label": "ops dashboards + alerts", "shape": "stadium"}
  ],
  "edges": [
    {"source": "graph", "target": "cb"},
    {"source": "cb", "target": "ls", "label": "run tree"},
    {"source": "graph", "target": "gw", "label": "model HTTP"},
    {"source": "ls", "target": "dash"},
    {"source": "gw", "target": "dash"}
  ]
}
```

## Runtime Internals

Events propagate through the same `RunnableConfig` that threads callbacks; a node that drops the passed `config` severs its subtree from the trace, producing orphan spans. On Workers, the SSE generator must yield promptly and flush — buffering the whole stream defeats the point — and the trace export must be fire-and-forget (or `ctx.waitUntil`) so telemetry never blocks the user response. Sampling is essential at scale: trace 100% in staging, a small percentage plus all errors in production, to bound cost without losing incident signal.

### Reconnection and replay-safe streams

Edge connections drop: a mobile client loses signal mid-generation, a Worker isolate recycles. A naive stream loses everything after the break. The durable design makes the stream *resumable* by giving every emitted frame a monotonic sequence id and persisting the run's output (or letting the client send a `Last-Event-ID` header on reconnect, which SSE supports natively). On reconnect the handler reads the run's checkpoint, replays frames after the last acknowledged id, and continues live — the client experiences a brief stall, not a lost answer. This works only because the underlying run is checkpointed: the stream is a *view* of durable state, not the state itself, so it can always be rebuilt. The same property lets an operator scrub a completed run's recorded event feed to reproduce exactly what the user saw, which is the streaming-side complement to the trace tree and ties directly to the deployment durability in [LangGraph Deployment](/langgraph-deployment) and the persistence in [LangGraph Checkpointing on Cloudflare D1](/langgraph-d1-checkpointing).

```xyflow
{
  "direction": "LR",
  "nodes": [
    {"id": "run", "label": "run (checkpointed)", "shape": "rect"},
    {"id": "seq", "label": "frames + sequence id", "shape": "rect"},
    {"id": "drop", "label": "connection drops", "shape": "diamond"},
    {"id": "recon", "label": "reconnect: Last-Event-ID", "shape": "rect"},
    {"id": "replay", "label": "replay after id, resume live", "shape": "stadium"}
  ],
  "edges": [
    {"source": "run", "target": "seq", "label": "emit"},
    {"source": "seq", "target": "drop"},
    {"source": "drop", "target": "recon", "label": "client retries"},
    {"source": "recon", "target": "run", "label": "read checkpoint"},
    {"source": "recon", "target": "replay", "label": "frames > id"}
  ]
}
```

## Common Pitfalls

**Buffering the stream.** Collecting all chunks then returning one response reintroduces the latency you streamed to remove. **Lost config.** A custom node ignoring `config` orphans its spans and breaks the trace tree. **Blocking on export.** Synchronously awaiting the trace sink adds its latency to every request; make it async. **Over-tracing.** 100% verbose tracing in production is expensive and noisy; sample plus always-keep errors. **Wrong mode.** Using `values` for token output ships the entire state per token; use `messages`. **Leaking PII.** Traces capture inputs verbatim — redact secrets before export.

## Comparison

Streaming versus tracing: same event source, opposite consumers — one optimizes perceived latency for users, the other optimizes diagnosability for engineers; you ship both. LangSmith versus the AI Gateway: semantic versus economic visibility — neither replaces the other. Versus `print` debugging, the structured run tree gives causal, replayable, queryable history rather than scattered logs, the difference between guessing and knowing in an incident, and the operational basis for the eval and safety work in [LangGraph Red-Teaming](/langgraph-red-teaming).

## Cross-References

- [LangGraph](/langgraph) — the event-emitting execution model
- [Agent Debugging & Observability](/agent-debugging) — replay debugging, the trace counterpart
- [AI Gateway](/ai-gateway) — network-layer cost and latency telemetry
- [LangGraph Red-Teaming](/langgraph-red-teaming) — using traces for safety evaluation
- [LangGraph Deployment](/langgraph-deployment) — operating streamed, traced graphs in production
