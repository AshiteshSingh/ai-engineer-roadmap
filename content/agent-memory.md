# Agent Memory: Short-term, Long-term & Episodic Memory Systems

Memory is the missing piece that transforms a stateless language model into a persistent, learning agent. While LLMs possess vast parametric knowledge, they have no native ability to remember past interactions, learn from experience, or maintain state across sessions. This article examines the architecture of agent memory systems -- from working memory within the context window, to long-term storage via vector databases, to episodic memory that enables agents to learn from their own histories -- drawing on research from MemGPT, Generative Agents, and production memory architectures.

## The Memory Problem

Every LLM interaction starts from scratch. The model has no recollection of previous conversations, no ability to update its knowledge based on new information, and no mechanism to learn from mistakes. This fundamental limitation creates several practical problems:

**Context loss across sessions.** A coding assistant that helped debug an issue yesterday cannot remember the codebase structure, the user's preferences, or the solution approaches that were already tried.

**Inability to learn from experience.** An agent that makes the same mistake repeatedly -- calling a deprecated API, generating code with a known bug pattern -- cannot self-correct without explicit memory of past failures.

**Context window constraints.** Even within a single session, the finite context window means that early information is either truncated or compressed, losing potentially important details.

These problems have driven the development of explicit memory architectures that augment LLMs with structured storage and retrieval capabilities.

## Working Memory: The Context Window

### The Context Window as RAM

The most immediate form of agent memory is the context window itself. Like working memory in cognitive science (Baddeley, 1992) or RAM in a computer, the context window holds currently relevant information that the model can directly attend to.

Modern context windows range from 8K to 2M tokens, but effective use of this space requires careful management. Research consistently shows that models perform best when relevant information is positioned at the beginning or end of the context (Liu et al., 2023, "Lost in the Middle"), and that performance degrades as the context fills with irrelevant content. For a systematic treatment of context budgeting, information ordering, and assembly patterns, see [Context Engineering](/context-engineering).

### Context Window Management Strategies

**Sliding window with summarization.** As the conversation grows, summarize older messages and keep only the summary plus recent messages:

```python
class SlidingWindowMemory:
    def __init__(self, llm, max_tokens=8000, summary_threshold=6000):
        self.llm = llm
        self.max_tokens = max_tokens
        self.summary_threshold = summary_threshold
        self.messages = []
        self.running_summary = ""

    def add_message(self, message):
        self.messages.append(message)
        if self._estimate_tokens() > self.summary_threshold:
            self._compress()

    def _compress(self):
        # Summarize older messages
        older_messages = self.messages[:-4]  # Keep last 4 messages intact
        summary_input = self.running_summary + "\n" + format_messages(older_messages)
        self.running_summary = self.llm.generate(
            f"Summarize this conversation history concisely, preserving key facts, "
            f"decisions, and context:\n{summary_input}"
        )
        self.messages = self.messages[-4:]

    def get_context(self):
        context = []
        if self.running_summary:
            context.append({
                "role": "system",
                "content": f"Conversation summary so far:\n{self.running_summary}"
            })
        context.extend(self.messages)
        return context
```

**Priority-based context allocation.** Not all information deserves equal space in the context window. Allocate based on relevance and recency:

```python
class PriorityContextManager:
    def __init__(self, max_tokens=8000):
        self.max_tokens = max_tokens
        self.segments = []  # (priority, content, token_count)

    def add_segment(self, content, priority, token_count):
        self.segments.append((priority, content, token_count))

    def build_context(self):
        # Sort by priority (highest first)
        sorted_segments = sorted(self.segments, key=lambda x: -x[0])

        context = []
        remaining_tokens = self.max_tokens
        for priority, content, tokens in sorted_segments:
            if tokens <= remaining_tokens:
                context.append(content)
                remaining_tokens -= tokens

        return "\n\n".join(context)
```

**Token budget allocation.** Divide the context window into regions with token budgets:

```
System prompt:      ~500 tokens (fixed)
Memory/context:     ~2000 tokens (retrieved)
Conversation:       ~4000 tokens (recent messages)
Tool definitions:   ~1000 tokens (fixed)
Response headroom:  ~500 tokens (reserved for output)
```

## Long-Term Memory with Vector Stores

### Architecture Overview

Long-term memory systems store information persistently and retrieve relevant items using semantic similarity. The embedding step is covered in depth in [Article 13 -- Embedding Models](/embedding-models), the vector storage layer in [Article 14 -- Vector Databases](/vector-databases), and the chunking decisions that determine memory granularity in [Article 15 -- Chunking Strategies](/chunking-strategies). The basic architecture:

```
[Agent generates response] → [Memory extraction] → [Embedding] → [Vector store]
                                                                        ↑
[Agent receives query] → [Query embedding] → [Similarity search] ———————+
                                                                        ↓
                                                                [Retrieved memories]
                                                                        ↓
                                                            [Injected into context]
```

### Implementation

```python
import numpy as np
from datetime import datetime

class LongTermMemory:
    def __init__(self, embedding_model, vector_store):
        self.embedding_model = embedding_model
        self.vector_store = vector_store

    async def store(self, content: str, metadata: dict = None):
        """Store a memory with embedding and metadata."""
        embedding = await self.embedding_model.embed(content)
        memory = {
            "content": content,
            "embedding": embedding,
            "timestamp": datetime.now().isoformat(),
            "access_count": 0,
            **(metadata or {})
        }
        await self.vector_store.upsert(memory)

    async def retrieve(self, query: str, top_k: int = 5,
                       filters: dict = None) -> list:
        """Retrieve memories relevant to the query."""
        query_embedding = await self.embedding_model.embed(query)
        results = await self.vector_store.search(
            query_embedding, top_k=top_k, filters=filters
        )

        # Update access counts for retrieved memories
        for result in results:
            result["access_count"] += 1
            await self.vector_store.update(result["id"],
                                           {"access_count": result["access_count"]})

        return results

    async def forget(self, memory_id: str):
        """Explicitly forget a memory."""
        await self.vector_store.delete(memory_id)
```

### Memory Extraction

Not everything in a conversation should be stored. Effective memory systems extract salient information:

```python
class MemoryExtractor:
    def __init__(self, llm):
        self.llm = llm

    async def extract_memories(self, conversation_turn: str) -> list[str]:
        """Extract memorable facts from a conversation turn."""
        response = await self.llm.generate(
            f"Extract important facts, preferences, and decisions from this "
            f"conversation that would be useful to remember in future interactions. "
            f"Return each fact as a separate line. Only include genuinely important "
            f"information, not trivial details.\n\n"
            f"Conversation:\n{conversation_turn}\n\n"
            f"Important facts to remember:"
        )
        memories = [line.strip() for line in response.split("\n") if line.strip()]
        return memories
```

### Retrieval Strategies

Simple cosine similarity retrieval often returns reasonable results, but more sophisticated strategies improve recall:

**Hybrid retrieval** combines semantic search with keyword matching:

```python
async def hybrid_retrieve(query, vector_store, keyword_index, top_k=5):
    # Semantic search
    semantic_results = await vector_store.search(query, top_k=top_k * 2)

    # Keyword search
    keywords = extract_keywords(query)
    keyword_results = await keyword_index.search(keywords, top_k=top_k * 2)

    # Reciprocal rank fusion
    combined = reciprocal_rank_fusion(semantic_results, keyword_results)
    return combined[:top_k]
```

**Recency-weighted retrieval** gives preference to more recent memories:

```python
def recency_weighted_score(similarity: float, timestamp: datetime,
                           decay_rate: float = 0.995) -> float:
    """Exponentially decay older memories."""
    hours_ago = (datetime.now() - timestamp).total_seconds() / 3600
    recency_weight = decay_rate ** hours_ago
    return similarity * 0.7 + recency_weight * 0.3
```

**Importance-weighted retrieval** considers how "important" a memory is:

```python
async def importance_weighted_retrieve(query, memories, llm):
    # First, get semantic matches
    candidates = await semantic_search(query, memories, top_k=20)

    # Then score importance
    for memory in candidates:
        if "importance_score" not in memory:
            score = await llm.generate(
                f"On a scale of 1-10, how important is this memory for an AI "
                f"assistant to remember? Only give the number.\n"
                f"Memory: {memory['content']}"
            )
            memory["importance_score"] = int(score.strip()) / 10

    # Combine similarity and importance
    for m in candidates:
        m["final_score"] = m["similarity"] * 0.6 + m["importance_score"] * 0.4

    candidates.sort(key=lambda x: -x["final_score"])
    return candidates[:5]
```

## MemGPT and Letta: OS-Inspired Memory Management

### The Virtual Context Window

