# RAG: Retrieval-Augmented Generation as an Agentic Pattern

Retrieval-augmented generation is the first of the three core agentic AI patterns -- the discipline of feeding a model the *specific* knowledge it needs at inference time, rather than hoping that knowledge survived pretraining. RAG is cited as a required pattern alongside tool use and memory in roles like the [RPM Interactive AI Product Engineer Contract](https://agentic-knowledge.vercel.app/applications/rpm-interactive-ai-product-engineer-contract). This article is the entry point: the loop, when to reach for it, when *not* to, and where to dive deeper inside this knowledge base.

## Why this is an agentic pattern

A pure LLM call is closed-world: it can only answer from weights frozen at pretraining time. That is fine for "rephrase this paragraph" and useless for "what does our internal runbook say about a corrupted Postgres replica". RAG turns the model into an open-world agent by giving it a retrieval step before generation -- the agent now has a way to *consult sources* the way a human engineer would consult a wiki, a codebase, or a spec.

Three things make RAG agentic rather than just "search + LLM":

1. **The query is generated, not typed.** The model rewrites the user's question into one or more retrieval queries. That rewrite is a decision the agent makes.
2. **Retrieval is a tool, not a pipeline stage.** A capable agent retrieves more than once -- it reads, decides whether the result is enough, and may retrieve again with a refined query. This is the bridge into [advanced-rag](/advanced-rag) (agentic / multi-hop / self-correcting RAG).
3. **The grounded answer is auditable.** Because retrieval is explicit, every claim can be traced back to a source chunk -- the foundation for evals, citations, and hallucination detection.

## The core loop

The minimum viable RAG loop is four steps:

```python
# 1. Index (offline, one-time per document)
chunks = chunk(document)
vectors = embed(chunks)
vector_store.upsert(zip(chunks, vectors))

# 2. Retrieve (per query)
query_vec = embed(user_query)
hits = vector_store.search(query_vec, k=5)

# 3. Augment
prompt = f"""Answer using ONLY the sources below.
Sources:
{format_chunks(hits)}

Question: {user_query}"""

# 4. Generate
answer = llm(prompt)
```

Every production RAG system is a variation on this loop. The interesting engineering lives in the parameters: how you chunk, which embedding model you pick, how many `k` you retrieve, how you rerank, and how you compose the final prompt. Each of those is its own article in the [RAG & Retrieval](/#cat-rag-retrieval) section below.

## When to add it (and when not to)

**Reach for RAG when:**

- The answer depends on data that is *private*, *recent*, or *too large* to fit in the context window (internal docs, customer records, last week's news, a 50k-file codebase).
- You need *citations* -- regulators, lawyers, and security reviewers all want to see which document a claim came from.
- The knowledge changes faster than you can fine-tune (most enterprise knowledge fits this).

**Do not reach for RAG when:**

- The question is reasoning over input the user already pasted -- you have the context, retrieval adds noise.
- You only need *style*, *format*, or *tone* shaping -- that is a prompt engineering problem, not a retrieval one.
- The answer is small, stable, and finite (e.g. a list of 20 product SKUs) -- just inject it into the system prompt and skip the vector store.

A useful smell test: if the same answer should always come from the same source document, RAG is right. If the answer is "it depends on the user's question and a tool call", you want [tool-use](/tool-use) instead. If the answer should improve as the agent has more conversations, you want [memory](/memory).

## Going deeper

This page is a map. Each link below is a deeper article in the knowledge base:

- [Embeddings](/embeddings) -- how text becomes vectors and why cosine similarity works.
- [Embedding Models](/embedding-models) -- choosing between OpenAI, Cohere, BGE, E5, and friends.
- [Vector Databases](/vector-databases) -- pgvector, Pinecone, Qdrant, Weaviate; HNSW vs IVF.
- [Chunking Strategies](/chunking-strategies) -- fixed-size, recursive, semantic, late chunking.
- [Retrieval Strategies](/retrieval-strategies) -- dense vs sparse, hybrid, reranking, MMR.
- [Advanced RAG](/advanced-rag) -- agentic RAG, GraphRAG, self-correcting retrieval, multi-hop.
- [RAG Evaluation](/rag-evaluation) -- faithfulness, answer relevance, context precision, RAGAS.

## Job-spec context

The "agentic AI patterns (RAG, tool use, memory)" trio shows up verbatim in product-engineer JDs. See the [RPM Interactive AI Product Engineer Contract](https://agentic-knowledge.vercel.app/applications/rpm-interactive-ai-product-engineer-contract) for an example role that lists this pattern as a hiring requirement -- pair this overview with the [tool-use](/tool-use) and [memory](/memory) introductions to cover the full bullet.
