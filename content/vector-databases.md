# Vector Databases: Indexing, ANN Search & Production Patterns

Vector databases have evolved from niche academic tools into critical infrastructure for AI applications, serving as the backbone for retrieval-augmented generation, semantic search, and recommendation systems. This article provides a deep technical examination of approximate nearest neighbor algorithms, production database architectures, and the operational patterns that determine success or failure when deploying vector search at scale. It builds on the embedding representations covered in [Article 13: Embedding Models](/embedding-models) and connects directly to the chunking decisions discussed in [Article 15: Chunking Strategies](/chunking-strategies) -- how you split your documents determines the size, number, and quality of vectors your database must index and search.

## The Nearest Neighbor Problem

At its core, a vector database solves the nearest neighbor problem: given a query vector q and a collection of N vectors, find the k vectors most similar to q. Exact nearest neighbor search (brute-force) computes similarity between the query and every vector in the collection -- O(N*d) for N vectors of dimension d. This becomes prohibitive at scale: scanning 100 million 768-dimensional vectors requires ~300 billion floating-point operations per query.

Approximate nearest neighbor (ANN) algorithms trade a small amount of accuracy for orders-of-magnitude speedup, typically achieving 95-99% recall (fraction of true nearest neighbors found) with sub-millisecond latency on millions of vectors.

## ANN Algorithms: The Core Primitives

### HNSW (Hierarchical Navigable Small World)

HNSW (Malkov and Yashunin, 2018) is the most widely deployed ANN algorithm, used as the default index in Pinecone, Weaviate, Qdrant, and pgvector. It constructs a multi-layer graph where each node is a vector, and edges connect similar vectors.

**Construction**: Vectors are inserted one at a time. Each vector is assigned a random maximum layer (exponentially distributed -- most vectors appear only in layer 0, few reach higher layers). At each layer, the algorithm performs a greedy search to find the nearest existing nodes, then creates bidirectional edges to the M closest neighbors.

**Search**: Starting from a fixed entry point at the highest layer, the algorithm performs greedy search at each layer, descending to the next layer at the local minimum. At layer 0 (the most dense), it performs a more thorough beam search with a configurable `efSearch` parameter controlling the search width.

```
Layer 3:  A -------- B                    (sparse, long-range links)
Layer 2:  A --- C -- B --- D              (medium density)
Layer 1:  A-C-E-B-D-F-G                   (denser, shorter links)
Layer 0:  A-C-E-H-B-D-F-G-I-J-K          (all vectors, short links)
```

**Key parameters**:
- `M` (max connections per node): Higher M = better recall, more memory. Typical: 16-64.
- `efConstruction` (beam width during construction): Higher = better graph quality, slower build. Typical: 128-512.
- `efSearch` (beam width during search): Higher = better recall, slower search. Tunable at query time.

**Trade-offs**: HNSW provides excellent recall-latency characteristics (>95% recall at sub-millisecond latency for million-scale datasets). The primary disadvantage is memory consumption -- the graph structure requires ~1KB per vector beyond the vector data itself. For 100M vectors at 768 dimensions, expect ~400GB total memory (300GB for vectors + 100GB for graph).

### IVF (Inverted File Index)

IVF partitions the vector space into clusters using k-means, then searches only the nearest clusters at query time.

**Construction**: Run k-means clustering on the vectors to create `nlist` centroids (typically sqrt(N) to 4*sqrt(N)). Assign each vector to its nearest centroid, creating an inverted list per cluster.

**Search**: Compute distances from the query to all centroids, select the `nprobe` nearest clusters, then exhaustively scan all vectors within those clusters.

```python
import faiss

d = 768  # dimension
nlist = 1000  # number of clusters

# Build index
quantizer = faiss.IndexFlatL2(d)
index = faiss.IndexIVFFlat(quantizer, d, nlist)
index.train(training_vectors)  # k-means training
index.add(vectors)

# Search with adjustable accuracy-speed trade-off
index.nprobe = 10  # search 10 nearest clusters (1% of total)
distances, indices = index.search(query_vectors, k=10)
```

**Trade-offs**: IVF is more memory-efficient than HNSW (no graph overhead) and allows disk-based storage of inverted lists. However, it requires a training step (k-means), and recall can degrade with skewed data distributions. At the same recall level, HNSW typically achieves lower latency.

### Product Quantization (PQ)

Product quantization compresses vectors by splitting each vector into subvectors and quantizing each subvector independently. This enables both memory reduction and fast distance computation via lookup tables.

