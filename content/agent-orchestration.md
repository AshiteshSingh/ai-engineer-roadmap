# Agent Orchestration: Routing, Handoffs & Supervisor Patterns

Orchestration is the discipline of coordinating multiple agents, models, or processing stages into a coherent system that accomplishes goals no single agent could handle alone. While a single ReAct agent with tools can solve many problems (see [Agent Architectures](/agent-architectures)), production workloads demand routing decisions, specialist delegation, parallel execution, human approval gates, and graceful degradation under failure. This article provides a deep technical treatment of orchestration patterns -- from simple routers that dispatch to the right model, through handoff protocols that transfer context between agents, to full supervisor architectures that decompose tasks, delegate to specialist teams, and aggregate results. These patterns form the connective tissue between individual agent capabilities and the complex, multi-step workflows required by real applications.

## Why Orchestrate? The Limits of Single-Agent Systems

A single agent -- one LLM with a system prompt, a set of tools, and a loop -- works remarkably well for constrained tasks. But as complexity grows, single-agent systems hit several walls:

**Context window saturation.** A single agent handling research, analysis, code generation, and reporting for a complex task will exhaust its context window long before finishing. Each tool result, each reasoning trace, each intermediate output consumes tokens. By the time the agent reaches the final synthesis step, it has forgotten the early research or is truncating critical context.

**Prompt interference.** A system prompt that simultaneously instructs the model to be a careful researcher, a creative writer, a rigorous code reviewer, and a diplomatic communicator produces mediocre performance on all fronts. Specialization matters -- dedicated agents with focused prompts consistently outperform generalist agents on domain-specific tasks.

**Latency and cost.** A single agent executing 15 sequential tool calls takes 15 round trips. If 8 of those calls are independent, an orchestrated system can fan them out in parallel, cutting wall-clock time substantially. Similarly, routing simple classification tasks to a smaller, cheaper model instead of GPT-4 class models can reduce costs by 50-70% with minimal quality loss.

**Error blast radius.** When a single agent fails, everything fails. An orchestrated system can isolate failures -- if the code-generation agent produces buggy output, the testing agent catches it and the supervisor retries or escalates, without losing progress on other subtasks.

**Auditability.** In regulated domains, you need to know which model made which decision, with what context, and why. Orchestration provides natural boundaries for logging, tracing, and attribution.

The decision to orchestrate should be driven by concrete needs, not architectural enthusiasm. The following diagram captures the decision boundary:

```
                    Single Agent Sufficient?
                           |
            +--------------+--------------+
            |                             |
           YES                            NO
            |                             |
     Simple tasks,              Multi-step tasks,
     single domain,             multiple domains,
     short context,             long context,
     low stakes                 high stakes
            |                             |
     [ReAct / Tool Loop]        Need orchestration
                                          |
                          +-------+-------+-------+
                          |       |       |       |
                       Router  Handoff Supervisor DAG
```

## Routing Patterns

Routing is the simplest form of orchestration: given an input, determine which agent, model, or processing path should handle it. No collaboration between agents, no shared state -- just dispatch.

### Intent Classification Routing

The most common routing pattern classifies the user's intent and dispatches to a specialized handler. This is essentially a classifier in front of a set of agents:

```python
from enum import Enum
from typing import Callable, Any
from pydantic import BaseModel


class Intent(str, Enum):
    CODE_GENERATION = "code_generation"
    DATA_ANALYSIS = "data_analysis"
    CREATIVE_WRITING = "creative_writing"
    CUSTOMER_SUPPORT = "customer_support"
    GENERAL_QUESTION = "general_question"


class RoutingDecision(BaseModel):
    intent: Intent
    confidence: float
    reasoning: str


class IntentRouter:
    """Route user requests to specialized agents based on intent classification."""

    def __init__(self, classifier_llm, agents: dict[Intent, Callable]):
        self.classifier = classifier_llm
        self.agents = agents
        self.fallback_agent = agents.get(Intent.GENERAL_QUESTION)

    async def classify(self, user_message: str) -> RoutingDecision:
        response = await self.classifier.generate(
            system="""Classify the user's intent into exactly one category.
            Return JSON with: intent, confidence (0-1), reasoning.
            Categories: code_generation, data_analysis, creative_writing,
            customer_support, general_question.""",
            user=user_message,
            response_format=RoutingDecision,
        )
        return response

    async def route(self, user_message: str, context: dict = None) -> Any:
        decision = await self.classify(user_message)

        # Low confidence -> fallback or escalate
        if decision.confidence < 0.7:
            return await self.fallback_agent(user_message, context)

        agent = self.agents.get(decision.intent, self.fallback_agent)
        return await agent(user_message, context)
```

The classifier LLM can be a small, fast model -- even a fine-tuned classifier rather than a generative model. The key insight is that routing accuracy matters more than routing sophistication; a wrong route wastes the entire downstream computation.

### Semantic Routing

Instead of asking an LLM to classify intent, semantic routing uses embeddings to match the input against exemplar descriptions of each route:

```python
import numpy as np
from dataclasses import dataclass


@dataclass
class Route:
    name: str
    description: str
    handler: Callable
    exemplars: list[str]
    embedding: np.ndarray = None  # computed at init


class SemanticRouter:
    """Route based on embedding similarity to route descriptions."""

    def __init__(self, embedding_model, routes: list[Route]):
        self.embed = embedding_model
        self.routes = routes
        self._precompute_embeddings()

    def _precompute_embeddings(self):
        for route in self.routes:
            # Combine description and exemplars for richer representation
            texts = [route.description] + route.exemplars
            embeddings = self.embed.encode(texts)
            route.embedding = np.mean(embeddings, axis=0)

    async def route(self, query: str, threshold: float = 0.75) -> Any:
        query_embedding = self.embed.encode([query])[0]

        best_route = None
        best_score = -1.0

        for route in self.routes:
            score = np.dot(query_embedding, route.embedding) / (
                np.linalg.norm(query_embedding) * np.linalg.norm(route.embedding)
            )
            if score > best_score:
                best_score = score
                best_route = route

        if best_score < threshold:
            raise NoRouteMatchError(
                f"Best match '{best_route.name}' scored {best_score:.3f}, "
                f"below threshold {threshold}"
            )

        return await best_route.handler(query)


# Usage
router = SemanticRouter(
    embedding_model=embed_model,
    routes=[
        Route(
            name="sql_agent",
            description="Questions about database queries, SQL, data retrieval",
            handler=sql_agent.run,
            exemplars=[
                "How many users signed up last month?",
                "Show me the top 10 products by revenue",
                "What's the average order value by country?",
            ],
        ),
        Route(
            name="docs_agent",
            description="Questions about product documentation, how-to guides",
            handler=docs_agent.run,
            exemplars=[
                "How do I configure SSO?",
                "What are the API rate limits?",
                "How to set up webhooks?",
            ],
        ),
    ],
)
```

Semantic routing has several advantages over LLM-based classification: it is faster (embedding computation is cheaper than generation), deterministic (same input always produces the same route), and requires no prompt engineering. The tradeoff is that it struggles with ambiguous inputs where understanding the full semantic context of the request matters more than surface similarity.

### LLM-Based Routing with Structured Output

For cases where the routing decision requires genuine reasoning -- considering conversation history, user permissions, current system state -- an LLM router is appropriate:

```python
from pydantic import BaseModel, Field


class RouteDecision(BaseModel):
    """Structured routing decision from the LLM."""
    target_agent: str = Field(
        description="Which agent should handle this request"
    )
    confidence: float = Field(ge=0.0, le=1.0)
    reasoning: str = Field(
        description="Brief explanation of routing rationale"
    )
    requires_context: list[str] = Field(
        default_factory=list,
        description="What context the target agent needs"
    )


class LLMRouter:
    def __init__(self, llm, agent_registry: dict[str, dict]):
        self.llm = llm
        self.registry = agent_registry

    def _build_routing_prompt(self) -> str:
        agent_descriptions = "\n".join(
            f"- **{name}**: {info['description']} "
            f"(capabilities: {', '.join(info['capabilities'])})"
            for name, info in self.registry.items()
        )
        return f"""You are a routing agent. Given a user request,
decide which specialist agent should handle it.

Available agents:
{agent_descriptions}

Consider:
1. Which agent's capabilities best match the request?
2. Does the request require multiple agents? If so, pick the primary one.
3. What context does the target agent need from prior conversation?

Return a structured routing decision."""

    async def route(
        self, message: str, conversation_history: list[dict]
    ) -> RouteDecision:
        decision = await self.llm.generate(
            system=self._build_routing_prompt(),
            messages=conversation_history + [{"role": "user", "content": message}],
            response_format=RouteDecision,
        )
        return decision
```

### Rule-Based Routing

Not everything needs an LLM. Many routing decisions follow deterministic rules based on message content, metadata, or system state:

```python
import re
from dataclasses import dataclass


@dataclass
class RoutingRule:
    name: str
    condition: Callable[[str, dict], bool]
    target: str
    priority: int = 0


class RuleBasedRouter:
    """Deterministic routing based on pattern matching and business rules."""

    def __init__(self, rules: list[RoutingRule], default_target: str):
        self.rules = sorted(rules, key=lambda r: r.priority, reverse=True)
        self.default = default_target

    def route(self, message: str, metadata: dict = None) -> str:
        metadata = metadata or {}
        for rule in self.rules:
            if rule.condition(message, metadata):
                return rule.target
        return self.default


# Example rules
rules = [
    RoutingRule(
        name="urgent_escalation",
        condition=lambda msg, meta: meta.get("priority") == "urgent",
        target="senior_agent",
        priority=100,
    ),
    RoutingRule(
        name="code_request",
        condition=lambda msg, _: bool(
            re.search(r"\b(code|function|implement|debug|fix)\b", msg, re.I)
        ),
        target="code_agent",
        priority=50,
    ),
    RoutingRule(
        name="sql_request",
        condition=lambda msg, _: bool(
            re.search(r"\b(SQL|query|database|table|SELECT|JOIN)\b", msg, re.I)
        ),
        target="sql_agent",
        priority=50,
    ),
]
```

### Hybrid Routing: Cascading Strategies

In practice, the best routing systems combine multiple strategies in a cascade. Rule-based routing handles the obvious cases fast and cheap, semantic routing catches the next tier, and LLM-based routing handles the ambiguous remainder:

```
Input
  |
  v
[Rule-Based Router] -- match --> Agent
  |
  no match
  v
[Semantic Router] -- score > 0.85 --> Agent
  |
  score < 0.85
  v
[LLM Router] -- structured decision --> Agent
  |
  low confidence
  v
[Fallback / Human Escalation]
```

This cascade optimizes for both latency and accuracy: the fast path handles 60-70% of requests with zero LLM calls, semantic routing catches another 20%, and the expensive LLM router only fires for the genuinely ambiguous 10-15%.

## Handoff Patterns

Handoffs occur when one agent transfers control to another, either because the task has moved beyond its expertise or because the workflow requires a specialist at a particular stage. Unlike routing (which is a one-time dispatch decision), handoffs happen mid-conversation and require transferring accumulated context.

### The Swarm Pattern (OpenAI)

OpenAI's Swarm framework introduced a clean handoff pattern where agents can explicitly hand off control to another agent by returning a handoff object instead of a normal response:

```python
from dataclasses import dataclass, field
from typing import Any


@dataclass
class Agent:
    name: str
    system_prompt: str
    tools: list[Callable] = field(default_factory=list)
    model: str = "gpt-4o"


@dataclass
class Handoff:
    """Signals that control should transfer to another agent."""
    target_agent: Agent
    context: dict = field(default_factory=dict)
    reason: str = ""


@dataclass
class Response:
    content: str
    handoff: Handoff | None = None


class SwarmOrchestrator:
    """Lightweight agent-to-agent handoff orchestration."""

    def __init__(self, initial_agent: Agent, max_handoffs: int = 10):
        self.initial_agent = initial_agent
        self.max_handoffs = max_handoffs

    async def run(
        self, messages: list[dict], context: dict = None
    ) -> tuple[str, list[dict]]:
        current_agent = self.initial_agent
        context = context or {}
        handoff_count = 0

        while handoff_count < self.max_handoffs:
            response = await self._call_agent(
                current_agent, messages, context
            )

            if response.handoff is None:
                # Agent completed without handoff -- we're done
                messages.append({
                    "role": "assistant",
                    "content": response.content,
                    "agent": current_agent.name,
                })
                return response.content, messages

            # Process handoff
            handoff = response.handoff
            messages.append({
                "role": "system",
                "content": (
                    f"[Handoff from {current_agent.name} to "
                    f"{handoff.target_agent.name}: {handoff.reason}]"
                ),
            })

            # Transfer context
            context.update(handoff.context)
            current_agent = handoff.target_agent
            handoff_count += 1

        raise MaxHandoffsExceeded(
            f"Exceeded {self.max_handoffs} handoffs without resolution"
        )

    async def _call_agent(
        self, agent: Agent, messages: list[dict], context: dict
    ) -> Response:
        # Build agent-specific system prompt with context
        system = agent.system_prompt
        if context:
            system += f"\n\nCurrent context: {context}"

        response = await llm_call(
            model=agent.model,
            system=system,
            messages=messages,
            tools=agent.tools + self._handoff_tools(agent),
        )

        # Check if the agent invoked a handoff tool
        if has_handoff_tool_call(response):
            return self._process_handoff_tool_call(response)

        return Response(content=response.content)
```

The Swarm pattern's elegance lies in its simplicity: handoffs are just function calls that the agent makes when it decides it is not the right agent for the current subtask. The orchestrator loop handles the mechanics of switching agents and transferring context.

### Context Transfer During Handoffs

The most critical aspect of a handoff is what context transfers with it. Naive handoffs that pass the entire conversation history create problems: the receiving agent's context window fills with irrelevant messages from the previous agent's work, and the signal-to-noise ratio drops.

Effective context transfer strategies:

```python
from abc import ABC, abstractmethod


class ContextTransferStrategy(ABC):
    @abstractmethod
    async def prepare_context(
        self,
        source_agent: str,
        target_agent: str,
        messages: list[dict],
        accumulated_context: dict,
    ) -> dict:
        """Prepare context for the target agent."""
        ...


class SummaryTransfer(ContextTransferStrategy):
    """Summarize the conversation so far for the receiving agent."""

    def __init__(self, summarizer_llm):
        self.summarizer = summarizer_llm

    async def prepare_context(
        self, source_agent, target_agent, messages, accumulated_context
    ) -> dict:
        summary = await self.summarizer.generate(
            system=(
                f"Summarize this conversation for {target_agent}. "
                f"Focus on: decisions made, data gathered, "
                f"what still needs to be done. Be concise."
            ),
            messages=messages,
        )
        return {
            "handoff_summary": summary,
            "source_agent": source_agent,
            **accumulated_context,
        }


class SelectiveTransfer(ContextTransferStrategy):
    """Transfer only messages relevant to the target agent's role."""

    def __init__(self, relevance_filter):
        self.filter = relevance_filter

    async def prepare_context(
        self, source_agent, target_agent, messages, accumulated_context
    ) -> dict:
        relevant = [
            msg for msg in messages
            if self.filter(msg, target_agent)
        ]
        return {
            "relevant_messages": relevant,
            "source_agent": source_agent,
            **accumulated_context,
        }


class StructuredTransfer(ContextTransferStrategy):
    """Transfer context as a structured artifact, not raw messages."""

    async def prepare_context(
        self, source_agent, target_agent, messages, accumulated_context
    ) -> dict:
        # Extract structured artifacts from the conversation
        artifacts = {}
        for msg in messages:
            if "```" in msg.get("content", ""):
                # Extract code blocks, data tables, etc.
                artifacts[msg.get("agent", "unknown")] = extract_artifacts(
                    msg["content"]
                )
        return {
            "artifacts": artifacts,
            "task_state": accumulated_context.get("task_state", {}),
            "source_agent": source_agent,
        }
