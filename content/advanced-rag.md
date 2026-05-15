# Advanced RAG: Agentic, Graph-Based & Multi-Hop Retrieval

Standard RAG pipelines follow a linear retrieve-then-generate pattern that works well for single-hop factual questions but breaks down for complex information needs requiring synthesis across multiple documents, reasoning over relationships, or dynamic retrieval strategies. This article examines the frontier of RAG research and practice -- agentic retrieval that makes iterative decisions, graph-structured knowledge retrieval, and self-correcting systems that detect and recover from retrieval failures.

## The Limitations of Naive RAG

Before examining advanced patterns, it is worth understanding precisely where simple retrieve-then-generate fails.

**Single retrieval pass**: A query like "Compare the environmental policies of the EU and US regarding carbon markets" requires retrieving information about EU policies and US policies separately. A single embedding-based retrieval may return documents about one but not the other.

**No reasoning over retrieval quality**: If retrieved documents are irrelevant, the LLM either hallucinates an answer or produces a vague non-answer. There is no mechanism to recognize retrieval failure and try again with a different strategy.

**No relationship awareness**: Questions like "Which companies funded by Sequoia went public in 2023?" require understanding the relationship between funding rounds and IPO events across multiple documents. Flat retrieval treats each document independently.

**Fixed retrieval strategy**: The same embedding similarity search is applied whether the query needs a code example, a statistical fact, or a conceptual explanation. Different information types may require different retrieval approaches. For a detailed treatment of how dense and sparse retrieval methods can be combined to address this, see [Article 16: Retrieval Strategies](/retrieval-strategies).

## Agentic RAG Patterns

Agentic RAG transforms retrieval from a single function call into an iterative reasoning process where an LLM agent decides what to retrieve, evaluates the results, and adapts its strategy.

### Query Routing

The simplest agentic pattern: classify the query and route it to the appropriate retrieval pipeline.

```python
from enum import Enum
from pydantic import BaseModel

class QueryType(str, Enum):
    FACTUAL = "factual"          # Direct fact lookup
    CONCEPTUAL = "conceptual"    # Explanation/understanding
    COMPARATIVE = "comparative"  # Compare multiple entities
    PROCEDURAL = "procedural"    # How-to / step-by-step
    ANALYTICAL = "analytical"    # Requires reasoning over data

class QueryRoute(BaseModel):
    query_type: QueryType
    sub_queries: list[str]
    data_sources: list[str]

def route_query(query: str) -> QueryRoute:
    """Use an LLM to analyze and route the query."""
    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[{
            "role": "system",
            "content": """Analyze the query and determine:
            1. Query type (factual, conceptual, comparative, procedural, analytical)
            2. Sub-queries needed to fully answer it
            3. Which data sources to search (docs, code, api_reference, changelog)"""
        }, {
            "role": "user",
            "content": query
        }],
        response_format={"type": "json_object"}
    )
    return QueryRoute.model_validate_json(response.choices[0].message.content)
```

### Tool-Augmented Retrieval

A more powerful pattern gives the LLM agent access to retrieval as a tool, allowing it to make multiple retrieval calls with different queries and strategies:

```python
import json

tools = [
    {
        "type": "function",
        "function": {
            "name": "vector_search",
            "description": "Search documents by semantic similarity",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Search query"},
                    "collection": {"type": "string", "enum": ["docs", "code", "api"]},
                    "top_k": {"type": "integer", "default": 5}
                },
                "required": ["query"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "keyword_search",
            "description": "Search documents by exact keyword matching (BM25)",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                    "filters": {
                        "type": "object",
                        "properties": {
                            "date_range": {"type": "string"},
                            "category": {"type": "string"}
                        }
                    }
                },
                "required": ["query"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "lookup_entity",
            "description": "Look up a specific entity (person, company, concept) in the knowledge graph",
            "parameters": {
                "type": "object",
                "properties": {
                    "entity_name": {"type": "string"},
                    "relation_type": {"type": "string", "enum": ["all", "funded_by", "competes_with", "authored"]}
                },
                "required": ["entity_name"]
            }
        }
    }
]

async def agentic_rag(query: str, max_iterations: int = 5) -> str:
    """RAG with an agent loop -- the LLM decides what to retrieve."""
    messages = [
        {"role": "system", "content": """You are a research assistant. Use the available tools
        to find information needed to answer the user's question. Make multiple searches if needed.
        When you have sufficient information, provide a comprehensive answer with citations."""},
        {"role": "user", "content": query}
    ]

    retrieved_context = []

    for iteration in range(max_iterations):
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=messages,
            tools=tools,
            tool_choice="auto"
        )

        message = response.choices[0].message

        if message.tool_calls:
            messages.append(message)
            for tool_call in message.tool_calls:
                result = await execute_tool(tool_call)
                retrieved_context.append(result)
                messages.append({
                    "role": "tool",
                    "tool_call_id": tool_call.id,
                    "content": json.dumps(result)
                })
        else:
            # Agent has decided it has enough information
            return message.content

    return messages[-1].content if messages else "Unable to find sufficient information."
```

