# LanceDB: Embedded Multimodal Vector Lakehouse

LanceDB is an embedded vector database that combines vector search with traditional tabular storage, built on the Apache Arrow-native Lance columnar format. Unlike traditional vector databases requiring a separate server process, LanceDB runs in-process like SQLite—but for vectors. This enables storing raw data (text, images, audio), their embeddings, and metadata in a single, versioned table without network overhead.

On Cloudflare Workers, where embedded databases cannot run, the equivalent pattern uses **Vectorize** for vector search, **D1** for metadata, and **R2** for raw data storage, orchestrated in Worker code.

For context on how LanceDB compares to other vector storage approaches, see [Vector Databases](/vector-databases) and [Embeddings](/embeddings).

## Mental Model

### What Problem Does It Solve?

**Naive approach**: Store embeddings in one system (pickle file), metadata in another (PostgreSQL), raw data in a third (S3). Every query requires joining across systems, serializing/deserializing data, and managing consistency manually.

**LanceDB approach**: A single table holds everything—embeddings as Arrow arrays, metadata as typed columns, raw data as bytes. Queries combine vector search with SQL filters in one operation, with zero-copy reads from the columnar format.

**Cloudflare equivalent**: Vectorize handles vector search, D1 stores metadata, R2 stores raw data. You orchestrate the join in your Worker code.

### The Whiteboard Analogy

Imagine a filing cabinet where each drawer is a column: one drawer for embeddings (numbered sticky notes), one for text content, one for timestamps, one for source URLs. To find "documents about cats from last week," you don't pull every folder—you reach into the timestamp drawer first (filter), then scan only the matching sticky notes (vector search). LanceDB is that cabinet built with glass walls: you can see into any drawer without opening it, because the columnar format lets you read only the columns you need. The cabinet also remembers every version of itself—you can roll back to how it looked yesterday.

```xyflow
{
  "direction": "TD",
  "nodes": [
    { "id": "raw-data", "label": "Raw Data\n(text, images, audio)", "shape": "circle" },
    { "id": "embed", "label": "Embedding\nModel", "shape": "rect" },
    { "id": "lancedb-table", "label": "LanceDB\nTable", "shape": "rect" },
    { "id": "embed-col", "label": "Embedding Column\n(float32[])", "shape": "rect" },
    { "id": "meta-col", "label": "Metadata Columns\n(string, int, timestamp)", "shape": "rect" },
    { "id": "query", "label": "Query:\nvector + filter", "shape": "circle" },
    { "id": "results", "label": "Top-K\nResults", "shape": "circle" }
  ],
  "edges": [
    { "source": "raw-data", "target": "embed" },
    { "source": "embed", "target": "lancedb-table" },
    { "source": "lancedb-table", "target": "embed-col" },
    { "source": "lancedb-table", "target": "meta-col" },
    { "source": "query", "target": "lancedb-table" },
    { "source": "lancedb-table", "target": "results" }
  ]
}
```

### Hello-World in ~10 Lines

```python
import lancedb
import numpy as np

db = lancedb.connect("/tmp/hello.lance")
table = db.create_table("greetings", [
    {"vector": np.array([0.1, 0.2, 0.3]), "text": "hello world"},
    {"vector": np.array([0.4, 0.5, 0.6]), "text": "goodbye world"},
])
results = table.search(np.array([0.15, 0.25, 0.35])).limit(1).to_pandas()
print(results["text"].iloc[0])  # "hello world"
```

```xyflow
{
  "direction": "LR",
  "nodes": [
    { "id": "connect", "label": "lancedb.connect()", "shape": "circle" },
    { "id": "create", "label": "create_table()", "shape": "rect" },
    { "id": "data", "label": "Data:\nvector + text", "shape": "rect" },
    { "id": "search", "label": "search(query_vector)", "shape": "rect" },
    { "id": "result", "label": "to_pandas()\n→ nearest neighbor", "shape": "circle" }
  ],
  "edges": [
    { "source": "connect", "target": "create" },
    { "source": "data", "target": "create" },
    { "source": "create", "target": "search" },
    { "source": "search", "target": "result" }
  ]
}
```

## Core Concepts

### Table

A collection of rows with a schema (embedding columns + metadata columns). Tables are versioned, append-only, and stored in the Lance format. The Cloudflare equivalent is a Vectorize index joined with a D1 table in Worker code.