```

The choice of transfer strategy depends on the relationship between agents. Sequential pipeline stages benefit from structured transfer (pass the artifact, not the conversation). Escalation handoffs (from junior to senior agent) benefit from full conversation history so the senior agent can understand the full context. Lateral handoffs (from one specialist to another) benefit from summary transfer.

### Handoff Protocols

Beyond the mechanics of context transfer, robust handoff systems need protocols that handle edge cases:

```python
@dataclass
class HandoffProtocol:
    """Defines the contract for agent-to-agent handoffs."""

    # Which agents can hand off to which
    allowed_transitions: dict[str, list[str]]

    # Maximum handoff depth (prevents infinite loops)
    max_depth: int = 5

    # Whether the source agent should retain a "watch" on the task
    source_monitors: bool = False

    # Timeout: how long the target agent has before the handoff is
    # considered failed and control returns to the source
    handoff_timeout_seconds: float = 120.0

    # Context transfer strategy
    transfer_strategy: ContextTransferStrategy = None

    def validate_handoff(
        self, source: str, target: str, depth: int
    ) -> bool:
        if depth >= self.max_depth:
            raise HandoffDepthExceeded(
                f"Handoff depth {depth} exceeds max {self.max_depth}"
            )
        if target not in self.allowed_transitions.get(source, []):
            raise InvalidHandoff(
                f"{source} cannot hand off to {target}. "
                f"Allowed: {self.allowed_transitions.get(source, [])}"
            )
        return True
```

This protocol prevents several failure modes: circular handoffs (agent A hands off to B, which hands back to A indefinitely), unauthorized handoffs (a junior agent handing off directly to the final output without review), and deep handoff chains that indicate a task the system fundamentally cannot handle.

## Supervisor / Manager Patterns

The supervisor pattern introduces a meta-agent that does not perform task work itself but instead decomposes tasks, assigns them to specialist agents, monitors progress, and aggregates results. This is the most common orchestration pattern in production multi-agent systems (see [Multi-Agent Systems](/multi-agent-systems) for the broader context of multi-agent coordination).

### Basic Supervisor Architecture

```
                     +-------------------+
                     |    Supervisor     |
                     |  (Meta-Agent)     |
                     +---+-----+----+---+
                         |     |    |
              assign     |     |    |     assign
            +------------+     |    +-----------+
            |                  |                |
            v                  v                v
     +-----------+     +-----------+     +-----------+
     | Research  |     |  Analysis |     |  Writing  |
     |  Agent    |     |   Agent   |     |   Agent   |
     +-----------+     +-----------+     +-----------+
            |                  |                |
            v                  v                v
       [Results]          [Results]         [Results]
            |                  |                |
            +--------+---------+----------------+
                     |
                     v
              +-------------+
              |  Supervisor  |
              |  (Aggregate) |
              +-------------+
                     |
                     v
               Final Output
```

```python
from pydantic import BaseModel
from typing import Any


class SubTask(BaseModel):
    id: str
    description: str
    assigned_agent: str
    dependencies: list[str] = []
    priority: int = 0


class TaskPlan(BaseModel):
    subtasks: list[SubTask]
    execution_strategy: str  # "sequential", "parallel", "mixed"
    reasoning: str


class SupervisorAgent:
    """Meta-agent that decomposes tasks and coordinates specialists."""

    def __init__(
        self,
        planner_llm,
        agents: dict[str, Any],
        max_iterations: int = 3,
    ):
        self.planner = planner_llm
        self.agents = agents
        self.max_iterations = max_iterations

    async def run(self, task: str, context: dict = None) -> str:
        # Phase 1: Decompose the task
        plan = await self._decompose(task, context)

        # Phase 2: Execute subtasks (respecting dependencies)
        results = await self._execute_plan(plan)

        # Phase 3: Aggregate and synthesize
        final = await self._aggregate(task, results)

        # Phase 4: Quality check -- retry if needed
        for iteration in range(self.max_iterations):
            quality = await self._evaluate_quality(task, final)
            if quality.acceptable:
                return final
            # Re-plan with feedback
            plan = await self._replan(task, results, quality.feedback)
            results = await self._execute_plan(plan)
            final = await self._aggregate(task, results)

        return final  # Return best effort after max iterations

    async def _decompose(
        self, task: str, context: dict = None
    ) -> TaskPlan:
        agent_descriptions = {
            name: agent.description for name, agent in self.agents.items()
        }
        plan = await self.planner.generate(
            system=f"""You are a task planning supervisor. Decompose the
            user's task into subtasks for these specialist agents:

            {agent_descriptions}

            Rules:
            - Each subtask must be assigned to exactly one agent.
            - Identify dependencies between subtasks.
            - Prefer parallel execution where possible.
            - Keep subtasks focused and atomic.""",
            user=f"Task: {task}\nContext: {context}",
            response_format=TaskPlan,
        )
        return plan

    async def _execute_plan(
        self, plan: TaskPlan
    ) -> dict[str, Any]:
        results = {}
        # Topological sort by dependencies
        execution_order = self._topological_sort(plan.subtasks)

        for batch in execution_order:
            # Execute independent tasks in parallel
            batch_results = await asyncio.gather(*[
                self._execute_subtask(subtask, results)
                for subtask in batch
            ])
            for subtask, result in zip(batch, batch_results):
                results[subtask.id] = result

        return results

    async def _execute_subtask(
        self, subtask: SubTask, prior_results: dict
    ) -> Any:
        agent = self.agents[subtask.assigned_agent]

        # Build subtask context from dependencies
        dep_context = {
            dep_id: prior_results[dep_id]
            for dep_id in subtask.dependencies
            if dep_id in prior_results
        }

        return await agent.run(
            task=subtask.description,
            context={"dependency_results": dep_context},
        )

    def _topological_sort(
        self, subtasks: list[SubTask]
    ) -> list[list[SubTask]]:
        """Group subtasks into batches that can execute in parallel."""
        remaining = {st.id: st for st in subtasks}
        completed = set()
        batches = []

        while remaining:
            # Find all tasks whose dependencies are satisfied
            ready = [
                st for st in remaining.values()
                if all(dep in completed for dep in st.dependencies)
            ]
            if not ready:
                raise CyclicDependencyError(
                    f"Circular dependency among: {list(remaining.keys())}"
                )
            batches.append(ready)
            for st in ready:
                completed.add(st.id)
                del remaining[st.id]

        return batches

    async def _aggregate(
        self, original_task: str, results: dict[str, Any]
    ) -> str:
        return await self.planner.generate(
            system="""Synthesize the results from specialist agents into
            a coherent final response. Resolve any contradictions.
            Ensure the response fully addresses the original task.""",
            user=f"Original task: {original_task}\n\nResults:\n{results}",
        )
