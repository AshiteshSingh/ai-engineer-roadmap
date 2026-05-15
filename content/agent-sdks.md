# Agent SDKs: Claude, OpenAI, Vercel AI SDK & Framework Comparison

The proliferation of agent SDKs marks a decisive shift in AI engineering: building agents is no longer an exercise in low-level prompt plumbing but an SDK-level concern. In 2024-2025, every major model provider and framework vendor shipped dedicated agent SDKs -- Anthropic released the Claude Agent SDK, OpenAI shipped the Agents SDK (evolving from Swarm), Vercel expanded its AI SDK with multi-step agent primitives, and the framework ecosystem (LangChain/LangGraph, LlamaIndex) continued refining their agent abstractions. This article provides a deep technical comparison of these SDKs: their architectures, primitives, tradeoffs, and the practical question of when to use which. For foundational concepts on how agents reason and act, see [Agent Architectures](/agent-architectures); for tool integration mechanics, see [Function Calling](/function-calling); for stateful graph-based orchestration, see [LangGraph](/langgraph).

## Why Agent SDKs Exist

### The Abstraction Gap

Building an agent from raw API calls requires solving a surprisingly long list of infrastructure problems beyond the core LLM interaction:

```
RAW API CALL                           AGENT SDK
-----------                            ---------
messages.create()           -->        agent.run("task")
  |                                      |
  +-- manual tool dispatch               +-- automatic tool routing
  +-- manual retry logic                 +-- built-in retry/backoff
  +-- manual streaming                   +-- streaming with tool interleaving
  +-- manual context window mgmt         +-- context window management
  +-- manual conversation state          +-- state/memory management
  +-- manual multi-turn loops            +-- agentic loops with maxSteps
  +-- manual error handling              +-- structured error recovery
  +-- manual tracing                     +-- built-in observability
  +-- manual guardrails                  +-- declarative guardrails
  +-- manual multi-agent routing         +-- handoff/delegation primitives
```

Without an SDK, every agent project re-implements the same scaffolding: a loop that calls the model, parses tool calls, dispatches them, injects results, checks for termination, handles streaming, manages context window overflow, and logs everything. Agent SDKs codify these patterns into reusable primitives.

### What SDKs Abstract

All agent SDKs address the same core responsibilities, though they differ in how:

1. **The agentic loop** -- repeatedly calling the model until it produces a final response (no more tool calls). This is the `while has_tool_calls` loop that every agent needs.
2. **Tool dispatch** -- routing model-requested tool calls to the correct function, with type-safe argument parsing and result serialization.
3. **Streaming** -- delivering partial text responses to the user while tool calls execute in the background, without blocking the UI.
4. **Context management** -- handling conversation history, truncation, and summarization as context windows fill up.
5. **Multi-agent coordination** -- routing between specialized agents, handing off conversations, and managing shared state.
6. **Safety and guardrails** -- input/output validation, content filtering, and policy enforcement.
7. **Observability** -- tracing agent runs, logging tool calls, measuring latency, and debugging failures.

The divergence between SDKs lies in their design philosophy: some optimize for minimal abstraction (Claude Agent SDK, OpenAI Agents SDK), while others build opinionated frameworks with deep UI integration (Vercel AI SDK) or graph-based orchestration (LangGraph).

## Claude Agent SDK (Anthropic)

### Architecture Overview

Anthropic's approach to agent building is rooted in the Claude Messages API, where the agent loop is built around the `tool_use` content block pattern. The Claude Python SDK provides the low-level primitives, while the Claude Agent SDK (also called "claude-agent" or the agent scaffolding built into Claude Code) adds the orchestration layer.

The fundamental architecture:

```
                    +------------------+
                    |   Agent Runner   |
                    +--------+---------+
                             |
              +--------------+--------------+
              |              |              |
        +-----v----+  +-----v-----+  +-----v-----+
        |  System   |  |   Tools   |  |  Memory   |
        |  Prompt   |  | Registry  |  |  Manager  |
        +----------+  +-----+-----+  +-----------+
                             |
                    +--------v---------+
                    |  Claude Messages  |
                    |      API          |
                    +--------+---------+
                             |
              +--------------+--------------+
              |              |              |
        +-----v----+  +-----v-----+  +-----v-----+
        | tool_use  |  |   text    |  | thinking  |
        |  blocks   |  |  blocks   |  |  blocks   |
        +----------+  +-----------+  +-----------+
```

### Tool Use Blocks

Claude's tool calling uses a content block architecture where a single response can contain multiple typed blocks: `text`, `tool_use`, and `thinking`. This is fundamentally different from OpenAI's approach where tool calls are a separate field on the message object.

```python
import anthropic

client = anthropic.Anthropic()

tools = [
    {
        "name": "get_stock_price",
        "description": "Get the current stock price for a given ticker symbol.",
        "input_schema": {
            "type": "object",
            "properties": {
                "ticker": {
                    "type": "string",
                    "description": "Stock ticker symbol, e.g. AAPL"
                }
            },
            "required": ["ticker"]
        }
    }
]

# Initial request
response = client.messages.create(
    model="claude-sonnet-4-20250514",
    max_tokens=4096,
    tools=tools,
    messages=[
        {"role": "user", "content": "What is Apple's stock price?"}
    ]
)

# Response contains tool_use blocks
# response.content = [
#   TextBlock(type="text", text="I'll look up Apple's stock price."),
#   ToolUseBlock(type="tool_use", id="toolu_01A...", name="get_stock_price",
#                input={"ticker": "AAPL"})
# ]
```

The key architectural decision is that `tool_use` blocks are part of the `content` array, not a separate field. This means a single assistant message can interleave reasoning text with multiple tool invocations:

```python
# The agentic loop for Claude
def run_agent(messages, tools, max_turns=10):
    for turn in range(max_turns):
        response = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=4096,
            tools=tools,
            messages=messages
        )

        # Append assistant response
        messages.append({"role": "assistant", "content": response.content})

        # Check if we need to execute tools
        tool_use_blocks = [
            block for block in response.content
            if block.type == "tool_use"
        ]

        if not tool_use_blocks:
            # No more tool calls -- agent is done
            return response

        # Execute tools and build result message
        tool_results = []
        for tool_block in tool_use_blocks:
            result = execute_tool(tool_block.name, tool_block.input)
            tool_results.append({
                "type": "tool_result",
                "tool_use_id": tool_block.id,
                "content": str(result)
            })

        messages.append({"role": "user", "content": tool_results})

    raise RuntimeError("Agent exceeded maximum turns")
```

### Streaming with Tool Calls

Claude's streaming API emits events as Server-Sent Events (SSE). When tool calls are involved, the stream interleaves text deltas with tool use events:

```python
with client.messages.stream(
    model="claude-sonnet-4-20250514",
    max_tokens=4096,
    tools=tools,
    messages=messages
) as stream:
    for event in stream:
        if event.type == "content_block_start":
            if event.content_block.type == "tool_use":
                print(f"[Tool call starting: {event.content_block.name}]")
            elif event.content_block.type == "text":
                pass  # Text block starting
        elif event.type == "content_block_delta":
            if event.delta.type == "text_delta":
                print(event.delta.text, end="", flush=True)
            elif event.delta.type == "input_json_delta":
                # Streaming tool input JSON incrementally
                pass
        elif event.type == "message_stop":
            break

    # After stream completes, get the full message
    final_message = stream.get_final_message()
```

The streaming architecture means clients can display partial text responses to users while the model is still deciding which tools to call. The `input_json_delta` events allow progressive parsing of tool arguments, which matters for large inputs.

