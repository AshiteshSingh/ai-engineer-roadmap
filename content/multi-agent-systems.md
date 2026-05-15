# Multi-Agent Systems: Orchestration, Delegation & Communication

Multi-agent systems represent a paradigm shift in how we build AI applications: rather than relying on a single monolithic model to handle every aspect of a complex task, work is distributed across specialized agents that collaborate, debate, and coordinate to produce results no single agent could achieve alone. This article examines the architectural patterns, communication protocols, orchestration strategies, and practical frameworks (CrewAI, AutoGen, LangGraph) that define the multi-agent landscape, drawing on both academic research and production experience.

## Why Multiple Agents?

The motivation for multi-agent systems rests on several observations:

**Specialization improves performance.** A single prompt trying to simultaneously handle research, analysis, writing, and code generation often produces mediocre results across all dimensions. Separate agents with focused system prompts, tool sets, and even different underlying models can excel in their respective domains.

**Complex tasks have natural decomposition.** A software engineering task naturally divides into planning, implementation, testing, and review. A research task involves search, analysis, synthesis, and writing. Multi-agent systems mirror these natural divisions.

**Debate and verification improve reliability.** When one agent generates content and another critiques it, the system catches errors that a single agent would miss. This adversarial dynamic, studied extensively in multi-agent debate literature (Du et al., 2023, "Improving Factuality and Reasoning in Language Models through Multiagent Debate"), consistently improves factual accuracy and reasoning quality.

**Scalability.** Multi-agent systems can parallelize work, with different agents handling independent subtasks concurrently.

## Conversation Patterns

Multi-agent communication follows several fundamental patterns, each suited to different types of tasks.

### Sequential Pipeline

The simplest pattern: agents process the task in a fixed sequence, each building on the previous agent's output.

```
[Researcher] → [Analyst] → [Writer] → [Editor] → Final Output
```

```python
class SequentialPipeline:
    def __init__(self, agents: list):
        self.agents = agents

    async def run(self, task: str) -> str:
        result = task
        for agent in self.agents:
            result = await agent.process(result)
        return result

pipeline = SequentialPipeline([
    ResearchAgent(tools=[web_search, arxiv_search]),
    AnalysisAgent(system_prompt="Analyze research findings..."),
    WriterAgent(system_prompt="Write a clear report..."),
    EditorAgent(system_prompt="Edit for clarity and accuracy...")
])
```

**Strengths**: Simple, predictable, easy to debug. Each agent has a clear input/output contract.

**Weaknesses**: No feedback loops. If the editor finds a factual error, it cannot send the work back to the researcher. Information flows only forward.

### Hierarchical Delegation

An orchestrator agent decomposes the task and delegates subtasks to specialized worker agents:

```
              [Orchestrator]
             /    |    \     \
    [Research] [Code] [Test] [Docs]
        |        |      |       |
    [Results] [Code] [Report] [Docs]
              \    |    /      /
              [Orchestrator]
                   |
              [Final Output]
```

```python
class OrchestratorAgent:
    def __init__(self, planner_llm, worker_agents: dict):
        self.planner = planner_llm
        self.workers = worker_agents

    async def run(self, task: str) -> str:
        # Decompose task into subtasks
        plan = await self.planner.generate(
            f"Decompose this task into subtasks for these agents: "
            f"{list(self.workers.keys())}\n\nTask: {task}"
        )
        subtasks = parse_plan(plan)

        # Execute subtasks (parallelize independent ones)
        results = {}
        for batch in topological_sort(subtasks):
            batch_results = await asyncio.gather(*[
                self.workers[st.agent].process(st.description, context=results)
                for st in batch
            ])
            for st, result in zip(batch, batch_results):
                results[st.id] = result

        # Synthesize results
        return await self.planner.generate(
            f"Synthesize these results into a final answer:\n{results}"
        )
```

**Strengths**: Flexible, supports parallelism, naturally handles tasks with complex dependency structures.

**Weaknesses**: The orchestrator is a single point of failure. Its ability to decompose tasks and delegate effectively is crucial.

### Debate and Adversarial Patterns

Multiple agents argue different positions, with a judge agent synthesizing the best answer:

