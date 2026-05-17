# Deploying LangGraph in Production: Platform, Self-Host & the Cloudflare Edge

A graph that runs in a notebook is a prototype. Production demands an HTTP surface, durable runs that survive restarts, concurrency across many threads, secret management, and zero-downtime deploys. LangGraph addresses this with a deployment model — the assistants/threads/runs API plus a task queue — that you can consume as the managed LangGraph Platform or self-host. This lesson covers both and details a self-host on Cloudflare Workers with Durable Objects and Workflows, the natural edge substrate for the [checkpointing](/langgraph-d1-checkpointing) and [streaming](/langgraph-streaming-observability) you already built. For the graph itself see [LangGraph](/langgraph); for the production concerns it shares see [Edge Deployment](/edge-deployment) and [Production Patterns](/production-patterns).

## Mental Model

### What problem does it solve?

`graph.invoke()` in a script has no API, no durability, no concurrency story, and no way to deploy a fix without dropping in-flight runs. Production needs each of those as infrastructure, not application code. The deployment layer turns a compiled graph into a service: a stable API to start and inspect runs, a queue so long runs outlive any single request, persistence so a restart resumes rather than restarts, and a release process that does not strand active conversations. The graph logic is unchanged; what wraps it is the product.

### The kitchen analogy

A compiled graph is a recipe. The deployment layer is the restaurant: an order desk (the runs API) takes tickets, a queue paces them so the kitchen is not overwhelmed, the walk-in fridge (checkpoint store) keeps half-finished dishes if a cook leaves, and shift changes (deploys) happen without dropping orders mid-plate. LangGraph Platform is renting a fully staffed kitchen; self-hosting on Workers is building your own from edge primitives you control.

### A run-submission handler in ~10 lines

```python
async def create_run(request):
    body = await request.json()
    thread_id = body["thread_id"]
    run_id = new_id()
    await queue.send({"run_id": run_id, "thread_id": thread_id, "input": body["input"]})
    await d1.prepare(
        "INSERT INTO runs(run_id,thread_id,status) VALUES(?,?, 'queued')"
    ).bind(run_id, thread_id).run()
    return Response(json({"run_id": run_id, "status": "queued"}), status=202)
```

The request returns immediately with `202 queued`; a Queue consumer runs the graph and writes status back. Clients poll or stream for completion. The diagram shows the architecture.

```xyflow
{
  "direction": "LR",
  "nodes": [
    {"id": "client", "label": "client", "shape": "stadium"},
    {"id": "api", "label": "runs API (Worker)", "shape": "rect"},
    {"id": "q", "label": "Cloudflare Queue", "shape": "rect"},
    {"id": "cons", "label": "consumer: graph.invoke", "shape": "rect"},
    {"id": "ckpt", "label": "D1 checkpoints + runs table", "shape": "rect"},
    {"id": "poll", "label": "poll / SSE for result", "shape": "stadium"}
  ],
  "edges": [
    {"source": "client", "target": "api", "label": "POST /runs"},
    {"source": "api", "target": "q", "label": "enqueue"},
    {"source": "api", "target": "client", "label": "202 run_id"},
    {"source": "q", "target": "cons", "label": "deliver"},
    {"source": "cons", "target": "ckpt", "label": "persist"},
    {"source": "client", "target": "poll"},
    {"source": "poll", "target": "ckpt", "label": "read status"}
  ]
}
```

## Core Concepts

### Assistants, threads, runs

The deployment API has three nouns. An **assistant** is a deployed graph plus a config (model, prompt variant). A **thread** is a conversation with its checkpoint history. A **run** is one execution of an assistant on a thread. This decomposition lets you A/B two assistant configs on the same thread, list a thread's runs for audit, and resume a thread weeks later — the API contract every LangGraph deployment exposes regardless of host.

