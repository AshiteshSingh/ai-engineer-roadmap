# Embedding Models: Representations, Similarity & Fine-tuning

Text embeddings have become the foundational primitive powering modern search, retrieval-augmented generation, and recommendation systems. This article examines how embedding models transform variable-length text into fixed-dimensional vector representations, the training objectives that produce semantically meaningful spaces, and the practical considerations of selecting, evaluating, and fine-tuning embedding models for production AI systems.

## From Words to Vectors: The Embedding Paradigm

The central insight behind text embeddings is deceptively simple: map text into a continuous vector space where semantic similarity corresponds to geometric proximity. What makes modern embedding models powerful is the quality of this mapping -- the degree to which the resulting geometry captures nuanced relationships between concepts, intents, and meaning.

### The Evolution of Text Representations

Early approaches like TF-IDF and BM25 represented documents as sparse vectors over vocabulary terms. While effective for lexical matching, these representations fail to capture synonymy ("car" vs. "automobile") or compositional meaning. Word2Vec (Mikolov et al., 2013) demonstrated that neural networks trained on word co-occurrence could learn dense vectors where semantic relationships emerged as linear directions in the space (the famous "king - man + woman = queen" analogy).

However, word-level embeddings face a fundamental limitation: a single vector per word cannot capture polysemy ("bank" as financial institution vs. riverbank) or compositional meaning at the sentence level. The transformer revolution, beginning with BERT (Devlin et al., 2019), enabled contextual representations where each token's embedding depends on its surrounding context. Yet BERT's native [CLS] token or mean-pooled outputs produce surprisingly poor sentence embeddings out of the box -- a problem that Sentence-BERT (Reimers and Gurevych, 2019) specifically addressed.

### Sentence Transformers Architecture

Sentence-BERT (SBERT) introduced the now-standard approach: a siamese or triplet network architecture where a pre-trained transformer encodes two sentences independently, and a pooling operation (typically mean pooling over token embeddings) produces fixed-size sentence vectors. The key innovation was the training objective -- rather than fine-tuning on downstream tasks with cross-attention between sentence pairs (which is effective but computationally prohibitive for search), SBERT optimizes the pooled representations directly.

The architecture enables efficient similarity computation at inference time. Given a corpus of N documents, you encode each document once. At query time, you encode the query and compute similarity against all document vectors -- an operation that can be accelerated with approximate nearest neighbor (ANN) algorithms.

```python
from sentence_transformers import SentenceTransformer

model = SentenceTransformer('BAAI/bge-large-en-v1.5')

# Encode documents (done once, stored in vector DB)
documents = [
    "Retrieval-augmented generation combines search with LLMs",
    "Photosynthesis converts light energy into chemical energy",
    "Vector databases enable efficient similarity search"
]
doc_embeddings = model.encode(documents, normalize_embeddings=True)

# Encode query (done per request)
query = "How does RAG work?"
query_embedding = model.encode([query], normalize_embeddings=True)

# Compute cosine similarity (dot product when normalized)
similarities = query_embedding @ doc_embeddings.T
```

## Contrastive Learning: The Training Engine

Modern embedding models are predominantly trained with contrastive learning objectives. The core idea, borrowed from computer vision (SimCLR, Chen et al., 2020), is to pull representations of semantically similar pairs closer together while pushing dissimilar pairs apart.

### InfoNCE and In-Batch Negatives

The most common training objective is InfoNCE (Noise Contrastive Estimation), which for a batch of positive pairs (q_i, d_i+) treats all other documents in the batch as negatives:

```
L = -log( exp(sim(q_i, d_i+) / tau) / sum_j(exp(sim(q_i, d_j) / tau)) )
```

where `tau` is a temperature parameter controlling the sharpness of the distribution. This "in-batch negatives" strategy is remarkably efficient -- a batch of 1024 pairs provides 1023 negatives per query for free. The temperature parameter is critical: too high and the model fails to discriminate between similar and dissimilar pairs; too low and gradient signal vanishes for most negatives.

### Hard Negative Mining

