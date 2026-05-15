# Memory Architectures for LLM Systems: Working, Episodic & Semantic Memory

Language models are stateless functions. Each inference call receives a prompt, produces a completion, and forgets everything. There is no hidden state carried forward, no internal notepad updated between requests, no persistent trace of what happened five seconds ago. This statelessness is a feature of the transformer architecture -- it makes inference embarrassingly parallel and horizontally scalable -- but it is also the single largest obstacle to building AI systems that learn, adapt, and maintain coherent relationships with users over time. Every production LLM application that needs to "remember" anything must build that capability externally, and the design of that external memory system is one of the most consequential architectural decisions an AI engineer will make.

This article provides a comprehensive treatment of memory architectures for LLM-based systems, organized around the cognitive science taxonomy that has become the dominant framing in the field: working memory, episodic memory, semantic memory, and procedural memory. It covers the theoretical foundations, concrete implementation patterns, and the hybrid architectures that combine multiple memory types into production systems. For the foundational treatment of agent memory concepts including MemGPT and the Generative Agents architecture, see [Agent Memory](/agent-memory). For context window management strategies and budget allocation, see [Context Engineering](/context-engineering). For the vector storage layer that underpins most long-term memory systems, see [Vector Databases](/vector-databases).

## The Stateless Inference Problem

### Why LLMs Cannot Remember

A transformer-based language model is a function `f(tokens) -> probability_distribution`. The model's parameters are frozen at inference time. Nothing about the interaction modifies the weights, updates an internal register, or leaves any trace in the model itself. When the API call returns, the model has no record that the interaction occurred.

This is fundamentally different from how biological brains operate. A human conversation partner simultaneously processes your words (perception), maintains the thread of discussion (working memory), recalls relevant past experiences (episodic retrieval), applies learned social patterns (procedural memory), and continuously updates their model of you (learning). All of this happens automatically, in parallel, without explicit architecture. LLMs must achieve each of these capabilities through deliberate engineering.

The practical consequences are severe:

```
Session 1: User tells the assistant they are allergic to shellfish
Session 2: User asks for dinner recommendations
            -> Model has no memory of the allergy
            -> May recommend a seafood restaurant
            -> Trust is destroyed

Session 1: Agent debugs a complex deployment issue for 2 hours
Session 2: Same issue recurs
            -> Agent starts from scratch
            -> Repeats failed approaches
            -> User loses patience

Session 1: Agent calls deprecated API endpoint, gets error, finds workaround
Session 2: Same task
            -> Agent calls the deprecated endpoint again
            -> Same error, same debugging cycle
            -> No learning has occurred
```

### The Memory Tax

Every memory system imposes costs: storage, retrieval latency, additional LLM calls for summarization or extraction, embedding computation, and engineering complexity. The memory architecture must justify these costs through measurable improvements in task completion, user satisfaction, or error reduction. Systems that store everything indiscriminately often perform worse than systems with no memory at all, because irrelevant retrieved memories dilute the context and confuse the model.

The goal is not to remember everything -- it is to remember the right things and retrieve them at the right time.

## Cognitive Science Foundations

### The Human Memory Taxonomy

The cognitive science literature provides a taxonomy of memory types that maps surprisingly well onto the engineering challenges of LLM systems. This mapping is not merely metaphorical -- it provides genuine architectural guidance because the functional requirements are analogous even though the mechanisms differ completely.

```
                    Human Memory System
                           |
            +--------------+--------------+
            |                             |
      Short-term                    Long-term
      (Working Memory)                    |
      ~7 items, seconds          +--------+--------+
                                 |        |        |
                            Explicit  Implicit  Procedural
                                 |                 |
                          +------+------+    Skills, habits,
                          |             |    motor patterns
                     Episodic      Semantic
                     |             |
                Events,        Facts,
                experiences    concepts,
                autobiographical    knowledge
```

**Working memory** (Baddeley & Hitch, 1974) holds a small amount of information in an active, readily accessible state. Its capacity is severely limited -- roughly 7 plus or minus 2 items (Miller, 1956), or about 4 "chunks" in modern estimates (Cowan, 2001). Information in working memory decays rapidly unless actively rehearsed. In LLM systems, the context window serves this function.

**Episodic memory** (Tulving, 1972) stores records of personally experienced events, tagged with temporal and contextual information. You remember *what* happened, *when* it happened, and *what it felt like*. Episodic memories are inherently autobiographical -- they are tied to the self. For agents, episodic memory stores interaction histories, task trajectories, and outcome records.

**Semantic memory** (Tulving, 1972) stores general knowledge and facts divorced from the context in which they were learned. You know that Paris is the capital of France without remembering when or where you learned this fact. For agents, semantic memory stores extracted facts, entity knowledge, user preferences, and domain knowledge.

**Procedural memory** stores learned skills and behavioral patterns -- how to do things rather than what things are. You can ride a bicycle without being able to articulate the physics involved. For agents, procedural memory stores learned tool-use patterns, successful strategies, and behavioral adaptations.

### Mapping to LLM System Components

| Cognitive Type | LLM System Analog | Storage Mechanism | Access Pattern |
|---|---|---|---|
| Working memory | Context window | Token sequence | Direct attention |
| Episodic memory | Interaction logs, trajectories | Vector store + metadata DB | Similarity search + temporal filtering |
| Semantic memory | Knowledge base, fact store | Vector store + graph DB | Semantic retrieval + entity lookup |
| Procedural memory | Tool-use history, strategy cache | Key-value store + rules | Pattern matching + frequency analysis |

The rest of this article examines each memory type in detail, then shows how to combine them into hybrid architectures.

## Working Memory: The Context Window

### Context as RAM

The context window is the only information the model can directly attend to during inference. Everything outside the context window is, from the model's perspective, nonexistent. This makes context window management the most critical memory operation -- it determines what the model knows when it generates each token.

Modern context windows range from 8K tokens (smaller open-source models) to 200K tokens (Claude) to 1-2M tokens (Gemini). But raw capacity is misleading. Research consistently demonstrates that model performance degrades as context length increases, particularly for information positioned in the middle of the context (Liu et al., 2023). Effective capacity -- the amount of context the model reliably attends to -- is substantially lower than the raw token limit.

For a thorough treatment of context budget allocation, information ordering, and the "lost in the middle" phenomenon, see [Context Engineering](/context-engineering).

### Conversation Buffer Strategies

The simplest working memory pattern is a conversation buffer that stores the full message history and truncates when the context limit is reached. This is the default in most chatbot implementations, and it has well-known failure modes.

```python
from dataclasses import dataclass, field
from typing import Literal
import tiktoken


@dataclass
class Message:
    role: Literal["system", "user", "assistant", "tool"]
    content: str
    token_count: int = 0

    def __post_init__(self):
        if self.token_count == 0:
            enc = tiktoken.get_encoding("cl100k_base")
            self.token_count = len(enc.encode(self.content))


class ConversationBuffer:
    """Full conversation history with naive FIFO truncation."""

    def __init__(self, max_tokens: int = 8000):
        self.max_tokens = max_tokens
        self.messages: list[Message] = []

    def add(self, role: str, content: str):
        self.messages.append(Message(role=role, content=content))

    def get_messages(self) -> list[dict]:
        """Return messages that fit within the token budget."""
        total = sum(m.token_count for m in self.messages)
        if total <= self.max_tokens:
            return [{"role": m.role, "content": m.content}
                    for m in self.messages]

        # Truncate from the front (oldest messages first)
        # Always preserve system messages
        system_msgs = [m for m in self.messages if m.role == "system"]
        other_msgs = [m for m in self.messages if m.role != "system"]

        budget = self.max_tokens - sum(m.token_count for m in system_msgs)
        kept = []
        for msg in reversed(other_msgs):
            if msg.token_count <= budget:
                kept.insert(0, msg)
                budget -= msg.token_count
            else:
                break

        return [{"role": m.role, "content": m.content}
                for m in system_msgs + kept]
```

