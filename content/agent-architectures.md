# Agent Architectures: ReAct, Plan-and-Execute & Cognitive Frameworks

The design of agent architectures determines how language models reason, plan, and act in complex environments. From the foundational ReAct framework that interleaves reasoning with action, to sophisticated cognitive architectures that incorporate reflection, search, and hierarchical planning, the field has rapidly evolved beyond simple prompt-response patterns. This article provides a deep technical examination of the major agent architecture paradigms, their theoretical foundations, implementation patterns, and practical tradeoffs observed in production systems.

## Foundations: From Chain-of-Thought to Agents

Before examining specific architectures, it is worth understanding the conceptual progression that led to modern agent designs. Chain-of-Thought prompting (Wei et al., 2022) demonstrated that LLMs could perform multi-step reasoning when prompted to "think step by step" (see [Article 08: Few-Shot & Chain-of-Thought](/few-shot-chain-of-thought) for a thorough treatment). This was a passive capability -- the model reasoned but could not act on its reasoning.

The key insight of agent architectures is closing the loop: the model reasons about what to do, takes an action (typically a tool call), observes the result, and then reasons again. This observe-think-act cycle, borrowed from classical AI agent theory (Russell & Norvig), becomes the foundation for all modern LLM agent designs.

## ReAct: Reasoning + Acting

### The Core Framework

ReAct (Yao et al., 2022, "ReAct: Synergizing Reasoning and Acting in Language Models") introduced a deceptively simple but powerful pattern: interleave reasoning traces (thoughts) with actions and observations in a single prompt sequence.

The format follows:

```
Thought: I need to find the population of Tokyo to answer this question.
Action: search("Tokyo population 2024")
Observation: Tokyo's population is approximately 13.96 million in the city proper...
Thought: Now I have the population. The user also asked about the area, so I need to look that up.
Action: search("Tokyo area square kilometers")
Observation: Tokyo covers 2,194 square kilometers...
Thought: I now have both pieces of information to answer the question.
Action: finish("Tokyo has a population of ~14 million across 2,194 km²")
```

### Why ReAct Works

The power of ReAct comes from the synergy between reasoning and acting. The reasoning traces serve multiple purposes:

1. **Decomposition**: Complex questions are broken into sub-steps
2. **Grounding**: Each thought references specific observations, reducing hallucination
3. **Error recovery**: When an observation is unexpected, the model can reason about what went wrong and try a different approach
4. **Interpretability**: The thought traces provide a human-readable explanation of the agent's decision-making

Yao et al. showed that ReAct outperformed both pure reasoning (Chain-of-Thought without actions) and pure acting (actions without reasoning traces) on knowledge-intensive tasks (HotpotQA, FEVER) and interactive decision-making tasks (ALFWorld, WebShop).

### Implementation Pattern

A minimal ReAct loop in code:

```python
class ReActAgent:
    def __init__(self, llm, tools, max_steps=10):
        self.llm = llm
        self.tools = {t.name: t for t in tools}
        self.max_steps = max_steps

    def run(self, question: str) -> str:
        prompt = self._build_initial_prompt(question)

        for step in range(self.max_steps):
            response = self.llm.generate(prompt)

            # Parse thought and action from response
            thought, action, action_input = self._parse_response(response)
            prompt += f"\nThought: {thought}\nAction: {action}({action_input})"

            if action == "finish":
                return action_input

            # Execute tool and get observation
            tool = self.tools.get(action)
            if tool is None:
                observation = f"Error: Unknown tool '{action}'"
            else:
                observation = tool.execute(action_input)

            prompt += f"\nObservation: {observation}\n"

        return "Max steps exceeded without reaching an answer."
```

### Limitations of ReAct

ReAct's step-by-step nature means it struggles with tasks requiring long-horizon planning. Each thought considers only the immediate next action, without a global plan. This leads to:

- **Myopic behavior**: The agent may pursue dead-end paths without recognizing the need to backtrack
- **Redundant actions**: Without memory of what has already been tried, the agent may repeat failed approaches
- **Context window exhaustion**: Long reasoning chains consume the context window, eventually degrading performance

## Plan-and-Execute Architectures

### The Two-Phase Approach

