# Search & Recommendations with LLMs

The integration of large language models into search and recommendation systems represents a paradigm shift from keyword matching and collaborative filtering to semantic understanding and generative retrieval. Modern systems combine dense embeddings, learned re-ranking, and LLM-powered query understanding to deliver results that feel almost telepathic. This article examines the architecture patterns, retrieval strategies, and production engineering behind LLM-powered search and recommendation systems.

## TL;DR

- **Hybrid retrieval** (BM25 + dense vectors with Reciprocal Rank Fusion) outperforms either approach alone — this is the production-recommended default for most systems
- **Re-ranking** with a cross-encoder or LLM dramatically improves precision at the top of results; the two-stage retrieve-then-rerank architecture is now standard
- **ColBERT** offers a practical middle ground between bi-encoder speed and cross-encoder quality using late interaction and per-token embeddings
- **SPLADE** bridges lexical and semantic search while staying compatible with existing inverted index infrastructure (Elasticsearch, OpenSearch)
- **Recommendation diversity** requires explicit design — MMR, exposure fairness, and exploration/exploitation balancing prevent filter bubbles

## Semantic Search Foundations

### From BM25 to Dense Retrieval

Traditional search relies on BM25 (Best Matching 25), a term-frequency-based scoring function that remains remarkably competitive despite its simplicity. BM25 counts how many query terms appear in a document, weighted by inverse document frequency and document length normalization.

Dense retrieval replaces term matching with semantic similarity in embedding space. Instead of asking "do the same words appear?", it asks "do these texts mean the same thing?"

```python
# Traditional BM25 vs. Dense Retrieval comparison

# BM25: Term matching
# Query: "python memory management"
# Matches: Documents containing "python", "memory", "management"
# Misses: "CPython garbage collector reference counting" (semantic match, no term overlap)

# Dense retrieval: Semantic matching
from sentence_transformers import SentenceTransformer
import numpy as np

model = SentenceTransformer('BAAI/bge-large-en-v1.5')

query_embedding = model.encode("python memory management")
doc_embeddings = model.encode([
    "CPython garbage collector reference counting",      # Semantically relevant
    "Python tutorial for beginners",                      # Keyword match, less relevant
    "Managing memory allocations in Python applications", # Both keyword and semantic
    "Java virtual machine memory model",                  # Related concept, wrong language
])

similarities = np.dot(doc_embeddings, query_embedding)
# Dense retrieval correctly ranks the semantic matches higher
```

The key models powering dense retrieval:

- **BGE (BAAI General Embedding)**: Strong open-source embedding models with instruction-tuned variants
- **E5 (Embeddings from bidirectional Encoder rEpresentations)**: Microsoft's embedding models trained with contrastive learning on diverse text pairs
- **Cohere Embed v3**: Commercial embedding model with int8 and binary quantization support
- **OpenAI text-embedding-3-large**: High-dimensional embeddings with Matryoshka representation learning for dimension reduction
- **Nomic Embed**: Open-source model with long context support (8192 tokens)

### Hybrid Retrieval

In practice, neither BM25 nor dense retrieval alone is optimal. Hybrid retrieval combines both:

```python
class HybridRetriever:
    def __init__(self, bm25_index, vector_index, alpha=0.5):
        self.bm25 = bm25_index
        self.vector = vector_index
        self.alpha = alpha  # Weight for dense vs. sparse

    def search(self, query, top_k=20):
        # Sparse retrieval (BM25)
        bm25_results = self.bm25.search(query, top_k=top_k * 2)
        bm25_scores = self.normalize_scores(bm25_results)

        # Dense retrieval (vector similarity)
        query_embedding = self.encoder.encode(query)
        vector_results = self.vector.search(query_embedding, top_k=top_k * 2)
        vector_scores = self.normalize_scores(vector_results)

        # Reciprocal Rank Fusion (RRF) - more robust than linear combination
        combined = self.reciprocal_rank_fusion(
            [bm25_results, vector_results],
            k=60,  # RRF constant
        )

        return combined[:top_k]

    def reciprocal_rank_fusion(self, result_lists, k=60):
        """Combine multiple ranked lists using RRF"""
        scores = defaultdict(float)
        for result_list in result_lists:
            for rank, (doc_id, _) in enumerate(result_list):
                scores[doc_id] += 1.0 / (k + rank + 1)

        return sorted(scores.items(), key=lambda x: -x[1])

    def normalize_scores(self, results):
        """Min-max normalization"""
        if not results:
            return results
        scores = [s for _, s in results]
        min_s, max_s = min(scores), max(scores)
        if max_s == min_s:
            return [(doc_id, 1.0) for doc_id, _ in results]
        return [(doc_id, (s - min_s) / (max_s - min_s)) for doc_id, s in results]
```

Reciprocal Rank Fusion (Cormack et al., 2009) is preferred over linear score combination because it doesn't require score calibration between different retrieval methods - it operates purely on rank positions.