```python
import lancedb
import pyarrow as pa

db = lancedb.connect("/tmp/docs.lance")
schema = pa.schema([
    pa.field("vector", pa.list_(pa.float32(), 384)),
    pa.field("text", pa.string()),
    pa.field("source", pa.string()),
    pa.field("timestamp", pa.int64()),
])
table = db.create_table("documents", schema=schema)
```

```xyflow
{
  "direction": "TD",
  "nodes": [
    { "id": "schema", "label": "Schema:\nvector, text, source, timestamp", "shape": "circle" },
    { "id": "table", "label": "LanceDB\nTable", "shape": "rect" },
    { "id": "rows", "label": "Rows\n(append-only)", "shape": "rect" },
    { "id": "versions", "label": "Versions\n(immutable snapshots)", "shape": "rect" }
  ],
  "edges": [
    { "source": "schema", "target": "table" },
    { "source": "rows", "target": "table" },
    { "source": "table", "target": "versions" }
  ]
}
```

### Index

A data structure for approximate nearest neighbor (ANN) search. LanceDB supports two index types:

| Feature | IVF-PQ | HNSW |
|---------|--------|------|
| Build speed | Fast | Slow |
| Memory usage | Low (4-16x compression) | High |
| Recall | Good (90-95%) | Excellent (95-99%) |
| Best for | Millions+ vectors | High-recall requirements |

The Cloudflare equivalent is Vectorize's proprietary index (managed, no configuration needed).

```python
# IVF-PQ index (good for millions of vectors)
table.create_index(metric="cosine", num_partitions=256, num_sub_vectors=32)

# HNSW index (good for high recall)
table.create_index(metric="l2", index_type="hnsw", ef_construction=200, M=16)
```

```xyflow
{
  "direction": "TD",
  "nodes": [
    { "id": "vectors", "label": "Raw\nVectors", "shape": "circle" },
    { "id": "ivf", "label": "IVF:\nPartition into clusters", "shape": "rect" },
    { "id": "pq", "label": "PQ:\nCompress sub-vectors", "shape": "rect" },
    { "id": "hnsw", "label": "HNSW:\nMulti-layer graph", "shape": "rect" },
    { "id": "index", "label": "Index\n(ANN-ready)", "shape": "circle" }
  ],
  "edges": [
    { "source": "vectors", "target": "ivf" },
    { "source": "vectors", "target": "pq" },
    { "source": "vectors", "target": "hnsw" },
    { "source": "ivf", "target": "index" },
    { "source": "pq", "target": "index" },
    { "source": "hnsw", "target": "index" }
  ]
}
```

### Query

A vector search optionally combined with SQL-like metadata filtering. Supports cosine, L2, and dot product metrics with filter push-down for performance. The Cloudflare equivalent is a Vectorize query plus a D1 WHERE clause (manual join).

```python
# Vector search with metadata filter
results = (
    table.search(query_vector)
    .where("source = 'wikipedia'")
    .where("timestamp > ?", [1700000000])
    .limit(10)
    .metric("cosine")
    .to_pandas()
)
```

```xyflow
{
  "direction": "TD",
  "nodes": [
    { "id": "query-vec", "label": "Query\nVector", "shape": "circle" },
    { "id": "filter", "label": "Metadata Filter\n(WHERE)", "shape": "circle" },
    { "id": "ann", "label": "ANN Search\n(approximate)", "shape": "rect" },
    { "id": "pushdown", "label": "Filter\nPush-Down", "shape": "rect" },
    { "id": "rerank", "label": "Rerank\n(exact distance)", "shape": "rect" },
    { "id": "topk", "label": "Top-K\nResults", "shape": "circle" }
  ],
  "edges": [
    { "source": "query-vec", "target": "ann" },
    { "source": "filter", "target": "pushdown" },
    { "source": "ann", "target": "rerank" },
    { "source": "pushdown", "target": "rerank" },
    { "source": "rerank", "target": "topk" }
  ]
}
```

### Dataset (Version)

An immutable snapshot of table data at a point in time. Every write creates a new version; supports rollback and time-travel queries. The Cloudflare equivalent is not available natively; implement via D1 version table or R2 snapshots.

```python
# Version management
table.add([{"vector": v1, "text": "version 1"}])  # version 1
table.add([{"vector": v2, "text": "version 2"}])  # version 2
table.restore(1)  # rollback to version 1
print(table.list_versions())  # [1, 2]
```

