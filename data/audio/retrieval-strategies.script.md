## Mental Model

Think of retrieval as a funnel that trades recall for precision as it narrows. Each stage exists to fix a specific failure of the stage before it. First-stage retrieval optimizes recall — you want to get the right document into a large candidate set cheaply. Dense retrievers handle semantics, sparse retrievers handle exact terms, and hybrid approaches do both. Reranking then optimizes precision by reordering a small candidate set with an expensive cross-encoder. Query transformation techniques like HyDE and expansion fix the input when the raw query embeds poorly. The unifying question is always: which failure am I fixing, and at which stage can I afford to fix it? This makes retrieval an architecture decision, not a model choice. It sets the quality ceiling for the whole RAG pipeline. The candidates come from vector databases, and the trade is the same recall, precision, and cost surface you see across search and recommendations — RAG retrieval is just search with a large language model as the consumer.

## Dense vs Sparse Strengths

Understanding when and why dense and sparse retrieval methods fail differently is essential for building robust retrieval systems.

### Sparse Retrieval

BM25, introduced by Robertson and Zaragoza in 2009, remains the most widely deployed retrieval algorithm. It scores documents based on term frequency, inverse document frequency, and document length normalization. The formula sums over each query term t the product of the inverse document frequency of t and a fraction: the term frequency of t in the document times k one plus one, divided by term frequency plus k one times one minus b plus b times document length over average document length. k one is typically between one point two and two point zero and controls term frequency saturation. b is typically zero point seven five and controls length normalization.

Sparse retrieval has several strengths. It provides exact term matching, so a query like CUDA twelve point three compatibility retrieves documents containing those exact terms. It requires no training and works out of the box on any corpus. It is interpretable: you can inspect which terms contributed to the score. And it handles rare terms well, including domain-specific terminology, proper nouns, and error codes.

But it also has failure modes. You get vocabulary mismatch: a query like car repair will not match automobile maintenance. It lacks semantic understanding: animals that can fly will miss documents about birds that never use the word fly. And it has no understanding of negation or qualification.

### Dense Retrieval

Dense retrieval encodes queries and documents into learned vector representations, with similarity computed as dot product or cosine similarity. Models like DPR by Karpukhin and others in 2020, Contriever by Izacard in 2022, and modern embedding models such as BGE, E5, and GTE have dramatically improved dense retrieval quality.

Dense retrieval offers strong semantic matching: it understands synonyms, paraphrases, and conceptual similarity. It enables cross-lingual transfer when using multilingual models. And pre-trained models can generalize across domains.

But dense retrieval also fails in important ways. Rare entities and terms produce poorly calibrated embeddings. Exact match requirements suffer: searching for error code zero x eight thousand seven hundred five may miss exact matches in favor of semantically similar but incorrect error descriptions. Performance degrades on domains far from the training data. And semantically equivalent queries can produce different results, showing sensitivity to query formulation.

### The Complementarity

Dense and sparse methods fail on different queries. Empirical analysis on the BEIR benchmark shows that on datasets like TREC-COVID and SciFact, BM25 outperforms many dense retrievers. On Natural Questions and MS MARCO, dense retrievers dominate. The correlation between their error sets is surprisingly low — they frequently disagree on which documents are relevant. This complementarity is the fundamental motivation for hybrid search.

## Learned Sparse Retrieval SPLADE

BM25's term-matching strengths are real, but its vocabulary is limited to the exact tokens present in the document. Learned sparse retrieval bridges this gap by using transformer models to produce sparse, high-dimensional representations where the dimensions correspond to vocabulary terms. Crucially, the model can assign non-zero weights to terms that never appear in the original text.

### How SPLADE Works

SPLADE stands for Sparse Lexical and Expansion. It passes a document through a masked language model, typically BERT or DistilBERT, and uses the masked language modeling head logits to produce a sparse vector over the entire vocabulary. A log-saturation function and a FLOPS regularizer control sparsity. The weight for each vocabulary term is computed as log of one plus the ReLU of the masked language modeling logit. Then max-pooling over token positions means that if any token in the document activates vocabulary term j, that term receives a non-zero weight. The FLOPS regularizer penalizes the expected number of floating-point operations at query time, directly controlling the sparsity-effectiveness trade-off.