## Re-Ranking with LLMs

### Cross-Encoder Re-Ranking

The retrieve-then-rerank pattern is fundamental to modern search. First-stage retrieval (BM25 + dense) is fast but coarse. A cross-encoder re-ranker then scores each candidate with full query-document attention:

```python
from sentence_transformers import CrossEncoder

# Cross-encoder scores query-document pairs jointly
reranker = CrossEncoder('BAAI/bge-reranker-v2-m3')

query = "how to handle errors in async python"
candidates = first_stage_retrieval(query, top_k=100)

# Score each candidate against the query
pairs = [(query, doc.text) for doc in candidates]
scores = reranker.predict(pairs)

# Re-rank by cross-encoder scores
reranked = sorted(zip(candidates, scores), key=lambda x: -x[1])
final_results = [doc for doc, score in reranked[:10]]
```

Cross-encoders are much slower than bi-encoders (they process query and document together rather than independently) but significantly more accurate because they can model fine-grained interactions between query and document tokens.

### LLM-Based Re-Ranking

Using instruction-following LLMs as re-rankers has emerged as a powerful approach. RankGPT (Sun et al., 2023) demonstrated that LLMs can perform listwise re-ranking by being given a list of passages and asked to order them by relevance:

```python
async def llm_rerank(query, documents, llm_client, window_size=20):
    """Sliding window listwise re-ranking with an LLM"""

    # Process in windows (LLMs struggle with very long lists)
    ranked_docs = list(documents)

    for start in range(0, len(ranked_docs), window_size // 2):
        window = ranked_docs[start:start + window_size]

        prompt = f"""Given the query: "{query}"

Rank the following {len(window)} passages from most relevant to least relevant.
Output only the passage numbers in order, separated by > symbols.

{chr(10).join(f'[{i+1}] {doc.text[:200]}' for i, doc in enumerate(window))}

Ranking:"""

        response = await llm_client.generate(prompt)
        # Parse ranking: "3 > 1 > 5 > 2 > 4"
        order = parse_ranking(response, len(window))

        # Apply the ranking to the window
        reordered_window = [window[i] for i in order]
        ranked_docs[start:start + window_size] = reordered_window

    return ranked_docs
```

### Cohere Rerank API

Cohere's Rerank API provides a production-ready re-ranking service that balances quality and latency:

```python
import cohere

co = cohere.Client("your-api-key")

results = co.rerank(
    query="What is the capital of France?",
    documents=[
        "Paris is the capital of France.",
        "London is the capital of England.",
        "The Eiffel Tower is in Paris.",
        "France is a country in Europe.",
    ],
    model="rerank-english-v3.0",
    top_n=3,
)

for result in results.results:
    print(f"Score: {result.relevance_score:.4f} | {result.document.text}")
```

## Query Understanding

### Query Expansion and Reformulation

LLMs excel at understanding user intent and expanding queries to improve recall:

```python
class LLMQueryProcessor:
    def __init__(self, llm_client):
        self.llm = llm_client

    async def expand_query(self, original_query):
        """Generate multiple query formulations to improve recall"""
        response = await self.llm.generate(
            prompt=f"""Given the search query: "{original_query}"

Generate 3 alternative formulations that capture the same intent
but use different vocabulary. Also identify:
1. Key entities mentioned
2. The likely intent (navigational, informational, transactional)
3. Any implicit constraints

Format as JSON.""",
        )

        expansions = parse_json(response)
        return expansions

    async def decompose_complex_query(self, query):
        """Break complex queries into sub-queries"""
        response = await self.llm.generate(
            prompt=f"""The user searched for: "{query}"

This appears to be a complex query. Break it down into simpler
sub-queries that, when combined, would answer the original question.

Return a JSON array of sub-queries with their relationship
(AND/OR) to the original.""",
        )
        return parse_json(response)

# Example:
# Input: "best laptop under $1000 for machine learning with good battery"
# Output: {
#   "intent": "transactional",
#   "entities": ["laptop"],
#   "constraints": {"price": "<1000", "use_case": "machine learning", "feature": "good battery"},
#   "reformulations": [
#     "budget laptop for deep learning training",
#     "affordable ML development notebook long battery life",
#     "laptop GPU machine learning under 1000 dollars"
#   ],
#   "sub_queries": [
#     {"query": "laptops with GPU under $1000", "relation": "AND"},
#     {"query": "laptop battery life comparison", "relation": "AND"},
#     {"query": "machine learning laptop requirements", "relation": "CONTEXT"}
#   ]
# }
```

### Hypothetical Document Embeddings (HyDE)

HyDE (Gao et al., 2022) is a clever technique that uses an LLM to generate a hypothetical answer to the query, then uses that answer's embedding for retrieval instead of the query embedding:

```python
async def hyde_search(query, llm_client, encoder, vector_store, top_k=10):
    """Hypothetical Document Embedding search"""

    # Step 1: Generate a hypothetical answer
    hypothetical_doc = await llm_client.generate(
        prompt=f"Write a passage that answers the following question: {query}",
        max_tokens=200,
    )

    # Step 2: Encode the hypothetical answer (not the query)
    hyde_embedding = encoder.encode(hypothetical_doc)

    # Step 3: Search with the hypothetical document embedding
    results = vector_store.search(hyde_embedding, top_k=top_k)

    return results

# Why this works:
# - Query: "what causes aurora borealis" (short, question format)
# - Hypothetical doc: "Aurora borealis, or northern lights, are caused by
#   charged particles from the sun interacting with gases in Earth's
#   atmosphere..." (looks like a real document)
# - The hypothetical doc's embedding is closer to real relevant documents
#   than the query embedding would be
```

HyDE works because document-to-document similarity is generally more reliable than query-to-document similarity, since queries and documents live in different "styles" of language.

## Personalization

### User Embedding Models

Personalization in LLM-powered search requires representing user preferences in a way that can interact with content embeddings:

```python
class UserEmbeddingModel:
    def __init__(self, content_encoder, user_dim=256):
        self.content_encoder = content_encoder
        self.user_history_encoder = TransformerEncoder(
            input_dim=content_encoder.output_dim,
            output_dim=user_dim,
            num_layers=2,
        )
        self.projection = nn.Linear(user_dim, content_encoder.output_dim)

    def compute_user_embedding(self, interaction_history):
        """Compute user embedding from interaction history"""
        # Encode interacted items
        item_embeddings = torch.stack([
            self.content_encoder.encode(item)
            for item in interaction_history
        ])

        # Weight by recency and interaction type
        weights = self.compute_attention_weights(interaction_history)
        weighted_embeddings = item_embeddings * weights.unsqueeze(-1)

        # Aggregate into user embedding
        user_emb = self.user_history_encoder(weighted_embeddings)
        return self.projection(user_emb)

    def personalized_search(self, query, user_embedding, alpha=0.3):
        """Blend query relevance with personalization"""
        query_embedding = self.content_encoder.encode(query)

        # Interpolate between query and user preference
        personalized_query = (
            (1 - alpha) * query_embedding +
            alpha * user_embedding
        )

        return self.vector_store.search(personalized_query)
```

### LLM-Based Personalization

LLMs can incorporate user context directly in the prompt for personalized results:

```python
async def personalized_rerank(query, results, user_profile, llm_client):
    """Re-rank results based on user profile and preferences"""

    profile_summary = f"""User Profile:
- Role: {user_profile.role} ({user_profile.experience_level})
- Interests: {', '.join(user_profile.interests)}
- Past purchases: {', '.join(user_profile.recent_purchases[:5])}
- Preferred brands: {', '.join(user_profile.preferred_brands)}
- Price sensitivity: {user_profile.price_sensitivity}
"""

    response = await llm_client.generate(
        prompt=f"""{profile_summary}

Given this user's profile, re-rank these search results for the
query "{query}" from most to least relevant for THIS specific user.

Results:
{format_results(results)}

Consider the user's experience level, interests, and preferences
when ranking. A result that's generally relevant but doesn't match
this user's level or interests should be ranked lower.

Output the result IDs in order:""",
    )

    return parse_and_reorder(response, results)
```

## Embedding-Based Recommendations

### Content-Based Recommendations

The simplest recommendation approach uses content embeddings to find similar items:

```python
class EmbeddingRecommender:
    def __init__(self, item_embeddings, item_metadata):
        self.embeddings = item_embeddings  # {item_id: np.array}
        self.metadata = item_metadata
        self.index = self.build_ann_index()

    def similar_items(self, item_id, top_k=10, filters=None):
        """Find items similar to a given item"""
        query_embedding = self.embeddings[item_id]
        candidates = self.index.search(query_embedding, top_k=top_k * 3)

        # Apply filters (category, price range, availability)
        if filters:
            candidates = [
                (id, score) for id, score in candidates
                if self.passes_filters(id, filters)
            ]

        return candidates[:top_k]

    def user_recommendations(self, user_interactions, top_k=20):
        """Recommend items based on user's interaction history"""
        # Compute user preference vector as weighted average
        # of interacted item embeddings
        weights = []
        embeddings = []
        for interaction in user_interactions:
            weight = self.interaction_weight(interaction)
            embeddings.append(self.embeddings[interaction.item_id])
            weights.append(weight)

        weights = np.array(weights)
        weights = weights / weights.sum()
        user_vector = np.average(embeddings, axis=0, weights=weights)

        # Find items close to user preference vector
        candidates = self.index.search(user_vector, top_k=top_k * 3)

        # Filter out already-interacted items
        seen = {i.item_id for i in user_interactions}
        candidates = [(id, s) for id, s in candidates if id not in seen]

        return candidates[:top_k]

    def interaction_weight(self, interaction):
        """Weight interactions by type and recency"""
        type_weights = {
            "purchase": 5.0,
            "add_to_cart": 3.0,
            "long_view": 2.0,  # Viewed for >30s
            "click": 1.0,
            "impression": 0.1,
        }
        recency_decay = np.exp(-0.01 * interaction.days_ago)
        return type_weights.get(interaction.type, 1.0) * recency_decay
```