MemGPT (Packer et al., 2023, "MemGPT: Towards LLMs as Operating Systems") draws an analogy between LLM context window management and operating system virtual memory. Just as an OS pages memory between RAM and disk, MemGPT pages information between the context window (fast, limited) and external storage (slow, unlimited). The MemGPT research project has since evolved into the open-source **Letta** framework (letta.com), which provides a production-ready implementation of these ideas with a stateful agent server, tool-based memory management, and multi-model support. Letta preserves the core MemGPT principles -- self-directed memory editing, tiered storage, and inner monologue -- while adding deployment primitives like REST APIs, agent orchestration, and persistent state management.

The key insight is that the LLM itself should control what is in the context window, using function calls to manage its own memory. This approach fits naturally into the tool-use agent architectures discussed in [Article 26 -- Agent Architectures](/agent-architectures), where memory operations become just another set of tools in the agent's repertoire:

```python
class MemGPTAgent:
    def __init__(self, llm, core_memory_limit=2000,
                 recall_memory_limit=5000):
        self.llm = llm
        self.core_memory = CoreMemory(limit=core_memory_limit)
        self.recall_memory = RecallMemory()
        self.archival_memory = ArchivalMemory()

    def get_memory_tools(self):
        return [
            {
                "name": "core_memory_append",
                "description": "Append important information to core memory. "
                               "Core memory is ALWAYS in your context.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "section": {"type": "string",
                                    "enum": ["user_info", "agent_info", "notes"]},
                        "content": {"type": "string"}
                    },
                    "required": ["section", "content"]
                }
            },
            {
                "name": "core_memory_replace",
                "description": "Replace information in core memory.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "section": {"type": "string"},
                        "old_content": {"type": "string"},
                        "new_content": {"type": "string"}
                    },
                    "required": ["section", "old_content", "new_content"]
                }
            },
            {
                "name": "archival_memory_insert",
                "description": "Store information in archival memory for "
                               "long-term storage. Use for information that "
                               "might be useful later but doesn't need to be "
                               "in context now.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "content": {"type": "string"}
                    },
                    "required": ["content"]
                }
            },
            {
                "name": "archival_memory_search",
                "description": "Search archival memory for relevant information.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string"},
                        "top_k": {"type": "integer", "default": 5}
                    },
                    "required": ["query"]
                }
            },
            {
                "name": "conversation_search",
                "description": "Search past conversation history.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string"},
                        "top_k": {"type": "integer", "default": 5}
                    },
                    "required": ["query"]
                }
            }
        ]
```

### Memory Hierarchy

MemGPT defines three memory tiers:

1. **Core Memory** (~2K tokens): Always present in the context. Contains essential user information, agent personality, and key facts. The agent explicitly manages this through append/replace operations.

2. **Recall Memory**: The conversation history, stored externally and searchable. The agent can search past conversations when it needs to recall earlier discussions.

3. **Archival Memory**: Long-term storage for any information the agent wants to preserve. Unlimited capacity, retrieved via semantic search.

This hierarchy mirrors the human memory distinction between working memory (actively held), episodic memory (past experiences), and semantic memory (factual knowledge).

### Self-Directed Memory Management

The most innovative aspect of MemGPT is that the agent decides when to read from and write to memory. This is implemented through an inner monologue loop:

```python
async def memgpt_loop(self, user_message):
    # The agent may make multiple memory operations before responding
    while True:
        response = await self.llm.generate(
            messages=self._build_context(user_message),
            tools=self.get_memory_tools() + [send_message_tool]
        )

        if response.tool_call.name == "send_message":
            # Agent has decided to respond to the user
            return response.tool_call.arguments["message"]

        # Agent is performing a memory operation
        result = await self._execute_memory_tool(response.tool_call)
        # Continue the loop -- agent may do more memory ops
```

This means the agent might perform several memory reads and writes before producing a visible response, much like a person pausing to think and remember before answering a question.

## Episodic Memory: Learning from Experience

### What is Episodic Memory?

Episodic memory stores records of specific events or experiences, including the context, actions taken, and outcomes. For agents, this means remembering not just facts but entire trajectories: what was tried, what worked, and what failed.

```python
@dataclass
class Episode:
    task: str
    trajectory: list[dict]  # sequence of (thought, action, observation)
    outcome: str  # success, failure, partial
    reflection: str  # what was learned
    timestamp: datetime
    metadata: dict

class EpisodicMemory:
    def __init__(self, vector_store, embedding_model):
        self.store = vector_store
        self.embedder = embedding_model

    async def record_episode(self, task, trajectory, outcome, reflection):
        episode = Episode(
            task=task,
            trajectory=trajectory,
            outcome=outcome,
            reflection=reflection,
            timestamp=datetime.now(),
            metadata={"task_type": classify_task(task)}
        )
        embedding = await self.embedder.embed(
            f"{task} | {outcome} | {reflection}"
        )
        await self.store.upsert({
            "embedding": embedding,
            "episode": episode.__dict__
        })

    async def recall_similar_episodes(self, current_task, top_k=3):
        embedding = await self.embedder.embed(current_task)
        results = await self.store.search(embedding, top_k=top_k)
        return [r["episode"] for r in results]
```