```python
class DebateSystem:
    def __init__(self, debaters: list, judge, num_rounds: int = 3):
        self.debaters = debaters
        self.judge = judge
        self.num_rounds = num_rounds

    async def run(self, question: str) -> str:
        # Initial positions
        positions = []
        for debater in self.debaters:
            pos = await debater.generate(
                f"Answer this question with your best reasoning: {question}"
            )
            positions.append(pos)

        # Debate rounds
        for round in range(self.num_rounds):
            new_positions = []
            for i, debater in enumerate(self.debaters):
                other_positions = [p for j, p in enumerate(positions) if j != i]
                new_pos = await debater.generate(
                    f"Question: {question}\n"
                    f"Your position: {positions[i]}\n"
                    f"Other positions: {other_positions}\n"
                    f"Revise your answer considering these other perspectives."
                )
                new_positions.append(new_pos)
            positions = new_positions

        # Judge synthesizes
        return await self.judge.generate(
            f"Question: {question}\n"
            f"Final positions from {len(positions)} agents:\n"
            + "\n---\n".join(positions) +
            f"\nSynthesize the best answer."
        )
```

Du et al. (2023) demonstrated that multi-agent debate significantly improves mathematical reasoning and factual accuracy. The mechanism is straightforward: when agents see contradictory positions, they are forced to re-examine their reasoning and correct errors.

### Roundtable Discussion

A more flexible variant where agents take turns in a group conversation, building on each other's contributions:

```python
class RoundtableDiscussion:
    def __init__(self, agents: list, moderator, max_turns: int = 10):
        self.agents = agents
        self.moderator = moderator
        self.max_turns = max_turns

    async def run(self, topic: str) -> str:
        transcript = [{"role": "moderator", "content": f"Topic: {topic}"}]

        for turn in range(self.max_turns):
            # Moderator selects next speaker
            next_speaker = await self.moderator.select_speaker(
                transcript, self.agents
            )

            # Agent contributes
            contribution = await next_speaker.generate(
                self._format_transcript(transcript, next_speaker)
            )
            transcript.append({
                "role": next_speaker.name,
                "content": contribution
            })

            # Check if discussion should conclude
            if await self.moderator.should_conclude(transcript):
                break

        return await self.moderator.summarize(transcript)
```

## Frameworks in Depth

### CrewAI

CrewAI models multi-agent systems using the metaphor of a crew with defined roles and processes:

```python
from crewai import Agent, Task, Crew, Process

researcher = Agent(
    role="Senior Research Analyst",
    goal="Uncover cutting-edge developments in AI",
    backstory="You are an expert AI researcher with deep knowledge of the field.",
    tools=[web_search, arxiv_tool],
    llm="gpt-4o"
)

writer = Agent(
    role="Tech Content Writer",
    goal="Write engaging technical content",
    backstory="You specialize in making complex AI concepts accessible.",
    llm="claude-sonnet-4-20250514"
)

research_task = Task(
    description="Research the latest developments in LLM agents",
    expected_output="A comprehensive research brief with key findings",
    agent=researcher
)

writing_task = Task(
    description="Write an article based on the research brief",
    expected_output="A polished 1500-word article",
    agent=writer,
    context=[research_task]  # This task depends on the research task
)

crew = Crew(
    agents=[researcher, writer],
    tasks=[research_task, writing_task],
    process=Process.sequential  # or Process.hierarchical
)

result = crew.kickoff()
```

CrewAI's key design decisions:

- **Role-based agent definition**: The `role`, `goal`, and `backstory` fields shape the agent's behavior through system prompts
- **Task dependency graph**: The `context` parameter creates explicit data flow between tasks
- **Process types**: Sequential (fixed order) or hierarchical (manager agent delegates)
- **Inter-agent delegation**: Agents can delegate to each other when `allow_delegation=True`

### AutoGen (Microsoft)

AutoGen underwent a significant API redesign in version 0.4, moving from the monolithic `autogen` package to a modular `autogen-agentchat` architecture built on an asynchronous, event-driven runtime. The 0.2 API (shown in many tutorials) used `ConversableAgent` and synchronous `initiate_chat` calls. The 0.4+ API introduces `AssistantAgent`, explicit team constructs, and async-first execution.

