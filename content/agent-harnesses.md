# Agent Harnesses: Event Loops, Permission Models & Tool Sandboxing

An agent harness is the runtime environment that wraps an LLM agent, managing its execution loop, tool access, and safety boundaries. If the LLM is the brain, the harness is the rest of the nervous system -- the spinal cord that routes signals, the reflexes that prevent harm, the sensory gates that control what information reaches the brain. Without a harness, you have a bare API call that generates text. With a harness, you have a system that can reason, act, observe, recover from errors, enforce permissions, sandbox dangerous operations, and checkpoint its progress for later resumption.

This article examines the architecture of agent harnesses in depth: the event loop that drives agent execution, the permission models that control what an agent can and cannot do, the sandboxing techniques that isolate tool execution, state management strategies, error handling patterns, and real-world harness implementations from Claude Code, Cursor, Devin, and OpenAI's code interpreter. It includes complete implementation examples in both Python and TypeScript. (For foundational agent architecture patterns, see [Agent Architectures](/agent-architectures); for the tool integration layer that harnesses manage, see [Function Calling](/function-calling); for multi-agent coordination that builds on harnesses, see [Agent Orchestration](/agent-orchestration).)

## The Harness Pattern vs. Bare Agent Calls

### What Bare Agent Calls Look Like

The simplest way to use an LLM with tools is a bare call: send a message, get a response, check if it contains tool calls, execute them, send results back. Most tutorials stop here:

```python
response = client.chat.completions.create(
    model="gpt-4o",
    messages=messages,
    tools=tools,
)

if response.choices[0].message.tool_calls:
    for tool_call in response.choices[0].message.tool_calls:
        result = execute_tool(tool_call)
        messages.append({"role": "tool", "content": result, "tool_call_id": tool_call.id})
    # ... call the model again with tool results
```

This works for demos. It fails in production for reasons that become apparent the moment you try to build anything non-trivial:

**No safety boundaries.** The model decides which tools to call with which arguments. A model asked to "clean up my desktop" might call `rm -rf /` if you gave it a shell tool without constraints. There is no layer between the model's intent and the execution of potentially destructive operations.

**No error recovery.** If a tool call fails -- network timeout, invalid arguments, permission denied -- the bare loop has no strategy for handling the failure. Does it retry? Fall back to a different approach? Inform the user? The answer is: it crashes, or worse, it silently continues with an error message that the model misinterprets.

**No state management.** If the process dies mid-execution, all progress is lost. There is no checkpoint, no resume, no way to pick up where you left off. For a 20-minute coding task, this means starting over from scratch.

**No observability.** You have no structured way to inspect what the agent did, why it made specific decisions, how long each step took, or what the cumulative cost was.

**No resource limits.** The agent can loop forever, make unlimited API calls, fill up disk space, or consume unbounded compute. Nothing prevents runaway execution.

### What a Harness Provides

A harness wraps the bare loop with a structured runtime that addresses every gap listed above:

```
+-------------------------------------------------------------------+
|                        AGENT HARNESS                               |
|                                                                    |
|  +-------------------------------------------------------------+  |
|  |                    PERMISSION LAYER                          |  |
|  |  Allowlists / Denylists / Capability checks / HITL gates    |  |
|  +-------------------------------------------------------------+  |
|                              |                                     |
|  +-------------------------------------------------------------+  |
|  |                     EVENT LOOP                               |  |
|  |                                                              |  |
|  |  Input -> Context Assembly -> LLM Call -> Response Parse     |  |
|  |    -> Permission Check -> Tool Dispatch -> Result Collect    |  |
|  |    -> State Update -> Loop or Return                         |  |
|  |                                                              |  |
|  +-------------------------------------------------------------+  |
|                              |                                     |
|  +-------------------------------------------------------------+  |
|  |                   SANDBOX LAYER                              |  |
|  |  Process isolation / Filesystem jail / Network policy        |  |
|  |  Resource limits (CPU, memory, time) / Capability dropping   |  |
|  +-------------------------------------------------------------+  |
|                              |                                     |
|  +-------------------------------------------------------------+  |
|  |                   STATE LAYER                                |  |
|  |  Conversation history / Tool results / Working memory        |  |
|  |  Checkpoints / Resume tokens / Cost tracking                 |  |
|  +-------------------------------------------------------------+  |
|                              |                                     |
|  +-------------------------------------------------------------+  |
|  |                 OBSERVABILITY LAYER                          |  |
|  |  Structured logs / Traces / Metrics / Cost accounting        |  |
|  +-------------------------------------------------------------+  |
+-------------------------------------------------------------------+
```

The harness is not optional infrastructure for serious agents. It is the difference between a toy and a tool.

## The Agent Event Loop

The event loop is the heartbeat of every agent harness. It is a cycle that repeats until the agent produces a final answer, hits a termination condition, or encounters an unrecoverable error.

### Anatomy of One Loop Iteration

```
                         +------------------+
                         |   Receive Input  |
                         +--------+---------+
                                  |
                                  v
                     +------------------------+
                     |   Assemble Context     |
                     |   (system prompt,      |
                     |    history, tool defs,  |
                     |    working memory)      |
                     +----------+-------------+
                                |
                                v
                     +------------------------+
                     |     Call LLM           |
                     |   (with retry logic)   |
                     +----------+-------------+
                                |
                                v
                     +------------------------+
                     |   Parse Response       |
                     |   (text, tool_calls,   |
                     |    or stop signal)      |
                     +----------+-------------+
                                |
                   +------------+------------+
                   |                         |
                   v                         v
          +----------------+       +------------------+
          | Text Response  |       | Tool Call(s)     |
          | (final answer  |       +--------+---------+
          |  or thinking)  |                |
          +-------+--------+                v
                  |            +------------------------+
                  |            | Permission Check       |
                  |            | (allow/deny/ask user)  |
                  |            +----------+-------------+
                  |                       |
                  |              +--------+--------+
                  |              |                 |
                  |              v                 v
                  |      +-----------+    +---------------+
                  |      | APPROVED  |    | DENIED/ASKED  |
                  |      +-----+-----+    +-------+-------+
                  |            |                  |
                  |            v                  v
                  |   +------------------+  +------------------+
                  |   | Execute in       |  | Return denial    |
                  |   | Sandbox          |  | to LLM as tool   |
                  |   +--------+---------+  | result           |
                  |            |             +--------+---------+
                  |            v                      |
                  |   +------------------+            |
                  |   | Collect Result   |            |
                  |   +--------+---------+            |
                  |            |                      |
                  |            v                      |
                  |   +------------------+            |
                  |   | Update State     +<-----------+
                  |   | (history, memory,|
                  |   |  checkpoints)    |
                  |   +--------+---------+
                  |            |
                  |            v
                  |   +------------------+
                  |   | Check Termination|
                  |   | Conditions       |
                  |   +--------+---------+
                  |            |
                  |     +------+------+
                  |     |             |
                  |     v             v
                  |  Continue      Return
                  |  (loop)        Result
                  |     |             |
                  +-----+-------------+
```

### Implementing the Core Loop

Here is a minimal but structurally complete event loop in Python:

```python
import time
from dataclasses import dataclass, field
from typing import Any, Callable
from enum import Enum


class LoopStatus(Enum):
    CONTINUE = "continue"
    DONE = "done"
    ERROR = "error"


@dataclass
class ToolCall:
    id: str
    name: str
    arguments: dict[str, Any]


@dataclass
class ToolResult:
    tool_call_id: str
    output: str
    is_error: bool = False


@dataclass
class LoopState:
    messages: list[dict] = field(default_factory=list)
    tool_results: list[ToolResult] = field(default_factory=list)
    iterations: int = 0
    total_tokens: int = 0
    start_time: float = field(default_factory=time.time)


class AgentEventLoop:
    def __init__(
        self,
        llm_client,
        tools: dict[str, Callable],
        system_prompt: str,
        permission_handler=None,
        sandbox=None,
        max_iterations: int = 50,
        max_duration_seconds: float = 300,
        max_tokens_budget: int = 500_000,
    ):
        self.llm = llm_client
        self.tools = tools
        self.system_prompt = system_prompt
        self.permission_handler = permission_handler
        self.sandbox = sandbox
        self.max_iterations = max_iterations
        self.max_duration = max_duration_seconds
        self.max_tokens = max_tokens_budget

    def run(self, user_input: str) -> str:
        state = LoopState()
        state.messages = [
            {"role": "system", "content": self.system_prompt},
            {"role": "user", "content": user_input},
        ]

        while True:
            # --- Termination checks ---
            status = self._check_termination(state)
            if status == LoopStatus.DONE:
                return self._extract_final_answer(state)
            if status == LoopStatus.ERROR:
                return self._format_error(state)

            # --- Call LLM ---
            response = self._call_llm_with_retry(state)
            state.total_tokens += response.usage.total_tokens
            state.iterations += 1

            message = response.choices[0].message
            state.messages.append(message.to_dict())

            # --- No tool calls: check if this is a final answer ---
            if not message.tool_calls:
                if self._is_final_answer(message):
                    return message.content
                # Model produced thinking text; continue the loop
                continue

            # --- Process tool calls ---
            for tool_call in message.tool_calls:
                parsed = ToolCall(
                    id=tool_call.id,
                    name=tool_call.function.name,
                    arguments=_parse_arguments(tool_call.function.arguments),
                )

                # Permission check
                decision = self._check_permission(parsed)
                if decision == "deny":
                    result = ToolResult(
                        tool_call_id=parsed.id,
                        output=f"Permission denied: tool '{parsed.name}' is not allowed "
                               f"with these arguments.",
                        is_error=True,
                    )
                elif decision == "ask":
                    # Human-in-the-loop: block until user approves
                    approved = self._ask_user(parsed)
                    if not approved:
                        result = ToolResult(
                            tool_call_id=parsed.id,
                            output="User denied this tool call.",
                            is_error=True,
                        )
                    else:
                        result = self._execute_tool(parsed)
                else:
                    result = self._execute_tool(parsed)

                state.tool_results.append(result)
                state.messages.append({
                    "role": "tool",
                    "tool_call_id": result.tool_call_id,
                    "content": result.output,
                })

    def _check_termination(self, state: LoopState) -> LoopStatus:
        if state.iterations >= self.max_iterations:
            return LoopStatus.ERROR
        elapsed = time.time() - state.start_time
        if elapsed > self.max_duration:
            return LoopStatus.ERROR
        if state.total_tokens > self.max_tokens:
            return LoopStatus.ERROR
        return LoopStatus.CONTINUE

    def _call_llm_with_retry(self, state: LoopState, max_retries=3):
        for attempt in range(max_retries):
            try:
                return self.llm.chat.completions.create(
                    model="gpt-4o",
                    messages=state.messages,
                    tools=self._tool_definitions(),
                )
            except RateLimitError:
                wait = 2 ** attempt
                time.sleep(wait)
            except APIError as e:
                if attempt == max_retries - 1:
                    raise
                time.sleep(1)

    def _execute_tool(self, tool_call: ToolCall) -> ToolResult:
        fn = self.tools.get(tool_call.name)
        if fn is None:
            return ToolResult(
                tool_call_id=tool_call.id,
                output=f"Unknown tool: {tool_call.name}",
                is_error=True,
            )
        try:
            if self.sandbox:
                output = self.sandbox.execute(fn, tool_call.arguments)
            else:
                output = fn(**tool_call.arguments)
            return ToolResult(tool_call_id=tool_call.id, output=str(output))
        except Exception as e:
            return ToolResult(
                tool_call_id=tool_call.id,
                output=f"Tool execution error: {type(e).__name__}: {str(e)}",
                is_error=True,
            )
```

### The TypeScript Equivalent

```typescript
interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

interface ToolResult {
  toolCallId: string;
  output: string;
  isError: boolean;
}

interface LoopState {
  messages: Message[];
  iterations: number;
  totalTokens: number;
  startTime: number;
}

type PermissionDecision = "allow" | "deny" | "ask";

interface HarnessConfig {
  llmClient: LLMClient;
  tools: Map<string, ToolFunction>;
  systemPrompt: string;
  permissionHandler: PermissionHandler;
  maxIterations: number;
  maxDurationMs: number;
  maxTokensBudget: number;
}

class AgentHarness {
  private config: HarnessConfig;

  constructor(config: HarnessConfig) {
    this.config = config;
  }

  async run(userInput: string): Promise<string> {
    const state: LoopState = {
      messages: [
        { role: "system", content: this.config.systemPrompt },
        { role: "user", content: userInput },
      ],
      iterations: 0,
      totalTokens: 0,
      startTime: Date.now(),
    };

    while (true) {
      // Termination checks
      this.checkTermination(state);

      // Call LLM
      const response = await this.callLLMWithRetry(state);
      state.totalTokens += response.usage.totalTokens;
      state.iterations++;

      const message = response.choices[0].message;
      state.messages.push(message);

      // No tool calls -- potential final answer
      if (!message.toolCalls?.length) {
        return message.content;
      }

      // Process tool calls (potentially in parallel)
      const results = await Promise.all(
        message.toolCalls.map((tc) => this.processToolCall(tc))
      );

      for (const result of results) {
        state.messages.push({
          role: "tool",
          toolCallId: result.toolCallId,
          content: result.output,
        });
      }
    }
  }

  private async processToolCall(raw: RawToolCall): Promise<ToolResult> {
    const toolCall: ToolCall = {
      id: raw.id,
      name: raw.function.name,
      arguments: JSON.parse(raw.function.arguments),
    };

    const decision = await this.config.permissionHandler.check(toolCall);

    if (decision === "deny") {
      return {
        toolCallId: toolCall.id,
        output: `Permission denied: ${toolCall.name}`,
        isError: true,
      };
    }

    if (decision === "ask") {
      const approved = await this.config.permissionHandler.askUser(toolCall);
      if (!approved) {
        return {
          toolCallId: toolCall.id,
          output: "User denied this operation.",
          isError: true,
        };
      }
    }

    return this.executeTool(toolCall);
  }

  private async executeTool(toolCall: ToolCall): Promise<ToolResult> {
    const fn = this.config.tools.get(toolCall.name);
    if (!fn) {
      return {
        toolCallId: toolCall.id,
        output: `Unknown tool: ${toolCall.name}`,
        isError: true,
      };
    }

    try {
      const output = await fn(toolCall.arguments);
      return {
        toolCallId: toolCall.id,
        output: String(output),
        isError: false,
      };
    } catch (error) {
      return {
        toolCallId: toolCall.id,
        output: `Error: ${error instanceof Error ? error.message : String(error)}`,
        isError: true,
      };
    }
  }

  private checkTermination(state: LoopState): void {
    if (state.iterations >= this.config.maxIterations) {
      throw new MaxIterationsError(state.iterations);
    }
    if (Date.now() - state.startTime > this.config.maxDurationMs) {
      throw new TimeoutError(this.config.maxDurationMs);
    }
    if (state.totalTokens > this.config.maxTokensBudget) {
      throw new BudgetExceededError(state.totalTokens);
    }
  }

  private async callLLMWithRetry(
    state: LoopState,
    maxRetries = 3
  ): Promise<LLMResponse> {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await this.config.llmClient.chat({
          messages: state.messages,
          tools: this.getToolDefinitions(),
        });
      } catch (error) {
        if (attempt === maxRetries - 1) throw error;
        const isRetryable =
          error instanceof RateLimitError || error instanceof ServerError;
        if (!isRetryable) throw error;
        await sleep(Math.pow(2, attempt) * 1000);
      }
    }
    throw new Error("Unreachable");
  }
}
```

### Loop Variants

Not all event loops are identical. The three major variants differ in how they handle tool calls:

**Sequential dispatch.** Tool calls are executed one at a time, in the order the model returns them. Simple, easy to debug, but slow when the model requests multiple independent operations.

**Parallel dispatch.** All tool calls from a single LLM response are executed concurrently (as shown in the TypeScript example above with `Promise.all`). This is the standard in production harnesses because models frequently request 2-5 independent tool calls -- reading multiple files, searching multiple queries -- and sequential execution wastes time.

**Streaming dispatch.** The harness begins executing tool calls as they stream in from the LLM response, before the full response is complete. This is the most aggressive optimization and is used by harnesses that need to minimize latency, such as real-time coding assistants. The complexity is significant: you must handle the case where the model's stream is interrupted after emitting some tool calls but before completing the response.

## Permission Models

The permission model is arguably the most critical component of an agent harness. It answers a deceptively simple question: should this tool call be allowed to execute? The answer determines whether your agent is a productive assistant or a liability.

### The Threat Model

Before designing a permission model, you need to understand what can go wrong. Agent tool calls present several categories of risk:

**Data destruction.** File deletion, database drops, overwriting critical files. A model that misunderstands an instruction can cause irreversible damage.

**Data exfiltration.** An agent with network access and file read access can, in theory, read sensitive files and send them to external servers. This is not just a theoretical concern -- prompt injection attacks can hijack an agent's tool use to exfiltrate data.