The result is an inverted index that looks structurally identical to a traditional BM25 index — term IDs mapped to document IDs with weights — but with two critical differences. First, expansion: a document about automobile maintenance will have non-zero weight for car, vehicle, and repair even if those words never appear. Second, learned term importance: the model learns that maintenance is more discriminative than the far more effectively than inverse document frequency alone.

### SPLADE++ and SPLADEv2

SPLADEv2, from Formal and others in 2022, introduced distillation from cross-encoder teachers and separate query and document encoders, significantly improving effectiveness. The key insight was that queries and documents have different sparsity requirements: queries benefit from more expansion to improve recall, while documents benefit from sparser representations to control index size and query latency.

SPLADE++ further refined the architecture with two variants. SPLADE++ Self-Distillation uses the model's own hard-negative mining loop to bootstrap better training data. SPLADE++ Ensemble Distillation combines scores from multiple cross-encoder teachers. On the BEIR benchmark, SPLADE++ achieves nDCG at ten scores competitive with or exceeding state-of-the-art dense retrievers while maintaining the interpretability and infrastructure advantages of sparse retrieval.

### When SPLADE Outperforms BM25

SPLADE consistently outperforms BM25 in scenarios involving vocabulary mismatch. On BEIR's zero-shot evaluation, SPLADE++ outperforms BM25 on every dataset and matches or exceeds dense retrievers on most. The gains are largest on datasets with high lexical mismatch — scientific literature like SciFact, argument retrieval like ArguAna, and web questions like Natural Questions.

Where SPLADE truly shines is in hybrid pipelines. Because SPLADE representations live in an inverted index, they can be served alongside BM25 using the same infrastructure, such as Lucene, Anserini, or OpenSearch. A hybrid of SPLADE plus dense retrieval captures three complementary signals: exact term matching from SPLADE's retention of original terms, learned expansion from SPLADE's vocabulary expansion, and semantic similarity from the dense component. In code, you can encode a query with a SPLADE model by loading a pre-trained model and tokenizer, passing the text through the model, applying a log-saturation and ReLU, and max-pooling over the sequence dimension. The result is a dictionary mapping vocabulary term IDs to learned importance weights — structurally identical to a bag-of-words representation, but enriched with expansion terms and learned weighting. These representations can be indexed in any system that supports sparse vectors, such as Elasticsearch, Vespa, Qdrant, or Weaviate.

## Hybrid Search Architecture

### Reciprocal Rank Fusion

Reciprocal Rank Fusion, or RRF, is the most commonly used fusion method due to its simplicity and robustness. It combines rankings without requiring score normalization. The algorithm is straightforward: for each ranked list, for each document at rank position r, you add the weight divided by k plus r plus one to a running score dictionary. The constant k, typically sixty from the original paper, controls how much rank position matters. With k equals sixty, the difference between rank one and rank two is small — one sixty-first versus one sixty-second — making RRF relatively rank-stable. Lower k values amplify the importance of top positions.

Why does RRF work well? It does not require score normalization between different retrieval systems, which have incomparable score scales. It is robust to one system returning many irrelevant results because those receive low RRF scores. And it is simple to implement, debug, and reason about.

### Weighted Linear Combination

An alternative to RRF normalizes scores from each source and combines them linearly. You compute min-max normalization for each score list, then take a weighted sum using a parameter alpha. Alpha requires tuning per use case. For technical documentation with precise terminology, lower alpha — meaning more BM25 weight — often works better. For conversational queries, higher alpha — more vector weight — is typically preferred.

### Production Pipeline

In a production hybrid search pipeline, you run parallel retrieval from both a vector store and a BM25 index, then fuse the results using reciprocal rank fusion, optionally applying reranking as a third stage. You set a candidate multiplier to retrieve more candidates than your final top k, typically three times as many. This ensures that after fusion and reranking, you have enough quality candidates to choose from. You can implement this as an async function that gathers vector and BM25 results concurrently, fuses them, then optionally passes the fused list to a reranker. The reranker returns the final top k documents.