```xyflow
{
  "direction": "TD",
  "nodes": [
    { "id": "v1", "label": "Version 1:\ninitial data", "shape": "rect" },
    { "id": "v2", "label": "Version 2:\nappend data", "shape": "rect" },
    { "id": "v3", "label": "Version 3:\nappend more", "shape": "rect" },
    { "id": "rollback", "label": "restore(1)\n→ rollback to V1", "shape": "diamond" }
  ],
  "edges": [
    { "source": "v1", "target": "v2" },
    { "source": "v2", "target": "v3" },
    { "source": "v3", "target": "rollback" },
    { "source": "rollback", "target": "v1", "label": "rollback" }
  ]
}
```

## How It Works

### Data Ingestion Flow

Raw data → embedding model → LanceDB table (with metadata). The Cloudflare equivalent is: Worker receives data → Workers AI embeds → Vectorize stores vector + D1 stores metadata.

```python
import lancedb
from sentence_transformers import SentenceTransformer

model = SentenceTransformer("BAAI/bge-base-en-v1.5")
db = lancedb.connect("/tmp/rag.lance")
table = db.create_table("docs", [
    {
        "vector": model.encode("Cloudflare Workers run at the edge"),
        "text": "Cloudflare Workers run at the edge",
        "source": "docs",
        "timestamp": 1700000000,
    }
])
```

```xyflow
{
  "direction": "TD",
  "nodes": [
    { "id": "raw", "label": "Raw Text\nDocument", "shape": "circle" },
    { "id": "embed", "label": "Embedding\nModel (BGE)", "shape": "rect" },
    { "id": "metadata", "label": "Metadata:\nsource, timestamp", "shape": "circle" },
    { "id": "table", "label": "LanceDB\nTable", "shape": "rect" },
    { "id": "arrow", "label": "Arrow Columnar\nFormat", "shape": "rect" }
  ],
  "edges": [
    { "source": "raw", "target": "embed" },
    { "source": "embed", "target": "table" },
    { "source": "metadata", "target": "table" },
    { "source": "table", "target": "arrow" }
  ]
}
```

### Query Execution Pipeline

Filter push-down → ANN search → exact rerank → return top-K. The Cloudflare equivalent is: Vectorize query → D1 filter → Workers AI rerank (optional).

```python
# Full query pipeline
query_text = "edge computing"
query_vector = model.encode(query_text)

results = (
    table.search(query_vector)
    .where("source = 'docs'")
    .limit(20)
    .metric("cosine")
    .to_pandas()
)

# Optional: rerank with cross-encoder
from sentence_transformers import CrossEncoder
reranker = CrossEncoder("cross-encoder/ms-marco-MiniLM-L-6-v2")
pairs = [(query_text, row["text"]) for _, row in results.iterrows()]
scores = reranker.predict(pairs)
results["rerank_score"] = scores
results = results.sort_values("rerank_score", ascending=False).head(5)
```

```xyflow
{
  "direction": "LR",
  "nodes": [
    { "id": "query", "label": "Query:\n'edge computing'", "shape": "circle" },
    { "id": "embed-q", "label": "Embed\nQuery", "shape": "rect" },
    { "id": "filter", "label": "Filter:\nsource='docs'", "shape": "rect" },
    { "id": "ann", "label": "ANN Search\n(top-20)", "shape": "rect" },
    { "id": "exact", "label": "Exact Rerank\n(cosine)", "shape": "rect" },
    { "id": "reranker", "label": "Cross-Encoder\nRerank", "shape": "rect" },
    { "id": "topk", "label": "Top-5\nResults", "shape": "circle" }
  ],
  "edges": [
    { "source": "query", "target": "embed-q" },
    { "source": "embed-q", "target": "ann" },
    { "source": "filter", "target": "ann" },
    { "source": "ann", "target": "exact" },
    { "source": "exact", "target": "reranker" },
    { "source": "reranker", "target": "topk" }
  ]
}
```

### Index Building Process

IVF clusters vectors → PQ compresses residuals → HNSW builds graph. The Cloudflare equivalent is automatic, no configuration needed.

```python
# IVF-PQ index building
table.create_index(
    metric="cosine",
    index_type="ivf_pq",  # default
    num_partitions=256,   # IVF clusters
    num_sub_vectors=32,   # PQ sub-vectors (compression)
)

# HNSW index building
table.create_index(
    metric="l2",
    index_type="hnsw",
    ef_construction=200,  # graph construction quality
    M=16,                 # max connections per node
)
```

