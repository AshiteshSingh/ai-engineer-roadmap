# LangGraph Human-in-the-Loop: Interrupts, Approval Gates & Time Travel

Autonomous agents are unacceptable the moment a wrong step costs money, leaks data, or emails a customer. LangGraph's answer is **human-in-the-loop (HITL)**: a graph can pause mid-execution, surface its proposed action, wait — possibly for minutes or days — for a human decision, then resume exactly where it stopped. This is only possible because LangGraph persists state at every super-step, the mechanism detailed in [LangGraph Checkpointing on Cloudflare D1](/langgraph-d1-checkpointing). This lesson covers the `interrupt()` primitive, the approve/edit/reject patterns built on it, and time-travel debugging, all running on Cloudflare Workers with Durable Objects as the coordination layer. For the graph model itself see [LangGraph](/langgraph); for orchestrating the agents being gated see [Agent Orchestration](/agent-orchestration).

## Mental Model

### What problem does it solve?

A pure agent loop has no natural pause point — it runs until it decides it is done. But "transfer $5,000", "delete the production table", and "publish this reply" are decisions a human must ratify. Bolting an `input()` call into a node does not work on the edge: a Workers request cannot block for an hour, and the process may be evicted between turns. HITL reframes the pause as *durable state*: the graph writes a checkpoint, returns control to the caller, and the run is later *resumed* by a new request carrying the human's answer. The pause survives process death because it lives in storage, not memory.

### The escalation-desk analogy

Think of a junior employee who must get a manager's signature before large refunds. The employee prepares the paperwork (the proposed tool call), drops it in the manager's tray (the interrupt), and goes home. Hours later the manager signs, edits, or rejects it and puts it back. The next morning the employee picks up exactly that file and continues — they did not redo the analysis, because the file *is* the saved state. LangGraph is the filing system that makes this resumable across days and machines.

### Interrupt in ~10 lines

```python
from langgraph.types import interrupt, Command

def approval_node(state):
    decision = interrupt({
        "action": "refund",
        "amount": state["amount"],
        "order": state["order_id"],
    })
    if decision["approved"]:
        return {"status": "refunded"}
    return {"status": "rejected", "reason": decision.get("reason")}

# resume later with the human's answer:
graph.invoke(Command(resume={"approved": True}), config={"configurable": {"thread_id": "t-42"}})
```

`interrupt(payload)` raises a special signal: LangGraph checkpoints, stops, and returns the payload to the caller. A later `invoke` with `Command(resume=...)` re-enters `approval_node`, and `interrupt` returns the resume value as if it had been a normal function call. The diagram traces that lifecycle.

```xyflow
{
  "direction": "LR",
  "nodes": [
    {"id": "run", "label": "graph.invoke(thread)", "shape": "stadium"},
    {"id": "work", "label": "agent prepares action", "shape": "rect"},
    {"id": "intr", "label": "interrupt(payload)", "shape": "diamond"},
    {"id": "ckpt", "label": "checkpoint + return", "shape": "rect"},
    {"id": "human", "label": "human reviews (minutes–days)", "shape": "circle"},
    {"id": "resume", "label": "Command(resume=decision)", "shape": "rect"},
    {"id": "cont", "label": "node resumes, graph continues", "shape": "stadium"}
  ],
  "edges": [
    {"source": "run", "target": "work"},
    {"source": "work", "target": "intr"},
    {"source": "intr", "target": "ckpt", "label": "raise signal"},
    {"source": "ckpt", "target": "human", "label": "control returns"},
    {"source": "human", "target": "resume", "label": "decision"},
    {"source": "resume", "target": "cont", "label": "interrupt() returns value"}
  ]
}
```

## Core Concepts

### Static vs dynamic interrupts

There are two ways to pause. **Static**: compile the graph with `interrupt_before=["tools"]` or `interrupt_after=[...]`, pausing around named nodes regardless of state — good for a blanket "review every tool call" policy. **Dynamic**: call `interrupt()` inside a node so the pause is conditional on runtime state — pause only when `amount > 1000`. Dynamic interrupts are more precise and compose with branching; static interrupts are simpler for uniform gates. Both require a checkpointer; without persisted state there is nothing to resume.