The problem with naive truncation is information loss. The first messages in a conversation often contain critical context -- the user's initial request, key constraints, important background. FIFO truncation discards exactly the messages that established the conversation's foundation.

### Sliding Window with Summary

A more sophisticated approach maintains a rolling summary of older messages while keeping recent messages verbatim. This preserves the essential information from early conversation turns while maintaining full fidelity for recent context.

```python
class SlidingWindowSummaryBuffer:
    """Sliding window with progressive summarization of older messages."""

    def __init__(self, llm, max_tokens: int = 8000,
                 recent_window: int = 6,
                 summary_trigger_ratio: float = 0.75):
        self.llm = llm
        self.max_tokens = max_tokens
        self.recent_window = recent_window
        self.summary_trigger = int(max_tokens * summary_trigger_ratio)
        self.messages: list[Message] = []
        self.running_summary: str = ""
        self.summary_token_count: int = 0

    def add(self, role: str, content: str):
        self.messages.append(Message(role=role, content=content))
        if self._total_tokens() > self.summary_trigger:
            self._compress()

    def _total_tokens(self) -> int:
        return (self.summary_token_count +
                sum(m.token_count for m in self.messages))

    def _compress(self):
        """Summarize older messages, keep recent window intact."""
        if len(self.messages) <= self.recent_window:
            return

        older = self.messages[:-self.recent_window]
        self.messages = self.messages[-self.recent_window:]

        older_text = "\n".join(
            f"{m.role}: {m.content}" for m in older
        )

        prompt = (
            "You are a conversation summarizer. Produce a concise summary "
            "that preserves ALL of the following:\n"
            "- Key facts and decisions\n"
            "- User preferences and constraints\n"
            "- Unresolved questions or pending tasks\n"
            "- Important context for continuing the conversation\n\n"
            f"Previous summary:\n{self.running_summary}\n\n"
            f"New messages to incorporate:\n{older_text}\n\n"
            "Updated summary:"
        )

        self.running_summary = self.llm.generate(prompt)
        enc = tiktoken.get_encoding("cl100k_base")
        self.summary_token_count = len(enc.encode(self.running_summary))

    def get_context(self) -> list[dict]:
        context = []
        if self.running_summary:
            context.append({
                "role": "system",
                "content": (
                    f"Summary of earlier conversation:\n"
                    f"{self.running_summary}"
                )
            })
        context.extend(
            {"role": m.role, "content": m.content}
            for m in self.messages
        )
        return context
```

### Token-Aware Truncation with Priority

Not all messages are equally important. A priority-aware truncation system assigns importance scores and keeps the most valuable information when space is scarce.

```python
from enum import IntEnum


class Priority(IntEnum):
    CRITICAL = 4    # System prompt, user constraints, key decisions
    HIGH = 3        # Tool results, important context
    MEDIUM = 2      # Regular conversation turns
    LOW = 1         # Greetings, acknowledgments, filler


class PriorityTruncationBuffer:
    """Token-aware buffer that drops low-priority messages first."""

    def __init__(self, max_tokens: int = 8000):
        self.max_tokens = max_tokens
        self.entries: list[tuple[Priority, Message]] = []

    def add(self, role: str, content: str,
            priority: Priority = Priority.MEDIUM):
        msg = Message(role=role, content=content)
        self.entries.append((priority, msg))

    def get_context(self) -> list[dict]:
        total = sum(m.token_count for _, m in self.entries)
        if total <= self.max_tokens:
            return [{"role": m.role, "content": m.content}
                    for _, m in self.entries]

        # Sort by priority (ascending) to identify drop candidates
        indexed = list(enumerate(self.entries))
        indexed.sort(key=lambda x: x[1][0])  # sort by priority

        drop_indices = set()
        excess = total - self.max_tokens
        for original_idx, (priority, msg) in indexed:
            if excess <= 0:
                break
            if priority <= Priority.LOW:
                drop_indices.add(original_idx)
                excess -= msg.token_count

        # If still over budget, drop MEDIUM priority
        if excess > 0:
            for original_idx, (priority, msg) in indexed:
                if excess <= 0:
                    break
                if (priority <= Priority.MEDIUM
                        and original_idx not in drop_indices):
                    drop_indices.add(original_idx)
                    excess -= msg.token_count

        return [
            {"role": m.role, "content": m.content}
            for i, (_, m) in enumerate(self.entries)
            if i not in drop_indices
        ]
```

### Working Memory Architecture Diagram

```
                    ┌─────────────────────────────┐
                    │      Context Window          │
                    │     (Working Memory)         │
                    │                              │
                    │  ┌────────────────────────┐  │
                    │  │ System Prompt (fixed)   │  │
                    │  │ ~500 tokens             │  │
                    │  ├────────────────────────┤  │
                    │  │ Running Summary         │  │
                    │  │ (compressed history)    │  │
                    │  │ ~800 tokens             │  │
                    │  ├────────────────────────┤  │
                    │  │ Retrieved Memories      │  │
                    │  │ (episodic + semantic)   │  │
                    │  │ ~2000 tokens            │  │
                    │  ├────────────────────────┤  │
                    │  │ Tool Definitions        │  │
                    │  │ ~800 tokens             │  │
                    │  ├────────────────────────┤  │
                    │  │ Recent Messages         │  │
                    │  │ (verbatim, last N)      │  │
                    │  │ ~3000 tokens            │  │
                    │  ├────────────────────────┤  │
                    │  │ Current Query           │  │
                    │  │ ~200 tokens             │  │
                    │  ├────────────────────────┤  │
                    │  │ Output Reserve          │  │
                    │  │ ~700 tokens             │  │
                    │  └────────────────────────┘  │
                    │  Total budget: ~8000 tokens   │
                    └─────────────────────────────┘
```

## Episodic Memory: Storing and Retrieving Experiences

### What Makes Episodic Memory Different

Episodic memory is not a general-purpose fact store. It records *experiences* -- bounded sequences of events with temporal structure, causal relationships, and outcomes. A semantic memory might store "user prefers Python over Java." An episodic memory stores "on March 15, the user asked me to refactor a Java service into Python. I tried approach X first, which failed because of dependency Y. Then I tried approach Z, which succeeded. The user was satisfied with the result."

The richness of episodic records -- the what, when, how, and outcome -- enables a form of learning that semantic facts alone cannot provide. An agent with episodic memory can recognize that a current situation resembles a past episode and apply the lessons learned, even when the surface-level details differ.

### Episode Schema and Storage

