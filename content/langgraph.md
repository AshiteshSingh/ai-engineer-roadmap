# LangGraph: Stateful Multi-Agent Graphs for Production AI

LangGraph is a framework for building stateful, multi-actor applications with Large Language Models (LLMs). It models application logic as a directed graph where nodes are computational steps and edges define control flow. LangGraph solves the problem of building reliable, production-grade agent systems that need memory, human-in-the-loop, and complex branching—capabilities that simple linear chains cannot provide. As the orchestration layer for advanced AI systems, LangGraph sits above basic LLM calls and simple chains, providing the infrastructure for sophisticated agent architectures. For foundational agent patterns, see [Agent Architectures](/agent-architectures); for multi-agent coordination, see [Multi-Agent Systems](/multi-agent-systems).

## Mental Model

### What problem does it solve?

The naive linear approach—prompt → LLM → output—fails for real-world AI applications. Simple chains cannot handle loops, conditional branching, multi-agent coordination, or persistent state across turns. Consider a customer support bot that needs to:

- Remember conversation history across multiple turns
- Decide whether to escalate to a human agent
- Execute tools like checking order status or processing refunds
- Loop back to gather more information if the initial query is ambiguous
- Support parallel execution for tasks like fetching data from multiple sources simultaneously

These requirements demand an execution model where state is first-class, control flow is dynamic, and persistence is built-in. LangGraph provides exactly this: a graph-based execution model where each node reads from and writes to a shared state object, edges can be conditional, and the entire execution can be paused, resumed, and replayed.

### The whiteboard analogy

Imagine a whiteboard where each step of a process writes its results, and the next step reads what it needs. The whiteboard persists between steps—if a step fails, you can see what was written and resume from there. Arrows on the whiteboard show which step comes next, but some arrows have conditions: "if the answer is good, go to end; otherwise, go back to research." Multiple people can write to the same whiteboard simultaneously (parallel execution), and a supervisor watches the whiteboard and decides who works next.

```xyflow
{
  "direction": "TD",
  "nodes": [
    {"id": "input", "label": "User Input", "shape": "circle"},
    {"id": "llm", "label": "LLM Call", "shape": "rect"},
    {"id": "decide", "label": "Needs Tool?", "shape": "diamond"},
    {"id": "tool", "label": "Execute Tool", "shape": "rect"},
    {"id": "output", "label": "Final Answer", "shape": "circle"}
  ],
  "edges": [
    {"source": "input", "target": "llm"},
    {"source": "llm", "target": "decide"},
    {"source": "decide", "target": "tool", "label": "yes"},
    {"source": "decide", "target": "output", "label": "no"},
    {"source": "tool", "target": "llm", "label": "loop back"}
  ]
}
```

### Hello-world in ~10 lines

Here's a minimal agent that calls an LLM, checks if it wants to use a tool, and loops until it produces a final answer:

```python
from langgraph.graph import StateGraph, START, END
from typing import TypedDict, Annotated, Literal
import operator

class AgentState(TypedDict):
    messages: Annotated[list, operator.add]
    next_action: str

def call_model(state: AgentState) -> dict:
    response = llm.invoke(state["messages"])
    return {"messages": [response], "next_action": response.tool_calls and "tool" or "final"}

def should_continue(state: AgentState) -> Literal["tool", "final"]:
    return state["next_action"]

graph = StateGraph(AgentState)
graph.add_node("model", call_model)
graph.add_conditional_edges("model", should_continue, {"tool": "tool", "final": END})
graph.add_node("tool", lambda state: {"messages": [execute_tool(state["messages"][-1])]})
graph.add_edge("tool", "model")
graph.add_edge(START, "model")
app = graph.compile()
```

This is a complete, stateful agent loop in under 15 lines. The state persists across turns, the conditional edge routes based on the LLM's decision, and the graph loops until a final answer is produced.

```xyflow
{
  "direction": "TD",
  "nodes": [
    {"id": "start", "label": "invoke()", "shape": "circle"},
    {"id": "model", "label": "call_model", "shape": "rect"},
    {"id": "decide", "label": "should_continue", "shape": "diamond"},
    {"id": "end", "label": "END", "shape": "circle"}
  ],
  "edges": [
    {"source": "start", "target": "model"},
    {"source": "model", "target": "decide"},
    {"source": "decide", "target": "end", "label": "final"},
    {"source": "decide", "target": "model", "label": "continue"}
  ]
}
```