## Reranking Second Stage

First-stage retrieval prioritizes recall — casting a wide net. Reranking prioritizes precision by selecting the best results from the candidate set using a more powerful and expensive model.

### Cross-Encoder Reranking

Cross-encoders process the query-document pair jointly through a transformer, enabling full attention between query and document tokens. This is fundamentally more powerful than bi-encoder approaches, which encode query and document independently. In a bi-encoder, there is no mechanism for the model to attend from a specific query term to specific document terms. A cross-encoder sees both simultaneously, enabling it to resolve ambiguities like bank in the context of river bank versus bank account and assess fine-grained relevance.

The cost trade-off is significant: cross-encoders are O of N in the number of candidates, computing a full transformer forward pass per pair. For one hundred candidates with a twelve-layer model, this takes roughly fifty to two hundred milliseconds on a GPU. That is why reranking is a second stage applied to a small candidate set, not a first-stage retrieval method.

### Cohere Rerank

Cohere offers a managed reranking API that achieves strong performance without infrastructure management. You pass a query and a list of documents to the rerank endpoint, specifying the model and top n. The API returns relevance scores and optionally the documents themselves. This is a convenient option when you want high-quality reranking without hosting your own model.

### ColBERT Late Interaction

ColBERT, introduced by Khattab and Zaharia in 2020, represents an intermediate approach between bi-encoders and cross-encoders. It encodes query and document independently like a bi-encoder, but retains per-token embeddings rather than pooling into a single vector. Relevance is computed via late interaction, a MaxSim operation: for each query token, you find the most similar document token, then sum these maximum similarities. This captures fine-grained term-level matching while maintaining the efficiency of independent encoding.

ColBERTv2, from Santhanam and others in 2022, adds residual compression, reducing storage requirements by six to ten times while maintaining effectiveness. You can use the PLAID engine to achieve sub one hundred millisecond latency on million-document collections while retaining ColBERTv2's ranking quality. For teams that want ColBERT without managing the full indexing infrastructure, RAGatouille provides a high-level Python interface that wraps ColBERTv2 with sensible defaults. You can load a pre-trained model, index a collection with automatic chunking, and search with ranked results that include per-token interaction scores.

### When to Choose ColBERT

ColBERT is preferable when latency budgets are tight, under one hundred milliseconds total, when you need to rerank large candidate sets in the hundreds rather than dozens, or when you want a single model that can serve as both first-stage retriever and reranker. Cross-encoders remain superior when you have a small candidate set under fifty documents and can tolerate one hundred to two hundred milliseconds of reranking latency, since their joint encoding captures deeper query-document interactions.

## Hypothetical Document Embeddings

HyDE addresses a fundamental asymmetry in retrieval: queries and documents are different kinds of text. A query like What causes aurora borealis? is short and interrogative, while the relevant document is a long, declarative explanation. Their embedding space locations may be far apart even when semantically related.

### The HyDE Approach

HyDE uses an LLM to generate a hypothetical document that would answer the query, then embeds this generated document for retrieval. You prompt the LLM to write a short, detailed passage that answers the question, writing as if from an authoritative source, without meta phrases like the answer is. Then you embed that hypothetical document instead of the query and search the vector store with that embedding. The generated document, even if factually incorrect, is linguistically similar to real documents in the corpus. It uses the vocabulary, structure, and phrasing that actual documents use, so its embedding lands closer to relevant documents than the original query would.

### Why HyDE Works

Gao and others showed in 2022 that HyDE improves retrieval on eleven out of eleven evaluation datasets, with particularly large gains on tasks where the query-document vocabulary gap is largest. The generated document bridges the stylistic gap between a short question and a long answer.

### Limitations

HyDE has limitations. It requires an LLM call before retrieval, adding two hundred to two thousand milliseconds of latency. Every search query incurs an LLM API call, driving up cost. If the LLM generates a plausible but wrong hypothetical document, retrieval may be biased toward documents that confirm the hallucination. For simple factual queries like What is the population of Tokyo?, the query is already in the right form and HyDE adds no benefit. It is best for complex, conceptual queries where the information need is abstract — for example, How does the attention mechanism differ from traditional sequence-to-sequence models?