```xyflow
{
  "direction": "TD",
  "nodes": [
    { "id": "vectors", "label": "All\nVectors", "shape": "circle" },
    { "id": "kmeans", "label": "K-Means Clustering\n(IVF)", "shape": "rect" },
    { "id": "pq", "label": "Product Quantization\n(PQ)", "shape": "rect" },
    { "id": "graph", "label": "HNSW Graph\nConstruction", "shape": "rect" },
    { "id": "index", "label": "Built\nIndex", "shape": "circle" }
  ],
  "edges": [
    { "source": "vectors", "target": "kmeans" },
    { "source": "vectors", "target": "pq" },
    { "source": "vectors", "target": "graph" },
    { "source": "kmeans", "target": "index" },
    { "source": "pq", "target": "index" },
    { "source": "graph", "target": "index" }
  ]
}
```

## Runtime Internals

### Lance Columnar Format

Apache Arrow-native, zero-copy reads, column pruning, chunked columns. Only reads the columns you query; no serialization overhead. The Cloudflare equivalent stores vectors in Vectorize's proprietary format and metadata in D1's SQLite pages.

```python
# Column pruning: only read the columns you need
table.search(query_vector).select(["text", "source"]).to_pandas()
# Lance only loads the 'text' and 'source' columns from disk
```

### Versioned Storage

Append-only writes create immutable versions; compaction merges old versions. Enables time-travel queries, rollback, and concurrent reads without locks. The Cloudflare equivalent is not available; implement via D1 audit table or R2 versioned objects.

```python
# Internal version management
table.add(data)  # creates version N+1
# Lance stores: [version_1.lance, version_2.lance, ...]
# Each version is a complete snapshot (copy-on-write for unchanged columns)
table.compact_files()  # merges versions 1-10 into a single file
```

### Index Internals

IVF-PQ uses a coarse quantizer + product quantizer; HNSW uses a multi-layer graph. The trade-off is between build time, memory, and recall. The Cloudflare equivalent uses a proprietary index with no visibility into internals.

```python
# IVF-PQ internal structure
# 1. K-means partitions vectors into `num_partitions` clusters
# 2. Each vector is assigned to nearest cluster centroid
# 3. Residual (vector - centroid) is compressed via PQ into `num_sub_vectors` sub-vectors
# 4. Query: find nearest centroids → search within those partitions → decompress residuals → rerank

# HNSW internal structure
# 1. Build multi-layer graph: top layer has few nodes, bottom layer has all nodes
# 2. Each node connects to M neighbors at each layer
# 3. Query: start at top layer, greedily navigate down to bottom layer
# 4. ef_construction controls search breadth during build; ef_search controls query breadth
```

### Query Execution Plan

Filter push-down → ANN search → exact distance computation → top-K selection. Filter push-down reduces the number of vectors searched; exact rerank ensures accuracy. The Cloudflare equivalent returns top-K vector IDs from Vectorize, then D1 filters metadata, then the Worker reranks.

```python
# Internal query execution
# 1. Parse WHERE clause → extract filter conditions
# 2. Push filter to Lance scanner (reads only matching rows' vector columns)
# 3. Run ANN search on filtered vectors
# 4. Compute exact distances for candidates
# 5. Sort by distance, return top-K
```

```xyflow
{
  "direction": "LR",
  "nodes": [
    { "id": "query", "label": "Query\n+ Filter", "shape": "circle" },
    { "id": "parse", "label": "Parse\nWHERE clause", "shape": "rect" },
    { "id": "pushdown", "label": "Push filter\nto scanner", "shape": "rect" },
    { "id": "scan", "label": "Scan\nmatching rows", "shape": "rect" },
    { "id": "ann", "label": "ANN on\nfiltered vectors", "shape": "rect" },
    { "id": "exact", "label": "Exact distance\nrerank", "shape": "rect" },
    { "id": "topk", "label": "Top-K\nResults", "shape": "circle" }
  ],
  "edges": [
    { "source": "query", "target": "parse" },
    { "source": "parse", "target": "pushdown" },
    { "source": "parse", "target": "scan" },
    { "source": "pushdown", "target": "ann" },
    { "source": "scan", "target": "ann" },
    { "source": "ann", "target": "exact" },
    { "source": "exact", "target": "topk" }
  ]
}
```

## Patterns

### Pattern 1: Multimodal Embedding Storage

Store text and image embeddings in the same table for cross-modal search. The Cloudflare equivalent uses two Vectorize indexes (text + image) plus D1 metadata.