### Collaborative Filtering Meets LLMs

Traditional collaborative filtering (CF) finds users with similar behavior patterns and recommends what those similar users liked. LLMs can enhance CF in several ways:

**LLM-enriched item representations**: Instead of using sparse interaction data alone, use LLMs to generate rich item descriptions from metadata, reviews, and content:

```python
async def enrich_item_embedding(item, llm_client, encoder):
    """Create a rich item embedding by combining structured metadata
    with LLM-generated descriptions"""

    # Generate a comprehensive item description
    description = await llm_client.generate(
        prompt=f"""Describe this product in a way that captures its
key characteristics, target audience, and use cases:

Title: {item.title}
Category: {item.category}
Price: ${item.price}
Specs: {item.specs}
Top review excerpts: {item.top_reviews[:3]}

Write 2-3 sentences:""",
    )

    # Combine structured features with semantic embedding
    text_embedding = encoder.encode(description)
    categorical_features = encode_categorical(item.category, item.brand)
    numerical_features = normalize([item.price, item.rating, item.review_count])

    combined = np.concatenate([
        text_embedding * 0.6,
        categorical_features * 0.25,
        numerical_features * 0.15,
    ])

    return combined / np.linalg.norm(combined)
```

**Conversational recommendations**: LLMs can elicit preferences through dialogue rather than relying solely on behavioral data:

```text
User: I'm looking for a new book to read
Bot:  I'd love to help! To give you a great recommendation:
      - What genres do you enjoy? (fiction, non-fiction, sci-fi, etc.)
      - What's the last book you really loved?
      - Are you in the mood for something light or thought-provoking?

User: I loved Project Hail Mary. Something similar but maybe more
      philosophical.

Bot:  Based on your love of Project Hail Mary's mix of science,
      problem-solving, and heart, here are some recommendations
      that lean more philosophical:

      1. "Blindsight" by Peter Watts - Hard sci-fi that deeply
         explores consciousness and what it means to be intelligent
      2. "Children of Time" by Adrian Tchaikovsky - Evolution and
         intelligence from a non-human perspective
      3. "The Three-Body Problem" by Liu Cixin - Physics-driven
         sci-fi with deep philosophical undertones

      Which of these sounds most interesting to you?
```

## Production Search Architecture

### System Architecture

A production LLM-powered search system has multiple layers:

```text
User Query
    |
    v
[Query Processing Layer]
  - Query understanding (intent, entities)
  - Query expansion (HyDE, reformulation)
  - Spell correction and normalization
    |
    v
[Retrieval Layer - fast, high recall]
  - BM25 (Elasticsearch/OpenSearch)
  - Dense retrieval (vector DB: Pinecone, Weaviate, Qdrant)
  - Reciprocal Rank Fusion to combine
  - Target: retrieve top 100-500 candidates in <50ms
    |
    v
[Re-Ranking Layer - slower, high precision]
  - Cross-encoder re-ranking (top 100 -> top 20)
  - Optional: LLM re-ranking (top 20 -> top 10)
  - Personalization adjustments
  - Business rule application (boosting, filtering)
  - Target: <200ms for cross-encoder, <1s for LLM
    |
    v
[Presentation Layer]
  - Result formatting
  - Snippet generation / highlight extraction
  - Optional: LLM-generated answer synthesis (RAG)
  - Facet computation
    |
    v
User Results
```

### Indexing Pipeline

```python
class SearchIndexingPipeline:
    def __init__(self):
        self.text_processor = TextProcessor()
        self.embedding_model = SentenceTransformer('BAAI/bge-large-en-v1.5')
        self.bm25_index = ElasticsearchIndex()
        self.vector_index = QdrantIndex()

    async def index_document(self, document):
        # 1. Extract and clean text
        text = self.text_processor.extract(document)
        chunks = self.text_processor.chunk(
            text,
            chunk_size=512,
            chunk_overlap=50,
            strategy="semantic",  # Split at paragraph/section boundaries
        )

        # 2. Generate embeddings
        embeddings = self.embedding_model.encode(
            [chunk.text for chunk in chunks],
            batch_size=32,
            show_progress_bar=False,
        )

        # 3. Index in both stores (parallel)
        await asyncio.gather(
            self.bm25_index.index(document.id, chunks),
            self.vector_index.upsert([
                {
                    "id": f"{document.id}_{i}",
                    "vector": embedding.tolist(),
                    "payload": {
                        "document_id": document.id,
                        "chunk_index": i,
                        "text": chunk.text,
                        "metadata": document.metadata,
                    },
                }
                for i, (chunk, embedding) in enumerate(zip(chunks, embeddings))
            ]),
        )

    async def bulk_index(self, documents, batch_size=100):
        """Index documents in batches for efficiency"""
        for batch in chunked(documents, batch_size):
            await asyncio.gather(*[
                self.index_document(doc) for doc in batch
            ])
```