```

### Task Decomposition Strategies

The quality of task decomposition determines the quality of the entire orchestration. Several strategies exist:

**LLM-planned decomposition** (shown above) lets the supervisor LLM analyze the task and generate subtasks dynamically. This is flexible but non-deterministic -- the same task might be decomposed differently on different runs.

**Template-based decomposition** uses predefined task templates for known task types:

```python
TASK_TEMPLATES = {
    "research_report": [
        SubTask(id="gather", description="Search for relevant sources",
                assigned_agent="researcher", dependencies=[]),
        SubTask(id="analyze", description="Analyze and synthesize findings",
                assigned_agent="analyst", dependencies=["gather"]),
        SubTask(id="write", description="Write the report",
                assigned_agent="writer", dependencies=["analyze"]),
        SubTask(id="review", description="Review for accuracy and clarity",
                assigned_agent="reviewer", dependencies=["write"]),
    ],
    "code_feature": [
        SubTask(id="spec", description="Write technical specification",
                assigned_agent="architect", dependencies=[]),
        SubTask(id="implement", description="Implement the feature",
                assigned_agent="developer", dependencies=["spec"]),
        SubTask(id="test", description="Write and run tests",
                assigned_agent="tester", dependencies=["implement"]),
        SubTask(id="review", description="Code review",
                assigned_agent="reviewer", dependencies=["implement"]),
    ],
}
```

**Hybrid decomposition** classifies the task type first, then uses a template as a starting point that the LLM can modify based on task specifics. This gives you the consistency of templates with the flexibility of LLM planning.

### Result Aggregation

Aggregation is not merely concatenating agent outputs. The supervisor must resolve conflicts, fill gaps, and produce a coherent result:

```python
class AggregationStrategy:
    """Strategies for combining results from multiple agents."""

    @staticmethod
    async def sequential_synthesis(
        llm, task: str, results: dict[str, str]
    ) -> str:
        """Feed results to LLM in dependency order for synthesis."""
        ordered = "\n\n---\n\n".join(
            f"## {agent_name}\n{result}"
            for agent_name, result in results.items()
        )
        return await llm.generate(
            system="Synthesize these specialist outputs into one response.",
            user=f"Task: {task}\n\nOutputs:\n{ordered}",
        )

    @staticmethod
    async def voting_aggregation(
        llm, task: str, results: dict[str, str]
    ) -> str:
        """Multiple agents answer the same question; take majority."""
        answers = list(results.values())
        return await llm.generate(
            system=(
                "Multiple agents answered the same question. "
                "Determine the consensus answer. If agents disagree, "
                "evaluate which answer is most likely correct and why."
            ),
            user=f"Task: {task}\n\nAnswers:\n{answers}",
        )

    @staticmethod
    async def hierarchical_merge(
        llm, task: str, results: dict[str, str],
        merge_pairs: list[tuple[str, str]],
    ) -> str:
        """Merge results pairwise in a tree structure."""
        current = dict(results)
        for a, b in merge_pairs:
            merged = await llm.generate(
                system="Merge these two outputs into one coherent result.",
                user=f"Output A ({a}):\n{current[a]}\n\nOutput B ({b}):\n{current[b]}",
            )
            key = f"{a}+{b}"
            current[key] = merged
        # Return the final merged result
        return list(current.values())[-1]
```

## DAG-Based Orchestration

When task dependencies form complex structures -- not just linear pipelines or simple fan-out -- directed acyclic graph (DAG) orchestration provides the right abstraction. Each node in the DAG is an agent task, edges represent data dependencies, and the orchestrator executes nodes in topological order with maximum parallelism.

### DAG Definition and Execution

```python
from dataclasses import dataclass, field
from typing import Any, Callable, Awaitable
import asyncio


@dataclass
class DAGNode:
    id: str
    agent: Callable[..., Awaitable[Any]]
    dependencies: list[str] = field(default_factory=list)
    timeout: float = 60.0
    retry_count: int = 2


class DAGOrchestrator:
    """Execute a DAG of agent tasks with maximum parallelism."""

    def __init__(self, nodes: list[DAGNode]):
        self.nodes = {n.id: n for n in nodes}
        self.results: dict[str, Any] = {}
        self._validate_dag()

    def _validate_dag(self):
        """Ensure no cycles exist in the dependency graph."""
        visited = set()
        in_progress = set()

        def visit(node_id: str):
            if node_id in in_progress:
                raise CyclicDependencyError(f"Cycle detected at {node_id}")
            if node_id in visited:
                return
            in_progress.add(node_id)
            for dep in self.nodes[node_id].dependencies:
                if dep not in self.nodes:
                    raise MissingDependencyError(
                        f"{node_id} depends on unknown node {dep}"
                    )
                visit(dep)
            in_progress.remove(node_id)
            visited.add(node_id)

        for node_id in self.nodes:
            visit(node_id)

    async def execute(self, initial_context: dict = None) -> dict[str, Any]:
        """Execute all nodes respecting dependencies, maximizing parallelism."""
        self.results = {}
        if initial_context:
            self.results.update(initial_context)

        pending = set(self.nodes.keys())
        completed = set()
        events: dict[str, asyncio.Event] = {
            nid: asyncio.Event() for nid in self.nodes
        }

        async def run_node(node_id: str):
            node = self.nodes[node_id]

            # Wait for all dependencies to complete
            for dep_id in node.dependencies:
                await events[dep_id].wait()

            # Gather dependency results
            dep_results = {
                dep_id: self.results[dep_id]
                for dep_id in node.dependencies
            }

            # Execute with retries
            last_error = None
            for attempt in range(node.retry_count + 1):
                try:
                    result = await asyncio.wait_for(
                        node.agent(dep_results),
                        timeout=node.timeout,
                    )
                    self.results[node_id] = result
                    events[node_id].set()
                    return
                except Exception as e:
                    last_error = e
                    if attempt < node.retry_count:
                        await asyncio.sleep(2 ** attempt)  # exponential backoff

            # All retries exhausted
            self.results[node_id] = DAGNodeFailure(
                node_id=node_id, error=last_error
            )
            events[node_id].set()  # unblock dependents

        # Launch all nodes concurrently; dependency waits handle ordering
        await asyncio.gather(*[
            run_node(node_id) for node_id in self.nodes
        ])

        return self.results
```

### Example: Research Pipeline as a DAG

```python
# Define a research pipeline DAG:
#
#   [query_expand] --> [web_search] ----+
#                  \                     |
#                   -> [arxiv_search] ---+--> [synthesize] --> [write_report]
#                  /                     |
#   [identify_experts] --> [expert_search] +

dag = DAGOrchestrator([
    DAGNode(
        id="query_expand",
        agent=query_expansion_agent,
        dependencies=[],
    ),
    DAGNode(
        id="identify_experts",
        agent=expert_identification_agent,
        dependencies=[],
    ),
    DAGNode(
        id="web_search",
        agent=web_search_agent,
        dependencies=["query_expand"],
    ),
    DAGNode(
        id="arxiv_search",
        agent=arxiv_search_agent,
        dependencies=["query_expand"],
    ),
    DAGNode(
        id="expert_search",
        agent=expert_paper_search_agent,
        dependencies=["identify_experts"],
    ),
    DAGNode(
        id="synthesize",
        agent=synthesis_agent,
        dependencies=["web_search", "arxiv_search", "expert_search"],
    ),
    DAGNode(
        id="write_report",
        agent=report_writing_agent,
        dependencies=["synthesize"],
    ),
])

results = await dag.execute({"topic": "agent orchestration patterns"})
```

The DAG structure makes execution dependencies explicit and enables the orchestrator to run `query_expand` and `identify_experts` in parallel, then fan out to three parallel search agents, and finally converge for synthesis and report writing. The total wall-clock time is determined by the critical path, not the sum of all agent execution times.

## Workflow Engines

For durable, long-running agent orchestration -- tasks that span minutes or hours and must survive process restarts -- purpose-built workflow engines provide critical infrastructure.

### LangGraph StateGraph Patterns

LangGraph (covered in depth in [LangGraph](/langgraph)) models orchestration as a state machine where nodes are agent steps and edges define transitions:

```python
from langgraph.graph import StateGraph, START, END
from typing import TypedDict, Annotated, Literal
from langgraph.graph.message import add_messages
from langchain_core.messages import AnyMessage


class OrchestratorState(TypedDict):
    messages: Annotated[list[AnyMessage], add_messages]
    current_agent: str
    task_plan: list[dict]
    completed_tasks: list[str]
    results: dict[str, str]
    iteration: int


def supervisor_node(state: OrchestratorState) -> dict:
    """Supervisor decides the next agent to invoke."""
    plan = state["task_plan"]
    completed = set(state["completed_tasks"])

    # Find next uncompleted task
    for task in plan:
        if task["id"] not in completed:
            return {"current_agent": task["assigned_agent"]}

    return {"current_agent": "aggregator"}


