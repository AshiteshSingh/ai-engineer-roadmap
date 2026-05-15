# Chunking Strategies: Splitting, Overlap & Semantic Boundaries

The quality of a retrieval-augmented generation system is fundamentally bounded by the quality of its chunks. No amount of sophisticated retrieval or reranking can recover information that was destroyed by poor chunking -- splitting a key argument across two chunks, burying a critical fact in an irrelevant passage, or producing chunks too small to carry coherent meaning. This article examines chunking strategies from first principles through production patterns, covering the full spectrum from naive fixed-size splitting to semantically aware document decomposition.

## Why Chunking Matters

Embedding models produce a single vector for an input text. This vector must capture the "aboutness" of that text for similarity search to work. When a chunk contains a single coherent idea, the resulting embedding is a clear signal. When a chunk mixes unrelated topics, the embedding becomes an average that represents nothing well -- a phenomenon researchers call "topic dilution."

Simultaneously, chunks must contain enough context for an LLM to generate a useful answer. A chunk that reads "The value increased by 37% compared to Q3" is useless without knowing what "the value" refers to. Chunking strategy is the bridge between document structure and retrieval effectiveness.

### The Fundamental Trade-offs

**Chunk size** presents a core tension:
- **Smaller chunks** (100-200 tokens): More precise retrieval, less topic dilution, but may lack context. More vectors to store and search.
- **Larger chunks** (500-1000 tokens): More context per chunk, fewer vectors, but higher risk of topic dilution and retrieving irrelevant content alongside relevant content.

**Chunk boundaries** present another:
- **Hard boundaries** (split at exactly N characters): Fast, deterministic, but may split mid-sentence or mid-argument.
- **Soft boundaries** (split at natural breakpoints): Preserves semantic coherence, but produces variable-size chunks.

## Fixed-Size Chunking

The simplest approach splits text into chunks of fixed token or character count, optionally with overlap.

```python
def fixed_size_chunk(text: str, chunk_size: int = 512, overlap: int = 50) -> list[str]:
    """Split text into fixed-size chunks with overlap."""
    tokens = tokenizer.encode(text)
    chunks = []
    start = 0
    while start < len(tokens):
        end = start + chunk_size
        chunk_tokens = tokens[start:end]
        chunks.append(tokenizer.decode(chunk_tokens))
        start = end - overlap
    return chunks
```

### When Fixed-Size Works

Fixed-size chunking is appropriate when:
- Documents lack clear structure (e.g., raw transcripts, OCR output)
- Processing speed matters more than retrieval precision
- You need a baseline to compare more sophisticated approaches against

### The Overlap Problem

Overlap exists to mitigate information loss at chunk boundaries. If a critical piece of information straddles two chunks, overlap ensures it appears fully in at least one. However, overlap introduces redundancy:

- **Storage overhead**: 20% overlap means 20% more vectors to store and search
- **Duplicate retrieval**: The same passage may appear in multiple retrieved chunks, wasting context window
- **Embedding ambiguity**: Near-duplicate chunks produce near-duplicate embeddings, distorting similarity distributions

The typical recommendation of 10-20% overlap is a heuristic. The optimal overlap depends on the information density and structure of your documents. For structured documents with clear paragraph boundaries, overlap is often unnecessary if you split at paragraph boundaries instead.

## Recursive Character Splitting

LangChain popularized recursive character splitting, which attempts to split text at the most natural boundary available. The algorithm tries a hierarchy of separators, falling through to less desirable ones only when necessary.