**How it works**: Split a 768-dimensional vector into 96 subvectors of 8 dimensions each. For each subgroup, train a codebook of 256 centroids (1 byte per subvector). The compressed representation is 96 bytes instead of 3072 bytes (768 * 4 bytes per float32) -- a 32x compression.

**Distance computation**: Pre-compute distances from the query subvectors to all centroids in each codebook (96 * 256 = 24,576 lookups). Then approximate the full distance using table lookups and additions -- dramatically faster than computing actual float distances.

**IVF-PQ combination**: The most common production configuration combines IVF for coarse partitioning with PQ for compression within each partition. This enables billion-scale search with manageable memory:

```python
# IVF with PQ compression
m = 96  # number of subquantizers
nbits = 8  # bits per subquantizer (256 centroids)
index = faiss.IndexIVFPQ(quantizer, d, nlist, m, nbits)
index.train(training_vectors)
index.add(vectors)
```

**Trade-offs**: PQ introduces quantization error, reducing recall compared to exact representations. The trade-off is controlled by the number of subquantizers (more = better accuracy, more memory) and training data quality. Typically, PQ adds 2-5% recall loss but enables 10-30x memory reduction.

## Vector Database Comparison

### Pinecone

**Architecture**: Fully managed, serverless (as of 2024). Vectors are stored in distributed pods with automatic sharding and replication. The serverless architecture bills per query and storage rather than per pod-hour.

**Strengths**: Zero operational overhead, consistent performance, built-in metadata filtering, namespaces for multi-tenancy. The serverless model eliminates capacity planning.

**Limitations**: Proprietary, no self-hosting option. Limited control over indexing parameters. Higher per-query cost at very high throughput. Maximum metadata per vector and namespace constraints.

**Best for**: Teams wanting managed infrastructure, moderate scale (up to low billions of vectors), rapid prototyping-to-production.

### Weaviate

**Architecture**: Open-source, written in Go. Supports HNSW indexing with dynamic updates. Unique "modules" system for built-in vectorization (can call embedding APIs automatically).

**Strengths**: Built-in vectorization modules (OpenAI, Cohere, HuggingFace), GraphQL API, multi-modal support (images, text), hybrid search (BM25 + vector) built-in. Strong multi-tenancy with tenant-level isolation.

**Limitations**: HNSW-only indexing can be memory-intensive at large scale. Cluster management complexity. Go codebase limits community contributions from the Python-dominant ML community.

```graphql
# Weaviate hybrid search query
{
  Get {
    Article(
      hybrid: {
        query: "retrieval augmented generation"
        alpha: 0.75  # 0 = pure BM25, 1 = pure vector
      }
      where: {
        path: ["category"]
        operator: Equal
        valueText: "machine_learning"
      }
      limit: 10
    ) {
      title
      content
      _additional {
        score
        distance
      }
    }
  }
}
```

### Qdrant

**Architecture**: Open-source, written in Rust. Uses a custom HNSW implementation with modifications for filtered search. Supports on-disk storage with memory-mapped vectors.

**Strengths**: High performance (Rust), excellent filtered search (filterable HNSW), flexible payload (metadata) indexing, quantization support (scalar and product quantization). gRPC and REST APIs.

**Limitations**: Smaller community than Weaviate/Pinecone. Fewer built-in integrations. Cluster mode requires more manual configuration.

```python
from qdrant_client import QdrantClient
from qdrant_client.models import Filter, FieldCondition, MatchValue

client = QdrantClient("localhost", port=6333)

# Search with metadata filtering -- filter is applied DURING HNSW traversal
results = client.search(
    collection_name="documents",
    query_vector=query_embedding,
    query_filter=Filter(
        must=[
            FieldCondition(
                key="category",
                match=MatchValue(value="technical")
            )
        ]
    ),
    limit=10
)
```

### Milvus

**Architecture**: Open-source (Apache 2.0), built from the ground up for billion-scale vector search. Milvus uses a disaggregated storage-and-compute architecture with separate query nodes, data nodes, and index nodes, orchestrated by a coordinator layer. This design allows independent scaling of ingestion and search workloads. Zilliz Cloud provides a fully managed version with additional enterprise features.

**Indexing**: Milvus supports a wide range of index types -- HNSW, IVF-Flat, IVF-PQ, IVF-SQ8, DiskANN, and notably GPU-accelerated indexes (GPU-IVF-Flat, GPU-IVF-PQ, GPU-CAGRA). The GPU indexes leverage NVIDIA RAPIDS for building and searching, achieving 5-10x throughput improvements on large-scale workloads compared to CPU-only approaches.