Not all negatives are equally useful. Random negatives (e.g., pairing a question about machine learning with a passage about cooking) provide little learning signal since the model can easily distinguish them. Hard negatives -- documents that are superficially similar but not actually relevant -- force the model to learn finer-grained distinctions.

Effective strategies for hard negative mining include:

1. **BM25 negatives**: Retrieve lexically similar but semantically irrelevant documents
2. **Cross-encoder distillation**: Use a more powerful cross-encoder to identify hard negatives
3. **In-batch hard negatives**: Select the highest-scoring negatives within each batch
4. **Mined from previous model checkpoints**: Use an earlier version of the embedding model itself

The E5 model family (Wang et al., 2022) demonstrated that carefully curated training data with hard negatives, combined with a two-stage training process (pre-training on weakly supervised text pairs followed by fine-tuning on labeled data), could achieve state-of-the-art performance.

### Multi-Stage Training

Modern high-performing embedding models typically follow a multi-stage training pipeline:

1. **Pre-training**: Large-scale weakly supervised contrastive learning on naturally occurring text pairs (title-body, question-answer, etc.)
2. **Fine-tuning**: Supervised contrastive learning on curated, high-quality labeled pairs with hard negatives
3. **Distillation** (optional): Training smaller models to mimic the similarity scores of larger cross-encoder teachers

BGE (BAAI General Embedding) models exemplify this approach. They pre-train on large-scale text pairs, fine-tune with carefully mined hard negatives, and add a special instruction prefix mechanism that allows the model to adapt its representation based on the task.

## Similarity Metrics: Geometry of the Embedding Space

The choice of similarity metric defines the geometry of semantic comparison. While closely related mathematically, different metrics have practical implications.

### Cosine Similarity

Cosine similarity measures the angle between two vectors, ignoring magnitude:

```
cos(u, v) = (u . v) / (||u|| * ||v||)
```

Range: [-1, 1]. This is the most commonly used metric for text embeddings because it is magnitude-invariant -- a longer document and a shorter document expressing the same idea will have high similarity regardless of vector norms.

### Dot Product