Plan-and-Execute agents address ReAct's myopia by separating planning from execution into distinct phases:

1. **Planning phase**: The model creates a high-level plan with numbered steps
2. **Execution phase**: Each step is executed, potentially using a ReAct-style sub-agent
3. **Replanning**: After execution results are observed, the plan may be revised

```python
class PlanAndExecuteAgent:
    def __init__(self, planner_llm, executor_llm, tools):
        self.planner = planner_llm
        self.executor = ReActAgent(executor_llm, tools)

    def run(self, task: str) -> str:
        # Phase 1: Create plan
        plan = self.planner.generate(
            f"Create a step-by-step plan to accomplish: {task}\n"
            f"Available tools: {[t.name for t in self.tools]}\n"
            f"Return a numbered list of steps."
        )
        steps = self._parse_plan(plan)

        results = []
        for i, step in enumerate(steps):
            # Phase 2: Execute each step
            context = f"Overall task: {task}\nPrevious results: {results}\nCurrent step: {step}"
            result = self.executor.run(context)
            results.append({"step": step, "result": result})

            # Phase 3: Check if replanning is needed
            if self._should_replan(task, steps[i+1:], results):
                remaining_steps = self._replan(task, results, steps[i+1:])
                steps = steps[:i+1] + remaining_steps

        return self._synthesize_answer(task, results)
```

### Advantages Over ReAct

Plan-and-Execute provides several benefits:

- **Global coherence**: The plan provides a roadmap, preventing the agent from losing track of the overall goal
- **Efficiency**: By planning upfront, the agent avoids redundant exploration
- **Modularity**: The planner and executor can use different models (e.g., a stronger model for planning, a faster one for execution)
- **Observability**: The plan itself is a useful artifact for debugging and user communication

### The Replanning Problem

The most challenging aspect of Plan-and-Execute is knowing when and how to replan. Too much replanning degenerates into step-by-step execution (essentially ReAct). Too little means the agent stubbornly follows a plan that has become invalid.

Effective replanning heuristics include:

- **Failure detection**: Replan when a step fails and the failure affects subsequent steps
- **Information gain**: Replan when execution reveals information that materially changes the approach
- **Plan validation**: After each step, ask the planner whether the remaining steps are still valid

## Reflexion: Learning from Mistakes

### Self-Reflection as a Learning Mechanism

Reflexion (Shinn et al., 2023, "Reflexion: Language Agents with Verbal Reinforcement Learning") introduces a meta-cognitive layer: after completing a task (successfully or not), the agent generates a natural language reflection on what went well and what went wrong. These reflections are stored and provided as context in subsequent attempts.

```python
class ReflexionAgent:
    def __init__(self, actor, evaluator, reflector, memory):
        self.actor = actor          # The agent that attempts the task
        self.evaluator = evaluator  # Determines success/failure
        self.reflector = reflector  # Generates reflections
        self.memory = memory        # Stores reflections

    def run(self, task: str, max_trials: int = 3) -> str:
        for trial in range(max_trials):
            # Retrieve relevant past reflections
            reflections = self.memory.retrieve(task)

            # Attempt the task with reflection context
            trajectory = self.actor.run(task, reflections=reflections)

            # Evaluate the result
            success, feedback = self.evaluator.evaluate(task, trajectory)

            if success:
                return trajectory.final_answer

            # Generate and store reflection
            reflection = self.reflector.generate(
                f"Task: {task}\n"
                f"Attempt: {trajectory}\n"
                f"Feedback: {feedback}\n"
                f"What went wrong and what should be done differently?"
            )
            self.memory.store(task, reflection)

        return trajectory.final_answer  # Return best attempt
```

### The Power of Verbal Reinforcement

Reflexion is notable because it achieves learning without gradient updates. The "reinforcement" is entirely verbal -- stored as natural language reflections that modify the agent's behavior through in-context learning. Shinn et al. demonstrated significant improvements on coding tasks (HumanEval: 67.0% to 91.0%), decision-making (ALFWorld), and reasoning tasks through iterative reflection.

This approach is particularly valuable in production systems where fine-tuning is impractical. The reflection memory acts as a lightweight, interpretable form of experience that can be inspected, edited, and shared across agent instances. For a deeper exploration of how agents store and retrieve experiences across sessions, see [Article 28: Agent Memory](/agent-memory).

