# Context Engineering: Designing What LLMs See

Context engineering has emerged as the defining discipline of applied AI engineering -- the systematic practice of designing, assembling, and managing everything that goes into a language model's context window at inference time. While prompt engineering focuses on crafting instructions and examples, context engineering encompasses the broader architectural challenge: deciding what information the model needs, where that information comes from, how it's formatted and ordered, and how to manage the finite budget of tokens available. This article examines context engineering from first principles, covering context window mechanics, information architecture, retrieval-driven context assembly, and the production patterns that separate brittle prototypes from reliable systems.

The term gained wide adoption after Andrej Karpathy's observation that "the hottest new programming language is English" evolved into a more precise framing: the real skill is not writing prompts but engineering the full context that surrounds them. Tobi Lutke (Shopify CEO) and others have described context engineering as "the art of providing all the information and tools an LLM needs to successfully accomplish a task." This reflects a maturation of the field -- from crafting clever single-shot prompts to designing information systems that dynamically assemble the right context for each interaction.

## Why Context Engineering Matters

### Beyond Prompt Engineering

Prompt engineering, as covered in [Prompt Engineering Fundamentals](/prompt-engineering-fundamentals), deals with how to phrase instructions, structure few-shot examples, and steer model behavior. Context engineering is the superset: it encompasses the prompt but also everything else in the context window -- retrieved documents, conversation history, tool outputs, system state, memory, and metadata.

The distinction becomes clear in production systems. A chatbot prompt might be 200 tokens, but the full context at inference time is often 4,000-32,000 tokens assembled from multiple sources:

```
┌─────────────────────────────────────────────────┐
│                  Context Window                  │
│                                                  │
│  ┌─────────────────────────────────────────┐    │
│  │ System Prompt          (~500 tokens)     │    │
│  │ - Role, personality, constraints         │    │
│  │ - Output format specifications           │    │
│  └─────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────┐    │
│  │ Retrieved Context      (~2000 tokens)    │    │
│  │ - RAG documents, knowledge base hits     │    │
│  │ - Relevant code, documentation           │    │
│  └─────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────┐    │
│  │ Conversation History   (~3000 tokens)    │    │
│  │ - Prior messages (possibly summarized)   │    │
│  │ - Tool call results from prior turns     │    │
│  └─────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────┐    │
│  │ Tool Definitions       (~1000 tokens)    │    │
│  │ - Function schemas, descriptions         │    │
│  │ - Available actions and parameters       │    │
│  └─────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────┐    │
│  │ Current User Message   (~200 tokens)     │    │
│  │ - The actual user request                │    │
│  └─────────────────────────────────────────┘    │
│                                                  │
│  Total: ~6700 tokens of an 128K window          │
└─────────────────────────────────────────────────┘
```

Each component is a design decision. What goes in, what stays out, how it's formatted, and where it's positioned all affect model performance. Context engineering is the discipline of making these decisions well.

### The Information Bottleneck

Even with context windows reaching 128K-2M tokens, the bottleneck is not raw capacity but *effective capacity*. Research consistently demonstrates that models do not attend equally to all content in the context:

**Lost in the middle** (Liu et al., 2023): Models perform best when relevant information is at the very beginning or very end of the context. Information in the middle receives less attention, leading to degraded performance. This finding has direct architectural implications -- position your most critical context (system instructions, key constraints) at the start, and the user's current query at the end.

**Attention dilution**: As context length grows, the model's attention is distributed across more tokens. Adding irrelevant content doesn't just waste tokens -- it actively degrades performance on the relevant content. A 4K context with precisely relevant information often outperforms a 32K context padded with tangentially related content.

**Reasoning capacity trade-offs**: Tokens spent on context are tokens not available for reasoning (in the output). For complex tasks requiring extended chain-of-thought reasoning, reserving output token budget matters as much as curating input context.

## The Context Engineering Stack

A production context engineering system has distinct layers, each with its own design considerations:

### Layer 1: Static Context (System Prompt)

The system prompt is the foundation -- the context that remains constant across all interactions within an application. Effective system prompts follow the principles covered in [System Prompt Design](/system-prompts), but context engineering adds the perspective of *budget allocation*: how many of your total tokens should be devoted to static instructions versus dynamic content?

**Design heuristic**: System prompts should consume no more than 10-15% of your effective context budget. If your system prompt is 3,000 tokens and your effective context is 8,000 tokens, you've already consumed 37% on static instructions, leaving limited room for retrieved context and conversation history.