```python
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any
import hashlib
import json


class Outcome(str, Enum):
    SUCCESS = "success"
    PARTIAL = "partial"
    FAILURE = "failure"
    ABANDONED = "abandoned"


@dataclass
class TrajectoryStep:
    """A single step in an agent's action trajectory."""
    thought: str              # Agent's reasoning
    action: str               # Tool call or response
    observation: str          # Result of the action
    timestamp: datetime = field(default_factory=datetime.now)


@dataclass
class Episode:
    """A complete record of a task attempt."""
    episode_id: str
    task_description: str
    trajectory: list[TrajectoryStep]
    outcome: Outcome
    reflection: str           # Post-hoc analysis of what happened
    duration_seconds: float
    context: dict[str, Any]   # Environment, user info, etc.
    created_at: datetime = field(default_factory=datetime.now)
    tags: list[str] = field(default_factory=list)

    @staticmethod
    def generate_id(task: str, timestamp: datetime) -> str:
        raw = f"{task}:{timestamp.isoformat()}"
        return hashlib.sha256(raw.encode()).hexdigest()[:16]

    def to_summary(self) -> str:
        """Compact representation for context injection."""
        steps_summary = " -> ".join(
            f"[{s.action}]" for s in self.trajectory
        )
        return (
            f"Task: {self.task_description}\n"
            f"Outcome: {self.outcome.value}\n"
            f"Steps: {steps_summary}\n"
            f"Lesson: {self.reflection}"
        )
```

### Episodic Memory Store

The episodic memory store must support three retrieval patterns: semantic similarity (find episodes related to a query), temporal retrieval (find recent episodes), and outcome filtering (find successful or failed episodes for a given task type).

```python
class EpisodicMemoryStore:
    """Storage and retrieval of agent episodes."""

    def __init__(self, embedding_model, vector_store, metadata_db):
        self.embedder = embedding_model
        self.vectors = vector_store
        self.metadata = metadata_db

    async def record(self, episode: Episode):
        """Store a completed episode."""
        # Embed the task description + reflection for retrieval
        text_for_embedding = (
            f"{episode.task_description} | "
            f"{episode.outcome.value} | "
            f"{episode.reflection}"
        )
        embedding = await self.embedder.embed(text_for_embedding)

        # Store vector for similarity search
        await self.vectors.upsert(
            id=episode.episode_id,
            embedding=embedding,
            metadata={
                "task": episode.task_description,
                "outcome": episode.outcome.value,
                "created_at": episode.created_at.isoformat(),
                "tags": json.dumps(episode.tags),
                "duration": episode.duration_seconds,
            }
        )

        # Store full episode data in metadata DB
        await self.metadata.insert(
            "episodes",
            {
                "id": episode.episode_id,
                "data": json.dumps(episode.__dict__, default=str),
                "created_at": episode.created_at,
            }
        )

    async def retrieve_similar(self, query: str, top_k: int = 5,
                                outcome_filter: Outcome = None,
                                max_age_hours: float = None) -> list[Episode]:
        """Retrieve episodes similar to the current situation."""
        query_embedding = await self.embedder.embed(query)

        filters = {}
        if outcome_filter:
            filters["outcome"] = outcome_filter.value
        if max_age_hours:
            cutoff = datetime.now() - timedelta(hours=max_age_hours)
            filters["created_at"] = {"$gte": cutoff.isoformat()}

        results = await self.vectors.search(
            query_embedding, top_k=top_k, filters=filters
        )

        episodes = []
        for result in results:
            raw = await self.metadata.get("episodes", result["id"])
            if raw:
                episode_data = json.loads(raw["data"])
                episodes.append(Episode(**episode_data))

        return episodes

    async def retrieve_recent(self, limit: int = 10) -> list[Episode]:
        """Retrieve the most recent episodes regardless of content."""
        rows = await self.metadata.query(
            "episodes",
            order_by="created_at DESC",
            limit=limit
        )
        return [
            Episode(**json.loads(row["data"]))
            for row in rows
        ]
```

### Temporal Retrieval and Conversation Indexing

Episodic memory retrieval often needs temporal awareness. A user asking "what did we discuss last week?" or "go back to the approach we tried earlier" requires time-based filtering, not just semantic similarity.

```python
class TemporalIndex:
    """Time-based index for episodic memories."""

    def __init__(self, metadata_db):
        self.db = metadata_db

    async def get_episodes_in_range(
        self, start: datetime, end: datetime,
        tags: list[str] = None
    ) -> list[str]:
        """Return episode IDs within a time range."""
        query = {
            "created_at": {"$gte": start.isoformat(),
                           "$lte": end.isoformat()}
        }
        if tags:
            query["tags"] = {"$containsAny": tags}

        rows = await self.db.query("episodes", filters=query)
        return [row["id"] for row in rows]

    async def get_session_episodes(self, session_id: str) -> list[str]:
        """Return all episodes from a specific session."""
        rows = await self.db.query(
            "episodes",
            filters={"context.session_id": session_id},
            order_by="created_at ASC"
        )
        return [row["id"] for row in rows]


class ConversationIndex:
    """Index conversations for episodic retrieval."""

    def __init__(self, embedding_model, vector_store):
        self.embedder = embedding_model
        self.vectors = vector_store

    async def index_conversation(self, conversation_id: str,
                                  messages: list[dict],
                                  summary: str):
        """Index a completed conversation for future retrieval."""
        # Create embedding from the conversation summary
        embedding = await self.embedder.embed(summary)

        # Extract key topics for metadata filtering
        topics = await self._extract_topics(messages)

        await self.vectors.upsert(
            id=conversation_id,
            embedding=embedding,
            metadata={
                "type": "conversation",
                "message_count": len(messages),
                "topics": topics,
                "summary": summary,
                "started_at": messages[0].get("timestamp", ""),
                "ended_at": messages[-1].get("timestamp", ""),
            }
        )

    async def find_related_conversations(
        self, query: str, top_k: int = 3
    ) -> list[dict]:
        """Find past conversations relevant to the current query."""
        query_embedding = await self.embedder.embed(query)
        return await self.vectors.search(
            query_embedding,
            top_k=top_k,
            filters={"type": "conversation"}
        )
```

### Reflection: The Key to Episodic Learning

Raw episode records are useful, but the real value comes from reflection -- having the agent (or an LLM) analyze what happened and extract transferable lessons. This is inspired by the reflection mechanism in the Generative Agents paper (Park et al., 2023), covered in detail in [Agent Memory](/agent-memory).

```python
class EpisodeReflector:
    """Generate reflections from completed episodes."""

    def __init__(self, llm):
        self.llm = llm

    async def reflect(self, episode: Episode) -> str:
        """Generate a reflection on a completed episode."""
        trajectory_text = "\n".join(
            f"Step {i+1}:\n"
            f"  Thought: {step.thought}\n"
            f"  Action: {step.action}\n"
            f"  Result: {step.observation}"
            for i, step in enumerate(episode.trajectory)
        )

        prompt = (
            "Analyze this agent task execution and extract lessons learned.\n\n"
            f"Task: {episode.task_description}\n"
            f"Outcome: {episode.outcome.value}\n"
            f"Duration: {episode.duration_seconds:.1f}s\n\n"
            f"Trajectory:\n{trajectory_text}\n\n"
            "Write a concise reflection covering:\n"
            "1. What worked well and why\n"
            "2. What failed and why\n"
            "3. What should be done differently next time\n"
            "4. A one-sentence transferable lesson\n\n"
            "Reflection:"
        )

        return await self.llm.generate(prompt)

    async def synthesize_pattern(
        self, episodes: list[Episode]
    ) -> str:
        """Identify patterns across multiple related episodes."""
        summaries = "\n---\n".join(
            e.to_summary() for e in episodes
        )

        prompt = (
            f"Analyze these {len(episodes)} related task episodes and "
            "identify recurring patterns.\n\n"
            f"{summaries}\n\n"
            "Identify:\n"
            "1. Common success patterns\n"
            "2. Common failure patterns\n"
            "3. Strategies that consistently work\n"
            "4. Conditions under which different approaches succeed\n\n"
            "Pattern analysis:"
        )

        return await self.llm.generate(prompt)
```