### Iterative Refinement

The agent can refine its retrieval strategy based on intermediate results:

1. **Initial retrieval** with the user's query
2. **Evaluate coverage**: Does the retrieved context contain enough information to answer?
3. **Gap identification**: What aspects of the question remain unanswered?
4. **Targeted follow-up**: Retrieve specifically for the identified gaps
5. **Synthesis**: Combine all retrieved information into a final answer

This mirrors how a human researcher works -- start with a broad search, identify what's missing, search specifically for those gaps.

## Graph-Based RAG

### Knowledge Graph RAG

Traditional RAG treats documents as independent entities in a flat vector space. Knowledge graph RAG adds explicit relationships between entities, enabling traversal-based retrieval.

```python
# Simple knowledge graph structure
class KnowledgeGraph:
    def __init__(self):
        self.entities = {}  # entity_id -> {name, type, description, embedding}
        self.relations = []  # (source_id, relation_type, target_id, properties)

    def add_entity(self, entity_id: str, name: str, entity_type: str, description: str):
        self.entities[entity_id] = {
            "name": name,
            "type": entity_type,
            "description": description,
            "embedding": embed(f"{name}: {description}")
        }

    def add_relation(self, source: str, relation: str, target: str, properties: dict = None):
        self.relations.append((source, relation, target, properties or {}))

    def get_neighbors(self, entity_id: str, relation_type: str = None, max_hops: int = 2):
        """Retrieve entities within max_hops of the given entity."""
        visited = set()
        frontier = {entity_id}
        results = []

        for hop in range(max_hops):
            next_frontier = set()
            for node in frontier:
                if node in visited:
                    continue
                visited.add(node)
                for source, rel, target, props in self.relations:
                    if source == node and (relation_type is None or rel == relation_type):
                        if target not in visited:
                            next_frontier.add(target)
                            results.append({
                                "entity": self.entities[target],
                                "relation": rel,
                                "from": self.entities[source]["name"],
                                "hop": hop + 1
                            })
                    elif target == node and (relation_type is None or rel == relation_type):
                        if source not in visited:
                            next_frontier.add(source)
                            results.append({
                                "entity": self.entities[source],
                                "relation": rel,
                                "from": self.entities[node]["name"],
                                "hop": hop + 1
                            })
            frontier = next_frontier

        return results
```

### Microsoft GraphRAG

Microsoft's GraphRAG (Edge et al., 2024) introduced a systematic approach to building knowledge graphs from document collections for retrieval. The process involves:

1. **Entity and relationship extraction**: Use an LLM to extract entities (people, organizations, concepts) and their relationships from each document chunk.

2. **Graph construction**: Build a graph where nodes are entities and edges are relationships, with each annotated by the source text.

3. **Community detection**: Apply the Leiden algorithm to identify clusters of closely related entities (communities).

4. **Community summarization**: Generate natural language summaries for each community, capturing the key entities, relationships, and themes at that level.

5. **Hierarchical summarization**: Build summaries at multiple levels of the community hierarchy, from specific (individual relationships) to abstract (high-level themes).