### Extended Thinking

Claude's extended thinking feature allows the model to perform internal reasoning before responding, producing `thinking` content blocks that capture the model's chain-of-thought. This is particularly powerful for agents because it lets the model plan tool use strategies:

```python
response = client.messages.create(
    model="claude-sonnet-4-20250514",
    max_tokens=16000,
    thinking={
        "type": "enabled",
        "budget_tokens": 10000  # Max tokens for thinking
    },
    tools=tools,
    messages=messages
)

# Response may contain thinking blocks
for block in response.content:
    if block.type == "thinking":
        print(f"[Thinking]: {block.thinking}")
    elif block.type == "text":
        print(f"[Response]: {block.text}")
    elif block.type == "tool_use":
        print(f"[Tool]: {block.name}({block.input})")
```

Extended thinking is especially useful for complex multi-tool planning where the model needs to reason about which tools to call in what order, evaluate tradeoffs between approaches, or decompose a problem before acting. The thinking budget controls the maximum reasoning depth -- higher budgets allow more sophisticated planning at the cost of latency and tokens.

### Computer Use

Claude's computer use capability turns the model into an agent that can interact with graphical user interfaces through screenshots and mouse/keyboard actions. This is implemented via specialized tools:

```python
tools = [
    {
        "type": "computer_20250124",
        "name": "computer",
        "display_width_px": 1920,
        "display_height_px": 1080,
        "display_number": 1
    },
    {
        "type": "text_editor_20250124",
        "name": "str_replace_editor"
    },
    {
        "type": "bash_20250124",
        "name": "bash"
    }
]

response = client.messages.create(
    model="claude-sonnet-4-20250514",
    max_tokens=4096,
    tools=tools,
    messages=[{
        "role": "user",
        "content": "Open the browser and navigate to example.com"
    }],
    betas=["computer-use-2025-01-24"]
)

# The model returns tool_use blocks with actions like:
# {"type": "tool_use", "name": "computer",
#  "input": {"action": "screenshot"}}
# {"type": "tool_use", "name": "computer",
#  "input": {"action": "mouse_move", "coordinate": [500, 300]}}
# {"type": "tool_use", "name": "computer",
#  "input": {"action": "click", "coordinate": [500, 300]}}
```

Computer use agents follow the same agentic loop as regular tool-use agents, but with the computer, text editor, and bash tools providing the action space. The model receives screenshots as base64-encoded images in `tool_result` messages and decides the next GUI action.

### MCP Integration

The Model Context Protocol (MCP) is Anthropic's open standard for connecting AI models to external tools and data sources. The Claude SDK integrates with MCP servers natively:

```python
from anthropic import Anthropic
from anthropic.types import ToolUnion

# MCP tools are discovered dynamically from MCP servers
# The Claude Code agent, for example, connects to MCP servers
# defined in .claude/settings.json:
# {
#   "mcpServers": {
#     "filesystem": {
#       "command": "npx",
#       "args": ["-y", "@anthropic/mcp-server-filesystem", "/path"]
#     }
#   }
# }

# At runtime, MCP tools appear as regular tools to Claude
# The SDK handles the MCP protocol transport (stdio, SSE, streamable HTTP)
```

MCP is covered in depth in its own section below. The key point here is that Claude's tool architecture (content blocks with `tool_use` and `tool_result`) maps cleanly to the MCP tool protocol, making MCP integration a natural extension of the existing SDK patterns.

## OpenAI Agents SDK

### From Swarm to Agents SDK

OpenAI's Agents SDK (released March 2025) evolved from Swarm, an experimental multi-agent framework. Where Swarm was a research prototype demonstrating patterns, the Agents SDK is a production-grade library built around three primitives: **Agent**, **Runner**, and **Handoff**.

The design philosophy is explicitly minimal: the SDK provides the smallest useful abstraction layer over the Chat Completions API, avoiding the framework complexity of LangChain while adding enough structure for reliable multi-agent systems.

```
+-------------------------------------------------------------+
|                          Runner                              |
|  +-----------+    +-----------+    +-----------+             |
|  |  Agent A  |--->|  Agent B  |--->|  Agent C  |             |
|  | (triage)  |    | (billing) |    | (support) |             |
|  +-----------+    +-----------+    +-----------+             |
|       |                |                |                    |
|  +----v----+     +-----v-----+    +-----v-----+             |
|  | Tools   |     | Tools     |    | Tools     |             |
|  | Guardr. |     | Guardr.   |    | Guardr.   |             |
|  +---------+     +-----------+    +-----------+             |
|                                                              |
|  [Tracing] [Context] [Model Settings]                        |
+-------------------------------------------------------------+
```

### Agent Primitive

An Agent encapsulates a model configuration, system prompt, tools, guardrails, and handoff targets:

```python
from agents import Agent, Runner, function_tool, handoff

@function_tool
def lookup_order(order_id: str) -> str:
    """Look up an order by its ID."""
    return f"Order {order_id}: Shipped on March 20, arriving March 25"

@function_tool
def issue_refund(order_id: str, reason: str) -> str:
    """Issue a refund for an order."""
    return f"Refund issued for order {order_id}. Reason: {reason}"

# Define specialized agents
billing_agent = Agent(
    name="Billing Agent",
    instructions="You handle billing inquiries and refunds. Be precise about amounts.",
    tools=[lookup_order, issue_refund],
    model="gpt-4o"
)

support_agent = Agent(
    name="Support Agent",
    instructions="You handle general support questions about our products.",
    tools=[lookup_order],
    model="gpt-4o-mini"  # Cheaper model for simpler tasks
)

# Triage agent routes to specialists
triage_agent = Agent(
    name="Triage Agent",
    instructions="""You are the first point of contact. Determine the nature of
    the customer's inquiry and hand off to the appropriate specialist.
    - Billing questions, refunds, payments -> Billing Agent
    - Product questions, how-to, troubleshooting -> Support Agent""",
    handoffs=[
        handoff(billing_agent),
        handoff(support_agent)
    ],
    model="gpt-4o-mini"
)
```

### Runner

The Runner executes the agentic loop. It handles the `while has_tool_calls` cycle, tool dispatch, handoff transitions, guardrail checking, and context management:

```python
# Synchronous execution
result = Runner.run_sync(
    triage_agent,
    input="I was charged twice for order #12345, can I get a refund?"
)
print(result.final_output)
# The runner: triage_agent -> handoff -> billing_agent -> lookup_order -> issue_refund -> response

# Async execution
result = await Runner.run(
    triage_agent,
    input="I was charged twice for order #12345",
    max_turns=15  # Safety limit on agentic loop iterations
)

# Streaming execution
async for event in Runner.run_streamed(
    triage_agent,
    input="Help me with my order"
):
    if event.type == "raw_response_event":
        # Streaming text chunks
        pass
    elif event.type == "agent_updated_stream_event":
        # Agent handoff occurred
        print(f"Now talking to: {event.new_agent.name}")
    elif event.type == "run_item_stream_event":
        # Tool call, tool result, or message
        pass
```

### Handoff Mechanism

Handoffs are the multi-agent primitive. When a model decides to hand off, the Runner switches the active agent, carrying conversation context forward:

```python
from agents import handoff

# Basic handoff
handoff(billing_agent)

# Handoff with custom description (influences when model chooses it)
handoff(
    billing_agent,
    tool_description_override="Transfer to billing for payment issues, "
                              "refunds, and invoice questions"
)

# Handoff with context transformation
def billing_handoff_callback(context, input_data):
    """Transform context when handing off to billing."""
    return {
        "customer_id": context.get("customer_id"),
        "priority": "high" if "refund" in input_data.lower() else "normal"
    }

handoff(billing_agent, on_handoff=billing_handoff_callback)
```

Under the hood, handoffs are implemented as tool calls: the Runner presents each handoff target as a tool the model can call, with the tool name derived from the target agent's name. When the model calls a handoff tool, the Runner swaps the active agent and continues the loop.

### Guardrails

The Agents SDK provides input and output guardrails as first-class primitives:

```python
from agents import Agent, InputGuardrail, OutputGuardrail, GuardrailFunctionOutput

# Input guardrail -- runs before the agent processes the message
async def check_prompt_injection(ctx, agent, input_data) -> GuardrailFunctionOutput:
    """Detect prompt injection attempts."""
    result = await Runner.run(
        injection_detector_agent,
        input=input_data,
        context=ctx
    )
    return GuardrailFunctionOutput(
        output_info={"injection_score": result.final_output},
        tripwire_triggered=result.final_output.get("is_injection", False)
    )

# Output guardrail -- runs after the agent produces output
async def check_pii_leakage(ctx, agent, output) -> GuardrailFunctionOutput:
    """Check that output does not contain PII."""
    contains_pii = detect_pii(output)
    return GuardrailFunctionOutput(
        output_info={"pii_detected": contains_pii},
        tripwire_triggered=contains_pii
    )

guarded_agent = Agent(
    name="Guarded Agent",
    instructions="You are a helpful assistant.",
    input_guardrails=[InputGuardrail(guardrail_function=check_prompt_injection)],
    output_guardrails=[OutputGuardrail(guardrail_function=check_pii_leakage)]
)
```

When a guardrail's `tripwire_triggered` returns `True`, the Runner raises an exception, preventing the agent's output from reaching the user.

### Tracing

The Agents SDK includes built-in tracing that captures every step of the agent run:

```python
from agents import trace, Runner

# Tracing is automatic for Runner.run calls
result = await Runner.run(agent, input="Hello")
# Traces are sent to OpenAI's tracing backend by default

# Custom trace spans
with trace("my-workflow"):
    result1 = await Runner.run(agent_a, input="Step 1")
    result2 = await Runner.run(agent_b, input=result1.final_output)

# Custom trace processors for external observability
from agents import set_trace_processors

class LangSmithProcessor:
    def process_trace(self, trace_data):
        # Send to LangSmith, Datadog, etc.
        pass

set_trace_processors([LangSmithProcessor()])
```

## Vercel AI SDK

### Design Philosophy

The Vercel AI SDK takes a fundamentally different approach from provider-specific SDKs. It is a TypeScript-first, framework-agnostic SDK that abstracts across multiple LLM providers while providing deep integration with React and Next.js. The SDK has three layers:

```
+-------------------------------------------------------+
|                    AI SDK UI                           |
|  useChat()  useCompletion()  useAssistant()           |
+-------------------------------------------------------+
|                    AI SDK RSC                          |
|  streamUI()  createStreamableUI()                     |
+-------------------------------------------------------+
|                    AI SDK Core                         |
|  generateText()  streamText()  generateObject()       |
|  streamObject()  tool()  embed()  embedMany()         |
+-------------------------------------------------------+
|                Provider Abstraction                    |
|  @ai-sdk/openai  @ai-sdk/anthropic  @ai-sdk/google   |
|  @ai-sdk/mistral  @ai-sdk/amazon-bedrock             |
+-------------------------------------------------------+
```

The critical insight is that the Vercel AI SDK is **provider-agnostic** -- the same code works with Claude, GPT-4, Gemini, or Mistral by swapping the provider. This is a sharp contrast to the Claude and OpenAI SDKs, which are tightly coupled to their respective APIs.

### Core: generateText and streamText

The foundation of agent building in the Vercel AI SDK is `generateText` with tool calling and `maxSteps`:

```typescript
import { generateText, tool } from "ai";
import { openai } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";

// Define tools with Zod schemas for type safety
const weatherTool = tool({
  description: "Get the current weather for a location",
  parameters: z.object({
    location: z.string().describe("City and state"),
    unit: z.enum(["celsius", "fahrenheit"]).optional()
  }),
  execute: async ({ location, unit }) => {
    // Actual API call here
    return { temperature: 22, condition: "sunny", location };
  }
});

const searchTool = tool({
  description: "Search the web for information",
  parameters: z.object({
    query: z.string().describe("Search query")
  }),
  execute: async ({ query }) => {
    return { results: [`Result for: ${query}`] };
  }
});

// Single-step tool call
const result = await generateText({
  model: openai("gpt-4o"),  // Swap to anthropic("claude-sonnet-4-20250514") with no other changes
  prompt: "What is the weather in Tokyo?",
  tools: { weather: weatherTool, search: searchTool }
});

// Multi-step agent with maxSteps
const agentResult = await generateText({
  model: anthropic("claude-sonnet-4-20250514"),
  system: "You are a research assistant. Use tools to gather information, "
        + "then synthesize a comprehensive answer.",
  prompt: "Compare the weather in Tokyo and London, and find recent news about both cities.",
  tools: { weather: weatherTool, search: searchTool },
  maxSteps: 10,  // Allow up to 10 tool-call rounds
  onStepFinish: ({ text, toolCalls, toolResults, stepType }) => {
    // Called after each step -- useful for logging/tracing
    console.log(`Step type: ${stepType}`);
    if (toolCalls) {
      for (const call of toolCalls) {
        console.log(`  Tool: ${call.toolName}(${JSON.stringify(call.args)})`);
      }
    }
  }
});

console.log(agentResult.text);  // Final synthesized response
console.log(agentResult.steps); // Array of all steps taken
```

The `maxSteps` parameter transforms `generateText` from a single-call function into an agentic loop. Internally, the SDK runs the same `while has_tool_calls` loop that you would write manually, but with automatic tool dispatch, result injection, and context management.

### Streaming with streamText

For real-time UIs, `streamText` provides the streaming equivalent:

```typescript
import { streamText } from "ai";

const result = streamText({
  model: openai("gpt-4o"),
  prompt: "Analyze the current market conditions",
  tools: { weather: weatherTool, search: searchTool },
  maxSteps: 5,
  onChunk: ({ chunk }) => {
    // Called for each streaming chunk
    if (chunk.type === "text-delta") {
      process.stdout.write(chunk.textDelta);
    }
  },
  onStepFinish: ({ text, toolCalls }) => {
    // Called when a step completes (text generation or tool execution)
  }
});

// Convert to a Response for API routes
return result.toDataStreamResponse();
// Or consume as a text stream
for await (const textPart of result.textStream) {
  process.stdout.write(textPart);
}
```

### React Integration: useChat

The Vercel AI SDK's most distinctive feature is its React hooks that handle the full client-server streaming lifecycle:

```typescript
// app/api/chat/route.ts (Next.js API route)
import { streamText } from "ai";
import { openai } from "@ai-sdk/openai";

export async function POST(req: Request) {
  const { messages } = await req.json();

  const result = streamText({
    model: openai("gpt-4o"),
    system: "You are a helpful assistant.",
    messages,
    tools: {
      weather: weatherTool,
      calculator: calculatorTool
    },
    maxSteps: 5
  });

  return result.toDataStreamResponse();
}

// components/Chat.tsx (React component)
"use client";
import { useChat } from "@ai-sdk/react";

export function Chat() {
  const { messages, input, handleInputChange, handleSubmit, isLoading } = useChat({
    api: "/api/chat",
    onToolCall: async ({ toolCall }) => {
      // Client-side tool execution (for tools that need browser APIs)
      if (toolCall.toolName === "getLocation") {
        const position = await navigator.geolocation.getCurrentPosition();
        return { lat: position.coords.latitude, lng: position.coords.longitude };
      }
    }
  });

  return (
    <div>
      {messages.map((m) => (
        <div key={m.id}>
          <strong>{m.role}:</strong>
          {m.content}
          {m.toolInvocations?.map((tool) => (
            <div key={tool.toolCallId}>
              Tool: {tool.toolName} -
              {tool.state === "result" ? JSON.stringify(tool.result) : "loading..."}
            </div>
          ))}
        </div>
      ))}
      <form onSubmit={handleSubmit}>
        <input value={input} onChange={handleInputChange} />
        <button type="submit" disabled={isLoading}>Send</button>
      </form>
    </div>
  );
}
```

The `useChat` hook manages the entire lifecycle: sending messages to the API route, consuming the streaming response, updating the message list in real-time, handling tool call UI states, and managing loading/error states. This eliminates hundreds of lines of streaming and state management boilerplate.

### React Server Components Integration

The AI SDK RSC layer enables streaming AI-generated UI components from the server:

```typescript
// app/actions.tsx
"use server";
import { streamUI } from "ai/rsc";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";

export async function chat(input: string) {
  const result = await streamUI({
    model: openai("gpt-4o"),
    system: "You are a helpful assistant.",
    prompt: input,
    tools: {
      showWeather: {
        description: "Show weather widget for a location",
        parameters: z.object({ location: z.string() }),
        generate: async function* ({ location }) {
          yield <div>Loading weather for {location}...</div>;
          const weather = await fetchWeather(location);
          return <WeatherCard data={weather} />;
        }
      },
      showStockChart: {
        description: "Show a stock price chart",
        parameters: z.object({ ticker: z.string() }),
        generate: async function* ({ ticker }) {
          yield <div>Loading chart for {ticker}...</div>;
          const data = await fetchStockData(ticker);
          return <StockChart ticker={ticker} data={data} />;
        }
      }
    }
  });

  return result.value;  // Returns a streamable React node
}
```

This is a fundamentally different paradigm: the model's tool calls produce React components, not JSON data. The server streams these components to the client progressively, creating a generative UI experience where the AI decides what to show and the React components render it.

## LangChain / LangGraph

### LangChain Agent Executors

LangChain's original agent abstractions center on the `AgentExecutor`, which wraps a model-driven decision loop with tool execution:

```python
from langchain_openai import ChatOpenAI
from langchain.agents import create_tool_calling_agent, AgentExecutor
from langchain_core.tools import tool
from langchain_core.prompts import ChatPromptTemplate

@tool
def search_database(query: str) -> str:
    """Search the product database for information."""
    return f"Found 3 products matching '{query}'"

@tool
def get_user_profile(user_id: str) -> str:
    """Get a user's profile information."""
    return f"User {user_id}: Premium tier, member since 2022"

llm = ChatOpenAI(model="gpt-4o")
tools = [search_database, get_user_profile]

prompt = ChatPromptTemplate.from_messages([
    ("system", "You are a helpful product assistant."),
    ("placeholder", "{chat_history}"),
    ("human", "{input}"),
    ("placeholder", "{agent_scratchpad}")
])

agent = create_tool_calling_agent(llm, tools, prompt)
executor = AgentExecutor(agent=agent, tools=tools, verbose=True, max_iterations=10)

result = executor.invoke({
    "input": "Find products related to machine learning for user U123",
    "chat_history": []
})
```

The `AgentExecutor` is now considered legacy by the LangChain team -- LangGraph is the recommended approach for new projects. However, `AgentExecutor` remains widely used and is simpler for straightforward tool-calling agents that do not need branching, parallel execution, or persistent state.

### LangGraph: Graph-Based Agents

LangGraph (covered in depth in [LangGraph](/langgraph)) models agents as state machines where nodes are computation steps and edges define control flow. The `create_react_agent` utility provides a pre-built ReAct agent as a LangGraph graph:

```python
from langgraph.prebuilt import create_react_agent
from langchain_openai import ChatOpenAI

llm = ChatOpenAI(model="gpt-4o")
agent = create_react_agent(llm, tools=[search_database, get_user_profile])

# This creates a graph with: agent_node -> should_continue -> tool_node -> agent_node
result = agent.invoke({
    "messages": [("human", "Find ML products for user U123")]
})
```

For custom agent architectures, LangGraph provides full control:

```python
from langgraph.graph import StateGraph, START, END
from langgraph.prebuilt import ToolNode
from langchain_core.messages import AnyMessage
from typing import TypedDict, Annotated
from langgraph.graph.message import add_messages

class AgentState(TypedDict):
    messages: Annotated[list[AnyMessage], add_messages]
    plan: str
    current_step: int

def planner(state: AgentState) -> dict:
    """Create a plan for the task."""
    response = llm.invoke([
        {"role": "system", "content": "Create a step-by-step plan."},
        *state["messages"]
    ])
    return {"plan": response.content, "current_step": 0}

def executor(state: AgentState) -> dict:
    """Execute the current step of the plan."""
    response = llm.bind_tools(tools).invoke([
        {"role": "system", "content": f"Execute step {state['current_step']} of: {state['plan']}"},
        *state["messages"]
    ])
    return {"messages": [response], "current_step": state["current_step"] + 1}

def should_continue(state: AgentState) -> str:
    last_message = state["messages"][-1]
    if hasattr(last_message, "tool_calls") and last_message.tool_calls:
        return "tools"
    return "end"

graph = StateGraph(AgentState)
graph.add_node("planner", planner)
graph.add_node("executor", executor)
graph.add_node("tools", ToolNode(tools))

graph.add_edge(START, "planner")
graph.add_edge("planner", "executor")
graph.add_conditional_edges("executor", should_continue, {
    "tools": "tools",
    "end": END
})
graph.add_edge("tools", "executor")

agent = graph.compile()
```

### Checkpointing and Human-in-the-Loop

LangGraph's killer feature for production agents is checkpointing -- the ability to persist agent state and resume execution later. This enables human-in-the-loop patterns where an agent pauses for approval:

```python
from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import StateGraph, START, END

checkpointer = MemorySaver()  # In production: PostgresSaver, RedisSaver

# Compile with checkpointer
agent = graph.compile(
    checkpointer=checkpointer,
    interrupt_before=["executor"]  # Pause before executing actions
)

# Start the agent
config = {"configurable": {"thread_id": "user-123"}}
result = agent.invoke(
    {"messages": [("human", "Delete all records older than 30 days")]},
    config=config
)

# Agent pauses before executor node
# Human reviews the plan and approves
print(f"Plan: {result['plan']}")

# Resume execution
result = agent.invoke(None, config=config)  # None = continue from checkpoint
```

This is architecturally distinct from what the Claude or OpenAI SDKs offer natively -- they provide the agentic loop but not persistent state management or graph-based control flow.

## LlamaIndex Agent Abstractions

### Query Engines as Tools

LlamaIndex (see [LlamaIndex](/llamaindex) for the full treatment) approaches agents from a data-centric perspective. Its primary agent pattern turns query engines into tools that an agent can invoke:

```python
from llama_index.core.agent import ReActAgent
from llama_index.core.tools import QueryEngineTool, ToolMetadata
from llama_index.core import VectorStoreIndex, SimpleDirectoryReader
from llama_index.llms.openai import OpenAI

# Build indexes over different data sources
financial_docs = SimpleDirectoryReader("./financial_reports").load_data()
financial_index = VectorStoreIndex.from_documents(financial_docs)

product_docs = SimpleDirectoryReader("./product_specs").load_data()
product_index = VectorStoreIndex.from_documents(product_docs)

# Wrap query engines as agent tools
financial_tool = QueryEngineTool(
    query_engine=financial_index.as_query_engine(),
    metadata=ToolMetadata(
        name="financial_reports",
        description="Search financial reports for revenue, expenses, and projections."
    )
)

product_tool = QueryEngineTool(
    query_engine=product_index.as_query_engine(),
    metadata=ToolMetadata(
        name="product_specs",
        description="Search product specifications and technical documentation."
    )
)

# Create a ReAct agent with these tools
agent = ReActAgent.from_tools(
    [financial_tool, product_tool],
    llm=OpenAI(model="gpt-4o"),
    verbose=True,
    max_iterations=10
)

response = agent.chat("What is the projected revenue impact of the new product line?")
```

### Sub-Question Query Engine

The Sub-Question Query Engine is LlamaIndex's approach to complex queries that span multiple data sources. It decomposes a question into sub-questions, routes each to the appropriate query engine, and synthesizes the results:

```python
from llama_index.core.query_engine import SubQuestionQueryEngine
from llama_index.core.tools import QueryEngineTool, ToolMetadata

sub_question_engine = SubQuestionQueryEngine.from_defaults(
    query_engine_tools=[financial_tool, product_tool],
    llm=OpenAI(model="gpt-4o"),
    use_async=True  # Run sub-questions in parallel
)

# This automatically decomposes into sub-questions:
# 1. "What is the projected revenue?" -> financial_reports
# 2. "What is the new product line?" -> product_specs
# Then synthesizes the combined answer
response = sub_question_engine.query(
    "What is the projected revenue impact of the new product line?"
)
```

### LlamaIndex Workflows

LlamaIndex Workflows provide an event-driven architecture for multi-step agent pipelines:

```python
from llama_index.core.workflow import Workflow, Event, StartEvent, StopEvent, step

class QueryEvent(Event):
    query: str
    source: str

class ResultEvent(Event):
    result: str
    source: str

class ResearchWorkflow(Workflow):
    @step
    async def decompose(self, ev: StartEvent) -> list[QueryEvent]:
        """Break the query into sub-questions."""
        # Use LLM to decompose
        sub_queries = await self.decompose_query(ev.query)
        return [QueryEvent(query=q, source=s) for q, s in sub_queries]

    @step
    async def search(self, ev: QueryEvent) -> ResultEvent:
        """Search each data source."""
        result = await self.query_engines[ev.source].aquery(ev.query)
        return ResultEvent(result=str(result), source=ev.source)

    @step
    async def synthesize(self, ev: list[ResultEvent]) -> StopEvent:
        """Combine results into a final answer."""
        combined = "\n".join(f"[{r.source}]: {r.result}" for r in ev)
        answer = await self.llm.acomplete(f"Synthesize: {combined}")
        return StopEvent(result=str(answer))
```

## Comparison Matrix

The following matrix compares the major agent SDKs across key dimensions:

```
+------------------+-------------+-------------+-----------+------------+------------+
|    Feature       |   Claude    |   OpenAI    |  Vercel   | LangGraph  | LlamaIndex |
|                  |    SDK      | Agents SDK  |  AI SDK   |            |            |
+==================+=============+=============+===========+============+============+
| Language         | Python, TS  | Python      | TypeScript| Python, JS | Python, TS |
+------------------+-------------+-------------+-----------+------------+------------+
| Provider Lock-in | Anthropic   | OpenAI      | None      | None       | None       |
+------------------+-------------+-------------+-----------+------------+------------+
| Streaming        | SSE blocks  | SSE events  | Data      | Async      | Streaming  |
|                  |             |             | streams   | generators | callbacks  |
+------------------+-------------+-------------+-----------+------------+------------+
| Tool Calling     | tool_use    | function    | tool()    | @tool +    | Tool +     |
|                  | blocks      | tool calls  | + Zod     | bind_tools | Metadata   |
+------------------+-------------+-------------+-----------+------------+------------+
| Type Safety      | Pydantic    | Pydantic    | Zod       | Pydantic   | Pydantic   |
|                  |             |             | (native)  |            |            |
+------------------+-------------+-------------+-----------+------------+------------+
| Multi-Agent      | Manual      | Handoffs    | Manual    | StateGraph | Workflows  |
|                  |             | (built-in)  |           | (native)   |            |
+------------------+-------------+-------------+-----------+------------+------------+
| Memory/State     | Manual      | Context obj | useChat   | Checkpoint | ChatMemory |
|                  |             |             | state     | (persist.) | Buffer     |
+------------------+-------------+-------------+-----------+------------+------------+
| Guardrails       | Manual      | Built-in    | Manual    | Manual     | Manual     |
|                  |             | (I/O)       |           |            |            |
+------------------+-------------+-------------+-----------+------------+------------+
| Tracing          | Manual      | Built-in    | Manual    | LangSmith  | Callbacks  |
|                  |             |             | (+ 3rd)   | (native)   |            |
+------------------+-------------+-------------+-----------+------------+------------+
| Graph Control    | No          | No          | No        | Yes        | Workflows  |
|                  |             |             |           | (native)   | (events)   |
+------------------+-------------+-------------+-----------+------------+------------+
| Human-in-Loop    | Manual      | Manual      | Manual    | interrupt_ | Manual     |
|                  |             |             |           | before/    |            |
|                  |             |             |           | after      |            |
+------------------+-------------+-------------+-----------+------------+------------+
| UI Integration   | None        | None        | React     | LangGraph  | None       |
|                  |             |             | (deep)    | Studio     |            |
+------------------+-------------+-------------+-----------+------------+------------+
| Computer Use     | Native      | No          | No        | Via tools  | No         |
+------------------+-------------+-------------+-----------+------------+------------+
| MCP Support      | Native      | Partial     | Community | Community  | Community  |
+------------------+-------------+-------------+-----------+------------+------------+
| Extended Think.  | Native      | No          | Via       | Via        | Via        |
|                  |             |             | provider  | provider   | provider   |
+------------------+-------------+-------------+-----------+------------+------------+
| Abstraction      | Low         | Low-Medium  | Medium    | High       | High       |
| Level            |             |             |           |            |            |
+------------------+-------------+-------------+-----------+------------+------------+
```

## SDK Selection Criteria

### Decision Framework

Choosing an agent SDK is a multi-dimensional decision. The following framework organizes the key tradeoffs:

```
START
  |
  v
Do you need provider flexibility?
  |                    |
  YES                  NO (committed to one provider)
  |                    |
  v                    v
React/Next.js app?    Which provider?
  |         |          |           |
  YES       NO         Anthropic   OpenAI
  |         |          |           |
  v         v          v           v
Vercel    LangGraph   Claude      OpenAI
AI SDK    (or custom)  SDK        Agents SDK
  |
  v
Need graph-based control flow?
  |            |
  YES          NO
  |            |
  v            v
LangGraph    Vercel AI SDK
             (with maxSteps)
```

### When to Use Each SDK