## Core Concepts

### State

State is the heart of every LangGraph application. It's a TypedDict or Pydantic model that holds all data flowing through the graph. Key properties include immutable snapshots (each node receives a read-only view), reducer functions for merging updates from multiple nodes, and thread isolation (each conversation gets its own state namespace).

```python
from typing import TypedDict, Annotated, List
import operator
from pydantic import BaseModel

class AgentState(TypedDict):
    messages: Annotated[List[dict], operator.add]  # Reducer appends to list
    next_agent: str
    context: dict
    iteration_count: int
```

The state acts as a central hub that all nodes read from and write to. Reducers define how updates to the same key are merged when multiple nodes write in parallel.

```xyflow
{
  "direction": "TD",
  "nodes": [
    {"id": "node_a", "label": "Node A", "shape": "rect"},
    {"id": "node_b", "label": "Node B", "shape": "rect"},
    {"id": "node_c", "label": "Node C", "shape": "rect"},
    {"id": "state", "label": "STATE", "shape": "stadium"}
  ],
  "edges": [
    {"source": "node_a", "target": "state", "label": "writes"},
    {"source": "state", "target": "node_b", "label": "reads"},
    {"source": "state", "target": "node_c", "label": "reads"}
  ]
}
```

### Nodes

Nodes are Python functions (sync or async) that take the current state and return a dictionary of updates. They can be LLM calls, tool executors, human approval steps, conditional logic, or API calls.

```python
async def call_llm(state: AgentState) -> dict:
    """Call an LLM with the current conversation history."""
    response = await llm.ainvoke(state["messages"])
    return {"messages": [response]}

def execute_tool(state: AgentState) -> dict:
    """Execute a tool call from the last message."""
    tool_call = state["messages"][-1].tool_calls[0]
    result = available_tools[tool_call["name"]].invoke(tool_call["args"])
    return {"messages": [ToolMessage(content=result, tool_call_id=tool_call["id"])]}

def human_approval(state: AgentState) -> dict:
    """Pause for human approval before sensitive actions."""
    raise NodeInterrupt("Awaiting human approval for: " + str(state["pending_action"]))
```

### Edges

Edges define the control flow between nodes. Normal edges are unconditional transitions, while conditional edges are functions that inspect the state and return the name of the next node.

```python
def route_based_on_topic(state: AgentState) -> str:
    """Route to the appropriate specialist agent based on query topic."""
    if "billing" in state["messages"][0].content.lower():
        return "billing_agent"
    elif "technical" in state["messages"][0].content.lower():
        return "tech_support_agent"
    else:
        return "general_agent"

# Add conditional edges
graph.add_conditional_edges(
    "router",
    route_based_on_topic,
    {
        "billing_agent": "billing",
        "tech_support_agent": "tech_support",
        "general_agent": "general"
    }
)
```

```xyflow
{
  "direction": "TD",
  "nodes": [
    {"id": "router", "label": "Router", "shape": "diamond"},
    {"id": "agent_a", "label": "Agent A", "shape": "rect"},
    {"id": "agent_b", "label": "Agent B", "shape": "rect"}
  ],
  "edges": [
    {"source": "router", "target": "agent_a", "label": "if topic == A"},
    {"source": "router", "target": "agent_b", "label": "if topic == B"}
  ]
}
```

### Checkpointing / Persistence

Checkpointing saves the state after every node execution, enabling fault tolerance, human-in-the-loop, and time travel. LangGraph provides several checkpointer implementations:

| Checkpointer | Use Case | Persistence |
|---|---|---|
| `MemorySaver` | Development, testing | In-memory only |
| `SqliteSaver` | Single-server production | Local SQLite file |
| `PostgresSaver` | Multi-server production | PostgreSQL database |

Each `thread_id` creates an independent conversation with its own state namespace:

```python
# First conversation
result1 = app.invoke(
    {"messages": [HumanMessage(content="Hello")]},
    config={"configurable": {"thread_id": "conversation_1"}}
)

# Second conversation (completely isolated)
result2 = app.invoke(
    {"messages": [HumanMessage(content="Hi there")]},
    config={"configurable": {"thread_id": "conversation_2"}}
)
```

