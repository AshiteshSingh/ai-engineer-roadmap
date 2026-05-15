# Retrieval Strategies: Hybrid Search, Reranking & HyDE

The retrieval stage of a RAG pipeline determines the upper bound on answer quality -- an LLM cannot reason over information it never receives. Yet the design space for retrieval is vast: dense vs. sparse representations, single-stage vs. multi-stage pipelines, query-centric vs. document-centric approaches. This article provides a rigorous examination of modern retrieval strategies, from foundational hybrid search architectures through advanced techniques like Hypothetical Document Embeddings (HyDE) and learned reranking, grounded in both research findings and production experience.

## Dense vs. Sparse Retrieval: Complementary Strengths

Understanding when and why dense and sparse retrieval methods fail differently is essential for building robust retrieval systems.

### Sparse Retrieval: BM25 and Its Descendants

BM25 (Robertson and Zaragoza, 2009) remains the most widely deployed retrieval algorithm. It scores documents based on term frequency (TF), inverse document frequency (IDF), and document length normalization:

```
BM25(q, d) = sum_{t in q} IDF(t) * (tf(t,d) * (k1 + 1)) / (tf(t,d) + k1 * (1 - b + b * |d|/avgdl))
```

where `k1` (typically 1.2-2.0) controls term frequency saturation and `b` (typically 0.75) controls length normalization.

**Strengths of sparse retrieval**:
- Exact term matching: "CUDA 12.3 compatibility" retrieves documents containing those exact terms
- No training required: works out of the box on any corpus
- Interpretable: you can inspect which terms contributed to the score
- Handles rare terms well: domain-specific terminology, proper nouns, error codes

**Failure modes**:
- Vocabulary mismatch: query "car repair" won't match "automobile maintenance"
- Semantic understanding: "animals that can fly" won't match documents about birds that never use the word "fly"
- No understanding of negation or qualification

### Dense Retrieval: Semantic Matching

Dense retrieval encodes queries and documents into learned vector representations, with similarity computed as dot product or cosine similarity. Models like DPR (Karpukhin et al., 2020), Contriever (Izacard et al., 2022), and modern embedding models (BGE, E5, GTE) have dramatically improved dense retrieval quality.

**Strengths of dense retrieval**:
- Semantic matching: understands synonyms, paraphrases, conceptual similarity
- Cross-lingual transfer: multilingual models enable retrieval across languages
- Generalizable: pre-trained models transfer across domains

**Failure modes**:
- Rare entities and terms: embeddings of infrequent tokens are poorly calibrated
- Exact match requirements: searching for "error code 0x80070005" may miss exact matches in favor of semantically similar but incorrect error descriptions
- Out-of-distribution queries: performance degrades on domains far from training data
- Sensitivity to query formulation: semantically equivalent queries can produce different results

### The Complementarity Argument

Dense and sparse methods fail on different queries. Empirical analysis on the BEIR benchmark (Thakur et al., 2021) shows that on datasets like TREC-COVID and SciFact, BM25 outperforms many dense retrievers. On Natural Questions and MS MARCO, dense retrievers dominate. The correlation between their error sets is surprisingly low -- meaning they frequently disagree on which documents are relevant.

This complementarity is the fundamental motivation for hybrid search. For a deeper treatment of how embedding model architecture influences dense retrieval quality, see [Article 13: Embedding Models](/embedding-models).

## Learned Sparse Retrieval: SPLADE

BM25's term-matching strengths are real, but its vocabulary is limited to the exact tokens present in the document. Learned sparse retrieval bridges this gap by using transformer models to produce sparse, high-dimensional representations where the dimensions correspond to vocabulary terms -- but crucially, the model can assign non-zero weights to terms that never appear in the original text.

### How SPLADE Works

SPLADE (Formal et al., 2021) -- Sparse Lexical and Expansion -- passes a document through a masked language model (typically BERT or DistilBERT) and uses the MLM head logits to produce a sparse vector over the entire vocabulary. A log-saturation function and FLOPS regularizer control sparsity:

```
w_j = log(1 + ReLU(MLM_logit_j))
SPLADE(d) = max_pool over tokens { w_j for j in vocabulary }
```

The max-pooling over token positions means that if any token in the document activates vocabulary term j, that term receives a non-zero weight. The FLOPS regularizer penalizes the expected number of floating-point operations at query time, directly controlling the sparsity-effectiveness trade-off.