**GPU-accelerated search**: For datasets in the hundreds-of-millions to billions range, Milvus's GPU indexes can process thousands of queries per second at high recall. GPU-CAGRA (based on NVIDIA's graph-based algorithm) is particularly effective for high-throughput scenarios where latency budgets are tight and the dataset is large enough to justify GPU infrastructure costs.

**Strengths**: Battle-tested at billion-scale deployments, flexible index selection per use case, strong consistency guarantees via timestamp-based MVCC, rich filtering with scalar indexes, partition-based data management. Multi-vector search support enables late-interaction patterns.

**Limitations**: Operational complexity is higher than simpler alternatives -- the distributed architecture (etcd, MinIO/S3, Pulsar/Kafka) requires infrastructure expertise. The learning curve is steeper than Qdrant or Weaviate.

**Best for**: Teams operating at genuine billion-vector scale, workloads requiring GPU acceleration, organizations comfortable managing distributed systems (or willing to use Zilliz Cloud).

### Chroma

**Architecture**: Open-source, Python-native vector database designed for simplicity and rapid prototyping. Internally, Chroma uses a layered storage architecture: SQLite stores document metadata and the mapping between IDs and vectors, while HNSW (via hnswlib) handles the vector index. Both run in-process by default, making Chroma feel like an embedded database (similar to SQLite for relational data). The project has matured considerably since its early releases, adding a client-server mode (Chroma Server) for multi-process access, persistent storage by default, token-based authentication, role-based access control, multi-tenancy with database-level isolation, and observability hooks via OpenTelemetry.

Chroma's deployment modes reflect different stages of an application's lifecycle:

```
Development           Staging/Production         Hosted
┌──────────────┐     ┌───────────────────┐     ┌──────────────┐
│  In-process  │     │   Chroma Server   │     │  Chroma Cloud│
│  (embedded)  │ ──► │   (client/server) │ ──► │  (managed)   │
│  PersistentClient  │   chroma run      │     │              │
│              │     │   --host --port    │     │              │
└──────────────┘     └───────────────────┘     └──────────────┘
```

**Strengths**: Dead-simple API with near-zero boilerplate, runs in-process with no server needed for development, built-in embedding function support (Sentence Transformers by default, with adapters for OpenAI, Cohere, Google, HuggingFace, and custom functions), automatic embedding generation from raw documents, rich metadata filtering with `where` and `where_document` clauses, and a clean migration path from local development to production. The client-server architecture now supports moderate-scale production deployments, and the hosted Chroma Cloud offering provides managed infrastructure.

**Limitations**: Single-node architecture limits horizontal scalability -- there is no built-in sharding or replication. Performance is best suited for datasets in the low millions of vectors. For larger workloads, consider purpose-built distributed systems like Qdrant, Weaviate, or Milvus. The HNSW index is held in memory, so memory requirements grow linearly with collection size.

**Best for**: Prototyping and development, small-to-medium production workloads, educational projects, and applications where simplicity and fast iteration matter more than horizontal scale.

#### Chroma Core API

The collections API is the primary interface. Collections are namespaced containers that each hold vectors, documents, metadata, and an HNSW index:

```python
import chromadb

# Embedded mode -- data persists to ./chroma by default
client = chromadb.PersistentClient(path="./chroma_data")

# Or connect to a running Chroma server
# client = chromadb.HttpClient(host="localhost", port=8000)

# Create or get a collection with a specific embedding function
from chromadb.utils.embedding_functions import SentenceTransformerEmbeddingFunction
ef = SentenceTransformerEmbeddingFunction(model_name="all-MiniLM-L6-v2")
collection = client.get_or_create_collection(
    name="technical_docs",
    embedding_function=ef,
    metadata={"hnsw:space": "cosine"}  # distance metric: cosine, l2, or ip
)

# Add documents -- Chroma embeds them automatically via the embedding function
collection.add(
    documents=[
        "RAG combines retrieval with generation to ground LLM responses in facts.",
        "Vector databases index high-dimensional embeddings for fast similarity search.",
        "HNSW builds a multi-layer navigable small world graph for ANN search.",
    ],
    metadatas=[
        {"source": "article", "topic": "rag", "year": 2024},
        {"source": "article", "topic": "vector-db", "year": 2024},
        {"source": "paper", "topic": "algorithms", "year": 2018},
    ],
    ids=["doc1", "doc2", "doc3"]
)

# Or add pre-computed embeddings directly (skip the embedding function)
collection.add(
    embeddings=[[0.1, 0.2, ...], [0.3, 0.4, ...]],
    metadatas=[{"source": "precomputed"}],
    ids=["vec1", "vec2"]
)
```