```python
def recursive_split(
    text: str,
    chunk_size: int = 1000,
    separators: list[str] = ["\n\n", "\n", ". ", " ", ""]
) -> list[str]:
    """Split text recursively using a hierarchy of separators."""
    chunks = []
    separator = separators[0]

    # Find the appropriate separator
    for sep in separators:
        if sep in text:
            separator = sep
            break

    splits = text.split(separator)
    current_chunk = ""

    for split in splits:
        candidate = current_chunk + separator + split if current_chunk else split
        if len(candidate) <= chunk_size:
            current_chunk = candidate
        else:
            if current_chunk:
                chunks.append(current_chunk.strip())
            # If a single split exceeds chunk_size, recurse with next separator
            if len(split) > chunk_size and len(separators) > 1:
                chunks.extend(recursive_split(split, chunk_size, separators[1:]))
            else:
                current_chunk = split

    if current_chunk:
        chunks.append(current_chunk.strip())

    return chunks
```

The separator hierarchy (`\n\n` > `\n` > `. ` > ` ` > `""`) reflects natural document structure: prefer splitting at paragraph boundaries, then line breaks, then sentences, then words, and only as a last resort split mid-word.

### Strengths and Limitations

Recursive splitting is a good general-purpose approach that balances simplicity with awareness of text structure. However, it operates on surface-level formatting cues rather than semantic content. A paragraph break doesn't guarantee a topic boundary, and a long paragraph may contain multiple distinct topics that should be separated.

## Sentence-Based Chunking

Sentence-based chunking treats sentences as atomic units, grouping consecutive sentences until reaching the chunk size limit.

```python
import spacy

nlp = spacy.load("en_core_web_sm")

def sentence_chunk(text: str, max_sentences: int = 5, max_tokens: int = 512) -> list[str]:
    """Chunk by grouping complete sentences."""
    doc = nlp(text)
    sentences = [sent.text.strip() for sent in doc.sents]

    chunks = []
    current = []
    current_tokens = 0

    for sent in sentences:
        sent_tokens = len(tokenizer.encode(sent))
        if (len(current) >= max_sentences or
            current_tokens + sent_tokens > max_tokens) and current:
            chunks.append(" ".join(current))
            current = [sent]
            current_tokens = sent_tokens
        else:
            current.append(sent)
            current_tokens += sent_tokens

    if current:
        chunks.append(" ".join(current))

    return chunks
```

The advantage is that chunks always contain complete sentences, making them more readable and providing more coherent context to the LLM. The quality of sentence boundary detection matters -- spaCy's sentencizer handles edge cases (abbreviations, decimal numbers, URLs) better than naive period-splitting.

## Document Structure-Aware Splitting

For documents with explicit structure (HTML, Markdown, PDFs with headings, legal documents with numbered sections), leveraging that structure produces dramatically better chunks.

### Markdown-Aware Splitting

```python
import re

def markdown_chunk(text: str, max_chunk_size: int = 1000) -> list[dict]:
    """Split markdown by headings, preserving hierarchy."""
    # Split on headings while keeping the heading with its content
    sections = re.split(r'(^#{1,4}\s+.+$)', text, flags=re.MULTILINE)

    chunks = []
    current_headers = {1: "", 2: "", 3: "", 4: ""}
    current_content = ""
    current_level = 0

    for section in sections:
        heading_match = re.match(r'^(#{1,4})\s+(.+)$', section)

        if heading_match:
            level = len(heading_match.group(1))
            title = heading_match.group(2)

            # Flush previous content
            if current_content.strip():
                # Build breadcrumb from header hierarchy
                breadcrumb = " > ".join(
                    h for h in [current_headers[i] for i in range(1, current_level + 1)] if h
                )
                chunks.append({
                    "content": current_content.strip(),
                    "metadata": {
                        "heading": current_headers[current_level],
                        "breadcrumb": breadcrumb,
                        "level": current_level
                    }
                })
                current_content = ""

            # Update header hierarchy
            current_headers[level] = title
            current_level = level
            # Clear lower-level headers
            for l in range(level + 1, 5):
                current_headers[l] = ""
            current_content = section + "\n"
        else:
            current_content += section

    # Don't forget the last section
    if current_content.strip():
        breadcrumb = " > ".join(
            h for h in [current_headers[i] for i in range(1, current_level + 1)] if h
        )
        chunks.append({
            "content": current_content.strip(),
            "metadata": {
                "heading": current_headers[current_level],
                "breadcrumb": breadcrumb,
                "level": current_level
            }
        })

    return chunks
```