## Language Agent Tree Search (LATS)

### Search Meets Language Agents

LATS (Zhou et al., 2023) combines the LLM agent paradigm with Monte Carlo Tree Search (MCTS), treating agent trajectories as a tree to be explored systematically rather than a single path.

The key insight is that agent decision-making at each step can be viewed as a search problem: multiple possible actions exist, and the agent should explore promising branches while being willing to backtrack from unpromising ones.

```
                    [Initial State]
                   /       |        \
            [Action A]  [Action B]  [Action C]
            /    \         |          |
      [A→D]  [A→E]    [B→F]      [C→G]
        ↓       ↓        ↓          ↓
     Score:   Score:   Score:     Score:
      0.3      0.7      0.5       0.8  ← Expand C→G further
```

The algorithm:

1. **Selection**: Use UCB1 (Upper Confidence Bound) to select which node to expand
2. **Expansion**: Generate multiple possible next actions from the selected node
3. **Simulation**: Use the LLM to estimate the value of the resulting state
4. **Backpropagation**: Update value estimates up the tree

This approach is computationally expensive (many LLM calls per decision) but excels on tasks where exploration is critical, such as complex reasoning problems and multi-step planning.

## LangGraph and State Machine Architectures

### Graphs as Agent Control Flow

LangGraph (part of the LangChain ecosystem) represents agent logic as a directed graph where nodes are computation steps and edges are transitions. This addresses a fundamental limitation of linear agent loops: real-world agent workflows often involve branching, parallel execution, cycles, and conditional logic that don't fit neatly into a sequential framework. For a comprehensive treatment of LangGraph's primitives, patterns, and deployment options, see the dedicated [LangGraph](/langgraph) article.

LangGraph has matured significantly since its introduction, with built-in support for persistence, human-in-the-loop approval gates, and the LangGraph Platform for deployment. The core abstraction remains the `StateGraph`, but the ecosystem now includes prebuilt components for common patterns like tool-calling agents and ReAct loops:

```python
from langgraph.graph import StateGraph, END, START
from langgraph.prebuilt import ToolNode, tools_condition
from langgraph.checkpoint.memory import MemorySaver
from typing import Annotated
from typing_extensions import TypedDict
from langchain_core.messages import AnyMessage
from langgraph.graph.message import add_messages

class AgentState(TypedDict):
    messages: Annotated[list[AnyMessage], add_messages]

def call_model(state: AgentState) -> AgentState:
    """Invoke the LLM with current messages and available tools."""
    response = model.invoke(state["messages"])
    return {"messages": [response]}

# Build the graph with prebuilt tool handling
graph = StateGraph(AgentState)
graph.add_node("agent", call_model)
graph.add_node("tools", ToolNode(tools))

graph.add_edge(START, "agent")
graph.add_conditional_edges("agent", tools_condition)  # Route to tools or END
graph.add_edge("tools", "agent")  # Return to agent after tool execution

# Compile with persistence for conversation memory and time-travel debugging
memory = MemorySaver()
agent = graph.compile(checkpointer=memory)

# Invoke with a thread ID for persistent state
result = agent.invoke(
    {"messages": [{"role": "user", "content": "Research topic X"}]},
    config={"configurable": {"thread_id": "session-1"}}
)
```

For more complex workflows, LangGraph supports subgraph composition, enabling teams to build modular agent components that can be tested independently and composed into larger systems. A research agent subgraph might be embedded within a broader customer service workflow, for example.

### OpenAI Swarm: Lightweight Multi-Agent Reference

At the opposite end of the complexity spectrum from LangGraph, OpenAI's Swarm (2024) offers a minimalist reference implementation for multi-agent handoffs. Swarm's core abstraction is intentionally simple: agents are defined as objects with instructions and a list of functions, and one agent can hand off to another by returning a new agent from a function call.

```python
from swarm import Swarm, Agent

triage_agent = Agent(
    name="Triage",
    instructions="Determine the user's intent and hand off to the appropriate specialist.",
    functions=[transfer_to_sales, transfer_to_support],
)

sales_agent = Agent(
    name="Sales",
    instructions="Help the user with purchasing decisions.",
    functions=[check_inventory, create_quote],
)

client = Swarm()
response = client.run(agent=triage_agent, messages=[{"role": "user", "content": "I want to buy..."}])
```