## Semantic Memory: Facts, Entities, and Knowledge

### The Knowledge Base as Semantic Memory

Semantic memory stores facts and knowledge independent of the episodes in which they were learned. While episodic memory answers "what happened?", semantic memory answers "what do I know?" This distinction is critical for efficiency: once a fact has been extracted and verified across multiple episodes, it can be stored compactly as a semantic memory without the overhead of maintaining the full episode context.

```
Episodic Memory                          Semantic Memory
(source experiences)                     (extracted knowledge)

"On March 15, user asked me to          "User: software engineer,
 help with Python. They mentioned         prefers Python, works on
 they work on ML pipelines at             ML pipelines, employer: Acme
 Acme Corp."                              Corp"

"On March 20, user got frustrated        "User dislikes verbose
 when I generated verbose code.           code. Prefers concise,
 They said 'keep it concise'."            well-commented style."

"On March 22, user asked about           "User's tech stack: Python,
 their deployment and mentioned           FastAPI, PostgreSQL,
 using FastAPI with PostgreSQL."          Docker"
```

### Entity-Centric Semantic Memory

The most useful semantic memories are organized around entities -- users, projects, tools, concepts -- rather than stored as flat lists of facts. Entity-centric organization enables efficient retrieval when the agent needs everything it knows about a particular entity.

```python
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional


@dataclass
class Fact:
    """A single factual assertion about an entity."""
    content: str
    confidence: float         # 0.0 to 1.0
    source_episode_ids: list[str]  # Provenance tracking
    first_observed: datetime = field(default_factory=datetime.now)
    last_confirmed: datetime = field(default_factory=datetime.now)
    contradiction_count: int = 0

    @property
    def is_stale(self) -> bool:
        """Fact has not been confirmed in 30 days."""
        age = (datetime.now() - self.last_confirmed).days
        return age > 30


@dataclass
class Entity:
    """An entity with associated semantic facts."""
    entity_id: str
    entity_type: str          # "user", "project", "tool", "concept"
    name: str
    facts: list[Fact] = field(default_factory=list)
    relations: list[tuple[str, str, str]] = field(default_factory=list)
    # (relation_type, target_entity_id, description)

    def active_facts(self) -> list[Fact]:
        """Return facts that are current and confident."""
        return [
            f for f in self.facts
            if f.confidence >= 0.5 and not f.is_stale
        ]


class SemanticMemoryStore:
    """Entity-centric semantic memory with fact management."""

    def __init__(self, embedding_model, vector_store, entity_db):
        self.embedder = embedding_model
        self.vectors = vector_store
        self.entity_db = entity_db

    async def store_fact(self, entity_id: str, fact_content: str,
                          confidence: float = 0.8,
                          source_episode_id: str = None):
        """Store or update a fact about an entity."""
        entity = await self.entity_db.get(entity_id)
        if not entity:
            raise ValueError(f"Entity {entity_id} not found")

        # Check for duplicate or contradictory facts
        existing = await self._find_related_fact(entity, fact_content)

        if existing and await self._is_consistent(existing.content,
                                                   fact_content):
            # Reinforce existing fact
            existing.last_confirmed = datetime.now()
            existing.confidence = min(1.0, existing.confidence + 0.1)
            if source_episode_id:
                existing.source_episode_ids.append(source_episode_id)
        elif existing:
            # Contradiction detected
            existing.contradiction_count += 1
            if confidence > existing.confidence:
                # New fact is more confident -- replace
                existing.content = fact_content
                existing.confidence = confidence
                existing.last_confirmed = datetime.now()
        else:
            # New fact
            fact = Fact(
                content=fact_content,
                confidence=confidence,
                source_episode_ids=(
                    [source_episode_id] if source_episode_id else []
                ),
            )
            entity.facts.append(fact)

        await self.entity_db.update(entity)
        await self._update_vector_index(entity)

    async def retrieve_entity_context(
        self, entity_id: str, max_facts: int = 20
    ) -> str:
        """Build a context string with everything known about an entity."""
        entity = await self.entity_db.get(entity_id)
        if not entity:
            return ""

        facts = sorted(
            entity.active_facts(),
            key=lambda f: f.confidence,
            reverse=True
        )[:max_facts]

        relations = []
        for rel_type, target_id, desc in entity.relations:
            target = await self.entity_db.get(target_id)
            if target:
                relations.append(f"- {rel_type}: {target.name} ({desc})")

        sections = [f"Entity: {entity.name} ({entity.entity_type})"]

        if facts:
            sections.append("Known facts:")
            sections.extend(f"- {f.content}" for f in facts)

        if relations:
            sections.append("Relationships:")
            sections.extend(relations)

        return "\n".join(sections)

    async def semantic_search(self, query: str,
                               entity_type: str = None,
                               top_k: int = 10) -> list[dict]:
        """Search semantic memory by query relevance."""
        query_embedding = await self.embedder.embed(query)

        filters = {}
        if entity_type:
            filters["entity_type"] = entity_type

        return await self.vectors.search(
            query_embedding, top_k=top_k, filters=filters
        )

    async def _find_related_fact(
        self, entity: Entity, fact_content: str
    ) -> Optional[Fact]:
        """Find an existing fact semantically similar to the new one."""
        if not entity.facts:
            return None

        new_embedding = await self.embedder.embed(fact_content)
        best_match = None
        best_sim = 0.0

        for fact in entity.facts:
            fact_embedding = await self.embedder.embed(fact.content)
            sim = cosine_similarity(new_embedding, fact_embedding)
            if sim > 0.85 and sim > best_sim:
                best_match = fact
                best_sim = sim

        return best_match

    async def _is_consistent(self, existing: str, new: str) -> bool:
        """Check if two facts are consistent (not contradictory)."""
        # Simple heuristic: high similarity = consistent
        e1 = await self.embedder.embed(existing)
        e2 = await self.embedder.embed(new)
        return cosine_similarity(e1, e2) > 0.7

    async def _update_vector_index(self, entity: Entity):
        """Update the vector index for an entity."""
        facts_text = " | ".join(
            f.content for f in entity.active_facts()
        )
        text = f"{entity.name} ({entity.entity_type}): {facts_text}"
        embedding = await self.embedder.embed(text)

        await self.vectors.upsert(
            id=entity.entity_id,
            embedding=embedding,
            metadata={
                "entity_type": entity.entity_type,
                "name": entity.name,
                "fact_count": len(entity.active_facts()),
            }
        )
```

### Entity Extraction Pipeline

Semantic memory is only as good as the extraction pipeline that populates it. An LLM-based extractor identifies entities and facts from conversation turns and stores them systematically.