The breadcrumb metadata (`"Machine Learning > Training > Batch Size"`) is particularly valuable -- it can be prepended to the chunk text before embedding, giving the embedding model crucial context about where this content lives in the document hierarchy.

### Table and Code Block Handling

Structured elements like tables and code blocks require special treatment:

- **Tables**: Never split a table across chunks. If a table exceeds the chunk size, consider converting it to a textual description or indexing each row as a separate chunk with the column headers prepended.
- **Code blocks**: Keep code blocks intact. Split before or after the code block, not within it. Include surrounding explanatory text with the code.
- **Lists**: Numbered or bulleted lists often represent a cohesive set of related points. Keep lists together when possible, or include the list preamble ("The three main factors are:") with each list item chunk.

## Semantic Chunking

Semantic chunking moves beyond structural cues to detect topic boundaries in the text itself.

### Embedding-Based Boundary Detection

The core idea: compute embeddings for each sentence, then identify points where the semantic similarity between consecutive sentences drops sharply -- indicating a topic shift.

```python
import numpy as np
from sentence_transformers import SentenceTransformer

model = SentenceTransformer('all-MiniLM-L6-v2')

def semantic_chunk(text: str, threshold: float = 0.5, min_chunk_size: int = 2) -> list[str]:
    """Chunk text at semantic boundaries detected via embedding similarity."""
    doc = nlp(text)
    sentences = [sent.text.strip() for sent in doc.sents if sent.text.strip()]

    if len(sentences) <= min_chunk_size:
        return [text]

    # Embed all sentences
    embeddings = model.encode(sentences, normalize_embeddings=True)

    # Compute cosine similarity between consecutive sentences
    similarities = [
        np.dot(embeddings[i], embeddings[i + 1])
        for i in range(len(embeddings) - 1)
    ]

    # Find split points where similarity drops below threshold
    # Use dynamic threshold: mean - k * std
    mean_sim = np.mean(similarities)
    std_sim = np.std(similarities)
    dynamic_threshold = mean_sim - 1.0 * std_sim

    split_points = [
        i + 1 for i, sim in enumerate(similarities)
        if sim < dynamic_threshold
    ]

    # Build chunks from split points
    chunks = []
    prev = 0
    for point in split_points:
        chunk = " ".join(sentences[prev:point])
        if len(chunk.split()) >= min_chunk_size * 5:  # Minimum word count
            chunks.append(chunk)
            prev = point

    # Add remaining sentences
    if prev < len(sentences):
        chunks.append(" ".join(sentences[prev:]))

    return chunks
```

### Window-Based Smoothing

Raw sentence-to-sentence similarity is noisy. A more robust approach uses windowed similarity -- comparing groups of sentences rather than individual ones:

```python
def windowed_similarity(embeddings, window_size=3):
    """Compute similarity between windows of sentences."""
    similarities = []
    for i in range(len(embeddings) - window_size):
        left = np.mean(embeddings[i:i + window_size], axis=0)
        right = np.mean(embeddings[i + window_size:i + 2 * window_size], axis=0)
        sim = np.dot(left, right) / (np.linalg.norm(left) * np.linalg.norm(right))
        similarities.append(sim)
    return similarities
```

### Cost Considerations

Semantic chunking requires an embedding pass over every sentence in the corpus. For a corpus of 1 million documents with an average of 50 sentences each, that's 50 million embedding operations just for chunking -- before the actual indexing embedding pass. Consider:

- Using a lightweight embedding model (e.g., `all-MiniLM-L6-v2`, 22M parameters) for boundary detection
- Caching sentence embeddings for reuse in the indexing pipeline
- Applying semantic chunking only to high-value documents where quality matters most

## Chunk Size Optimization

There is no universally optimal chunk size. The right size depends on the embedding model, the nature of queries, and the downstream use case.

### Empirical Approach