**Claude Agent SDK** -- Choose when:
- You are building on Anthropic's models and want the thinnest abstraction layer
- You need computer use (GUI automation) or extended thinking
- You need native MCP server integration
- You want full control over the agentic loop without framework opinions
- Your team works primarily in Python

**OpenAI Agents SDK** -- Choose when:
- You are building on OpenAI's models with multi-agent workflows
- You need built-in guardrails for input/output validation
- You want structured multi-agent handoffs without building routing yourself
- You need built-in tracing for debugging agent behavior
- You value the simplicity of the Agent/Runner/Handoff model

**Vercel AI SDK** -- Choose when:
- You are building a web application with React or Next.js
- You need to support multiple LLM providers from a single codebase
- Streaming UI with real-time tool call visualization matters
- You want TypeScript-native type safety with Zod schemas
- You need React Server Components integration for generative UI
- Your team is TypeScript-first

**LangGraph** -- Choose when:
- You need graph-based control flow with branching, parallel execution, and cycles
- Human-in-the-loop approval gates are a core requirement
- You need persistent agent state with checkpointing
- You are building complex multi-agent systems with shared state
- You need the LangSmith observability ecosystem
- Your workflow is too complex for a simple agentic loop

**LlamaIndex** -- Choose when:
- Your agent is primarily a RAG system that queries over structured/unstructured data
- You have multiple data sources that need to be queried as tools
- The sub-question decomposition pattern fits your use case
- You need the data ingestion pipeline (loaders, node parsers, indexes) alongside agents
- Your agent is data-retrieval-centric rather than action-centric

### Tradeoffs

| Dimension | Thin SDKs (Claude, OpenAI) | Framework SDKs (LangGraph, LlamaIndex) | Hybrid (Vercel AI) |
|-----------|---------------------------|---------------------------------------|-------------------|
| Learning curve | Low | High | Medium |
| Vendor lock-in | High (provider) | Low (provider), High (framework) | Low |
| Flexibility | Maximum | Constrained by abstractions | Good within patterns |
| Boilerplate | More manual code | Less manual code | Least for web apps |
| Debugging | Direct API visibility | Abstraction layers to trace through | Provider-specific |
| Upgrades | API-stable | Framework version churn | Moderate |

## MCP: Model Context Protocol

### Architecture

MCP (Model Context Protocol) is Anthropic's open standard for connecting AI models to external tools, data sources, and capabilities. It provides a universal interface that any SDK can implement, rather than each SDK defining its own tool protocol.

```
+-------------------+          +-------------------+
|    MCP Client     |  <---->  |    MCP Server     |
| (Agent / SDK)     |  JSON-   | (Tool Provider)   |
|                   |  RPC     |                   |
| - Discovers tools |  over    | - Exposes tools   |
| - Calls tools     |  stdio/  | - Exposes prompts |
| - Reads resources |  HTTP/   | - Exposes resources|
+-------------------+  SSE     +-------------------+
        |                              |
        v                              v
  Any LLM Provider               Any Data Source
  (Claude, GPT, etc.)           (DB, API, Filesystem)
```

### Protocol Primitives

MCP defines three categories of capabilities:

1. **Tools** -- Functions the model can invoke (same as function calling, but standardized)
2. **Resources** -- Data the model can read (files, database records, API responses)
3. **Prompts** -- Pre-built prompt templates the server exposes

```typescript
// MCP Server example (TypeScript)
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
  name: "database-tools",
  version: "1.0.0"
});

// Expose a tool
server.tool(
  "query_database",
  "Execute a read-only SQL query against the database",
  {
    sql: z.string().describe("The SQL query to execute"),
    database: z.string().describe("Database name")
  },
  async ({ sql, database }) => {
    const result = await db.query(sql);
    return {
      content: [{ type: "text", text: JSON.stringify(result) }]
    };
  }
);

// Expose a resource
server.resource(
  "schema://tables",
  "Database table schemas",
  async () => {
    const schemas = await db.getSchemas();
    return {
      contents: [{ uri: "schema://tables", text: JSON.stringify(schemas) }]
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
```

### MCP Across SDKs

The power of MCP is that it decouples tool definition from the agent SDK. An MCP server written once can be used by any client:

```
MCP Server: "database-tools"
    |
    +-- Claude Code (native MCP support)
    +-- Claude Agent SDK (via MCP client library)
    +-- Vercel AI SDK (via community adapter)
    +-- LangChain (via langchain-mcp-adapters)
    +-- Any custom agent (via MCP client SDK)
```

In practice, Claude Code and the Claude SDK have the deepest MCP integration, since Anthropic created the protocol. Other SDKs typically connect via adapter libraries that translate MCP tools into their native tool format.

```python
# LangChain MCP adapter example
from langchain_mcp_adapters import create_tools_from_mcp_server

# Connect to an MCP server and get LangChain-compatible tools
tools = await create_tools_from_mcp_server(
    server_command="npx",
    server_args=["-y", "@anthropic/mcp-server-filesystem", "/data"]
)

# Use these tools with any LangChain agent
agent = create_react_agent(llm, tools)
```

MCP is significant because it solves the tool fragmentation problem: instead of writing a Slack integration for Claude, another for GPT, another for LangChain, you write one MCP server and every client can use it. This is analogous to how LSP (Language Server Protocol) standardized IDE integrations.

## Building SDK-Agnostic Agents

### The Abstraction Layer Pattern

For organizations that need to switch between providers or use multiple providers, an abstraction layer decouples agent logic from SDK specifics:

```typescript
// types.ts -- Provider-agnostic interfaces
interface AgentTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;  // JSON Schema
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}

interface AgentConfig {
  model: string;
  provider: "anthropic" | "openai" | "google";
  systemPrompt: string;
  tools: AgentTool[];
  maxSteps: number;
}

interface AgentResult {
  text: string;
  toolCalls: Array<{ name: string; args: unknown; result: unknown }>;
  steps: number;
  usage: { inputTokens: number; outputTokens: number };
}

interface AgentProvider {
  run(config: AgentConfig, input: string): Promise<AgentResult>;
  stream(config: AgentConfig, input: string): AsyncIterable<AgentEvent>;
}
```

The Vercel AI SDK already provides much of this abstraction natively through its provider system. But if you need lower-level control or want to include providers the Vercel SDK does not support, you build the adapter yourself:

```typescript
// adapters/anthropic-adapter.ts
import Anthropic from "@anthropic-ai/sdk";

class AnthropicAdapter implements AgentProvider {
  private client: Anthropic;

  constructor() {
    this.client = new Anthropic();
  }

  async run(config: AgentConfig, input: string): Promise<AgentResult> {
    const tools = config.tools.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters
    }));

    const messages: Anthropic.MessageParam[] = [
      { role: "user", content: input }
    ];
    const allToolCalls: AgentResult["toolCalls"] = [];

    for (let step = 0; step < config.maxSteps; step++) {
      const response = await this.client.messages.create({
        model: config.model,
        max_tokens: 4096,
        system: config.systemPrompt,
        tools,
        messages
      });

      messages.push({ role: "assistant", content: response.content });

      const toolUseBlocks = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
      );

      if (toolUseBlocks.length === 0) {
        const textContent = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map(b => b.text)
          .join("");

        return {
          text: textContent,
          toolCalls: allToolCalls,
          steps: step + 1,
          usage: {
            inputTokens: response.usage.input_tokens,
            outputTokens: response.usage.output_tokens
          }
        };
      }

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of toolUseBlocks) {
        const tool = config.tools.find(t => t.name === block.name);
        const result = await tool!.execute(block.input as Record<string, unknown>);
        allToolCalls.push({ name: block.name, args: block.input, result });
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify(result)
        });
      }

      messages.push({ role: "user", content: toolResults });
    }

    throw new Error("Agent exceeded maximum steps");
  }

  async *stream(config: AgentConfig, input: string): AsyncIterable<AgentEvent> {
    // Streaming implementation...
  }
}
```