The result is an inverted index that looks structurally identical to a traditional BM25 index -- term IDs mapped to document IDs with weights -- but with two critical differences. First, expansion: a document about "automobile maintenance" will have non-zero weight for "car", "vehicle", and "repair" even if those words never appear. Second, learned term importance: the model learns that "maintenance" is more discriminative than "the" far more effectively than IDF alone.

### SPLADE++ and SPLADEv2

**SPLADEv2** (Formal et al., 2022) introduced distillation from cross-encoder teachers and separate query/document encoders, significantly improving effectiveness. The key insight was that queries and documents have different sparsity requirements: queries benefit from more expansion (to improve recall), while documents benefit from sparser representations (to control index size and query latency).

**SPLADE++** further refined the architecture with two variants. SPLADE++ Self-Distillation uses the model's own hard-negative mining loop to bootstrap better training data. SPLADE++ Ensemble Distillation combines scores from multiple cross-encoder teachers. On the BEIR benchmark, SPLADE++ achieves nDCG@10 scores competitive with or exceeding state-of-the-art dense retrievers while maintaining the interpretability and infrastructure advantages of sparse retrieval.

### When SPLADE Outperforms BM25

SPLADE consistently outperforms BM25 in scenarios involving vocabulary mismatch. On BEIR's zero-shot evaluation, SPLADE++ outperforms BM25 on every dataset and matches or exceeds dense retrievers on most. The gains are largest on datasets with high lexical mismatch -- scientific literature (SciFact), argument retrieval (ArguAna), and web questions (NQ).

Where SPLADE truly shines is in hybrid pipelines. Because SPLADE representations live in an inverted index, they can be served alongside BM25 using the same infrastructure (Lucene, Anserini, OpenSearch). A hybrid of SPLADE + dense retrieval captures three complementary signals: exact term matching (from SPLADE's retention of original terms), learned expansion (from SPLADE's vocabulary expansion), and semantic similarity (from the dense component).

```python
# SPLADE representations slot directly into existing sparse retrieval infrastructure
# Example: encoding a query with a SPLADE model
from transformers import AutoModelForMaskedLM, AutoTokenizer
import torch

tokenizer = AutoTokenizer.from_pretrained("naver/splade-cocondenser-ensembledistil")
model = AutoModelForMaskedLM.from_pretrained("naver/splade-cocondenser-ensembledistil")

def encode_splade(text: str) -> dict[int, float]:
    """Encode text into a SPLADE sparse vector."""
    tokens = tokenizer(text, return_tensors="pt", truncation=True, max_length=256)
    with torch.no_grad():
        logits = model(**tokens).logits

    # Log-saturation and max-pooling over sequence positions
    weights = torch.max(
        torch.log1p(torch.relu(logits)) * tokens["attention_mask"].unsqueeze(-1),
        dim=1
    ).values.squeeze()

    # Extract non-zero terms
    non_zero = weights.nonzero().squeeze()
    sparse_rep = {idx.item(): weights[idx].item() for idx in non_zero}
    return sparse_rep
```

This function returns a dictionary mapping vocabulary term IDs to learned importance weights -- structurally identical to a bag-of-words representation, but enriched with expansion terms and learned weighting. These representations can be indexed in any system that supports sparse vectors (Elasticsearch, Vespa, Qdrant, Weaviate).

## Hybrid Search Architecture

### Reciprocal Rank Fusion (RRF)

RRF (Cormack et al., 2009) is the most commonly used fusion method due to its simplicity and robustness. It combines rankings without requiring score normalization:

```python
def reciprocal_rank_fusion(
    rankings: list[list[str]],
    k: int = 60,
    weights: list[float] = None
) -> list[tuple[str, float]]:
    """
    Fuse multiple ranked lists using Reciprocal Rank Fusion.

    Args:
        rankings: List of ranked document ID lists (best first)
        k: RRF constant (default 60, from original paper)
        weights: Optional weights per ranking source
    """
    if weights is None:
        weights = [1.0] * len(rankings)

    fused_scores: dict[str, float] = {}

    for ranking, weight in zip(rankings, weights):
        for rank, doc_id in enumerate(ranking):
            if doc_id not in fused_scores:
                fused_scores[doc_id] = 0.0
            fused_scores[doc_id] += weight / (k + rank + 1)

    # Sort by fused score descending
    sorted_results = sorted(fused_scores.items(), key=lambda x: x[1], reverse=True)
    return sorted_results
```