#### Querying with Metadata Filters

Chroma's query API supports combining vector similarity with metadata and document content filters, enabling hybrid retrieval patterns:

```python
# Basic semantic search
results = collection.query(
    query_texts=["How does retrieval-augmented generation work?"],
    n_results=5
)
# results keys: ids, documents, metadatas, distances, embeddings

# Filtered search -- combine vector similarity with metadata constraints
results = collection.query(
    query_texts=["ANN algorithm performance"],
    n_results=10,
    where={"topic": "algorithms"},                    # metadata filter
    where_document={"$contains": "graph"},            # document content filter
)

# Complex metadata filters with logical operators
results = collection.query(
    query_texts=["embedding models for search"],
    n_results=5,
    where={
        "$and": [
            {"year": {"$gte": 2023}},
            {"$or": [
                {"source": "article"},
                {"source": "paper"}
            ]}
        ]
    }
)
```

Supported filter operators: `$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`, `$in`, `$nin` for metadata; `$contains`, `$not_contains` for document content; `$and`, `$or` for logical composition.

#### Updating and Deleting

```python
# Update documents (re-embeds automatically)
collection.update(
    ids=["doc1"],
    documents=["Updated: RAG pipelines retrieve relevant context before generation."],
    metadatas=[{"source": "article", "topic": "rag", "year": 2025}]
)

# Upsert -- insert or update
collection.upsert(
    ids=["doc1", "doc4"],
    documents=["Updated doc", "Brand new doc"],
    metadatas=[{"source": "article"}, {"source": "blog"}]
)

# Delete by ID or by filter
collection.delete(ids=["doc3"])
collection.delete(where={"source": "blog"})
```

#### Custom Embedding Functions

Chroma's embedding function interface makes it straightforward to swap embedding providers or use custom models:

```python
from chromadb import Documents, EmbeddingFunction, Embeddings

class OpenAIEmbeddingFunction(EmbeddingFunction):
    def __init__(self, api_key: str, model: str = "text-embedding-3-small"):
        from openai import OpenAI
        self.client = OpenAI(api_key=api_key)
        self.model = model

    def __call__(self, input: Documents) -> Embeddings:
        response = self.client.embeddings.create(input=input, model=self.model)
        return [r.embedding for r in response.data]

# Use the custom function with a collection
collection = client.get_or_create_collection(
    name="openai_docs",
    embedding_function=OpenAIEmbeddingFunction(api_key="sk-...")
)
```

Chroma ships built-in adapters for OpenAI, Cohere, HuggingFace, Google Generative AI, and Sentence Transformers. See [Article 13: Embedding Models](/embedding-models) for guidance on choosing the right embedding model for your use case.

#### HNSW Tuning

Chroma exposes HNSW parameters through collection metadata, allowing you to trade off recall, latency, and memory for your specific workload:

```python
collection = client.get_or_create_collection(
    name="tuned_collection",
    metadata={
        "hnsw:space": "cosine",          # distance function
        "hnsw:construction_ef": 200,     # beam width during index build (higher = better graph, slower build)
        "hnsw:search_ef": 100,           # beam width during search (higher = better recall, slower query)
        "hnsw:M": 32,                    # max connections per node (higher = better recall, more memory)
        "hnsw:num_threads": 4,           # parallelism for index operations
    }
)
```

For most workloads under 1M vectors, the defaults (`M=16`, `construction_ef=100`, `search_ef=10`) provide a good balance. Increase `search_ef` to 50-150 for higher recall requirements; increase `M` to 32-64 for datasets where recall is critical. See the HNSW section earlier in this article for the theory behind these parameters.

#### Multi-Tenancy and Authentication

For production deployments, Chroma supports tenant and database isolation:

```python
from chromadb.config import Settings

# Server-side: run with authentication
# chroma run --host 0.0.0.0 --port 8000

# Client-side: connect with auth
client = chromadb.HttpClient(
    host="chroma-server",
    port=8000,
    tenant="acme_corp",
    database="production",
    headers={"Authorization": "Bearer token-..."}
)

# Each tenant/database combination is fully isolated
collection = client.get_or_create_collection("user_documents")
```