Swarm is explicitly not a production framework -- OpenAI describes it as an educational and experimental tool. Its value lies in demonstrating that multi-agent coordination does not require heavy infrastructure. The handoff pattern, where one agent explicitly delegates to another, is a powerful primitive that can be implemented in any framework. For more on multi-agent patterns, see [Article 27: Multi-Agent Systems](/multi-agent-systems).

### Advantages of Graph-Based Control Flow

1. **Explicit state management**: The `AgentState` is a well-defined data structure, making it easy to persist, resume, and debug
2. **Checkpointing**: State can be saved at any node, enabling pause/resume, human-in-the-loop patterns, and time-travel debugging
3. **Streaming**: Intermediate results can be streamed to the user as the graph executes
4. **Subgraphs**: Complex behaviors can be encapsulated in subgraphs, enabling composition and reuse
5. **Parallel branches**: The graph can fork into parallel branches and join results

### State Machine Patterns for Agent Control

Beyond LangGraph, the state machine pattern is broadly applicable. Key states in a robust agent system:

```
[IDLE] → [PLANNING] → [EXECUTING] → [OBSERVING] → [DECIDING]
                ↑                                       |
                |          [REFLECTING] ←——————————————+
                |               |
                +———————————————+
                |
           [RESPONDING] → [IDLE]
```

Each state has clear entry/exit conditions, valid transitions, and error handling. This formalism prevents agents from entering undefined states and makes the system easier to reason about.

## Cognitive Architecture Patterns

### AutoGPT and Autonomous Agent Patterns

AutoGPT (Significant Gravitas, 2023) popularized the concept of fully autonomous agents that can set their own goals, create tasks, and execute them without human intervention. While the original implementation had significant reliability issues, the architectural pattern influenced subsequent work:

1. **Goal decomposition**: Break a high-level goal into a task list
2. **Task prioritization**: Order tasks by importance and dependencies
3. **Execution loop**: Execute the highest-priority task, observe results, update the task list
4. **Memory**: Store findings in long-term memory for later retrieval

The primary lesson from AutoGPT was negative: fully autonomous agents without proper guardrails tend to loop, waste resources, and produce unreliable results. Modern systems incorporate more structure, human oversight, and bounded autonomy.

### BabyAGI's Task Management Pattern

BabyAGI introduced a cleaner version of the autonomous agent pattern focused on task management:

```python
class TaskManager:
    def __init__(self, llm):
        self.task_queue = PriorityQueue()
        self.completed_tasks = []
        self.llm = llm

    def create_tasks(self, objective, last_result):
        new_tasks = self.llm.generate(
            f"Objective: {objective}\n"
            f"Last completed task result: {last_result}\n"
            f"Existing tasks: {self.task_queue.items}\n"
            f"Create new tasks if needed."
        )
        for task in parse_tasks(new_tasks):
            self.task_queue.add(task)

    def prioritize(self, objective):
        reprioritized = self.llm.generate(
            f"Reprioritize these tasks for objective '{objective}':\n"
            f"{self.task_queue.items}"
        )
        self.task_queue = parse_prioritized_queue(reprioritized)
```

### Generative Agents and Simulation

Park et al. (2023, "Generative Agents: Interactive Simulacra of Human Behavior") demonstrated a cognitive architecture for simulating believable human behavior. Their architecture includes:

- **Memory stream**: A comprehensive record of the agent's experiences
- **Retrieval**: Selecting relevant memories based on recency, importance, and relevance
- **Reflection**: Periodically synthesizing high-level observations from recent memories
- **Planning**: Creating daily plans that can be revised based on observations

While designed for simulation, this architecture has influenced practical agent design, particularly the memory and reflection components.

## Reasoning-Native Architectures

### When Reasoning is Built In

The emergence of models with built-in chain-of-thought capabilities -- OpenAI's o1 and o3 series, DeepSeek-R1, Claude with extended thinking -- fundamentally changes the landscape of agent design. These models perform multi-step reasoning internally before producing output, which means the explicit Thought/Action/Observation loop of ReAct becomes partially redundant. The model is already thinking step by step; forcing it through an additional external reasoning scaffold can be counterproductive.