```python
class EntityFactExtractor:
    """Extract entities and facts from conversation turns."""

    def __init__(self, llm):
        self.llm = llm

    async def extract(
        self, conversation_turn: str, existing_entities: list[str]
    ) -> list[dict]:
        """Extract entity-fact pairs from a conversation turn."""
        entities_context = (
            f"Known entities: {', '.join(existing_entities)}"
            if existing_entities else "No known entities yet."
        )

        prompt = (
            "Extract entities and facts from this conversation turn.\n"
            "Return JSON with this structure:\n"
            '[\n'
            '  {\n'
            '    "entity_name": "string",\n'
            '    "entity_type": "user|project|tool|concept|organization",\n'
            '    "facts": ["fact 1", "fact 2"],\n'
            '    "relations": [\n'
            '      {"type": "works_at", "target": "Acme Corp"}\n'
            '    ]\n'
            '  }\n'
            ']\n\n'
            "Rules:\n"
            "- Only extract genuinely important, durable facts\n"
            "- Skip transient information (greetings, filler)\n"
            "- Merge with existing entities when possible\n"
            f"- {entities_context}\n\n"
            f"Conversation turn:\n{conversation_turn}\n\n"
            "Extracted entities and facts (JSON):"
        )

        response = await self.llm.generate(prompt)
        try:
            return json.loads(response)
        except json.JSONDecodeError:
            return []
```

For the embedding models used in semantic memory storage and retrieval, see [Embeddings](/embeddings). For production vector database selection and configuration, see [Vector Databases](/vector-databases).

## Procedural Memory: Learning How to Act

### Beyond Facts and Episodes

Procedural memory is the least discussed but arguably the most impactful memory type for agent systems. While semantic memory stores what the agent knows and episodic memory stores what the agent has experienced, procedural memory stores what the agent has learned about *how to act effectively*. This includes:

- **Tool-use patterns**: Which tools work best for which situations, optimal parameter choices, common failure modes.
- **Strategy preferences**: When to use approach A versus approach B, based on accumulated experience.
- **User interaction patterns**: Communication style preferences, level of detail preferred, topics to avoid.
- **Environmental knowledge**: API rate limits encountered, service latency patterns, infrastructure constraints discovered through experience.

### Procedural Memory Implementation

```python
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime


@dataclass
class ToolUsageRecord:
    tool_name: str
    parameters: dict
    context: str             # What task was being performed
    success: bool
    execution_time_ms: float
    error_message: str = ""
    timestamp: datetime = field(default_factory=datetime.now)


@dataclass
class Strategy:
    """A learned behavioral pattern."""
    name: str
    description: str
    conditions: str          # When to apply this strategy
    procedure: str           # What to do
    success_count: int = 0
    failure_count: int = 0
    last_used: datetime = field(default_factory=datetime.now)

    @property
    def success_rate(self) -> float:
        total = self.success_count + self.failure_count
        return self.success_count / total if total > 0 else 0.5

    @property
    def confidence(self) -> float:
        """Bayesian-inspired confidence based on sample size."""
        total = self.success_count + self.failure_count
        if total == 0:
            return 0.0
        # Wilson score lower bound (simplified)
        p = self.success_rate
        z = 1.96  # 95% confidence
        denominator = 1 + z * z / total
        center = p + z * z / (2 * total)
        spread = z * (p * (1 - p) / total + z * z / (4 * total * total)) ** 0.5
        return (center - spread) / denominator


class ProceduralMemory:
    """Stores and retrieves learned behavioral patterns."""

    def __init__(self):
        self.tool_history: list[ToolUsageRecord] = []
        self.strategies: dict[str, Strategy] = {}
        self.preferences: dict[str, Any] = {}
        self._tool_stats: dict[str, dict] = defaultdict(
            lambda: {"successes": 0, "failures": 0, "avg_time_ms": 0.0}
        )

    def record_tool_use(self, record: ToolUsageRecord):
        """Record a tool usage for pattern learning."""
        self.tool_history.append(record)

        stats = self._tool_stats[record.tool_name]
        if record.success:
            stats["successes"] += 1
        else:
            stats["failures"] += 1

        # Running average of execution time
        total = stats["successes"] + stats["failures"]
        stats["avg_time_ms"] = (
            stats["avg_time_ms"] * (total - 1) + record.execution_time_ms
        ) / total

    def get_tool_guidance(self, tool_name: str) -> dict:
        """Get learned guidance for using a specific tool."""
        stats = self._tool_stats.get(tool_name)
        if not stats:
            return {"known": False}

        # Find common error patterns
        failures = [
            r for r in self.tool_history
            if r.tool_name == tool_name and not r.success
        ]
        common_errors = self._find_common_errors(failures)

        # Find successful parameter patterns
        successes = [
            r for r in self.tool_history
            if r.tool_name == tool_name and r.success
        ]
        successful_patterns = self._find_parameter_patterns(successes)

        total = stats["successes"] + stats["failures"]
        return {
            "known": True,
            "success_rate": stats["successes"] / total if total > 0 else 0,
            "avg_execution_time_ms": stats["avg_time_ms"],
            "total_uses": total,
            "common_errors": common_errors,
            "successful_patterns": successful_patterns,
        }

    def register_strategy(self, name: str, description: str,
                           conditions: str, procedure: str):
        """Register a new learned strategy."""
        self.strategies[name] = Strategy(
            name=name,
            description=description,
            conditions=conditions,
            procedure=procedure,
        )

    def update_strategy_outcome(self, name: str, success: bool):
        """Update a strategy's track record."""
        if name in self.strategies:
            strategy = self.strategies[name]
            if success:
                strategy.success_count += 1
            else:
                strategy.failure_count += 1
            strategy.last_used = datetime.now()

    def get_applicable_strategies(
        self, context: str, min_confidence: float = 0.3
    ) -> list[Strategy]:
        """Return strategies that might apply to the current context."""
        applicable = [
            s for s in self.strategies.values()
            if s.confidence >= min_confidence
        ]
        # Sort by confidence (highest first)
        applicable.sort(key=lambda s: s.confidence, reverse=True)
        return applicable

    def get_context_injection(self) -> str:
        """Build a procedural memory context string for injection."""
        sections = []

        # High-confidence strategies
        strategies = [
            s for s in self.strategies.values()
            if s.confidence >= 0.5 and s.success_count >= 3
        ]
        if strategies:
            sections.append("Learned strategies:")
            for s in sorted(strategies,
                            key=lambda x: x.confidence, reverse=True)[:5]:
                sections.append(
                    f"- {s.name} (confidence: {s.confidence:.0%}): "
                    f"{s.description}. Apply when: {s.conditions}"
                )

        # Tool warnings
        problematic_tools = [
            (name, stats) for name, stats in self._tool_stats.items()
            if stats["failures"] > 2 and
            stats["failures"] / (stats["successes"] + stats["failures"]) > 0.3
        ]
        if problematic_tools:
            sections.append("Tool usage warnings:")
            for name, stats in problematic_tools:
                total = stats["successes"] + stats["failures"]
                fail_rate = stats["failures"] / total
                sections.append(
                    f"- {name}: {fail_rate:.0%} failure rate "
                    f"over {total} uses"
                )

        # User preferences
        if self.preferences:
            sections.append("User preferences:")
            for key, value in self.preferences.items():
                sections.append(f"- {key}: {value}")

        return "\n".join(sections) if sections else ""

    @staticmethod
    def _find_common_errors(
        failures: list[ToolUsageRecord]
    ) -> list[str]:
        """Identify recurring error patterns."""
        error_counts: dict[str, int] = defaultdict(int)
        for record in failures:
            if record.error_message:
                # Normalize error messages (strip variable parts)
                normalized = record.error_message.split(":")[0].strip()
                error_counts[normalized] += 1

        return [
            f"{error} ({count} occurrences)"
            for error, count in sorted(
                error_counts.items(), key=lambda x: -x[1]
            )[:5]
        ]

    @staticmethod
    def _find_parameter_patterns(
        successes: list[ToolUsageRecord]
    ) -> list[str]:
        """Identify common parameter patterns in successful uses."""
        if not successes:
            return []

        # Find parameters that appear in most successful calls
        param_values: dict[str, list] = defaultdict(list)
        for record in successes:
            for key, value in record.parameters.items():
                param_values[key].append(value)

        patterns = []
        for key, values in param_values.items():
            if len(set(str(v) for v in values)) == 1:
                patterns.append(f"{key}={values[0]} (always)")
            else:
                most_common = max(
                    set(str(v) for v in values),
                    key=lambda v: sum(1 for x in values if str(x) == v)
                )
                freq = sum(
                    1 for v in values if str(v) == most_common
                ) / len(values)
                if freq > 0.6:
                    patterns.append(
                        f"{key}={most_common} ({freq:.0%} of successes)"
                    )

        return patterns
```