The raw dot product `u . v` incorporates both direction and magnitude. When vectors are L2-normalized (unit length), dot product equals cosine similarity. Some models (e.g., OpenAI's embeddings) return normalized vectors, making the distinction moot. However, unnormalized dot product can be useful when magnitude encodes relevance signal -- for instance, a model might learn to assign higher magnitude to more "important" or "confident" embeddings.

### Euclidean Distance

L2 distance `||u - v||` measures straight-line distance in the embedding space. For normalized vectors, minimizing L2 distance is equivalent to maximizing cosine similarity (since `||u - v||^2 = 2 - 2 cos(u, v)` when `||u|| = ||v|| = 1`). In practice, Euclidean distance is less commonly used for text retrieval but appears in some clustering applications.

### Practical Impact

```python
import numpy as np

def compare_metrics(u, v):
    cosine = np.dot(u, v) / (np.linalg.norm(u) * np.linalg.norm(v))
    dot = np.dot(u, v)
    euclidean = np.linalg.norm(u - v)

    # For normalized vectors, these are all equivalent rankings
    u_norm = u / np.linalg.norm(u)
    v_norm = v / np.linalg.norm(v)
    assert np.isclose(np.dot(u_norm, v_norm), cosine)

    return {"cosine": cosine, "dot_product": dot, "euclidean": euclidean}
```

The critical insight: always match the metric to what the model was trained with. Using Euclidean distance with a model trained to optimize cosine similarity will produce suboptimal results, even though the ranking may be similar for normalized vectors.

## Matryoshka Representation Learning

A significant practical challenge with embeddings is the trade-off between dimensionality and performance. Higher dimensions capture more information but increase storage costs and slow similarity computation. Matryoshka Representation Learning (MRL), introduced by Kusupati et al. (2022), offers an elegant solution.

### The Nested Doll Principle

MRL trains embedding models so that the first d dimensions of a D-dimensional embedding form a useful d-dimensional embedding on their own. Like Russian nesting dolls (matryoshka), representations at multiple granularities are nested within a single vector.

The training objective modifies the standard contrastive loss to optimize at multiple dimensionalities simultaneously:

```
L_MRL = sum_{d in dims} w_d * L_contrastive(truncate(embeddings, d))
```

where `dims` might be {32, 64, 128, 256, 512, 768} and `w_d` are dimension-specific weights.

### Practical Benefits

The impact is substantial. OpenAI's `text-embedding-3-large` (3072 dimensions) can be truncated to 256 dimensions with only ~4% degradation on retrieval benchmarks. This means:

- **Storage**: 12x reduction in vector database size
- **Search speed**: Proportional speedup in similarity computation
- **Flexibility**: Choose dimensionality based on accuracy-cost trade-off per use case

```python
from openai import OpenAI

client = OpenAI()

# Get full embedding
response = client.embeddings.create(
    model="text-embedding-3-large",
    input="Matryoshka embeddings enable flexible dimensionality",
    dimensions=256  # Truncated from 3072 -- still effective
)
```

## MTEB: The Embedding Benchmark

The Massive Text Embedding Benchmark (Muennighoff et al., 2023) provides a comprehensive evaluation framework spanning 8 task categories and 58+ datasets. Understanding MTEB is essential for informed model selection.

### Task Categories

1. **Retrieval**: Given a query, rank documents by relevance (e.g., MS MARCO, NQ)
2. **Semantic Textual Similarity (STS)**: Score similarity between sentence pairs
3. **Classification**: Use embeddings as features for text classification
4. **Clustering**: Group semantically similar texts
5. **Pair Classification**: Binary similarity decisions (e.g., paraphrase detection)
6. **Reranking**: Reorder a candidate set by relevance
7. **Summarization**: Evaluate summary-document similarity
8. **BitextMining**: Cross-lingual parallel sentence matching

### Reading MTEB Results Critically

Aggregate MTEB scores can be misleading. A model that excels at STS may underperform on retrieval, and vice versa. Key considerations:

- **Retrieval performance** matters most for RAG applications -- focus on nDCG@10 on datasets like MS MARCO, NQ, and BEIR
- **Domain mismatch**: MTEB datasets are predominantly general-domain English; performance on specialized domains (legal, medical, code) may differ dramatically
- **Dimensionality-adjusted performance**: Compare models at the same dimensionality for fair assessment
- **Inference speed**: A model with 2% higher MTEB but 10x slower inference may not be the right choice

## Model Comparison: The Current Landscape

### OpenAI Embeddings

- **text-embedding-3-large**: 3072 dimensions, supports Matryoshka truncation, strong general-purpose performance. Proprietary API, ~$0.13/1M tokens.
- **text-embedding-3-small**: 1536 dimensions, more cost-effective at ~$0.02/1M tokens, with surprisingly competitive retrieval performance.
- Trade-off: Ease of use and consistent quality vs. vendor lock-in and per-request costs.

### Cohere Embed

- **embed-v3**: 1024 dimensions, supports multiple input types (search_document, search_query, classification, clustering), strong multilingual support across 100+ languages.
- The input type distinction is notable -- the model adapts its representation based on how the embedding will be used, similar to BGE's instruction prefix approach.

### BGE (BAAI General Embedding)

- **bge-large-en-v1.5**: 1024 dimensions, open-source, competitive with proprietary models. Trained with RetroMAE pre-training and fine-tuned with hard negatives.
- **bge-m3**: Hybrid model supporting dense retrieval, sparse (lexical) retrieval, and multi-vector (ColBERT-style) retrieval in a single model. 8192 token context.
- Strength: Open-source, self-hostable, no per-request costs at scale.

### E5 Family

- **e5-mistral-7b-instruct**: Uses a 7B LLM backbone, achieving top MTEB scores but at significant computational cost. Demonstrates that larger backbones yield better embeddings.
- **multilingual-e5-large**: Strong multilingual performance, 560M parameters.
- The E5 line of work (Wang et al., 2022) demonstrated the importance of training data curation -- their "Embeddings from Every Angle" approach mines diverse text pairs from web data.

### GTE (General Text Embeddings)

- **gte-Qwen2-7B-instruct**: Built on Qwen2 backbone, competitive with e5-mistral on MTEB. Supports 8192 token context.
- Represents the trend of using instruction-tuned LLMs as embedding backbones.

### Nomic Embed

- **nomic-embed-text-v1.5**: 768 dimensions, fully open-source (model weights, training code, and training data published under Apache 2.0). Supports Matryoshka truncation down to 64 dimensions with graceful degradation.
- **nomic-embed-vision-v1.5**: Aligned multimodal companion model sharing the same embedding space, enabling text-image retrieval without separate infrastructure.
- Strength: Full openness enables auditing, reproduction, and fine-tuning without licensing concerns. Competitive MTEB performance at a fraction of the parameter count of LLM-backbone models.

### Voyage AI

- **voyage-3**: 1024 dimensions, optimized specifically for retrieval and RAG workloads. Supports `input_type` parameter (`query` vs. `document`) for asymmetric retrieval.
- **voyage-code-3**: Domain-specific variant trained on code corpora, consistently outperforming general-purpose models on code retrieval benchmarks.
- **voyage-3-large**: 2048 dimensions, pushing the quality frontier for applications where cost is secondary to recall.
- Strength: Domain-specific model variants (code, law, finance) that avoid the "one model fits all" compromise. Anthropic's recommended embedding provider for Claude-based RAG systems.

### Jina Embeddings

- **jina-embeddings-v3**: 1024 dimensions, 8192 token context, with native support for task-specific LoRA adapters that activate based on the `task` parameter (retrieval.query, retrieval.passage, separation, classification, text-matching). Supports Matryoshka truncation.
- **jina-clip-v2**: Multimodal text-image embeddings supporting 89 languages, combining CLIP-style cross-modal alignment with strong multilingual text performance.
- Strength: The LoRA adapter approach to task conditioning is architecturally distinct from instruction prefixes -- it modifies model weights rather than consuming input tokens, avoiding the context-length overhead discussed in the instruction-prefixed embeddings section above.

### MTEB v2 and Domain-Specific Evaluation

The original MTEB benchmark, while transformative, has been supplemented by MTEB v2 (2024), which expands evaluation coverage significantly. Key additions include retrieval tasks in 250+ languages, long-document retrieval benchmarks testing 8192+ token contexts, and instruction-following evaluation that specifically measures the impact of task prefixes. The leaderboard now separates results by model size category, making comparisons more meaningful -- a 150M parameter model and a 7B parameter model serve fundamentally different deployment scenarios.

Beyond MTEB, domain-specific leaderboards have emerged for legal retrieval (LegalBench-RAG), biomedical search (BioMTEB), and code search (CoIR). These specialized benchmarks often reveal surprising rank inversions: a model that leads on general MTEB may fall to mid-pack on biomedical retrieval, where domain-specific fine-tuning or vocabulary coverage matters more than general-purpose quality. When selecting an embedding model for a production system, evaluating on the closest available domain-specific benchmark -- or building a custom evaluation set from your own data -- is more predictive than MTEB aggregate scores.

## Fine-Tuning Embeddings with Synthetic Data

Off-the-shelf embedding models often underperform on domain-specific data. Fine-tuning with task-specific data is the standard remedy, but labeled data is expensive. Synthetic data generation offers a practical path forward.

### The Synthetic Data Pipeline

```python
from openai import OpenAI

client = OpenAI()

def generate_synthetic_queries(document: str, n: int = 5) -> list[str]:
    """Generate synthetic queries that a user might ask, answered by this document."""
    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[{
            "role": "user",
            "content": f"""Given the following document, generate {n} diverse questions
            that this document would answer. Return only the questions, one per line.

            Document: {document}"""
        }],
        temperature=0.7
    )
    return response.choices[0].message.content.strip().split('\n')

# Generate training pairs
training_pairs = []
for doc in domain_documents:
    queries = generate_synthetic_queries(doc)
    for query in queries:
        training_pairs.append({"query": query, "positive": doc})
```

### Fine-Tuning with Sentence Transformers

```python
from sentence_transformers import SentenceTransformer, InputExample, losses
from torch.utils.data import DataLoader

model = SentenceTransformer('BAAI/bge-base-en-v1.5')

# Prepare training data
train_examples = [
    InputExample(texts=[pair["query"], pair["positive"]])
    for pair in training_pairs
]

train_dataloader = DataLoader(train_examples, shuffle=True, batch_size=32)

# MultipleNegativesRankingLoss implements in-batch negatives
train_loss = losses.MultipleNegativesRankingLoss(model)

model.fit(
    train_objectives=[(train_dataloader, train_loss)],
    epochs=3,
    warmup_steps=100,
    output_path='./fine-tuned-embeddings'
)
```

### Key Fine-Tuning Considerations

1. **Don't over-fine-tune**: Embedding models can catastrophically forget general knowledge. Use a low learning rate (1e-5 to 5e-5) and few epochs (1-5).
2. **Batch size matters**: Larger batches provide more in-batch negatives. Use gradient accumulation if GPU memory is limited. A batch size of 256+ is ideal.
3. **Evaluate on held-out data**: Track retrieval metrics (nDCG@10, recall@k) on a held-out set to detect overfitting.
4. **Hard negatives amplify fine-tuning**: Mining hard negatives from BM25 or a previous model checkpoint dramatically improves fine-tuning effectiveness.

## Sparse Learned Representations (SPLADE)

While the previous sections focused on dense embeddings, an important parallel track has produced learned sparse representations that combine the interpretability of lexical methods like BM25 with the semantic understanding of neural models. SPLADE (Sparse Lexical and Expansion Model, Formal et al., 2021) is the most prominent approach in this family.

### How SPLADE Works

SPLADE uses a transformer encoder (typically BERT or DistilBERT) to produce a sparse vector over the entire vocabulary. For each input token, the model predicts activation weights across all vocabulary terms -- crucially, it can activate terms that do not appear in the input text. This "term expansion" is what gives SPLADE its semantic power: a document about "automobile recalls" can activate the term "car" even if that word never appears.

The sparsity is enforced through a FLOPS-regularization loss that penalizes the total number of activated terms, producing vectors with typically 100-300 non-zero entries out of a 30,000+ vocabulary. The result is an inverted index that is conceptually identical to BM25's data structure but with learned term weights and expanded vocabulary coverage.

```python
# SPLADE produces sparse vectors that look like weighted term lists
# Input: "How does photosynthesis work?"
# Output (simplified): {
#   "photosynthesis": 2.41,
#   "light": 1.03,
#   "chlorophyll": 0.87,   # term expansion -- not in query
#   "energy": 0.72,        # term expansion
#   "plants": 0.65,        # term expansion
#   "process": 0.31,
#   ...
# }
```

### When SPLADE Outperforms Dense Embeddings

Learned sparse representations have distinct advantages in several scenarios:

- **Entity-heavy queries**: Dense embeddings can struggle with rare proper nouns, product codes, or identifiers that had limited representation in training data. SPLADE preserves exact lexical matching while adding semantic expansion.
- **Interpretability requirements**: Because SPLADE vectors are over vocabulary terms, you can inspect exactly which terms contributed to a match -- a significant advantage for debugging retrieval failures or building user-facing explanations.
- **Infrastructure compatibility**: SPLADE vectors can be stored in traditional inverted indexes (Lucene, Elasticsearch) alongside BM25, avoiding the need for a separate [vector database](/vector-databases). This makes adoption dramatically simpler for teams with existing search infrastructure.
- **Out-of-domain robustness**: On the BEIR benchmark, SPLADE models consistently outperform dense retrievers on out-of-domain datasets, likely because the lexical component provides a reliable fallback when semantic matching fails.

The practical takeaway is that SPLADE is not a replacement for dense embeddings but a complementary signal. BGE-M3 (discussed in the model comparison section) embodies this insight by producing dense, sparse, and multi-vector representations from a single model. Hybrid retrieval strategies that combine dense and sparse scores are covered in depth in [Article 16: Retrieval Strategies](/retrieval-strategies).

## Multimodal Embeddings

The embedding paradigm extends naturally beyond text. Multimodal embedding models map different modalities -- text, images, audio, video -- into a shared vector space where cross-modal similarity is meaningful. This enables capabilities like text-to-image search, image-to-text retrieval, and zero-shot visual classification.

### CLIP and Contrastive Vision-Language Pre-training

CLIP (Contrastive Language-Image Pre-training, Radford et al., 2021) established the foundational approach. It jointly trains a text encoder and an image encoder using contrastive learning on 400 million image-caption pairs scraped from the web. The training objective is identical in spirit to the InfoNCE loss described earlier: within each batch, the model pulls matching image-caption pairs together and pushes non-matching pairs apart.

The result is a shared embedding space where "a photo of a golden retriever" (text) and an actual image of a golden retriever occupy nearby regions. This shared geometry enables:

- **Cross-modal retrieval**: Search an image corpus with text queries, or find text descriptions matching an input image
- **Zero-shot classification**: Compare an image embedding against embeddings of class label descriptions (e.g., "a photo of a cat" vs. "a photo of a dog") without any task-specific training
- **Multimodal RAG**: Build retrieval systems that can surface images, diagrams, or charts alongside text passages in response to user queries

### SigLIP and Architectural Refinements

SigLIP (Zhai et al., 2023) refines the CLIP approach by replacing the softmax-based contrastive loss with a sigmoid loss computed per image-text pair. This eliminates the need for a global softmax normalization across the batch, making training more efficient and enabling larger effective batch sizes. SigLIP models achieve comparable or better performance than CLIP at smaller model sizes, making them more practical for embedding workloads where inference cost matters.

Other notable entries in this space include:

- **OpenCLIP**: Open-source reproduction of CLIP, trained on LAION datasets, providing fully open weights for research and production use
- **Jina CLIP v2**: Extends the CLIP architecture with support for multilingual text, producing text-image embeddings usable across 89 languages
- **Nomic Embed Vision**: Companion to Nomic Embed Text, aligning visual and textual embeddings in a unified space with full Matryoshka support

### Practical Considerations for Multimodal Embeddings

Deploying multimodal embeddings introduces unique challenges. Image encoders (typically Vision Transformers) are substantially more expensive to run than text encoders, so pre-computing image embeddings during ingestion is even more critical than with text-only systems. The embedding dimensionality must be shared across modalities, which means the text encoder may be over- or under-parameterized relative to a text-only model. Additionally, the semantic granularity differs across modalities -- a text query like "red car on a mountain road at sunset" expresses rich compositional detail that current vision encoders capture imperfectly.

## Instruction-Prefixed Embeddings

A subtle but impactful development in embedding model design is the use of task-specific instruction prefixes that modify how the model produces representations. Rather than learning a single embedding function, these models condition the encoding on an explicit description of the intended task.

### The Instruction Prefix Mechanism

The E5-instruct family (Wang et al., 2024) pioneered this approach for general-purpose embedding models. At encoding time, each input is prepended with a natural language instruction describing the task:

```python
from sentence_transformers import SentenceTransformer

model = SentenceTransformer('intfloat/e5-mistral-7b-instruct')

# Retrieval task -- query side
queries = [
    "Instruct: Given a web search query, retrieve relevant passages\n"
    "Query: What causes northern lights?"
]

# Retrieval task -- document side (no instruction needed for passages)
documents = [
    "Aurora borealis occurs when charged particles from the sun "
    "interact with gases in Earth's atmosphere..."
]

query_emb = model.encode(queries, normalize_embeddings=True)
doc_emb = model.encode(documents, normalize_embeddings=True)
```

The instruction tells the model what kind of similarity to optimize for. The same document encoded for a retrieval task and a clustering task may produce different embeddings, because the relevant notion of "similarity" differs between those contexts. For retrieval, topical relevance matters; for clustering, broader thematic grouping may be more appropriate.

### How Providers Implement Task Conditioning

Different embedding providers expose this capability through varying interfaces:

- **E5-instruct**: Accepts free-form natural language instructions, offering maximum flexibility. The downside is that poorly phrased instructions can degrade performance.
- **BGE models**: Use a simpler prefix approach -- prepending "Represent this sentence for searching relevant passages:" or similar fixed templates to query-side inputs.
- **Cohere embed-v3**: Abstracts the mechanism behind an `input_type` parameter with four options: `search_document`, `search_query`, `classification`, and `clustering`. This is less flexible than free-form instructions but harder to misuse.
- **Voyage AI**: Uses `input_type` with values `query` and `document`, focusing specifically on the asymmetric retrieval case.

### Why Instruction Prefixes Work

The effectiveness of instruction prefixes stems from a fundamental asymmetry in embedding tasks. In retrieval, queries are short and express information needs, while documents are long and express information content. A single embedding function must somehow handle both sides of this asymmetry. Instruction prefixes provide the model with explicit signal about which side of the retrieval pair it is encoding, allowing it to adjust the representation accordingly.

Empirically, instruction-prefixed models show the largest gains on retrieval tasks (3-5% improvement in nDCG@10 on MTEB retrieval benchmarks) and smaller gains on symmetric tasks like STS where both inputs play the same role. This connects directly to the tokenization choices discussed in [Article 3: Tokenization](/tokenization) -- the instruction prefix consumes tokens from the model's context window, which matters more for short inputs where the prefix represents a larger fraction of the total token count.

## Dimensionality, Context Length, and Practical Trade-offs

### Dimensionality Selection

Higher dimensionality captures more information but with diminishing returns:

| Dimensions | Typical Use Case | Storage per 1M vectors |
|-----------|-----------------|----------------------|
| 256 | Cost-sensitive, large-scale search | ~1 GB |
| 768 | General-purpose, balanced | ~3 GB |
| 1024 | High-accuracy retrieval | ~4 GB |
| 1536-3072 | Maximum recall, small corpora | ~6-12 GB |

For most RAG applications, 768-1024 dimensions provide the best accuracy-cost trade-off. With Matryoshka-trained models, you can start with lower dimensions and scale up if needed.

### Context Length Considerations

Embedding models have maximum context lengths ranging from 512 tokens (older models) to 8192+ tokens (modern models). However, longer inputs don't always produce better embeddings -- the mean-pooling operation can dilute signal when averaging over many tokens. This is why chunking strategy is critical -- see [Article 15: Chunking Strategies](/chunking-strategies) for a full treatment of how splitting decisions interact with embedding quality.

## Summary and Key Takeaways

- **Contrastive learning** is the dominant training paradigm for embedding models, with in-batch negatives and hard negative mining being the most impactful design choices.
- **Similarity metrics** (cosine, dot product, euclidean) are closely related for normalized vectors; always match the metric to the model's training objective and the distance metric configured in your [vector database](/vector-databases).
- **Matryoshka embeddings** enable flexible dimensionality trade-offs without retraining, offering significant cost savings.
- **Learned sparse representations** (SPLADE) complement dense embeddings, combining semantic expansion with lexical precision. They are especially valuable in [hybrid retrieval pipelines](/retrieval-strategies) that fuse dense and sparse scores.
- **Multimodal embeddings** (CLIP, SigLIP) extend the embedding paradigm to cross-modal retrieval, enabling unified search across text and images.
- **Instruction-prefixed embeddings** improve retrieval quality by conditioning representations on the intended task -- a design that interacts with [tokenization](/tokenization) choices since prefixes consume context tokens.
- **MTEB and domain-specific benchmarks** are essential for model selection, but retrieval-specific performance on your domain matters more than aggregate scores.
- **Open-source models** (BGE, E5, GTE, Nomic, Jina) have largely closed the gap with proprietary offerings (OpenAI, Cohere, Voyage) and offer cost advantages at scale.
- **Fine-tuning with synthetic data** is a practical, accessible technique for domain adaptation, but requires care to avoid catastrophic forgetting.
- The field is converging on **LLM-backbone embeddings** (7B+ parameter models), which achieve the highest quality but at significant inference cost -- a trade-off that quantization and distillation are actively addressing.
- Embedding quality sets the ceiling for retrieval quality. Invest in evaluation before committing: the right model depends on your domain, your [chunking strategy](/chunking-strategies), and your latency budget.
