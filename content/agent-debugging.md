# Agent Debugging & Observability: Tracing, Replay & Root Cause Analysis

Debugging AI agents is fundamentally harder than debugging traditional software -- or even standalone LLM applications. A conventional web service processes a request through a deterministic code path: given the same input and state, you get the same output. A standalone LLM call is stochastic but self-contained: one prompt in, one completion out. An agent, by contrast, produces a trajectory -- a branching, multi-step sequence of reasoning, tool calls, observations, and decisions where each step depends on every previous step, the external environment's state, and the non-deterministic behavior of the underlying language model. When an agent fails, the root cause might be a bad reasoning step at turn 3 that only manifests as a wrong answer at turn 15. The context window at the point of failure might look completely different from what a developer expects. A tool might return an unexpected result that the agent misinterprets silently. This article provides a comprehensive treatment of the techniques, tools, and patterns needed to make agent behavior visible, reproducible, and debuggable -- from low-level tracing instrumentation to production monitoring and alerting. (For foundational concepts on evaluating agent trajectories, see [Agent Evaluation](/agent-evaluation). For broader LLM observability patterns, see [Observability](/observability).)

## TL;DR

- Agent debugging is uniquely hard because failures are non-deterministic, multi-step, context-dependent, and often involve external tool interactions that change between runs.
- Tracing is the foundational primitive: structured traces with spans for each agent step (LLM call, tool invocation, reasoning) provide the raw data needed for all debugging workflows.
- Agent-specific observability requires tracking the full context window contents at each step, not just inputs and outputs -- the reasoning chain and accumulated context are where bugs hide.
- Replay is the most powerful debugging technique: capture complete traces so you can deterministically replay failed runs by injecting recorded LLM responses and tool outputs.
- Cost and latency tracking per step is essential for production agents -- a single runaway loop can consume thousands of dollars in API costs before anyone notices.
- Production monitoring must go beyond error rates to track trajectory-level anomalies: unusual step counts, cost spikes, repeated tool calls, and context window saturation.

## Why Agent Debugging Is Uniquely Hard

Before diving into solutions, it is worth understanding precisely why agent debugging resists conventional approaches. These are not minor inconveniences -- they are structural properties of agent systems that require purpose-built tooling.

### Non-Determinism at Every Step

Each LLM call in an agent loop introduces stochasticity. Even with temperature set to zero, API providers do not guarantee bitwise-identical outputs across calls due to batching, quantization, and infrastructure changes. This means an agent that succeeds on one run may fail on the next, with identical inputs and identical tool implementations. Reproducing a failure requires capturing not just the initial input but the exact LLM response at every step.

### Cascading Context Dependence

An agent's step N depends on the accumulated context from steps 1 through N-1. A subtle change in wording at step 3 -- perhaps the LLM phrased a tool query slightly differently -- can cascade into a completely different trajectory by step 10. This makes it impossible to debug step 10 in isolation. You need the full history.

```
Step 1: Reason -> "I should search for revenue data"
Step 2: Tool call -> search("company revenue 2024")
Step 3: Observation -> "Revenue was $4.2B in fiscal year 2024"
Step 4: Reason -> "Now I need the previous year for comparison"
Step 5: Tool call -> search("company revenue 2023")
Step 6: Observation -> "No results found"            <-- unexpected
Step 7: Reason -> "I'll try a different query"
Step 8: Tool call -> search("company annual report 2023")
Step 9: Observation -> "Revenue was $3.8B"
Step 10: Reason -> "Growth was 10.5%"                <-- correct

vs. an alternate trajectory where step 6 returns different results:

Step 6': Observation -> "Company revenue 2023: see table on page 12"
Step 7': Reason -> "The search returned a reference, not a number. I'll extract it."
Step 8': Tool call -> extract_table("page 12")       <-- different tool entirely
Step 9': Observation -> [error: tool not available]
Step 10': Reason -> "I cannot extract tables. I'll estimate."  <-- wrong path
```

### External State Mutations

Agents interact with the world. A coding agent writes files. A data agent runs SQL queries. An email agent sends messages. These side effects mean that:

1. The environment changes between runs, making reproduction harder.
2. Failed runs may leave partial state that affects subsequent attempts.
3. You cannot safely "replay" a failed run without mocking external interactions.

### The Observation Gap

In traditional debugging, you can set a breakpoint and inspect all local variables. In agent debugging, the critical state is the LLM's internal reasoning -- which you can only observe through the text it generates. If the model reasons incorrectly but does not externalize that reasoning (or externalizes it ambiguously), the bug is invisible in the trace.

### Failure Modes Are Agent-Specific

Agents fail in ways that have no analog in conventional software:

```
+---------------------------+-------------------------------------------+
| Failure Mode              | Why It's Hard to Debug                    |
+---------------------------+-------------------------------------------+
| Infinite loop             | Agent repeats actions but context grows,  |
|                           | so each iteration looks slightly different |
+---------------------------+-------------------------------------------+
| Hallucinated tool call    | Agent invokes a tool that doesn't exist   |
|                           | or passes malformed arguments             |
+---------------------------+-------------------------------------------+
| Context overflow          | Critical info pushed out of context       |
|                           | window -- agent "forgets" earlier steps   |
+---------------------------+-------------------------------------------+
| Premature termination     | Agent declares success too early, missing |
|                           | subtasks or validation steps              |
+---------------------------+-------------------------------------------+
| Tool misinterpretation    | Agent misreads tool output and proceeds   |
|                           | on false assumptions                      |
+---------------------------+-------------------------------------------+
| Planning failure          | Agent's initial plan is wrong but it      |
|                           | executes it faithfully                    |
+---------------------------+-------------------------------------------+
```

## Tracing Fundamentals: Spans, Traces, and Events

Tracing is the foundational layer for all agent debugging. Without structured traces, debugging an agent is like debugging a distributed system with only `print("here")` statements.

### The Trace Model for Agents

A trace represents a single agent run from start to finish. It contains spans -- named, timed segments of execution -- arranged in a hierarchy. For agents, the natural hierarchy is:

```
Trace: "answer_user_question"
|
+-- Span: "agent_loop" (root span)
    |
    +-- Span: "step_1"
    |   +-- Span: "llm_call" (model: gpt-4, tokens_in: 1200, tokens_out: 150)
    |   +-- Span: "tool_call" (tool: search, input: "revenue data")
    |   +-- Span: "tool_result" (output: "Revenue was $4.2B...")
    |
    +-- Span: "step_2"
    |   +-- Span: "llm_call" (model: gpt-4, tokens_in: 1580, tokens_out: 95)
    |   +-- Span: "tool_call" (tool: calculator, input: "4.2 / 3.8")
    |   +-- Span: "tool_result" (output: "1.1052...")
    |
    +-- Span: "step_3"
        +-- Span: "llm_call" (model: gpt-4, tokens_in: 1900, tokens_out: 200)
        +-- Span: "final_answer" (output: "Revenue grew 10.5%...")
```

Each span carries attributes (key-value metadata), events (timestamped log entries), and status (ok, error). The critical insight for agents is that spans must capture agent-specific data: the full prompt sent to the LLM, the complete response, tool call arguments, tool outputs, and the running token count.

### OpenTelemetry for Agents

OpenTelemetry (OTel) provides a vendor-neutral standard for traces, metrics, and logs. While it was designed for distributed systems, it maps well onto agent execution. Here is a foundational tracing setup:

```python
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource
import json
import time

# Initialize the tracer provider with agent-specific resource attributes
resource = Resource.create({
    "service.name": "research-agent",
    "service.version": "1.2.0",
    "agent.framework": "custom",
    "agent.model": "gpt-4-turbo",
})

provider = TracerProvider(resource=resource)
processor = BatchSpanProcessor(
    OTLPSpanExporter(endpoint="http://localhost:4317")
)
provider.add_span_processor(processor)
trace.set_tracer_provider(provider)

tracer = trace.get_tracer("agent.core")


class TracedAgent:
    """Agent with comprehensive OpenTelemetry tracing."""

    def __init__(self, llm_client, tools: dict, max_steps: int = 20):
        self.llm = llm_client
        self.tools = tools
        self.max_steps = max_steps

    def run(self, task: str) -> str:
        with tracer.start_as_current_span(
            "agent_run",
            attributes={
                "agent.task": task,
                "agent.max_steps": self.max_steps,
                "agent.tools_available": json.dumps(list(self.tools.keys())),
            },
        ) as root_span:
            messages = [{"role": "system", "content": self._system_prompt()}]
            messages.append({"role": "user", "content": task})
            total_tokens = 0
            total_cost = 0.0

            for step_num in range(self.max_steps):
                with tracer.start_as_current_span(
                    f"step_{step_num}",
                    attributes={"agent.step_number": step_num},
                ) as step_span:

                    # --- LLM Call ---
                    with tracer.start_as_current_span("llm_call") as llm_span:
                        prompt_tokens = self._count_tokens(messages)
                        llm_span.set_attribute(
                            "llm.prompt_tokens", prompt_tokens
                        )
                        llm_span.set_attribute(
                            "llm.prompt_content",
                            json.dumps(messages[-3:]),  # last 3 messages
                        )

                        start = time.monotonic()
                        response = self.llm.chat(messages)
                        latency = time.monotonic() - start

                        completion_tokens = response.usage.completion_tokens
                        llm_span.set_attribute(
                            "llm.completion_tokens", completion_tokens
                        )
                        llm_span.set_attribute("llm.latency_ms", latency * 1000)
                        llm_span.set_attribute(
                            "llm.response_content", response.content[:2000]
                        )

                        step_cost = self._calculate_cost(
                            prompt_tokens, completion_tokens
                        )
                        total_tokens += prompt_tokens + completion_tokens
                        total_cost += step_cost
                        llm_span.set_attribute("llm.step_cost_usd", step_cost)

                    # --- Parse action ---
                    action = self._parse_action(response.content)

                    if action["type"] == "final_answer":
                        step_span.set_attribute("agent.action", "final_answer")
                        root_span.set_attribute(
                            "agent.total_steps", step_num + 1
                        )
                        root_span.set_attribute(
                            "agent.total_tokens", total_tokens
                        )
                        root_span.set_attribute(
                            "agent.total_cost_usd", total_cost
                        )
                        root_span.set_attribute("agent.outcome", "success")
                        return action["content"]

                    # --- Tool Call ---
                    with tracer.start_as_current_span("tool_call") as tool_span:
                        tool_name = action["tool"]
                        tool_input = action["input"]
                        tool_span.set_attribute("tool.name", tool_name)
                        tool_span.set_attribute(
                            "tool.input", json.dumps(tool_input)[:1000]
                        )

                        if tool_name not in self.tools:
                            tool_span.set_status(
                                trace.StatusCode.ERROR,
                                f"Unknown tool: {tool_name}",
                            )
                            tool_span.set_attribute(
                                "tool.error", "hallucinated_tool"
                            )
                            observation = f"Error: tool '{tool_name}' not found"
                        else:
                            try:
                                start = time.monotonic()
                                observation = self.tools[tool_name](tool_input)
                                tool_latency = time.monotonic() - start
                                tool_span.set_attribute(
                                    "tool.latency_ms", tool_latency * 1000
                                )
                                tool_span.set_attribute(
                                    "tool.output", str(observation)[:2000]
                                )
                            except Exception as e:
                                tool_span.set_status(
                                    trace.StatusCode.ERROR, str(e)
                                )
                                tool_span.record_exception(e)
                                observation = f"Error: {e}"

                    messages.append(
                        {"role": "assistant", "content": response.content}
                    )
                    messages.append(
                        {"role": "user", "content": f"Observation: {observation}"}
                    )

            # Max steps exceeded
            root_span.set_attribute("agent.outcome", "max_steps_exceeded")
            root_span.set_attribute("agent.total_steps", self.max_steps)
            root_span.set_attribute("agent.total_tokens", total_tokens)
            root_span.set_attribute("agent.total_cost_usd", total_cost)
            root_span.set_status(
                trace.StatusCode.ERROR, "Agent exceeded maximum steps"
            )
            return "Failed: exceeded maximum steps"
```

### Structured Logging for Agent Loops

While traces provide the hierarchical view, structured logs fill in the narrative detail. The key principle is to log at the semantic level of the agent, not at the code level:

```python
import structlog
import hashlib

logger = structlog.get_logger("agent")


def create_agent_logger(run_id: str):
    """Create a logger bound to a specific agent run."""
    return logger.bind(
        run_id=run_id,
        component="agent_loop",
    )


class LoggedAgentStep:
    """Captures full agent step context for structured logging."""

    def __init__(self, run_id: str, step_num: int):
        self.log = create_agent_logger(run_id).bind(step=step_num)

    def log_llm_request(self, messages: list, model: str):
        # Hash the full prompt for deduplication without storing it
        prompt_hash = hashlib.sha256(
            json.dumps(messages).encode()
        ).hexdigest()[:12]
        self.log.info(
            "llm_request",
            model=model,
            message_count=len(messages),
            prompt_hash=prompt_hash,
            last_message_role=messages[-1]["role"],
            last_message_preview=messages[-1]["content"][:200],
        )

    def log_llm_response(self, response, latency_ms: float):
        self.log.info(
            "llm_response",
            latency_ms=round(latency_ms, 1),
            prompt_tokens=response.usage.prompt_tokens,
            completion_tokens=response.usage.completion_tokens,
            finish_reason=response.finish_reason,
            content_preview=response.content[:200],
        )

    def log_tool_call(self, tool_name: str, tool_input: dict):
        self.log.info(
            "tool_call",
            tool=tool_name,
            input_keys=list(tool_input.keys()),
            input_preview=json.dumps(tool_input)[:300],
        )

    def log_tool_result(self, tool_name: str, output: str, latency_ms: float):
        self.log.info(
            "tool_result",
            tool=tool_name,
            output_length=len(output),
            output_preview=output[:300],
            latency_ms=round(latency_ms, 1),
        )

    def log_reasoning(self, thought: str):
        self.log.info(
            "reasoning",
            thought_preview=thought[:500],
            thought_length=len(thought),
        )

    def log_error(self, error_type: str, message: str, **kwargs):
        self.log.error(
            "agent_error",
            error_type=error_type,
            message=message,
            **kwargs,
        )
```

## Agent-Specific Observability

Generic application observability (request rates, error rates, latency percentiles) is necessary but not sufficient for agents. Agent-specific observability requires tracking three additional dimensions: reasoning chains, tool interaction sequences, and context window evolution.

### Tracking Reasoning Chains

The agent's reasoning is the most valuable signal for debugging, yet it is often discarded or stored only as unstructured text. Structured reasoning tracking means parsing and indexing the agent's thoughts:

```python
from dataclasses import dataclass, field
from enum import Enum


class ReasoningType(Enum):
    PLANNING = "planning"         # Agent forming a plan
    ANALYSIS = "analysis"         # Agent analyzing information
    DECISION = "decision"         # Agent choosing between options
    REFLECTION = "reflection"     # Agent evaluating its own progress
    ERROR_RECOVERY = "recovery"   # Agent responding to an error


@dataclass
class ReasoningStep:
    step_number: int
    reasoning_type: ReasoningType
    content: str
    references_steps: list[int] = field(default_factory=list)
    confidence: float | None = None  # if model provides it
    alternatives_considered: list[str] = field(default_factory=list)


@dataclass
class ReasoningChain:
    run_id: str
    steps: list[ReasoningStep] = field(default_factory=list)

    def add_step(self, step: ReasoningStep):
        self.steps.append(step)

    def detect_loops(self, similarity_threshold: float = 0.85) -> list[tuple]:
        """Detect reasoning loops where the agent revisits similar thoughts."""
        loops = []
        for i, step_a in enumerate(self.steps):
            for j, step_b in enumerate(self.steps[i + 2 :], start=i + 2):
                similarity = self._compute_similarity(
                    step_a.content, step_b.content
                )
                if similarity > similarity_threshold:
                    loops.append((i, j, similarity))
        return loops

    def detect_plan_drift(self) -> list[dict]:
        """Detect when the agent's actions diverge from its stated plan."""
        planning_steps = [
            s for s in self.steps
            if s.reasoning_type == ReasoningType.PLANNING
        ]
        if not planning_steps:
            return []

        original_plan = planning_steps[0]
        drifts = []
        for step in self.steps:
            if step.reasoning_type == ReasoningType.DECISION:
                alignment = self._compute_similarity(
                    original_plan.content, step.content
                )
                if alignment < 0.3:
                    drifts.append({
                        "step": step.step_number,
                        "plan_alignment": alignment,
                        "content": step.content[:200],
                    })
        return drifts

    def _compute_similarity(self, text_a: str, text_b: str) -> float:
        # In practice, use embeddings (e.g., sentence-transformers)
        # For illustration, use simple Jaccard similarity on word sets
        words_a = set(text_a.lower().split())
        words_b = set(text_b.lower().split())
        if not words_a or not words_b:
            return 0.0
        return len(words_a & words_b) / len(words_a | words_b)
```

### Tool Call Sequence Analysis

Tool calls form a machine-readable sub-trace within the larger agent trace. Analyzing tool call sequences can reveal patterns invisible in raw logs:

```python
@dataclass
class ToolCallRecord:
    step: int
    tool_name: str
    input_args: dict
    output: str
    latency_ms: float
    success: bool
    error: str | None = None


class ToolSequenceAnalyzer:
    """Analyze patterns in an agent's tool usage."""

    def __init__(self, tool_calls: list[ToolCallRecord]):
        self.calls = tool_calls

    def repeated_calls(self, max_allowed: int = 3) -> list[dict]:
        """Find tools called repeatedly with similar arguments."""
        from collections import Counter

        # Group by (tool_name, arg_hash)
        call_signatures = []
        for tc in self.calls:
            sig = f"{tc.tool_name}:{json.dumps(tc.input_args, sort_keys=True)}"
            call_signatures.append(sig)

        counts = Counter(call_signatures)
        return [
            {"signature": sig, "count": count}
            for sig, count in counts.items()
            if count > max_allowed
        ]

    def error_cascades(self) -> list[list[ToolCallRecord]]:
        """Detect sequences of consecutive tool failures."""
        cascades = []
        current_cascade = []
        for tc in self.calls:
            if not tc.success:
                current_cascade.append(tc)
            else:
                if len(current_cascade) >= 2:
                    cascades.append(current_cascade)
                current_cascade = []
        if len(current_cascade) >= 2:
            cascades.append(current_cascade)
        return cascades

    def unused_tools(self, available_tools: set[str]) -> set[str]:
        """Identify tools the agent never used -- may indicate
        the agent doesn't know about them or can't figure out when
        to use them."""
        used = {tc.tool_name for tc in self.calls}
        return available_tools - used

    def tool_transition_matrix(self) -> dict[str, dict[str, int]]:
        """Build a transition matrix showing which tools tend to
        follow which other tools. Useful for spotting unexpected patterns."""
        matrix: dict[str, dict[str, int]] = {}
        for i in range(len(self.calls) - 1):
            current = self.calls[i].tool_name
            next_tool = self.calls[i + 1].tool_name
            if current not in matrix:
                matrix[current] = {}
            matrix[current][next_tool] = matrix[current].get(next_tool, 0) + 1
        return matrix
```

### Context Window Tracking

One of the most insidious agent failure modes is context overflow -- when the accumulated messages exceed the model's context window, causing either truncation (losing early information) or outright failure. Tracking context window usage per step is essential:

```python
import tiktoken


class ContextWindowTracker:
    """Track context window utilization across agent steps."""

    def __init__(self, model: str, max_context_tokens: int):
        self.model = model
        self.max_tokens = max_context_tokens
        self.encoder = tiktoken.encoding_for_model(model)
        self.history: list[dict] = []

    def record_step(self, step: int, messages: list[dict]):
        total_tokens = sum(
            len(self.encoder.encode(m["content"])) for m in messages
        )
        utilization = total_tokens / self.max_tokens

        entry = {
            "step": step,
            "total_tokens": total_tokens,
            "utilization": utilization,
            "message_count": len(messages),
            "remaining_tokens": self.max_tokens - total_tokens,
        }
        self.history.append(entry)
        return entry

    def predict_overflow_step(self) -> int | None:
        """Estimate at which future step the context will overflow,
        based on the token growth rate observed so far."""
        if len(self.history) < 2:
            return None

        # Linear regression on token growth
        steps = [h["step"] for h in self.history]
        tokens = [h["total_tokens"] for h in self.history]
        n = len(steps)
        sum_x = sum(steps)
        sum_y = sum(tokens)
        sum_xy = sum(s * t for s, t in zip(steps, tokens))
        sum_xx = sum(s * s for s in steps)

        denom = n * sum_xx - sum_x * sum_x
        if denom == 0:
            return None

        slope = (n * sum_xy - sum_x * sum_y) / denom
        intercept = (sum_y - slope * sum_x) / n

        if slope <= 0:
            return None  # not growing

        overflow_step = (self.max_tokens - intercept) / slope
        return int(overflow_step)

    def get_growth_report(self) -> dict:
        if not self.history:
            return {}
        return {
            "current_utilization": self.history[-1]["utilization"],
            "current_tokens": self.history[-1]["total_tokens"],
            "max_tokens": self.max_tokens,
            "steps_recorded": len(self.history),
            "predicted_overflow_step": self.predict_overflow_step(),
            "tokens_per_step_avg": (
                self.history[-1]["total_tokens"] / len(self.history)
                if self.history
                else 0
            ),
        }
```

## Trace Visualization

Raw trace data is only useful if you can see patterns in it. Agent traces require specialized visualization beyond standard distributed-tracing flame graphs.

### Flame Graphs for Agent Runs

A flame graph shows the hierarchical span structure with time on the x-axis. For agents, this reveals where time is spent -- typically dominated by LLM calls, with tool calls as a secondary contributor:

```
|<======================== agent_run (total: 45.2s) ========================>|
|                                                                            |
|<--- step_0 (8.1s) --->|<--- step_1 (12.3s) -->|<-- step_2 (6.4s) -->|...|
|                        |                        |                     |   |
|[llm 2.1s][tool 5.8s]  |[llm 3.2s][tool 8.9s]  |[llm 2.4s][tool 3.8s|   |
|          |             |          |             |          |          |   |
|          [db_query]    |          [api_call]    |          [search]   |   |
|                        |          [retry 4.2s]  |                    |   |
```

This immediately reveals that step 1 took the longest due to a tool retry, which is the kind of insight that's invisible in logs.

### Step-by-Step Replay View

The most useful visualization for agent debugging is a step-by-step replay that shows, for each step: (1) the full context sent to the LLM, (2) the LLM's response, (3) the parsed action, (4) the tool result, and (5) cumulative metrics. Here is a data structure that supports this view:

```python
@dataclass
class AgentStepSnapshot:
    """Complete snapshot of agent state at a single step,
    sufficient for replay and visualization."""
    step_number: int
    timestamp: float

    # What the LLM saw
    context_messages: list[dict]  # Full message list sent to LLM
    context_token_count: int

    # What the LLM produced
    llm_response: str
    llm_latency_ms: float
    prompt_tokens: int
    completion_tokens: int

    # Parsed action
    action_type: str  # "tool_call" | "final_answer" | "reasoning_only"
    tool_name: str | None
    tool_input: dict | None
    tool_output: str | None
    tool_latency_ms: float | None
    tool_error: str | None

    # Cumulative metrics
    cumulative_tokens: int
    cumulative_cost_usd: float
    cumulative_tool_calls: int


class TraceReplayer:
    """Replay an agent trace step by step, enabling
    interactive debugging."""

    def __init__(self, snapshots: list[AgentStepSnapshot]):
        self.snapshots = sorted(snapshots, key=lambda s: s.step_number)

    def get_step(self, n: int) -> AgentStepSnapshot:
        return self.snapshots[n]

    def get_context_diff(self, step_a: int, step_b: int) -> dict:
        """Show what changed in the context between two steps."""
        a = self.snapshots[step_a].context_messages
        b = self.snapshots[step_b].context_messages
        return {
            "messages_added": len(b) - len(a),
            "new_messages": b[len(a):],
            "token_growth": (
                self.snapshots[step_b].context_token_count
                - self.snapshots[step_a].context_token_count
            ),
        }

    def find_divergence_point(
        self, other_trace: "TraceReplayer"
    ) -> int | None:
        """Compare two traces of the same task and find where they diverge.
        Useful for understanding non-determinism."""
        for i, (a, b) in enumerate(
            zip(self.snapshots, other_trace.snapshots)
        ):
            if a.action_type != b.action_type:
                return i
            if a.tool_name != b.tool_name:
                return i
            if a.tool_input != b.tool_input:
                return i
        return None

    def summarize(self) -> str:
        """Generate a human-readable summary of the trace."""
        lines = []
        for s in self.snapshots:
            if s.action_type == "tool_call":
                status = "OK" if not s.tool_error else f"ERR: {s.tool_error}"
                lines.append(
                    f"  Step {s.step_number}: {s.tool_name}"
                    f"({json.dumps(s.tool_input)[:60]}) -> {status}"
                    f" [{s.llm_latency_ms:.0f}ms LLM"
                    f" + {s.tool_latency_ms:.0f}ms tool]"
                )
            elif s.action_type == "final_answer":
                lines.append(
                    f"  Step {s.step_number}: ANSWER"
                    f" -> {s.llm_response[:80]}..."
                )
            else:
                lines.append(
                    f"  Step {s.step_number}: THINK"
                    f" -> {s.llm_response[:80]}..."
                )

        last = self.snapshots[-1]
        lines.append(f"\n  Total: {len(self.snapshots)} steps,"
                     f" {last.cumulative_tokens} tokens,"
                     f" ${last.cumulative_cost_usd:.4f}")
        return "\n".join(lines)
```

### Decision Tree Views

When an agent considers multiple options at a step (e.g., "I could search for X or query database for Y"), a decision tree view shows the branching structure of the agent's deliberation:

```
                         [Task: "Find Q3 revenue"]
                                   |
                    [Plan: search -> calculate -> answer]
                                   |
                         [Step 1: search("Q3 revenue")]
                                   |
                    +---------- [Result: not found] ----------+
                    |                                         |
          [Step 2a: search("quarterly     [Step 2b: search("annual
           earnings report")]              report Q3")]
                    |                                |
           [Result: found PDF]            [Result: found table]
                    |                                |
          [Step 3a: extract_table()]      [Step 3b: parse_table()]
                    |                                |
               [ERROR]                        [Success: $4.2B]
                                                     |
                                            [Answer: "$4.2B"]
```

In practice, agents do not explore multiple branches simultaneously (unless you implement tree-of-thought search). But visualizing the counterfactual branches -- "what would have happened if the agent had chosen differently" -- is valuable for evaluation. This requires either running the agent multiple times or injecting alternative tool responses during replay.

## Observability Platforms

Several platforms have emerged specifically for LLM and agent observability. They differ in focus, pricing, and integration depth.

### LangSmith

LangSmith (by LangChain) is the most tightly integrated option for LangChain-based agents, but it supports any LLM application via its SDK. Key capabilities:

- **Automatic tracing** of LangChain/LangGraph agent runs with full span hierarchy.
- **Datasets and evaluators** for running agent evals against curated test cases.
- **Playground** for replaying individual LLM calls with modified prompts.
- **Annotation queues** for human labeling of agent traces.
- **Comparison views** for A/B testing different agent configurations.

```python
# LangSmith tracing setup (works with any Python code, not just LangChain)
import os
os.environ["LANGCHAIN_TRACING_V2"] = "true"
os.environ["LANGCHAIN_API_KEY"] = "ls__..."
os.environ["LANGCHAIN_PROJECT"] = "research-agent-v2"

from langsmith import traceable, Client
from langsmith.run_helpers import get_current_run_tree

client = Client()


@traceable(name="agent_step", run_type="chain")
def agent_step(messages: list, step_num: int) -> dict:
    """Each decorated function becomes a span in LangSmith."""
    response = call_llm(messages)
    action = parse_action(response)

    if action["type"] == "tool_call":
        tool_result = execute_tool(action["tool"], action["input"])
        return {
            "response": response,
            "action": action,
            "tool_result": tool_result,
        }
    return {"response": response, "action": action}


@traceable(name="full_agent_run", run_type="chain")
def run_agent(task: str) -> str:
    """The outer function creates the root trace."""
    messages = [{"role": "user", "content": task}]
    for step in range(20):
        result = agent_step(messages, step)
        if result["action"]["type"] == "final_answer":
            return result["action"]["content"]
        messages.append({"role": "assistant", "content": result["response"]})
        messages.append({
            "role": "user",
            "content": f"Observation: {result['tool_result']}",
        })
    return "Max steps exceeded"


# After runs, query traces programmatically
runs = client.list_runs(
    project_name="research-agent-v2",
    filter='eq(status, "error")',
    limit=10,
)
for run in runs:
    print(f"Failed run {run.id}: {run.error}")
    # Get child runs (individual steps)
    children = client.list_runs(
        project_name="research-agent-v2",
        filter=f'eq(parent_run_id, "{run.id}")',
    )
    for child in children:
        print(f"  Step: {child.name}, status={child.status}")
```

### Langfuse

Langfuse is an open-source alternative that offers self-hosting. Its model is slightly different -- it uses "generations" (LLM calls) and "traces" as first-class concepts, with scores that can be attached at any level:

- **Open source** with a managed cloud option.
- **Prompt management** with versioning.
- **Score attachment** at trace, span, or generation level (both programmatic and human).
- **Cost tracking** with per-model pricing configuration.
- **Session tracking** for multi-turn agent conversations.

### Arize Phoenix

Phoenix focuses on the ML observability angle -- embeddings, drift detection, and evaluation alongside tracing:

- **Embedding visualization** for understanding what the agent's retrieval steps are finding.
- **Trace analysis** with OpenTelemetry-native integration via `openinference`.
- **Eval integration** with built-in LLM-as-judge evaluators for relevance, toxicity, and hallucination.
- **Local-first** -- runs as a local server for development, with a cloud option for production.

### Braintrust

Braintrust emphasizes evaluation-driven development, making it particularly strong for iterating on agent prompts and configurations:

- **Eval framework** that integrates tightly with tracing -- every eval run produces a trace.
- **Logging SDK** for production tracing.
- **Comparison UI** for diffing traces across agent versions.
- **Dataset management** for regression testing.

### Helicone

Helicone operates as a proxy layer, requiring minimal code changes -- you point your LLM API calls through Helicone's gateway:

- **Zero-code integration** for basic request/response logging.
- **Cost tracking** with per-user and per-feature breakdowns.
- **Rate limiting and caching** built into the proxy layer.
- **Custom properties** for tagging requests with agent-specific metadata.

### Choosing a Platform

```
+----------------+-------------+------------+----------+----------+
| Capability     | LangSmith   | Langfuse   | Phoenix  | Braintrust|
+----------------+-------------+------------+----------+----------+
| Self-hosted    | No          | Yes        | Yes      | No       |
| OTEL native    | Partial     | Partial    | Yes      | Partial  |
| Agent traces   | Excellent   | Good       | Good     | Good     |
| Eval framework | Yes         | Basic      | Yes      | Excellent|
| Cost tracking  | Yes         | Yes        | Basic    | Yes      |
| Prompt mgmt    | Yes         | Yes        | No       | Yes      |
| Open source    | No          | Yes (core) | Yes      | No       |
+----------------+-------------+------------+----------+----------+
```

For production agent systems, the recommendation is to use OpenTelemetry as the base tracing layer (vendor-neutral, future-proof) and export to whichever platform matches your needs. Avoid tight coupling to any single platform's SDK in your core agent logic.

## Debugging Patterns

With tracing infrastructure in place, these are the concrete debugging workflows that agent developers use daily.

### Pattern 1: Replay Failed Runs

The most powerful debugging technique for agents is deterministic replay. Capture the exact LLM responses and tool outputs from a failed run, then replay the agent logic with those captured values. This eliminates non-determinism and lets you step through the failure:

```python
from dataclasses import dataclass


@dataclass
class RecordedInteraction:
    step: int
    llm_response: str
    tool_name: str | None
    tool_input: dict | None
    tool_output: str | None


class ReplayableAgent:
    """Agent that can record and replay interactions."""

    def __init__(self, llm, tools, max_steps=20):
        self.llm = llm
        self.tools = tools
        self.max_steps = max_steps
        self.recording: list[RecordedInteraction] = []
        self._replay_data: list[RecordedInteraction] | None = None
        self._replay_index = 0

    def enable_recording(self):
        self.recording = []

    def enable_replay(self, recorded: list[RecordedInteraction]):
        self._replay_data = recorded
        self._replay_index = 0

    def _get_llm_response(self, messages: list, step: int) -> str:
        if self._replay_data is not None:
            # Replay mode: return recorded response
            response = self._replay_data[self._replay_index].llm_response
            self._replay_index += 1
            return response

        # Live mode: call actual LLM
        response = self.llm.chat(messages)
        return response.content

    def _get_tool_output(
        self, tool_name: str, tool_input: dict, step: int
    ) -> str:
        if self._replay_data is not None:
            # Replay mode: return recorded output
            recorded = self._replay_data[self._replay_index - 1]
            return recorded.tool_output

        # Live mode: call actual tool
        output = self.tools[tool_name](tool_input)

        # Record the interaction
        self.recording.append(RecordedInteraction(
            step=step,
            llm_response="",  # filled in earlier
            tool_name=tool_name,
            tool_input=tool_input,
            tool_output=output,
        ))
        return output

    def run(self, task: str) -> str:
        messages = [{"role": "user", "content": task}]
        for step in range(self.max_steps):
            response = self._get_llm_response(messages, step)
            action = self._parse_action(response)
            if action["type"] == "final_answer":
                return action["content"]
            tool_output = self._get_tool_output(
                action["tool"], action["input"], step
            )
            messages.append({"role": "assistant", "content": response})
            messages.append({
                "role": "user",
                "content": f"Observation: {tool_output}",
            })
        return "Max steps exceeded"


# Usage: Record a failed run, then replay it for debugging
agent = ReplayableAgent(llm, tools)
agent.enable_recording()
result = agent.run("What was Apple's Q3 2024 revenue?")  # fails

# Save recording
import pickle
with open("failed_run_recording.pkl", "wb") as f:
    pickle.dump(agent.recording, f)

# Later: replay for debugging
with open("failed_run_recording.pkl", "rb") as f:
    recorded = pickle.load(f)

debug_agent = ReplayableAgent(llm, tools)
debug_agent.enable_replay(recorded)
# Now step through with breakpoints, print statements, etc.
result = debug_agent.run("What was Apple's Q3 2024 revenue?")
```

### Pattern 2: Bisecting Agent Trajectories

When a long agent trajectory fails, you need to find which step introduced the error. Binary search (bisecting) is far more efficient than reviewing every step:

```python
class TrajectoryBisector:
    """Binary search through an agent trajectory to find the step
    where things went wrong."""

    def __init__(
        self,
        snapshots: list[AgentStepSnapshot],
        judge_fn,  # (snapshot) -> bool (True = still on track)
    ):
        self.snapshots = snapshots
        self.judge = judge_fn

    def bisect(self) -> int:
        """Return the step number where the agent first went off track.
        Uses LLM-as-judge or human evaluation at each probed step."""
        low, high = 0, len(self.snapshots) - 1

        # Verify assumptions: first step OK, last step bad
        assert self.judge(self.snapshots[low]), "First step already wrong"
        assert not self.judge(self.snapshots[high]), "Last step not wrong"

        while low < high - 1:
            mid = (low + high) // 2
            if self.judge(self.snapshots[mid]):
                low = mid
            else:
                high = mid

        return high  # first bad step


def llm_judge_step(snapshot: AgentStepSnapshot) -> bool:
    """Use an LLM to judge whether an agent step is on track.
    For the task 'find Q3 revenue', check if the agent's reasoning
    and actions are heading toward the correct answer."""
    prompt = f"""You are evaluating an AI agent's progress on a task.

Task: Find Apple's Q3 2024 revenue.
Correct answer: $85.8 billion.

At step {snapshot.step_number}, the agent:
- Reasoned: {snapshot.llm_response[:500]}
- Called tool: {snapshot.tool_name} with input {snapshot.tool_input}
- Got result: {snapshot.tool_output[:500] if snapshot.tool_output else 'N/A'}

Is the agent still on a reasonable path toward the correct answer?
Answer YES or NO with a brief explanation."""

    response = judge_llm.chat([{"role": "user", "content": prompt}])
    return response.content.strip().upper().startswith("YES")
```

### Pattern 3: Injecting Tool Responses for Testing

To test how an agent handles specific tool scenarios (errors, empty results, unexpected formats), inject synthetic tool responses:

```python
class MockToolInjector:
    """Replace specific tool calls with predetermined responses
    for testing agent robustness."""

    def __init__(self, real_tools: dict):
        self.real_tools = real_tools
        self.injections: list[dict] = []

    def inject(
        self,
        tool_name: str,
        match_input: dict | None,
        response: str,
        once: bool = True,
    ):
        """Set up a tool response injection.

        Args:
            tool_name: Which tool to intercept
            match_input: Input args to match (None = match any)
            response: The response to inject
            once: If True, injection fires only once
        """
        self.injections.append({
            "tool_name": tool_name,
            "match_input": match_input,
            "response": response,
            "once": once,
            "fired": False,
        })

    def get_tool(self, name: str):
        """Return a wrapped tool that checks injections first."""
        real_tool = self.real_tools.get(name)

        def wrapped(input_args: dict) -> str:
            for inj in self.injections:
                if inj["tool_name"] != name:
                    continue
                if inj["once"] and inj["fired"]:
                    continue
                if (
                    inj["match_input"] is not None
                    and inj["match_input"] != input_args
                ):
                    continue
                inj["fired"] = True
                return inj["response"]
            if real_tool is None:
                raise ValueError(f"No tool '{name}' and no injection matched")
            return real_tool(input_args)

        return wrapped


# Testing: What happens when the search tool returns an error?
injector = MockToolInjector(real_tools)
injector.inject(
    "search",
    match_input=None,  # match any search
    response="Error: Service temporarily unavailable (HTTP 503)",
)

# Run agent with injected tool failure
agent = MyAgent(llm, {
    name: injector.get_tool(name) for name in real_tools
})
result = agent.run("Find Apple's Q3 revenue")
# Observe: does the agent retry? Give up? Hallucinate an answer?
```

## Cost and Latency Tracking

In production, agent cost and latency are as important as correctness. A single agent run can involve dozens of LLM calls, each consuming tokens at the model's rate. Without per-step tracking, costs spiral invisibly.

### Per-Step Token and Cost Tracking

```python
from dataclasses import dataclass


# Pricing per 1M tokens (example rates, update as needed)
MODEL_PRICING = {
    "gpt-4-turbo": {"input": 10.00, "output": 30.00},
    "gpt-4o": {"input": 2.50, "output": 10.00},
    "gpt-4o-mini": {"input": 0.15, "output": 0.60},
    "claude-sonnet-4-20250514": {"input": 3.00, "output": 15.00},
    "deepseek-chat": {"input": 0.14, "output": 0.28},
}


@dataclass
class StepCost:
    step: int
    model: str
    prompt_tokens: int
    completion_tokens: int
    input_cost_usd: float
    output_cost_usd: float
    total_cost_usd: float
    latency_ms: float


class CostTracker:
    """Track per-step and cumulative costs for an agent run."""

    def __init__(self):
        self.steps: list[StepCost] = []

    def record_step(
        self,
        step: int,
        model: str,
        prompt_tokens: int,
        completion_tokens: int,
        latency_ms: float,
    ):
        pricing = MODEL_PRICING.get(model, {"input": 0, "output": 0})
        input_cost = prompt_tokens * pricing["input"] / 1_000_000
        output_cost = completion_tokens * pricing["output"] / 1_000_000

        self.steps.append(StepCost(
            step=step,
            model=model,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            input_cost_usd=input_cost,
            output_cost_usd=output_cost,
            total_cost_usd=input_cost + output_cost,
            latency_ms=latency_ms,
        ))

    @property
    def total_cost(self) -> float:
        return sum(s.total_cost_usd for s in self.steps)

    @property
    def total_tokens(self) -> int:
        return sum(s.prompt_tokens + s.completion_tokens for s in self.steps)

    @property
    def total_latency_ms(self) -> float:
        return sum(s.latency_ms for s in self.steps)

    def cost_breakdown(self) -> dict:
        """Detailed cost breakdown for analysis."""
        if not self.steps:
            return {}

        costs_by_step = [s.total_cost_usd for s in self.steps]
        return {
            "total_cost_usd": self.total_cost,
            "total_tokens": self.total_tokens,
            "total_latency_ms": self.total_latency_ms,
            "step_count": len(self.steps),
            "avg_cost_per_step": self.total_cost / len(self.steps),
            "max_step_cost": max(costs_by_step),
            "max_step_cost_step": costs_by_step.index(max(costs_by_step)),
            "cost_growth_rate": (
                costs_by_step[-1] / costs_by_step[0]
                if costs_by_step[0] > 0
                else float("inf")
            ),
            "input_vs_output_ratio": (
                sum(s.input_cost_usd for s in self.steps)
                / max(sum(s.output_cost_usd for s in self.steps), 0.0001)
            ),
        }

    def detect_cost_anomalies(self, threshold_multiplier: float = 3.0) -> list:
        """Detect steps with abnormally high cost (likely indicates
        context window bloat or excessive output)."""
        if len(self.steps) < 3:
            return []

        avg = self.total_cost / len(self.steps)
        return [
            {
                "step": s.step,
                "cost": s.total_cost_usd,
                "multiplier": s.total_cost_usd / avg,
                "prompt_tokens": s.prompt_tokens,
                "completion_tokens": s.completion_tokens,
            }
            for s in self.steps
            if s.total_cost_usd > avg * threshold_multiplier
        ]
```

### Latency Breakdown Visualization

Understanding where time is spent in an agent run is critical for optimization:

```
Agent Run Latency Breakdown (total: 34.2s)
==========================================

Step 0: [####                ] LLM: 1.8s  Tool: 0.4s  (search)
Step 1: [######              ] LLM: 2.1s  Tool: 1.2s  (db_query)
Step 2: [########            ] LLM: 2.8s  Tool: 0.9s  (search)
Step 3: [###########         ] LLM: 3.4s  Tool: 2.1s  (api_call)
Step 4: [##############      ] LLM: 4.1s  Tool: 0.3s  (calculator)
Step 5: [#################   ] LLM: 5.2s  Tool: 3.8s  (db_query) <-- slow!
Step 6: [####################] LLM: 5.9s  Tool: 0.2s  (final_answer)
                                 ------         -----
                     LLM total: 25.3s  Tool total: 8.9s
                         (74%)               (26%)

Note: LLM latency increases each step because context grows.
Step 5 tool call is 4x average -- investigate the database query.
```

The monotonically increasing LLM latency is a signature of agent systems: each step adds to the context, so every subsequent LLM call processes more tokens. This is why context management strategies (summarization, sliding windows) have a direct impact on both cost and latency.

## Evaluating Agent Behavior

Debugging is reactive -- it starts when something breaks. Evaluation is proactive -- it measures agent quality before and during production deployment. Agent evaluation has two distinct dimensions. (For comprehensive treatment, see [Agent Evaluation](/agent-evaluation). For foundational eval concepts, see [Eval Fundamentals](/eval-fundamentals).)