**Resource exhaustion.** Infinite loops, unbounded file writes, excessive API calls. Even without malicious intent, a confused model can run up enormous costs or fill up a disk.

**Privilege escalation.** An agent given limited tools might use those tools creatively to achieve effects beyond its intended scope -- for example, using a file-write tool to modify its own configuration or using a shell tool to install additional software.

### Allowlists and Denylists

The simplest permission models use static lists of what is allowed or forbidden.

**Allowlists (whitelists)** specify exactly which tools the agent can use. Everything not on the list is denied by default. This is the safest approach but the most restrictive:

```python
class AllowlistPermissionHandler:
    def __init__(self, allowed_tools: set[str]):
        self.allowed = allowed_tools

    def check(self, tool_call: ToolCall) -> str:
        if tool_call.name in self.allowed:
            return "allow"
        return "deny"


# Only allow read operations
handler = AllowlistPermissionHandler({
    "read_file", "search_files", "list_directory", "search_web"
})
```

**Denylists (blacklists)** specify tools or operations that are forbidden, allowing everything else. This is more permissive but more dangerous -- you must anticipate every dangerous operation:

```python
class DenylistPermissionHandler:
    def __init__(self, denied_tools: set[str]):
        self.denied = denied_tools

    def check(self, tool_call: ToolCall) -> str:
        if tool_call.name in self.denied:
            return "deny"
        return "allow"


# Block destructive operations
handler = DenylistPermissionHandler({
    "delete_file", "execute_shell", "send_email", "modify_permissions"
})
```

The fundamental problem with both approaches is that they operate at the tool-name level. A tool called `write_file` might be perfectly safe when writing to `/tmp/output.txt` and catastrophically dangerous when writing to `/etc/passwd`. This is why production harnesses use more sophisticated models.

### Capability-Based Permissions

Capability-based permission models evaluate not just which tool is being called, but what it is being asked to do. The permission check inspects the arguments and the current context:

```python
from pathlib import Path
from dataclasses import dataclass


@dataclass
class Capability:
    tool: str
    constraints: dict[str, Any]


class CapabilityPermissionHandler:
    def __init__(self, capabilities: list[Capability]):
        self.capabilities = capabilities

    def check(self, tool_call: ToolCall) -> str:
        for cap in self.capabilities:
            if cap.tool != tool_call.name:
                continue
            if self._satisfies_constraints(tool_call, cap.constraints):
                return "allow"
        return "deny"

    def _satisfies_constraints(
        self, tool_call: ToolCall, constraints: dict
    ) -> bool:
        for key, constraint in constraints.items():
            value = tool_call.arguments.get(key)
            if value is None:
                return False

            if key == "path":
                # Path must be within allowed directories
                allowed_dirs = constraint.get("within", [])
                resolved = Path(value).resolve()
                if not any(
                    resolved.is_relative_to(Path(d).resolve())
                    for d in allowed_dirs
                ):
                    return False

                # Check file extension restrictions
                allowed_exts = constraint.get("extensions")
                if allowed_exts and resolved.suffix not in allowed_exts:
                    return False

            if key == "command":
                # Command must match allowed patterns
                allowed_prefixes = constraint.get("prefixes", [])
                if not any(value.startswith(p) for p in allowed_prefixes):
                    return False

        return True


# Example: allow file operations only within the project directory,
# and shell commands only for git and npm
handler = CapabilityPermissionHandler([
    Capability(
        tool="read_file",
        constraints={"path": {"within": ["/home/user/project"]}},
    ),
    Capability(
        tool="write_file",
        constraints={
            "path": {
                "within": ["/home/user/project"],
                "extensions": [".ts", ".js", ".json", ".md", ".py"],
            }
        },
    ),
    Capability(
        tool="execute_shell",
        constraints={
            "command": {"prefixes": ["git ", "npm ", "pnpm ", "node "]}
        },
    ),
])
```

### Human-in-the-Loop Approval

For high-stakes operations, no automated rule can replace human judgment. Human-in-the-loop (HITL) approval pauses the agent loop and presents the proposed operation to a human for approval:

```python
class HITLPermissionHandler:
    def __init__(self, auto_approve: set[str], always_deny: set[str]):
        self.auto_approve = auto_approve
        self.always_deny = always_deny

    def check(self, tool_call: ToolCall) -> str:
        if tool_call.name in self.always_deny:
            return "deny"
        if tool_call.name in self.auto_approve:
            return "allow"
        return "ask"  # Triggers HITL flow

    def ask_user(self, tool_call: ToolCall) -> bool:
        print(f"\n--- PERMISSION REQUEST ---")
        print(f"Tool:      {tool_call.name}")
        print(f"Arguments: {json.dumps(tool_call.arguments, indent=2)}")
        response = input("Allow? [y/N]: ").strip().lower()
        return response == "y"
```

The HITL pattern introduces a design tension: too many approval prompts make the agent useless (the user might as well do the work themselves), while too few approvals defeat the safety purpose. This leads to the tiered model.

### Tiered Permission Model

The tiered model is the dominant pattern in production harnesses. It classifies every tool-argument combination into one of several tiers, each with a different approval policy:

```
+----------+-----------------------+---------------------------+
|   Tier   |      Policy           |       Examples            |
+----------+-----------------------+---------------------------+
| SAFE     | Auto-approve always   | Read file, search,        |
|          |                       | list directory, web search|
+----------+-----------------------+---------------------------+
| MODERATE | Auto-approve with     | Write file (within        |
|          | constraints           | project dir), run tests,  |
|          |                       | git diff, git status      |
+----------+-----------------------+---------------------------+
| ELEVATED | Ask user first time,  | Git commit, npm install,  |
|          | remember for session  | create directory           |
+----------+-----------------------+---------------------------+
| DANGER   | Always ask user       | Delete files, git push,   |
|          |                       | shell commands, network   |
|          |                       | requests to new hosts     |
+----------+-----------------------+---------------------------+
| BLOCKED  | Never allow           | sudo, chmod, system       |
|          |                       | config, env var reads of  |
|          |                       | secrets                   |
+----------+-----------------------+---------------------------+
```

```python
from enum import Enum


class PermissionTier(Enum):
    SAFE = "safe"
    MODERATE = "moderate"
    ELEVATED = "elevated"
    DANGER = "danger"
    BLOCKED = "blocked"


class TieredPermissionHandler:
    def __init__(self, tier_map: dict[str, PermissionTier]):
        self.tier_map = tier_map
        self.session_approvals: set[str] = set()

    def classify(self, tool_call: ToolCall) -> PermissionTier:
        """Classify a tool call into a permission tier.

        This can be as simple as a lookup by tool name, or as complex
        as argument-aware classification using path analysis, command
        parsing, or even an LLM classifier for ambiguous cases.
        """
        base_tier = self.tier_map.get(tool_call.name, PermissionTier.DANGER)

        # Argument-aware escalation: a safe tool can become dangerous
        # with certain arguments
        if tool_call.name == "write_file":
            path = tool_call.arguments.get("path", "")
            if ".env" in path or "secret" in path.lower():
                return PermissionTier.BLOCKED
            if path.startswith("/etc") or path.startswith("/usr"):
                return PermissionTier.BLOCKED

        if tool_call.name == "execute_shell":
            cmd = tool_call.arguments.get("command", "")
            if cmd.startswith("rm ") or "sudo" in cmd:
                return PermissionTier.BLOCKED
            if cmd.startswith("git push"):
                return PermissionTier.DANGER

        return base_tier

    def check(self, tool_call: ToolCall) -> str:
        tier = self.classify(tool_call)

        if tier == PermissionTier.BLOCKED:
            return "deny"
        if tier == PermissionTier.SAFE:
            return "allow"
        if tier == PermissionTier.MODERATE:
            return "allow"  # Allowed but logged
        if tier == PermissionTier.ELEVATED:
            key = f"{tool_call.name}:{_argument_signature(tool_call)}"
            if key in self.session_approvals:
                return "allow"
            return "ask"  # Ask once, remember for session
        if tier == PermissionTier.DANGER:
            return "ask"  # Always ask

        return "deny"

    def record_approval(self, tool_call: ToolCall):
        key = f"{tool_call.name}:{_argument_signature(tool_call)}"
        self.session_approvals.add(key)
```

### Hook-Based Permission Systems

An advanced pattern -- used by Claude Code -- extends the permission model with hooks: user-defined scripts that run before or after tool execution and can modify, approve, or reject operations programmatically:

```python
import subprocess
import json


@dataclass
class HookResult:
    decision: str  # "allow", "deny", "modify"
    modified_arguments: dict | None = None
    reason: str = ""


class HookPermissionHandler:
    def __init__(self, hooks_dir: str):
        self.hooks_dir = Path(hooks_dir)

    def run_pre_hooks(self, tool_call: ToolCall) -> HookResult:
        """Run all pre-execution hooks for this tool call.

        Hooks are scripts (any language) in hooks_dir/pre/{tool_name}/
        They receive the tool call as JSON on stdin and return a decision
        as JSON on stdout.
        """
        hook_dir = self.hooks_dir / "pre" / tool_call.name
        if not hook_dir.exists():
            return HookResult(decision="allow")

        for hook_script in sorted(hook_dir.iterdir()):
            if not hook_script.is_file():
                continue

            result = subprocess.run(
                [str(hook_script)],
                input=json.dumps({
                    "tool": tool_call.name,
                    "arguments": tool_call.arguments,
                }),
                capture_output=True,
                text=True,
                timeout=5,
            )

            if result.returncode != 0:
                return HookResult(
                    decision="deny",
                    reason=f"Hook {hook_script.name} failed: {result.stderr}",
                )

            hook_output = json.loads(result.stdout)
            if hook_output.get("decision") == "deny":
                return HookResult(
                    decision="deny",
                    reason=hook_output.get("reason", "Denied by hook"),
                )
            if hook_output.get("decision") == "modify":
                return HookResult(
                    decision="modify",
                    modified_arguments=hook_output.get("arguments"),
                )

        return HookResult(decision="allow")
```

This is extremely powerful because it lets organizations enforce custom policies -- "no writes to production databases," "all shell commands must be logged to an audit trail," "file writes in the security directory require two approvals" -- without modifying the harness code itself.

## Tool Sandboxing

Permission models decide whether a tool call should execute. Sandboxing decides how it executes -- in what environment, with what isolation guarantees, and with what resource constraints.

### Why Sandboxing Matters

Even with a perfect permission model, the tool itself might be dangerous. Consider a "run Python code" tool that has been approved by the permission layer. The code might:

- Read files outside the intended directory (path traversal)
- Open network connections (data exfiltration)
- Fork-bomb the host (resource exhaustion)
- Modify the sandbox escape mechanism itself
- Run for hours consuming CPU and memory

Sandboxing creates a controlled environment where these risks are mitigated. The spectrum of sandboxing ranges from minimal process-level isolation to full virtual machine isolation:

```
Isolation Level     | Overhead  | Security   | Examples
--------------------|-----------|------------|----------------------------------
No isolation        | None      | None       | Direct function call in process
Process isolation   | Low       | Low-Medium | subprocess with dropped privileges
Container (Docker)  | Medium    | Medium     | Docker with --network=none, read-only fs
microVM (Firecracker)| Medium   | High       | Firecracker, gVisor, Cloud Hypervisor
WASM sandbox        | Low       | High       | Wasmtime, WasmEdge, Extism
Full VM             | High      | Very High  | QEMU, cloud VM per execution
```

### Docker-Based Sandboxing

Docker is the most common sandboxing mechanism for code execution tools in production harnesses. A minimal secure configuration:

```python
import docker
import tempfile
from pathlib import Path


class DockerSandbox:
    def __init__(
        self,
        image: str = "python:3.12-slim",
        memory_limit: str = "256m",
        cpu_quota: int = 50000,  # 50% of one CPU
        timeout: int = 30,
        network_disabled: bool = True,
        read_only_root: bool = True,
    ):
        self.client = docker.from_env()
        self.image = image
        self.memory_limit = memory_limit
        self.cpu_quota = cpu_quota
        self.timeout = timeout
        self.network_disabled = network_disabled
        self.read_only_root = read_only_root

    def execute(self, code: str, workspace_files: dict[str, str] = None) -> str:
        """Execute code in an isolated Docker container.

        Args:
            code: The code to execute
            workspace_files: Files to make available in the sandbox
                             {filename: content}

        Returns:
            Combined stdout and stderr from execution
        """
        with tempfile.TemporaryDirectory() as tmpdir:
            # Write code and workspace files to temp directory
            code_path = Path(tmpdir) / "main.py"
            code_path.write_text(code)

            if workspace_files:
                for name, content in workspace_files.items():
                    (Path(tmpdir) / name).write_text(content)

            try:
                container = self.client.containers.run(
                    self.image,
                    command=["python", "/workspace/main.py"],
                    volumes={
                        tmpdir: {"bind": "/workspace", "mode": "ro"},
                        # Writable /tmp for the code to use
                    },
                    tmpfs={"/tmp": "size=64m"},
                    mem_limit=self.memory_limit,
                    cpu_quota=self.cpu_quota,
                    network_disabled=self.network_disabled,
                    read_only=self.read_only_root,
                    # Security options
                    security_opt=["no-new-privileges:true"],
                    cap_drop=["ALL"],
                    user="nobody",
                    # Timeout
                    detach=True,
                )

                result = container.wait(timeout=self.timeout)
                logs = container.logs(stdout=True, stderr=True).decode()

                if result["StatusCode"] != 0:
                    return f"Exit code {result['StatusCode']}:\n{logs}"
                return logs

            except docker.errors.ContainerError as e:
                return f"Container error: {e}"
            except Exception as e:
                return f"Sandbox error: {type(e).__name__}: {e}"
            finally:
                try:
                    container.remove(force=True)
                except:
                    pass
```

Key security properties of this configuration:

- **`network_disabled=True`**: No network access. The code cannot exfiltrate data or download dependencies.
- **`read_only=True`**: The root filesystem is read-only. Only `/tmp` is writable, with a size limit.
- **`cap_drop=["ALL"]`**: All Linux capabilities are dropped. The process cannot change permissions, mount filesystems, or perform any privileged operations.
- **`user="nobody"`**: The process runs as an unprivileged user.
- **`mem_limit`** and **`cpu_quota`**: Hard resource limits prevent resource exhaustion.
- **`no-new-privileges`**: The process cannot gain additional privileges through setuid binaries.

### Firecracker microVMs

For higher-security environments, Firecracker microVMs provide stronger isolation than containers with lower overhead than full VMs. Firecracker boots a minimal Linux kernel in approximately 125ms with a memory overhead of about 5MB per VM. This makes it practical to spin up a fresh VM for each tool execution:

```
+-------------------+     +-------------------+
|   Agent Harness   |     |  Firecracker VM   |
|                   |     |                   |
|  Tool dispatch  --+---->|  Minimal kernel   |
|                   | API |  Code execution   |
|  Result collect <-+-----+  Stdout capture   |
|                   |     |                   |
+-------------------+     +-------------------+
                          |  Isolated:        |
                          |  - Own kernel     |
                          |  - Own filesystem |
                          |  - No host access |
                          |  - Rate-limited   |
                          |    network (or    |
                          |    none)          |
                          +-------------------+
```

AWS Lambda uses Firecracker under the hood, which is why OpenAI's code interpreter and similar services can offer per-execution isolation at scale.

### WASM Sandboxing

WebAssembly (WASM) provides a compelling alternative for tool sandboxing, especially for tools that do not need a full operating system environment. WASM modules execute in a memory-safe sandbox with no access to the host system unless explicitly granted:

```typescript
import { Extism } from "@extism/extism";

class WasmSandbox {
  private plugin: Extism;

  async initialize(wasmPath: string) {
    this.plugin = await Extism.createPlugin(wasmPath, {
      useWasi: true,
      config: {
        // Explicitly grant only needed capabilities
        allowedPaths: { "/workspace": "/sandboxed/workspace" },
        // No network access by default
        // No filesystem access beyond allowedPaths
      },
      // Memory limits
      memoryLimitPages: 256, // 16MB max
      // Fuel metering (CPU limit)
      fuelLimit: 1_000_000,
    });
  }

  async execute(functionName: string, input: string): Promise<string> {
    const result = await this.plugin.call(functionName, input);
    return result.text();
  }
}
```

WASM sandboxing is particularly attractive for:

- **Plugin systems**: Third-party tools compiled to WASM can be safely executed without trusting the plugin author.
- **Edge environments**: WASM runs in browsers, Cloudflare Workers, and other edge runtimes where Docker is not available.
- **Low-overhead isolation**: No kernel boot, no container startup. A WASM module starts in microseconds.

### Filesystem Sandboxing

Even without full container isolation, filesystem sandboxing prevents tools from accessing files outside their designated workspace. The principle is defense in depth -- restrict the filesystem view even if other isolation layers fail:

```python
import os
from pathlib import Path


class FilesystemSandbox:
    """Restrict file operations to an allowed set of directories."""

    def __init__(self, allowed_roots: list[str], denied_patterns: list[str] = None):
        self.allowed_roots = [Path(r).resolve() for r in allowed_roots]
        self.denied_patterns = denied_patterns or [
            ".env", ".git/config", "id_rsa", ".ssh",
            "credentials", "secret", "token",
        ]

    def validate_path(self, path: str) -> Path:
        """Resolve and validate a path against sandbox rules.

        Raises PermissionError if the path is outside allowed roots
        or matches a denied pattern.
        """
        resolved = Path(path).resolve()

        # Prevent symlink escapes
        if resolved.is_symlink():
            resolved = resolved.readlink().resolve()

        # Check against allowed roots
        if not any(self._is_within(resolved, root) for root in self.allowed_roots):
            raise PermissionError(
                f"Path {resolved} is outside allowed directories: "
                f"{[str(r) for r in self.allowed_roots]}"
            )

        # Check against denied patterns
        path_str = str(resolved).lower()
        for pattern in self.denied_patterns:
            if pattern.lower() in path_str:
                raise PermissionError(
                    f"Path {resolved} matches denied pattern: {pattern}"
                )

        return resolved

    def _is_within(self, path: Path, root: Path) -> bool:
        try:
            path.relative_to(root)
            return True
        except ValueError:
            return False

    def read_file(self, path: str) -> str:
        validated = self.validate_path(path)
        return validated.read_text()

    def write_file(self, path: str, content: str) -> str:
        validated = self.validate_path(path)
        validated.parent.mkdir(parents=True, exist_ok=True)
        validated.write_text(content)
        return f"Wrote {len(content)} bytes to {validated}"
```

### Network Isolation

Network isolation prevents tools from making unauthorized network requests. This is critical for preventing data exfiltration and for ensuring that the agent cannot interact with services it should not access:

```python
import socket
from unittest.mock import patch


class NetworkPolicy:
    """Control which network destinations a tool can reach."""

    def __init__(
        self,
        allowed_hosts: set[str] = None,
        allowed_ports: set[int] = None,
        block_all: bool = False,
    ):
        self.allowed_hosts = allowed_hosts or set()
        self.allowed_ports = allowed_ports or {80, 443}
        self.block_all = block_all

    def check_connection(self, host: str, port: int) -> bool:
        if self.block_all:
            return False
        if self.allowed_hosts and host not in self.allowed_hosts:
            return False
        if port not in self.allowed_ports:
            return False
        return True
```

In practice, network isolation is usually enforced at the container or VM level (Docker `--network=none`, Firecracker network configuration) rather than in application code, because application-level enforcement can be bypassed.

## State Management

A production agent harness must manage several layers of state, each with different persistence requirements and access patterns.

### Layers of State

```
+------------------------------------------------------------------+
|                    STATE HIERARCHY                                 |
|                                                                   |
|  +------------------------------------------------------------+  |
|  |  Conversation State (messages, tool results)                |  |
|  |  Scope: single run | Persistence: in-memory, checkpointed  |  |
|  +------------------------------------------------------------+  |
|                                                                   |
|  +------------------------------------------------------------+  |
|  |  Working Memory (scratchpad, intermediate results, plans)   |  |
|  |  Scope: single run | Persistence: in-memory                |  |
|  +------------------------------------------------------------+  |
|                                                                   |
|  +------------------------------------------------------------+  |
|  |  Tool State (file modifications, database changes)          |  |
|  |  Scope: crosses runs | Persistence: filesystem / database  |  |
|  +------------------------------------------------------------+  |
|                                                                   |
|  +------------------------------------------------------------+  |
|  |  Session State (permission approvals, user preferences)     |  |
|  |  Scope: single session | Persistence: in-memory / file     |  |
|  +------------------------------------------------------------+  |
|                                                                   |
|  +------------------------------------------------------------+  |
|  |  Persistent Memory (learned patterns, user profile)         |  |
|  |  Scope: crosses sessions | Persistence: database / file    |  |
|  +------------------------------------------------------------+  |
+------------------------------------------------------------------+
```

### Checkpoint and Resume

Long-running agent tasks -- multi-file refactoring, research tasks, complex debugging -- benefit enormously from checkpoint/resume capability. If the process dies, the network drops, or the user closes their laptop, the agent should be able to resume from where it left off:

```python
import json
import hashlib
from pathlib import Path
from dataclasses import asdict


class CheckpointManager:
    def __init__(self, checkpoint_dir: str = ".agent_checkpoints"):
        self.dir = Path(checkpoint_dir)
        self.dir.mkdir(exist_ok=True)

    def checkpoint_id(self, task_description: str) -> str:
        return hashlib.sha256(task_description.encode()).hexdigest()[:16]

    def save(self, task_id: str, state: LoopState, metadata: dict = None):
        """Save a checkpoint of the current agent state."""
        checkpoint = {
            "task_id": task_id,
            "messages": state.messages,
            "iterations": state.iterations,
            "total_tokens": state.total_tokens,
            "metadata": metadata or {},
            "timestamp": time.time(),
        }

        path = self.dir / f"{task_id}.json"
        # Write atomically to prevent corruption
        tmp_path = path.with_suffix(".tmp")
        tmp_path.write_text(json.dumps(checkpoint, indent=2, default=str))
        tmp_path.rename(path)

    def load(self, task_id: str) -> LoopState | None:
        """Load a checkpoint if it exists."""
        path = self.dir / f"{task_id}.json"
        if not path.exists():
            return None

        data = json.loads(path.read_text())
        state = LoopState()
        state.messages = data["messages"]
        state.iterations = data["iterations"]
        state.total_tokens = data["total_tokens"]
        return state

    def delete(self, task_id: str):
        """Remove a checkpoint after successful completion."""
        path = self.dir / f"{task_id}.json"
        if path.exists():
            path.unlink()
```

The checkpoint frequency is a tradeoff. Checkpointing after every tool call gives the finest granularity but adds latency and disk I/O. Checkpointing after every N iterations or after particularly expensive operations is a common compromise.

### Working Memory

Working memory is information the agent accumulates during a task that is not part of the conversation history but is needed for effective operation. Examples include:

- A list of files the agent has already read (to avoid re-reading)
- A plan the agent created at the beginning (to track progress)
- Intermediate analysis results (to reference later without re-computing)

```python
class WorkingMemory:
    """Agent scratchpad for accumulating task-relevant information."""

    def __init__(self):
        self.entries: dict[str, str] = {}
        self.plan: list[str] = []
        self.completed_steps: list[str] = []

    def store(self, key: str, value: str):
        self.entries[key] = value

    def recall(self, key: str) -> str | None:
        return self.entries.get(key)

    def set_plan(self, steps: list[str]):
        self.plan = steps

    def complete_step(self, step: str):
        self.completed_steps.append(step)

    def format_for_context(self) -> str:
        """Format working memory as a context string to include in the
        system prompt or as a preamble to the next LLM call."""
        parts = []
        if self.plan:
            remaining = [s for s in self.plan if s not in self.completed_steps]
            parts.append(f"PLAN ({len(self.completed_steps)}/{len(self.plan)} done):")
            for s in self.plan:
                marker = "[x]" if s in self.completed_steps else "[ ]"
                parts.append(f"  {marker} {s}")

        if self.entries:
            parts.append("\nWORKING NOTES:")
            for k, v in self.entries.items():
                parts.append(f"  {k}: {v[:200]}...")

        return "\n".join(parts)
```

This working memory can be injected into the system prompt or appended as a special message at each iteration, giving the model persistent awareness of its progress and accumulated knowledge. For a deeper treatment of memory architectures, see [Agent Memory](/agent-memory).

## Error Handling in Harnesses

Error handling in an agent harness is fundamentally different from error handling in traditional software. In traditional software, an error is a bug to be fixed. In an agent harness, errors are expected events that the system must handle gracefully -- often by giving the error information back to the LLM so it can adapt.

### Taxonomy of Agent Errors

```
Error Type          | Source      | Recovery Strategy
--------------------|-------------|------------------------------------------
Tool not found      | Model       | Return error as tool result; model retries
Invalid arguments   | Model       | Return validation error; model fixes args
Tool execution fail | Tool        | Return error; model tries different approach
Permission denied   | Harness     | Return denial; model uses allowed tools
Rate limit          | LLM API    | Exponential backoff, then retry
Context overflow    | Harness     | Summarize history, trim context, retry
LLM refusal        | LLM        | Rephrase request, reduce scope, or abort
Timeout             | Tool/LLM   | Return timeout error; model simplifies
Budget exceeded     | Harness     | Graceful termination with partial result
Infinite loop       | Model       | Detect repetition, force termination
```