```python
from autogen_agentchat.agents import AssistantAgent
from autogen_agentchat.teams import RoundRobinGroupChat
from autogen_agentchat.conditions import TextMentionTermination
from autogen_ext.models.openai import OpenAIChatCompletionClient

model_client = OpenAIChatCompletionClient(model="gpt-4o")

coder = AssistantAgent(
    name="Coder",
    system_message="You are a Python developer. Write clean, tested code.",
    model_client=model_client,
)

reviewer = AssistantAgent(
    name="Reviewer",
    system_message=(
        "You review code for bugs, security issues, and best practices. "
        "Say APPROVE when the code is ready."
    ),
    model_client=model_client,
)

termination = TextMentionTermination("APPROVE")
team = RoundRobinGroupChat(
    participants=[coder, reviewer],
    termination_condition=termination,
    max_turns=12,
)

# Async-first execution
result = await team.run(task="Write a web scraper for HN front page")
```

Key changes in the 0.4+ API:

- **Modular packages**: Core runtime (`autogen-core`), chat patterns (`autogen-agentchat`), and extensions (`autogen-ext`) are separate installable packages
- **Async-native**: All agent execution is async by default; the runtime uses an event-driven message-passing model
- **Explicit team constructs**: `RoundRobinGroupChat`, `SelectorGroupChat`, and `Swarm` replace the older `GroupChat` + `GroupChatManager` pattern
- **Termination conditions**: Composable conditions (`TextMentionTermination`, `MaxMessageTermination`, custom) replace the older `max_round` / exit-keyword approach
- **Model client abstraction**: `OpenAIChatCompletionClient` and other clients replace the flat `llm_config` dict, enabling cleaner multi-model setups
- **Built-in Swarm team type**: AutoGen 0.4 includes a `Swarm` team type that implements handoff-based multi-agent coordination similar to OpenAI's Swarm pattern (see below)

The migration from 0.2 to 0.4 is non-trivial. If you are starting a new project, use the 0.4 API. If maintaining an existing 0.2 codebase, Microsoft provides a migration guide, but expect to rewrite agent definitions and execution logic.

### OpenAI Swarm and the Handoff Pattern

OpenAI's Swarm (2024) is a lightweight, educational reference implementation that demonstrates a minimalist approach to multi-agent coordination. Its core idea is that agent-to-agent handoffs can be modeled as simple function returns -- no message bus, no orchestrator, no state machine.

```python
from swarm import Swarm, Agent

def transfer_to_support():
    """Hand off to the support agent."""
    return support_agent

def transfer_to_sales():
    """Hand off to the sales agent."""
    return sales_agent

triage_agent = Agent(
    name="Triage",
    instructions="Determine the user's intent and hand off to the appropriate specialist.",
    functions=[transfer_to_sales, transfer_to_support],
)

support_agent = Agent(
    name="Support",
    instructions="Help the user with technical issues.",
    functions=[lookup_order, check_status],
)

sales_agent = Agent(
    name="Sales",
    instructions="Help the user with purchasing decisions.",
    functions=[check_inventory, create_quote],
)

client = Swarm()
response = client.run(
    agent=triage_agent,
    messages=[{"role": "user", "content": "My order hasn't arrived"}]
)
```

Swarm is explicitly not a production framework -- OpenAI describes it as educational and experimental. But the handoff pattern it demonstrates is architecturally significant. The key insight is that an agent can delegate by returning another agent object from a tool call, transferring conversational context and control in one step. This same pattern appears in AutoGen 0.4's `Swarm` team type and can be implemented in any framework.

The handoff pattern works well for customer service routing, multi-step workflows with clear domain boundaries, and any system where the set of agents is known ahead of time and transitions between them are well-defined. For a deeper treatment of how Swarm fits into the broader agent architecture landscape, see [Article 26: Agent Architectures](/agent-architectures).

### LangGraph for Multi-Agent Systems

LangGraph models multi-agent systems as state machines with explicit control flow. For LangGraph fundamentals (StateGraph, reducers, conditional edges, Send, persistence, and platform deployment), see the dedicated [LangGraph](/langgraph) article. This section focuses specifically on multi-agent patterns:

```python
from langgraph.graph import StateGraph, END
from typing import TypedDict, Literal

class MultiAgentState(TypedDict):
    task: str
    research: str
    draft: str
    review: str
    final: str
    iteration: int

def research_node(state):
    result = research_agent.invoke(state["task"])
    return {"research": result}

def draft_node(state):
    result = writer_agent.invoke(
        f"Task: {state['task']}\nResearch: {state['research']}"
    )
    return {"draft": result}

def review_node(state):
    result = reviewer_agent.invoke(state["draft"])
    return {"review": result, "iteration": state["iteration"] + 1}

def route_after_review(state) -> Literal["draft", "final"]:
    if "APPROVED" in state["review"]:
        return "final"
    if state["iteration"] >= 3:
        return "final"
    return "draft"

graph = StateGraph(MultiAgentState)
graph.add_node("research", research_node)
graph.add_node("draft", draft_node)
graph.add_node("review", review_node)
graph.add_node("final", lambda s: {"final": s["draft"]})

graph.set_entry_point("research")
graph.add_edge("research", "draft")
graph.add_edge("draft", "review")
graph.add_conditional_edges("review", route_after_review)
graph.add_edge("final", END)

app = graph.compile()
```

LangGraph's advantages for multi-agent systems:

- **Explicit control flow**: No ambiguity about which agent acts when
- **Checkpointing and persistence**: State can be saved and resumed
- **Cycles with bounded iteration**: The review-revision loop has a clear termination condition
- **Subgraphs**: Each agent can internally be a subgraph with its own state machine

## Agent Role Specialization

Effective multi-agent systems require careful role design. Several principles emerge from practice:

### Principle of Minimal Authority

Each agent should have access only to the tools and information it needs. A research agent does not need database write access. A code reviewer does not need code execution capability.

```python
research_agent = Agent(
    tools=[web_search, document_reader],  # Read-only tools
    system_prompt="You research topics. You CANNOT modify data."
)

database_agent = Agent(
    tools=[sql_query, sql_insert],  # Database tools only
    system_prompt="You manage database operations. Validate all inputs."
)
```

### Clear Handoff Protocols

Agents need clear signals for when to hand off work and what information to include:

```python
class HandoffProtocol:
    @staticmethod
    def create_handoff(from_agent: str, to_agent: str,
                       task: str, context: dict, constraints: list) -> dict:
        return {
            "from": from_agent,
            "to": to_agent,
            "task": task,
            "context": context,
            "constraints": constraints,
            "timestamp": datetime.now().isoformat()
        }
```

### Complementary Capabilities

Agents should have complementary rather than overlapping capabilities. Overlap leads to ambiguity about which agent should handle a subtask and can cause coordination overhead.

## Inter-Agent Communication Protocols

### Structured Message Passing

Rather than free-form text, structured messages reduce ambiguity:

```python
@dataclass
class AgentMessage:
    sender: str
    recipient: str
    message_type: Literal["request", "response", "question", "feedback"]
    content: str
    metadata: dict
    references: list[str]  # IDs of messages this responds to

    def to_prompt_format(self) -> str:
        return (
            f"[{self.message_type.upper()} from {self.sender}]\n"
            f"{self.content}\n"
            f"[END MESSAGE]"
        )
```

### Shared Blackboard Pattern

A shared workspace where agents read from and write to a common knowledge base:

```python
class Blackboard:
    def __init__(self):
        self.entries = {}
        self.lock = asyncio.Lock()

    async def write(self, agent_id: str, key: str, value: any):
        async with self.lock:
            self.entries[key] = {
                "value": value,
                "author": agent_id,
                "timestamp": time.time()
            }

    async def read(self, key: str) -> any:
        return self.entries.get(key, {}).get("value")

    async def get_recent_entries(self, n: int = 10) -> list:
        sorted_entries = sorted(
            self.entries.items(),
            key=lambda x: x[1]["timestamp"],
            reverse=True
        )
        return sorted_entries[:n]
```

The blackboard pattern is particularly useful when agents need to share intermediate results without direct message passing, such as when a research agent discovers information that multiple other agents need.

### Event-Driven Communication

For systems where agents need to react to changes rather than being explicitly invoked:

```python
class EventBus:
    def __init__(self):
        self.subscribers = defaultdict(list)

    def subscribe(self, event_type: str, agent, handler):
        self.subscribers[event_type].append((agent, handler))

    async def publish(self, event_type: str, data: dict):
        for agent, handler in self.subscribers[event_type]:
            await handler(agent, data)

# Usage
bus = EventBus()
bus.subscribe("code_written", reviewer_agent, review_handler)
bus.subscribe("code_written", test_agent, test_handler)
bus.subscribe("review_complete", coder_agent, revision_handler)
```

## Consensus Mechanisms

When multiple agents need to agree on a decision, consensus mechanisms prevent deadlocks and ensure convergence:

### Majority Voting

The simplest approach: each agent votes, and the majority wins.