```python
# Context budget planning
CONTEXT_BUDGET = {
    "system_prompt": 800,        # 10% -- role, constraints, format
    "retrieved_context": 3200,   # 40% -- RAG results, knowledge
    "conversation_history": 2400, # 30% -- recent messages + summary
    "tool_definitions": 800,     # 10% -- available tools/functions
    "user_message": 400,         # 5%  -- current request
    "safety_margin": 400,        # 5%  -- buffer for tokenization variance
}
# Total: 8000 tokens of a 128K window
# Remaining capacity reserved for model output
```

### Layer 2: Dynamic Retrieval Context

The most impactful layer for most applications. Dynamic context is assembled at query time from external sources -- vector databases, search indices, knowledge bases, APIs, or databases. This is where context engineering intersects with RAG (see [Retrieval Strategies](/retrieval-strategies) and [Advanced RAG](/advanced-rag)).

Key design decisions:

**What to retrieve**: Not all queries need retrieval. A classification step or embedding similarity threshold can determine whether retrieved context would help or hurt. Unnecessary retrieval adds latency and potentially dilutes the context.

**How much to retrieve**: More isn't better. Retrieving 20 chunks when 3 would suffice wastes context budget and dilutes attention. Conversely, retrieving too little risks missing critical information. Adaptive retrieval -- starting with a few results and expanding only if confidence is low -- often outperforms fixed-k retrieval.

**How to order retrieved results**: Given the "lost in the middle" finding, place the most relevant results first and last. Some practitioners reverse-sort by relevance (least relevant first, most relevant last) so the highest-relevance content is closest to the user message.

```python
def assemble_retrieval_context(
    query: str,
    collection,
    budget_tokens: int = 3200,
    max_results: int = 10,
    relevance_threshold: float = 0.7,
) -> str:
    """Retrieve and assemble context within a token budget."""
    results = collection.query(
        query_texts=[query],
        n_results=max_results,
    )

    # Filter by relevance threshold (Chroma returns distances, not similarities)
    filtered = []
    for doc, distance, metadata in zip(
        results["documents"][0],
        results["distances"][0],
        results["metadatas"][0],
    ):
        similarity = 1 - distance  # for cosine distance
        if similarity >= relevance_threshold:
            filtered.append({"text": doc, "similarity": similarity, "meta": metadata})

    # Sort: most relevant first (for "primacy" attention effect)
    filtered.sort(key=lambda x: x["similarity"], reverse=True)

    # Pack within token budget
    context_parts = []
    token_count = 0
    for item in filtered:
        chunk_tokens = len(item["text"].split()) * 1.3  # rough token estimate
        if token_count + chunk_tokens > budget_tokens:
            break
        source = item["meta"].get("source", "unknown")
        context_parts.append(f"[Source: {source}]\n{item['text']}")
        token_count += chunk_tokens

    return "\n\n---\n\n".join(context_parts)
```

For vector database options including Chroma, Pinecone, Qdrant, and pgvector, see [Article 14: Vector Databases](/vector-databases). For chunking strategies that affect retrieval quality, see [Article 15: Chunking Strategies](/chunking-strategies).

### Layer 3: Conversation History

Managing conversation history is a core context engineering challenge. Raw conversation histories grow without bound, and naively stuffing them into context wastes tokens on irrelevant early messages while potentially losing important context from the middle.

**Sliding window**: Keep the last N messages. Simple but loses earlier context entirely.

**Summarization**: Periodically summarize older messages, maintaining a rolling summary. See [Agent Memory](/agent-memory) for detailed implementations.

**Selective retention**: Use a model to decide which past messages are relevant to the current query, loading only those. More expensive (requires an extra LLM call) but produces the most focused context.

**Hybrid approach**: Maintain a rolling summary of the full conversation plus the last K verbatim messages:

```python
class ConversationContextManager:
    def __init__(self, max_history_tokens: int = 2400):
        self.messages = []
        self.summary = ""
        self.max_tokens = max_history_tokens

    def add_turn(self, role: str, content: str):
        self.messages.append({"role": role, "content": content})

    def get_context(self) -> list[dict]:
        """Build conversation context within budget."""
        # Always include summary if it exists
        context = []
        if self.summary:
            context.append({
                "role": "system",
                "content": f"Conversation summary:\n{self.summary}"
            })

        # Add recent messages in reverse until budget is reached
        recent = []
        token_count = len(self.summary.split()) * 1.3
        for msg in reversed(self.messages):
            msg_tokens = len(msg["content"].split()) * 1.3
            if token_count + msg_tokens > self.max_tokens:
                break
            recent.insert(0, msg)
            token_count += msg_tokens

        return context + recent

    def compress(self, summarizer):
        """Summarize older messages to free context budget."""
        if len(self.messages) <= 4:
            return
        older = self.messages[:-4]
        text = "\n".join(f"{m['role']}: {m['content']}" for m in older)
        self.summary = summarizer(
            f"Previous summary:\n{self.summary}\n\nNew messages:\n{text}\n\n"
            "Create a concise summary preserving key facts, decisions, and context."
        )
        self.messages = self.messages[-4:]
```