```python
import lancedb
import numpy as np

db = lancedb.connect("multimodal.lance")
table = db.create_table("content", [
    {
        "text_embedding": np.random.rand(768).astype(np.float32),
        "image_embedding": np.random.rand(512).astype(np.float32),
        "text": "A cat sitting on a mat",
        "image_path": "cat.jpg",
        "timestamp": 1700000000,
    }
])

# Cross-modal search: text query → find matching images
text_query_emb = np.random.rand(768).astype(np.float32)
results = table.search(text_query_emb, vector_column="image_embedding").limit(5)
```

```xyflow
{
  "direction": "TD",
  "nodes": [
    { "id": "text", "label": "Text:\n'cat on mat'", "shape": "circle" },
    { "id": "image", "label": "Image:\ncat.jpg", "shape": "circle" },
    { "id": "text-emb", "label": "Text Embedding\n(768d)", "shape": "rect" },
    { "id": "img-emb", "label": "Image Embedding\n(512d)", "shape": "rect" },
    { "id": "table", "label": "Multimodal\nTable", "shape": "rect" },
    { "id": "query", "label": "Query:\n'feline on rug'", "shape": "circle" },
    { "id": "cross", "label": "Search\nimage_embedding col", "shape": "rect" },
    { "id": "results", "label": "Matching\nImages", "shape": "circle" }
  ],
  "edges": [
    { "source": "text", "target": "text-emb" },
    { "source": "image", "target": "img-emb" },
    { "source": "text-emb", "target": "table" },
    { "source": "img-emb", "target": "table" },
    { "source": "query", "target": "cross" },
    { "source": "cross", "target": "table" },
    { "source": "table", "target": "results" }
  ]
}
```

### Pattern 2: Versioned Dataset Management

Immutable versions enable rollback, A/B testing, and audit trails. The Cloudflare equivalent uses a D1 version table with timestamps plus R2 snapshots.

```python
db = lancedb.connect("production.lance")
table = db.open_table("embeddings")

# Version 1: initial production data
table.add([{"vector": v1, "text": "initial"}])

# Version 2: append new data
table.add([{"vector": v2, "text": "updated"}])

# A/B test: query version 1 vs version 2
v1_results = table.search(query).version(1).to_pandas()
v2_results = table.search(query).version(2).to_pandas()

# Rollback if v2 is worse
table.restore(1)
```

```xyflow
{
  "direction": "TD",
  "nodes": [
    { "id": "v1", "label": "Version 1:\ninitial", "shape": "rect" },
    { "id": "v2", "label": "Version 2:\nupdated", "shape": "rect" },
    { "id": "ab", "label": "A/B Test:\nquery both", "shape": "diamond" },
    { "id": "rollback", "label": "Rollback\nto V1", "shape": "diamond" }
  ],
  "edges": [
    { "source": "v1", "target": "v2" },
    { "source": "v1", "target": "ab" },
    { "source": "v2", "target": "ab" },
    { "source": "ab", "target": "rollback" },
    { "source": "rollback", "target": "v1", "label": "rollback" }
  ]
}
```

### Pattern 3: Hybrid Search (Vector + Metadata)

Combine ANN search with SQL filters for precision. The Cloudflare equivalent is a Vectorize query followed by a D1 WHERE clause with manual join.

```python
# Hybrid search with temporal filtering
results = (
    table.search(query_vector)
    .where("timestamp > ?", [1700000000])
    .where("source IN ('wikipedia', 'arxiv')")
    .where("length(text) < 1000")
    .limit(20)
    .metric("cosine")
    .to_pandas()
)
```

```xyflow
{
  "direction": "TD",
  "nodes": [
    { "id": "query", "label": "Query\nVector", "shape": "circle" },
    { "id": "filters", "label": "Filters:\ntimestamp, source, length", "shape": "circle" },
    { "id": "pushdown", "label": "Filter\nPush-Down", "shape": "rect" },
    { "id": "ann", "label": "ANN on\nfiltered set", "shape": "rect" },
    { "id": "results", "label": "Filtered\nTop-K", "shape": "circle" }
  ],
  "edges": [
    { "source": "query", "target": "pushdown" },
    { "source": "filters", "target": "pushdown" },
    { "source": "pushdown", "target": "ann" },
    { "source": "ann", "target": "results" }
  ]
}
```

### Pattern 4: RAG Pipeline with LanceDB

Embed → retrieve → rerank → generate, all with LanceDB as the vector store. The Cloudflare equivalent uses Workers AI for embedding and generation, Vectorize for retrieval, and D1 for metadata.