```python
# GraphRAG retrieval approaches

class GraphRAGRetriever:
    def local_search(self, query: str, top_k: int = 5):
        """
        Local search: Start from entities mentioned in the query,
        traverse the graph to find related context.
        Best for: Specific questions about particular entities.
        """
        # 1. Extract entities from query
        query_entities = self.extract_entities(query)

        # 2. Find matching entities in the graph
        matched = self.match_entities(query_entities)

        # 3. Traverse graph from matched entities
        context = []
        for entity in matched:
            neighbors = self.graph.get_neighbors(entity.id, max_hops=2)
            context.extend(neighbors)

        # 4. Retrieve source text chunks for context entities
        source_texts = self.get_source_texts(context)

        return source_texts

    def global_search(self, query: str, level: int = 1):
        """
        Global search: Use community summaries to answer broad questions.
        Best for: Thematic questions, summarization across the corpus.
        """
        # 1. Retrieve community summaries at the specified level
        summaries = self.get_community_summaries(level=level)

        # 2. Map: Generate partial answers from each relevant community
        partial_answers = []
        for summary in summaries:
            if self.is_relevant(query, summary):
                partial = self.generate_partial_answer(query, summary)
                partial_answers.append(partial)

        # 3. Reduce: Synthesize partial answers into a final answer
        final_answer = self.synthesize(query, partial_answers)

        return final_answer
```

**When GraphRAG excels**: Questions requiring understanding of relationships ("Who are the key collaborators of researcher X?"), global summarization queries ("What are the main themes in this document collection?"), and multi-entity questions ("How are companies A, B, and C related?").

**Trade-offs**: GraphRAG requires significant upfront processing (LLM calls for entity extraction and summarization), the graph must be rebuilt when documents change, and it adds complexity to the RAG pipeline. For simple factual retrieval, it's overkill.

## Multi-Hop Retrieval

Multi-hop retrieval addresses questions that cannot be answered by any single document but require connecting information across multiple sources.

### The Multi-Hop Challenge

Consider: "What is the GDP per capita of the country where the inventor of the World Wide Web was born?"

This requires:
1. Retrieve: "Tim Berners-Lee invented the World Wide Web"
2. Retrieve: "Tim Berners-Lee was born in England (United Kingdom)"
3. Retrieve: "The GDP per capita of the United Kingdom is approximately $46,000"

No single retrieval step answers the question. Each step's answer informs the next step's query.

### Iterative Retrieval with Chain-of-Thought

```python
async def multi_hop_retrieve(
    query: str,
    retriever,
    max_hops: int = 4
) -> dict:
    """Multi-hop retrieval with explicit reasoning steps."""
    context = []
    reasoning_chain = []

    current_query = query

    for hop in range(max_hops):
        # Retrieve for current query
        results = await retriever.search(current_query, top_k=3)
        context.extend(results)

        # Ask the LLM: Do we have enough to answer? If not, what's missing?
        evaluation = client.chat.completions.create(
            model="gpt-4o",
            messages=[{
                "role": "system",
                "content": """Given the original question and retrieved context, determine:
                1. Can the question be fully answered with the current context?
                2. If not, what specific information is still needed?
                3. What search query would find the missing information?

                Respond in JSON: {"answerable": bool, "missing": str, "next_query": str}"""
            }, {
                "role": "user",
                "content": f"Question: {query}\n\nContext so far:\n" +
                          "\n".join([f"[{i+1}] {r['text']}" for i, r in enumerate(context)])
            }]
        )

        eval_result = json.loads(evaluation.choices[0].message.content)
        reasoning_chain.append({
            "hop": hop + 1,
            "query": current_query,
            "found": [r["text"][:200] for r in results],
            "evaluation": eval_result
        })

        if eval_result["answerable"]:
            break

        current_query = eval_result["next_query"]

    return {
        "context": context,
        "reasoning_chain": reasoning_chain,
        "total_hops": len(reasoning_chain)
    }
```

## RAPTOR: Tree-Based Retrieval

RAPTOR (Sarthi et al., 2024) introduces a novel indexing structure that builds a tree of summaries over document chunks, enabling retrieval at multiple levels of abstraction.

### How RAPTOR Works

1. **Leaf nodes**: Chunk the document into small segments (the leaves of the tree)
2. **Clustering**: Cluster similar chunks using their embeddings (soft clustering with GMM)
3. **Summarization**: Generate summaries for each cluster using an LLM
4. **Recursion**: Treat summaries as new "documents," cluster and summarize again
5. **Repeat** until reaching a single root summary

```
                    [Root Summary]
                   /              \
          [Summary L2-A]     [Summary L2-B]
          /     |    \        /     |    \
    [Sum A1] [Sum A2] [Sum A3] [Sum B1] [Sum B2] [Sum B3]
    / | \    / | \              / | \
  [c1][c2][c3][c4][c5]      [c8][c9][c10]
```

### Retrieval Strategies

RAPTOR supports two retrieval approaches:

**Tree traversal**: Start at the root, decide which children are relevant, recurse down to find the most relevant leaf chunks. Good for focused queries.