### Embedding Model Selection and Evaluation

Choosing the right embedding model requires evaluation on your specific domain:

```python
class EmbeddingModelEvaluator:
    def __init__(self, test_queries, relevance_judgments):
        self.queries = test_queries
        self.judgments = relevance_judgments  # {query_id: {doc_id: relevance}}

    def evaluate_model(self, model_name, encoder):
        metrics = {
            "ndcg@10": [],
            "mrr": [],
            "recall@100": [],
            "encoding_speed": [],
            "embedding_dim": encoder.get_sentence_embedding_dimension(),
        }

        for query in self.queries:
            # Measure encoding speed
            start = time.time()
            query_emb = encoder.encode(query.text)
            metrics["encoding_speed"].append(time.time() - start)

            # Retrieve and evaluate
            results = self.vector_store.search(query_emb, top_k=100)
            relevant = self.judgments[query.id]

            metrics["ndcg@10"].append(
                ndcg_score(results[:10], relevant)
            )
            metrics["mrr"].append(
                reciprocal_rank(results, relevant)
            )
            metrics["recall@100"].append(
                recall(results[:100], relevant)
            )

        return {k: np.mean(v) for k, v in metrics.items()}
```

Key evaluation metrics:
- **NDCG@k** (Normalized Discounted Cumulative Gain): Measures ranking quality, accounting for position
- **MRR** (Mean Reciprocal Rank): Where the first relevant result appears
- **Recall@k**: What fraction of relevant documents are in the top k results
- **Latency**: Encoding speed and search speed matter for production

### Scaling Vector Search

Production vector search at scale (millions to billions of embeddings) requires careful engineering:

**Approximate Nearest Neighbor (ANN) algorithms**:
- **HNSW** (Hierarchical Navigable Small World): Best recall/speed tradeoff for most use cases. Used by Qdrant, Weaviate, pgvector.
- **IVF** (Inverted File Index): Partitions the space into clusters. Good for very large datasets. Used by FAISS.
- **ScaNN** (Scalable Nearest Neighbors): Google's library optimized for high-dimensional vectors.

**Quantization** reduces memory and improves speed:
- **Product Quantization (PQ)**: Compress 768-dim float32 vectors from 3KB to ~64 bytes
- **Binary Quantization**: Reduce to 1 bit per dimension (96 bytes for 768-dim), 32x memory reduction with ~5% recall loss
- **Matryoshka embeddings**: Models like text-embedding-3 support truncating dimensions (e.g., use 256 dims instead of 3072) with graceful quality degradation

```python
# Qdrant with quantization for cost-effective large-scale search
from qdrant_client import QdrantClient
from qdrant_client.models import (
    VectorParams, Distance, QuantizationConfig,
    ScalarQuantization, ScalarType,
)

client = QdrantClient(url="http://localhost:6333")

client.create_collection(
    collection_name="products",
    vectors_config=VectorParams(
        size=1024,
        distance=Distance.COSINE,
    ),
    quantization_config=QuantizationConfig(
        scalar=ScalarQuantization(
            type=ScalarType.INT8,
            quantile=0.99,
            always_ram=True,  # Keep quantized vectors in RAM
        ),
    ),
    # Enable on-disk storage for original vectors (used for re-scoring)
    on_disk_payload=True,
)
```

## ColBERT and Late Interaction Models

### The Retrieval Accuracy-Efficiency Tradeoff

The standard retrieve-then-rerank architecture relies on a sharp division of labor:

- **Bi-encoders** (fast, independent encoding of queries and documents) handle first-stage retrieval
- **Cross-encoders** (slow, joint encoding of query-document pairs) handle re-ranking

This works, but creates a structural bottleneck. The bi-encoder's single-vector representation compresses an entire document into one point in embedding space, inevitably losing fine-grained token-level information. The cross-encoder recovers that information but at a cost that limits it to scoring a few hundred candidates at most.

Late interaction models, pioneered by ColBERT (Khattab & Zaharia, 2020), occupy the middle ground. Instead of compressing a document into a single vector, ColBERT produces one embedding per token for both query and document. At search time, each query token finds its maximum similarity against all document tokens, and these per-token scores are summed to produce a final relevance score. This "MaxSim" operation preserves token-level matching while remaining decomposable — document token embeddings can be precomputed and indexed offline.

```python
import torch

class ColBERTScorer:
    """Simplified ColBERT-style late interaction scoring"""

    def maxsim_score(self, query_embeddings, doc_embeddings):
        """
        query_embeddings: (num_query_tokens, dim)
        doc_embeddings: (num_doc_tokens, dim)

        For each query token, find max similarity across all doc tokens,
        then sum. This preserves token-level matching granularity.
        """
        # Compute all pairwise similarities
        similarity_matrix = torch.matmul(
            query_embeddings, doc_embeddings.T
        )  # (num_query_tokens, num_doc_tokens)

        # Max similarity for each query token
        max_similarities = similarity_matrix.max(dim=1).values

        # Sum across query tokens
        return max_similarities.sum().item()
```