In a reasoning-native architecture, the agent loop simplifies. Rather than parsing interleaved thought and action traces, the agent issues a task to the model, the model reasons internally (often producing a hidden or visible chain-of-thought), and returns either a final answer or a structured tool call. The orchestrator manages the tool execution loop, but the reasoning happens inside the model rather than being prompted externally.

```python
class ReasoningNativeAgent:
    """Agent design for models with built-in chain-of-thought (o1, R1, etc.)."""

    def __init__(self, reasoning_model, tools, max_steps=15):
        self.model = reasoning_model
        self.tools = {t.name: t for t in tools}
        self.max_steps = max_steps

    def run(self, task: str) -> str:
        messages = [{"role": "user", "content": task}]

        for step in range(self.max_steps):
            # The model reasons internally -- no explicit "Thought:" prompting needed
            response = self.model.generate(
                messages=messages,
                tools=list(self.tools.values()),
                reasoning_effort="high"  # Provider-specific parameter
            )

            if response.tool_calls:
                for call in response.tool_calls:
                    result = self.tools[call.name].execute(call.arguments)
                    messages.append({"role": "tool", "content": result, "tool_call_id": call.id})
            else:
                return response.content

        return "Max steps reached."
```

### When to Use Reasoning Models vs Explicit Agent Loops

The decision is not binary. Reasoning-native models excel at tasks requiring deep analytical thinking -- mathematical proofs, complex code generation, multi-constraint planning -- where the internal chain-of-thought can explore the problem space without the overhead of external tool calls. For these tasks, wrapping a reasoning model in a ReAct loop adds latency and cost without improving quality.

Explicit agent loops remain preferable when the task is primarily about information gathering rather than reasoning. A ReAct agent using a fast, inexpensive model to search databases, call APIs, and aggregate results will outperform a reasoning model on both cost and speed. The reasoning model's extended thinking is wasted on tasks like "look up X, then look up Y, then combine them."

The hybrid approach is often strongest in practice: use a reasoning model for the planning phase (where deep thinking about task decomposition adds value) and a faster model for execution steps that are primarily tool invocation. This mirrors the Plan-and-Execute pattern but with the planner benefiting from built-in reasoning capabilities. See [Article 08: Few-Shot & Chain-of-Thought](/few-shot-chain-of-thought) for the foundational prompting techniques that reasoning-native models internalize.

## Agentic RAG

### Beyond Static Retrieval Pipelines

Standard RAG (retrieval-augmented generation) follows a fixed pipeline: embed the query, retrieve top-k documents, stuff them into the prompt, generate an answer. This works for simple factual questions but breaks down when the initial query is ambiguous, the retrieved documents are insufficient, or the task requires synthesizing information across multiple retrieval passes.

Agentic RAG places an agent in control of the retrieval process. The agent decides what to search for, evaluates whether the retrieved results are sufficient, reformulates queries when they are not, and determines when it has gathered enough information to answer. This transforms retrieval from a single-shot operation into an iterative, adaptive process.

```python
class AgenticRAGAgent:
    def __init__(self, llm, retriever, max_retrievals=5):
        self.llm = llm
        self.retriever = retriever
        self.max_retrievals = max_retrievals

    def run(self, question: str) -> str:
        gathered_context = []

        for attempt in range(self.max_retrievals):
            # Agent decides what to search for
            search_decision = self.llm.generate(
                f"Question: {question}\n"
                f"Information gathered so far: {gathered_context}\n"
                f"What specific information do you still need? "
                f"Generate a search query, or respond SUFFICIENT if you have enough."
            )

            if "SUFFICIENT" in search_decision:
                break

            # Retrieve and evaluate
            results = self.retriever.search(search_decision)
            evaluation = self.llm.generate(
                f"Question: {question}\n"
                f"Search query: {search_decision}\n"
                f"Results: {results}\n"
                f"Are these results relevant and sufficient? "
                f"Extract useful information or explain what is missing."
            )
            gathered_context.append({
                "query": search_decision,
                "results": results,
                "evaluation": evaluation
            })

        # Synthesize final answer from all gathered context
        return self.llm.generate(
            f"Question: {question}\n"
            f"All gathered information: {gathered_context}\n"
            f"Provide a comprehensive answer."
        )
```