### The three review verbs

Every HITL gate reduces to approve, edit, or reject. **Approve**: resume with the original action unchanged. **Edit**: resume with a corrected payload — the human rewrites the SQL or trims the email before it executes. **Reject**: resume with a refusal so the graph routes to an apology or an alternative branch. Modeling all three explicitly, rather than only a yes/no, is what makes HITL useful in practice and is the foundation of safe rollouts discussed in [LangGraph Red-Teaming](/langgraph-red-teaming).

```xyflow
{
  "direction": "TD",
  "nodes": [
    {"id": "gate", "label": "approval gate", "shape": "diamond"},
    {"id": "app", "label": "approve → run as proposed", "shape": "rect"},
    {"id": "edit", "label": "edit → patch state, then run", "shape": "rect"},
    {"id": "rej", "label": "reject → route to fallback", "shape": "rect"},
    {"id": "exec", "label": "tool execution", "shape": "rect"},
    {"id": "alt", "label": "apology / alternative", "shape": "stadium"}
  ],
  "edges": [
    {"source": "gate", "target": "app"},
    {"source": "gate", "target": "edit"},
    {"source": "gate", "target": "rej"},
    {"source": "app", "target": "exec"},
    {"source": "edit", "target": "exec", "label": "modified args"},
    {"source": "rej", "target": "alt"}
  ]
}
```

## How It Works

### Resume binds to a thread, not a process

State is keyed by `thread_id`. The pausing request and the resuming request can land on different Workers isolates in different colos; correctness comes entirely from the checkpoint store. On Cloudflare a Durable Object per thread serializes concurrent resumes (two reviewers clicking at once) and holds the websocket that notifies the UI when an interrupt appears. The graph code is stateless; the Durable Object plus [D1 checkpointing](/langgraph-d1-checkpointing) is the stateful spine.

```xyflow
{
  "direction": "LR",
  "nodes": [
    {"id": "r1", "label": "request A: run", "shape": "stadium"},
    {"id": "do", "label": "Durable Object (thread t-42)", "shape": "rect"},
    {"id": "d1", "label": "D1 checkpoint store", "shape": "rect"},
    {"id": "ui", "label": "reviewer UI (ws)", "shape": "circle"},
    {"id": "r2", "label": "request B: resume", "shape": "stadium"}
  ],
  "edges": [
    {"source": "r1", "target": "do", "label": "invoke"},
    {"source": "do", "target": "d1", "label": "write checkpoint"},
    {"source": "do", "target": "ui", "label": "notify interrupt"},
    {"source": "ui", "target": "r2", "label": "human acts"},
    {"source": "r2", "target": "do", "label": "Command(resume)"},
    {"source": "do", "target": "d1", "label": "load + continue"}
  ]
}
```

### Time travel

Because every super-step is a checkpoint, the checkpoint history is a timeline. You can list past states, pick one, and resume *from there* with modified input — re-running a branch as if the bad step never happened. This is the debugging counterpart of HITL and overlaps with replay in [Agent Debugging & Observability](/agent-debugging).

```xyflow
{
  "direction": "TD",
  "nodes": [
    {"id": "c0", "label": "ckpt 0: start", "shape": "circle"},
    {"id": "c1", "label": "ckpt 1: plan", "shape": "circle"},
    {"id": "c2", "label": "ckpt 2: bad tool call", "shape": "circle"},
    {"id": "c3", "label": "ckpt 3: wrong answer", "shape": "circle"},
    {"id": "fork", "label": "resume from ckpt 1, edited", "shape": "diamond"},
    {"id": "c2b", "label": "ckpt 2': corrected branch", "shape": "stadium"}
  ],
  "edges": [
    {"source": "c0", "target": "c1"},
    {"source": "c1", "target": "c2"},
    {"source": "c2", "target": "c3"},
    {"source": "c1", "target": "fork", "label": "select past state"},
    {"source": "fork", "target": "c2b", "label": "new fork"}
  ]
}
```

