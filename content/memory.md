# Memory: Persistence as an Agentic Pattern

Memory is the third of the three core agentic AI patterns -- the discipline of giving an agent state that *survives* a single LLM call. Without memory, every conversation starts from a blank slate, every preference has to be re-stated, every mistake gets repeated. The pattern shows up alongside RAG and tool use in roles like the [RPM Interactive AI Product Engineer Contract](https://agentic-knowledge.vercel.app/applications/rpm-interactive-ai-product-engineer-contract). This article is the entry point: the types, the loop, when to add memory, when *not* to, and where to dive deeper.

## Why this is an agentic pattern

An LLM is stateless. Every call is a pure function of `(prompt, weights) → tokens`. That is fine for a chatbot that answers one-shot questions; it is not fine for an agent that is expected to *learn from yesterday*, *remember what the user prefers*, or *avoid the mistake it made last week*.

Memory is what closes that loop. It turns an agent from a function into a *process* -- something with continuity. Three things make memory agentic rather than just "a database":

1. **The agent decides what to remember.** A capable agent does not blindly log every turn; it summarizes, extracts entities, and stores only what will matter later. That decision is the agent's, and it can be evaluated.
2. **Retrieval at write time, not just read time.** When new information arrives, the agent retrieves *related* memories first, decides if the new info contradicts or extends them, and updates accordingly. This is how memory avoids becoming an append-only log of duplicates.
3. **Memory is a tool the agent calls.** In modern stacks, `remember(fact)` and `recall(query)` are tools the model invokes -- which means memory composes cleanly with [tool-use](/tool-use) and shares the same evaluation surface.

## The four memory types

Every agent memory architecture decomposes into the same four types, mirroring cognitive science:

| Type | Lifetime | Lives in | Example |
|------|----------|----------|---------|
| **Working** | One turn | Context window | The current message + last 10 turns |
| **Short-term** | One session | Redis / in-process | Today's running summary, scratchpad |
| **Long-term semantic** | Forever | Vector DB | "User prefers Python over JavaScript" |
| **Long-term episodic** | Forever | Vector DB + timestamps | "Last Tuesday we tried fix X and it failed because Y" |

Working memory is what context engineering optimizes -- see [context-window-management](/context-window-management). The other three are what people *mean* when they say "give my agent memory."

## The core loop

The minimum viable memory loop wraps an LLM call in a read-then-write sandwich:

```python
def chat(user_msg, user_id):
    # 1. Recall -- pull relevant memories before generating
    relevant = memory_store.search(
        query=user_msg,
        filter={"user_id": user_id},
        k=5,
    )

    # 2. Generate -- inject memories into the prompt
    system = f"""You are an assistant. Known facts about this user:
{format_memories(relevant)}"""
    response = llm(system=system, messages=[{"role": "user", "content": user_msg}])

    # 3. Reflect -- decide what to write back
    new_facts = extract_facts(user_msg, response)
    for fact in new_facts:
        # Dedupe / merge against existing memories
        existing = memory_store.search(query=fact, filter={"user_id": user_id}, k=1)
        if not existing or not is_duplicate(fact, existing[0]):
            memory_store.upsert(fact, metadata={"user_id": user_id, "ts": now()})

    return response
```

Production systems add: forgetting (TTL on stale facts), conflict resolution (user updated their preference), summarization (collapse 100 episodic memories into one semantic one), and importance scoring (not every utterance deserves to be remembered). MemGPT, Letta, and the LangGraph memory store are all implementations of this loop.

## When to add it (and when not to)

**Reach for memory when:**

- The agent will see the *same user* across multiple sessions and needs to remember preferences, history, or unfinished work.
- Tasks span longer than the context window -- coding agents on a multi-day refactor, research agents accumulating findings.
- The agent needs to *learn from its own mistakes* -- remembering "this approach failed last time because Z" is episodic memory.
- You want personalization without fine-tuning. Memory + RAG is the cheap path to a personalized agent.

**Do not reach for memory when:**

- Each session is independent and short. A customer-support bouncer that just routes the call does not need memory.
- The "memory" is really *retrieval over a fixed corpus* -- that is [rag](/rag), not memory. The distinction: RAG sources are written by humans ahead of time; memory is written by the agent during use.
- Privacy or compliance forbid storing user utterances. Memory is a regulated surface (PII, retention, right-to-be-forgotten) -- adopt it deliberately.
- You have not yet evaluated the memory-less agent. Memory adds two failure modes (stale facts, contradictory facts) on top of every existing failure mode -- skip until you need it.

A useful smell test: if the user would be *annoyed* that the agent forgot something between sessions, you need memory. If they would not notice, you do not.

## Going deeper

- [Agent Memory](/agent-memory) -- the deep dive: MemGPT, Generative Agents, working / long-term / episodic architectures.
- [Memory Architectures](/memory-architectures) -- the systems-level view: storage backends, retrieval policies, forgetting strategies.
- [Context Window Management](/context-window-management) -- working memory in practice: token budgets, sliding windows, summarization.
- [Context Engineering](/context-engineering) -- the discipline of choosing what the model sees on each turn.
- [Context Compression](/context-compression) -- summarization and distillation for long-running sessions.
- [Dynamic Context Assembly](/dynamic-context-assembly) -- composing memory + retrieval + system prompt at call time.

## Job-spec context

The "agentic AI patterns (RAG, tool use, memory)" trio shows up verbatim in product-engineer JDs. See the [RPM Interactive AI Product Engineer Contract](https://agentic-knowledge.vercel.app/applications/rpm-interactive-ai-product-engineer-contract) for an example role that lists this pattern as a hiring requirement -- pair this overview with the [rag](/rag) and [tool-use](/tool-use) introductions to cover the full bullet.