**Collapsed tree**: Flatten all nodes (leaves + summaries at all levels) into a single index. Retrieve the most similar nodes regardless of level. A query about high-level themes might match a summary node; a detailed query might match a leaf.

```python
class RAPTORIndex:
    def __init__(self, embedding_model, llm):
        self.embedding_model = embedding_model
        self.llm = llm
        self.tree_nodes = []  # All nodes at all levels

    def build_tree(self, chunks: list[str], max_levels: int = 3):
        """Build the RAPTOR tree from leaf chunks."""
        current_level = chunks
        level = 0

        # Store leaf nodes
        for chunk in chunks:
            self.tree_nodes.append({
                "text": chunk,
                "level": 0,
                "embedding": self.embedding_model.encode(chunk)
            })

        while len(current_level) > 1 and level < max_levels:
            # Cluster current level
            embeddings = self.embedding_model.encode(current_level)
            clusters = self.cluster(embeddings, current_level)

            # Summarize each cluster
            summaries = []
            for cluster_texts in clusters:
                summary = self.summarize(cluster_texts)
                summaries.append(summary)
                self.tree_nodes.append({
                    "text": summary,
                    "level": level + 1,
                    "embedding": self.embedding_model.encode(summary),
                    "children": cluster_texts
                })

            current_level = summaries
            level += 1

    def collapsed_tree_search(self, query: str, top_k: int = 5):
        """Search across all levels of the tree."""
        query_embedding = self.embedding_model.encode(query)
        similarities = [
            (node, np.dot(query_embedding, node["embedding"]))
            for node in self.tree_nodes
        ]
        similarities.sort(key=lambda x: x[1], reverse=True)
        return [node for node, _ in similarities[:top_k]]
```

**Why RAPTOR works**: For questions requiring high-level understanding ("What are the main contributions of this paper?"), summary nodes provide pre-computed abstractions that match better than any individual chunk. For detailed questions, leaf nodes provide specifics. The tree structure enables retrieval at the right level of abstraction.

## Corrective RAG (CRAG)

Corrective RAG (Yan et al., 2024) introduces a self-evaluation mechanism that assesses the quality of retrieved documents and takes corrective action when retrieval fails.

### The CRAG Pipeline

```python
class CorrectiveRAG:
    def __init__(self, retriever, evaluator, web_searcher):
        self.retriever = retriever
        self.evaluator = evaluator
        self.web_searcher = web_searcher

    async def answer(self, query: str) -> str:
        # Step 1: Initial retrieval
        documents = await self.retriever.search(query, top_k=5)

        # Step 2: Evaluate each document's relevance
        evaluations = []
        for doc in documents:
            score = self.evaluator.evaluate_relevance(query, doc)
            evaluations.append({"doc": doc, "score": score})

        # Step 3: Triage based on evaluation
        relevant = [e for e in evaluations if e["score"] > 0.7]
        ambiguous = [e for e in evaluations if 0.3 <= e["score"] <= 0.7]
        irrelevant = [e for e in evaluations if e["score"] < 0.3]

        if len(relevant) >= 2:
            # Sufficient relevant documents -- proceed with generation
            context = [e["doc"] for e in relevant]
            action = "CORRECT"
        elif len(relevant) + len(ambiguous) >= 2:
            # Some relevant content, supplement with web search
            context = [e["doc"] for e in relevant + ambiguous]
            web_results = await self.web_searcher.search(query)
            context.extend(web_results[:3])
            action = "AMBIGUOUS"
        else:
            # Retrieval failed -- fall back to web search entirely
            context = await self.web_searcher.search(query)
            action = "INCORRECT"

        # Step 4: Knowledge refinement -- extract only relevant sentences
        refined_context = self.refine_context(query, context)

        # Step 5: Generate answer
        answer = self.generate(query, refined_context, action)
        return answer

    def refine_context(self, query: str, documents: list) -> list[str]:
        """Extract only the sentences relevant to the query from each document."""
        refined = []
        for doc in documents:
            sentences = split_sentences(doc["text"])
            relevant_sentences = [
                s for s in sentences
                if self.evaluator.evaluate_relevance(query, {"text": s}) > 0.5
            ]
            if relevant_sentences:
                refined.append(" ".join(relevant_sentences))
        return refined
```