### Core Patterns in Agentic RAG

**Query routing.** The agent first classifies the incoming question to determine which retrieval source to use. A technical question might route to a code documentation index, while a policy question routes to an internal knowledge base. The routing decision itself can involve reasoning about the question's domain and intent.

**Retrieval evaluation.** After each retrieval step, the agent assesses whether the returned documents actually address the question. This is where agentic RAG diverges most sharply from static RAG -- a standard pipeline blindly uses whatever was retrieved, while an agentic system can recognize when results are off-topic, outdated, or insufficiently detailed and issue a refined query.

**Multi-hop retrieval.** Some questions require chaining information across documents. "What was the revenue impact of the product launched by the team that the new VP leads?" requires first identifying the VP, then their team, then the product, then the revenue data. An agentic retriever decomposes this naturally through iterative search.

**Adaptive chunking and re-ranking.** The agent can request different chunk sizes, apply re-ranking models to candidate results, or expand its search to adjacent chunks when a retrieved passage seems relevant but incomplete.

Agentic RAG has become one of the most common production agent patterns because it addresses the primary failure mode of naive RAG -- retrieval quality -- while remaining relatively bounded in scope and cost. For deeper coverage of retrieval mechanisms, see [Article 16: Retrieval Strategies](/retrieval-strategies) and [Article 17: Advanced RAG](/advanced-rag).

## Agent Termination Strategies

### The Problem of Knowing When to Stop

An agent without robust termination logic is a liability. It may loop indefinitely, accumulating costs while producing no useful output. It may give up too early when the task is nearly complete. It may produce a degraded result without communicating the degradation to the caller. Termination strategy is not an afterthought -- it is a core architectural decision.

### Cost Budgets

The most straightforward termination mechanism is a cost ceiling. Track cumulative token usage and tool invocation costs, and halt the agent when a budget is reached:

```python
class BudgetedAgent:
    def __init__(self, agent, max_cost_usd=1.0, max_steps=20, max_tokens=100_000):
        self.agent = agent
        self.max_cost = max_cost_usd
        self.max_steps = max_steps
        self.max_tokens = max_tokens

    def run(self, task: str) -> AgentResult:
        accumulated_cost = 0.0
        accumulated_tokens = 0

        for step in range(self.max_steps):
            result = self.agent.step(task)
            accumulated_cost += result.cost
            accumulated_tokens += result.tokens_used

            if result.is_complete:
                return AgentResult(answer=result.answer, status="complete",
                                   cost=accumulated_cost)

            if accumulated_cost >= self.max_cost:
                return AgentResult(
                    answer=self._best_partial_answer(),
                    status="budget_exceeded",
                    cost=accumulated_cost
                )
            if accumulated_tokens >= self.max_tokens:
                return AgentResult(
                    answer=self._best_partial_answer(),
                    status="token_limit_reached",
                    cost=accumulated_cost
                )

        return AgentResult(answer=self._best_partial_answer(),
                           status="max_steps_reached", cost=accumulated_cost)
```

### Quality Gates

Rather than terminating on resource limits alone, quality gates evaluate whether the agent's current output meets a minimum quality threshold. This can be implemented as a separate evaluator model that scores the agent's answer, a set of heuristic checks (does the answer address all parts of the question? does it contain supporting evidence?), or a confidence assessment from the agent itself.

Quality gates are particularly important in systems where a partial but high-quality answer is preferable to a complete but unreliable one. The gate acts as a checkpoint: if the answer passes, return it; if not, either continue or escalate.

### Graceful Degradation

Well-designed agents communicate their limitations rather than silently producing poor output. A graceful degradation strategy includes:

- **Partial results**: Return what was successfully completed, clearly marking what remains unfinished
- **Confidence signals**: Attach a confidence score or qualifier ("I found information about X but could not verify Y")
- **Escalation**: Route to a human operator or a more capable (and expensive) model when the current agent cannot make progress
- **Structured failure**: Return a typed error that the calling system can act on, rather than an ambiguous text response

