# LangGraph Multi-Agent Topologies: Supervisor, Swarm & Hierarchical Teams

One model with twenty tools degrades fast: the prompt bloats, tool selection gets noisy, and a single failure poisons everything. The fix is to split the work across several specialized agents and give them a coordination structure. LangGraph expresses each agent as a node (often a subgraph) and the coordination as edges, so a multi-agent system is just a larger graph over the model from [LangGraph](/langgraph). This lesson covers the three canonical topologies — supervisor, swarm, and hierarchical teams — and the handoff mechanics that connect them, deployed on Cloudflare Workers. For the general theory see [Multi-Agent Systems](/multi-agent-systems) and [Agent Orchestration](/agent-orchestration); for single-agent design see [Agent Architectures](/agent-architectures).

## Mental Model

### What problem does it solve?

A monolithic agent must hold every tool, instruction, and constraint in one context window. As capability grows, accuracy falls: the model confuses similar tools, exceeds token budgets, and cannot be evaluated per skill. Decomposition restores it. Give a "researcher" only retrieval tools, a "coder" only the sandbox, a "writer" only formatting. Each has a short, sharp prompt and is independently testable. The remaining problem — *who works next, and how does control pass* — is what the topology answers.

### The org-chart analogy

Three structures map to org charts. A **supervisor** is a manager who reads each result and assigns the next worker; workers never talk to each other. A **swarm** is a flat team of peers who hand the task directly to whoever is most relevant — no manager, control flows laterally. A **hierarchy** nests these: a top supervisor delegates to team supervisors, each running their own sub-team. Pick the flattest structure that still keeps routing decisions tractable.

### A supervisor in ~12 lines

```python
from langgraph.graph import StateGraph, START, END
from langgraph.types import Command

def supervisor(state) -> Command:
    nxt = route_llm(state["messages"])           # "researcher" | "writer" | "FINISH"
    if nxt == "FINISH":
        return Command(goto=END)
    return Command(goto=nxt)

g = StateGraph(State)
g.add_node("supervisor", supervisor)
g.add_node("researcher", researcher_subgraph)
g.add_node("writer", writer_subgraph)
g.add_edge(START, "supervisor")
g.add_edge("researcher", "supervisor")          # always report back
g.add_edge("writer", "supervisor")
app = g.compile()
```

The supervisor returns a `Command(goto=...)` that both updates state and names the next node — routing is a value, not a side effect. Workers loop back to the supervisor, which decides again until `FINISH`. The diagram shows the topology.

```xyflow
{
  "direction": "TD",
  "nodes": [
    {"id": "start", "label": "START", "shape": "stadium"},
    {"id": "sup", "label": "supervisor (router LLM)", "shape": "diamond"},
    {"id": "res", "label": "researcher agent", "shape": "rect"},
    {"id": "wri", "label": "writer agent", "shape": "rect"},
    {"id": "cod", "label": "coder agent", "shape": "rect"},
    {"id": "end", "label": "END", "shape": "stadium"}
  ],
  "edges": [
    {"source": "start", "target": "sup"},
    {"source": "sup", "target": "res", "label": "goto researcher"},
    {"source": "sup", "target": "wri", "label": "goto writer"},
    {"source": "sup", "target": "cod", "label": "goto coder"},
    {"source": "res", "target": "sup", "label": "report"},
    {"source": "wri", "target": "sup", "label": "report"},
    {"source": "cod", "target": "sup", "label": "report"},
    {"source": "sup", "target": "end", "label": "FINISH"}
  ]
}
```

## Core Concepts

### Handoffs via Command

A handoff is one agent transferring control and a payload to another. In LangGraph the carrier is `Command(goto="agent_b", update={...})`: it routes *and* writes state atomically, so the receiving agent sees the context the sender chose to pass. Handoffs can be implemented as tools (`transfer_to_writer`) the model calls, which lets the LLM itself decide routing — the basis of the swarm topology.

