# Tool Use: Function Calling as an Agentic Pattern

Tool use is the second of the three core agentic AI patterns -- the mechanism by which a language model stops being a pure text generator and starts *taking action* in the outside world. Reading a database, hitting an HTTP endpoint, running a shell command, posting to Slack: every one of those is a tool call. The pattern shows up alongside RAG and memory in roles like the [RPM Interactive AI Product Engineer Contract](https://agentic-knowledge.vercel.app/applications/rpm-interactive-ai-product-engineer-contract). This article is the entry point: the loop, when to add a tool, when *not* to, and where to dive deeper.

## Why this is an agentic pattern

An LLM that can only emit text is a very expressive autocomplete. An LLM that can call typed functions is an *agent* -- it perceives the world (function results) and acts on it (function calls), which is the textbook definition of an agent in AI. Three things make tool use the pivot point:

1. **It separates intent from execution.** The model decides *what* to do; deterministic code decides *how*. That split is what makes tool calls debuggable, sandboxable, and rate-limitable.
2. **It composes.** A single tool call is uninteresting; a *chain* of tool calls (read → compute → write) is the foundation of every multi-step agent. See [agent-architectures](/agent-architectures) for the loop patterns.
3. **It is the only pattern that can mutate state.** RAG reads, memory remembers, but only tool use can *send the email* or *open the PR*. That is also why it is the most dangerous of the three -- see [agent-harnesses](/agent-harnesses) for permission models.

## The core loop

Tool use is a three-phase conversation between the model, the runtime, and the outside world:

```python
# 1. Declaration -- developer registers tool schemas
tools = [{
    "name": "get_weather",
    "description": "Get current weather for a city",
    "parameters": {
        "type": "object",
        "properties": {"city": {"type": "string"}},
        "required": ["city"],
    },
}]

# 2. Invocation -- model emits a structured tool call
response = llm(messages, tools=tools)
if response.tool_calls:
    call = response.tool_calls[0]
    # call.name == "get_weather", call.args == {"city": "Paris"}

    # 3. Result injection -- runtime executes, feeds result back
    result = registry[call.name](**call.args)
    messages.append({"role": "tool", "tool_call_id": call.id, "content": result})
    response = llm(messages, tools=tools)  # model now has the answer
```

Modern providers (Anthropic, OpenAI, Google) all implement variations on this protocol. The schemas are JSON Schema; the wire format differs slightly per provider; the loop is the same. Capable agents emit *parallel* tool calls (several at once) and the runtime fans out execution before re-injecting -- this is what turns a 10-step sequential agent into a 3-step parallel one.

## When to add it (and when not to)

**Reach for tool use when:**

- The model needs *fresh* information that retrieval cannot give it (live stock price, current deploy status, today's calendar).
- The task requires *side effects* -- creating a ticket, sending a message, running a query, executing code.
- You want a *deterministic* answer for a sub-step (math, date arithmetic, regex matching) -- offload it to a tool instead of letting the model hallucinate.
- The answer comes from a *system of record* (your CRM, your DB, GitHub) -- a typed tool call beats embedding the entire system into context.

**Do not reach for tool use when:**

- The information already lives in the context window -- you do not need a `read_user_message` tool.
- You can answer with a single retrieval -- prefer [rag](/rag); RAG is cheaper and easier to evaluate.
- The "tool" is a thin wrapper over the model's own capability (a `summarize` tool that just calls another LLM is usually a smell -- inline it).
- You are tempted to add 30 tools to one agent. Past ~10–15 tools, model accuracy on tool selection collapses. Split into specialized sub-agents instead -- see [multi-agent-systems](/multi-agent-systems).

A useful smell test: if a Python function with a clear signature would solve this sub-task, that is a tool. If you cannot write that signature, it is probably a *prompt*, not a tool.

## Going deeper

- [Function Calling](/function-calling) -- the deep dive: provider APIs, JSON Schema design, parallel calls, error handling, sandboxing.
- [Structured Output](/structured-output) -- tool calls are a special case of constrained decoding; this article covers the broader pattern.
- [Agent Architectures](/agent-architectures) -- ReAct, Plan-and-Execute, Reflexion: the loops that wrap tool use.
- [Agent Harnesses](/agent-harnesses) -- event loops, permission gates, human-in-the-loop approval for risky tools.
- [Code Agents](/code-agents) -- the special case where the tool is `bash` and the agent is editing files.
- [Multi-Agent Systems](/multi-agent-systems) -- when one agent's tool box gets too big.
- [LangGraph](/langgraph) -- a popular framework for orchestrating tool-using agents as state machines.

## Job-spec context

The "agentic AI patterns (RAG, tool use, memory)" trio shows up verbatim in product-engineer JDs. See the [RPM Interactive AI Product Engineer Contract](https://agentic-knowledge.vercel.app/applications/rpm-interactive-ai-product-engineer-contract) for an example role that lists this pattern as a hiring requirement -- pair this overview with the [rag](/rag) and [memory](/memory) introductions to cover the full bullet.