## Runtime Internals

`interrupt()` works by raising a `GraphInterrupt` exception that the Pregel runtime catches at the super-step boundary. State already written by the node is committed to the checkpoint; the interrupt payload is stored alongside it. On resume, LangGraph replays the node from its start but feeds the stored resume value where `interrupt()` is called, so any pure work before the interrupt re-runs deterministically while side-effecting tools sit *after* the gate by design. This is why you place `interrupt()` *before* irreversible actions, never after.

### Batched gates and multiple reviewers

Real workflows rarely have one gate. A run may interrupt several times — approve the plan, then approve each risky tool call — and a queue of pending interrupts can accumulate across many threads waiting on a small reviewer team. The durable model handles this naturally: each interrupt is an independent checkpointed pause keyed by its thread, so a reviewer dashboard is simply a query over threads whose latest checkpoint carries an unresolved interrupt payload. Assigning, claiming, and resolving those payloads is ordinary application logic on top of the runs table, not graph machinery. The graph stays oblivious to *who* answers or *when*; it only knows that some future request will arrive bearing a `Command(resume=...)` for a specific thread. This decoupling is what lets one HITL design scale from a single-user prototype to an operations team clearing hundreds of pending approvals, and it composes with the role-scoped routing in [Agent Orchestration](/agent-orchestration) so that high-risk actions escalate to senior reviewers while routine ones clear on a junior queue.

```xyflow
{
  "direction": "TD",
  "nodes": [
    {"id": "threads", "label": "threads with pending interrupt", "shape": "rect"},
    {"id": "queue", "label": "review queue (by risk)", "shape": "rect"},
    {"id": "assign", "label": "assign to reviewer", "shape": "diamond"},
    {"id": "jr", "label": "junior: routine", "shape": "rect"},
    {"id": "sr", "label": "senior: high-risk", "shape": "rect"},
    {"id": "res", "label": "Command(resume) → thread", "shape": "stadium"}
  ],
  "edges": [
    {"source": "threads", "target": "queue", "label": "scan checkpoints"},
    {"source": "queue", "target": "assign"},
    {"source": "assign", "target": "jr", "label": "low risk"},
    {"source": "assign", "target": "sr", "label": "high risk"},
    {"source": "jr", "target": "res"},
    {"source": "sr", "target": "res"}
  ]
}
```

## Common Pitfalls

**Side effects before the interrupt.** Node code before `interrupt()` re-runs on resume; sending an email there sends it twice. **No checkpointer.** Without one, `interrupt()` cannot persist and the run cannot resume — it just errors. **Blocking the request.** Trying to `await` the human inside one request times out on Workers; the pause must return control and resume in a new request. **Thread-id reuse.** Sharing a `thread_id` across unrelated conversations leaks one user's interrupt into another's run. **Ignoring reject.** A binary approve/skip gate cannot express "do it differently"; model edit explicitly.

## Comparison

Versus a queue-and-callback system you might hand-build, LangGraph HITL keeps the pause *inside the agent's own state machine*, so the resumed run still has full context, memory, and tool history rather than a reconstructed stub. Versus static `interrupt_before`, dynamic `interrupt()` is conditional and data-aware at the cost of being explicit in node code. Versus fully autonomous agents from [Agent Architectures](/agent-architectures), HITL trades latency and a human in the path for safety on irreversible actions — the correct trade whenever a mistake is expensive.

## Cross-References

- [LangGraph](/langgraph) — the graph and super-step model HITL builds on
- [LangGraph Checkpointing on Cloudflare D1](/langgraph-d1-checkpointing) — the persistence that makes pause/resume durable
- [Agent Orchestration](/agent-orchestration) — coordinating the gated agents
- [Agent Debugging & Observability](/agent-debugging) — replay and time-travel debugging
- [LangGraph Red-Teaming](/langgraph-red-teaming) — why approval gates matter for safety