The practical result is significant: ColBERT typically achieves 95% or more of cross-encoder quality while being 100-1000x faster at scoring, because the expensive per-token encoding is done offline during indexing. Only the lightweight MaxSim aggregation happens at query time.

> **Tip:** ColBERT is worth evaluating for domains where exact term matching matters alongside semantics — legal search, medical literature, and technical documentation all benefit from token-level granularity that single-vector bi-encoders compress away.

### Deploying ColBERT in Practice

The main deployment challenge with ColBERT is storage. A single-vector model stores one 768-dimensional vector per passage. ColBERT stores one 128-dimensional vector per token -- for a 200-token passage, that is 200 vectors. On a corpus of 10 million passages, this can reach hundreds of gigabytes.

ColBERTv2 (Santhanam et al., 2022) addressed this with residual compression: instead of storing full per-token embeddings, it clusters them and stores only the residual difference from the cluster centroid, reducing storage by 6-10x with minimal quality loss. The PLAID engine further optimized this with centroid-based candidate pruning, enabling ColBERT to serve as a first-stage retriever rather than just a re-ranker.

For teams evaluating late interaction models, the RAGatouille library provides a practical entry point, wrapping ColBERTv2 with a scikit-learn-style API that handles indexing, compression, and search. If your domain involves queries where exact term matching matters alongside semantic understanding -- legal search, medical literature, technical documentation -- ColBERT-style models are worth serious evaluation. For a deeper treatment of embedding architectures and training objectives, see [Article 13: Embedding Models](/embedding-models). For the ANN indexing infrastructure that supports multi-vector retrieval, see [Article 14: Vector Databases](/vector-databases).

## Learned Sparse Retrieval

### SPLADE and the Sparse-Dense Convergence

BM25 has a property that dense retrieval models lack: explicit, interpretable term matching. When BM25 fails to retrieve a relevant document, you can inspect the term overlap and understand exactly why. Dense models are opaque -- a document might be missed because its embedding landed in a distant region of the space, and there is no clear diagnostic path.

Learned sparse retrieval models, most notably SPLADE (SParse Lexical AnD Expansion model, Formal et al., 2021), bring the advantages of neural learning to the sparse retrieval paradigm. SPLADE uses a masked language model (typically a BERT variant) to produce a sparse vector for each document, where dimensions correspond to vocabulary terms and values represent learned term importance weights. Critically, the model learns to expand documents with semantically related terms that do not appear in the original text.

```python
# Conceptual SPLADE representation
# Document: "The cat sat on the mat"
# BM25 representation (only exact terms):
bm25_sparse = {
    "cat": 1.2, "sat": 0.8, "mat": 1.1
    # stopwords removed
}

# SPLADE representation (learned expansion + importance):
splade_sparse = {
    "cat": 2.1, "sat": 0.5, "mat": 1.8,
    "feline": 1.4,        # Learned expansion
    "kitten": 0.9,        # Learned expansion
    "rug": 0.7,           # Learned expansion (mat -> rug)
    "animal": 1.1,        # Learned expansion
    "sitting": 0.6,       # Morphological expansion
    "pet": 0.8,           # Learned expansion
    # Hundreds of other terms with small but non-zero weights
}
```

The key innovation is that SPLADE representations can be stored and searched using standard inverted indexes -- the same infrastructure that powers Elasticsearch, OpenSearch, and Lucene. This means teams with mature BM25 infrastructure can adopt learned sparse retrieval without replacing their search stack. Both Elasticsearch and OpenSearch now support ELSER (Elastic Learned Sparse EncodeR) and neural sparse search respectively, bringing learned sparse retrieval into managed services.

### When Learned Sparse Beats Dense

Learned sparse retrieval excels in scenarios where lexical precision matters. In e-commerce search, a query for "iPhone 15 Pro Max 256GB" needs exact matching on model numbers and specifications -- dense models may retrieve the right product family but confuse variants. In legal and compliance search, specific statutory references, case numbers, and defined terms carry precise meaning that single-vector compression can lose. SPLADE handles these cases naturally because its vocabulary-aligned representation preserves individual term signals while adding semantic expansion.

In hybrid retrieval pipelines, SPLADE can replace BM25 as the sparse component, improving the quality of the sparse retrieval signal without changing the fusion architecture. Teams already running hybrid search with BM25 + dense retrieval can substitute SPLADE for BM25, use the same Reciprocal Rank Fusion strategy, and typically see 3-8% improvement in retrieval recall. For how this fits into multi-stage RAG pipelines, see [Article 17: Advanced RAG](/advanced-rag).