The constant `k` controls how much rank position matters. With k=60, the difference between rank 1 and rank 2 is small (1/61 vs 1/62), making RRF relatively rank-stable. Lower k values amplify the importance of top positions.

**Why RRF works well**: It doesn't require score normalization between different retrieval systems (which have incomparable score scales). It's robust to one system returning many irrelevant results (they receive low RRF scores). And it's simple to implement, debug, and reason about.

### Weighted Linear Combination

An alternative to RRF normalizes scores from each source and combines them linearly:

```python
def weighted_combination(
    vector_results: list[tuple[str, float]],  # (doc_id, similarity_score)
    bm25_results: list[tuple[str, float]],     # (doc_id, bm25_score)
    alpha: float = 0.7                          # weight for vector search
) -> list[tuple[str, float]]:
    """Combine dense and sparse scores with min-max normalization."""

    def normalize(results):
        scores = [s for _, s in results]
        min_s, max_s = min(scores), max(scores)
        if max_s == min_s:
            return [(doc_id, 1.0) for doc_id, _ in results]
        return [(doc_id, (s - min_s) / (max_s - min_s)) for doc_id, s in results]

    norm_vector = dict(normalize(vector_results))
    norm_bm25 = dict(normalize(bm25_results))

    all_docs = set(norm_vector.keys()) | set(norm_bm25.keys())

    combined = []
    for doc_id in all_docs:
        score = alpha * norm_vector.get(doc_id, 0.0) + (1 - alpha) * norm_bm25.get(doc_id, 0.0)
        combined.append((doc_id, score))

    return sorted(combined, key=lambda x: x[1], reverse=True)
```

The alpha parameter requires tuning per use case. For technical documentation with precise terminology, lower alpha (more BM25 weight) often works better. For conversational queries, higher alpha (more vector weight) is typically preferred.

### Production Hybrid Search Pipeline

```python
class HybridSearchPipeline:
    def __init__(self, vector_store, bm25_index, reranker=None):
        self.vector_store = vector_store
        self.bm25_index = bm25_index
        self.reranker = reranker

    async def search(
        self,
        query: str,
        top_k: int = 10,
        candidate_multiplier: int = 3,
        alpha: float = 0.7
    ) -> list[dict]:
        """Full hybrid search pipeline with optional reranking."""
        n_candidates = top_k * candidate_multiplier

        # Stage 1: Parallel retrieval
        vector_results, bm25_results = await asyncio.gather(
            self.vector_store.search(query, limit=n_candidates),
            self.bm25_index.search(query, limit=n_candidates)
        )

        # Stage 2: Fusion
        fused = reciprocal_rank_fusion(
            [
                [r.id for r in vector_results],
                [r.id for r in bm25_results]
            ],
            weights=[alpha, 1 - alpha]
        )

        # Stage 3: Optional reranking
        if self.reranker:
            candidates = [self.get_document(doc_id) for doc_id, _ in fused[:n_candidates]]
            reranked = self.reranker.rerank(query, candidates, top_k=top_k)
            return reranked

        return [self.get_document(doc_id) for doc_id, _ in fused[:top_k]]
```

## Reranking: The Second Stage

First-stage retrieval (dense, sparse, or hybrid) prioritizes recall -- casting a wide net. Reranking prioritizes precision -- selecting the best results from the candidate set using a more powerful (and expensive) model.

### Cross-Encoder Reranking

Cross-encoders process the query-document pair jointly through a transformer, enabling full attention between query and document tokens. This is fundamentally more powerful than bi-encoder (embedding) approaches, which encode query and document independently.

```python
from sentence_transformers import CrossEncoder

reranker = CrossEncoder('cross-encoder/ms-marco-MiniLM-L-12-v2')

def rerank(query: str, documents: list[str], top_k: int = 5) -> list[tuple[str, float]]:
    """Rerank documents using a cross-encoder."""
    # Create query-document pairs
    pairs = [[query, doc] for doc in documents]

    # Score all pairs
    scores = reranker.predict(pairs)

    # Sort by score
    scored_docs = list(zip(documents, scores))
    scored_docs.sort(key=lambda x: x[1], reverse=True)

    return scored_docs[:top_k]
```