```python
async def majority_vote(agents, question, options):
    votes = await asyncio.gather(*[
        agent.vote(question, options) for agent in agents
    ])
    vote_counts = Counter(votes)
    winner = vote_counts.most_common(1)[0]
    return winner[0], winner[1] / len(votes)  # choice, confidence
```

### Weighted Voting

Agents with more expertise in the domain get more weight:

```python
async def weighted_vote(agents, question, options, weights):
    votes = await asyncio.gather(*[
        agent.vote(question, options) for agent in agents
    ])
    weighted_counts = defaultdict(float)
    for vote, weight in zip(votes, weights):
        weighted_counts[vote] += weight
    return max(weighted_counts, key=weighted_counts.get)
```

### Convergence-Based Consensus

Agents discuss until their positions converge:

```python
async def convergence_consensus(agents, question, max_rounds=5, threshold=0.8):
    positions = [await a.generate_position(question) for a in agents]

    for round in range(max_rounds):
        # Each agent sees all positions and revises
        new_positions = []
        for i, agent in enumerate(agents):
            revised = await agent.revise_position(
                question, positions[i], positions
            )
            new_positions.append(revised)

        # Check convergence using embedding similarity
        similarities = compute_pairwise_similarity(new_positions)
        if min(similarities) >= threshold:
            return synthesize(new_positions)

        positions = new_positions

    return synthesize(positions)  # Best effort after max rounds
```

## Scaling Multi-Agent Systems

### Cost Management

Multi-agent systems multiply LLM costs. Each agent invocation is at minimum one API call, and complex workflows can involve dozens:

```python
class CostAwareOrchestrator:
    def __init__(self, budget: float):
        self.budget = budget
        self.spent = 0.0

    async def invoke_agent(self, agent, task):
        estimated_cost = agent.estimate_cost(task)
        if self.spent + estimated_cost > self.budget:
            # Fall back to cheaper agent or skip
            return await self.fallback_agent.process(task)

        result = await agent.process(task)
        self.spent += result.actual_cost
        return result
```

### Dynamic Agent Spawning

For tasks of variable complexity, spawn agents on demand rather than maintaining a fixed roster:

```python
class DynamicOrchestrator:
    def __init__(self, agent_factory):
        self.factory = agent_factory
        self.active_agents = {}

    async def handle_subtask(self, subtask):
        required_capability = self.classify_subtask(subtask)

        if required_capability not in self.active_agents:
            self.active_agents[required_capability] = \
                self.factory.create(required_capability)

        return await self.active_agents[required_capability].process(subtask)
```

### Failure Isolation

When one agent fails, the system should degrade gracefully:

```python
async def resilient_execute(agent, task, fallback_agent=None, timeout=30):
    try:
        return await asyncio.wait_for(agent.process(task), timeout=timeout)
    except asyncio.TimeoutError:
        logger.warning(f"Agent {agent.name} timed out on task")
        if fallback_agent:
            return await fallback_agent.process(task)
        return {"error": "timeout", "partial_result": None}
    except Exception as e:
        logger.error(f"Agent {agent.name} failed: {e}")
        if fallback_agent:
            return await fallback_agent.process(task)
        return {"error": str(e)}
```

## When Single Agents Beat Multi-Agent Systems

The multi-agent paradigm is powerful, but it is not always the right choice. There is a meaningful class of problems where a single well-prompted agent outperforms a multi-agent system -- and recognizing these cases early saves significant engineering effort and operational cost.

### Coordination Overhead Is Real

Every agent boundary introduces coordination overhead: serializing context between agents, designing handoff protocols, handling partial failures, and managing the combinatorial explosion of possible interaction sequences. This overhead is not free. For a two-agent pipeline, the cost is modest. For a five-agent system with conditional routing, the coordination logic can become more complex than the underlying task.

Consider a concrete example: summarizing a document. A single agent with a well-crafted system prompt and a clear output format will produce a summary in one LLM call. A multi-agent version -- with a reader agent, an analyst agent, and a writer agent -- requires three LLM calls, three system prompts, two handoff points, and error handling at each boundary. The multi-agent version costs 3x more, takes 3x longer, and introduces two additional failure points. The summary quality is unlikely to be materially better.

### Decision Criteria

Use a single agent when:

- **The task is well-scoped.** If a good system prompt and a few tools can handle the task end-to-end, adding agents adds complexity without adding capability.
- **The context fits in one window.** Multi-agent systems partly exist to manage context limits. If the full task context fits comfortably in a single model's context window, splitting it across agents means each agent sees less relevant information than a single agent would.
- **Latency matters.** Each agent handoff adds at minimum one full LLM round-trip. For interactive applications where users expect sub-second responses, a single fast agent (potentially using a smaller model) often delivers a better experience than a multi-agent pipeline.
- **The error budget is tight.** If each agent in a five-agent pipeline has 95% reliability, the pipeline's reliability is roughly 0.95^5 = 77%. A single agent with 95% reliability is simply more dependable for straightforward tasks.

Use multi-agent systems when:

- **The task has natural specialization boundaries** where different models, tools, or system prompts genuinely improve quality at each stage.
- **Verification and debate add value.** For tasks where correctness is critical -- medical reasoning, legal analysis, financial calculations -- the adversarial patterns described earlier in this article provide measurable accuracy improvements that justify the overhead.
- **Parallelism is exploitable.** If independent subtasks can genuinely run concurrently, multi-agent systems offer wall-clock time savings that a single sequential agent cannot match.
- **Different subtasks require different models.** A system that uses Claude for nuanced writing and a code-specialized model for implementation can outperform either model used alone (see [Article 39: Cost Optimization](/cost-optimization) for model routing strategies).

### The Prompting-First Rule

A useful heuristic: before building a multi-agent system, try solving the problem with a single agent and better prompting. Add few-shot examples. Improve the system prompt. Give the agent structured output formats. Use chain-of-thought (see [Article 26: Agent Architectures](/agent-architectures) for ReAct and related single-agent patterns). Only reach for multi-agent coordination when the single-agent approach demonstrably fails -- and characterize *how* it fails, because the failure mode determines which multi-agent pattern (if any) will help.

## Observability and Debugging

Multi-agent systems are inherently harder to debug than single-agent applications. When a single agent produces a bad output, you examine one prompt, one set of tool calls, and one response. When a five-agent pipeline produces a bad output, the root cause could be in any agent's reasoning, in the information lost during a handoff, or in the orchestrator's delegation decision. Effective observability is not optional -- it is a prerequisite for operating multi-agent systems reliably. For a comprehensive treatment of LLM observability fundamentals, see [Article 40: Observability](/observability).

### Tracing Multi-Agent Interactions

The core requirement is a hierarchical trace that captures the full execution graph: which agent ran, what it received, what it produced, and how long it took. Each agent invocation should be a span within a parent trace, with tool calls as child spans within the agent span.

```python
from langfuse.decorators import observe, langfuse_context

@observe(name="multi-agent-pipeline")
async def run_pipeline(task: str):
    research = await run_research_agent(task)
    draft = await run_writer_agent(task, research)
    review = await run_reviewer_agent(draft)
    return review

@observe(name="research-agent")
async def run_research_agent(task: str):
    langfuse_context.update_current_observation(
        metadata={"agent_role": "researcher", "model": "gpt-4o"}
    )
    result = await research_agent.invoke(task)
    langfuse_context.update_current_observation(
        output=result,
        metadata={"sources_found": len(result.sources)}
    )
    return result

@observe(name="writer-agent")
async def run_writer_agent(task: str, research: str):
    langfuse_context.update_current_observation(
        metadata={"agent_role": "writer", "model": "claude-sonnet-4-20250514"}
    )
    return await writer_agent.invoke(f"Task: {task}\nResearch: {research}")
```

This produces a trace tree where the top-level pipeline span contains child spans for each agent, and each agent span contains child spans for its LLM calls and tool invocations. When the final output is wrong, you can walk the trace tree to find where the information degraded.

### Key Debugging Patterns

**Handoff inspection.** The most common failure mode in multi-agent systems is information loss at handoff boundaries. Log the full context passed between agents -- not just the final output of the upstream agent, but the structured handoff payload. When debugging, compare what the upstream agent produced with what the downstream agent received.

**Agent-level cost attribution.** Multi-agent cost debugging requires per-agent token tracking. Langfuse and LangSmith both support tagging spans with cost metadata, enabling you to identify which agent in the pipeline consumes the most tokens and whether that cost is justified by quality improvements.