The key insight of CRAG is the triage mechanism: rather than treating all retrieved documents equally, it explicitly evaluates and categorizes them, taking different corrective actions based on the assessment. For metrics and frameworks to measure how well these corrective mechanisms perform, see [Article 18: RAG Evaluation](/rag-evaluation).

## Self-RAG: Retrieval with Self-Reflection

Self-RAG (Asai et al., 2023) takes a more radical approach: it trains the LLM itself to decide when to retrieve, evaluate what was retrieved, and critique its own generated output.

### Self-RAG Special Tokens

Self-RAG introduces special reflection tokens that the model generates inline:

- **[Retrieve]**: Yes/No -- should the model retrieve additional information?
- **[IsRel]**: Relevant/Irrelevant -- is the retrieved passage relevant to the query?
- **[IsSup]**: Fully Supported/Partially Supported/No Support -- does the retrieved passage support the generated text?
- **[IsUse]**: Utility rating (1-5) -- how useful is the overall response?

```
Query: "What causes northern lights?"

Model output:
[Retrieve] Yes
[Retrieved passage: "Aurora borealis occurs when charged particles from
the solar wind interact with Earth's magnetosphere..."]
[IsRel] Relevant
The northern lights, or aurora borealis, are caused by charged particles
from the sun interacting with Earth's magnetic field.
[IsSup] Fully Supported
These particles are guided by the magnetosphere toward the poles, where
they collide with atmospheric gases, causing them to emit light.
[IsUse] 5
```

### Training Self-RAG

Self-RAG is trained in two phases:

1. **Critic model training**: Train a model to generate the reflection tokens given (query, passage, generation) triples. This is trained on human annotations or GPT-4 labels.

2. **Generator training**: Train the language model end-to-end to generate both reflection tokens and text. The model learns to interleave retrieval decisions and quality assessments with generation.

### Why Self-RAG Matters

Self-RAG shifts retrieval control from the application layer into the model itself. Instead of always retrieving (which wastes compute for queries the model already knows) or never retrieving (which causes hallucination), the model adaptively decides. Asai et al. (2023) showed that Self-RAG outperforms both standard RAG and vanilla LLMs across multiple benchmarks, with the added benefit of providing interpretable confidence signals via the reflection tokens. Note that RAG systems with tool-use capabilities introduce prompt injection risks -- an adversary could embed instructions in retrieved documents to manipulate the agent's behavior. See [Article 12: Adversarial Prompting](/adversarial-prompting) for defense strategies against indirect prompt injection in retrieval pipelines.

## Practical Architecture: Combining Advanced Patterns

In practice, these techniques are combined based on the application's requirements:

```python
class AdvancedRAGSystem:
    """Production system combining multiple advanced RAG patterns."""

    async def answer(self, query: str) -> dict:
        # 1. Query analysis and routing
        route = self.route_query(query)

        # 2. Select retrieval strategy
        if route.requires_multi_hop:
            context = await self.multi_hop_retrieve(query)
        elif route.requires_graph_traversal:
            context = await self.graph_rag_retrieve(query)
        elif route.is_global_summary:
            context = await self.raptor_retrieve(query, level="summary")
        else:
            context = await self.hybrid_retrieve(query)

        # 3. Evaluate retrieval quality (CRAG-style)
        quality = self.evaluate_retrieval(query, context)

        if quality.score < 0.3:
            # Retrieval failed -- try alternative strategy
            context = await self.fallback_retrieve(query, tried=route.strategy)

        # 4. Generate with self-assessment
        answer = self.generate_with_reflection(query, context)

        return {
            "answer": answer.text,
            "sources": answer.citations,
            "confidence": answer.confidence,
            "retrieval_strategy": route.strategy,
            "hops": context.hop_count if hasattr(context, 'hop_count') else 1
        }
```

## RAG vs. Long Context

The arrival of models with 1M+ token context windows -- Gemini 1.5 Pro at 1M tokens, Claude with 200K, GPT-4.1 at 1M -- has prompted a legitimate question: does RAG still matter when you can simply dump entire document collections into the prompt?

### Empirical Comparisons

Several benchmarks have tested this directly. Google's "Lost in the Middle" (Liu et al., 2023) demonstrated that even models with long contexts suffer from a U-shaped attention curve: they attend well to information at the beginning and end of the context but degrade significantly for information positioned in the middle. Subsequent work by Anthropic and others has partially mitigated this, but the core finding persists -- retrieval precision degrades as context length grows.