### Shared vs private state

Every agent reads and writes a shared state object, but flooding it with one agent's scratch work confuses the others. The discipline: keep a small shared channel (the task, the running answer) and scope verbose intermediate reasoning to a subgraph's private state that does not propagate up. This message-filtering choice is the single biggest driver of multi-agent reliability, and it ties directly into [Context Engineering](/context-engineering).

```xyflow
{
  "direction": "LR",
  "nodes": [
    {"id": "shared", "label": "shared state: task + answer", "shape": "rect"},
    {"id": "subg", "label": "agent subgraph", "shape": "rect"},
    {"id": "priv", "label": "private scratch state", "shape": "circle"},
    {"id": "filt", "label": "output filter", "shape": "diamond"},
    {"id": "up", "label": "propagate summary only", "shape": "stadium"}
  ],
  "edges": [
    {"source": "shared", "target": "subg", "label": "read task"},
    {"source": "subg", "target": "priv", "label": "internal steps"},
    {"source": "priv", "target": "filt"},
    {"source": "filt", "target": "up", "label": "drop noise"},
    {"source": "up", "target": "shared", "label": "write summary"}
  ]
}
```

## How It Works

### Swarm: peer handoff without a manager

In a swarm there is no router node. Each agent has handoff tools to its peers and decides, after acting, whether to finish or pass control. Control flows along whatever path the agents choose at runtime; the graph just provides the edges. Swarms minimize latency (no manager round-trip) but make global behavior harder to reason about — favor them when agents are few and roles are crisp.

```xyflow
{
  "direction": "LR",
  "nodes": [
    {"id": "intake", "label": "intake agent", "shape": "rect"},
    {"id": "sales", "label": "sales agent", "shape": "rect"},
    {"id": "tech", "label": "tech agent", "shape": "rect"},
    {"id": "bill", "label": "billing agent", "shape": "rect"},
    {"id": "done", "label": "resolve", "shape": "stadium"}
  ],
  "edges": [
    {"source": "intake", "target": "sales", "label": "transfer_to_sales"},
    {"source": "intake", "target": "tech", "label": "transfer_to_tech"},
    {"source": "sales", "target": "bill", "label": "handoff"},
    {"source": "tech", "target": "bill", "label": "handoff"},
    {"source": "bill", "target": "done"},
    {"source": "tech", "target": "done"}
  ]
}
```

### Hierarchical teams

When even the supervisor's routing prompt gets unwieldy, nest. A top supervisor delegates to team supervisors; each team is itself a supervisor-plus-workers subgraph. This bounds every routing decision to a small option set at each level, scaling to dozens of agents — the structure behind complex research agents and the orchestration patterns in [Agent SDKs](/agent-sdks).

```xyflow
{
  "direction": "TD",
  "nodes": [
    {"id": "top", "label": "top supervisor", "shape": "diamond"},
    {"id": "rt", "label": "research team supervisor", "shape": "diamond"},
    {"id": "dt", "label": "delivery team supervisor", "shape": "diamond"},
    {"id": "w1", "label": "web researcher", "shape": "rect"},
    {"id": "w2", "label": "doc analyst", "shape": "rect"},
    {"id": "w3", "label": "editor", "shape": "rect"}
  ],
  "edges": [
    {"source": "top", "target": "rt", "label": "delegate research"},
    {"source": "top", "target": "dt", "label": "delegate delivery"},
    {"source": "rt", "target": "w1"},
    {"source": "rt", "target": "w2"},
    {"source": "dt", "target": "w3"},
    {"source": "rt", "target": "top", "label": "team result"},
    {"source": "dt", "target": "top", "label": "team result"}
  ]
}
```

## Runtime Internals