```xyflow
{
  "direction": "TD",
  "nodes": [
    {"id": "asst", "label": "assistant: graph + config", "shape": "rect"},
    {"id": "thr", "label": "thread: conversation + history", "shape": "rect"},
    {"id": "run", "label": "run: one execution", "shape": "rect"},
    {"id": "ckpt", "label": "checkpoints (per thread)", "shape": "circle"},
    {"id": "audit", "label": "list runs → audit/replay", "shape": "stadium"}
  ],
  "edges": [
    {"source": "asst", "target": "run", "label": "executed as"},
    {"source": "thr", "target": "run", "label": "scoped to"},
    {"source": "thr", "target": "ckpt", "label": "owns"},
    {"source": "run", "target": "ckpt", "label": "writes"},
    {"source": "run", "target": "audit"}
  ]
}
```

### Platform vs self-host

LangGraph Platform manages the API, queue, persistence, scaling, and monitoring — fastest to production, least control, a hosting bill. Self-host gives full control of data residency and runtime — more to operate. The Cloudflare self-host maps each concern to a primitive: API to Workers, queue to Queues, durable per-thread coordination to Durable Objects, long multi-step orchestration to Workflows, state to D1 — the deployment shape recommended in [Edge Deployment](/edge-deployment).

## How It Works

### The run lifecycle as a state machine

A run moves through `queued → running → (interrupted ↔ running) → success | error`. Each transition is a durable write to the runs table, so a crashed consumer leaves a `running` row that a sweeper requeues, and an `interrupted` row waits for the [human-in-the-loop](/langgraph-human-in-the-loop) resume. Idempotency on `run_id` makes redelivery safe — the consumer checks status before executing.

```xyflow
{
  "direction": "LR",
  "nodes": [
    {"id": "q", "label": "queued", "shape": "stadium"},
    {"id": "r", "label": "running", "shape": "rect"},
    {"id": "i", "label": "interrupted", "shape": "diamond"},
    {"id": "s", "label": "success", "shape": "stadium"},
    {"id": "e", "label": "error → retry/DLQ", "shape": "stadium"}
  ],
  "edges": [
    {"source": "q", "target": "r", "label": "consumer picks up"},
    {"source": "r", "target": "i", "label": "interrupt()"},
    {"source": "i", "target": "r", "label": "Command(resume)"},
    {"source": "r", "target": "s", "label": "END"},
    {"source": "r", "target": "e", "label": "exception"},
    {"source": "e", "target": "q", "label": "requeue (bounded)"}
  ]
}
```

### Scaling by thread sharding

Concurrency comes from sharding on `thread_id`: each thread is serialized by its Durable Object (no two runs corrupt one checkpoint chain) while different threads run fully in parallel across isolates. Throughput scales horizontally with no shared bottleneck because state is partitioned by thread, the same partitioning that makes [scaling and load balancing](/scaling-load-balancing) tractable for stateful agents.

## Runtime Internals

Cold starts are near-zero on Workers, so the dominant latency is model calls, not framework boot — unlike container deploys. Long runs that exceed a single invocation's CPU budget are decomposed into Cloudflare Workflow steps, each step a durable checkpoint, so a multi-minute agent survives eviction. Secrets are Workers bindings, never inlined into assistant config. Blue-green is two Worker versions behind a gradual traffic split; because threads are durable in D1, a request mid-conversation served by the new version simply loads the existing checkpoint — no session affinity required, which is exactly why this architecture deploys safely.

### Long runs as Workflow steps

A single Worker invocation has a CPU budget; a research agent making twelve sequential model calls will exceed it. The decomposition is Cloudflare Workflows: each graph super-step (or coarse phase) becomes a durable Workflow step that can sleep, retry with backoff, and survive eviction independently. Workflows and LangGraph checkpoints align cleanly because both already think in resumable steps — a Workflow step boundary is a natural place to take a LangGraph checkpoint, so the two persistence layers reinforce rather than fight. The result is an agent that can run for minutes or hours, pause for a [human-in-the-loop](/langgraph-human-in-the-loop) decision for days, and never lose progress to a runtime limit. The cost model stays flat because idle waits (queued, interrupted, sleeping) consume no CPU, only storage — the economic property that makes long-horizon agents viable on the edge and connects to [Cost Optimization](/cost-optimization).