def research_node(state: OrchestratorState) -> dict:
    """Research agent executes its assigned task."""
    result = research_agent.invoke(state["messages"])
    current_task = next(
        t for t in state["task_plan"]
        if t["assigned_agent"] == "researcher"
        and t["id"] not in state["completed_tasks"]
    )
    return {
        "results": {current_task["id"]: result},
        "completed_tasks": [current_task["id"]],
        "messages": [result],
    }


def route_to_agent(state: OrchestratorState) -> Literal[
    "researcher", "analyst", "writer", "aggregator", "__end__"
]:
    """Route to the appropriate agent based on supervisor decision."""
    agent = state["current_agent"]
    if agent == "aggregator":
        return "aggregator"
    return agent


# Build the graph
graph = StateGraph(OrchestratorState)

graph.add_node("supervisor", supervisor_node)
graph.add_node("researcher", research_node)
graph.add_node("analyst", analyst_node)
graph.add_node("writer", writer_node)
graph.add_node("aggregator", aggregator_node)

graph.add_edge(START, "supervisor")
graph.add_conditional_edges("supervisor", route_to_agent)

# After each agent, return to supervisor for next assignment
graph.add_edge("researcher", "supervisor")
graph.add_edge("analyst", "supervisor")
graph.add_edge("writer", "supervisor")
graph.add_edge("aggregator", END)

orchestrator = graph.compile(checkpointer=memory_checkpointer)
```

LangGraph's checkpointing is particularly valuable for orchestration: the entire state -- including partial results from completed agents -- is persisted after every node execution. If the process crashes, the orchestration resumes from the last checkpoint rather than starting over.

### Temporal for Durable Agent Workflows

For enterprise-grade durability requirements -- workflows that must survive not just process restarts but infrastructure failures, and that need visibility, retry policies, and compensation logic -- Temporal provides a proven foundation:

```python
from temporalio import workflow, activity
from temporalio.common import RetryPolicy
from datetime import timedelta


@activity.defn
async def research_activity(topic: str) -> dict:
    """Run the research agent as a Temporal activity."""
    result = await research_agent.run(topic)
    return {"findings": result, "agent": "researcher"}


@activity.defn
async def analysis_activity(findings: dict) -> dict:
    """Run the analysis agent on research findings."""
    result = await analysis_agent.run(findings)
    return {"analysis": result, "agent": "analyst"}


@activity.defn
async def writing_activity(analysis: dict) -> str:
    """Run the writing agent to produce final output."""
    return await writing_agent.run(analysis)


@workflow.defn
class AgentOrchestrationWorkflow:
    """Durable agent orchestration workflow with Temporal."""

    @workflow.run
    async def run(self, task: str) -> str:
        retry_policy = RetryPolicy(
            initial_interval=timedelta(seconds=5),
            backoff_coefficient=2.0,
            maximum_attempts=3,
            maximum_interval=timedelta(minutes=2),
            non_retryable_error_types=["InvalidTaskError"],
        )

        # Phase 1: Parallel research
        research_results = await asyncio.gather(
            workflow.execute_activity(
                research_activity,
                task,
                start_to_close_timeout=timedelta(minutes=5),
                retry_policy=retry_policy,
            ),
            workflow.execute_activity(
                research_activity,
                f"academic sources for: {task}",
                start_to_close_timeout=timedelta(minutes=5),
                retry_policy=retry_policy,
            ),
        )

        # Phase 2: Analysis (depends on research)
        analysis = await workflow.execute_activity(
            analysis_activity,
            {"findings": research_results},
            start_to_close_timeout=timedelta(minutes=3),
            retry_policy=retry_policy,
        )

        # Phase 3: Writing (depends on analysis)
        report = await workflow.execute_activity(
            writing_activity,
            analysis,
            start_to_close_timeout=timedelta(minutes=5),
            retry_policy=retry_policy,
        )

        return report
```

Temporal gives you automatic retries with configurable policies, activity timeouts, workflow-level timeouts, signal handling (for human-in-the-loop), and full execution history visible in the Temporal UI. Each activity is independently retryable, and the workflow state is durable across infrastructure failures.

### Event-Driven Orchestration

For loosely coupled agent systems where agents operate independently and communicate through events:

```python
import asyncio
from collections import defaultdict
from dataclasses import dataclass
from typing import Any, Callable, Awaitable


@dataclass
class AgentEvent:
    type: str
    source: str
    payload: Any
    correlation_id: str


class EventBus:
    """Simple in-process event bus for agent coordination."""

    def __init__(self):
        self._handlers: dict[str, list[Callable]] = defaultdict(list)
        self._history: list[AgentEvent] = []

    def subscribe(
        self, event_type: str, handler: Callable[[AgentEvent], Awaitable]
    ):
        self._handlers[event_type].append(handler)

    async def publish(self, event: AgentEvent):
        self._history.append(event)
        handlers = self._handlers.get(event.type, [])
        await asyncio.gather(*[h(event) for h in handlers])


class EventDrivenAgent:
    """An agent that reacts to events and publishes results."""

    def __init__(self, name: str, bus: EventBus, llm):
        self.name = name
        self.bus = bus
        self.llm = llm

    async def on_task_assigned(self, event: AgentEvent):
        result = await self.llm.generate(
            system=f"You are the {self.name} agent.",
            user=event.payload["task"],
        )
        await self.bus.publish(AgentEvent(
            type="task_completed",
            source=self.name,
            payload={"result": result, "task_id": event.payload["task_id"]},
            correlation_id=event.correlation_id,
        ))


# Wire up event-driven orchestration
bus = EventBus()
researcher = EventDrivenAgent("researcher", bus, llm)
analyst = EventDrivenAgent("analyst", bus, llm)

bus.subscribe("research_needed", researcher.on_task_assigned)
bus.subscribe("analysis_needed", analyst.on_task_assigned)
```

Event-driven orchestration excels when agents are truly independent services (possibly running on different machines), when the system needs to scale agents independently, or when new agent types should be addable without modifying the orchestrator.

## Fan-Out / Fan-In

Fan-out/fan-in is a specific orchestration pattern where a single task is distributed to multiple agents in parallel, and their results are merged back together. This is the agent equivalent of map-reduce.

```
                    [Task]
                      |
            +---------+---------+
            |         |         |
            v         v         v
       [Agent A] [Agent B] [Agent C]
            |         |         |
            v         v         v
       [Result A] [Result B] [Result C]
            |         |         |
            +---------+---------+
                      |
                      v
                 [Merge / Reduce]
                      |
                      v
                [Final Result]
```

### Implementation with Concurrency Control

```python
import asyncio
from dataclasses import dataclass
from typing import Any


@dataclass
class FanOutResult:
    agent_name: str
    result: Any
    latency_ms: float
    success: bool
    error: str | None = None


class FanOutFanIn:
    """Parallel agent execution with result merging."""

    def __init__(
        self,
        agents: dict[str, Any],
        merger,
        max_concurrency: int = 10,
        timeout: float = 30.0,
    ):
        self.agents = agents
        self.merger = merger
        self.semaphore = asyncio.Semaphore(max_concurrency)
        self.timeout = timeout

    async def execute(self, task: str) -> Any:
        # Fan-out: dispatch to all agents in parallel
        fan_out_results = await asyncio.gather(*[
            self._run_agent(name, agent, task)
            for name, agent in self.agents.items()
        ])

        # Filter successful results
        successes = [r for r in fan_out_results if r.success]
        failures = [r for r in fan_out_results if not r.success]

        if not successes:
            raise AllAgentsFailedError(
                f"All {len(failures)} agents failed: "
                + "; ".join(f"{f.agent_name}: {f.error}" for f in failures)
            )

        # Fan-in: merge results
        merged = await self.merger.merge(
            task=task,
            results=successes,
            failures=failures,
        )
        return merged

    async def _run_agent(
        self, name: str, agent: Any, task: str
    ) -> FanOutResult:
        async with self.semaphore:
            start = asyncio.get_event_loop().time()
            try:
                result = await asyncio.wait_for(
                    agent.run(task), timeout=self.timeout
                )
                elapsed = (asyncio.get_event_loop().time() - start) * 1000
                return FanOutResult(
                    agent_name=name,
                    result=result,
                    latency_ms=elapsed,
                    success=True,
                )
            except Exception as e:
                elapsed = (asyncio.get_event_loop().time() - start) * 1000
                return FanOutResult(
                    agent_name=name,
                    result=None,
                    latency_ms=elapsed,
                    success=False,
                    error=str(e),
                )