### Using Episodic Memory in Agent Loops

When an agent encounters a new task, it can recall similar past episodes to inform its approach:

```python
class EpisodicAgent:
    def __init__(self, llm, tools, episodic_memory):
        self.llm = llm
        self.tools = tools
        self.memory = episodic_memory

    async def run(self, task: str) -> str:
        # Recall relevant past episodes
        episodes = await self.memory.recall_similar_episodes(task)

        # Format episodes as context
        episode_context = ""
        for ep in episodes:
            episode_context += (
                f"Past task: {ep['task']}\n"
                f"Outcome: {ep['outcome']}\n"
                f"Lesson learned: {ep['reflection']}\n\n"
            )

        # Run agent with episodic context
        system_prompt = (
            f"You are an AI assistant. Here are relevant past experiences:\n"
            f"{episode_context}\n"
            f"Use these lessons to inform your approach to the current task."
        )

        trajectory = await self._execute_task(task, system_prompt)
        outcome = evaluate_outcome(trajectory)

        # Generate reflection and store episode
        reflection = await self.llm.generate(
            f"Task: {task}\nTrajectory: {trajectory}\nOutcome: {outcome}\n"
            f"What worked well? What should be done differently next time?"
        )
        await self.memory.record_episode(task, trajectory, outcome, reflection)

        return trajectory.final_answer
```

### Generative Agents Memory Architecture

Park et al. (2023) designed a sophisticated memory system for believable agent simulations that has influenced practical agent memory design. Their architecture includes three key operations:

**1. Memory Stream:** A comprehensive, append-only log of all observations:

```python
class MemoryStream:
    def __init__(self):
        self.observations = []

    def add_observation(self, description, timestamp,
                        importance=None, embedding=None):
        self.observations.append({
            "description": description,
            "timestamp": timestamp,
            "importance": importance or self._rate_importance(description),
            "embedding": embedding,
            "last_accessed": timestamp
        })
```

**2. Retrieval Function** scoring by recency, importance, and relevance:

```python
def retrieve(self, query, current_time, top_k=10):
    query_embedding = embed(query)
    scored = []

    for obs in self.observations:
        # Recency: exponential decay
        hours_ago = (current_time - obs["timestamp"]).total_seconds() / 3600
        recency = 0.99 ** hours_ago

        # Importance: pre-rated on [0, 1]
        importance = obs["importance"]

        # Relevance: cosine similarity to query
        relevance = cosine_similarity(query_embedding, obs["embedding"])

        # Combined score (weights tuned empirically)
        score = recency * 1.0 + importance * 1.0 + relevance * 1.0
        scored.append((obs, score))

    scored.sort(key=lambda x: -x[1])
    return [obs for obs, _ in scored[:top_k]]
```

**3. Reflection:** Periodically synthesizing higher-level insights:

```python
async def reflect(self, recent_observations, llm):
    """Generate higher-level reflections from recent observations."""
    observations_text = "\n".join(
        [f"- {obs['description']}" for obs in recent_observations]
    )

    # Generate questions worth reflecting on
    questions = await llm.generate(
        f"Given these recent observations, what are 3 high-level questions "
        f"worth reflecting on?\n{observations_text}"
    )

    reflections = []
    for question in parse_questions(questions):
        relevant = self.retrieve(question, datetime.now(), top_k=10)
        reflection = await llm.generate(
            f"Based on these observations, provide a high-level insight:\n"
            + "\n".join([f"- {r['description']}" for r in relevant])
        )
        reflections.append({
            "description": reflection,
            "type": "reflection",
            "importance": 0.8,  # Reflections are high importance
            "sources": [r["id"] for r in relevant]
        })

    return reflections
```

## Summarization-Based Memory Compression

### Progressive Summarization

As conversations grow long, progressive summarization maintains the essential information while reducing token count:

```python
class ProgressiveSummarizer:
    def __init__(self, llm):
        self.llm = llm
        self.summary_levels = []  # [(summary, token_count)]

    async def add_and_compress(self, new_content: str, max_total_tokens: int):
        self.summary_levels.append((new_content, count_tokens(new_content)))

        total_tokens = sum(tc for _, tc in self.summary_levels)

        while total_tokens > max_total_tokens and len(self.summary_levels) > 1:
            # Merge the two oldest summaries
            old1 = self.summary_levels.pop(0)
            old2 = self.summary_levels.pop(0)

            merged = await self.llm.generate(
                f"Merge and compress these two summaries into one, "
                f"preserving all important information:\n\n"
                f"Summary 1:\n{old1[0]}\n\n"
                f"Summary 2:\n{old2[0]}"
            )
            merged_tokens = count_tokens(merged)
            self.summary_levels.insert(0, (merged, merged_tokens))
            total_tokens = sum(tc for _, tc in self.summary_levels)
```

### Hierarchical Summarization

For very long interactions, a tree-structured summarization approach:

```python
class HierarchicalSummary:
    def __init__(self, llm, chunk_size=10):
        self.llm = llm
        self.chunk_size = chunk_size
        self.tree = {}  # level -> list of summaries

    async def build_from_messages(self, messages: list):
        # Level 0: Raw messages chunked
        chunks = [messages[i:i+self.chunk_size]
                  for i in range(0, len(messages), self.chunk_size)]

        level = 0
        self.tree[level] = []
        for chunk in chunks:
            summary = await self.llm.generate(
                f"Summarize this conversation segment:\n{format_messages(chunk)}"
            )
            self.tree[level].append(summary)

        # Higher levels: summarize summaries
        while len(self.tree[level]) > 1:
            level += 1
            self.tree[level] = []
            for i in range(0, len(self.tree[level-1]), self.chunk_size):
                group = self.tree[level-1][i:i+self.chunk_size]
                meta_summary = await self.llm.generate(
                    f"Create a high-level summary from these summaries:\n"
                    + "\n---\n".join(group)
                )
                self.tree[level].append(meta_summary)

    def get_summary(self, detail_level="high"):
        if detail_level == "high":
            return self.tree[max(self.tree.keys())][0]
        elif detail_level == "medium":
            mid = max(self.tree.keys()) // 2
            return "\n\n".join(self.tree[mid])
        else:
            return "\n\n".join(self.tree[0])
```

## Practical Memory Architecture

A production agent memory system combines multiple memory types:

```python
class AgentMemorySystem:
    def __init__(self, llm, vector_store, kv_store):
        self.working_memory = SlidingWindowMemory(llm)
        self.long_term = LongTermMemory(embedding_model, vector_store)
        self.episodic = EpisodicMemory(vector_store, embedding_model)
        self.user_profile = kv_store  # Key-value store for user facts

    async def build_context(self, user_message: str) -> list:
        context = []

        # 1. User profile (always present, like MemGPT core memory)
        profile = await self.user_profile.get_all()
        if profile:
            context.append({"role": "system",
                           "content": f"User profile: {profile}"})

        # 2. Relevant long-term memories
        memories = await self.long_term.retrieve(user_message, top_k=5)
        if memories:
            memory_text = "\n".join([m["content"] for m in memories])
            context.append({"role": "system",
                           "content": f"Relevant memories:\n{memory_text}"})

        # 3. Similar past episodes
        episodes = await self.episodic.recall_similar_episodes(user_message)
        if episodes:
            ep_text = "\n".join([
                f"Past: {e['task']} -> {e['reflection']}" for e in episodes
            ])
            context.append({"role": "system",
                           "content": f"Past experience:\n{ep_text}"})

        # 4. Working memory (recent conversation)
        context.extend(self.working_memory.get_context())

        return context
```

## Memory Privacy and Safety

Persistent agent memory introduces obligations that do not exist in stateless systems. When an agent remembers a user's medical condition, financial situation, or personal relationships across sessions, it becomes a data controller -- subject to privacy law and to the user's reasonable expectations about what happens to their information.

### PII Detection and Filtering

The first line of defense is detecting personally identifiable information before it enters long-term storage. A practical pipeline runs extraction candidates through a PII classifier before committing them:

```python
class PrivacyAwareMemoryExtractor:
    def __init__(self, llm, pii_detector):
        self.llm = llm
        self.pii_detector = pii_detector
        self.sensitive_categories = {
            "SSN", "credit_card", "bank_account",
            "medical_record", "password", "API_key"
        }

    async def extract_and_filter(self, conversation_turn: str) -> list[str]:
        """Extract memories, then strip or redact PII."""
        raw_memories = await self._extract_memories(conversation_turn)
        filtered = []
        for memory in raw_memories:
            detections = self.pii_detector.detect(memory)
            # Block storage of high-risk PII categories entirely
            high_risk = [d for d in detections
                         if d.category in self.sensitive_categories]
            if high_risk:
                continue
            # Redact moderate-risk PII (names, emails, phone numbers)
            redacted = self.pii_detector.redact(memory)
            filtered.append(redacted)
        return filtered
```

Off-the-shelf PII detectors like Microsoft Presidio, spaCy's entity recognizer, or cloud-based services (Google DLP, AWS Comprehend) can be slotted into this pipeline. The critical design decision is choosing between **redaction** (replacing "John Smith" with "[PERSON]") and **blocking** (refusing to store the memory at all). Redaction preserves structural information but may leak identity through context; blocking is safer but loses potentially useful memories.

### Data Retention and the Right to Be Forgotten

GDPR Article 17, CCPA, and similar regulations grant users the right to request deletion of their personal data. For agent memory systems, this means:

**Retention policies.** Memories should carry a time-to-live (TTL) that triggers automatic deletion. User preference memories might persist for a year; task-specific context might expire after 30 days. The retention policy should be transparent and configurable:

```python
class RetentionPolicy:
    DEFAULT_TTL = {
        "user_preference": timedelta(days=365),
        "task_context": timedelta(days=30),
        "conversation_summary": timedelta(days=90),
        "episodic": timedelta(days=180),
    }

    def should_retain(self, memory: dict) -> bool:
        category = memory.get("category", "task_context")
        ttl = self.DEFAULT_TTL.get(category, timedelta(days=30))
        created = datetime.fromisoformat(memory["timestamp"])
        return datetime.now() - created < ttl
```

**Deletion propagation.** When a user requests deletion, the system must remove not just the raw memory but also any embeddings, summaries that incorporated the memory, and reflection-level insights derived from it. This is particularly challenging for summarization-based compression, where the original source is already merged into a higher-level summary. One practical approach is maintaining a provenance chain -- each summary tracks the memory IDs it was derived from, allowing cascade deletion and re-summarization from remaining sources.

**User controls.** Production systems should expose explicit memory management to users: the ability to view what the agent remembers, delete specific memories, pause memory collection entirely, and export stored data. These are not optional features for systems operating under GDPR -- they are legal requirements.

### Scope Boundaries

Not every piece of information from a conversation should be eligible for long-term storage. Agents should distinguish between **operational context** (needed to complete the current task) and **persistent memory** (worth retaining across sessions). A user asking "my password is hunter2, please log in" is providing operational context, not something to remember. Defining and enforcing these scope boundaries -- through classification models, explicit user consent signals, or conservative defaults -- is a foundational design choice that shapes the entire memory system.

## Graph-Based Memory

Vector stores excel at "find memories similar to this query," but some relationships between memories are structural rather than semantic. A user's team hierarchy, a project's dependency chain, or the causal links between past decisions are better represented as graphs than as points in embedding space.

### When Graphs Outperform Vectors

Vector similarity search answers the question: "What memories are semantically close to this query?" Graph traversal answers a different question: "What is connected to this memory, and how?" The distinction matters in several scenarios:

**Multi-hop reasoning.** "What constraints did we agree on for the API that the billing service depends on?" requires traversing a chain: billing service -> depends on -> payments API -> has constraint -> rate limit. Vector search would need to retrieve the right memory directly; graph traversal follows the relationship chain.

**Temporal and causal chains.** "Why did we switch from PostgreSQL to DynamoDB?" involves a sequence of decisions, each motivated by the previous outcome. Graph edges with typed relationships (caused_by, led_to, replaced) capture this structure naturally.

**Entity-centric recall.** "Everything the agent knows about Project Atlas" is a simple graph query (all nodes connected to the Project Atlas entity) but a fragile vector search (depends on the embedding model placing all Atlas-related memories close together).

### Implementation Approaches

**In-memory property graphs** work well for agents with moderate memory sizes (thousands to tens of thousands of memories). Libraries like NetworkX in Python, or lightweight embedded stores like Kuzu, provide graph operations without infrastructure overhead:

```python
import networkx as nx

class GraphMemory:
    def __init__(self):
        self.graph = nx.DiGraph()

    def add_memory(self, memory_id: str, content: str, metadata: dict):
        self.graph.add_node(memory_id, content=content, **metadata)

    def add_relationship(self, source_id: str, target_id: str,
                         relation: str, properties: dict = None):
        self.graph.add_edge(source_id, target_id,
                            relation=relation, **(properties or {}))

    def get_related(self, memory_id: str, relation: str = None,
                    max_depth: int = 2) -> list[dict]:
        """Traverse the graph from a memory node."""
        if relation:
            # Follow only specific relationship types
            neighbors = [
                (target, data)
                for _, target, data in self.graph.edges(memory_id, data=True)
                if data.get("relation") == relation
            ]
        else:
            neighbors = [
                (target, data)
                for _, target, data in self.graph.edges(memory_id, data=True)
            ]

        results = []
        for target_id, edge_data in neighbors:
            node_data = self.graph.nodes[target_id]
            results.append({
                "id": target_id,
                "content": node_data.get("content"),
                "relation": edge_data.get("relation"),
            })
            # Recursive traversal for multi-hop
            if max_depth > 1:
                results.extend(
                    self.get_related(target_id, relation, max_depth - 1)
                )
        return results
```

**Dedicated graph databases** like Neo4j become worthwhile when the memory graph is large, the query patterns are complex, or multiple agents share a knowledge graph. Neo4j's Cypher query language makes multi-hop traversal concise:

```cypher
// Find all constraints on services that project Atlas depends on
MATCH (p:Project {name: "Atlas"})-[:DEPENDS_ON]->(s:Service)-[:HAS_CONSTRAINT]->(c:Constraint)
RETURN s.name, c.description, c.created_at
ORDER BY c.created_at DESC
```

### Hybrid: Graph + Vector

The most effective production architectures combine both approaches. Vector search handles open-ended retrieval ("find relevant memories"), while graph traversal handles structured follow-up ("now show me everything connected to this result"). A practical pattern is to use vector search for initial retrieval, then expand results by traversing graph edges from the retrieved nodes:

```python
class HybridMemoryStore:
    def __init__(self, vector_store, graph_memory, embedding_model):
        self.vectors = vector_store
        self.graph = graph_memory
        self.embedder = embedding_model

    async def retrieve(self, query: str, top_k: int = 5,
                       expand_depth: int = 1) -> list[dict]:
        # Phase 1: Vector retrieval for semantic matches
        query_embedding = await self.embedder.embed(query)
        seed_results = await self.vectors.search(query_embedding, top_k=top_k)

        # Phase 2: Graph expansion from seed results
        expanded = []
        seen_ids = {r["id"] for r in seed_results}
        for result in seed_results:
            related = self.graph.get_related(
                result["id"], max_depth=expand_depth
            )
            for rel in related:
                if rel["id"] not in seen_ids:
                    expanded.append(rel)
                    seen_ids.add(rel["id"])

        return seed_results + expanded
```

This hybrid model is especially valuable for agents that operate over structured domains -- project management, codebases, organizational knowledge -- where entities have explicit relationships that pure semantic similarity cannot capture. For the underlying vector storage patterns, see [Article 14 -- Vector Databases](/vector-databases).

## Memory Evaluation

Building a memory system is straightforward; knowing whether it actually helps is harder. Without deliberate measurement, teams often ship memory features that consume storage and latency budgets without improving agent outcomes.

### Retrieval Quality Metrics

The most direct evaluation targets the retrieval step: does the system return the right memories at the right time?

**Precision and recall at k.** Given a set of queries with known-relevant memories, measure how many of the top-k results are relevant (precision@k) and what fraction of all relevant memories appear in the top k (recall@k). For agent memory, recall is typically more important than precision -- a missed memory can cause a wrong answer, while an extra irrelevant memory in the context merely wastes tokens.

**Mean Reciprocal Rank (MRR).** Where does the first relevant memory appear in the ranked results? MRR penalizes systems that bury the right answer at position 5 instead of position 1. This is particularly important for agents with tight context budgets where only the top 2-3 memories are actually injected.

**Retrieval latency.** Memory retrieval adds latency to every agent turn. Track p50 and p99 retrieval times. For interactive agents, retrieval should complete within 100-200ms; anything slower degrades the user experience noticeably.

### Task Performance Metrics

Retrieval quality is a proxy -- the real question is whether memory improves the agent's ability to complete tasks.

**With-and-without comparison.** Run the same agent on a benchmark with memory enabled and disabled. The performance delta (accuracy, task completion rate, user satisfaction) quantifies the value of the memory system. If memory does not measurably improve outcomes, it is adding complexity without benefit.