These strategies interact with agent evaluation -- see [Article 30: Agent Evaluation](/agent-evaluation) for metrics that capture termination quality, and [Article 39: Cost Optimization](/cost-optimization) for the economics of budget-based termination.

## Agent Protocol Patterns

### Computer Use and Interface Interaction

A significant evolution in agent capability is the ability to interact with graphical interfaces directly. Anthropic's computer use pattern enables agents to observe screenshots, identify UI elements, and execute mouse and keyboard actions. This represents a departure from the API-centric tool use model -- instead of calling structured functions, the agent operates at the human interaction layer.

The architecture for computer use agents follows a perception-action cycle:

1. **Capture**: Take a screenshot of the current screen state
2. **Perceive**: The vision-language model identifies relevant UI elements, their positions, and their states
3. **Reason**: The model determines the next action based on the current state and the goal
4. **Act**: Execute a mouse click, keyboard input, or scroll action at specific coordinates
5. **Verify**: Capture a new screenshot to confirm the action had the intended effect

This pattern is inherently fragile -- UI layouts change, elements load asynchronously, and pixel coordinates are resolution-dependent. Production implementations require robust retry logic and state verification at each step.

### Multi-Step Tool Use with Self-Correction

Anthropic's recommended agent pattern for tool use involves a tight loop where the model calls tools, observes results, and critically evaluates whether the result matches expectations before proceeding. This self-correction pattern is distinct from Reflexion's trial-level reflection; it operates at the individual step level within a single execution.

```python
class SelfCorrectingToolLoop:
    def __init__(self, model, tools, max_retries_per_step=2):
        self.model = model
        self.tools = tools
        self.max_retries = max_retries_per_step

    def execute_with_correction(self, messages: list) -> str:
        while True:
            response = self.model.generate(messages=messages, tools=self.tools)

            if not response.tool_calls:
                return response.content

            for tool_call in response.tool_calls:
                result = self._execute_tool(tool_call)
                messages.append({"role": "tool", "content": result,
                                 "tool_call_id": tool_call.id})

                # Model evaluates whether the tool result is usable
                # If the result indicates an error or unexpected output,
                # the model can retry with modified parameters
                # This happens naturally in the next model turn
```

The key insight is that the model itself serves as the error detector. When a tool returns an unexpected result -- an API error, empty data, a malformed response -- the model recognizes the problem and either retries with modified parameters, tries an alternative tool, or adjusts its plan. This self-correction capability is what separates robust production agents from brittle prototypes.

For the foundational mechanics of how tools are defined and invoked, see [Article 25: Function Calling & Tool Integration](/function-calling). For how these patterns extend to multi-agent coordination, see [Article 27: Multi-Agent Systems](/multi-agent-systems).

## Comparing Architectures: When to Use What

| Architecture | Best For | Complexity | Reliability | Cost |
|---|---|---|---|---|
| ReAct | Simple tool-use tasks, Q&A | Low | Medium | Low |
| Plan-and-Execute | Multi-step workflows | Medium | Medium-High | Medium |
| Reflexion | Tasks where learning from failure matters | Medium | High | Medium-High |
| LATS | Complex reasoning, exploration-heavy tasks | High | High | Very High |
| Reasoning-Native | Deep analysis, complex planning | Low-Medium | High | Medium-High |
| Agentic RAG | Knowledge-intensive Q&A, research | Medium | High | Medium |
| LangGraph/State Machine | Production systems, complex workflows | Medium-High | High | Varies |
| Autonomous (AutoGPT-style) | Open-ended exploration | High | Low | Very High |

### Decision Framework

Choose your architecture based on:

1. **Task complexity**: Simple retrieval tasks need only ReAct. Multi-step tasks with dependencies need Plan-and-Execute. Tasks requiring deep analysis benefit from reasoning-native models.
2. **Reliability requirements**: Production systems benefit from state machine formalism and explicit termination strategies. Research/exploration tolerates lower reliability.
3. **Cost budget**: LATS and autonomous agents make many LLM calls. ReAct is the most economical. Reasoning-native models trade higher per-call cost for fewer total calls.
4. **Latency requirements**: ReAct and Plan-and-Execute can be streamed. LATS requires completing the search before producing a result. Reasoning models may have high first-token latency due to internal thinking.
5. **Need for learning**: If the agent will face similar tasks repeatedly, Reflexion's learning capability adds significant value. For persistent learning across sessions, see [Article 28: Agent Memory](/agent-memory).
6. **Retrieval intensity**: Tasks dominated by information gathering benefit from Agentic RAG patterns rather than general-purpose agent loops.