### Layer 4: Tool Definitions and State

For agent-based applications (see [Agent Architectures](/agent-architectures) and [Function Calling](/function-calling)), tool definitions consume context budget. Each tool schema -- name, description, parameters, examples -- can cost 100-500 tokens.

**Selective tool loading**: Don't load all 50 tools for every query. Classify the user intent first, then load only relevant tools:

```python
TOOL_GROUPS = {
    "search": ["web_search", "knowledge_base_search", "code_search"],
    "data": ["sql_query", "csv_analyze", "chart_generate"],
    "communication": ["send_email", "create_ticket", "post_message"],
    "code": ["run_code", "read_file", "write_file", "run_tests"],
}

def select_tools(user_message: str, classifier) -> list[dict]:
    """Load only relevant tool definitions based on user intent."""
    intent = classifier(user_message)  # Returns tool group names
    tools = []
    for group in intent.groups:
        tools.extend(TOOL_GROUPS.get(group, []))
    return [TOOL_SCHEMAS[t] for t in tools]
```

**Tool output truncation**: Tool call results (API responses, search results, file contents) can be arbitrarily large. Always truncate or summarize tool outputs before adding them to context:

```python
def truncate_tool_output(output: str, max_tokens: int = 1000) -> str:
    """Truncate tool output to fit within context budget."""
    words = output.split()
    if len(words) * 1.3 <= max_tokens:
        return output
    # Keep beginning and end (most informative parts)
    keep_words = int(max_tokens / 1.3)
    half = keep_words // 2
    return " ".join(words[:half]) + "\n\n[...truncated...]\n\n" + " ".join(words[-half:])
```

## Context Assembly Patterns

### Pattern 1: Static Assembly

The simplest pattern: concatenate fixed components in a predetermined order. Suitable for applications with predictable context needs.

```python
def build_static_context(system_prompt: str, user_message: str) -> list[dict]:
    return [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_message},
    ]
```

### Pattern 2: Retrieval-Augmented Assembly

The standard RAG pattern: enrich the context with retrieved documents. The context is assembled dynamically based on the user's query.

```python
def build_rag_context(
    system_prompt: str,
    user_message: str,
    retriever,
) -> list[dict]:
    retrieved = retriever.search(user_message, k=5)
    context_block = format_retrieved_docs(retrieved)

    return [
        {"role": "system", "content": system_prompt},
        {"role": "system", "content": f"Relevant context:\n{context_block}"},
        {"role": "user", "content": user_message},
    ]
```

### Pattern 3: Agentic Assembly

The context evolves across multiple reasoning steps. Each tool call produces output that becomes part of the context for the next step. This is the pattern used in agent loops (see [Agent Architectures](/agent-architectures)).

```python
def agentic_context_loop(
    system_prompt: str,
    user_message: str,
    tools: list[dict],
    max_steps: int = 10,
) -> str:
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_message},
    ]

    for step in range(max_steps):
        response = llm.chat(messages=messages, tools=tools)

        if response.finish_reason == "stop":
            return response.content

        # Execute tool calls and add results to context
        for tool_call in response.tool_calls:
            result = execute_tool(tool_call)
            messages.append({"role": "assistant", "content": None, "tool_calls": [tool_call]})
            messages.append({
                "role": "tool",
                "tool_call_id": tool_call.id,
                "content": truncate_tool_output(str(result)),
            })

    return "Max steps reached."
```

### Pattern 4: Multi-Source Assembly

Complex applications pull context from multiple sources -- databases, APIs, vector stores, user profiles, session state -- and merge them into a unified context. This requires explicit orchestration:

```python
import asyncio

async def build_multi_source_context(
    user_message: str,
    user_id: str,
    session: dict,
    budget: dict,
) -> list[dict]:
    """Assemble context from multiple sources in parallel."""
    # Fire all retrievals concurrently
    user_profile_task = asyncio.create_task(get_user_profile(user_id))
    rag_task = asyncio.create_task(retrieve_documents(user_message, budget["retrieved"]))
    history_task = asyncio.create_task(get_conversation_history(session["id"], budget["history"]))
    tools_task = asyncio.create_task(select_tools_for_intent(user_message))

    user_profile, rag_docs, history, tools = await asyncio.gather(
        user_profile_task, rag_task, history_task, tools_task
    )

    # Assemble in optimal order for attention
    system_content = build_system_prompt(user_profile, session)
    context_content = format_retrieved_docs(rag_docs)

    messages = [
        {"role": "system", "content": system_content},
        {"role": "system", "content": f"Relevant context:\n{context_content}"},
    ]
    messages.extend(history)
    messages.append({"role": "user", "content": user_message})

    return messages, tools
```