The LOFT benchmark (Lee et al., 2024) evaluated long-context models on tasks specifically designed to test whether they could replace retrieval systems. The findings were nuanced: for simple fact lookup where the answer appears verbatim in the corpus, long context performed comparably to RAG. But for tasks requiring synthesis across multiple passages, or where the relevant information constitutes a small fraction of the total context, RAG with a well-tuned retriever consistently outperformed brute-force context stuffing.

### When Retrieval Is Still Necessary

Several conditions make RAG indispensable regardless of context window size:

**Corpus exceeds context limits.** Even a 1M token window holds roughly 750K words -- about 3,000 pages. Many enterprise knowledge bases, codebases, and document archives are orders of magnitude larger. Retrieval remains the only practical approach for corpora at this scale.

**Cost and latency constraints.** Sending 1M tokens per query is expensive (roughly $2-10 per query depending on the model) and slow (seconds to tens of seconds for prefill alone). RAG with a focused retrieval of 2-5K tokens is 100-500x cheaper per query and returns responses in under a second.

**Information freshness.** Long context requires reprocessing the full corpus on every query. RAG indexes can be updated incrementally as documents change, making it far more practical for dynamic knowledge bases.

**Precision on needle-in-haystack tasks.** When the relevant information is a single paragraph in a million-token corpus, retrieval models trained specifically to surface relevant passages will outperform an LLM's implicit attention-based "search" through a massive context.

### The Hybrid Approach

The most effective production systems use both: RAG for precision and long context for breadth. The pattern works as follows:

1. **Retrieval stage**: Use embedding-based or hybrid search (see [Article 16: Retrieval Strategies](/retrieval-strategies)) to surface the most relevant passages
2. **Context augmentation**: Place retrieved passages in the context alongside broader background documents that fit within the window
3. **Generation with full context**: The LLM generates from both the precisely retrieved passages and the broader contextual documents

This hybrid approach consistently outperforms either technique alone. The retriever ensures the most critical information is present and prominently positioned; the long context provides background knowledge that helps the model interpret and synthesize the retrieved passages.

## RAG with Fine-Tuning (RAFT)

Standard RAG assumes the language model is used as-is, with retrieved context simply prepended to the prompt. RAFT -- Retrieval Augmented Fine-Tuning (Zhang et al., 2024) -- challenges this assumption by fine-tuning the model specifically to work with retrieved context, including learning to ignore irrelevant retrieved documents.

### How RAFT Works

The core insight is straightforward: in real RAG pipelines, not every retrieved document is relevant. Standard models, when presented with a mix of relevant and irrelevant context, often get confused or distracted by the noise. RAFT fine-tunes the model on training examples that deliberately include "distractor" documents alongside relevant ones.

The training data for RAFT is constructed as follows:

1. **Oracle documents (D*)**: Documents that contain the answer to the question
2. **Distractor documents (Dk)**: Documents retrieved by the system that do not contain the answer
3. **Chain-of-thought answers**: Answers that explicitly quote and cite the relevant passages from the oracle documents

During training, a fraction of examples include only oracle documents (to teach the model what a relevant document looks like), while the majority include a mix of oracle and distractor documents (to teach the model to identify and extract information from relevant documents while ignoring noise). Crucially, the model is trained to produce chain-of-thought reasoning that references specific passages, reinforcing the connection between retrieved evidence and generated answers.

### Results and Practical Implications

RAFT demonstrates significant improvements over both standard RAG and pure fine-tuning across domain-specific benchmarks. On the PubMed QA benchmark, RAFT improved accuracy by 5-10% over standard RAG with the same retriever. On HotpotQA, the gains were even larger for multi-hop questions where distractor documents are most harmful.

The practical takeaway: if you control the model (i.e., you can fine-tune it) and your retrieval pipeline has a known precision rate below 80%, RAFT-style training can meaningfully improve end-to-end answer quality. The approach is complementary to retriever improvements -- better retrieval reduces the number of distractors, while RAFT makes the model more robust to the distractors that remain.

For practitioners using DSPy (see [Article 11: Prompt Optimization](/prompt-optimization)), a lighter-weight alternative to full RAFT training is prompt optimization over the RAG pipeline: DSPy can automatically tune the prompt and few-shot examples to improve the model's ability to extract relevant information from noisy retrieved context, without requiring gradient-based fine-tuning.

## Cost Analysis of Advanced RAG