**Why cross-encoders outperform bi-encoders**: In a bi-encoder, the query embedding and document embedding are computed independently -- there's no mechanism for the model to attend from a specific query term to specific document terms. A cross-encoder sees both simultaneously, enabling it to resolve ambiguities ("bank" in the context of "river bank" vs. "bank account") and assess fine-grained relevance.

**The cost trade-off**: Cross-encoders are O(N) in the number of candidates, computing a full transformer forward pass per pair. For 100 candidates with a 12-layer model, this takes ~50-200ms on a GPU. This is why reranking is a second stage applied to a small candidate set, not a first-stage retrieval method.

### Cohere Rerank

Cohere offers a managed reranking API that achieves strong performance without infrastructure management:

```python
import cohere

co = cohere.Client("your-api-key")

results = co.rerank(
    model="rerank-english-v3.0",
    query="What is the capital of France?",
    documents=[
        "Paris is the capital of France.",
        "Berlin is the capital of Germany.",
        "France is a country in Western Europe."
    ],
    top_n=2,
    return_documents=True
)

for result in results.results:
    print(f"Score: {result.relevance_score:.4f} | {result.document.text}")
```

### ColBERT: Late Interaction Reranking

ColBERT (Khattab and Zaharia, 2020) represents an intermediate approach between bi-encoders and cross-encoders. It encodes query and document independently (like a bi-encoder), but retains per-token embeddings (rather than pooling into a single vector). Relevance is computed via "late interaction" -- a MaxSim operation:

```
Score(q, d) = sum_{i in q_tokens} max_{j in d_tokens} sim(q_i, d_j)
```

For each query token, find the most similar document token, then sum these maximum similarities. This captures fine-grained term-level matching while maintaining the efficiency of independent encoding.

**ColBERTv2** (Santhanam et al., 2022) adds residual compression, reducing storage requirements by 6-10x while maintaining effectiveness.

```python
from colbert import Searcher
from colbert.infra import ColBERTConfig

config = ColBERTConfig(
    nbits=2,  # Quantization for storage efficiency
    doc_maxlen=300,
    query_maxlen=32
)

searcher = Searcher(index="my_index", config=config)
results = searcher.search("retrieval augmented generation", k=10)
```

**Trade-offs**: ColBERT provides better ranking quality than bi-encoders with lower latency than cross-encoders. The main cost is storage -- retaining per-token embeddings requires ~100x more storage than single-vector representations.

### Practical ColBERT Deployment

**ColBERTv2 and the PLAID Engine**: The original ColBERT required storing full-precision per-token embeddings, making it expensive at scale. ColBERTv2 (Santhanam et al., 2022) introduced residual compression: token embeddings are quantized to 1-2 bits by encoding only the residual difference from the nearest centroid. This reduces storage by 6-10x. The PLAID engine (Santhanam et al., 2022) builds on this with a multi-stage retrieval architecture: candidate generation via centroid interaction, centroid pruning, and then decompression of only the surviving candidates for full MaxSim scoring. PLAID achieves sub-100ms latency on million-document collections while retaining ColBERTv2's ranking quality.

**RAGatouille**: For teams that want ColBERT without managing the full indexing infrastructure, RAGatouille (Clavié, 2024) provides a high-level Python interface that wraps ColBERTv2 with sensible defaults:

```python
from ragatouille import RAGPretrainedModel

# Load a pre-trained ColBERT model
rag = RAGPretrainedModel.from_pretrained("colbert-ir/colbertv2.0")

# Index a collection -- handles tokenization, encoding, and PLAID indexing
rag.index(
    collection=[doc["text"] for doc in documents],
    document_ids=[doc["id"] for doc in documents],
    index_name="my_knowledge_base",
    max_document_length=300,
    split_documents=True  # Automatic chunking at sentence boundaries
)

# Search returns ranked results with per-token interaction scores
results = rag.search("How does late interaction differ from cross-encoding?", k=10)
# Each result includes: content, score, rank, document_id
```

RAGatouille also supports fine-tuning ColBERT on domain-specific data with minimal code, making it practical to adapt the model for specialized corpora like legal documents, medical literature, or internal knowledge bases. For guidance on generating training pairs for this kind of fine-tuning, see [Article 13: Embedding Models](/embedding-models).