#### Chroma in a RAG Pipeline

A complete example showing Chroma as the retrieval backend in a basic RAG pattern:

```python
import chromadb
from openai import OpenAI

# Setup
chroma = chromadb.PersistentClient(path="./rag_store")
openai_client = OpenAI()

collection = chroma.get_or_create_collection(
    name="knowledge_base",
    metadata={"hnsw:space": "cosine"}
)

def ingest_documents(docs: list[dict]):
    """Add documents to the knowledge base."""
    collection.upsert(
        ids=[d["id"] for d in docs],
        documents=[d["text"] for d in docs],
        metadatas=[d.get("metadata", {}) for d in docs]
    )

def retrieve_and_generate(question: str, n_results: int = 5) -> str:
    """RAG: retrieve relevant context, then generate an answer."""
    results = collection.query(
        query_texts=[question],
        n_results=n_results
    )

    context = "\n\n---\n\n".join(results["documents"][0])

    response = openai_client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": (
                "Answer questions using ONLY the provided context. "
                "If the context doesn't contain the answer, say so."
            )},
            {"role": "user", "content": (
                f"Context:\n{context}\n\nQuestion: {question}"
            )}
        ]
    )
    return response.choices[0].message.content
```

For more sophisticated retrieval patterns including query routing, self-correction, and multi-hop retrieval, see [Article 17: Advanced RAG](/advanced-rag). For evaluation of retrieval quality, see [Article 18: RAG Evaluation](/rag-evaluation).

### Turbopuffer

**Architecture**: A serverless vector database designed for cost-efficient, large-scale search. Turbopuffer stores vectors on object storage (S3) and uses aggressive caching and custom query execution to serve low-latency queries without keeping entire indexes in memory.

**Strengths**: Dramatically lower cost at large scale compared to in-memory alternatives -- storage pricing follows object-storage economics rather than RAM pricing. Supports hybrid search with BM25 and vector scoring in a single query. Namespace-based multi-tenancy suits SaaS workloads with many isolated tenants. The serverless model means no capacity planning.

**Limitations**: Newer entrant with a smaller ecosystem and community. Latency characteristics differ from in-memory databases -- cold queries may be slower, though caching mitigates this for active datasets. Proprietary, managed-only.

**Best for**: Cost-sensitive workloads with large vector counts, multi-tenant SaaS architectures, teams seeking serverless simplicity with object-storage economics.

### LanceDB

**Architecture**: Open-source, embedded vector database built on the Lance columnar data format. LanceDB runs in-process (similar to SQLite for vectors) with zero-copy access to data on local disk or object storage. Written in Rust with Python, TypeScript, and Rust client libraries.

**Strengths**: No server to manage -- runs embedded in your application process. The Lance format supports versioned datasets with efficient appends and updates, making it well-suited for ML workflows where data evolves over time. Native support for multi-modal data (images, text, tabular). Automatic IVF-PQ index construction. Direct integration with data lake storage (S3, GCS).