### Trajectory Evaluation: Did the Agent Take Good Steps?

Trajectory evaluation asks whether the agent's intermediate steps were reasonable, regardless of the final answer. An agent that stumbles through 20 steps to reach the right answer is worse than one that takes 4 clean steps, even though both "succeed."

```python
@dataclass
class TrajectoryScore:
    efficiency: float      # 0-1: did it minimize unnecessary steps?
    tool_accuracy: float   # 0-1: were tool calls well-formed and relevant?
    reasoning_quality: float  # 0-1: was the reasoning chain coherent?
    recovery_quality: float   # 0-1: how well did it handle errors?
    overall: float


class TrajectoryEvaluator:
    """Evaluate the quality of an agent's trajectory."""

    def __init__(self, judge_llm):
        self.judge = judge_llm

    def evaluate(
        self,
        task: str,
        trajectory: list[AgentStepSnapshot],
        reference_trajectory: list[dict] | None = None,
    ) -> TrajectoryScore:

        efficiency = self._score_efficiency(trajectory, reference_trajectory)
        tool_acc = self._score_tool_accuracy(trajectory)
        reasoning = self._score_reasoning(task, trajectory)
        recovery = self._score_recovery(trajectory)

        overall = (
            0.3 * efficiency
            + 0.3 * tool_acc
            + 0.25 * reasoning
            + 0.15 * recovery
        )

        return TrajectoryScore(
            efficiency=efficiency,
            tool_accuracy=tool_acc,
            reasoning_quality=reasoning,
            recovery_quality=recovery,
            overall=overall,
        )

    def _score_efficiency(
        self,
        trajectory: list[AgentStepSnapshot],
        reference: list[dict] | None,
    ) -> float:
        """Score based on step count relative to reference or absolute."""
        actual_steps = len(trajectory)
        if reference:
            ideal_steps = len(reference)
            ratio = ideal_steps / actual_steps
            return min(ratio, 1.0)

        # Without reference, penalize heavily above 10 steps
        if actual_steps <= 3:
            return 1.0
        elif actual_steps <= 6:
            return 0.8
        elif actual_steps <= 10:
            return 0.6
        else:
            return max(0.1, 1.0 - (actual_steps - 10) * 0.05)

    def _score_tool_accuracy(
        self, trajectory: list[AgentStepSnapshot]
    ) -> float:
        """Score tool usage: were calls well-formed? Did they succeed?"""
        tool_steps = [
            s for s in trajectory if s.action_type == "tool_call"
        ]
        if not tool_steps:
            return 1.0

        successful = sum(1 for s in tool_steps if not s.tool_error)
        return successful / len(tool_steps)

    def _score_reasoning(
        self, task: str, trajectory: list[AgentStepSnapshot]
    ) -> float:
        """Use LLM-as-judge to score reasoning quality."""
        reasoning_text = "\n".join(
            f"Step {s.step_number}: {s.llm_response[:300]}"
            for s in trajectory
        )
        prompt = f"""Rate the reasoning quality of this agent trajectory
on a scale of 0 to 10.

Task: {task}
Trajectory:
{reasoning_text[:3000]}

Criteria:
- Is the reasoning coherent and logically connected?
- Does each step build on previous observations?
- Are conclusions supported by evidence from tool results?

Respond with just a number 0-10."""

        response = self.judge.chat([{"role": "user", "content": prompt}])
        try:
            score = float(response.content.strip()) / 10.0
            return max(0.0, min(1.0, score))
        except ValueError:
            return 0.5  # fallback

    def _score_recovery(
        self, trajectory: list[AgentStepSnapshot]
    ) -> float:
        """Score how well the agent recovered from errors."""
        errors = [s for s in trajectory if s.tool_error]
        if not errors:
            return 1.0  # no errors to recover from

        recoveries = 0
        for err_step in errors:
            # Check if the agent adapted after the error
            next_steps = [
                s for s in trajectory
                if s.step_number > err_step.step_number
            ]
            if next_steps:
                next_step = next_steps[0]
                # Did the agent try a different approach?
                if (
                    next_step.tool_name != err_step.tool_name
                    or next_step.tool_input != err_step.tool_input
                ):
                    recoveries += 1

        return recoveries / len(errors) if errors else 1.0
```

### Outcome Evaluation: Did It Get the Right Answer?

Outcome evaluation is simpler conceptually but harder in practice because "right answer" varies by task type:

```python
class OutcomeEvaluator:
    """Evaluate whether the agent produced the correct final output."""

    def __init__(self, judge_llm=None):
        self.judge = judge_llm

    def evaluate_exact_match(
        self, predicted: str, expected: str
    ) -> bool:
        """Strict equality after normalization."""
        return self._normalize(predicted) == self._normalize(expected)

    def evaluate_contains(
        self, predicted: str, expected_substrings: list[str]
    ) -> float:
        """What fraction of expected facts appear in the output?"""
        norm_pred = self._normalize(predicted)
        found = sum(
            1 for s in expected_substrings
            if self._normalize(s) in norm_pred
        )
        return found / len(expected_substrings)

    def evaluate_llm_judge(
        self,
        task: str,
        predicted: str,
        reference: str | None = None,
    ) -> dict:
        """Use an LLM to judge answer quality."""
        prompt = f"""Evaluate the agent's answer to this task.

Task: {task}
Agent's answer: {predicted}
{"Reference answer: " + reference if reference else ""}

Rate on these dimensions (0-10 each):
1. Correctness: Is the answer factually correct?
2. Completeness: Does it address all parts of the task?
3. Conciseness: Is it appropriately concise without missing key info?

Respond in JSON format:
{{"correctness": N, "completeness": N, "conciseness": N, "explanation": "..."}}"""

        response = self.judge.chat([{"role": "user", "content": prompt}])
        try:
            return json.loads(response.content)
        except json.JSONDecodeError:
            return {"correctness": 0, "completeness": 0, "conciseness": 0,
                    "explanation": "Judge response was not valid JSON"}

    def _normalize(self, text: str) -> str:
        return " ".join(text.lower().strip().split())
```

## Common Failure Modes and How to Diagnose Them

Each agent failure mode has characteristic signatures in traces. Learning to recognize these signatures is the core skill of agent debugging.

### Infinite Loops

**Signature:** Step count equals `max_steps`. Tool call sequence shows repetitive patterns. Context window utilization grows linearly to 100%.

```
Trace pattern:
  Step 5: search("python sort algorithm")
  Step 6: search("python sorting methods")
  Step 7: search("how to sort in python")
  Step 8: search("python sort algorithm example")   <-- cycling
  Step 9: search("python sort algorithm")            <-- exact repeat
```

**Diagnosis approach:**

```python
def diagnose_loop(snapshots: list[AgentStepSnapshot]) -> dict | None:
    """Detect and characterize loops in an agent trajectory."""
    tool_calls = [
        (s.step_number, s.tool_name, json.dumps(s.tool_input))
        for s in snapshots
        if s.action_type == "tool_call"
    ]

    # Check for exact duplicates
    seen = {}
    for step, name, args in tool_calls:
        key = f"{name}:{args}"
        if key in seen:
            return {
                "type": "exact_loop",
                "first_occurrence": seen[key],
                "repeated_at": step,
                "tool": name,
                "args": args,
            }
        seen[key] = step

    # Check for semantic loops (same tool, similar args)
    for i in range(len(tool_calls)):
        for j in range(i + 2, min(i + 6, len(tool_calls))):
            if tool_calls[i][1] == tool_calls[j][1]:  # same tool
                # Check if inputs are suspiciously similar
                sim = _jaccard_similarity(
                    tool_calls[i][2], tool_calls[j][2]
                )
                if sim > 0.7:
                    return {
                        "type": "semantic_loop",
                        "steps": (tool_calls[i][0], tool_calls[j][0]),
                        "tool": tool_calls[i][1],
                        "similarity": sim,
                    }
    return None
```

**Fix patterns:** Add loop detection to the agent loop itself. Maintain a set of recent tool call signatures. When a near-duplicate is detected, inject a system message forcing the agent to try a different approach or give up.

### Tool Misuse

**Signature:** Tool calls with malformed arguments. Type errors from tools. Agent ignores tool output and proceeds on assumptions.

```
Trace pattern:
  Step 3: sql_query({"query": "SELECT * FROM users WHERE name = John"})
           ^-- missing quotes around 'John'
  Tool output: "Error: column 'john' does not exist"
  Step 4: Reasoning: "The user John was not found in the database"
           ^-- misinterpreted an SQL error as a semantic result
```

**Diagnosis:** Look for tool error rates above baseline. Check if the agent's post-error reasoning correctly identifies the error type.

### Context Overflow

**Signature:** Agent's reasoning quality degrades in later steps. It "forgets" information from early steps. It re-asks questions it already answered.