## Query Expansion Transformation

A single query may not capture all aspects of an information need. Query expansion and transformation techniques generate multiple reformulations to improve recall.

### Multi-Query Retrieval

Multi-query retrieval generates multiple reformulations of the original query and retrieves against each. You prompt the LLM to generate several different versions of the search query that capture different aspects or phrasings of the same information need. Then you retrieve for each query variant, collect the ranked document IDs, and fuse them using reciprocal rank fusion. This is a low-cost, high-impact technique. Generating three to five query variants and fusing results consistently improves recall.

### Query Decomposition

For complex queries, decomposing into sub-queries can improve retrieval. You ask the LLM to break the complex question into simpler sub-questions that, when answered together, would answer the original question. For example, a query like How does transformer attention compare to LSTMs for long sequences? can be decomposed into sub-questions about how transformer attention works, how LSTMs process sequences, limitations of LSTMs for long sequences, and limitations of transformers for long sequences. Retrieving for each sub-question and combining results gives better coverage.

### Step-Back Prompting

Step-back prompting, introduced by Zheng and others in 2023, generates a more abstract version of the query before retrieval. Instead of searching for why your Python Flask app crashes with a 502 error on Heroku, a step-back query might be common causes of 502 errors in Python web applications deployed to cloud platforms. The more abstract query is more likely to match general reference documents. You prompt the LLM to generate a more general question that would help find background information useful for answering the original specific question.

## Adaptive Retrieval

Not every query benefits from retrieval. A question like What is two plus two? or Write a Python function to reverse a string gains nothing from searching a knowledge base. Worse, unnecessary retrieval introduces latency, cost, and the risk of injecting distracting or contradictory context. Adaptive retrieval systems learn to route queries between parametric knowledge, the LLM's internal knowledge, and retrieval-augmented generation based on query characteristics.

### Query Complexity Routing

The simplest approach classifies queries into categories and applies different retrieval strategies per category. You can build a classifier, a fine-tuned DistilBERT or even a rule-based system, that routes queries to parametric, retrieval, structured, or hybrid processing. Key signals include query length and complexity, presence of domain-specific entities, whether the query asks for factual recall versus reasoning, and whether the query references time-sensitive information.

### Self-RAG and Retrieval Tokens

Self-RAG, by Asai and others in 2023, takes adaptive retrieval further by training the LLM itself to decide when to retrieve. The model is fine-tuned with special reflection tokens. A Retrieve token signals that retrieval is needed, a No Retrieve token signals that the model can answer from parametric knowledge, an ISREL token assesses whether a retrieved passage is relevant, and an ISSUP token checks whether the generated response is supported by the passage. This approach unifies the retrieval decision with generation, eliminating the need for a separate classifier. The model learns that a question like What year was the Eiffel Tower built? warrants retrieval while Explain the concept of recursion does not. On knowledge-intensive benchmarks, Self-RAG outperforms both always-retrieve and never-retrieve baselines by five to ten percent on factual accuracy while reducing retrieval calls by thirty to fifty percent.

### Confidence-Based Routing

A practical middle ground uses the LLM's own confidence as a retrieval signal. Generate an initial answer without retrieval, then assess confidence through verbalized probability or token-level entropy. If confidence is low, trigger retrieval and regenerate. The threshold requires tuning per domain. For medical or legal applications where accuracy is critical, a lower threshold triggering more retrieval is appropriate. For creative or general-knowledge tasks, a higher threshold reduces unnecessary latency.

## Structured Data Retrieval

Many real-world knowledge bases contain structured data — relational databases, knowledge graphs, spreadsheets, API endpoints — alongside unstructured text. A complete retrieval strategy must handle both modalities and know when to route a query to structured retrieval rather than vector search.

### Text to SQL

Text-to-SQL converts natural language questions into SQL queries against a relational database. Modern LLMs have made this dramatically more practical, but the challenge lies in grounding the model's output in the actual schema. You prompt the LLM with the database schema and ask it to generate a SQL query. You must validate the generated SQL to prevent unsafe operations like DROP, DELETE, or UPDATE. The schema description itself becomes a retrieval problem at scale: with hundreds of tables, you cannot fit the full schema into the prompt. Schema retrieval becomes a prerequisite, where you embed table and column descriptions and retrieve the most relevant ones before generating SQL.