**Limitations**: Embedded architecture means no built-in multi-process concurrency (though Lance's MVCC allows concurrent readers). Query performance at very large scale hasn't been validated as extensively as established distributed databases.

**Best for**: Data science workflows, applications needing versioned vector datasets, edge deployments, and teams wanting to avoid managing a separate database server.

### pgvector

**Architecture**: PostgreSQL extension adding vector data type and ANN search. Supports both IVFFlat and HNSW indexes.

**Strengths**: Leverages existing PostgreSQL infrastructure, ACID transactions, joins with relational data, familiar SQL interface. No new infrastructure to manage if you already use PostgreSQL.

**Limitations**: Performance ceiling lower than purpose-built vector databases. HNSW index builds can be slow and memory-intensive. Limited to single-node PostgreSQL performance characteristics (though extensions like Supabase and Neon add managed scaling).

```sql
-- Create table with vector column
CREATE TABLE documents (
    id SERIAL PRIMARY KEY,
    content TEXT,
    embedding vector(768),
    category TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Create HNSW index
CREATE INDEX ON documents
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 200);

-- Search with metadata filter (standard SQL WHERE clause)
SELECT content, 1 - (embedding <=> query_embedding) AS similarity
FROM documents
WHERE category = 'technical'
ORDER BY embedding <=> query_embedding
LIMIT 10;
```

## Vector Search in Existing Databases

A dedicated vector database is not always the right answer. If your application already relies on a general-purpose database, adding vector search as an extension can reduce operational complexity, avoid data synchronization headaches, and keep your stack simpler. The trade-off is performance: purpose-built vector databases are optimized end-to-end for ANN search, while bolt-on solutions inherit the performance characteristics and scaling constraints of their host systems.

### MongoDB Atlas Vector Search

MongoDB Atlas integrates vector search directly into the document model. You define a vector search index on an array field, and queries use an `$vectorSearch` aggregation stage. Because vectors live alongside your documents, there's no ETL pipeline to keep in sync -- when you update a document, the vector index updates with it.

Atlas Vector Search uses a proprietary ANN algorithm and supports pre-filtering on any indexed document field within the same query. The main constraint is that it runs only on Atlas (MongoDB's managed cloud), not on self-hosted MongoDB. Performance is competitive for datasets up to tens of millions of vectors, though it won't match the throughput of Qdrant or Milvus at larger scales.

### Elasticsearch Vector Search

Elasticsearch added dense vector fields and ANN search (HNSW-based) in version 8.x. For teams already running Elasticsearch for full-text search, adding vector search creates a natural hybrid retrieval pipeline -- BM25 and vector scores can be combined in a single query using Elasticsearch's `knn` clause alongside traditional query DSL.

The advantage is architectural simplicity: one system handles both sparse and dense retrieval, with a single relevance pipeline. The limitation is resource overhead -- HNSW indexes in Elasticsearch are memory-intensive, and the JVM-based architecture adds latency compared to native implementations in Rust or C++.

### Supabase pgvector and AlloyDB AI

Supabase wraps pgvector with a managed PostgreSQL service, adding connection pooling, edge functions, and client libraries that simplify vector operations for application developers. Google's AlloyDB AI takes a different approach: it's a PostgreSQL-compatible managed database with a custom vector search engine that claims 10-100x better ANN performance than standard pgvector, using Google's proprietary ScaNN algorithm under the hood.

Both options are compelling for teams committed to the PostgreSQL ecosystem. AlloyDB AI is particularly interesting when performance requirements exceed what standard pgvector can deliver but the team wants to keep SQL as the query interface.

### Decision Framework: Dedicated vs. Integrated

Choose **integrated vector search** (pgvector, Atlas, Elasticsearch) when:
- Your dataset is under ~10 million vectors
- You need ACID transactions spanning vector and relational data
- Operational simplicity outweighs raw search performance
- Your team already operates the host database in production

Choose a **dedicated vector database** (Qdrant, Milvus, Weaviate, Pinecone) when:
- Scale exceeds tens of millions of vectors
- Query latency at high throughput is critical (sub-5ms p99)
- You need advanced features like multi-vector search, GPU acceleration, or sophisticated filtered HNSW
- Vector search is a core product differentiator, not a supporting feature

The boundary is not fixed. pgvector with HNSW handles 5 million vectors comfortably on a modern instance. But if you find yourself tuning PostgreSQL shared_buffers and work_mem primarily for vector workloads, the tail is wagging the dog -- it's time for a dedicated system.

## Indexing Strategies

### When to Use Which Index

| Scenario | Recommended Index | Rationale |
|---------|------------------|-----------|
| < 100K vectors | Flat (brute-force) | Exact results, low latency at small scale |
| 100K - 10M vectors | HNSW | Best recall-latency, fits in memory |
| 10M - 100M vectors | HNSW + quantization | Reduce memory with PQ/SQ |
| 100M+ vectors | IVF-PQ or HNSW + disk | Memory constraints dominate |
| Frequent updates | HNSW | Supports incremental insertion |
| Batch-only updates | IVF-PQ | Can rebuild index periodically |

### Index Build Considerations

Building an HNSW index on 10 million 768-dimensional vectors takes approximately 30-60 minutes on modern hardware. Key factors:

- **Memory during build**: HNSW requires all vectors in memory during construction. Plan for 2-3x the final index size during builds.
- **Incremental vs. batch**: HNSW supports incremental insertion with some quality degradation. IVF requires full retraining of centroids if the distribution shifts significantly.
- **Warm-up**: After loading an HNSW index from disk, the first queries may be slow as graph nodes are loaded into cache. Pre-warm with representative queries.

## Metadata Filtering

Real-world search queries almost always include metadata filters: "find similar documents created in the last week by author X in category Y." The interaction between vector search and metadata filtering is a critical architectural concern.

### Pre-filtering vs. Post-filtering

**Post-filtering**: Retrieve the top-K nearest vectors, then filter by metadata. Simple but problematic -- if 90% of vectors are filtered out, you need to retrieve 10x more candidates to get K results. This is wasteful and can miss relevant results entirely.

**Pre-filtering**: Apply metadata filter first (e.g., via a bitmap), then search only within the filtered subset. More accurate but can be slow if the HNSW index isn't designed for it -- the graph was built over all vectors, not just the filtered subset.

**Integrated filtering** (Qdrant's approach): Evaluate metadata conditions during HNSW graph traversal, skipping nodes that don't match the filter. This avoids both the accuracy issues of post-filtering and the performance issues of pre-filtering.

### Metadata Indexing

```python
# Qdrant: Create optimized payload indexes for filtered fields
client.create_payload_index(
    collection_name="documents",
    field_name="category",
    field_schema="keyword"  # Exact match index
)

client.create_payload_index(
    collection_name="documents",
    field_name="created_at",
    field_schema="datetime"  # Range query support
)
```

## Hybrid Search Architecture

Combining dense vector search with sparse lexical search (BM25) consistently outperforms either approach alone. [Article 16: Retrieval Strategies](/retrieval-strategies) covers the retrieval-side design in depth -- here we focus on the database-level implementation. The architecture pattern involves:

1. **Parallel retrieval**: Execute vector search and BM25 search simultaneously
2. **Score normalization**: Normalize scores from each source to a common scale
3. **Fusion**: Combine results using reciprocal rank fusion (RRF) or weighted linear combination
4. **Reranking** (optional): Apply a cross-encoder reranker to the fused results

```python
def hybrid_search(query: str, alpha: float = 0.7, k: int = 10):
    """
    alpha: weight for vector search (1-alpha for BM25)
    """
    # Dense retrieval
    query_embedding = embed(query)
    vector_results = vector_db.search(query_embedding, limit=k*3)

    # Sparse retrieval
    bm25_results = bm25_index.search(query, limit=k*3)

    # Reciprocal Rank Fusion
    fused_scores = {}
    rrf_k = 60  # RRF constant

    for rank, doc_id in enumerate(vector_results):
        fused_scores[doc_id] = fused_scores.get(doc_id, 0) + alpha / (rrf_k + rank + 1)

    for rank, doc_id in enumerate(bm25_results):
        fused_scores[doc_id] = fused_scores.get(doc_id, 0) + (1 - alpha) / (rrf_k + rank + 1)

    # Sort by fused score
    ranked = sorted(fused_scores.items(), key=lambda x: x[1], reverse=True)
    return ranked[:k]
```

## Scaling Patterns

### Sharding Strategies

As collections grow beyond single-node capacity, sharding becomes necessary:

- **Hash-based sharding**: Distribute vectors across nodes by hash of document ID. Simple, uniform distribution, but every query must fan out to all shards.
- **Semantic sharding**: Cluster vectors and assign clusters to shards. Queries can be routed to relevant shards only, reducing fan-out. However, cluster boundaries can cause recall loss.

### Replication and Consistency

Vector databases typically offer eventual consistency for search results. A newly inserted vector may not appear in search results immediately due to:

1. Index rebuild lag (IVF) or graph insertion delay (HNSW)
2. Replication lag across nodes
3. Segment merge operations

For applications requiring immediate consistency (e.g., deduplication), consider a two-tier approach: exact match on a hash/ID field (ACID), with ANN search for similarity.

### Cost Optimization

Vector search costs are dominated by memory for in-memory indexes (HNSW) or IOPS for disk-based indexes. Key optimization strategies:

1. **Quantization**: Reduce vector size with scalar quantization (float32 to int8, 4x savings) or product quantization (16-32x savings)
2. **Matryoshka truncation**: Use lower-dimensional embeddings for initial retrieval, full dimensions for reranking (see Matryoshka Representation Learning in [Article 13: Embedding Models](/embedding-models))
3. **Tiered storage**: Keep hot data in memory, warm data on SSD, cold data archived
4. **Index per partition**: Separate indexes by time range or tenant, delete entire indexes instead of individual vectors

## Operational Considerations

### Monitoring

Critical metrics to track:

- **Recall at K**: Sample ground truth periodically and measure actual recall
- **Query latency (p50, p95, p99)**: Tail latency often matters more than median
- **Index build time**: Monitor for unexpected increases indicating data distribution shift
- **Memory utilization**: HNSW memory grows linearly with vector count
- **Insert throughput**: Track for capacity planning

### Backup and Recovery

Vector indexes are expensive to rebuild. Ensure your backup strategy includes:

- Raw vectors and metadata (for full rebuild if needed)
- Serialized index state (for fast recovery)
- Regular snapshot testing -- verify backups can actually be restored

### Migration Between Databases

Lock-in is a real concern. Maintain the ability to export vectors and metadata in a standard format. The actual vectors are portable; the index must be rebuilt in the target system. Budget for index build time during migration planning.

## Multi-Vector and ColBERT Storage

Standard embedding models produce a single vector per document -- the entire semantic content compressed into one point in vector space. ColBERT and similar late-interaction models take a fundamentally different approach: they produce one vector per token, preserving fine-grained lexical-semantic information that single-vector representations discard. This enables more precise matching (the model can align individual query terms with specific passage terms) but introduces significant storage and search challenges. For a deeper look at the models themselves, including ColBERTv2 and BGE-M3's multi-vector output, see [Article 13: Embedding Models](/embedding-models).

### Storage Overhead

A 200-token passage represented as a single 768-dimensional float32 vector occupies 3KB. The same passage under ColBERT (128-dimensional per-token vectors, as in ColBERTv2) produces 200 vectors at 512 bytes each -- 100KB total, a ~33x increase. At 10 million passages, single-vector storage is ~30GB; multi-vector storage balloons to ~1TB before indexing overhead.

Compression is essential. ColBERTv2 introduced residual compression: vectors are quantized relative to their nearest centroid, reducing per-token storage to 16-32 bytes (using 1-2 bits per dimension). This brings the 10M-passage figure down to ~50-80GB -- still larger than single-vector, but manageable.

### Search Mechanics: MaxSim

ColBERT scoring computes the maximum similarity (MaxSim) between each query token vector and all passage token vectors, then sums across query tokens. Naively, this requires comparing every query token against every token in every candidate passage -- computationally explosive.

Practical implementations use a two-stage approach:

1. **Candidate generation**: Use a standard ANN index over all token vectors to find passages containing at least one highly similar token. This produces a candidate set of hundreds to low thousands of passages.
2. **Late interaction scoring**: Compute full MaxSim scores only for candidates, using decompressed token vectors. This stage is CPU-intensive but operates on a small subset.

### Database Support

Dedicated ColBERT storage engines like **RAGatouille** (wrapping ColBERTv2) and **Vespa's native ColBERT support** handle the multi-vector complexity internally. Among general-purpose vector databases, **Milvus** supports multi-vector fields with per-document token-level storage and retrieval. **Qdrant** can store multi-vectors via its multi-vector feature, enabling late-interaction patterns without external tooling.

For most applications, the practical recommendation is to evaluate whether the recall improvement from multi-vector representations justifies the storage and complexity cost. In domains with precise terminology requirements (legal, medical, technical documentation), the token-level matching often provides meaningful gains over single-vector search. For general-purpose semantic search, a single high-quality embedding with hybrid BM25 retrieval (detailed in [Article 16: Retrieval Strategies](/retrieval-strategies)) typically provides a better complexity-to-quality ratio.

## Summary and Key Takeaways

- **HNSW** is the dominant ANN algorithm for good reason: excellent recall-latency trade-off, incremental updates, and wide database support. Use it as the default.
- **IVF-PQ** becomes relevant at 100M+ scale where HNSW memory requirements become prohibitive.
- **Database selection** should prioritize: operational model (managed vs. self-hosted), filtering capabilities, existing infrastructure (pgvector if you're already on PostgreSQL), scale requirements, and whether GPU acceleration (Milvus) is justified.
- **Existing databases** with vector extensions (pgvector, MongoDB Atlas, Elasticsearch) are often the right starting point -- add a dedicated vector database when scale or latency demands outgrow what integrated solutions provide.
- **Metadata filtering** strategy (pre/post/integrated) dramatically impacts both recall and latency -- understand how your chosen database handles filtered search.
- **Hybrid search** (dense + sparse) consistently outperforms pure vector search and should be the default architecture for production RAG systems.
- **Multi-vector representations** (ColBERT-style) offer superior recall for precision-critical domains but carry significant storage overhead -- evaluate whether the gains justify the complexity for your use case.
- **Quantization** is the primary lever for cost optimization at scale, offering 4-32x memory reduction with manageable recall loss.
- **Operational maturity** -- monitoring recall, managing backups, planning for migration -- separates production systems from prototypes.