Advanced RAG techniques vary dramatically in their cost profiles. Understanding these trade-offs is essential for selecting the right approach for a given budget and use case.

### Indexing Costs

**Standard vector indexing** is cheap. Embedding a million documents with a model like `text-embedding-3-small` costs roughly $0.02 per million tokens, meaning a corpus of 1M documents (averaging 500 tokens each) can be indexed for about $10. Incremental updates are proportional to the number of changed documents.

**GraphRAG indexing** is expensive. Entity extraction and community summarization require LLM calls for every chunk. For a corpus of 1M documents, Microsoft's GraphRAG implementation typically requires 5-10 LLM calls per chunk for entity extraction, relationship identification, and community summarization. At GPT-4o-mini pricing (~$0.15 per million input tokens), indexing 1M documents costs $500-2,000. With GPT-4o, costs scale to $5,000-20,000. The graph must also be substantially rebuilt when documents change, making it poorly suited for rapidly evolving corpora.

**RAPTOR indexing** falls in between. The clustering step is cheap (CPU-based), but summarization at each tree level requires LLM calls. For a 1M document corpus with 3 tree levels, expect costs of $200-800 depending on the summarization model.

### Per-Query Costs

| Technique | Retrieval Cost | Generation Input Tokens | Typical Total Cost/Query |
|-----------|---------------|------------------------|--------------------------|
| Standard RAG (top-5) | ~$0.00001 (vector search) | 2-5K | $0.001-0.01 |
| Agentic RAG (3 iterations) | ~$0.00003 | 5-15K + 3 routing calls | $0.01-0.05 |
| GraphRAG local search | ~$0.0001 (graph traversal) | 3-8K | $0.005-0.02 |
| GraphRAG global search | ~$0.001 (multi-community) | 10-50K (map-reduce) | $0.05-0.50 |
| Multi-hop (3 hops) | ~$0.00003 | 5-15K + evaluation calls | $0.02-0.10 |
| Long context (full corpus) | N/A | 100K-1M | $0.50-10.00 |

### When Each Technique Is Cost-Effective

**Standard RAG** is the right default. For the vast majority of question-answering workloads, it provides the best cost-quality ratio. Start here and only add complexity when you can demonstrate measurable quality gains on your specific use case.

**Agentic RAG** is cost-effective when query complexity varies widely. The agent can use a single retrieval pass for simple queries and multiple passes only when needed, amortizing the overhead across the workload.

**GraphRAG** is justified when relationship-heavy queries constitute a significant fraction of traffic and the corpus is relatively stable (infrequent re-indexing). The high indexing cost is amortized over query volume -- at 10,000 queries per day, the per-query amortized indexing cost becomes negligible within a week.

**Long context** is cost-effective only for low-volume, high-value queries where completeness matters more than cost -- legal document review, comprehensive due diligence, or research synthesis where missing a relevant passage has high consequences.

### Budget Guidance

For teams evaluating advanced RAG, a practical budgeting framework:

1. **Prototype with standard RAG** ($10-100 for indexing, $0.001-0.01 per query)
2. **Measure failure modes** using the evaluation approaches described in [Article 18: RAG Evaluation](/rag-evaluation)
3. **Add complexity selectively**: If failures are primarily retrieval quality, invest in better retrieval strategies before adding agentic patterns. If failures are relationship reasoning, consider GraphRAG for that subset of queries
4. **Route by cost tier**: Use query classification to send simple queries through cheap pipelines and complex queries through expensive ones

## Orchestration Frameworks

Building advanced RAG pipelines requires orchestrating multiple components: retrievers, rerankers, LLM calls, evaluation steps, and routing logic. Several frameworks have emerged to manage this complexity.

### LangGraph

LangGraph models RAG pipelines as stateful graphs where nodes are processing steps and edges define the control flow. Its key strength is explicit support for cycles and conditional branching, making it natural to implement patterns like CRAG (evaluate, then conditionally re-retrieve) and agentic RAG (loop until sufficient context). For LangGraph fundamentals and the full API, see the dedicated [LangGraph](/langgraph) article.

LangGraph works well for pipelines with complex control flow -- multi-hop retrieval with conditional termination, parallel retrieval from multiple sources with result merging, or human-in-the-loop approval steps. Its graph-based model makes the pipeline's structure inspectable and debuggable. The trade-off is verbosity: simple pipelines require more boilerplate than a linear chain, and the abstraction can feel heavy for straightforward retrieve-then-generate workflows.