### Table Question Answering

Not all structured data lives in SQL databases. Table QA handles CSV files, spreadsheets, and tabular data embedded within documents. Models like TAPAS and more recent LLM-based approaches can reason over tables directly. The key challenge is representing tabular structure in a way the model can process — linearizing tables into text while preserving row and column relationships. For tables extracted from documents during chunking, storing both the raw table and a text summary enables hybrid retrieval: the summary matches semantic queries while the structured representation supports precise lookups.

### Integrating Structured and Unstructured

The most capable RAG systems unify structured and unstructured retrieval behind a single query interface. The router examines the query and dispatches to the appropriate backend. A question like What were Q3 2024 revenues? routes to text-to-SQL against a financial database. Explain the revenue growth strategy routes to vector search over earnings call transcripts. A question like How did Q3 revenue compare to the forecast from the analyst report? requires both: SQL for the actual figure, vector search for the forecast, and synthesis across both. This routing can be implemented as part of the adaptive retrieval classifier, adding structured as a query category. The key insight is that structured retrieval is not a replacement for RAG but a complement — most real-world questions require reasoning across both structured facts and unstructured context.

## Retrieval Aware Prompting

How you present retrieved documents to the LLM significantly impacts answer quality.

### Document Ordering

Research by Liu and others in 2023 demonstrated that LLMs are sensitive to the position of relevant information in the context. Models tend to better utilize information presented at the beginning or end of the context, with degraded performance for information in the middle. Practical implications: place the most relevant documents first and last. Consider duplicating the most relevant document at both positions. For long contexts with many documents, alternate relevant and less-relevant documents.

### Citation and Grounding

Instruct the LLM to cite its sources by chunk ID or index, enabling verification. Build a prompt that includes each document labeled with a document number, and ask the LLM to cite sources using that notation. Also instruct it to say so if the documents do not contain enough information.

## Multi-Stage Pipeline

A production retrieval pipeline combines multiple stages. First, you classify the query type. For complex queries, you decompose into sub-queries; for conceptual queries, you generate a HyDE document. Then you run multi-source retrieval from both vector store and BM25 index for each query variant. You fuse all rankings using reciprocal rank fusion. Then you apply reranking with a cross-encoder or ColBERT. Finally, you deduplicate and diversify the results to ensure coverage. Stage zero is query analysis and transformation. Stage one is multi-source retrieval. Stage two is fusion. Stage three is reranking. Stage four is deduplication and diversity. This pipeline realizes the recall-then-precision funnel in practice.

## Runtime Internals

The funnel model hides the mechanics that decide whether each stage helps. Hybrid fusion combines ranks, not scores. Dense cosine similarity and sparse BM25 scores are on incomparable scales, so you cannot just add them. The runtime uses Reciprocal Rank Fusion, which is scale-free and robust. The knob is the RRF constant; the failure mode is naive min-max score normalization that lets one retriever dominate when its score distribution is wider.

A cross-encoder has a reranking budget. A bi-encoder embeds query and doc separately, which is fast and indexable. A cross-encoder scores the pair jointly, which is far more accurate but requires one forward pass per candidate. The runtime rule: use bi-encoder over the corpus for recall, cross-encoder over only the top k for precision. Reranking thousands is a latency cliff; the k you rerank is the precision and latency dial.

HyDE fixes query-document asymmetry. A short query embeds far from long answer documents. HyDE generates a hypothetical answer with an LLM and embeds that instead, landing closer to real relevant docs. The runtime cost is one extra LLM call and a hallucination risk — a wrong hypothetical misdirects retrieval. So it is gated to hard, ambiguous queries, not every request.

Adaptive retrieval adds a gate — a cheap classifier or confidence check — that decides whether to retrieve at all. Skipping this is a silent quality tax. Always retrieving injects noise for queries the model can answer parametrically, like greetings or simple math, hurting both quality and cost. It is the same precision-over-recall discipline that RAG evaluation measures.