Each agent node runs its own Pregel super-steps; a subgraph's internal steps are invisible to the parent except through the state keys it writes back. On Cloudflare, parallel branches (a supervisor fanning to two independent workers) execute as concurrent `fetch` calls bounded by `max_concurrency`, and a single checkpointer keyed by the parent `thread_id` records the whole tree so the entire multi-agent run is resumable and replayable — the same persistence used for [human-in-the-loop](/langgraph-human-in-the-loop) gates between agents.

### Failure isolation and degraded modes

The strongest argument for decomposition is not accuracy — it is blast radius. In a monolith, one bad tool result or a model that loops corrupts the entire run. In a topology, a failing agent fails *locally*: the supervisor sees an error result and can retry that agent, route around it to a fallback, or return a partial answer with the failed sub-task flagged. This requires designing every agent boundary as a contract — a typed result that explicitly encodes success, partial, or failure — rather than assuming each agent always returns clean output. A research agent that times out should hand back `{status: "partial", found: [...]}`, letting the supervisor decide whether the writer can proceed with what exists or must escalate. Degraded-but-useful beats all-or-nothing for user-facing systems, and the per-agent result contract is also what makes each agent independently testable, the evaluation property that connects multi-agent design to [Agent Evaluation](/agent-evaluation) and the safety gates in [LangGraph Human-in-the-Loop](/langgraph-human-in-the-loop). The same boundary that isolates failure also isolates cost: a runaway agent is capped by its own step budget instead of consuming the whole run.

```xyflow
{
  "direction": "TD",
  "nodes": [
    {"id": "sup", "label": "supervisor", "shape": "diamond"},
    {"id": "ag", "label": "agent runs", "shape": "rect"},
    {"id": "res", "label": "typed result", "shape": "diamond"},
    {"id": "ok", "label": "success → next agent", "shape": "rect"},
    {"id": "part", "label": "partial → proceed flagged", "shape": "rect"},
    {"id": "fail", "label": "failure → fallback / escalate", "shape": "stadium"}
  ],
  "edges": [
    {"source": "sup", "target": "ag", "label": "delegate"},
    {"source": "ag", "target": "res"},
    {"source": "res", "target": "ok", "label": "status=ok"},
    {"source": "res", "target": "part", "label": "status=partial"},
    {"source": "res", "target": "fail", "label": "status=error"},
    {"source": "ok", "target": "sup", "label": "report"},
    {"source": "part", "target": "sup", "label": "report"}
  ]
}
```

## Common Pitfalls

**Shared-state pollution.** Writing every agent's chain-of-thought to the shared channel collapses accuracy; filter aggressively. **Supervisor ping-pong.** A vague router prompt loops the supervisor between two workers forever — add a step counter and a `FINISH` bias. **Over-decomposition.** Five agents for a two-step task adds latency and failure surface with no gain. **Lost handoff context.** `Command(goto=...)` without an `update` hands off with no instructions; always pass the task framing. **No global termination.** Swarms with no agent owning "done" never end; designate a terminal path.

## Comparison

Supervisor versus swarm: the supervisor centralizes control for predictability and easy evaluation at the cost of a manager round-trip per step; the swarm is faster and more flexible but harder to constrain and audit. Hierarchy versus flat: hierarchy scales routing past what one prompt can handle, at the cost of more nodes and deeper latency. Versus a single mega-agent from [Agent Architectures](/agent-architectures), any multi-agent topology trades coordination overhead for sharper per-role prompts, isolated failures, and per-agent evaluation — worth it once one agent can no longer hold the whole job reliably.

## Cross-References

- [Multi-Agent Systems](/multi-agent-systems) — orchestration, delegation, communication theory
- [Agent Orchestration](/agent-orchestration) — routing and supervisor patterns in general
- [LangGraph](/langgraph) — the graph primitives agents are built from
- [LangGraph Human-in-the-Loop](/langgraph-human-in-the-loop) — gating handoffs for safety
- [Agent SDKs](/agent-sdks) and [Context Engineering](/context-engineering) — building blocks and state discipline