```xyflow
{
  "direction": "LR",
  "nodes": [
    {"id": "run", "label": "long run", "shape": "stadium"},
    {"id": "w1", "label": "Workflow step: plan", "shape": "rect"},
    {"id": "w2", "label": "Workflow step: research", "shape": "rect"},
    {"id": "sleep", "label": "sleep / await human", "shape": "diamond"},
    {"id": "w3", "label": "Workflow step: synthesize", "shape": "rect"},
    {"id": "done", "label": "success (no CPU while idle)", "shape": "stadium"}
  ],
  "edges": [
    {"source": "run", "target": "w1", "label": "checkpoint"},
    {"source": "w1", "target": "w2", "label": "durable boundary"},
    {"source": "w2", "target": "sleep"},
    {"source": "sleep", "target": "w3", "label": "resume"},
    {"source": "w3", "target": "done"}
  ]
}
```

### Safe rollout: blue-green with durable threads

Deploying a new graph version while conversations are mid-flight is the scariest production moment, and durable threads make it boring. Two Worker versions run behind a weighted traffic split. Because every thread's state lives in D1, not in an instance, a request for an in-progress thread routed to the new version simply loads the existing checkpoint and continues — no session affinity, no drain, no lost conversations. You ramp traffic from 1% to 100% watching the LangSmith and [AI Gateway](/ai-gateway) signals from [Streaming & Observability](/langgraph-streaming-observability); a regression is a one-click weight reset, not a redeploy. Schema-changing graph edits need the usual care (version the state shape, tolerate old checkpoints), but topology and prompt changes roll forward and back freely. This is the deployment dividend of building on durable state from the start.

```xyflow
{
  "direction": "TD",
  "nodes": [
    {"id": "lb", "label": "weighted traffic split", "shape": "diamond"},
    {"id": "blue", "label": "version blue (stable)", "shape": "rect"},
    {"id": "green", "label": "version green (new)", "shape": "rect"},
    {"id": "d1", "label": "D1 threads (shared, durable)", "shape": "rect"},
    {"id": "watch", "label": "watch signals → ramp/rollback", "shape": "stadium"}
  ],
  "edges": [
    {"source": "lb", "target": "blue", "label": "90%"},
    {"source": "lb", "target": "green", "label": "10%"},
    {"source": "blue", "target": "d1", "label": "load checkpoint"},
    {"source": "green", "target": "d1", "label": "load same checkpoint"},
    {"source": "green", "target": "watch"},
    {"source": "watch", "target": "lb", "label": "adjust weights"}
  ]
}
```

## Common Pitfalls

**Synchronous long runs.** Executing the graph inside the request thread times out and loses work on eviction; enqueue and return `202`. **Non-idempotent consumers.** Queue redelivery double-executes a run unless status is checked first. **Unbounded retries.** Infinite requeue on a poisoned input is a cost loop; cap attempts and dead-letter. **Secrets in config.** Putting API keys in assistant config leaks them into traces and storage; use bindings. **Session affinity assumptions.** Routing a thread to a specific instance breaks on the edge — rely on durable state, not stickiness. **No run sweeper.** Crashed `running` rows never complete without a requeue job.

## Comparison

Platform versus self-host: managed speed and zero ops versus control, data residency, and a flat edge cost model — choose by team and compliance, not fashion. Worker self-host versus a long-lived container: Workers eliminate cold starts and scale per-thread automatically but cap per-invocation CPU, which Workflows decompose around; a container has no CPU cap per request but pays cold starts and needs its own autoscaler. Versus deploying a bare `invoke` behind a web framework, the assistants/threads/runs model adds durability, audit, resumability, and safe deploys that you would otherwise rebuild by hand — and ties back to the cost discipline in [Cost Optimization](/cost-optimization) and [LLM Serving](/llm-serving).

## Cross-References

- [LangGraph](/langgraph) — the compiled graph being deployed
- [Edge Deployment](/edge-deployment) and [Production Patterns](/production-patterns) — the production substrate
- [LangGraph Checkpointing on Cloudflare D1](/langgraph-d1-checkpointing) — durability behind safe deploys
- [LangGraph Human-in-the-Loop](/langgraph-human-in-the-loop) — the interrupted-run lifecycle state
- [Scaling & Load Balancing](/scaling-load-balancing) and [LLM Serving](/llm-serving) — throughput and cost at scale