```python
@observe(name="agent-execution")
async def run_agent_with_metrics(agent, task):
    start = time.time()
    result = await agent.invoke(task)
    duration = time.time() - start
    langfuse_context.update_current_observation(
        metadata={
            "agent": agent.name,
            "duration_ms": int(duration * 1000),
            "input_tokens": result.usage.input_tokens,
            "output_tokens": result.usage.output_tokens,
            "total_cost_usd": result.usage.total_cost,
        }
    )
    return result
```

**Replay and counterfactual testing.** When a multi-agent pipeline fails, capture the full trace, then replay individual agent invocations with modified inputs to isolate the fault. Did the research agent find bad sources? Replay it with a different query. Did the writer misinterpret good research? Replay the writer with the same research input and a modified prompt. This counterfactual approach is far more efficient than re-running the entire pipeline repeatedly.

**Divergence detection.** In debate and voting patterns, log each agent's position at every round. Track convergence metrics (embedding similarity between positions, vote distributions) over rounds. If agents consistently fail to converge, the problem is likely in role definition or the question is genuinely ambiguous -- and the system should escalate rather than force consensus.

### Platform Support

Both Langfuse and LangSmith support multi-agent tracing, though with different idioms. Langfuse's `@observe` decorator naturally nests -- any observed function called within an observed function becomes a child span. LangSmith's `@traceable` decorator works similarly and integrates directly with LangGraph's built-in tracing. For LangGraph-based multi-agent systems, tracing is effectively automatic: each node execution becomes a span, and conditional edges are visible in the trace.

For custom multi-agent frameworks without LangChain integration, the OpenTelemetry-based approach described in [Article 40: Observability](/observability) works well. Define a span for each agent invocation, propagate trace context through your orchestration layer, and export to your preferred backend. The critical requirement is that the trace captures the causal structure of the multi-agent interaction -- which agent triggered which other agent, and with what context.

For evaluation of multi-agent system outputs, including trajectory analysis and per-agent contribution assessment, see [Article 30: Agent Evaluation](/agent-evaluation).

## Summary and Key Takeaways

- **Multi-agent systems decompose complex tasks** across specialized agents, improving both quality and enabling parallelism. The key is clear role definition with minimal overlap.
- **Four fundamental communication patterns** cover most use cases: sequential pipeline, hierarchical delegation, adversarial debate, and roundtable discussion. Choose based on task structure and reliability requirements.
- **Frameworks like CrewAI, AutoGen, and LangGraph** each take a different modeling approach -- roles/tasks, conversations, and state machines respectively. LangGraph provides the most engineering control; CrewAI offers the simplest mental model; AutoGen 0.4+ introduces an async event-driven runtime with modular packages and explicit team constructs.
- **The handoff pattern** (demonstrated by OpenAI Swarm and adopted in AutoGen 0.4's `Swarm` team type) shows that multi-agent coordination can be as simple as returning a new agent from a function call. Not every multi-agent system needs heavy orchestration infrastructure.
- **Multi-agent debate** (Du et al., 2023) demonstrably improves factual accuracy and reasoning. Consider it for any task where correctness matters.
- **Not every task needs multiple agents.** Coordination overhead -- serialized context, handoff protocols, compounding failure rates -- means that for well-scoped tasks, a single agent with good prompting often wins. Try the single-agent approach first and reach for multi-agent systems only when it demonstrably falls short.
- **Consensus mechanisms** prevent deadlocks and ensure agents converge. Simple majority voting works surprisingly well; convergence-based approaches work better for nuanced decisions.
- **Cost and latency scale multiplicatively** with agent count. Manage costs through budget caps, dynamic agent spawning, and tiered model selection. Use cheaper models for simpler sub-tasks (see [Article 39: Cost Optimization](/cost-optimization)).
- **Observability is non-negotiable** for production multi-agent systems. Hierarchical tracing with per-agent cost attribution, handoff inspection, and replay-based debugging are essential for diagnosing failures in systems where the root cause may be several agent boundaries away from the symptom (see [Article 40: Observability](/observability)).
- **Failure isolation is essential.** Design each agent interaction with timeouts, fallbacks, and partial result handling. A single failing agent should not bring down the entire system.
- **The trend is toward more structured multi-agent architectures** with explicit coordination protocols rather than fully autonomous agent swarms. Production systems need predictability and observability that emergent multi-agent behaviors cannot guarantee. For foundational single-agent patterns that these systems build upon, see [Article 26: Agent Architectures](/agent-architectures). For evaluating multi-agent system outputs, see [Article 30: Agent Evaluation](/agent-evaluation).