### Reducers

Reducers define how to merge updates to the same key from multiple nodes. The most common pattern is `operator.add` for appending to lists:

```python
from typing import Annotated
import operator

class AgentState(TypedDict):
    messages: Annotated[list, operator.add]  # Appends, doesn't overwrite
    scores: Annotated[dict, merge_dicts]     # Custom reducer for dicts
    count: int                               # No reducer = last write wins
```

Custom reducers handle more complex merge logic:

```python
def merge_dicts(current: dict, updates: dict) -> dict:
    """Merge two dicts, with updates taking priority."""
    merged = current.copy()
    merged.update(updates)
    return merged
```

### Command Object

The `Command` object allows a node to set the next node and update state in one step. This is essential for agent loops where the LLM decides the next action:

```python
from langgraph.graph import Command

def agent_node(state: AgentState) -> Command:
    """LLM decides next action and updates state simultaneously."""
    response = llm.invoke(state["messages"])
    
    if response.tool_calls:
        return Command(
            goto="tool_executor",
            update={"messages": [response]}
        )
    else:
        return Command(
            goto=END,
            update={"messages": [response]}
        )
```

## How It Works

### Graph Lifecycle

1. **Definition**: Create a `StateGraph` with a state schema, then add nodes and edges
2. **Compilation**: Compile with a checkpointer to create a `CompiledGraph`
3. **Invocation**: Call `graph.invoke(input, config)` with a thread_id
4. **Execution loop**: Load state → execute node → apply updates → save checkpoint → route to next node
5. **Termination**: Route to `END` or hit the recursion limit

```python
# 1. Definition
builder = StateGraph(AgentState)
builder.add_node("retrieve", retrieve_docs)
builder.add_node("generate", generate_answer)
builder.add_edge(START, "retrieve")
builder.add_edge("retrieve", "generate")
builder.add_edge("generate", END)

# 2. Compilation
app = builder.compile(checkpointer=PostgresSaver.from_conn_string("postgresql://..."))

# 3. Invocation
result = app.invoke(
    {"messages": [HumanMessage(content="What is LangGraph?")]},
    config={"configurable": {"thread_id": "user_123"}}
)
```

### Data Flow Step-by-Step

Here's a detailed walkthrough of a simple Q&A agent:

```python
from langgraph.graph import StateGraph, START, END
from typing import TypedDict, Annotated
import operator

class QAState(TypedDict):
    query: str
    context: str
    answer: str
    needs_retry: bool

def retrieve(state: QAState) -> dict:
    docs = vector_store.similarity_search(state["query"], k=3)
    return {"context": "\n\n".join([d.page_content for d in docs])}

def generate(state: QAState) -> dict:
    prompt = f"Context: {state['context']}\n\nQuestion: {state['query']}\n\nAnswer:"
    response = llm.invoke(prompt)
    return {"answer": response.content, "needs_retry": "I don't know" in response.content}

def check_quality(state: QAState) -> str:
    return "retry" if state["needs_retry"] else "done"

def retry(state: QAState) -> dict:
    # Expand search with different query
    expanded_query = llm.invoke(f"Generate a better search query for: {state['query']}")
    docs = vector_store.similarity_search(expanded_query.content, k=5)
    return {"context": "\n\n".join([d.page_content for d in docs]), "needs_retry": False}

# Build graph
builder = StateGraph(QAState)
builder.add_node("retrieve", retrieve)
builder.add_node("generate", generate)
builder.add_node("retry", retry)
builder.add_edge(START, "retrieve")
builder.add_edge("retrieve", "generate")
builder.add_conditional_edges("generate", check_quality, {"retry": "retry", "done": END})
builder.add_edge("retry", "generate")

app = builder.compile()

# Execute
result = app.invoke({"query": "What is the capital of France?"})
print(result["answer"])  # "The capital of France is Paris."
```

```xyflow
{
  "direction": "TD",
  "nodes": [
    {"id": "input", "label": "Input: 'What is 2+2?'", "shape": "circle"},
    {"id": "model", "label": "call_model", "shape": "rect"},
    {"id": "decide", "label": "should_continue", "shape": "diamond"},
    {"id": "tool", "label": "execute_tool", "shape": "rect"},
    {"id": "output", "label": "Output: '4'", "shape": "circle"}
  ],
  "edges": [
    {"source": "input", "target": "model"},
    {"source": "model", "target": "decide"},
    {"source": "decide", "target": "tool", "label": "tool_call"},
    {"source": "decide", "target": "output", "label": "final"},
    {"source": "tool", "target": "model"}
  ]
}
```