### Implementing Robust Error Handling

```python
class RobustToolExecutor:
    def __init__(self, sandbox, max_retries=2, tool_timeout=30):
        self.sandbox = sandbox
        self.max_retries = max_retries
        self.tool_timeout = tool_timeout
        self.error_counts: dict[str, int] = {}

    def execute(self, tool_call: ToolCall, tools: dict) -> ToolResult:
        fn = tools.get(tool_call.name)
        if fn is None:
            available = ", ".join(tools.keys())
            return ToolResult(
                tool_call_id=tool_call.id,
                output=(
                    f"Error: Unknown tool '{tool_call.name}'. "
                    f"Available tools: {available}"
                ),
                is_error=True,
            )

        # Validate arguments against schema
        validation_error = self._validate_arguments(fn, tool_call.arguments)
        if validation_error:
            return ToolResult(
                tool_call_id=tool_call.id,
                output=f"Argument validation error: {validation_error}",
                is_error=True,
            )

        # Execute with timeout and retry
        for attempt in range(self.max_retries + 1):
            try:
                output = self._execute_with_timeout(fn, tool_call.arguments)
                # Reset error count on success
                self.error_counts[tool_call.name] = 0
                return ToolResult(
                    tool_call_id=tool_call.id,
                    output=str(output),
                    is_error=False,
                )
            except TimeoutError:
                if attempt < self.max_retries:
                    continue
                return ToolResult(
                    tool_call_id=tool_call.id,
                    output=(
                        f"Tool '{tool_call.name}' timed out after "
                        f"{self.tool_timeout}s. Consider simplifying the "
                        f"operation or breaking it into smaller steps."
                    ),
                    is_error=True,
                )
            except Exception as e:
                error_key = tool_call.name
                self.error_counts[error_key] = (
                    self.error_counts.get(error_key, 0) + 1
                )

                # After repeated failures, suggest the model try
                # a different approach entirely
                if self.error_counts[error_key] >= 3:
                    return ToolResult(
                        tool_call_id=tool_call.id,
                        output=(
                            f"Tool '{tool_call.name}' has failed "
                            f"{self.error_counts[error_key]} times. "
                            f"Last error: {type(e).__name__}: {e}. "
                            f"Please try a completely different approach."
                        ),
                        is_error=True,
                    )

                if attempt < self.max_retries:
                    continue

                return ToolResult(
                    tool_call_id=tool_call.id,
                    output=f"Tool error: {type(e).__name__}: {e}",
                    is_error=True,
                )
```

### Infinite Loop Detection

One of the most insidious failure modes in agent systems is the infinite loop: the model keeps calling the same tool with the same arguments, or alternates between two states without making progress. A harness must detect and break these loops:

```python
class LoopDetector:
    def __init__(self, window_size: int = 5, similarity_threshold: float = 0.9):
        self.recent_calls: list[str] = []
        self.window_size = window_size
        self.threshold = similarity_threshold

    def record_and_check(self, tool_call: ToolCall) -> bool:
        """Record a tool call and return True if a loop is detected."""
        signature = f"{tool_call.name}:{json.dumps(tool_call.arguments, sort_keys=True)}"
        self.recent_calls.append(signature)

        if len(self.recent_calls) < self.window_size:
            return False

        window = self.recent_calls[-self.window_size:]

        # Check for exact repetition
        if len(set(window)) == 1:
            return True

        # Check for alternating pattern (A-B-A-B-A)
        if len(set(window)) == 2:
            pattern = window[:2]
            expected = (pattern * (self.window_size // 2 + 1))[:self.window_size]
            if window == expected:
                return True

        # Check for periodic pattern of length 3
        if len(window) >= 6:
            period = window[:3]
            if window == (period * 2)[:len(window)]:
                return True

        return False
```

### Graceful Degradation

When an agent cannot complete its task -- budget exhausted, too many errors, loop detected -- the harness should degrade gracefully rather than crash:

```python
class GracefulDegradation:
    @staticmethod
    def format_partial_result(state: LoopState, reason: str) -> str:
        """When the agent cannot complete, return what it accomplished."""
        parts = [f"Task incomplete. Reason: {reason}\n"]

        # Summarize what was accomplished
        tool_calls = [
            m for m in state.messages
            if isinstance(m, dict) and m.get("role") == "assistant"
            and m.get("tool_calls")
        ]
        successful_tools = [
            m for m in state.messages
            if isinstance(m, dict) and m.get("role") == "tool"
            and "error" not in m.get("content", "").lower()
        ]

        parts.append(f"Completed {len(successful_tools)} successful tool calls "
                      f"across {state.iterations} iterations.")
        parts.append(f"Tokens used: {state.total_tokens}")

        # Include the last substantive assistant message as partial result
        for msg in reversed(state.messages):
            if isinstance(msg, dict) and msg.get("role") == "assistant":
                content = msg.get("content", "")
                if content and len(content) > 50:
                    parts.append(f"\nLast agent output:\n{content}")
                    break

        return "\n".join(parts)
```

## Real-World Harness Implementations

### Claude Code

Claude Code is perhaps the most transparent example of a production agent harness, because its architecture has been extensively documented. Key design decisions:

**Three-tier permission model.** Tools are classified into three categories:

1. **Auto-approved (safe)**: File reads, directory listings, grep/search operations, glob. These are read-only operations that cannot modify the system.
2. **Requires approval (moderate)**: File writes, file edits within the project directory, bash commands that match known safe patterns (like `git status`, `npm test`). The user is asked once; approval can be remembered.
3. **Always requires approval (dangerous)**: Arbitrary bash commands, operations outside the project directory, network-touching operations.

**Hook system.** Claude Code supports user-defined hooks -- scripts that run before or after specific tool executions. A `.claude/hooks.json` file can specify:

```json
{
  "pre_tool": [
    {
      "tool": "bash",
      "command": "python .claude/hooks/audit_bash.py",
      "description": "Audit all bash commands before execution"
    }
  ],
  "post_tool": [
    {
      "tool": "write_file",
      "command": "python .claude/hooks/validate_write.py",
      "description": "Validate file writes against project conventions"
    }
  ]
}
```

Hooks can block execution (exit code non-zero), modify arguments, or simply log for audit purposes. This transforms the harness into a programmable policy engine.

**Context assembly.** Before each LLM call, Claude Code assembles context from multiple sources: the `CLAUDE.md` project instructions file, the current git status, recent file reads, the user's conversation, and any working memory from the session. This context engineering is a critical part of the harness -- see [Context Engineering](/context-engineering) for a deep dive on the principles behind this.

**Streaming execution with tool dispatch.** Claude Code uses streaming responses and begins tool execution as soon as a tool call is fully parsed from the stream, before the complete response finishes generating. This minimizes perceived latency.

### Cursor Agent Mode

Cursor's agent mode wraps an LLM with an IDE-integrated harness that has unique properties:

**Diff-based file editing.** Rather than giving the model a `write_file` tool that replaces entire files, Cursor provides a diff-application tool. The model generates a description of the change, and the harness translates it into a minimal edit. This reduces token usage (the model does not need to regenerate unchanged code) and reduces the risk of accidentally overwriting unrelated code.

**Inline approval.** Permission prompts appear directly in the IDE, showing a diff preview of the proposed change. The user can approve, reject, or modify the change without leaving their editor. This tight feedback loop makes the HITL pattern far less disruptive than a terminal-based approval prompt.

**Multi-file context.** The harness automatically indexes the open project and includes relevant files in the context based on the task. It uses a combination of file path matching, import graph analysis, and semantic similarity to select the most relevant context.

**Checkpoint via undo.** Rather than explicit checkpointing, Cursor integrates with the IDE's undo system. If the agent makes changes the user dislikes, they can undo to the pre-agent state with a single action. This is checkpoint/resume implemented at the tool level rather than the harness level.

### Devin

Devin (by Cognition) represents the most aggressive approach to agent sandboxing: the entire development environment is a sandbox.

**Full VM per session.** Each Devin session runs in an isolated virtual machine with its own filesystem, terminal, browser, and code editor. The agent has full access within this VM -- it can install packages, run servers, open web pages, modify system configuration -- because the VM is disposable and isolated from production systems.