## MTEB and Embedding Model Evaluation

### Navigating the MTEB Leaderboard

The Massive Text Embedding Benchmark (Muennighoff et al., 2023) standardized how the community evaluates embedding models, testing them across dozens of datasets spanning retrieval, classification, clustering, pair classification, re-ranking, summarization, and semantic textual similarity. The MTEB leaderboard on Hugging Face has become the default reference point for model selection, but interpreting it correctly requires care.

Several pitfalls catch teams that select models purely by leaderboard rank:

- **Task mismatch**: MTEB aggregates scores across very different tasks. A model that dominates classification and clustering may underperform on retrieval. Always filter by the retrieval subset (BEIR benchmark) for search and recommendation use cases
- **Domain gap**: MTEB evaluates on general-domain datasets. A model ranked first on MTEB may underperform a lower-ranked model fine-tuned on your domain. Financial, medical, legal, and scientific text each have vocabulary patterns that general-purpose models struggle with
- **Multilingual considerations**: If your system serves multiple languages, filter for multilingual models and check per-language performance. A monolingual model for your primary language may outperform a multilingual model on that specific language
- **Model size vs. quality tradeoffs**: The top of the leaderboard is dominated by large models (1B+ parameters) that are impractical for latency-sensitive production search. Models in the 100-350M parameter range (e.g., bge-large, e5-large-v2, gte-large) typically offer the best quality-per-FLOP for online serving

> **Note:** MTEB rank is a starting filter, not a final answer. Always evaluate on domain-specific data before committing to an embedding model in production.

For a comprehensive treatment of embedding architectures, training objectives, and fine-tuning strategies, see [Article 13: Embedding Models](/embedding-models).

### Practical Model Selection Workflow

A disciplined selection process starts broad and narrows quickly:

1. **Define your task**: retrieval, similarity, clustering, or classification. Filter MTEB accordingly.
2. **Set constraints**: maximum model size, maximum latency budget, required language support, deployment target (GPU, CPU, edge).
3. **Shortlist 3-5 candidates** from MTEB that meet your constraints.
4. **Evaluate on domain data**: use at least 200 representative queries with relevance judgments from your domain. Automated relevance labels from a strong LLM (GPT-4 or Claude) can bootstrap this process, but human review of edge cases is important.
5. **Measure operational metrics**: encoding throughput (queries per second, documents per second), memory footprint, and index build time. A model with 2% better NDCG but 5x slower encoding may not be the right choice.
6. **Test quantization tolerance**: if you plan to use int8, binary, or Matryoshka dimension reduction, evaluate quality after compression, not before. Some models degrade gracefully; others collapse.

## Recommendation Fairness and Diversity

### The Filter Bubble Problem

Embedding-based recommendation systems have a structural tendency toward homogeneity. The user embedding model computes a preference vector as a weighted average of interacted item embeddings, then retrieves items nearest to that vector. This creates a feedback loop: the user interacts with recommended items, which reinforces the preference vector, which produces more similar recommendations.

Over time, exposure narrows:

- A reader who clicked on a few Python web framework articles will see their feed converge on Flask and Django tutorials, even if they would enjoy systems programming or data engineering content
- In e-commerce, a customer who purchased running shoes may be shown nothing but running gear, missing cross-sell opportunities in adjacent categories

> **Note:** In high-stakes contexts like news, job listings, housing, and lending, filter bubbles become fairness issues — not just product quality problems. A job recommendation system that narrows candidates' exposure to roles similar to their past positions can entrench occupational segregation. See [Article 46: Bias, Fairness & Responsible AI](/bias-fairness).

### Diversity-Aware Retrieval

Several techniques break the feedback loop without abandoning relevance:

**Maximal Marginal Relevance (MMR)** re-ranks results by balancing relevance to the query against redundancy with already-selected results:

```python
def mmr_rerank(query_embedding, candidate_embeddings, candidate_docs,
               lambda_param=0.5, top_k=10):
    """Maximal Marginal Relevance: balance relevance and diversity"""
    selected = []
    remaining = list(range(len(candidate_docs)))

    for _ in range(top_k):
        best_score = -float('inf')
        best_idx = None

        for idx in remaining:
            # Relevance to query
            relevance = cosine_similarity(
                query_embedding, candidate_embeddings[idx]
            )

            # Maximum similarity to any already-selected item
            if selected:
                redundancy = max(
                    cosine_similarity(
                        candidate_embeddings[idx],
                        candidate_embeddings[s]
                    )
                    for s in selected
                )
            else:
                redundancy = 0.0

            # MMR score: relevance minus redundancy
            mmr_score = lambda_param * relevance - (1 - lambda_param) * redundancy

            if mmr_score > best_score:
                best_score = mmr_score
                best_idx = idx

        selected.append(best_idx)
        remaining.remove(best_idx)

    return [candidate_docs[i] for i in selected]
```