### Streaming Modes

LangGraph supports multiple streaming modes for real-time applications:

```python
# Stream full state after each node
for event in app.stream(input, config, stream_mode="values"):
    print(event)

# Stream only state updates from each node
for event in app.stream(input, config, stream_mode="updates"):
    print(event)

# Stream individual tokens from LLM calls
for event in app.stream(input, config, stream_mode="messages"):
    for chunk in event:
        print(chunk.content, end="", flush=True)
```

### Interrupts and Human-in-the-Loop

The `NodeInterrupt` mechanism pauses execution and waits for external input:

```python
from langgraph.errors import NodeInterrupt

def sensitive_action_node(state: AgentState) -> dict:
    """Pause before executing a sensitive action."""
    action = state["pending_action"]
    raise NodeInterrupt(
        f"Approve action: {action['type']} with params: {action['params']}"
    )

# In the frontend, resume with approved action
app.update_state(
    config,
    {"approved_action": approved_action},
    as_node="sensitive_action_node"
)
```

```xyflow
{
  "direction": "TD",
  "nodes": [
    {"id": "llm", "label": "LLM decides action", "shape": "rect"},
    {"id": "check", "label": "Needs approval?", "shape": "diamond"},
    {"id": "pause", "label": "PAUSED: Awaiting human", "shape": "stadium"},
    {"id": "execute", "label": "Execute action", "shape": "rect"},
    {"id": "continue", "label": "Continue", "shape": "circle"}
  ],
  "edges": [
    {"source": "llm", "target": "check"},
    {"source": "check", "target": "pause", "label": "yes"},
    {"source": "check", "target": "execute", "label": "no"},
    {"source": "pause", "target": "execute", "label": "approve"},
    {"source": "execute", "target": "continue"}
  ]
}
```

## Runtime Internals

### Pregel / BSP Superstep Model

LangGraph's runtime is inspired by Google's Pregel system for large-scale graph processing. Execution proceeds in **supersteps**: in each superstep, all nodes that have incoming edges from the previous superstep execute in parallel. Nodes receive messages (state updates) from the previous superstep, process them, and send messages to the next superstep. This model enables deterministic, parallel execution with bounded memory.

### Channels and Message Passing

State keys are implemented as **channels** that buffer updates. When multiple nodes write to the same channel in one superstep, the reducer merges them. Different channel types handle different merge patterns:

- **LastValueChannel**: Keeps only the most recent value (default for simple fields)
- **AppendChannel**: Accumulates values in a list (for `operator.add` reducers)
- **Custom channels**: User-defined merge logic for complex data structures

### Deterministic Replay

Because state is checkpointed after every superstep, any execution can be replayed exactly. The checkpointer stores: thread_id, step number, and state snapshot. Replay loads the state at step N, then re-executes nodes from step N+1. This is critical for debugging, testing, and auditing production systems.

```python
# Replay execution from step 5
for event in app.stream(
    None,
    config,
    stream_mode="values",
    checkpoint_id="step_5_checkpoint_id"
):
    print(event)
```

### Thread and State Isolation

Each `thread_id` gets its own state namespace in the checkpointer. Threads are completely isolated—no cross-thread state leakage. This enables multi-tenancy: one graph serving many users simultaneously without interference.

### Async Execution Model

LangGraph is fully async: nodes can be `async def` functions, and the runtime uses `asyncio.gather` for parallel node execution within a superstep. Checkpointer writes can be batched for performance in high-throughput scenarios.

```python
async def parallel_fetch(state: AgentState) -> dict:
    """Fetch multiple URLs in parallel."""
    urls = state["urls_to_fetch"]
    async with aiohttp.ClientSession() as session:
        tasks = [fetch_url(session, url) for url in urls]
        results = await asyncio.gather(*tasks)
    return {"fetched_data": results}
```