**When to choose ColBERT over cross-encoder reranking**: ColBERT is preferable when latency budgets are tight (under 100ms total), when you need to rerank large candidate sets (hundreds rather than dozens), or when you want a single model that can serve as both first-stage retriever and reranker. Cross-encoders remain superior when you have a small candidate set (under 50 documents) and can tolerate 100-200ms of reranking latency, since their joint encoding captures deeper query-document interactions. For storage infrastructure considerations when deploying ColBERT's per-token indexes, see [Article 14: Vector Databases](/vector-databases).

## HyDE: Hypothetical Document Embeddings

HyDE (Gao et al., 2022) addresses a fundamental asymmetry in retrieval: queries and documents are different kinds of text. A query like "What causes aurora borealis?" is short and interrogative, while the relevant document is a long, declarative explanation. Their embedding space locations may be far apart even when semantically related.

### The HyDE Approach

HyDE uses an LLM to generate a hypothetical document that would answer the query, then embeds this generated document for retrieval:

```python
from openai import OpenAI

client = OpenAI()

def hyde_retrieval(query: str, vector_store, embedding_model, top_k: int = 5):
    """Retrieve using Hypothetical Document Embeddings."""

    # Step 1: Generate a hypothetical answer document
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{
            "role": "user",
            "content": f"""Write a short, detailed passage that would answer this question.
            Write as if this is from an authoritative source.
            Do not include phrases like "the answer is" -- just provide the information directly.

            Question: {query}"""
        }],
        temperature=0.7
    )
    hypothetical_doc = response.choices[0].message.content

    # Step 2: Embed the hypothetical document (not the query)
    hyde_embedding = embedding_model.encode(hypothetical_doc)

    # Step 3: Search with the hypothetical document embedding
    results = vector_store.search(hyde_embedding, limit=top_k)

    return results, hypothetical_doc
```

### Why HyDE Works

The generated document, even if factually incorrect, is linguistically similar to real documents in the corpus. It uses the vocabulary, structure, and phrasing that actual documents use. This means its embedding is closer to relevant documents in the embedding space than the original query would be.

Gao et al. (2022) showed that HyDE improves retrieval on 11 out of 11 evaluation datasets, with particularly large gains on tasks where the query-document vocabulary gap is largest.

### HyDE Limitations and When to Avoid It

- **Latency**: Requires an LLM call before retrieval, adding 200-2000ms
- **Cost**: Every search query incurs an LLM API call
- **Hallucination risk**: If the LLM generates a plausible but wrong hypothetical document, retrieval may be biased toward documents that confirm the hallucination
- **Simple factual queries**: "What is the population of Tokyo?" doesn't benefit from HyDE -- the query is already in the right form
- **Best for**: Complex, conceptual queries where the information need is abstract ("How does attention mechanism differ from traditional sequence-to-sequence models?")

## Query Expansion and Transformation

### Multi-Query Retrieval

A single query may not capture all aspects of an information need. Multi-query retrieval generates multiple reformulations and retrieves against each:

```python
def multi_query_retrieval(
    query: str,
    vector_store,
    embedding_model,
    n_queries: int = 3,
    top_k: int = 10
) -> list[dict]:
    """Generate multiple query variants and merge results."""

    # Generate query variants
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{
            "role": "user",
            "content": f"""Generate {n_queries} different versions of this search query
            that capture different aspects or phrasings of the same information need.
            Return only the queries, one per line.

            Original query: {query}"""
        }]
    )
    queries = [query] + response.choices[0].message.content.strip().split('\n')

    # Retrieve for each query
    all_rankings = []
    for q in queries:
        embedding = embedding_model.encode(q)
        results = vector_store.search(embedding, limit=top_k * 2)
        all_rankings.append([r.id for r in results])

    # Fuse results using RRF
    fused = reciprocal_rank_fusion(all_rankings)

    return [vector_store.get(doc_id) for doc_id, _ in fused[:top_k]]
```

### Query Decomposition

For complex queries, decomposing into sub-queries can improve retrieval:

```python
def decompose_query(query: str) -> list[str]:
    """Decompose a complex query into simpler sub-queries."""
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{
            "role": "user",
            "content": f"""Break this complex question into simpler sub-questions that,
            when answered together, would answer the original question.
            Return only the sub-questions, one per line.

            Question: {query}"""
        }]
    )
    sub_queries = response.choices[0].message.content.strip().split('\n')
    return sub_queries

# Example:
# "How does transformer attention compare to LSTM for long sequences?"
# -> "How does transformer attention work?"
# -> "How do LSTMs process sequences?"
# -> "What are the limitations of LSTMs for long sequences?"
# -> "What are the limitations of transformers for long sequences?"
```

### Step-Back Prompting for Retrieval

Step-back prompting (Zheng et al., 2023) generates a more abstract version of the query before retrieval. Instead of searching for "Why does my Python Flask app crash with a 502 error on Heroku?", a step-back query might be "Common causes of 502 errors in Python web applications deployed to cloud platforms." The more abstract query is more likely to match general reference documents.

```python
def step_back_query(query: str) -> str:
    """Generate a more abstract version of the query."""
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{
            "role": "user",
            "content": f"""Given this specific question, generate a more general question
            that would help find background information useful for answering the original.

            Specific question: {query}
            General question:"""
        }]
    )
    return response.choices[0].message.content.strip()
```

## Adaptive Retrieval: Knowing When NOT to Retrieve

Not every query benefits from retrieval. A question like "What is 2 + 2?" or "Write a Python function to reverse a string" gains nothing from searching a knowledge base -- the LLM's parametric knowledge handles these perfectly. Worse, unnecessary retrieval introduces latency, cost, and the risk of injecting distracting or contradictory context. Adaptive retrieval systems learn to route queries between parametric knowledge (the LLM's internal knowledge) and retrieval-augmented generation based on query characteristics.

### Query Complexity Routing

The simplest approach classifies queries into categories and applies different retrieval strategies per category:

```python
class AdaptiveRetriever:
    """Route queries between parametric knowledge and retrieval."""

    def __init__(self, retrieval_pipeline, classifier, llm):
        self.retrieval_pipeline = retrieval_pipeline
        self.classifier = classifier
        self.llm = llm

    async def answer(self, query: str) -> dict:
        # Classify the query to determine retrieval strategy
        route = self.classifier.classify(query)

        if route == "parametric":
            # LLM can answer from internal knowledge
            return {"answer": await self.llm.generate(query), "source": "parametric"}
        elif route == "retrieval":
            # Standard RAG pipeline
            docs = await self.retrieval_pipeline.search(query)
            return {"answer": await self.llm.generate(query, context=docs), "source": "retrieval"}
        elif route == "structured":
            # Route to text-to-SQL or structured query engine
            return await self.structured_query(query)
        else:
            # Hybrid: retrieve but allow the model to ignore context if unhelpful
            docs = await self.retrieval_pipeline.search(query)
            return {"answer": await self.llm.generate(query, context=docs, allow_ignore=True), "source": "hybrid"}
```

The classifier can be a lightweight model (a fine-tuned DistilBERT or even a rule-based system) trained on examples of each category. Key signals include: query length and complexity, presence of domain-specific entities, whether the query asks for factual recall vs. reasoning, and whether the query references time-sensitive information.

### Self-RAG and Retrieval Tokens

Self-RAG (Asai et al., 2023) takes adaptive retrieval further by training the LLM itself to decide when to retrieve. The model is fine-tuned with special reflection tokens: `[Retrieve]` signals that retrieval is needed, `[No Retrieve]` signals that the model can answer from parametric knowledge, `[ISREL]` assesses whether a retrieved passage is relevant, and `[ISSUP]` checks whether the generated response is supported by the passage.

This approach unifies the retrieval decision with generation, eliminating the need for a separate classifier. The model learns that "What year was the Eiffel Tower built?" warrants retrieval while "Explain the concept of recursion" does not. On knowledge-intensive benchmarks, Self-RAG outperforms both always-retrieve and never-retrieve baselines by 5-10% on factual accuracy, while reducing retrieval calls by 30-50%.

### Confidence-Based Routing

A practical middle ground uses the LLM's own confidence as a retrieval signal. Generate an initial answer without retrieval, then assess confidence through verbalized probability or token-level entropy. If confidence is low, trigger retrieval and regenerate:

```python
async def confidence_based_retrieval(query: str, llm, retriever, threshold: float = 0.7):
    """Retrieve only when the model is uncertain."""
    # First pass: answer without retrieval
    initial = await llm.generate(
        f"Answer this question. Rate your confidence 0-1.\nQuestion: {query}"
    )
    confidence = extract_confidence(initial)

    if confidence >= threshold:
        return {"answer": initial, "retrieved": False}

    # Low confidence: retrieve and regenerate
    docs = await retriever.search(query)
    augmented = await llm.generate(query, context=docs)
    return {"answer": augmented, "retrieved": True}
```

The threshold requires tuning per domain. For medical or legal applications where accuracy is critical, a lower threshold (triggering more retrieval) is appropriate. For creative or general-knowledge tasks, a higher threshold reduces unnecessary latency. For more sophisticated self-correcting retrieval patterns, including iterative refinement loops, see [Article 17: Advanced RAG](/advanced-rag).

## Structured Data Retrieval

Many real-world knowledge bases contain structured data -- relational databases, knowledge graphs, spreadsheets, API endpoints -- alongside unstructured text. A complete retrieval strategy must handle both modalities and, critically, know when to route a query to structured retrieval rather than vector search.

### Text-to-SQL

Text-to-SQL converts natural language questions into SQL queries against a relational database. Modern LLMs have made this dramatically more practical, but the challenge lies in grounding the model's output in the actual schema:

```python
def text_to_sql_retrieval(
    query: str,
    schema: str,
    db_connection,
    llm
) -> dict:
    """Convert a natural language query to SQL and execute it."""

    prompt = f"""Given this database schema:
{schema}

Convert this question to a SQL query. Return ONLY the SQL, no explanation.
Use standard SQL syntax. Do not use functions not supported by the database.

Question: {query}
SQL:"""

    sql = llm.generate(prompt).strip()

    # Safety: validate the generated SQL
    if not is_safe_query(sql):  # Check for DROP, DELETE, UPDATE, etc.
        raise ValueError(f"Unsafe SQL generated: {sql}")

    results = db_connection.execute(sql)
    return {"sql": sql, "results": results}
```

The schema description is itself a retrieval problem at scale. With hundreds of tables, you cannot fit the full schema into the prompt. Schema retrieval -- selecting the relevant tables and columns based on the query -- becomes a prerequisite. Techniques include embedding table/column descriptions and retrieving the most relevant ones, or using a two-stage approach where a first LLM call identifies relevant tables before a second call generates SQL.

### Table Question Answering

Not all structured data lives in SQL databases. Table QA handles CSV files, spreadsheets, and tabular data embedded within documents. Models like TAPAS (Herzig et al., 2020) and more recently LLM-based approaches can reason over tables directly. The key challenge is representing tabular structure in a way the model can process -- linearizing tables into text while preserving row/column relationships.

For tables extracted from documents during chunking (see [Article 15: Chunking Strategies](/chunking-strategies)), storing both the raw table and a text summary enables hybrid retrieval: the summary matches semantic queries while the structured representation supports precise lookups.

### Integrating Structured and Unstructured Retrieval

The most capable RAG systems unify structured and unstructured retrieval behind a single query interface. The router examines the query and dispatches to the appropriate backend:

- "What were Q3 2024 revenues?" routes to text-to-SQL against a financial database
- "Explain the revenue growth strategy" routes to vector search over earnings call transcripts
- "How did Q3 revenue compare to the forecast from the analyst report?" requires both: SQL for the actual figure, vector search for the forecast, and synthesis across both

This routing can be implemented as part of the adaptive retrieval classifier described above, adding "structured" as a query category. The key insight is that structured retrieval is not a replacement for RAG but a complement -- most real-world questions require reasoning across both structured facts and unstructured context. For agentic approaches to multi-source retrieval, where the system iteratively decides which sources to query, see [Article 17: Advanced RAG](/advanced-rag).

## Retrieval-Aware Prompting

How you present retrieved documents to the LLM significantly impacts answer quality.

### Document Ordering

Research by Liu et al. (2023) in "Lost in the Middle" demonstrated that LLMs are sensitive to the position of relevant information in the context. Models tend to better utilize information presented at the beginning or end of the context, with degraded performance for information in the middle. Practical implications:

- Place the most relevant documents first and last
- Consider duplicating the most relevant document at both positions
- For long contexts with many documents, alternate relevant and less-relevant documents