## Context Quality Principles

### Principle 1: Relevance Over Volume

Every token in the context should earn its place. The most common context engineering mistake is including information "just in case." Irrelevant context actively harms performance through attention dilution.

**Test**: For each piece of context, ask: "Would removing this change the model's output for the worse?" If not, remove it.

### Principle 2: Recency and Freshness

Stale context is worse than no context. If your retrieved documents are outdated, the model may generate confidently wrong answers grounded in obsolete information. Context engineering must account for information freshness:

- Timestamp all retrieved context and include the timestamp in the context
- Prefer recent information when multiple sources conflict
- Implement TTLs on cached context

### Principle 3: Source Attribution

Including source metadata in context enables the model to cite sources, assess credibility, and handle conflicting information. This connects to [Hallucination Mitigation](/hallucination-mitigation) -- models with attributed sources hallucinate less.

```python
def format_with_attribution(docs: list[dict]) -> str:
    """Format documents with clear source attribution."""
    parts = []
    for i, doc in enumerate(docs, 1):
        source = doc.get("source", "unknown")
        date = doc.get("date", "unknown date")
        parts.append(f"[{i}] Source: {source} | Date: {date}\n{doc['text']}")
    return "\n\n".join(parts)
```

### Principle 4: Structured Formatting

How context is formatted affects how well the model processes it. Research and practice suggest:

- Use clear section delimiters (XML tags, markdown headers, or separator lines)
- Keep formatting consistent across context components
- Use structured formats (JSON, markdown tables) for structured data
- Avoid mixing formatting styles within the same context

```python
# Good: clearly delimited sections
context = """<system_instructions>
You are a technical support agent for Acme Cloud Platform.
</system_instructions>

<knowledge_base>
{retrieved_docs}
</knowledge_base>

<conversation_history>
{history}
</conversation_history>

<user_query>
{user_message}
</user_query>"""

# Bad: unstructured soup of text
context = f"{system_prompt}\n{retrieved_docs}\n{history}\n{user_message}"
```

### Principle 5: Context-Aware Instruction Placement

Instructions that refer to retrieved context should be placed *after* the context they reference. The model processes tokens sequentially during generation, and instructions that reference not-yet-seen content are less effective:

```python
# Better: instruction after context
messages = [
    {"role": "system", "content": "You are a helpful research assistant."},
    {"role": "system", "content": f"Reference documents:\n{context}"},
    {"role": "user", "content": (
        "Based on the reference documents above, answer this question: "
        f"{question}\n\n"
        "Cite document numbers in square brackets [1], [2], etc."
    )},
]

# Worse: instruction before context it references
messages = [
    {"role": "system", "content": (
        "You are a helpful research assistant. "
        "Cite document numbers in square brackets. "
        "Use ONLY the provided reference documents."
    )},
    {"role": "user", "content": f"{question}\n\nDocuments:\n{context}"},
]
```

## Measuring Context Quality

Context engineering decisions should be evaluated empirically, not by intuition. Key metrics:

### Context Relevance

What fraction of retrieved context is actually relevant to the query? Measured by having a judge model (or human) rate each context chunk for relevance. See [LLM-as-Judge](/llm-as-judge) for automated evaluation approaches.

```python
def evaluate_context_relevance(query: str, context_chunks: list[str], judge) -> float:
    """Score what fraction of provided context is relevant to the query."""
    relevant_count = 0
    for chunk in context_chunks:
        score = judge.evaluate(
            f"Is this context relevant to answering the query?\n"
            f"Query: {query}\nContext: {chunk}\n"
            f"Rate: relevant or irrelevant"
        )
        if score == "relevant":
            relevant_count += 1
    return relevant_count / len(context_chunks) if context_chunks else 0
```

### Context Utilization

Does the model's output actually use the provided context? Low utilization suggests the context is irrelevant or poorly positioned. High utilization with incorrect answers suggests the context itself is wrong or misleading.

### Answer Faithfulness

Does the model's answer faithfully reflect the provided context, or does it hallucinate beyond what the context supports? See [RAG Evaluation](/rag-evaluation) for detailed metrics including faithfulness, answer relevance, and context precision.

### Latency Impact