```xyflow
{
  "direction": "TD",
  "nodes": [
    {"id": "scheduler", "label": "Runtime Scheduler", "shape": "stadium"},
    {"id": "superstep", "label": "Superstep N", "shape": "rect"},
    {"id": "channel", "label": "Channel Buffer", "shape": "rect"},
    {"id": "executor", "label": "Node Executor Pool", "shape": "rect"},
    {"id": "checkpointer", "label": "Checkpointer", "shape": "rect"},
    {"id": "reducer", "label": "Reducer", "shape": "rect"}
  ],
  "edges": [
    {"source": "scheduler", "target": "superstep"},
    {"source": "scheduler", "target": "channel"},
    {"source": "superstep", "target": "executor"},
    {"source": "channel", "target": "executor"},
    {"source": "executor", "target": "checkpointer"},
    {"source": "executor", "target": "reducer"},
    {"source": "checkpointer", "target": "scheduler"},
    {"source": "reducer", "target": "scheduler"}
  ]
}
```

## Patterns

### Pattern 1: Supervisor Agent (Router)

A supervisor LLM decides which sub-agent to call next. The state includes a `next_agent` field and a shared `messages` list. Structured output (Pydantic) ensures deterministic routing.

```python
from pydantic import BaseModel

class RouterOutput(BaseModel):
    next_agent: str  # "researcher", "coder", "data_analyst", or "done"
    reasoning: str

def supervisor_node(state: AgentState) -> Command:
    """Supervisor decides which agent to call next."""
    response = llm.with_structured_output(RouterOutput).invoke(
        f"Current conversation: {state['messages']}\nDecide next agent:"
    )
    
    if response.next_agent == "done":
        return Command(goto=END, update={"next_agent": "done"})
    else:
        return Command(
            goto=response.next_agent,
            update={"next_agent": response.next_agent}
        )
```

```xyflow
{
  "direction": "TD",
  "nodes": [
    {"id": "supervisor", "label": "Supervisor", "shape": "rect"},
    {"id": "research", "label": "Research Agent", "shape": "rect"},
    {"id": "coding", "label": "Coding Agent", "shape": "rect"},
    {"id": "data", "label": "Data Agent", "shape": "rect"},
    {"id": "final", "label": "Final Answer", "shape": "circle"}
  ],
  "edges": [
    {"source": "supervisor", "target": "research", "label": "research"},
    {"source": "supervisor", "target": "coding", "label": "code"},
    {"source": "supervisor", "target": "data", "label": "data"},
    {"source": "research", "target": "supervisor"},
    {"source": "coding", "target": "supervisor"},
    {"source": "data", "target": "supervisor"},
    {"source": "supervisor", "target": "final", "label": "done"}
  ]
}
```

### Pattern 2: Parallel Tool Execution (Map-Reduce)

Use the `Send` API to fan out to multiple identical tool nodes in parallel, then aggregate results.

```python
from langgraph.graph import Send

def planner_node(state: AgentState) -> list[Send]:
    """Fan out to fetch multiple URLs in parallel."""
    urls = extract_urls(state["query"])
    return [Send("fetch_url", {"url": url, "index": i}) for i, url in enumerate(urls)]

def fetch_url_node(state: dict) -> dict:
    """Fetch a single URL."""
    content = requests.get(state["url"]).text
    return {"fetched_pages": {state["index"]: content}}

def aggregator_node(state: AgentState) -> dict:
    """Combine all fetched content."""
    all_content = "\n\n".join(state["fetched_pages"].values())
    return {"combined_content": all_content}
```

```xyflow
{
  "direction": "TD",
  "nodes": [
    {"id": "planner", "label": "Planner", "shape": "rect"},
    {"id": "fetch1", "label": "Fetch URL 1", "shape": "rect"},
    {"id": "fetch2", "label": "Fetch URL 2", "shape": "rect"},
    {"id": "fetch3", "label": "Fetch URL 3", "shape": "rect"},
    {"id": "fetchN", "label": "Fetch URL N", "shape": "rect"},
    {"id": "aggregator", "label": "Aggregator", "shape": "rect"}
  ],
  "edges": [
    {"source": "planner", "target": "fetch1"},
    {"source": "planner", "target": "fetch2"},
    {"source": "planner", "target": "fetch3"},
    {"source": "planner", "target": "fetchN"},
    {"source": "fetch1", "target": "aggregator"},
    {"source": "fetch2", "target": "aggregator"},
    {"source": "fetch3", "target": "aggregator"},
    {"source": "fetchN", "target": "aggregator"}
  ]
}
```