### Citation and Grounding

Instruct the LLM to cite its sources by chunk ID or index, enabling verification:

```python
def rag_prompt(query: str, documents: list[dict]) -> str:
    """Build a RAG prompt with citation instructions."""
    context = "\n\n".join([
        f"[Document {i+1}]: {doc['text']}"
        for i, doc in enumerate(documents)
    ])

    return f"""Answer the question based on the provided documents.
Cite your sources using [Document N] notation.
If the documents don't contain enough information, say so.

Documents:
{context}

Question: {query}
Answer:"""
```

## Putting It All Together: A Multi-Stage Pipeline

```python
class AdvancedRetrievalPipeline:
    """Production retrieval pipeline with multiple stages."""

    async def retrieve(self, query: str, top_k: int = 5) -> list[dict]:
        # Stage 0: Query analysis and transformation
        query_type = self.classify_query(query)

        if query_type == "complex":
            sub_queries = decompose_query(query)
            queries = [query] + sub_queries
        elif query_type == "conceptual":
            hyde_doc = self.generate_hyde(query)
            queries = [query, hyde_doc]
        else:
            queries = [query]

        # Stage 1: Multi-source retrieval
        all_rankings = []
        for q in queries:
            vector_results = await self.vector_store.search(q, limit=top_k * 5)
            bm25_results = await self.bm25_index.search(q, limit=top_k * 5)
            all_rankings.extend([
                [r.id for r in vector_results],
                [r.id for r in bm25_results]
            ])

        # Stage 2: Fusion
        fused = reciprocal_rank_fusion(all_rankings)
        candidates = [self.get_document(doc_id) for doc_id, _ in fused[:top_k * 3]]

        # Stage 3: Reranking
        reranked = self.reranker.rerank(query, candidates, top_k=top_k)

        # Stage 4: Deduplication and diversity
        final = self.deduplicate_and_diversify(reranked, top_k)

        return final
```

## Summary and Key Takeaways

- **Hybrid search** (dense + sparse) outperforms either approach alone because they fail on different queries. This should be the default architecture.
- **BM25 remains essential** for exact term matching, rare entities, and domain-specific terminology. Don't discard it in favor of pure vector search.
- **Learned sparse retrieval (SPLADE)** bridges the gap between BM25 and dense retrieval by learning term expansion and importance weighting. It slots into existing sparse infrastructure and combines naturally with dense retrieval in hybrid pipelines.
- **Reciprocal Rank Fusion** is the simplest and most robust fusion method. Start with RRF before exploring learned fusion.
- **Cross-encoder reranking** provides the largest quality improvement per engineering hour. Even a simple reranker applied to top-30 candidates significantly improves top-5 precision.
- **ColBERT** offers a compelling middle ground between bi-encoder efficiency and cross-encoder quality, particularly for latency-sensitive applications. RAGatouille and PLAID make it practical to deploy without deep infrastructure expertise.
- **HyDE** is most valuable for complex, conceptual queries where query-document vocabulary gap is large. Avoid it for simple factual queries due to latency and cost overhead.
- **Adaptive retrieval** saves latency and cost by routing queries between parametric knowledge and retrieval based on complexity and confidence. Not every query needs a knowledge base lookup.
- **Structured data retrieval** (text-to-SQL, table QA) is a necessary complement to vector search for knowledge bases that span relational databases and unstructured documents.
- **Multi-query retrieval** is a low-cost, high-impact technique. Generating 3-5 query variants and fusing results consistently improves recall.
- **Query decomposition** is essential for complex, multi-faceted questions that no single retrieval hit can fully answer.
- The retrieval pipeline is not static: monitor retrieval quality metrics (recall@k, nDCG) and adapt strategies based on observed failure modes.

### Related Articles

- [Article 13: Embedding Models](/embedding-models) -- How embedding architecture and training objectives shape dense retrieval quality.
- [Article 14: Vector Databases](/vector-databases) -- Indexing algorithms and infrastructure for serving dense and ColBERT representations at scale.
- [Article 15: Chunking Strategies](/chunking-strategies) -- How document splitting decisions determine the upper bound on retrieval quality.
- [Article 17: Advanced RAG](/advanced-rag) -- Agentic retrieval loops, self-correcting pipelines, and multi-hop reasoning that build on the strategies covered here.