## Implementation Considerations

### Prompt Engineering for Agents

Each architecture requires carefully designed prompts. Key principles:

- **Role definition**: Clearly define the agent's capabilities and limitations
- **Tool descriptions**: Precise, example-rich descriptions of available tools
- **Output format**: Structured output formats (e.g., `Thought:`, `Action:`, `Plan:`) that the parser can reliably extract
- **Error recovery instructions**: Explicit guidance on what to do when actions fail

### Streaming and User Experience

Agents can take many seconds or minutes to complete. Streaming intermediate results is essential for user experience:

```python
async def stream_agent_execution(agent, task):
    async for event in agent.astream_events(task):
        if event["type"] == "thought":
            yield f"Thinking: {event['content']}\n"
        elif event["type"] == "tool_call":
            yield f"Using tool: {event['tool_name']}\n"
        elif event["type"] == "tool_result":
            yield f"Got result from {event['tool_name']}\n"
        elif event["type"] == "final_answer":
            yield f"\nAnswer: {event['content']}\n"
```

## Summary and Key Takeaways

- **ReAct** remains the foundational agent pattern: interleave reasoning with action. It is simple, interpretable, and effective for straightforward tasks. Its limitation is myopic, step-by-step decision-making.
- **Plan-and-Execute** adds global coherence by separating planning from execution. The challenge lies in knowing when to replan.
- **Reflexion** introduces learning without gradient updates, using verbal self-reflection to improve performance across trials. It is particularly valuable for iterative tasks.
- **LATS** applies tree search to agent decision-making, excelling on complex reasoning tasks at the cost of many LLM invocations.
- **Reasoning-native architectures** leverage models with built-in chain-of-thought (o1, DeepSeek-R1, Claude extended thinking) to simplify agent loops. When the model reasons internally, external reasoning scaffolding becomes less necessary -- but explicit loops remain valuable for tool-heavy, information-gathering tasks.
- **Agentic RAG** places an agent in control of the retrieval process, enabling adaptive query formulation, retrieval evaluation, and multi-hop reasoning. It is one of the most common and practical production agent patterns.
- **Termination strategies** -- cost budgets, step limits, quality gates, graceful degradation -- are architectural decisions, not afterthoughts. Agents without robust termination logic are liabilities in production.
- **Agent protocol patterns** like computer use and self-correcting tool loops represent the frontier of agent capability, enabling interaction with graphical interfaces and robust error recovery at the individual step level.
- **State machine / graph architectures** (LangGraph) provide the engineering rigor needed for production systems: explicit state, checkpointing, error handling, and composability. Lightweight alternatives like OpenAI Swarm demonstrate that multi-agent handoffs can be implemented with minimal infrastructure.
- **No single architecture dominates.** The best choice depends on the task, reliability requirements, cost constraints, and whether the agent needs to learn from experience. In practice, production systems often combine elements from multiple architectures.
- **The trend is toward more structured, controllable architectures** rather than fully autonomous agents. The lessons from AutoGPT-style systems have pushed the field toward bounded autonomy with human oversight.

## Further Reading

This article connects to several related topics covered elsewhere in this series:

- [Article 08: Few-Shot & Chain-of-Thought](/few-shot-chain-of-thought) -- the prompting foundations that agent architectures build upon
- [Article 25: Function Calling & Tool Integration](/function-calling) -- the mechanics of how agents invoke tools
- [Article 27: Multi-Agent Systems](/multi-agent-systems) -- extending single-agent architectures to multi-agent coordination
- [Article 28: Agent Memory](/agent-memory) -- memory systems that enable agents to persist state and learn across sessions
- [Article 30: Agent Evaluation](/agent-evaluation) -- how to measure agent reliability, efficiency, and quality across architectures