**Multi-modal tool access.** Devin's harness provides tools that span modalities: a terminal for command execution, a code editor for file manipulation, a browser for web research and testing, and a planner for task decomposition. The harness coordinates across these tools, maintaining state across terminal sessions and browser tabs.

**Asynchronous execution.** Unlike Claude Code or Cursor, which operate synchronously with the user, Devin can be given a task and left to work autonomously. The harness manages the full execution loop without human supervision, using its own judgment for all permission decisions within the sandbox. The user reviews results asynchronously.

This design trades interactive control for autonomy. The sandbox must be extremely robust because there is no human in the loop to catch mistakes in real time.

### OpenAI Code Interpreter

OpenAI's code interpreter (used in ChatGPT and the Assistants API) is an example of a harness with a very specific sandbox:

**Firecracker-based isolation.** Each code execution runs in an ephemeral Firecracker microVM. The VM boots in milliseconds, executes the code, and is destroyed. No state persists between executions unless explicitly saved to the session's virtual filesystem.

**Pre-installed environment.** The sandbox comes with a fixed set of Python packages (numpy, pandas, matplotlib, etc.) and cannot install additional packages. This is a deliberate constraint: by controlling the package set, OpenAI can audit the security surface and prevent the model from installing malicious packages.

**File persistence within session.** Files written by one code execution are available to subsequent executions within the same session. This enables multi-step data analysis workflows where the model writes data to a file, then reads it back in a later execution. But files do not persist across sessions.

**Resource limits.** Each execution has strict CPU time, memory, and disk space limits. The model receives an error if it exceeds these limits, and can adapt its approach (for example, processing data in smaller chunks).

## Building a Harness from Scratch

To synthesize the concepts covered above, here is a step-by-step guide to building a complete agent harness. This is not a toy example -- it includes all the layers a production harness needs.

### Step 1: Define the Tool Interface

```python
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any


@dataclass
class ToolDefinition:
    name: str
    description: str
    parameters: dict  # JSON Schema
    permission_tier: str  # "safe", "moderate", "elevated", "danger"


class Tool(ABC):
    @abstractmethod
    def definition(self) -> ToolDefinition:
        """Return the tool's schema for the LLM."""
        ...

    @abstractmethod
    def execute(self, arguments: dict[str, Any]) -> str:
        """Execute the tool and return a string result."""
        ...

    def validate_arguments(self, arguments: dict[str, Any]) -> str | None:
        """Validate arguments. Return error string or None if valid."""
        return None
```

### Step 2: Implement Concrete Tools

```python
class ReadFileTool(Tool):
    def __init__(self, filesystem_sandbox: FilesystemSandbox):
        self.fs = filesystem_sandbox

    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            name="read_file",
            description="Read the contents of a file at the given path.",
            parameters={
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Absolute path to the file to read",
                    }
                },
                "required": ["path"],
            },
            permission_tier="safe",
        )

    def execute(self, arguments: dict[str, Any]) -> str:
        path = arguments["path"]
        return self.fs.read_file(path)


class WriteFileTool(Tool):
    def __init__(self, filesystem_sandbox: FilesystemSandbox):
        self.fs = filesystem_sandbox

    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            name="write_file",
            description="Write content to a file. Creates parent directories if needed.",
            parameters={
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Absolute file path"},
                    "content": {"type": "string", "description": "File content to write"},
                },
                "required": ["path", "content"],
            },
            permission_tier="moderate",
        )

    def execute(self, arguments: dict[str, Any]) -> str:
        return self.fs.write_file(arguments["path"], arguments["content"])


class BashTool(Tool):
    def __init__(self, sandbox: DockerSandbox | None = None, timeout: int = 30):
        self.sandbox = sandbox
        self.timeout = timeout

    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            name="bash",
            description="Execute a bash command and return stdout/stderr.",
            parameters={
                "type": "object",
                "properties": {
                    "command": {"type": "string", "description": "The bash command to execute"},
                },
                "required": ["command"],
            },
            permission_tier="danger",
        )

    def validate_arguments(self, arguments: dict[str, Any]) -> str | None:
        cmd = arguments.get("command", "")
        dangerous = ["rm -rf /", "mkfs", "> /dev/sda", ":(){ :|:& };:"]
        for pattern in dangerous:
            if pattern in cmd:
                return f"Blocked: command contains dangerous pattern '{pattern}'"
        return None

    def execute(self, arguments: dict[str, Any]) -> str:
        cmd = arguments["command"]
        if self.sandbox:
            return self.sandbox.execute(f"#!/bin/bash\n{cmd}")
        # Fallback: subprocess with timeout (less isolated)
        import subprocess
        result = subprocess.run(
            cmd, shell=True, capture_output=True, text=True, timeout=self.timeout
        )
        output = result.stdout
        if result.stderr:
            output += f"\nSTDERR:\n{result.stderr}"
        if result.returncode != 0:
            output += f"\nExit code: {result.returncode}"
        return output
```

### Step 3: Assemble the Harness

```python
class ProductionHarness:
    """A complete agent harness with all production layers."""

    def __init__(
        self,
        llm_client,
        tools: list[Tool],
        system_prompt: str,
        project_dir: str,
        config: dict = None,
    ):
        config = config or {}
        self.llm = llm_client
        self.tools = {t.definition().name: t for t in tools}
        self.system_prompt = system_prompt

        # Permission layer
        tier_map = {
            t.definition().name: self._tier_to_enum(t.definition().permission_tier)
            for t in tools
        }
        self.permissions = TieredPermissionHandler(tier_map)

        # State management
        self.checkpointer = CheckpointManager(
            checkpoint_dir=f"{project_dir}/.agent_checkpoints"
        )
        self.working_memory = WorkingMemory()
        self.loop_detector = LoopDetector()

        # Configuration
        self.max_iterations = config.get("max_iterations", 50)
        self.max_duration = config.get("max_duration_seconds", 600)
        self.max_tokens = config.get("max_tokens_budget", 1_000_000)
        self.checkpoint_interval = config.get("checkpoint_interval", 5)

    def run(self, user_input: str, resume: bool = True) -> str:
        task_id = self.checkpointer.checkpoint_id(user_input)

        # Attempt to resume from checkpoint
        state = None
        if resume:
            state = self.checkpointer.load(task_id)
            if state:
                print(f"Resuming from checkpoint: {state.iterations} iterations done")

        if state is None:
            state = LoopState()
            state.messages = [
                {"role": "system", "content": self._build_system_context()},
                {"role": "user", "content": user_input},
            ]

        try:
            result = self._event_loop(state, task_id)
            self.checkpointer.delete(task_id)  # Clean up on success
            return result
        except (MaxIterationsError, TimeoutError, BudgetExceededError) as e:
            return GracefulDegradation.format_partial_result(state, str(e))

    def _event_loop(self, state: LoopState, task_id: str) -> str:
        while True:
            # Termination checks
            self._check_limits(state)

            # Inject working memory into context
            self._update_context_with_memory(state)

            # Call LLM
            response = self._call_llm(state)
            state.iterations += 1
            state.total_tokens += response.usage.total_tokens
            message = response.choices[0].message
            state.messages.append(message.to_dict())

            # Checkpoint periodically
            if state.iterations % self.checkpoint_interval == 0:
                self.checkpointer.save(task_id, state)

            # Final answer
            if not message.tool_calls:
                return message.content

            # Process tool calls
            for tc in message.tool_calls:
                parsed = ToolCall(
                    id=tc.id,
                    name=tc.function.name,
                    arguments=json.loads(tc.function.arguments),
                )

                # Loop detection
                if self.loop_detector.record_and_check(parsed):
                    state.messages.append({
                        "role": "tool",
                        "tool_call_id": parsed.id,
                        "content": (
                            "LOOP DETECTED: You have been repeating the same "
                            "operation. Please try a fundamentally different "
                            "approach or provide your current best answer."
                        ),
                    })
                    continue

                # Permission check
                decision = self.permissions.check(parsed)
                if decision == "deny":
                    result = ToolResult(
                        tool_call_id=parsed.id,
                        output=f"Permission denied for {parsed.name}.",
                        is_error=True,
                    )
                elif decision == "ask":
                    approved = self._ask_user_permission(parsed)
                    if approved:
                        self.permissions.record_approval(parsed)
                        result = self._execute_tool(parsed)
                    else:
                        result = ToolResult(
                            tool_call_id=parsed.id,
                            output="User denied this operation.",
                            is_error=True,
                        )
                else:
                    result = self._execute_tool(parsed)

                state.messages.append({
                    "role": "tool",
                    "tool_call_id": result.tool_call_id,
                    "content": result.output,
                })

    def _build_system_context(self) -> str:
        """Assemble the full system prompt with dynamic context."""
        parts = [self.system_prompt]

        memory_context = self.working_memory.format_for_context()
        if memory_context:
            parts.append(f"\n\n## Working Memory\n{memory_context}")

        tool_descriptions = "\n".join(
            f"- {name}: {t.definition().description}"
            for name, t in self.tools.items()
        )
        parts.append(f"\n\n## Available Tools\n{tool_descriptions}")

        return "\n".join(parts)

    def _execute_tool(self, tool_call: ToolCall) -> ToolResult:
        tool = self.tools.get(tool_call.name)
        if not tool:
            return ToolResult(
                tool_call_id=tool_call.id,
                output=f"Unknown tool: {tool_call.name}",
                is_error=True,
            )

        # Validate arguments
        error = tool.validate_arguments(tool_call.arguments)
        if error:
            return ToolResult(
                tool_call_id=tool_call.id,
                output=f"Validation error: {error}",
                is_error=True,
            )

        try:
            output = tool.execute(tool_call.arguments)
            return ToolResult(
                tool_call_id=tool_call.id,
                output=output,
                is_error=False,
            )
        except Exception as e:
            return ToolResult(
                tool_call_id=tool_call.id,
                output=f"Execution error: {type(e).__name__}: {e}",
                is_error=True,
            )
```