### LlamaIndex Workflows

LlamaIndex Workflows provide an event-driven orchestration model built around the concept of steps that emit and consume events. This model is particularly well-suited for RAG because it natively supports the data-flow patterns common in retrieval pipelines: ingest events trigger indexing, query events trigger retrieval, retrieval results trigger reranking, and so on.

LlamaIndex's strength is its deep integration with retrieval primitives -- it ships with built-in support for vector stores, knowledge graphs, RAPTOR-style tree indices, and query engines that abstract the retrieval-generation loop. For teams whose primary use case is RAG, LlamaIndex offers the fastest path from prototype to production. The trade-off is that its abstractions are opinionated about how retrieval should work, which can become constraining for highly custom pipelines.

### DSPy

DSPy (Khattab et al., 2023) takes a fundamentally different approach: rather than orchestrating pipeline steps procedurally, it treats the entire RAG pipeline as a program to be optimized. Retrieval, prompting, and generation are expressed as declarative modules, and DSPy's compiler optimizes the prompts and few-shot examples to maximize end-to-end performance on a development set.

For advanced RAG, DSPy's key contribution is that it can jointly optimize the retrieval query formulation and the generation prompt. Instead of manually tuning how queries are rewritten for multi-hop retrieval or how the generation prompt instructs the model to use context, DSPy discovers these configurations automatically. This is especially powerful for RAFT-like improvements without fine-tuning: DSPy can optimize the prompt to make the model more robust to distractor documents in retrieved context. For a deeper treatment of DSPy's optimization approach, see [Article 11: Prompt Optimization](/prompt-optimization).

### Choosing a Framework

The choice depends on what you are optimizing for:

- **Control flow complexity** (conditional branching, cycles, human-in-the-loop): LangGraph
- **Retrieval-native abstractions** (fast prototyping with vector stores, knowledge graphs, multiple index types): LlamaIndex Workflows
- **End-to-end optimization** (automatic prompt tuning, joint retriever-generator optimization): DSPy
- **Simple pipelines** (retrieve-then-generate with minimal routing): Any framework works, or no framework at all -- a few dozen lines of Python with direct API calls is often sufficient

In practice, many production systems combine elements: DSPy for prompt optimization during development, LangGraph or LlamaIndex for runtime orchestration, and custom code for domain-specific logic that no framework handles well.

## Summary and Key Takeaways

- **Agentic RAG** transforms retrieval from a single function call into an iterative reasoning process. Query routing is the simplest entry point; tool-augmented retrieval with an agent loop is the most flexible.
- **GraphRAG** excels at relationship-heavy queries and global summarization but requires significant upfront processing. Use it when your documents contain rich entity relationships.
- **Multi-hop retrieval** is essential for complex questions that span multiple documents. The key is giving the LLM the ability to evaluate what's missing and formulate follow-up queries.
- **RAPTOR** enables retrieval at multiple levels of abstraction through a tree of summaries. Particularly valuable for document collections where both high-level themes and specific details are queried.
- **Corrective RAG** adds robustness by explicitly evaluating retrieval quality and taking corrective action (e.g., web search fallback) when retrieval fails.
- **Self-RAG** represents the most integrated approach, training the LLM itself to decide when to retrieve and assess what it retrieves. This is architecturally elegant but requires custom model training.
- **Long context does not replace RAG.** Even with 1M token windows, retrieval remains essential for cost, latency, precision, and corpora that exceed any context limit. The best systems combine both: RAG for precision, long context for breadth.
- **RAFT** (fine-tuning models to work with retrieved context, including distractors) offers measurable quality gains when retrieval precision is imperfect. DSPy-based prompt optimization provides a lighter-weight alternative.
- **Cost varies by orders of magnitude** across techniques. Standard RAG costs $0.001-0.01 per query; GraphRAG global search can reach $0.50+. Route queries to cost-appropriate pipelines.
- **Framework choice is secondary to pipeline design.** LangGraph suits complex control flow, LlamaIndex excels at retrieval-native prototyping, and DSPy enables end-to-end optimization. Many production systems combine elements from multiple frameworks.
- In practice, combine these patterns based on query complexity. Simple factual queries don't need multi-hop retrieval; complex analytical queries don't benefit from simple vector search.
- The trend is clear: RAG is evolving from a static pipeline into a dynamic, adaptive system where the retrieval strategy is itself a decision made by an intelligent agent.