**Exposure fairness** ensures that items from different providers, categories, or demographic groups receive proportional visibility. In a job recommendation system, this might mean ensuring that job postings from employers of different sizes, industries, and locations receive fair representation rather than letting a few dominant employers monopolize the recommendation slots. Calibrated exposure targets -- ensuring each group receives recommendation share proportional to its relevance, not just its popularity -- can be enforced as constraints during the re-ranking step.

**Exploration-exploitation balancing** borrows from the multi-armed bandit literature. Instead of always recommending the highest-scoring items, the system occasionally introduces items with high uncertainty (items the model has not seen enough interactions with to be confident about) alongside high-confidence recommendations. Thompson sampling and epsilon-greedy strategies are straightforward to implement on top of an existing re-ranking pipeline:

```python
class DiverseRecommender:
    def __init__(self, base_recommender, exploration_rate=0.1):
        self.recommender = base_recommender
        self.exploration_rate = exploration_rate

    def recommend(self, user, top_k=20):
        # Get base recommendations (exploitation)
        exploit_k = int(top_k * (1 - self.exploration_rate))
        exploit_items = self.recommender.recommend(user, top_k=exploit_k)

        # Sample from underexposed categories (exploration)
        explore_k = top_k - exploit_k
        underexposed = self.get_underexposed_categories(user)
        explore_items = self.sample_from_categories(
            underexposed, k=explore_k, strategy="thompson"
        )

        # Interleave to avoid clustering all exploration at the end
        return self.interleave(exploit_items, explore_items)
```

The tension between relevance and diversity is real but often overstated. In practice, moderate diversity interventions (10-20% exploration, MMR with lambda 0.5-0.7) typically improve long-term engagement metrics even as they slightly reduce short-term click-through rates. Users who discover new interests through diverse recommendations tend to be more active and retained than users whose feeds calcify around a narrow set of topics.

## Evaluation and Monitoring

### Online Metrics

Production search systems need continuous monitoring:

```python
class SearchMetrics:
    def track_search(self, query, results, user_actions):
        self.emit({
            # Query metrics
            "query_length": len(query.split()),
            "has_results": len(results) > 0,
            "num_results": len(results),

            # Engagement metrics
            "click_through_rate": user_actions.clicks / len(results),
            "mean_reciprocal_rank": self.mrr(user_actions.clicked_positions),
            "clicks_at_position": user_actions.clicked_positions,

            # Satisfaction proxies
            "reformulation_rate": user_actions.reformulated,  # User searched again
            "dwell_time": user_actions.time_on_clicked_result,
            "bounce_rate": user_actions.returned_to_results_quickly,

            # Performance
            "retrieval_latency_ms": results.retrieval_time,
            "reranking_latency_ms": results.reranking_time,
            "total_latency_ms": results.total_time,
        })
```

### Offline Evaluation

Regular offline evaluation ensures model and index quality:

1. **Build evaluation sets**: Collect query-relevance pairs from click logs, human annotations, or LLM-generated judgments
2. **Test retrieval recall**: Ensure the first-stage retriever captures relevant documents
3. **Test re-ranking precision**: Ensure the re-ranker correctly promotes relevant results
4. **Regression testing**: Compare new models/configs against baselines before deployment
5. **Freshness testing**: Verify that new content is discoverable within expected time frames

## Key Takeaways

- Start with **hybrid retrieval** (BM25 + dense + RRF) as your baseline — it outperforms pure BM25 and pure dense in nearly every domain without needing domain-specific tuning
- Add a **cross-encoder re-ranker** on top of first-stage retrieval before reaching for LLM re-ranking; cross-encoders give you most of the quality gain at a fraction of the cost
- If you're already on Elasticsearch or OpenSearch, **SPLADE is the fastest path to semantic search** — it integrates with your existing inverted index, no vector database required
- Build a **domain-specific evaluation set** (200+ queries with relevance judgments) before selecting an embedding model; MTEB leaderboard position is only a rough guide
- Design for **diversity from the start**: pure relevance optimization leads to filter bubbles that erode long-term user satisfaction; add MMR or exploration rate as a post-processing step
- Track **reformulation rate and dwell time** as production quality signals — low dwell + high reformulation indicates the ranking is returning superficially relevant but actually unhelpful results

## Related Articles

- [Article 13: Embedding Models](/embedding-models) -- Embedding architectures, training objectives, Matryoshka representations, and fine-tuning strategies that underpin the retrieval models discussed here
- [Article 14: Vector Databases](/vector-databases) -- ANN algorithms (HNSW, IVF, ScaNN), quantization, and production deployment patterns for the vector indexes powering dense and multi-vector retrieval
- [Article 17: Advanced RAG](/advanced-rag) -- Multi-hop retrieval, agentic RAG, and self-correcting pipelines that build on the search foundations covered in this article
- [Article 46: Bias, Fairness & Responsible AI](/bias-fairness) -- Systematic frameworks for identifying and mitigating bias, directly relevant to recommendation fairness and exposure parity