## Virtual Context Management: The MemGPT Paradigm

### Operating System Analogy

The MemGPT architecture (Packer et al., 2023) draws a direct analogy between LLM context management and operating system virtual memory. Just as an OS creates the illusion of unlimited memory by paging between RAM and disk, MemGPT creates the illusion of unlimited context by paging information between the context window and external storage.

```
Operating System                    MemGPT / Virtual Context
+------------------+               +------------------+
| CPU Registers    |               | System Prompt    |
| (fastest, tiny)  |               | (always present) |
+------------------+               +------------------+
| L1/L2 Cache      |               | Core Memory      |
| (fast, small)    |               | (always in ctx)  |
+------------------+               +------------------+
| RAM              |               | Context Window   |
| (medium, bounded)|               | (active pages)   |
+------------------+               +------------------+
| Disk / SSD       |               | Recall Memory    |
| (slow, large)    |               | (conversation DB)|
+------------------+               +------------------+
| Tape / Archive   |               | Archival Memory  |
| (slowest, vast)  |               | (vector store)   |
+------------------+               +------------------+
```

The key innovation is that the agent itself manages the paging. Rather than having an external system decide what goes into the context, the agent has memory management tools and uses them as part of its reasoning loop. For a detailed implementation of MemGPT's tool-based memory management, see [Agent Memory](/agent-memory).

### Memory Consolidation

Biological memory undergoes consolidation -- a process where short-term memories are transformed into stable long-term memories, typically during sleep. LLM systems need an analogous process to prevent memory stores from growing unboundedly while preserving important information.

```python
class MemoryConsolidator:
    """Periodic consolidation of memories across stores."""

    def __init__(self, llm, episodic_store: EpisodicMemoryStore,
                 semantic_store: SemanticMemoryStore,
                 procedural_store: ProceduralMemory):
        self.llm = llm
        self.episodic = episodic_store
        self.semantic = semantic_store
        self.procedural = procedural_store

    async def consolidate(self, lookback_hours: float = 24):
        """Run a consolidation pass over recent memories."""
        # Phase 1: Extract semantic facts from recent episodes
        recent_episodes = await self.episodic.retrieve_recent(limit=50)
        recent_episodes = [
            e for e in recent_episodes
            if (datetime.now() - e.created_at).total_seconds()
            < lookback_hours * 3600
        ]

        if recent_episodes:
            await self._extract_semantic_facts(recent_episodes)

        # Phase 2: Update procedural memory from episode outcomes
        await self._update_procedures(recent_episodes)

        # Phase 3: Merge duplicate semantic memories
        await self._deduplicate_facts()

        # Phase 4: Decay and forget
        await self._apply_forgetting()

    async def _extract_semantic_facts(self, episodes: list[Episode]):
        """Extract durable facts from episodic memories."""
        for episode in episodes:
            if episode.outcome == Outcome.ABANDONED:
                continue

            trajectory_summary = episode.to_summary()
            prompt = (
                "Extract any durable facts from this episode that would "
                "be useful to remember independently of the specific event.\n"
                "Only extract facts that are likely to remain true over time.\n"
                "Return JSON array of objects with 'entity_name', "
                "'entity_type', and 'fact' fields.\n\n"
                f"Episode:\n{trajectory_summary}\n\n"
                "Durable facts (JSON):"
            )

            response = await self.llm.generate(prompt)
            try:
                facts = json.loads(response)
                for fact_data in facts:
                    entity = await self._get_or_create_entity(
                        fact_data["entity_name"],
                        fact_data["entity_type"]
                    )
                    await self.semantic.store_fact(
                        entity_id=entity.entity_id,
                        fact_content=fact_data["fact"],
                        source_episode_id=episode.episode_id,
                    )
            except (json.JSONDecodeError, KeyError):
                continue

    async def _update_procedures(self, episodes: list[Episode]):
        """Update procedural memory based on episode outcomes."""
        for episode in episodes:
            for step in episode.trajectory:
                if "tool_call:" in step.action:
                    tool_name = step.action.split("tool_call:")[1].strip()
                    success = "error" not in step.observation.lower()
                    self.procedural.record_tool_use(
                        ToolUsageRecord(
                            tool_name=tool_name,
                            parameters={},
                            context=episode.task_description,
                            success=success,
                            execution_time_ms=0,
                            error_message=(
                                step.observation if not success else ""
                            ),
                        )
                    )

    async def _deduplicate_facts(self):
        """Merge semantically duplicate facts across entities."""
        # Implementation depends on the entity_db's query capabilities
        # Core logic: embed all facts, find high-similarity pairs,
        # merge by keeping the higher-confidence version
        pass

    async def _apply_forgetting(self):
        """Remove low-value memories to prevent unbounded growth."""
        # Forgetting criteria:
        # 1. Stale facts (not confirmed in 30+ days, low confidence)
        # 2. Episodes older than 90 days with no linked semantic facts
        # 3. Duplicate or near-duplicate episodes (keep best outcome)
        pass
```

### Forgetting Strategies

Forgetting is not a failure of memory -- it is a feature. Biological memory systems actively forget to maintain signal-to-noise ratio and prevent interference between similar memories. LLM memory systems need analogous mechanisms.

```python
class ForgettingPolicy:
    """Configurable forgetting strategies for memory management."""

    def __init__(self, config: dict):
        self.max_episodic_age_days = config.get("max_episode_age_days", 90)
        self.min_fact_confidence = config.get("min_fact_confidence", 0.3)
        self.max_stale_days = config.get("max_stale_days", 60)
        self.max_store_size = config.get("max_store_size", 10000)

    def should_forget_episode(self, episode: Episode) -> bool:
        """Determine if an episode should be forgotten."""
        age_days = (datetime.now() - episode.created_at).days

        # Never forget episodes with linked reflections or patterns
        if episode.reflection and episode.outcome == Outcome.SUCCESS:
            return age_days > self.max_episodic_age_days * 3

        # Forget old failures that have been reflected on
        if episode.outcome == Outcome.FAILURE and episode.reflection:
            return age_days > self.max_episodic_age_days

        # Forget abandoned episodes quickly
        if episode.outcome == Outcome.ABANDONED:
            return age_days > 7

        return age_days > self.max_episodic_age_days

    def should_forget_fact(self, fact: Fact) -> bool:
        """Determine if a semantic fact should be forgotten."""
        if fact.confidence < self.min_fact_confidence:
            return True
        if fact.is_stale and fact.confidence < 0.6:
            return True
        if fact.contradiction_count > 3:
            return True
        return False

    def select_for_removal(
        self, memories: list[dict], target_count: int
    ) -> list[str]:
        """Select memories for removal when store exceeds capacity."""
        if len(memories) <= target_count:
            return []

        # Score each memory (lower = more forgettable)
        scored = []
        for mem in memories:
            recency = 1.0 / (1 + (datetime.now() -
                              mem["created_at"]).days)
            access_freq = mem.get("access_count", 0) / max(
                1, (datetime.now() - mem["created_at"]).days
            )
            importance = mem.get("importance", 0.5)

            score = (recency * 0.3 +
                     access_freq * 0.3 +
                     importance * 0.4)
            scored.append((mem["id"], score))

        # Sort by score ascending (most forgettable first)
        scored.sort(key=lambda x: x[1])

        remove_count = len(memories) - target_count
        return [mem_id for mem_id, _ in scored[:remove_count]]
```