### Pattern 3: Human-in-the-Loop for Sensitive Actions

Interrupt before dangerous tool calls (send_email, execute_sql, delete_data), then resume with human approval.

```python
# Compile with interrupt points
app = builder.compile(
    checkpointer=PostgresSaver(...),
    interrupt_before=["send_email_node", "delete_data_node"]
)

# In production: frontend shows proposed action, human approves
# Resume with approved action
app.update_state(
    config,
    {"approved_email": {"to": "user@example.com", "subject": "Approved", "body": "..."}},
    as_node="send_email_node"
)
```

### Pattern 4: Persistent Memory with Summarization

Use PostgresSaver for long-term persistence and add a summarization node to prevent context window overflow.

```python
def summarize_messages(state: AgentState) -> dict:
    """Summarize old messages to prevent context overflow."""
    if len(state["messages"]) > 20:
        old_messages = state["messages"][:-10]
        summary = llm.invoke(f"Summarize this conversation: {old_messages}")
        return {
            "messages": state["messages"][-10:],  # Keep last 10 messages
            "summary": summary.content
        }
    return {}
```

### Pattern 5: Guardrails with Pre/Post Processing

Add validation nodes before and after the main LLM to enforce safety policies.

```python
def validate_input(state: AgentState) -> Command:
    """Check input for policy violations."""
    if contains_pii(state["messages"][-1].content):
        return Command(goto="reject", update={"error": "PII detected"})
    return Command(goto="llm")

def validate_output(state: AgentState) -> Command:
    """Check output for policy violations."""
    if contains_harmful_content(state["messages"][-1].content):
        return Command(goto="rephrase")
    return Command(goto=END)
```

```xyflow
{
  "direction": "TD",
  "nodes": [
    {"id": "input", "label": "User Input", "shape": "circle"},
    {"id": "validate_in", "label": "Validate Input", "shape": "diamond"},
    {"id": "reject", "label": "Reject", "shape": "rect"},
    {"id": "llm", "label": "LLM Call", "shape": "rect"},
    {"id": "validate_out", "label": "Validate Output", "shape": "diamond"},
    {"id": "rephrase", "label": "Rephrase", "shape": "rect"},
    {"id": "output", "label": "Final Output", "shape": "circle"}
  ],
  "edges": [
    {"source": "input", "target": "validate_in"},
    {"source": "validate_in", "target": "reject", "label": "invalid"},
    {"source": "validate_in", "target": "llm", "label": "valid"},
    {"source": "llm", "target": "validate_out"},
    {"source": "validate_out", "target": "rephrase", "label": "violation"},
    {"source": "validate_out", "target": "output", "label": "clean"},
    {"source": "rephrase", "target": "validate_out"}
  ]
}
```

## Common Pitfalls

### State Mutation Without Reducers

**Problem**: Two nodes write to the same key; the second overwrites the first.  
**Detection**: State missing expected data after parallel execution.  
**Fix**: Always define reducers for list/dict fields.

```python
# Wrong: no reducer, last write wins
class BadState(TypedDict):
    messages: list  # Will be overwritten!

# Correct: reducer appends
class GoodState(TypedDict):
    messages: Annotated[list, operator.add]  # Appends correctly
```

### Infinite Loops in Agent Executor

**Problem**: LLM keeps calling tools without producing a final answer.  
**Detection**: Graph hits recursion limit, hangs indefinitely.  
**Fix**: Set `recursion_limit` and add a `max_iterations` node.

```python
app = builder.compile(recursion_limit=25)

def check_iterations(state: AgentState) -> str:
    if state["iteration_count"] >= 10:
        return "force_final"
    return "continue"
```

### Checkpointer Bottlenecks

**Problem**: Using `MemorySaver` in production (state lost on restart).  
**Problem**: High latency from checkpoint writes on every node.  
**Fix**: Use `PostgresSaver`, batch checkpoint writes, use async.

| Checkpointer | Latency | Persistence | Use Case |
|---|---|---|---|
| MemorySaver | ~0ms | None | Development |
| SqliteSaver | ~5ms | Disk | Single server |
| PostgresSaver | ~10ms | Database | Production |

### Overly Complex Graph Topology