The most reliable approach is empirical evaluation:

```python
def evaluate_chunk_size(
    documents: list[str],
    queries: list[str],
    ground_truth: list[list[str]],
    chunk_sizes: list[int] = [128, 256, 512, 1024, 2048]
) -> dict:
    """Evaluate retrieval quality across chunk sizes."""
    results = {}

    for size in chunk_sizes:
        # Chunk all documents
        all_chunks = []
        for doc in documents:
            chunks = chunk_document(doc, size)
            all_chunks.extend(chunks)

        # Embed and index
        embeddings = model.encode(all_chunks)
        index = build_index(embeddings)

        # Evaluate retrieval
        recall_at_k = evaluate_recall(queries, ground_truth, index, all_chunks)
        results[size] = recall_at_k

    return results
```

### General Guidelines

Research and practitioner experience suggest:

- **256-512 tokens**: Good default for factual Q&A and semantic search where queries target specific facts
- **512-1024 tokens**: Better for complex queries requiring reasoning over multiple related facts
- **1024-2048 tokens**: Appropriate for summarization or when context continuity is critical
- **Embedding model context length**: Never exceed the embedding model's maximum input length (typically 512 for older models, 8192 for modern ones)

## Parent-Child Document Relationships

A powerful pattern that addresses the chunk size dilemma: index small chunks for precise retrieval, but return larger parent chunks for context.

### Implementation

```python
from dataclasses import dataclass

@dataclass
class ChunkWithParent:
    child_text: str       # Small chunk for embedding/retrieval
    parent_text: str      # Larger context for LLM
    child_id: str
    parent_id: str
    position: int         # Position within parent

def create_parent_child_chunks(
    document: str,
    parent_size: int = 2000,
    child_size: int = 400,
    child_overlap: int = 50
) -> list[ChunkWithParent]:
    """Create hierarchical chunks: small children for search, large parents for context."""
    # Create parent chunks
    parents = chunk_document(document, parent_size, overlap=0)

    all_chunks = []
    for p_idx, parent in enumerate(parents):
        parent_id = f"parent_{p_idx}"
        # Create child chunks within each parent
        children = chunk_document(parent, child_size, overlap=child_overlap)
        for c_idx, child in enumerate(children):
            all_chunks.append(ChunkWithParent(
                child_text=child,
                parent_text=parent,
                child_id=f"{parent_id}_child_{c_idx}",
                parent_id=parent_id,
                position=c_idx
            ))

    return all_chunks

# At retrieval time:
# 1. Embed and search child_text
# 2. Return parent_text to the LLM
```

This pattern is used in LlamaIndex's `SentenceWindowNodeParser` and similar frameworks. The child chunk acts as a precise retrieval key, while the parent provides the context needed for generation.

## Late Chunking

Late chunking (Jina AI, 2024) is a novel approach that addresses a fundamental limitation of traditional chunking: context loss. When you chunk a document and then embed each chunk independently, each chunk's embedding is computed without knowledge of the surrounding document.

### How Late Chunking Works

Instead of chunking first and embedding second, late chunking reverses the order:

1. Pass the entire document through the transformer encoder (up to the model's context length)
2. Obtain contextualized token embeddings for every token in the document
3. Then chunk the token embeddings and pool within each chunk

```python
def late_chunking(document: str, chunk_boundaries: list[tuple[int, int]]):
    """
    Embed first, chunk second -- each token embedding has full document context.
    """
    # Step 1: Get contextualized token embeddings for entire document
    inputs = tokenizer(document, return_tensors="pt", max_length=8192)
    outputs = model(**inputs)
    token_embeddings = outputs.last_hidden_state[0]  # (seq_len, hidden_dim)

    # Step 2: Map character boundaries to token boundaries
    token_boundaries = [
        char_to_token_range(start, end, inputs)
        for start, end in chunk_boundaries
    ]

    # Step 3: Pool within each chunk's token range
    chunk_embeddings = []
    for start_tok, end_tok in token_boundaries:
        chunk_emb = token_embeddings[start_tok:end_tok].mean(dim=0)
        chunk_embeddings.append(chunk_emb)

    return chunk_embeddings
```

### Why This Matters

Consider a document that begins "Einstein developed the theory of general relativity in 1915" and later contains a paragraph starting "His later work on unified field theory..." With traditional chunking, the later paragraph's embedding has no reference to Einstein -- the pronoun "His" is unresolved. With late chunking, the token embedding for "His" already incorporates attention to "Einstein" from the full document context.

The limitation is that late chunking requires the full document to fit within the model's context window. For very long documents, a sliding window approach with overlap can partially mitigate this, but the fundamental context window limitation remains.

## Contextual Retrieval: LLM-Augmented Chunk Context

Late chunking addresses context loss at the embedding level, but there is a more direct approach: use an LLM to explicitly inject context into each chunk before embedding. Anthropic introduced this technique as "Contextual Retrieval" in 2024, and it has since become one of the highest-impact improvements available to RAG practitioners.

### The Problem Contextual Retrieval Solves

Consider a financial report where Chapter 3 discusses revenue figures. A chunk from that chapter might read: "Revenue increased 23% year-over-year, driven primarily by expansion in the APAC region." In isolation, this chunk lacks critical context -- which company? Which fiscal year? Which product line? The embedding captures the general concept of "revenue growth in APAC," but a query about "Acme Corp Q3 2024 revenue" may not surface this chunk because the named entities were in a different section entirely.

### How It Works

Before embedding each chunk, an LLM (typically a fast, inexpensive model like Claude Haiku or GPT-4o-mini) reads the full document and generates a short contextual preamble for the chunk. This preamble is prepended to the chunk text, and the combined text is what gets embedded and stored.

```python
import anthropic

client = anthropic.Anthropic()

def add_contextual_header(
    document: str,
    chunk: str,
    model: str = "claude-haiku"
) -> str:
    """Use an LLM to generate contextual information for a chunk."""
    prompt = f"""<document>
{document}
</document>

Here is a chunk from that document:
<chunk>
{chunk}
</chunk>

Provide a short (2-3 sentence) context that situates this chunk within the
overall document. Include key entities, the document section, and any
referents that the chunk alone does not resolve. Return ONLY the context."""

    response = client.messages.create(
        model=model,
        max_tokens=200,
        messages=[{"role": "user", "content": prompt}]
    )

    context = response.content[0].text
    return f"{context}\n\n{chunk}"
```

The result for our example chunk might become: "This chunk is from Acme Corp's 2024 Annual Report, Chapter 3 (Revenue Analysis), discussing fiscal year 2024 results for the enterprise SaaS product line. Revenue increased 23% year-over-year, driven primarily by expansion in the APAC region."

### Impact and Cost Trade-offs

Anthropic reported that contextual retrieval reduced retrieval failure rates by 49% when combined with hybrid search (see [Retrieval Strategies](/retrieval-strategies) for hybrid search architectures). The improvement is especially pronounced for documents with extensive cross-referencing, coreference, and implicit context -- technical manuals, legal contracts, and research papers.

The cost is real: every chunk requires an LLM call during ingestion. For a corpus of 100,000 chunks, that means 100,000 API calls. Prompt caching helps significantly -- since the full document is repeated across all chunks from that document, the document portion of the prompt is cached after the first call, reducing cost by 80-90% for subsequent chunks from the same document. The approach is best understood as a one-time ingestion cost that pays dividends across every subsequent query.

## Proposition-Based Chunking

While contextual retrieval enriches conventional chunks, proposition-based chunking rethinks what a chunk should contain in the first place. Introduced by Chen et al. (2023) in "Dense X Retrieval: What Retrieval Granularity Should We Use?", this approach decomposes text into atomic, self-contained propositions -- individual facts that can stand alone without requiring surrounding context.

### From Passages to Propositions

A traditional chunk might read: "Founded in 1976 by Steve Jobs, Steve Wozniak, and Ronald Wayne, Apple initially sold hand-built computers. The company went public in 1980, making more millionaires than any IPO in history up to that point."

Proposition-based chunking decomposes this into:
1. "Apple was founded in 1976."
2. "Apple was founded by Steve Jobs, Steve Wozniak, and Ronald Wayne."
3. "Apple initially sold hand-built computers."
4. "Apple went public in 1980."
5. "Apple's 1980 IPO created more millionaires than any previous IPO."

Each proposition is a complete, self-contained fact. Pronouns are resolved. Implicit subjects are made explicit.

### Implementation

```python
def extract_propositions(text: str, llm_client) -> list[str]:
    """Decompose text into atomic, self-contained propositions."""
    prompt = f"""Decompose the following text into clear, atomic propositions.
Each proposition should:
- Express exactly one fact
- Be self-contained (no unresolved pronouns or references)
- Include necessary context (names, dates, locations)
- Be understandable without reading the original text

Text:
{text}

Return each proposition on a new line, prefixed with a dash."""

    response = llm_client.generate(prompt)
    propositions = [
        line.strip().lstrip("- ")
        for line in response.split("\n")
        if line.strip().startswith("-")
    ]
    return propositions
```

### When Propositions Excel

Proposition-based chunking shines for **factoid retrieval** -- queries that target a specific, discrete fact. When a user asks "When did Apple go public?", a proposition containing exactly that fact produces a near-perfect embedding match. The embedding for the query and the embedding for the proposition occupy the same narrow region of the vector space, because they express the same atomic idea.

The trade-off is granularity: propositions are typically 10-30 tokens, far smaller than conventional chunks. This means dramatically more vectors to store and search (see [Vector Databases](/vector-databases) for indexing considerations at scale). It also means each retrieved proposition carries less context for generation. A common mitigation is to pair proposition-based retrieval with a parent-child architecture -- retrieve by proposition, but pass the original passage to the LLM.

The computational cost of decomposition is significant, as it requires an LLM call per passage. For large corpora, consider applying proposition decomposition selectively to high-value or fact-dense documents, while using conventional chunking for narrative or expository content.

## Multi-Modal Document Processing

Real-world RAG systems rarely ingest clean plain text. Production pipelines face PDFs with mixed layouts, scanned documents, embedded tables, charts, and images. How text is extracted from these documents determines the ceiling for every downstream chunking strategy.

### The Document Parsing Landscape

Several tools have emerged to handle complex document formats:

**DocTR** (Document Text Recognition) is an open-source OCR library built on deep learning. It combines a text detection model (DBNet or LinkNet) with a text recognition model (CRNN or SAR) to extract text from images and scanned PDFs. DocTR preserves spatial layout information, which is critical for reconstructing reading order in multi-column documents.

**Unstructured** provides a higher-level abstraction, offering a `partition` function that automatically detects element types (titles, narrative text, tables, list items, images) and returns structured elements with metadata. This is particularly valuable because it distinguishes between element types, enabling type-aware chunking downstream.

**LlamaParse** (LlamaIndex) takes a model-driven approach, using multimodal LLMs to parse complex documents. It handles embedded tables, charts, and even handwritten annotations by treating document understanding as a vision-language task rather than a pure OCR problem.

### Integrating Document Parsing with Chunking

```python
from unstructured.partition.pdf import partition_pdf

def parse_and_chunk_pdf(pdf_path: str, chunk_size: int = 800) -> list[dict]:
    """Parse a PDF preserving element types, then chunk intelligently."""
    elements = partition_pdf(
        pdf_path,
        strategy="hi_res",            # Use layout detection model
        infer_table_structure=True,    # Extract table structure
        extract_images_in_pdf=True     # Pull out embedded images
    )

    chunks = []
    current_chunk = ""
    current_metadata = {"element_types": set()}

    for element in elements:
        el_type = type(element).__name__
        text = str(element)

        # Tables get their own chunk -- never split them
        if el_type == "Table":
            if current_chunk.strip():
                chunks.append({
                    "text": current_chunk.strip(),
                    "metadata": {
                        "types": list(current_metadata["element_types"])
                    }
                })
                current_chunk = ""
                current_metadata = {"element_types": set()}

            chunks.append({
                "text": text,
                "metadata": {
                    "types": ["Table"],
                    "table_html": element.metadata.text_as_html
                }
            })
            continue

        # Accumulate text elements
        candidate = current_chunk + "\n\n" + text if current_chunk else text
        if len(candidate.split()) > chunk_size:
            if current_chunk.strip():
                chunks.append({
                    "text": current_chunk.strip(),
                    "metadata": {
                        "types": list(current_metadata["element_types"])
                    }
                })
            current_chunk = text
            current_metadata = {"element_types": {el_type}}
        else:
            current_chunk = candidate
            current_metadata["element_types"].add(el_type)

    if current_chunk.strip():
        chunks.append({
            "text": current_chunk.strip(),
            "metadata": {"types": list(current_metadata["element_types"])}
        })

    return chunks
```

### Handling Images and Charts

For images embedded in documents, the emerging pattern is to generate textual descriptions using a vision-language model, then index those descriptions alongside the surrounding text. A chart showing quarterly revenue trends becomes a text chunk describing the data, the trend, and the key takeaways -- making it searchable through the same embedding pipeline used for text (see [Embedding Models](/embedding-models) for how text embeddings capture semantic meaning).

The key principle: convert everything to text before chunking, but preserve the original modality in metadata for potential downstream use by multimodal LLMs.

## Chunk Metadata Enrichment

Even with the best chunking strategy, the raw text of a chunk may not align well with how users phrase queries. Chunk metadata enrichment bridges this gap by generating additional indexed representations for each chunk.

### Hypothetical Question Generation

Inspired by the HyDE (Hypothetical Document Embeddings) technique used at query time (covered in depth in [Retrieval Strategies](/retrieval-strategies)), the inverse approach generates hypothetical questions at indexing time. For each chunk, an LLM produces questions that the chunk could answer:

```python
def generate_chunk_questions(chunk: str, llm_client, n_questions: int = 3) -> list[str]:
    """Generate hypothetical questions this chunk answers."""
    prompt = f"""Given the following text passage, generate {n_questions} specific
questions that this passage directly answers. The questions should be phrased
as a user would naturally ask them.

Passage:
{chunk}

Return each question on a new line."""

    response = llm_client.generate(prompt)
    return [q.strip() for q in response.strip().split("\n") if q.strip()]
```

These generated questions are embedded alongside (or instead of) the chunk text. When a user's query closely matches one of the hypothetical questions, retrieval accuracy improves substantially -- the query and the hypothetical question occupy the same linguistic register, unlike the query and the original passage text which may use entirely different phrasing.

### Summary and Keyword Extraction

Beyond hypothetical questions, two additional metadata fields consistently improve retrieval:

**Per-chunk summaries** compress the chunk into 1-2 sentences that capture the core claim or information. This is particularly valuable for long chunks (800+ tokens) where the embedding may suffer from topic dilution. The summary embedding provides a concentrated signal that complements the full-text embedding.

**Keyword extraction** identifies domain-specific terms, named entities, and technical vocabulary. These keywords serve double duty: they improve hybrid search by providing explicit lexical matching targets (complementing the semantic matching from dense embeddings), and they enable faceted filtering in the vector database.

```python
def enrich_chunk(chunk: str, llm_client) -> dict:
    """Generate comprehensive metadata for a chunk."""
    prompt = f"""Analyze the following passage and provide:
1. A 1-2 sentence summary capturing the key information
2. 5-10 keywords (domain terms, entities, technical concepts)
3. 3 questions this passage answers

Passage:
{chunk}

Respond in JSON format with keys: summary, keywords, questions"""

    response = llm_client.generate(prompt)
    metadata = json.loads(response)

    return {
        "text": chunk,
        "summary": metadata["summary"],
        "keywords": metadata["keywords"],
        "questions": metadata["questions"],
    }
```

### Multi-Vector Indexing

With enriched metadata, a single chunk can be represented by multiple vectors in the index: one for the full text, one for the summary, and one for each hypothetical question. At query time, a match against any of these vectors surfaces the chunk. This multi-vector approach (sometimes called "multi-representation indexing") significantly broadens the retrieval surface without increasing the volume of text sent to the LLM -- only the original chunk text is passed for generation.

The storage overhead is proportional to the number of vectors per chunk. For three hypothetical questions plus a summary, that is a 5x increase in vector count. Most vector databases handle this efficiently through metadata filtering (see [Vector Databases](/vector-databases) for storage and filtering architectures), and the retrieval quality improvement typically justifies the cost.

## Practical Chunking Pipeline

A production chunking pipeline typically combines multiple strategies:

```python
def production_chunking_pipeline(document: str, doc_type: str) -> list[dict]:
    """Multi-strategy chunking pipeline."""

    if doc_type == "markdown":
        # Use structure-aware splitting for structured documents
        chunks = markdown_chunk(document, max_chunk_size=1000)
    elif doc_type == "code":
        # Split by functions/classes for code
        chunks = code_aware_chunk(document)
    elif doc_type == "transcript":
        # Use semantic chunking for unstructured text
        chunks = semantic_chunk(document, threshold=0.4)
    else:
        # Default: recursive splitting
        chunks = recursive_split(document, chunk_size=800)

    # Post-processing
    processed = []
    for chunk in chunks:
        text = chunk["content"] if isinstance(chunk, dict) else chunk

        # Skip very short chunks (likely noise)
        if len(text.split()) < 20:
            continue

        # Prepend context if available
        if isinstance(chunk, dict) and chunk.get("metadata", {}).get("breadcrumb"):
            text = f"Context: {chunk['metadata']['breadcrumb']}\n\n{text}"

        processed.append({
            "text": text,
            "metadata": chunk.get("metadata", {}) if isinstance(chunk, dict) else {},
            "token_count": len(tokenizer.encode(text))
        })

    return processed
```

## Summary and Key Takeaways

- **Chunk size** is the single most impactful parameter. Start with 400-800 tokens and evaluate empirically on your specific queries and documents.
- **Fixed-size chunking with overlap** is a reasonable baseline but should not be the final answer for production systems.
- **Recursive character splitting** offers a good balance of simplicity and quality for general-purpose use.
- **Document structure-aware splitting** should always be preferred when documents have explicit structure (headings, sections, HTML tags).
- **Semantic chunking** produces the highest quality boundaries but at significant computational cost. Use selectively for high-value content.
- **Parent-child relationships** elegantly resolve the chunk size dilemma: small chunks for precise retrieval, large chunks for context.
- **Late chunking** represents the frontier of the field, preserving cross-chunk context at the embedding level.
- **Contextual retrieval** uses an LLM to inject document-level context into each chunk before embedding -- one of the highest-ROI improvements available, especially when combined with [hybrid search](/retrieval-strategies).
- **Proposition-based chunking** maximizes retrieval precision for factoid queries by decomposing text into atomic, self-contained facts.
- **Multi-modal document processing** is a prerequisite for real-world RAG: if text extraction from PDFs, images, and tables is poor, no chunking strategy can compensate.
- **Chunk metadata enrichment** (summaries, hypothetical questions, keywords) broadens the retrieval surface without increasing LLM context usage.
- **There is no universal best strategy**. Evaluate chunking quality through end-to-end retrieval metrics (recall@k, nDCG) on representative queries, not in isolation.
- The interaction between chunk strategy and [embedding model](/embedding-models) matters: a model trained on short passages may underperform on 2000-token chunks, and vice versa. Similarly, the choice of [vector database](/vector-databases) determines which multi-vector and metadata filtering strategies are practical at scale.