## Hybrid Memory Architectures

### Why Single Memory Types Are Insufficient

No single memory type addresses all the requirements of a production agent. Consider a customer support agent:

- It needs **working memory** to track the current conversation thread.
- It needs **episodic memory** to recall that this user had a similar issue last month and what resolved it.
- It needs **semantic memory** to know the user's account details, subscription tier, and preferences.
- It needs **procedural memory** to know that escalation to engineering is more effective than retry scripts for this category of issue.

A hybrid architecture layers these memory types and orchestrates retrieval across them.

### The Unified Memory Manager

```python
class UnifiedMemoryManager:
    """Orchestrates retrieval across all memory types."""

    def __init__(
        self,
        working: SlidingWindowSummaryBuffer,
        episodic: EpisodicMemoryStore,
        semantic: SemanticMemoryStore,
        procedural: ProceduralMemory,
        token_budget: int = 4000,
    ):
        self.working = working
        self.episodic = episodic
        self.semantic = semantic
        self.procedural = procedural
        self.token_budget = token_budget

    async def build_memory_context(
        self, query: str, user_id: str = None
    ) -> dict[str, str]:
        """
        Assemble memory context from all memory types,
        respecting the token budget.
        """
        budget = TokenBudget(self.token_budget)
        context = {}

        # 1. Procedural memory (highest priority -- affects behavior)
        procedural_ctx = self.procedural.get_context_injection()
        if procedural_ctx:
            tokens = estimate_tokens(procedural_ctx)
            if budget.can_afford(tokens):
                context["procedural"] = procedural_ctx
                budget.spend(tokens)

        # 2. Semantic memory -- entity context for the user
        if user_id:
            semantic_ctx = await self.semantic.retrieve_entity_context(
                entity_id=user_id, max_facts=15
            )
            if semantic_ctx:
                tokens = estimate_tokens(semantic_ctx)
                if budget.can_afford(tokens):
                    context["semantic"] = semantic_ctx
                    budget.spend(tokens)

        # 3. Semantic memory -- query-relevant facts
        relevant_facts = await self.semantic.semantic_search(
            query, top_k=5
        )
        if relevant_facts:
            facts_text = "\n".join(
                f"- {r['metadata']['name']}: "
                f"{r['metadata'].get('summary', '')}"
                for r in relevant_facts
            )
            tokens = estimate_tokens(facts_text)
            if budget.can_afford(tokens):
                context["relevant_knowledge"] = facts_text
                budget.spend(tokens)

        # 4. Episodic memory -- similar past experiences
        similar_episodes = await self.episodic.retrieve_similar(
            query, top_k=3, outcome_filter=None
        )
        if similar_episodes:
            episodes_text = "\n---\n".join(
                e.to_summary() for e in similar_episodes
            )
            tokens = estimate_tokens(episodes_text)
            if budget.can_afford(tokens):
                context["past_experiences"] = episodes_text
                budget.spend(tokens)

        # 5. Working memory (conversation context)
        # Handled separately by the conversation manager

        return context

    def format_for_injection(self, memory_context: dict) -> str:
        """Format the assembled memory for prompt injection."""
        sections = []

        if "procedural" in memory_context:
            sections.append(
                "## Learned Behaviors\n"
                f"{memory_context['procedural']}"
            )

        if "semantic" in memory_context:
            sections.append(
                "## User Profile\n"
                f"{memory_context['semantic']}"
            )

        if "relevant_knowledge" in memory_context:
            sections.append(
                "## Relevant Knowledge\n"
                f"{memory_context['relevant_knowledge']}"
            )

        if "past_experiences" in memory_context:
            sections.append(
                "## Relevant Past Experiences\n"
                f"{memory_context['past_experiences']}"
            )

        return "\n\n".join(sections)


class TokenBudget:
    """Track token spending against a budget."""

    def __init__(self, total: int):
        self.total = total
        self.spent = 0

    def can_afford(self, tokens: int) -> bool:
        return self.spent + tokens <= self.total

    def spend(self, tokens: int):
        self.spent += tokens

    @property
    def remaining(self) -> int:
        return self.total - self.spent
```

### Architecture Diagram: Hybrid Memory System

```
User Query
    |
    v
+-------------------+     +---------------------------+
| Context Assembler |<--->| Working Memory            |
|                   |     | (Sliding Window + Summary)|
|  Allocates token  |     +---------------------------+
|  budget across    |
|  memory types     |     +---------------------------+
|                   |<--->| Episodic Memory           |
|  Formats and      |     | (Vector Store + Metadata) |
|  orders context   |     | - Past task trajectories  |
|  for injection    |     | - Outcomes & reflections  |
|                   |     +---------------------------+
|                   |
|                   |     +---------------------------+
|                   |<--->| Semantic Memory           |
|                   |     | (Entity DB + Vector Index)|
|                   |     | - User facts & preferences|
|                   |     | - Domain knowledge        |
|                   |     +---------------------------+
|                   |
|                   |     +---------------------------+
|                   |<--->| Procedural Memory         |
|                   |     | (KV Store + Statistics)   |
|                   |     | - Tool-use patterns       |
|                   |     | - Learned strategies      |
+-------------------+     +---------------------------+
    |
    v
+-------------------+
| Assembled Context |
| [System Prompt]   |
| [Memory Context]  |
| [Conversation]    |
| [Current Query]   |
+-------------------+
    |
    v
+-------------------+
| LLM Inference     |
+-------------------+
    |
    v
+-------------------+
| Response +        |
| Memory Updates    |
| (async writeback) |
+-------------------+
    |
    +-----> Episodic: record episode
    +-----> Semantic: extract & store facts
    +-----> Procedural: record tool outcomes
```

### Memory Priority and Conflict Resolution

When multiple memory types return conflicting information, the system needs a resolution strategy. A semantic fact might say "user prefers Python" while a recent episode shows the user working in Rust. The resolution should favor recency and specificity.