**Personalization accuracy.** For user-facing agents, test whether the agent correctly recalls and applies user preferences. Create test scenarios where the user stated a preference in a prior session ("I prefer TypeScript over JavaScript") and measure whether the agent respects it in a later session.

**Redundant failure rate.** Track how often the agent repeats a mistake it has already encountered and stored. If the episodic memory is working, this rate should be near zero for known failure patterns.

### Information Decay Analysis

Memory systems lose information over time through summarization compression, TTL expiration, and embedding drift. Measuring this decay is essential for tuning retention policies.

**Fact survival rate.** Inject known facts into the memory system and test retrieval at intervals (1 day, 1 week, 1 month). The fraction of facts still retrievable at each interval is the survival curve. A steep drop-off indicates overly aggressive compression or short TTLs.

**Summarization fidelity.** When memories are compressed through summarization, measure what percentage of key facts from the original content are preserved in the summary. An automated approach uses an LLM to extract facts from the original and the summary, then computes the overlap:

```python
async def measure_summarization_fidelity(original: str, summary: str,
                                          llm) -> float:
    original_facts = await llm.generate(
        f"List every distinct fact stated in this text, one per line:\n{original}"
    )
    summary_facts = await llm.generate(
        f"List every distinct fact stated in this text, one per line:\n{summary}"
    )

    original_set = set(original_facts.strip().split("\n"))
    preserved = 0
    for fact in original_set:
        is_present = await llm.generate(
            f"Is the following fact present (even if paraphrased) in this list?\n"
            f"Fact: {fact}\n"
            f"List:\n{summary_facts}\n"
            f"Answer YES or NO."
        )
        if "YES" in is_present.upper():
            preserved += 1

    return preserved / len(original_set) if original_set else 1.0
```

**Memory utilization.** Track what fraction of stored memories are ever retrieved. A large store where 90% of memories are never accessed suggests the extraction pipeline is storing too aggressively or the retrieval mechanism is too narrow. Both waste resources.

### Evaluation Cadence

Memory evaluation should not be a one-time exercise. As the agent's user base grows and usage patterns shift, memory system performance drifts. Establish a recurring evaluation cadence -- monthly retrieval quality benchmarks, quarterly task performance comparisons, and continuous monitoring of retrieval latency and memory store size. The cost of over-engineering memory is real (latency, storage, complexity), and regular evaluation is the only reliable way to know whether your memory system is earning its keep.

## Summary and Key Takeaways

- **Working memory (context window)** is the most immediate form of agent memory. Manage it actively through sliding window summarization, priority-based allocation, and token budgeting. Do not let it fill with irrelevant content.
- **Long-term memory via vector stores** provides persistent, semantically-searchable storage. Effective retrieval requires more than cosine similarity -- incorporate recency, importance, and access frequency into scoring.
- **MemGPT's self-directed memory management** (now productionized as the Letta framework) is a paradigm shift: the agent controls its own memory through function calls, deciding what to store, retrieve, and forget. This mirrors how humans manage attention and memory.
- **Episodic memory** enables agents to learn from experience by storing task trajectories with outcomes and reflections. This is particularly valuable for iterative tasks where the same failure patterns recur.
- **The Generative Agents memory architecture** (Park et al., 2023) provides a robust three-part framework: memory stream for recording, retrieval by recency/importance/relevance, and reflection for higher-level synthesis.
- **Summarization-based compression** is essential for long-running agents. Progressive and hierarchical summarization maintain information density while respecting token budgets.
- **Production memory systems combine multiple memory types**, each serving a different purpose. The architecture should match the application's needs: user-facing assistants need user profiles and preferences; task agents need episodic memory; research agents need expansive long-term storage.
- **Memory privacy is not optional.** PII detection, data retention policies, deletion propagation, and user-facing controls are legal requirements under GDPR and similar regulations. Design these into the memory pipeline from the start, not as afterthoughts.
- **Graph-based memory complements vector stores** for domains with structured relationships. Use vector search for open-ended semantic retrieval and graph traversal for multi-hop reasoning, entity-centric recall, and causal chains. The most effective architectures combine both.
- **Measure whether memory actually helps.** Track retrieval precision and recall, task performance with and without memory, information decay over time, and memory utilization rates. A memory system that does not measurably improve agent outcomes is adding complexity without benefit.
- **Memory is not just storage -- it is retrieval.** The quality of an agent's memory system depends more on how effectively it retrieves relevant information than on how much it stores.