```typescript
// adapters/openai-adapter.ts
import OpenAI from "openai";

class OpenAIAdapter implements AgentProvider {
  private client: OpenAI;

  constructor() {
    this.client = new OpenAI();
  }

  async run(config: AgentConfig, input: string): Promise<AgentResult> {
    const tools: OpenAI.ChatCompletionTool[] = config.tools.map(t => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters
      }
    }));

    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: "system", content: config.systemPrompt },
      { role: "user", content: input }
    ];
    const allToolCalls: AgentResult["toolCalls"] = [];

    for (let step = 0; step < config.maxSteps; step++) {
      const response = await this.client.chat.completions.create({
        model: config.model,
        tools,
        messages
      });

      const choice = response.choices[0];
      messages.push(choice.message);

      if (!choice.message.tool_calls?.length) {
        return {
          text: choice.message.content ?? "",
          toolCalls: allToolCalls,
          steps: step + 1,
          usage: {
            inputTokens: response.usage?.prompt_tokens ?? 0,
            outputTokens: response.usage?.completion_tokens ?? 0
          }
        };
      }

      for (const toolCall of choice.message.tool_calls) {
        const tool = config.tools.find(t => t.name === toolCall.function.name);
        const args = JSON.parse(toolCall.function.arguments);
        const result = await tool!.execute(args);
        allToolCalls.push({ name: toolCall.function.name, args, result });
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(result)
        });
      }
    }

    throw new Error("Agent exceeded maximum steps");
  }

  async *stream(config: AgentConfig, input: string): AsyncIterable<AgentEvent> {
    // Streaming implementation...
  }
}
```

### The Factory Pattern

With adapters in place, a factory selects the right provider at runtime:

```typescript
// agent-factory.ts
function createAgentProvider(provider: AgentConfig["provider"]): AgentProvider {
  switch (provider) {
    case "anthropic": return new AnthropicAdapter();
    case "openai": return new OpenAIAdapter();
    case "google": return new GoogleAdapter();
    default: throw new Error(`Unknown provider: ${provider}`);
  }
}

// Usage -- provider-agnostic agent
const config: AgentConfig = {
  model: "claude-sonnet-4-20250514",
  provider: "anthropic",
  systemPrompt: "You are a helpful research assistant.",
  tools: [searchTool, calculatorTool],
  maxSteps: 10
};

const provider = createAgentProvider(config.provider);
const result = await provider.run(config, "What is the GDP of France?");

// Switch to OpenAI by changing two fields:
config.provider = "openai";
config.model = "gpt-4o";
const openaiResult = await createAgentProvider(config.provider).run(config, "Same question");
```

This pattern trades some provider-specific features (extended thinking, handoffs, computer use) for portability. In practice, most production systems start with one provider and rarely switch, so the Vercel AI SDK's built-in provider abstraction is usually sufficient without building a custom layer.

## The Same Agent, Four Ways

To make the SDK differences concrete, here is the same task -- a weather research agent that checks multiple cities and synthesizes a summary -- implemented with each SDK.

### Claude SDK

```python
import anthropic
import json

client = anthropic.Anthropic()

tools = [{
    "name": "get_weather",
    "description": "Get current weather for a city",
    "input_schema": {
        "type": "object",
        "properties": {
            "city": {"type": "string"}
        },
        "required": ["city"]
    }
}]

def get_weather(city: str) -> dict:
    # Simulated weather data
    data = {"Tokyo": 22, "London": 14, "New York": 18}
    return {"city": city, "temp_c": data.get(city, 20), "condition": "partly cloudy"}

messages = [{"role": "user", "content": "Compare the weather in Tokyo, London, and New York."}]

while True:
    response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=4096,
        system="You are a weather analyst. Check each city and provide a comparison.",
        tools=tools,
        messages=messages
    )
    messages.append({"role": "assistant", "content": response.content})

    tool_blocks = [b for b in response.content if b.type == "tool_use"]
    if not tool_blocks:
        final_text = "".join(b.text for b in response.content if b.type == "text")
        print(final_text)
        break

    results = []
    for block in tool_blocks:
        result = get_weather(**block.input)
        results.append({
            "type": "tool_result",
            "tool_use_id": block.id,
            "content": json.dumps(result)
        })
    messages.append({"role": "user", "content": results})
```

### OpenAI Agents SDK

```python
from agents import Agent, Runner, function_tool

@function_tool
def get_weather(city: str) -> str:
    """Get current weather for a city."""
    data = {"Tokyo": 22, "London": 14, "New York": 18}
    temp = data.get(city, 20)
    return f'{{"city": "{city}", "temp_c": {temp}, "condition": "partly cloudy"}}'

weather_agent = Agent(
    name="Weather Analyst",
    instructions="You are a weather analyst. Check each city and provide a comparison.",
    tools=[get_weather],
    model="gpt-4o"
)

result = Runner.run_sync(
    weather_agent,
    input="Compare the weather in Tokyo, London, and New York."
)
print(result.final_output)
```

### Vercel AI SDK

```typescript
import { generateText, tool } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";

const weatherTool = tool({
  description: "Get current weather for a city",
  parameters: z.object({
    city: z.string()
  }),
  execute: async ({ city }) => {
    const data: Record<string, number> = { Tokyo: 22, London: 14, "New York": 18 };
    return { city, temp_c: data[city] ?? 20, condition: "partly cloudy" };
  }
});

const result = await generateText({
  model: anthropic("claude-sonnet-4-20250514"),
  system: "You are a weather analyst. Check each city and provide a comparison.",
  prompt: "Compare the weather in Tokyo, London, and New York.",
  tools: { getWeather: weatherTool },
  maxSteps: 5
});

console.log(result.text);
```

### LangGraph

```python
from langgraph.prebuilt import create_react_agent
from langchain_openai import ChatOpenAI
from langchain_core.tools import tool

@tool
def get_weather(city: str) -> str:
    """Get current weather for a city."""
    data = {"Tokyo": 22, "London": 14, "New York": 18}
    temp = data.get(city, 20)
    return f"City: {city}, Temperature: {temp}C, Condition: partly cloudy"

llm = ChatOpenAI(model="gpt-4o")
agent = create_react_agent(
    llm,
    tools=[get_weather],
    prompt="You are a weather analyst. Check each city and provide a comparison."
)

result = agent.invoke({
    "messages": [("human", "Compare the weather in Tokyo, London, and New York.")]
})
final_message = result["messages"][-1]
print(final_message.content)
```

The differences are revealing. The Claude SDK requires you to write the agentic loop yourself (maximum control, maximum boilerplate). The OpenAI Agents SDK provides the Runner to handle the loop. The Vercel AI SDK provides `maxSteps` as a parameter. LangGraph wraps everything in a pre-built ReAct graph. Each represents a different point on the abstraction spectrum.

## Advanced Patterns

### Multi-Model Routing Within an SDK

A powerful pattern is routing between models within the same agent based on task complexity. The Vercel AI SDK makes this particularly natural:

```typescript
import { generateText, tool } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";

// Use a cheap model for classification
const classificationResult = await generateText({
  model: openai("gpt-4o-mini"),
  prompt: `Classify this task as "simple" or "complex": ${userInput}`,
});

const isComplex = classificationResult.text.includes("complex");

// Route to the appropriate model
const result = await generateText({
  model: isComplex
    ? anthropic("claude-sonnet-4-20250514")   // Complex: use Claude
    : openai("gpt-4o-mini"),                  // Simple: use cheap model
  system: "You are a helpful assistant.",
  prompt: userInput,
  tools: agentTools,
  maxSteps: isComplex ? 10 : 3
});
```

### Structured Output Across SDKs

All modern SDKs support structured output, but the mechanisms differ. Here is a side-by-side comparison of extracting a typed object:

```typescript
// Vercel AI SDK -- generateObject with Zod
import { generateObject } from "ai";
import { z } from "zod";

const { object } = await generateObject({
  model: openai("gpt-4o"),
  schema: z.object({
    sentiment: z.enum(["positive", "negative", "neutral"]),
    confidence: z.number().min(0).max(1),
    topics: z.array(z.string())
  }),
  prompt: "Analyze: 'The new product launch exceeded expectations'"
});
// object is fully typed: { sentiment: "positive", confidence: 0.92, topics: ["product", "launch"] }
```

```python
# Claude SDK -- tool_use with forced tool choice
response = client.messages.create(
    model="claude-sonnet-4-20250514",
    max_tokens=1024,
    tools=[{
        "name": "analyze_sentiment",
        "description": "Analyze the sentiment of text",
        "input_schema": {
            "type": "object",
            "properties": {
                "sentiment": {"type": "string", "enum": ["positive", "negative", "neutral"]},
                "confidence": {"type": "number", "minimum": 0, "maximum": 1},
                "topics": {"type": "array", "items": {"type": "string"}}
            },
            "required": ["sentiment", "confidence", "topics"]
        }
    }],
    tool_choice={"type": "tool", "name": "analyze_sentiment"},
    messages=[{"role": "user", "content": "Analyze: 'The new product launch exceeded expectations'"}]
)
```

```python
# OpenAI SDK -- response_format with json_schema
response = client.chat.completions.create(
    model="gpt-4o",
    response_format={
        "type": "json_schema",
        "json_schema": {
            "name": "sentiment_analysis",
            "schema": {
                "type": "object",
                "properties": {
                    "sentiment": {"type": "string", "enum": ["positive", "negative", "neutral"]},
                    "confidence": {"type": "number"},
                    "topics": {"type": "array", "items": {"type": "string"}}
                },
                "required": ["sentiment", "confidence", "topics"]
            }
        }
    },
    messages=[{"role": "user", "content": "Analyze: 'The new product launch exceeded expectations'"}]
)
```

The Vercel AI SDK's approach is the most ergonomic for TypeScript developers because the Zod schema provides both runtime validation and compile-time types. The Claude SDK uses forced tool choice as its structured output mechanism. OpenAI provides both the `response_format` parameter and strict function calling.

### Error Recovery Patterns

Robust agents need strategies for recovering from tool failures. Here is a pattern that works across SDKs:

```typescript
// Vercel AI SDK -- tool with error handling
const robustSearchTool = tool({
  description: "Search with automatic fallback",
  parameters: z.object({ query: z.string() }),
  execute: async ({ query }) => {
    try {
      return await primarySearch(query);
    } catch (error) {
      // Return error info to the model so it can adapt
      return {
        error: true,
        message: `Search failed: ${error instanceof Error ? error.message : "Unknown error"}`,
        suggestion: "Try rephrasing the query or using a different approach"
      };
    }
  }
});
```

The key insight is that tool errors should be returned to the model as structured data, not thrown as exceptions. This allows the model to reason about the failure and try alternative approaches -- a critical property for resilient agents.

## Production Considerations

### Latency Budget

Agent latency is dominated by the number of LLM round-trips. Each step in the agentic loop requires a full model inference. With typical latencies:

```
Single LLM call:     200ms - 2s   (depending on model, tokens)
Tool execution:       50ms - 5s   (depending on external API)
Full agent run:       1s - 30s    (2-10 steps typical)
Complex multi-agent:  5s - 120s   (with handoffs and planning)
```

SDK choice affects latency through:
- **Streaming support**: Vercel AI SDK and Claude SDK provide real-time streaming that makes perceived latency lower
- **Parallel tool execution**: All SDKs support parallel tool calls when the model requests them, but the SDK must handle concurrent dispatch
- **Connection pooling**: Provider-specific SDKs often have optimized connection handling

### Token Costs

Each step in the agentic loop consumes input tokens (entire conversation history) plus output tokens (response). The cost grows quadratically with conversation length because each step replays all previous messages:

```
Step 1: system + user                    = ~500 input tokens
Step 2: system + user + asst + tool_res  = ~1200 input tokens
Step 3: system + ... + more history      = ~2000 input tokens
Step N: system + all previous turns      = ~500 * N input tokens

Total input cost ~ 500 * N * (N+1) / 2 tokens for N steps
```

This is why `maxSteps` / `max_turns` limits are critical -- an unbounded agent loop can exhaust budgets rapidly.

### Observability

Production agents require tracing at multiple levels:

1. **Run-level**: Overall agent execution time, success/failure, total tokens
2. **Step-level**: Each model call and tool execution
3. **Token-level**: Input/output token counts per step for cost attribution

The OpenAI Agents SDK provides built-in tracing. LangGraph integrates with LangSmith. The Claude and Vercel AI SDKs require external instrumentation (LangSmith, Langfuse, Datadog, or custom solutions). See [Observability](/observability) for a broader treatment of LLM application monitoring.

## Where the Ecosystem Is Heading

Several trends are shaping the evolution of agent SDKs:

**MCP as the universal tool layer.** As MCP adoption grows, the tool definition problem increasingly separates from the SDK choice. You write MCP servers once and connect them to any client. This reduces the importance of SDK-specific tool APIs and shifts the competitive advantage to orchestration, streaming, and developer experience.

**Convergence on primitives.** All SDKs are converging on the same core primitives: tools (function calling), structured output (schema-constrained generation), streaming (real-time partial responses), and multi-step loops (agentic execution). The differences are increasingly about ergonomics and ecosystem rather than capabilities.

**Graph-based control flow going mainstream.** LangGraph demonstrated that complex agents need explicit control flow. Other SDKs are beginning to incorporate similar patterns -- the OpenAI Agents SDK's handoffs are a simple form of graph routing, and the Vercel AI SDK community is exploring graph-based extensions.

**Type safety as a requirement.** The success of Zod-based tool definitions in the Vercel AI SDK and Pydantic in Python SDKs has established that agents need schema validation at every boundary: tool inputs, tool outputs, structured responses, and state transitions. SDKs that lack this are at a growing disadvantage.

**Multi-modal agents.** Computer use (Claude), code interpreter (OpenAI), and image/video generation tools are expanding the agent action space beyond text. SDKs need to handle binary content (screenshots, files, audio) flowing through the tool pipeline, which requires richer content block types and streaming formats.

For guidance on structuring agent reasoning, see [Agent Architectures](/agent-architectures). For the details of tool integration mechanics across providers, see [Function Calling](/function-calling). For multi-agent patterns, see [Multi-Agent Systems](/multi-agent-systems). For graph-based orchestration in depth, see [LangGraph](/langgraph). For the LlamaIndex data framework, see [LlamaIndex](/llamaindex). For agent orchestration patterns at scale, see [Agent Orchestration](/agent-orchestration). For agent harness design principles, see [Agent Harnesses](/agent-harnesses).