```python
class MemoryConflictResolver:
    """Resolve conflicts between memory types."""

    PRIORITY = {
        "working": 4,       # Current conversation is ground truth
        "procedural": 3,    # Learned patterns are high-confidence
        "episodic_recent": 3,  # Recent experience
        "semantic": 2,      # Extracted facts (may be stale)
        "episodic_old": 1,  # Old experiences
    }

    @classmethod
    def resolve(cls, memories: list[dict]) -> list[dict]:
        """
        Given memories from different sources, resolve conflicts
        by keeping higher-priority versions.
        """
        # Group by topic/entity
        topic_groups = cls._group_by_topic(memories)

        resolved = []
        for topic, group in topic_groups.items():
            if len(group) == 1:
                resolved.append(group[0])
                continue

            # Sort by priority (highest first), then recency
            group.sort(
                key=lambda m: (
                    cls.PRIORITY.get(m["source_type"], 0),
                    m.get("timestamp", datetime.min)
                ),
                reverse=True
            )
            # Keep the highest-priority version
            resolved.append(group[0])

        return resolved

    @staticmethod
    def _group_by_topic(memories: list[dict]) -> dict:
        """Group memories that refer to the same topic."""
        # Simplified: group by entity_id if present
        groups = defaultdict(list)
        for mem in memories:
            key = mem.get("entity_id", mem.get("id", id(mem)))
            groups[key].append(mem)
        return dict(groups)
```

## Production Patterns and Considerations

### Asynchronous Memory Writes

Memory storage should never block the response to the user. All memory writes -- episode recording, fact extraction, vector indexing -- should happen asynchronously after the response is sent.

```python
import asyncio
from typing import Callable, Awaitable


class AsyncMemoryWriter:
    """Non-blocking memory write pipeline."""

    def __init__(self):
        self._queue: asyncio.Queue[Callable[[], Awaitable]] = (
            asyncio.Queue()
        )
        self._worker_task: asyncio.Task | None = None

    async def start(self):
        self._worker_task = asyncio.create_task(self._worker())

    async def _worker(self):
        while True:
            write_fn = await self._queue.get()
            try:
                await write_fn()
            except Exception as e:
                # Log but don't crash -- memory writes are best-effort
                print(f"Memory write failed: {e}")
            finally:
                self._queue.task_done()

    async def schedule(self, write_fn: Callable[[], Awaitable]):
        """Schedule a memory write for async execution."""
        await self._queue.put(write_fn)


# Usage in an agent loop
async def agent_turn(query: str, manager: UnifiedMemoryManager,
                     writer: AsyncMemoryWriter, llm):
    # Retrieve memory (synchronous, affects response quality)
    memory_context = await manager.build_memory_context(query)

    # Generate response
    response = await llm.generate(
        context=memory_context, query=query
    )

    # Schedule memory updates (async, non-blocking)
    await writer.schedule(
        lambda: record_episode(query, response)
    )
    await writer.schedule(
        lambda: extract_and_store_facts(query, response)
    )

    return response  # Returned immediately, writes happen later
```

### Memory System Evaluation

A memory system that is not measured cannot be improved. The key metrics span retrieval quality, task impact, and operational health.

```
Memory System Evaluation Framework
+-----------------------------------------------------------+
| Retrieval Quality                                         |
|   - Precision@k: Are retrieved memories relevant?         |
|   - Recall@k: Are important memories being found?         |
|   - MRR: Is the best memory ranked first?                 |
|   - Latency: p50 < 100ms, p99 < 500ms                   |
+-----------------------------------------------------------+
| Task Impact                                               |
|   - A/B: Task completion with vs. without memory          |
|   - Personalization accuracy: Are preferences respected?  |
|   - Redundant failure rate: Same mistake repeated?        |
|   - Context relevance: Does memory improve responses?     |
+-----------------------------------------------------------+
| Operational Health                                        |
|   - Store size growth rate                                |
|   - Memory utilization (% of stored memories ever used)   |
|   - Fact staleness distribution                           |
|   - Consolidation success rate                            |
|   - Forgetting policy effectiveness                       |
+-----------------------------------------------------------+
```

The most important metric is the A/B comparison of task performance with and without memory. If enabling memory does not measurably improve outcomes, the system is adding latency and complexity without benefit.

### Memory and Privacy

Any system that stores user interactions must address privacy and data retention. Under GDPR and similar regulations, users have the right to access, correct, and delete their data. Memory systems must support:

- **Right to access**: Export all memories associated with a user.
- **Right to erasure**: Delete all memories for a user, including propagating deletion to vector stores, metadata databases, and any derived data (summaries, extracted facts).
- **Data minimization**: Store only what is necessary. The entity extraction pipeline should be tuned to extract genuinely useful facts, not record everything.
- **Retention policies**: Automatic expiration of memories that have not been accessed within a configurable period.
- **PII detection**: Scan memories for personally identifiable information and either redact or flag for special handling.

These requirements should be designed into the memory architecture from the start, not retrofitted.

## Emerging Patterns

### Reflection-Augmented Memory

Rather than storing raw interactions, reflection-augmented systems periodically synthesize higher-level insights from accumulated memories. This is analogous to how humans form generalizations from specific experiences -- you do not remember every meal you have eaten, but you have developed preferences and knowledge about food.

The Generative Agents paper (Park et al., 2023) introduced a three-level memory hierarchy -- observation, reflection, and planning -- where reflections are higher-order memories generated by analyzing patterns across observations. This pattern is becoming standard in production agent systems.

### Memory-Augmented Retrieval

Traditional RAG retrieves from a static document corpus. Memory-augmented RAG adds the agent's own memories as an additional retrieval source, blending external knowledge with learned experience. The retrieval system searches both the knowledge base and the memory store, with results from each source weighted and interleaved.

For the full treatment of RAG patterns, see [Context Engineering](/context-engineering) and [Advanced RAG](/advanced-rag). For the evaluation of retrieval systems including memory-augmented variants, see [Vector Databases](/vector-databases) and the retrieval quality metrics discussed above.

### Shared Memory Across Agents

In multi-agent systems, memory sharing becomes an architectural concern. Should agents share a common memory store, maintain private memories with a shared read layer, or communicate memories through explicit message passing? The answer depends on the trust model and the agents' roles. For multi-agent coordination patterns, see the agent architecture literature and the coordination mechanisms discussed in the broader agent systems literature.

## Summary and Key Takeaways

- **LLMs are stateless by design.** Every form of memory must be engineered externally. The memory architecture is one of the most consequential design decisions in an LLM application.

- **Working memory (context window)** is the only information the model can attend to. Manage it actively through sliding windows, progressive summarization, and priority-aware truncation. Raw context window size is misleading -- effective capacity is much lower due to attention degradation.

- **Episodic memory** stores complete interaction records with temporal structure and outcomes. Its value comes from reflection -- extracting transferable lessons from specific experiences. Store task trajectories, not just facts.

- **Semantic memory** stores durable facts and entity knowledge independent of the episodes in which they were learned. Organize it around entities, manage fact confidence and staleness, and detect contradictions.

- **Procedural memory** stores learned behavioral patterns: tool-use statistics, successful strategies, user preferences. It is the least discussed memory type but has high impact because it directly shapes agent behavior.

- **Memory consolidation** is essential for long-running systems. Periodically extract semantic facts from episodes, merge duplicates, and apply forgetting policies. A system that never forgets eventually drowns in noise.

- **Forgetting is a feature, not a bug.** Active forgetting maintains signal-to-noise ratio. Design forgetting policies based on recency, access frequency, confidence, and importance.

- **Hybrid architectures** that combine all four memory types outperform any single memory type. The unified memory manager orchestrates retrieval across types within a shared token budget.

- **Memory writes must be asynchronous.** Never block the user response on memory storage. Treat memory updates as best-effort background operations.

- **Measure everything.** The only way to know if memory helps is to compare task performance with and without it. Track retrieval quality, task impact, and operational health metrics continuously.

- **Privacy is non-negotiable.** Design right-to-access, right-to-erasure, data minimization, and PII detection into the memory architecture from day one.