**Problem**: 50+ nodes, 100+ edges, impossible to debug.  
**Detection**: Visualizing the graph shows spaghetti.  
**Fix**: Use subgraphs to encapsulate complex workflows.

```python
# Encapsulate research workflow as a subgraph
research_subgraph = create_research_agent()
builder.add_node("research", research_subgraph)
```

### Ignoring Token Limits in Shared State

**Problem**: `messages` list grows unboundedly, causes context overflow.  
**Detection**: LLM starts truncating or failing on long conversations.  
**Fix**: Implement trimming/summarization node.

### Conditional Edge Functions That Raise Exceptions

**Problem**: Edge function crashes on unexpected state values.  
**Detection**: Graph fails with obscure error during routing.  
**Fix**: Add try/except in edge functions, return safe default.

```python
def safe_router(state: AgentState) -> str:
    try:
        return route_based_on_topic(state)
    except Exception:
        return "default_agent"  # Safe fallback
```

## Comparison

### LangGraph vs. AutoGen

| Aspect | LangGraph | AutoGen |
|---|---|---|
| **Architecture** | Explicit graph definition | Agent conversations |
| **State management** | Built-in checkpointing | Conversation history |
| **Control flow** | Fine-grained edge control | Agent-driven turn-taking |
| **Best for** | Production systems needing reliability | Research prototyping |

### LangGraph vs. CrewAI

| Aspect | LangGraph | CrewAI |
|---|---|---|
| **Abstraction level** | Lower-level, more flexible | Higher-level, opinionated |
| **State** | Explicit state management | Simpler context passing |
| **Persistence** | Built-in checkpointing | Custom implementation required |
| **Best for** | Complex, custom workflows | Rapid prototyping of standard patterns |

### LangGraph vs. Semantic Kernel

| Aspect | LangGraph | Semantic Kernel |
|---|---|---|
| **Ecosystem** | Python-first, LangChain ecosystem | .NET-first with Python support |
| **Orchestration** | Both use graphs, richer state management | Graph-based orchestration |
| **Integration** | LangSmith for observability | Azure AI integration |
| **Best for** | Python-centric teams | .NET/Azure shops |

### LangGraph vs. Custom Implementation

| Aspect | LangGraph | Custom |
|---|---|---|
| **Time to market** | Battle-tested runtime out of the box | Full control, but build everything |
| **Maintenance** | Actively maintained by LangChain team | Ongoing investment required |
| **Best for** | Production systems | Research/experimental needs |

## Cross-References

- [Agent Architectures: ReAct, Plan-and-Execute & Cognitive Frameworks](/agent-architectures)
- [Multi-Agent Systems: Orchestration, Delegation & Communication](/multi-agent-systems)
- [Agent Orchestration: Routing, Handoffs & Supervisor Patterns](/agent-orchestration)
- [Agent Memory: Short-term, Long-term & Episodic Memory Systems](/agent-memory)
- [Agent Debugging & Observability: Tracing, Replay & Root Cause Analysis](/agent-debugging)
- [Agent Evaluation: Reliability, Tool Use Accuracy & Trajectory Analysis](/agent-evaluation)
- [Agent Harnesses: Event Loops, Permission Models & Tool Sandboxing](/agent-harnesses)
- [Agent SDKs: Claude, OpenAI, Vercel AI SDK & Framework Comparison](/agent-sdks)
- [Function Calling & Tool Integration: APIs, Schemas & Execution](/function-calling)
- [Context Window Management: Token Budgets, Prioritization & Overflow Strategies](/context-window-management)
- [Memory Architectures for LLM Systems: Working, Episodic & Semantic Memory](/memory-architectures)
- [Production AI Patterns: Workflows, Pipelines & Architecture](/production-patterns)
- [Observability: Tracing, Logging & LLM Monitoring](/observability)
- [Red-Teaming LLM Applications with LangGraph: Graph-Based Adversarial Pipelines](/langgraph-red-teaming)
- [Conversational AI: Chatbot Design, Dialogue Management & UX](/conversational-ai)
- [Search & Recommendations with LLMs](/search-recommendations)
- [Advanced RAG: Agentic, Graph-Based & Multi-Hop Retrieval](/advanced-rag)
- [LlamaIndex](/llamaindex)
- [The AI Engineer's Roadmap: Skills, Tools & Career Path (2025+)](/ai-engineer-roadmap)