### Step 4: Wire It Up

```python
# Initialize sandbox
fs_sandbox = FilesystemSandbox(
    allowed_roots=["/home/user/project"],
    denied_patterns=[".env", ".ssh", "credentials"],
)

# Initialize tools
tools = [
    ReadFileTool(fs_sandbox),
    WriteFileTool(fs_sandbox),
    BashTool(sandbox=DockerSandbox(network_disabled=True), timeout=30),
]

# Create harness
harness = ProductionHarness(
    llm_client=openai.OpenAI(),
    tools=tools,
    system_prompt=(
        "You are a software engineering assistant. You can read and write "
        "files and run bash commands to help the user with coding tasks. "
        "Always read existing files before modifying them. Run tests after "
        "making changes. If a tool call fails, try a different approach."
    ),
    project_dir="/home/user/project",
    config={
        "max_iterations": 30,
        "max_duration_seconds": 300,
        "max_tokens_budget": 500_000,
        "checkpoint_interval": 5,
    },
)

# Run
result = harness.run("Fix the failing test in tests/test_auth.py")
print(result)
```

## Advanced Patterns

### Multi-Model Routing Within the Harness

A sophisticated harness can route different phases of the agent loop to different models. Planning and reasoning benefit from stronger (more expensive) models, while simple tool-result processing can use cheaper models:

```python
class MultiModelHarness(ProductionHarness):
    def __init__(self, strong_model, weak_model, **kwargs):
        super().__init__(**kwargs)
        self.strong_model = strong_model  # e.g., claude-sonnet-4-20250514
        self.weak_model = weak_model      # e.g., claude-haiku

    def _select_model(self, state: LoopState) -> str:
        # Use strong model for first iteration (planning) and
        # when errors have occurred (recovery needs reasoning)
        if state.iterations == 0:
            return self.strong_model

        recent_errors = sum(
            1 for m in state.messages[-6:]
            if isinstance(m, dict) and m.get("role") == "tool"
            and "error" in m.get("content", "").lower()
        )
        if recent_errors >= 2:
            return self.strong_model

        return self.weak_model
```

### Observability Integration

Production harnesses need structured observability -- not just logging, but traces that can be analyzed, alerted on, and used for debugging. For a comprehensive treatment, see [Agent Debugging](/agent-debugging):

```python
import time
from contextlib import contextmanager


class HarnessTracer:
    def __init__(self):
        self.spans: list[dict] = []

    @contextmanager
    def span(self, name: str, metadata: dict = None):
        start = time.time()
        span_data = {"name": name, "start": start, "metadata": metadata or {}}
        try:
            yield span_data
        except Exception as e:
            span_data["error"] = str(e)
            raise
        finally:
            span_data["duration_ms"] = (time.time() - start) * 1000
            self.spans.append(span_data)

    def report(self) -> dict:
        total_duration = sum(s["duration_ms"] for s in self.spans)
        llm_duration = sum(
            s["duration_ms"] for s in self.spans if s["name"] == "llm_call"
        )
        tool_duration = sum(
            s["duration_ms"] for s in self.spans if s["name"].startswith("tool:")
        )
        return {
            "total_duration_ms": total_duration,
            "llm_duration_ms": llm_duration,
            "tool_duration_ms": tool_duration,
            "llm_pct": (llm_duration / total_duration * 100) if total_duration else 0,
            "tool_pct": (tool_duration / total_duration * 100) if total_duration else 0,
            "spans": self.spans,
        }
```

### Agent SDKs as Harness Frameworks

Several frameworks provide pre-built harnesses so you do not need to build everything from scratch. Each makes different tradeoffs (for a comparative survey, see [Agent SDKs](/agent-sdks)):

**Anthropic Claude Agent SDK.** Provides the core event loop, tool registration, permission handling, and streaming. Opinionated about using Claude models but flexible in tool definitions.

**OpenAI Agents SDK.** Includes the Responses API integration, built-in tools (code interpreter, file search, web search), handoff patterns for multi-agent systems, and guardrail hooks.

**LangGraph.** Graph-based agent orchestration with built-in checkpointing, human-in-the-loop nodes, and time-travel debugging. More complex but more flexible for non-standard agent topologies.

**Vercel AI SDK.** TypeScript-first with streaming support, React integration for building agent UIs, and a tool definition API that maps cleanly to frontend state management.

Each of these frameworks is essentially a pre-built harness with varying levels of customization. Choosing between building your own and using a framework depends on how standard your agent's behavior is and how much control you need over the permission model, sandboxing, and state management.

## Design Principles for Agent Harnesses

Having examined the components, implementations, and real-world examples, several design principles emerge:

**1. Defense in depth.** Never rely on a single layer of protection. Combine permission checks, argument validation, filesystem sandboxing, network isolation, and resource limits. Any single layer might have bugs or gaps; the combination makes exploitation far harder.

**2. Fail open to the model, fail closed to the world.** When a tool call fails, the error should flow back to the model as a tool result so it can adapt. But the failure should not leak sensitive information (stack traces with file paths, database connection strings) to the model, and it should not leave the system in an inconsistent state.

**3. Make the common case fast and the dangerous case deliberate.** Auto-approve read operations. Require approval for writes. Block destructive operations. The friction should be proportional to the risk. Users will abandon an agent that asks permission for every file read.

**4. Checkpoint aggressively, resume gracefully.** Long-running agent tasks will be interrupted. Network drops, laptop lids close, processes are killed. The harness that can resume from a checkpoint turns a frustrating interruption into a minor pause.

**5. Observe everything, expose selectively.** Log every LLM call, every tool execution, every permission decision, every error. But expose only what the user needs to see. A streaming status indicator ("Reading file...", "Running tests...") is better than a wall of debug output.

**6. The model is an untrusted input source.** Treat every tool call from the model the same way you would treat user input in a web application: validate, sanitize, constrain. The model might be confused, hallucinating, or compromised by prompt injection. The harness is the last line of defense.

**7. Design for composability.** A well-designed harness can wrap any set of tools, any LLM, any permission model. Keep the layers independent so you can swap Docker sandboxing for WASM, or swap a tiered permission model for a capability-based one, without rewriting the event loop.

## Conclusion

Agent harnesses are the engineering substrate that makes LLM agents viable in production. The LLM provides intelligence; the harness provides everything else -- the execution loop that drives multi-step reasoning, the permission model that prevents harm, the sandbox that isolates dangerous operations, the state management that enables resilience, and the observability that enables debugging. Building a harness is not glamorous work compared to prompt engineering or model selection, but it is the work that separates agents that demo well from agents that ship. The patterns described here -- tiered permissions, capability-based access control, Docker and WASM sandboxing, checkpoint/resume, loop detection, graceful degradation -- are battle-tested across the production harnesses discussed. They form a toolkit that any engineer building agent systems should understand deeply.

For related topics, see [Agent Architectures](/agent-architectures) for the reasoning patterns that harnesses execute, [Function Calling](/function-calling) for the tool integration layer, [Agent Orchestration](/agent-orchestration) for coordinating multiple agents with their own harnesses, [Agent Debugging](/agent-debugging) for diagnosing problems in harness execution, and [Agent SDKs](/agent-sdks) for frameworks that provide pre-built harnesses.