```

### Common Fan-Out Patterns

**Multi-perspective analysis**: The same question is sent to agents with different personas or system prompts, and the merger synthesizes their perspectives.

**Model ensemble**: The same task runs against different models (GPT-4, Claude, Gemini), and results are merged by consensus voting or quality scoring.

**Parallel search**: Different agents search different sources (web, academic papers, internal docs, code repos), and results are merged into a unified knowledge base.

**Chunk processing**: A large document is split into chunks, each processed by a separate agent instance, and results are recombined. This is the classic map-reduce pattern applied to LLM processing.

## Human-in-the-Loop Orchestration

Many production AI workflows require human oversight at critical decision points. Orchestration must support human intervention without breaking the agent execution flow.

### Approval Gates

```python
from enum import Enum
from typing import Any
import asyncio


class ApprovalStatus(str, Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    MODIFIED = "modified"


@dataclass
class ApprovalRequest:
    id: str
    agent_name: str
    action_description: str
    proposed_output: Any
    risk_level: str  # "low", "medium", "high", "critical"
    context: dict


class ApprovalGate:
    """Pauses agent execution pending human approval."""

    def __init__(self, approval_backend):
        self.backend = approval_backend

    async def request_approval(
        self,
        agent_name: str,
        action: str,
        output: Any,
        risk_level: str = "medium",
        context: dict = None,
        timeout_hours: float = 24.0,
    ) -> tuple[ApprovalStatus, Any]:
        request = ApprovalRequest(
            id=generate_id(),
            agent_name=agent_name,
            action_description=action,
            proposed_output=output,
            risk_level=risk_level,
            context=context or {},
        )

        await self.backend.submit(request)

        # Wait for human response (with timeout)
        try:
            response = await asyncio.wait_for(
                self.backend.wait_for_response(request.id),
                timeout=timeout_hours * 3600,
            )
            return response.status, response.modified_output or output
        except asyncio.TimeoutError:
            # Configurable default: reject on timeout for safety
            return ApprovalStatus.REJECTED, None


class GatedSupervisor(SupervisorAgent):
    """Supervisor that requires human approval for high-risk actions."""

    def __init__(self, *args, approval_gate: ApprovalGate, **kwargs):
        super().__init__(*args, **kwargs)
        self.gate = approval_gate

    async def _execute_subtask(
        self, subtask: SubTask, prior_results: dict
    ) -> Any:
        result = await super()._execute_subtask(subtask, prior_results)

        # Determine risk level
        risk = self._assess_risk(subtask, result)

        if risk in ("high", "critical"):
            status, modified = await self.gate.request_approval(
                agent_name=subtask.assigned_agent,
                action=subtask.description,
                output=result,
                risk_level=risk,
                context={"prior_results": prior_results},
            )

            if status == ApprovalStatus.REJECTED:
                raise TaskRejectedByHuman(
                    f"Subtask '{subtask.id}' rejected by reviewer"
                )
            elif status == ApprovalStatus.MODIFIED:
                return modified

        return result

    def _assess_risk(self, subtask: SubTask, result: Any) -> str:
        """Assess risk based on task type and output characteristics."""
        if subtask.assigned_agent in ("code_executor", "db_writer"):
            return "high"
        if "DELETE" in str(result).upper() or "DROP" in str(result).upper():
            return "critical"
        return "low"
```

### Escalation Paths

When an agent encounters uncertainty beyond its threshold, it should escalate rather than guess:

```python
class EscalationManager:
    """Manages escalation from agents to humans or senior agents."""

    def __init__(self, escalation_channels: dict[str, Any]):
        self.channels = escalation_channels
        self.pending_escalations: dict[str, dict] = {}

    async def escalate(
        self,
        source_agent: str,
        reason: str,
        context: dict,
        severity: str = "medium",
    ) -> Any:
        """Escalate to the appropriate channel based on severity."""
        if severity == "critical":
            channel = self.channels["pager"]
        elif severity == "high":
            channel = self.channels["slack_urgent"]
        else:
            channel = self.channels["queue"]

        escalation_id = generate_id()
        self.pending_escalations[escalation_id] = {
            "source": source_agent,
            "reason": reason,
            "context": context,
            "severity": severity,
            "timestamp": now(),
        }

        await channel.notify(
            f"Agent escalation [{severity}] from {source_agent}:\n"
            f"Reason: {reason}\n"
            f"ID: {escalation_id}"
        )

        # For critical/high: block until human responds
        if severity in ("critical", "high"):
            return await channel.wait_for_response(escalation_id)

        # For medium/low: continue with degraded output, human reviews async
        return None
```

### Collaborative Human-Agent Workflows

Beyond simple approval/rejection, advanced orchestration supports true collaboration where humans and agents alternate turns:

```
Human: "Analyze our Q4 sales data and recommend pricing changes."
  |
  v
[Research Agent] -- gathers data, produces analysis
  |
  v
[Human Review] -- "The EU data looks wrong, re-pull from SAP"
  |
  v
[Research Agent] -- re-gathers EU data from SAP
  |
  v
[Analysis Agent] -- produces pricing recommendations
  |
  v
[Human Review] -- "Approved with modification: cap changes at 15%"
  |
  v
[Writing Agent] -- produces final report with capped recommendations
  |
  v
[Final Output]
```

This requires the orchestrator to maintain state across human interaction boundaries, which is where checkpointing (LangGraph) or durable workflow engines (Temporal) become essential rather than optional.

## State Management Across Agents

When multiple agents collaborate, they need shared access to intermediate results, conversation context, and task metadata. Three primary architectures handle this.

### Shared State (Centralized)

All agents read from and write to a single shared state object. This is the LangGraph model:

```python
from typing import TypedDict, Annotated
import operator


class SharedState(TypedDict):
    """Central state shared across all agents in the orchestration."""

    # Task tracking
    task: str
    plan: list[dict]
    completed_steps: Annotated[list[str], operator.add]

    # Accumulated results
    research_findings: Annotated[list[dict], operator.add]
    code_artifacts: Annotated[list[dict], operator.add]
    analysis_results: dict

    # Metadata
    iteration: int
    errors: Annotated[list[str], operator.add]

    # Conversation context
    messages: Annotated[list[dict], add_messages]
```

Shared state is simple and works well when agents are tightly coupled and run in the same process. The reducers (annotated merge functions) handle concurrent writes from parallel branches. The main risk is state bloat -- every agent's output accumulates in the state, consuming memory and (if passed to LLMs) context window tokens.

### Message Passing (Decoupled)

Agents communicate exclusively through messages, never accessing shared state directly. Each agent has an inbox and can send messages to other agents:

```python
class AgentMailbox:
    """Message-passing communication between agents."""

    def __init__(self):
        self._queues: dict[str, asyncio.Queue] = {}

    def register(self, agent_id: str):
        self._queues[agent_id] = asyncio.Queue()

    async def send(
        self, from_agent: str, to_agent: str, message: dict
    ):
        if to_agent not in self._queues:
            raise UnknownAgentError(f"No mailbox for {to_agent}")
        await self._queues[to_agent].put({
            "from": from_agent,
            "timestamp": now(),
            **message,
        })

    async def receive(
        self, agent_id: str, timeout: float = 30.0
    ) -> dict:
        try:
            return await asyncio.wait_for(
                self._queues[agent_id].get(), timeout=timeout
            )
        except asyncio.TimeoutError:
            return None

    async def broadcast(self, from_agent: str, message: dict):
        for agent_id in self._queues:
            if agent_id != from_agent:
                await self.send(from_agent, agent_id, message)
```

Message passing gives you loose coupling, natural concurrency (agents process their inbox independently), and the ability to distribute agents across processes or machines. The tradeoff is complexity: coordinating through messages requires more careful protocol design than reading shared state.

### Blackboard Architecture

The blackboard pattern combines aspects of both approaches: a shared knowledge space (the blackboard) where agents post findings and read others' contributions, with a controller that decides which agent should act next based on the current state of the blackboard:

```python
class Blackboard:
    """Shared knowledge space for multi-agent collaboration."""

    def __init__(self):
        self._entries: dict[str, list[dict]] = {}
        self._lock = asyncio.Lock()
        self._watchers: dict[str, list[Callable]] = {}

    async def post(
        self, category: str, agent: str, content: Any, confidence: float = 1.0
    ):
        async with self._lock:
            if category not in self._entries:
                self._entries[category] = []
            entry = {
                "agent": agent,
                "content": content,
                "confidence": confidence,
                "timestamp": now(),
            }
            self._entries[category].append(entry)

        # Notify watchers
        for watcher in self._watchers.get(category, []):
            await watcher(entry)

    async def read(
        self, category: str, min_confidence: float = 0.0
    ) -> list[dict]:
        async with self._lock:
            entries = self._entries.get(category, [])
            return [
                e for e in entries if e["confidence"] >= min_confidence
            ]

    def watch(self, category: str, callback: Callable):
        if category not in self._watchers:
            self._watchers[category] = []
        self._watchers[category].append(callback)


class BlackboardController:
    """Decides which agent should act based on blackboard state."""

    def __init__(
        self, blackboard: Blackboard, agents: dict[str, Any], rules: list
    ):
        self.bb = blackboard
        self.agents = agents
        self.rules = rules

    async def step(self) -> bool:
        """Execute one step: find the best agent to activate, run it.
        Returns False when no agent can contribute further."""
        for rule in self.rules:
            if await rule.condition(self.bb):
                agent = self.agents[rule.agent_name]
                context = await rule.gather_context(self.bb)
                result = await agent.run(context)
                await self.bb.post(
                    category=rule.output_category,
                    agent=rule.agent_name,
                    content=result,
                )
                return True
        return False  # No rule fired -- we are done

    async def run(self, max_steps: int = 50):
        for _ in range(max_steps):
            active = await self.step()
            if not active:
                break
```

The blackboard architecture is particularly effective for problems where the solution emerges incrementally from contributions by different specialists -- similar to how a medical diagnosis might emerge from contributions by a radiologist, a lab analyst, and a general practitioner all posting findings to a shared patient chart.

## Production Orchestration

Moving agent orchestration from prototype to production introduces concerns that are absent from local development: load balancing, fault tolerance, cost management, and observability.

### Load Balancing Across Agents

When multiple instances of the same agent type process tasks from a shared queue:

```python
import asyncio
from collections import defaultdict


class AgentPool:
    """Pool of agent instances with load balancing."""

    def __init__(
        self,
        agent_factory: Callable,
        min_instances: int = 1,
        max_instances: int = 10,
    ):
        self.factory = agent_factory
        self.min_instances = min_instances
        self.max_instances = max_instances
        self.instances: list[Any] = []
        self.busy: set[int] = set()
        self._lock = asyncio.Lock()

        # Initialize minimum instances
        for _ in range(min_instances):
            self.instances.append(self.factory())

    async def acquire(self) -> tuple[int, Any]:
        """Get an available agent instance."""
        async with self._lock:
            # Find a free instance
            for idx, instance in enumerate(self.instances):
                if idx not in self.busy:
                    self.busy.add(idx)
                    return idx, instance

            # All busy -- scale up if possible
            if len(self.instances) < self.max_instances:
                idx = len(self.instances)
                instance = self.factory()
                self.instances.append(instance)
                self.busy.add(idx)
                return idx, instance

        # At max capacity -- wait for an instance to free up
        while True:
            await asyncio.sleep(0.1)
            async with self._lock:
                for idx in range(len(self.instances)):
                    if idx not in self.busy:
                        self.busy.add(idx)
                        return idx, self.instances[idx]

    async def release(self, idx: int):
        async with self._lock:
            self.busy.discard(idx)

    async def execute(self, task: Any) -> Any:
        idx, agent = await self.acquire()
        try:
            return await agent.run(task)
        finally:
            await self.release(idx)
```

### Fallback Strategies

When an agent or model fails, the orchestrator needs a fallback plan:

```python
class FallbackChain:
    """Try agents in order until one succeeds."""

    def __init__(self, agents: list[tuple[str, Any]], timeout: float = 30.0):
        self.agents = agents  # (name, agent) pairs in priority order
        self.timeout = timeout

    async def execute(self, task: str) -> Any:
        errors = []

        for name, agent in self.agents:
            try:
                result = await asyncio.wait_for(
                    agent.run(task), timeout=self.timeout
                )
                return result
            except Exception as e:
                errors.append((name, str(e)))
                continue

        raise AllFallbacksExhaustedError(
            f"All {len(self.agents)} agents failed: {errors}"
        )


class ModelFallbackAgent:
    """Single agent that falls back through models on failure."""

    def __init__(self, models: list[str], system_prompt: str):
        self.models = models  # e.g., ["gpt-4o", "claude-sonnet", "gpt-4o-mini"]
        self.system_prompt = system_prompt

    async def run(self, task: str) -> str:
        for model in self.models:
            try:
                return await llm_call(
                    model=model,
                    system=self.system_prompt,
                    user=task,
                )
            except (RateLimitError, TimeoutError) as e:
                continue
            except ContentFilterError:
                # Don't retry content filter errors with different models
                raise
        raise AllModelsExhaustedError("All models failed")
```

### Circuit Breakers

When an agent or external service is consistently failing, continued retries waste resources and add latency. Circuit breakers detect failure patterns and short-circuit requests:

```python
import time
from enum import Enum


class CircuitState(str, Enum):
    CLOSED = "closed"      # Normal operation
    OPEN = "open"          # Failing -- reject requests immediately
    HALF_OPEN = "half_open"  # Testing if service has recovered


class CircuitBreaker:
    """Protects agent calls with circuit breaker pattern."""

    def __init__(
        self,
        failure_threshold: int = 5,
        recovery_timeout: float = 60.0,
        success_threshold: int = 2,
    ):
        self.failure_threshold = failure_threshold
        self.recovery_timeout = recovery_timeout
        self.success_threshold = success_threshold

        self.state = CircuitState.CLOSED
        self.failure_count = 0
        self.success_count = 0
        self.last_failure_time = 0.0

    async def call(self, func, *args, **kwargs):
        if self.state == CircuitState.OPEN:
            if time.time() - self.last_failure_time > self.recovery_timeout:
                self.state = CircuitState.HALF_OPEN
                self.success_count = 0
            else:
                raise CircuitOpenError(
                    f"Circuit is open. Retry after "
                    f"{self.recovery_timeout - (time.time() - self.last_failure_time):.0f}s"
                )

        try:
            result = await func(*args, **kwargs)

            if self.state == CircuitState.HALF_OPEN:
                self.success_count += 1
                if self.success_count >= self.success_threshold:
                    self.state = CircuitState.CLOSED
                    self.failure_count = 0

            return result

        except Exception as e:
            self.failure_count += 1
            self.last_failure_time = time.time()

            if self.failure_count >= self.failure_threshold:
                self.state = CircuitState.OPEN

            raise


# Usage: wrap agent calls with circuit breakers
research_breaker = CircuitBreaker(failure_threshold=3, recovery_timeout=120)
analysis_breaker = CircuitBreaker(failure_threshold=5, recovery_timeout=60)

async def safe_research(task):
    return await research_breaker.call(research_agent.run, task)

async def safe_analysis(task):
    return await analysis_breaker.call(analysis_agent.run, task)
```

### Observability for Orchestrated Systems

Tracing distributed agent execution requires correlation IDs that flow through the entire orchestration:

```python
import uuid
from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import Any

trace_id_var: ContextVar[str] = ContextVar("trace_id")
span_id_var: ContextVar[str] = ContextVar("span_id")


@dataclass
class OrchestrationSpan:
    trace_id: str
    span_id: str
    parent_span_id: str | None
    agent_name: str
    operation: str
    start_time: float
    end_time: float | None = None
    status: str = "running"
    metadata: dict = field(default_factory=dict)
    children: list["OrchestrationSpan"] = field(default_factory=list)


class OrchestrationTracer:
    """Traces agent execution across the entire orchestration."""

    def __init__(self, exporter):
        self.exporter = exporter
        self.spans: dict[str, OrchestrationSpan] = {}

    def start_trace(self) -> str:
        trace_id = str(uuid.uuid4())
        trace_id_var.set(trace_id)
        return trace_id

    def start_span(
        self, agent_name: str, operation: str, metadata: dict = None
    ) -> str:
        span_id = str(uuid.uuid4())
        parent = span_id_var.get(None)

        span = OrchestrationSpan(
            trace_id=trace_id_var.get(),
            span_id=span_id,
            parent_span_id=parent,
            agent_name=agent_name,
            operation=operation,
            start_time=time.time(),
            metadata=metadata or {},
        )

        self.spans[span_id] = span
        if parent and parent in self.spans:
            self.spans[parent].children.append(span)

        span_id_var.set(span_id)
        return span_id

    def end_span(self, span_id: str, status: str = "completed"):
        span = self.spans[span_id]
        span.end_time = time.time()
        span.status = status
        self.exporter.export(span)

        # Restore parent span
        if span.parent_span_id:
            span_id_var.set(span.parent_span_id)
```

With proper tracing, you can visualize the entire orchestration as a trace tree:

```
Trace: abc-123
|
+-- [Supervisor] decompose_task (120ms)
|   |
|   +-- [LLM Call] plan_generation (95ms)
|
+-- [Supervisor] execute_plan
    |
    +-- [Researcher] web_search (2.3s)
    |   +-- [Tool] google_search (1.8s)
    |   +-- [LLM Call] summarize_results (450ms)
    |
    +-- [Researcher] arxiv_search (1.9s)   <-- parallel with web_search
    |   +-- [Tool] arxiv_api (1.2s)
    |   +-- [LLM Call] extract_findings (680ms)
    |
    +-- [Analyst] synthesize (1.1s)        <-- waits for both searches
    |   +-- [LLM Call] analysis (980ms)
    |
    +-- [Writer] draft_report (2.1s)
    |   +-- [LLM Call] writing (1.9s)
    |
    +-- [Supervisor] aggregate (340ms)
```

## Putting It All Together: A Complete Orchestration System

The following example ties together routing, handoffs, supervision, and production patterns into a cohesive system:

```python
class ProductionOrchestrator:
    """
    Complete orchestration system combining routing, supervision,
    handoffs, and production resilience patterns.
    """

    def __init__(self, config: OrchestratorConfig):
        # Routing layer
        self.router = HybridRouter(
            rules=config.routing_rules,
            semantic_router=SemanticRouter(config.embed_model, config.routes),
            llm_router=LLMRouter(config.router_llm, config.agent_registry),
        )

        # Agent pools with circuit breakers
        self.pools: dict[str, AgentPool] = {}
        self.breakers: dict[str, CircuitBreaker] = {}
        for name, agent_config in config.agents.items():
            self.pools[name] = AgentPool(
                agent_factory=lambda: create_agent(agent_config),
                min_instances=agent_config.min_instances,
                max_instances=agent_config.max_instances,
            )
            self.breakers[name] = CircuitBreaker(
                failure_threshold=agent_config.failure_threshold,
                recovery_timeout=agent_config.recovery_timeout,
            )

        # Supervisor for complex tasks
        self.supervisor = GatedSupervisor(
            planner_llm=config.supervisor_llm,
            agents=self.pools,
            approval_gate=ApprovalGate(config.approval_backend),
        )

        # Observability
        self.tracer = OrchestrationTracer(config.trace_exporter)

    async def handle(self, request: UserRequest) -> Response:
        trace_id = self.tracer.start_trace()

        try:
            # Step 1: Route
            route_span = self.tracer.start_span("router", "classify")
            route_decision = await self.router.route(
                request.message, request.context
            )
            self.tracer.end_span(route_span)

            # Step 2: Simple tasks -> direct agent execution
            if route_decision.complexity == "simple":
                return await self._execute_simple(
                    route_decision.target_agent, request
                )

            # Step 3: Complex tasks -> supervisor orchestration
            return await self._execute_complex(request)

        except CircuitOpenError as e:
            # Fallback when primary agent circuit is open
            return await self._execute_fallback(request, str(e))

        except Exception as e:
            self.tracer.end_span(trace_id, status="error")
            raise

    async def _execute_simple(
        self, agent_name: str, request: UserRequest
    ) -> Response:
        span = self.tracer.start_span(agent_name, "execute")
        try:
            result = await self.breakers[agent_name].call(
                self.pools[agent_name].execute, request.message
            )
            self.tracer.end_span(span)
            return Response(content=result, trace_id=trace_id_var.get())
        except Exception as e:
            self.tracer.end_span(span, status="error")
            raise

    async def _execute_complex(self, request: UserRequest) -> Response:
        span = self.tracer.start_span("supervisor", "orchestrate")
        result = await self.supervisor.run(
            task=request.message, context=request.context
        )
        self.tracer.end_span(span)
        return Response(content=result, trace_id=trace_id_var.get())
```

## Design Principles and Tradeoffs

Several cross-cutting principles emerge from production orchestration experience:

**Start simple, add complexity incrementally.** A single agent with good tools handles 80% of use cases. Add routing when you have distinct task categories. Add supervision when tasks require decomposition. Add DAG orchestration when you have complex dependency structures. Each layer adds latency, cost, and debugging complexity.

**Make orchestration decisions explicit and traceable.** Every routing decision, handoff, and task assignment should be logged with its reasoning. When the system produces wrong output, you need to trace whether the problem was a bad route, a bad handoff context, a bad subtask decomposition, or a bad agent execution.

**Design for partial failure.** In any system with multiple agents, some will fail. Orchestration must handle partial results gracefully -- aggregate what succeeded, report what failed, and let the user decide whether the partial result is acceptable.

**Context is the scarcest resource.** Every message, every intermediate result, every handoff summary consumes context window tokens. Aggressive context management -- summarization, selective transfer, structured artifacts -- is not an optimization; it is a requirement for orchestrated systems to work at all.

**Test orchestration logic separately from agent logic.** Mock the agents and test that the orchestrator routes correctly, handles failures properly, respects dependency ordering, and produces the right trace structure. Then test agents individually with their own evaluation suites (see [Agent Evaluation](/agent-evaluation)).

## Further Reading

This article covered the mechanics of orchestration. For related topics:

- [Multi-Agent Systems](/multi-agent-systems) -- deeper treatment of multi-agent communication, debate, and collaboration patterns
- [Agent Architectures](/agent-architectures) -- the single-agent patterns (ReAct, Plan-and-Execute, cognitive architectures) that orchestration builds on
- [Agent Harnesses](/agent-harnesses) -- runtime infrastructure for agent execution, sandboxing, and lifecycle management
- [LangGraph](/langgraph) -- detailed coverage of LangGraph's StateGraph, checkpointing, and deployment
- [Production Patterns](/production-patterns) -- broader production AI patterns including map-reduce, prompt management, and testing strategies
- [Function Calling](/function-calling) -- the tool-use primitives that agents within an orchestration rely on
- [Context Engineering](/context-engineering) -- techniques for managing the context window, critical for multi-agent state management