```
Trace pattern:
  Step 1-5: Agent gathers data about Company A, B, and C
  Step 6-8: Agent analyzes companies (context at 90%)
  Step 9:   Agent asks "What was Company A's revenue?"
            ^-- this was answered at Step 2 but pushed out of context
```

**Diagnosis:**

```python
def diagnose_context_overflow(
    snapshots: list[AgentStepSnapshot],
    max_context: int,
) -> dict:
    """Check for context overflow symptoms."""
    results = {
        "overflow_occurred": False,
        "overflow_step": None,
        "info_loss_detected": False,
        "repeated_queries": [],
    }

    for s in snapshots:
        if s.context_token_count > max_context * 0.95:
            results["overflow_occurred"] = True
            if results["overflow_step"] is None:
                results["overflow_step"] = s.step_number

    # Detect repeated information requests
    tool_queries = [
        (s.step_number, s.tool_name, s.tool_input)
        for s in snapshots
        if s.action_type == "tool_call"
    ]
    seen_intents = {}
    for step, tool, inp in tool_queries:
        intent_key = f"{tool}:{json.dumps(inp, sort_keys=True)}"
        if intent_key in seen_intents:
            results["repeated_queries"].append({
                "original_step": seen_intents[intent_key],
                "repeated_step": step,
                "tool": tool,
                "input": inp,
            })
            results["info_loss_detected"] = True
        else:
            seen_intents[intent_key] = step

    return results
```

### Hallucinated Tool Calls

**Signature:** Agent attempts to call a tool that does not exist. Or it calls a real tool with arguments that conform to an imagined schema rather than the actual schema.

```
Trace pattern:
  Step 4: Agent calls "analyze_sentiment" (not in available tools)
  Step 5: Agent calls search({"query": "...", "max_results": 5, "lang": "en"})
           ^-- search only accepts {"query": str}, other params are ignored
```

**Diagnosis:** Compare tool calls against the tool schema. Track the "hallucination rate" as a metric.

### Premature Termination

**Signature:** Agent declares `final_answer` before completing all subtasks. Often happens when the agent mistakes partial progress for completion.

```
Trace pattern:
  Task: "Compare revenue of Apple, Google, and Microsoft for 2024"
  Step 1-3: Agent finds Apple revenue ($85.8B)
  Step 4: Agent finds Google revenue ($350B)
  Step 5: Agent says "Apple had $85.8B and Google had $350B in revenue"
           ^-- never looked up Microsoft
```

**Diagnosis:** Compare the final answer against the task requirements. Use an LLM judge to check completeness.

## Production Monitoring

Development debugging is interactive -- you are sitting at a terminal, inspecting traces. Production monitoring must be automated, alerting humans only when intervention is needed. (See [Observability](/observability) for broader monitoring patterns.)

### Alerting on Agent Failures

```python
from dataclasses import dataclass
from enum import Enum


class AlertSeverity(Enum):
    INFO = "info"
    WARNING = "warning"
    CRITICAL = "critical"


@dataclass
class AgentAlert:
    severity: AlertSeverity
    alert_type: str
    message: str
    run_id: str
    metadata: dict


class AgentMonitor:
    """Production monitoring for agent systems."""

    def __init__(self, alert_callback):
        self.alert = alert_callback
        self.recent_runs: list[dict] = []
        # Configurable thresholds
        self.max_cost_per_run = 5.00       # USD
        self.max_steps_per_run = 30
        self.max_latency_ms = 120_000      # 2 minutes
        self.error_rate_threshold = 0.15   # 15%
        self.loop_detection_window = 5     # steps

    def on_run_complete(self, run_data: dict):
        """Called after every agent run completes."""
        self.recent_runs.append(run_data)
        # Keep only last 1000 runs
        self.recent_runs = self.recent_runs[-1000:]

        # Check individual run thresholds
        self._check_cost(run_data)
        self._check_steps(run_data)
        self._check_latency(run_data)

        # Check aggregate metrics
        self._check_error_rate()
        self._check_cost_trend()

    def _check_cost(self, run_data: dict):
        if run_data["total_cost_usd"] > self.max_cost_per_run:
            self.alert(AgentAlert(
                severity=AlertSeverity.CRITICAL,
                alert_type="cost_exceeded",
                message=(
                    f"Agent run cost ${run_data['total_cost_usd']:.2f}"
                    f" (limit: ${self.max_cost_per_run:.2f})"
                ),
                run_id=run_data["run_id"],
                metadata={
                    "cost": run_data["total_cost_usd"],
                    "steps": run_data["total_steps"],
                    "model": run_data["model"],
                },
            ))

    def _check_steps(self, run_data: dict):
        if run_data["total_steps"] >= self.max_steps_per_run:
            self.alert(AgentAlert(
                severity=AlertSeverity.WARNING,
                alert_type="max_steps_reached",
                message=(
                    f"Agent reached max steps ({run_data['total_steps']})"
                ),
                run_id=run_data["run_id"],
                metadata={"steps": run_data["total_steps"]},
            ))

    def _check_latency(self, run_data: dict):
        if run_data["total_latency_ms"] > self.max_latency_ms:
            self.alert(AgentAlert(
                severity=AlertSeverity.WARNING,
                alert_type="latency_exceeded",
                message=(
                    f"Agent run took {run_data['total_latency_ms']:.0f}ms"
                    f" (limit: {self.max_latency_ms}ms)"
                ),
                run_id=run_data["run_id"],
                metadata={
                    "latency_ms": run_data["total_latency_ms"],
                    "steps": run_data["total_steps"],
                },
            ))

    def _check_error_rate(self):
        """Check rolling error rate across recent runs."""
        if len(self.recent_runs) < 20:
            return
        recent = self.recent_runs[-100:]
        error_rate = sum(
            1 for r in recent if r["outcome"] == "error"
        ) / len(recent)

        if error_rate > self.error_rate_threshold:
            self.alert(AgentAlert(
                severity=AlertSeverity.CRITICAL,
                alert_type="error_rate_spike",
                message=(
                    f"Agent error rate is {error_rate:.1%}"
                    f" (threshold: {self.error_rate_threshold:.1%})"
                ),
                run_id="aggregate",
                metadata={
                    "error_rate": error_rate,
                    "sample_size": len(recent),
                },
            ))

    def _check_cost_trend(self):
        """Detect if per-run costs are trending upward."""
        if len(self.recent_runs) < 50:
            return
        recent_costs = [r["total_cost_usd"] for r in self.recent_runs[-50:]]
        first_half = sum(recent_costs[:25]) / 25
        second_half = sum(recent_costs[25:]) / 25

        if second_half > first_half * 1.5:
            self.alert(AgentAlert(
                severity=AlertSeverity.WARNING,
                alert_type="cost_trend_increasing",
                message=(
                    f"Average cost trending up:"
                    f" ${first_half:.3f} -> ${second_half:.3f}"
                ),
                run_id="aggregate",
                metadata={
                    "avg_cost_first_half": first_half,
                    "avg_cost_second_half": second_half,
                },
            ))
```

### SLO Tracking for Agent Tasks

Service Level Objectives (SLOs) for agents must go beyond uptime and latency to include task-specific quality metrics:

```python
@dataclass
class AgentSLO:
    """Service Level Objective for an agent system."""
    name: str
    target: float  # target percentage (e.g., 0.95 = 95%)
    window_hours: int  # measurement window

    # The metric function takes a list of run data and returns
    # the fraction of runs meeting the objective
    metric_fn: object  # Callable[[list[dict]], float]


def slo_success_rate(runs: list[dict]) -> float:
    """Fraction of runs that completed successfully."""
    if not runs:
        return 1.0
    return sum(1 for r in runs if r["outcome"] == "success") / len(runs)


def slo_latency_p95(runs: list[dict], threshold_ms: float = 60000) -> float:
    """Fraction of runs completing under latency threshold."""
    if not runs:
        return 1.0
    under = sum(
        1 for r in runs if r["total_latency_ms"] <= threshold_ms
    )
    return under / len(runs)


def slo_cost_per_run(runs: list[dict], max_cost: float = 1.0) -> float:
    """Fraction of runs costing less than threshold."""
    if not runs:
        return 1.0
    under = sum(1 for r in runs if r["total_cost_usd"] <= max_cost)
    return under / len(runs)


# Define SLOs for a production agent
AGENT_SLOS = [
    AgentSLO(
        name="availability",
        target=0.99,
        window_hours=24,
        metric_fn=slo_success_rate,
    ),
    AgentSLO(
        name="latency_p95_under_60s",
        target=0.95,
        window_hours=24,
        metric_fn=lambda runs: slo_latency_p95(runs, 60000),
    ),
    AgentSLO(
        name="cost_under_1_dollar",
        target=0.90,
        window_hours=168,  # weekly
        metric_fn=lambda runs: slo_cost_per_run(runs, 1.0),
    ),
]
```

### Anomaly Detection