Context assembly adds latency. Retrieval, summarization, tool execution, and context formatting all take time. Measure end-to-end latency and identify which context assembly steps are bottlenecks. For optimization techniques, see [Cost Optimization](/cost-optimization) and [Inference Optimization](/inference-optimization).

## Production Context Engineering

### Caching Strategies

Context assembly is often the most expensive part of an inference pipeline (in terms of latency, not cost). Caching can dramatically reduce context assembly time:

**Prompt caching**: Many providers (Anthropic, OpenAI, Google) offer prompt caching that reduces cost and latency for repeated static prefixes. Structure your context so that the static system prompt is the prefix, followed by dynamic content.

**Retrieval caching**: Cache retrieval results for identical or similar queries. A semantic cache using embedding similarity can serve results for paraphrased queries without hitting the vector database.

**Embedding caching**: Cache embeddings for frequently queried strings to avoid repeated embedding computation.

### Context Debugging

When a model produces wrong or unexpected output, the first thing to check is the context. Build observability into your context assembly pipeline:

```python
class ContextAssembler:
    def __init__(self, logger):
        self.logger = logger

    def assemble(self, query: str, **kwargs) -> dict:
        context = {}

        # Log each component
        context["system"] = self.build_system_prompt()
        self.logger.info("system_prompt", tokens=count_tokens(context["system"]))

        context["retrieved"] = self.retrieve(query)
        self.logger.info("retrieval", count=len(context["retrieved"]),
                        tokens=count_tokens(str(context["retrieved"])))

        context["history"] = self.get_history()
        self.logger.info("history", turns=len(context["history"]),
                        tokens=count_tokens(str(context["history"])))

        total = sum(count_tokens(str(v)) for v in context.values())
        self.logger.info("context_assembled", total_tokens=total,
                        budget_utilization=total / self.budget)

        return context
```

For production observability patterns including tracing, metrics, and alerting on context quality, see [Observability](/observability).

### Iterative Refinement

Context engineering is inherently iterative. The workflow:

1. **Prototype**: Start with a simple static context. Test with representative queries.
2. **Identify failures**: When the model fails, determine whether the failure is due to missing context, irrelevant context, poor positioning, or insufficient instructions.
3. **Add retrieval**: If failures are due to missing knowledge, add RAG. Start with a vector database like Chroma for rapid iteration (see [Vector Databases](/vector-databases)).
4. **Tune retrieval**: Adjust chunk sizes, k values, relevance thresholds, and reranking strategies (see [Chunking Strategies](/chunking-strategies) and [Retrieval Strategies](/retrieval-strategies)).
5. **Manage budget**: If the context window is filling up, add summarization, selective loading, or budget-aware truncation.
6. **Evaluate**: Use automated evals (see [Eval Fundamentals](/eval-fundamentals)) to measure whether context changes improve or degrade overall quality.

## Context Engineering vs. Fine-Tuning

A common question: should you engineer better context or fine-tune the model?

**Context engineering** is the right choice when:
- The knowledge needed changes frequently (product docs, policies, prices)
- You need grounding in specific source documents with citations
- Your application requires different behavior for different contexts
- You want to iterate quickly without retraining
- The model already "knows how" to do the task but lacks specific information

**Fine-tuning** (see [Fine-Tuning Fundamentals](/fine-tuning-fundamentals)) is the right choice when:
- You need to change the model's fundamental behavior or style
- The knowledge is stable and can be baked into weights
- You need to reduce context length (and thus latency/cost) by internalizing knowledge
- The task requires specialized reasoning patterns the model doesn't exhibit with context alone

In practice, the most effective systems combine both: a fine-tuned model for base behavior and style, augmented with dynamic context for specific knowledge and current information.

## Connections to Other Topics

Context engineering sits at the intersection of several disciplines covered in this series:

- **Prompt design** ([Prompt Engineering Fundamentals](/prompt-engineering-fundamentals), [System Prompts](/system-prompts)): The static foundation of context
- **Retrieval** ([Retrieval Strategies](/retrieval-strategies), [Advanced RAG](/advanced-rag), [Vector Databases](/vector-databases)): Dynamic context sourcing
- **Memory** ([Agent Memory](/agent-memory)): Persistent context across sessions
- **Evaluation** ([Eval Fundamentals](/eval-fundamentals), [RAG Evaluation](/rag-evaluation)): Measuring context quality
- **Agents** ([Agent Architectures](/agent-architectures), [Function Calling](/function-calling)): Agentic context assembly
- **Cost** ([Cost Optimization](/cost-optimization)): Context budget management
- **Safety** ([Hallucination Mitigation](/hallucination-mitigation), [Guardrails & Filtering](/guardrails-filtering)): Context-driven safety