```python
def rag_pipeline(query_text: str, table, embed_model, llm):
    # 1. Embed query
    q_emb = embed_model.encode(query_text)
    
    # 2. Retrieve from LanceDB
    docs = (
        table.search(q_emb)
        .where("source = 'knowledge_base'")
        .limit(5)
        .to_pandas()
    )
    
    # 3. Rerank (optional)
    reranked = reranker.rerank(query_text, docs["text"].tolist())
    
    # 4. Generate
    context = "\n".join(reranked)
    response = llm.generate(f"Context: {context}\nQuery: {query_text}")
    
    return response
```

```xyflow
{
  "direction": "LR",
  "nodes": [
    { "id": "query", "label": "User\nQuery", "shape": "circle" },
    { "id": "embed", "label": "Embed\nQuery", "shape": "rect" },
    { "id": "retrieve", "label": "Retrieve from\nLanceDB", "shape": "rect" },
    { "id": "rerank", "label": "Rerank\n(optional)", "shape": "rect" },
    { "id": "generate", "label": "Generate\nResponse", "shape": "rect" },
    { "id": "response", "label": "Final\nAnswer", "shape": "circle" }
  ],
  "edges": [
    { "source": "query", "target": "embed" },
    { "source": "embed", "target": "retrieve" },
    { "source": "retrieve", "target": "rerank" },
    { "source": "rerank", "target": "generate" },
    { "source": "generate", "target": "response" }
  ]
}
```

## Cloudflare Workers Equivalent

When you can't run LanceDB embedded (as in Workers), here's the equivalent pattern using Cloudflare's edge-native services:

```jsonc
// wrangler.jsonc
{
  "name": "rag-worker",
  "main": "src/index.ts",
  "compatibility_date": "2025-01-01",
  "vectorize": [
    { "binding": "VECTORIZE", "index_name": "docs" }
  ],
  "ai": { "binding": "AI" },
  "d1_databases": [
    { "binding": "DB", "database_name": "rag-metadata", "database_id": "xxx" }
  ],
  "kv_namespaces": [
    { "binding": "CACHE", "id": "xxx" }
  ]
}
```

```typescript
// Worker: End-to-end RAG with caching
export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    const query = url.searchParams.get("q");
    if (!query) return new Response("Missing query", { status: 400 });
    
    // Check cache
    const cached = await env.CACHE.get(`rag:${query}`);
    if (cached) return new Response(cached);
    
    // Embed query using Workers AI
    const emb = await env.AI.run("@cf/baai/bge-base-en-v1.5", { text: query });
    
    // Vector search
    const vectors = await env.VECTORIZE.query(emb.data[0], { topK: 5 });
    
    // Fetch full documents from D1
    const ids = vectors.matches.map(m => m.vectorId);
    const docs = await env.DB.prepare(
      "SELECT text FROM docs WHERE id IN (?)"
    ).bind(ids.join(",")).all();
    
    // Generate response
    const response = await env.AI.run("@cf/meta/llama-3-8b-instruct", {
      messages: [
        { role: "system", content: "Answer concisely using provided context." },
        { role: "user", content: `Context: ${docs.results.map(d => d.text).join("\n")}\nQuery: ${query}` }
      ]
    });
    
    // Cache result
    await env.CACHE.put(`rag:${query}`, response.response, { expirationTtl: 3600 });
    
    return new Response(response.response);
  }
};
```

## Comparison: LanceDB vs Cloudflare Vectorize

| Feature | LanceDB | Cloudflare Vectorize |
|---------|---------|---------------------|
| Deployment | Embedded/local | Edge/serverless |
| Storage | Local filesystem/S3 | Cloudflare-managed |
| Index types | IVF-PQ, HNSW | Proprietary (optimized) |
| Max vectors | Unlimited (disk-based) | 5M per index |
| Query latency | 10-200ms | 10-50ms |
| Metadata filter | SQL WHERE | Not supported (use D1) |
| Versioning | Built-in | Not available |
| Multimodal | Multiple embedding columns | Single vector per row |
| Cost | Storage only | Per query + storage |

**Recommendation**: Use LanceDB for local development, on-premise deployments, or when you need versioning/multimodal support. Use Cloudflare Vectorize for edge-native, serverless applications where latency and global distribution matter.

For more on building production RAG systems, see [RAG](/rag) and [LangGraph Deployment](/langgraph-deployment).