Statistical anomaly detection can catch problems that fixed thresholds miss -- a gradual degradation that stays just under the alert threshold, or a sudden change in agent behavior distribution:

```python
import math
from collections import deque


class AgentAnomalyDetector:
    """Detect anomalies in agent behavior using simple statistical methods."""

    def __init__(self, window_size: int = 200):
        self.window_size = window_size
        self.step_counts = deque(maxlen=window_size)
        self.costs = deque(maxlen=window_size)
        self.latencies = deque(maxlen=window_size)
        self.tool_distributions: dict[str, deque] = {}

    def observe(self, run_data: dict):
        self.step_counts.append(run_data["total_steps"])
        self.costs.append(run_data["total_cost_usd"])
        self.latencies.append(run_data["total_latency_ms"])

        # Track tool usage distribution
        for tool_name, count in run_data.get("tool_counts", {}).items():
            if tool_name not in self.tool_distributions:
                self.tool_distributions[tool_name] = deque(
                    maxlen=self.window_size
                )
            self.tool_distributions[tool_name].append(count)

    def check_anomalies(self, run_data: dict) -> list[str]:
        """Check if the latest run is anomalous compared to history."""
        anomalies = []

        if len(self.step_counts) < 30:
            return anomalies  # not enough data

        # Z-score based detection
        for metric_name, values, current in [
            ("step_count", self.step_counts, run_data["total_steps"]),
            ("cost", self.costs, run_data["total_cost_usd"]),
            ("latency", self.latencies, run_data["total_latency_ms"]),
        ]:
            z = self._z_score(values, current)
            if abs(z) > 3.0:
                direction = "above" if z > 0 else "below"
                anomalies.append(
                    f"{metric_name} is {abs(z):.1f} std devs {direction}"
                    f" average (value: {current}, mean: {self._mean(values):.2f})"
                )

        return anomalies

    def _mean(self, values) -> float:
        return sum(values) / len(values)

    def _stddev(self, values) -> float:
        m = self._mean(values)
        variance = sum((x - m) ** 2 for x in values) / len(values)
        return math.sqrt(variance)

    def _z_score(self, values, current) -> float:
        std = self._stddev(values)
        if std == 0:
            return 0.0
        return (current - self._mean(values)) / std
```

## Putting It All Together: A Complete Debugging Workflow

Here is the end-to-end workflow that ties all concepts together. This is the process an engineer follows when an agent fails in production:

```
+-------------------+      +------------------+     +------------------+
| 1. Alert fires    | ---> | 2. Pull trace    | --> | 3. Identify      |
|    (monitor)      |      |    (LangSmith/   |     |    failure step   |
|                   |      |     Langfuse)    |     |    (bisect)      |
+-------------------+      +------------------+     +------------------+
                                                            |
                                                            v
+-------------------+      +------------------+     +------------------+
| 6. Deploy fix     | <--- | 5. Verify fix    | <-- | 4. Replay with   |
|    + add eval     |      |    (replay full   |     |    mock/modified |
|    case           |      |     trace)       |     |    inputs        |
+-------------------+      +------------------+     +------------------+
```

**Step 1: Alert fires.** The production monitor detects an anomaly -- perhaps a spike in error rate or cost. The alert includes the run ID.

**Step 2: Pull the trace.** Using the observability platform's UI or API, retrieve the full trace for the failed run. This includes every LLM prompt, response, tool call, and tool result.

**Step 3: Identify the failure step.** Use trace visualization (flame graph, step-by-step view) to find where the trajectory went wrong. For long traces, use the bisection pattern with an LLM judge to narrow down the step efficiently.

**Step 4: Replay with modifications.** Once you identify the failure step, replay the trace with modifications: inject a corrected tool response, modify the system prompt, or swap the model. This tells you whether your proposed fix would have prevented the failure.

**Step 5: Verify the fix.** Run the full trace end-to-end with the fix applied. Confirm the agent now produces the correct result. Run the broader eval suite to check for regressions.

**Step 6: Deploy and add an eval case.** Deploy the fix. Add the failed case to your eval dataset so it becomes a permanent regression test. Update alert thresholds if needed.

```python
class DebugSession:
    """Orchestrates a complete debugging session for a failed agent run."""

    def __init__(
        self,
        trace_store,     # Where traces are stored (LangSmith, DB, etc.)
        agent_factory,   # Creates agent instances with different configs
        eval_suite,      # The agent's evaluation suite
    ):
        self.traces = trace_store
        self.agent_factory = agent_factory
        self.eval_suite = eval_suite

    def investigate(self, run_id: str) -> dict:
        """Full investigation of a failed run."""
        # Step 2: Pull trace
        trace = self.traces.get_trace(run_id)
        snapshots = trace.to_snapshots()

        # Step 3: Automated diagnosis
        diagnosis = {
            "loop": diagnose_loop(snapshots),
            "context_overflow": diagnose_context_overflow(
                snapshots, max_context=128000
            ),
            "tool_errors": [
                s for s in snapshots if s.tool_error
            ],
            "cost": CostTracker().cost_breakdown(),
        }

        # Bisect if trajectory is long
        if len(snapshots) > 8:
            bisector = TrajectoryBisector(snapshots, llm_judge_step)
            diagnosis["first_bad_step"] = bisector.bisect()
        else:
            # For short traces, check each step
            diagnosis["step_evaluations"] = [
                {
                    "step": s.step_number,
                    "on_track": llm_judge_step(s),
                }
                for s in snapshots
            ]

        return diagnosis

    def test_fix(
        self,
        run_id: str,
        fix_description: str,
        modified_agent_config: dict,
    ) -> dict:
        """Replay the failed run with a proposed fix."""
        trace = self.traces.get_trace(run_id)
        task = trace.task

        # Create agent with modified config
        fixed_agent = self.agent_factory.create(modified_agent_config)

        # Run the same task
        result = fixed_agent.run(task)

        # Check if the fix resolves the issue
        return {
            "fix_description": fix_description,
            "original_outcome": trace.outcome,
            "fixed_outcome": result.outcome,
            "fixed_answer": result.answer,
            "fixed_steps": result.total_steps,
            "fixed_cost": result.total_cost,
        }

    def add_regression_test(self, run_id: str, expected_answer: str):
        """Add the failed case to the eval suite as a regression test."""
        trace = self.traces.get_trace(run_id)
        self.eval_suite.add_case({
            "task": trace.task,
            "expected_answer": expected_answer,
            "source": f"production_failure:{run_id}",
            "added_date": "2025-01-15",
            "tags": ["regression", "production_failure"],
        })
```

## Design Principles for Observable Agents

Based on the patterns and failure modes discussed, here are the design principles that make agents debuggable from the start:

**1. Trace everything, filter later.** It is far cheaper to capture a comprehensive trace and discard what you do not need than to discover during debugging that the critical data was never recorded. Capture full prompts, full responses, tool inputs, tool outputs, and timing data for every step.

**2. Make the context window visible.** At every step, log the token count and context utilization. Make it trivial to inspect exactly what the LLM saw at any given step. This single practice catches the majority of agent-specific bugs.

**3. Separate recording from execution.** Design the agent so that LLM calls and tool calls go through an abstraction layer that can be swapped between "live" and "replay" modes. This makes deterministic replay possible without modifying the core agent logic.

**4. Assign costs to every step.** Token counts and model pricing must be tracked per-step and per-run. Include cost in your alerting. A cost anomaly is often the first signal of a bug.

**5. Build loop detection into the agent itself.** Do not rely solely on `max_steps` to prevent infinite loops. Add explicit detection of repeated tool calls and reasoning patterns. When detected, inject a system message or force termination with a diagnostic.

**6. Treat agent traces as a first-class data product.** Traces are not just debugging artifacts -- they are training data for evals, input for trajectory analysis, and evidence for compliance. Store them durably with rich metadata.

**7. Test with injected failures.** Regularly run your agent against scenarios where tools fail, return unexpected data, or are slow. This is the agent equivalent of chaos engineering. The mock tool injector pattern described above is the foundation for this practice.

## Cross-References

- [Agent Evaluation](/agent-evaluation) -- Comprehensive treatment of success metrics, trajectory evaluation, benchmarks (SWE-bench, WebArena), and cost-performance tradeoffs.
- [Observability](/observability) -- Broader observability patterns for AI systems including metrics, logging, and monitoring beyond agent-specific concerns.
- [Agent Harnesses](/agent-harnesses) -- How harnesses manage the agent loop, tool execution, and safety boundaries that produce the traces discussed here.
- [Agent Orchestration](/agent-orchestration) -- Multi-agent systems introduce additional debugging complexity: inter-agent communication traces, delegation chains, and coordination failures.
- [Eval Fundamentals](/eval-fundamentals) -- Foundational evaluation concepts (precision, recall, calibration) that underpin the trajectory and outcome evaluation methods described in this article.
