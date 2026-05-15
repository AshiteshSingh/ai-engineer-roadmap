# Context Compression: Fitting More Signal into Fewer Tokens

Every token in a context window has a cost -- financial, computational, and attentional. API pricing scales linearly with token count. Latency grows with sequence length. And most critically, transformer attention quality degrades as irrelevant content dilutes the signal that matters. Context compression is the systematic practice of maximizing information density within a fixed token budget: ensuring that every token the model sees carries meaning relevant to the task at hand.

This is not merely an optimization concern. As systems grow more complex -- agents orchestrating multi-step plans, RAG pipelines assembling documents from dozens of sources, long-running conversations accumulating history -- the gap between "all available information" and "what fits in the context window" widens dramatically. The question is never whether to compress, but how to compress without losing the signal that determines output quality. This article examines the full spectrum of compression techniques, from extractive methods that select the most relevant passages to learned compressors that drop low-information tokens, and the architectural patterns that make compression a first-class concern in production systems.

## Why Compression Matters

### The Finite Context Budget

Context windows have grown from 4K tokens (GPT-3.5) to 128K (GPT-4o, Claude 3.5) to 1M+ (Gemini 1.5 Pro), but the growth in available information has outpaced them. A single enterprise knowledge base might contain millions of documents. A codebase has thousands of files. A conversation with an agent can run to hundreds of turns over a session. The context window is always the bottleneck, and unlike RAM, you cannot simply "add more" -- the window size is a hard architectural constraint of the model.

As discussed in [Context Engineering](/context-engineering), the context window is not a uniform resource. Different regions carry different weights in the model's attention mechanism. Research on "lost in the middle" effects (Liu et al., 2023) demonstrates that models attend most strongly to content near the beginning and end of the context, with middle content receiving diminished attention. This means that padding the context with marginally relevant content does not simply waste tokens -- it actively harms performance by pushing critical information into low-attention zones.

### Cost Scales Linearly, Attention Does Not

For cloud-hosted models, the economics are straightforward: twice the tokens means twice the cost and roughly twice the latency. But the quality relationship is nonlinear. Adding 10K tokens of precisely relevant context might improve output quality by 40%. Adding 10K tokens of loosely related context might improve it by 2% while degrading performance on the core task by 5% through attention dilution.

```
Quality vs. Context Length (schematic)

Quality
  ^
  |         *  *
  |       *      *  *
  |     *              *  *  *  *  *
  |   *                              *  *  *
  |  *                                        *
  | *
  |*
  +-----------------------------------------> Context Length (tokens)
       ^                    ^
       |                    |
    Optimal density      Diminishing returns /
    (compressed)         attention dilution
                         (uncompressed)
```

This curve illustrates the central insight: there exists an optimal information density beyond which adding more tokens hurts rather than helps. Compression is the tool for operating at or near that optimum.

### The Three Costs of Excess Context

1. **Financial cost.** At $3/MTok input (GPT-4o-class pricing), a system handling 10M requests/month at 8K tokens each costs $240K/month on input tokens alone. Compressing context by 50% saves $120K/month.

2. **Latency cost.** Time-to-first-token scales with input length. For interactive applications, reducing context from 32K to 8K tokens can cut TTFT by 60-70%, directly improving user experience.

3. **Quality cost.** Attention dilution, lost-in-the-middle effects, and reasoning capacity consumed by processing irrelevant tokens all reduce output quality. Compressed, high-density context consistently outperforms verbose, padded context in evaluations.

## Extractive Compression

Extractive compression selects the most relevant subset of the original text without modifying it. The original wording is preserved -- the compressor acts as a filter, not a rewriter.

### TextRank and Graph-Based Extraction

TextRank (Mihalcea and Tarau, 2004) applies the PageRank algorithm to a graph of sentences, where edge weights represent inter-sentence similarity. Sentences that are similar to many other sentences rank highest, functioning as "representative" summaries of the text.

```python
import numpy as np
from sklearn.metrics.pairwise import cosine_similarity
from sentence_transformers import SentenceTransformer

def textrank_extract(
    text: str,
    num_sentences: int = 5,
    model_name: str = "all-MiniLM-L6-v2"
) -> str:
    """Extract the most representative sentences using TextRank."""
    model = SentenceTransformer(model_name)

    # Split into sentences
    sentences = [s.strip() for s in text.split(". ") if len(s.strip()) > 20]
    if len(sentences) <= num_sentences:
        return text

    # Compute sentence embeddings and similarity matrix
    embeddings = model.encode(sentences)
    similarity_matrix = cosine_similarity(embeddings)

    # Zero out self-similarities
    np.fill_diagonal(similarity_matrix, 0)

    # Power iteration for PageRank scores
    scores = np.ones(len(sentences)) / len(sentences)
    damping = 0.85

    for _ in range(50):
        # Normalize columns to create transition matrix
        col_sums = similarity_matrix.sum(axis=0, keepdims=True)
        col_sums[col_sums == 0] = 1  # avoid division by zero
        transition = similarity_matrix / col_sums
        scores = (1 - damping) / len(sentences) + damping * transition @ scores

    # Select top-scoring sentences, preserving original order
    ranked_indices = np.argsort(scores)[::-1][:num_sentences]
    selected = sorted(ranked_indices)

    return ". ".join(sentences[i] for i in selected) + "."
```

TextRank is fast and unsupervised, requiring no LLM calls. However, it optimizes for representativeness, not relevance to a specific query. A sentence that summarizes the overall document may be irrelevant to the user's actual question.

### Query-Aware Extractive Compression

For RAG pipelines and question-answering systems, extraction should be guided by the query. The goal shifts from "select representative sentences" to "select sentences that help answer this question."

```python
from sentence_transformers import SentenceTransformer, util

def query_aware_extract(
    text: str,
    query: str,
    max_sentences: int = 10,
    relevance_threshold: float = 0.3,
    model_name: str = "all-MiniLM-L6-v2"
) -> str:
    """Extract sentences most relevant to a specific query."""
    model = SentenceTransformer(model_name)

    sentences = [s.strip() for s in text.split(". ") if len(s.strip()) > 20]
    if len(sentences) <= max_sentences:
        return text

    # Encode query and sentences
    query_embedding = model.encode(query, convert_to_tensor=True)
    sentence_embeddings = model.encode(sentences, convert_to_tensor=True)

    # Compute relevance scores
    similarities = util.cos_sim(query_embedding, sentence_embeddings)[0]

    # Select sentences above threshold, ranked by relevance
    scored = [(i, float(similarities[i])) for i in range(len(sentences))]
    relevant = [
        (i, score) for i, score in scored
        if score >= relevance_threshold
    ]
    relevant.sort(key=lambda x: x[1], reverse=True)
    selected_indices = sorted([i for i, _ in relevant[:max_sentences]])

    return ". ".join(sentences[i] for i in selected_indices) + "."
```

### LLM-Based Extraction

The most capable extraction uses an LLM to identify relevant passages, leveraging its understanding of both the content and the query. This trades compute cost for extraction quality.

```python
from openai import OpenAI

client = OpenAI()

def llm_extract(
    text: str,
    query: str,
    target_token_count: int = 500
) -> str:
    """Use an LLM to extract the most relevant portions of text."""
    response = client.chat.completions.create(
        model="gpt-4o-mini",  # Use a cheap, fast model for extraction
        messages=[
            {
                "role": "system",
                "content": (
                    f"You are a precise text extractor. Given a query and a document, "
                    f"extract ONLY the sentences and passages that are directly relevant "
                    f"to answering the query. Preserve exact wording -- do not "
                    f"paraphrase or summarize. Target approximately {target_token_count} "
                    f"tokens of extracted content. If the document contains no relevant "
                    f"information, respond with 'NO_RELEVANT_CONTENT'."
                ),
            },
            {
                "role": "user",
                "content": f"Query: {query}\n\nDocument:\n{text}",
            },
        ],
        max_tokens=target_token_count + 100,
        temperature=0.0,
    )
    return response.choices[0].message.content
```

LLM-based extraction is particularly effective for complex documents where relevance depends on reasoning rather than surface-level similarity. However, it introduces a latency and cost tradeoff: you spend tokens on the extraction call to save tokens on the final generation call. This is worthwhile when the extracted content will be used in a more expensive model or across multiple downstream tasks.

## Abstractive Compression

Abstractive compression rewrites content in a more concise form, generating new text that captures the essential meaning of the original. Unlike extraction, it can combine information from multiple passages, resolve redundancy, and produce text more dense in information per token.

### Single-Pass Summarization

The simplest abstractive compression: send the content to an LLM with instructions to summarize.

```python
def summarize_for_context(
    text: str,
    purpose: str,
    target_tokens: int = 300
) -> str:
    """Summarize text for use as context in a downstream LLM call."""
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {
                "role": "system",
                "content": (
                    f"Summarize the following text in approximately {target_tokens} "
                    f"tokens. The summary will be used as context for this purpose: "
                    f"'{purpose}'. Focus on information relevant to that purpose. "
                    f"Preserve specific numbers, names, dates, and technical details. "
                    f"Omit generic background information."
                ),
            },
            {"role": "user", "content": text},
        ],
        temperature=0.0,
    )
    return response.choices[0].message.content
```

The `purpose` parameter is critical. A generic summary retains what the summarizer considers "important," which may not align with what the downstream task needs. Purpose-driven summarization consistently produces better context than generic summarization.

### Map-Reduce Summarization

When the source content exceeds the summarizer's own context window, or when you need to summarize content from multiple sources, map-reduce summarization splits the work into parallelizable chunks.

```
                    Source Documents
                   /    |    |    \
                  /     |    |     \
                 v      v    v      v
              ┌─────┐┌─────┐┌─────┐┌─────┐
     MAP      │Sum 1││Sum 2││Sum 3││Sum 4│   (parallel)
              └──┬──┘└──┬──┘└──┬──┘└──┬──┘
                 \      |    |      /
                  \     |    |     /
                   v    v    v    v
              ┌────────────────────────┐
    REDUCE    │   Combined Summary     │
              └────────────────────────┘
```

```python
import asyncio
from typing import Sequence

async def map_reduce_summarize(
    documents: Sequence[str],
    purpose: str,
    map_target_tokens: int = 300,
    reduce_target_tokens: int = 500,
) -> str:
    """Summarize multiple documents using map-reduce pattern."""

    async def map_single(doc: str) -> str:
        """Summarize a single document (map phase)."""
        response = await aclient.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "system",
                    "content": (
                        f"Summarize this document in ~{map_target_tokens} tokens. "
                        f"Focus on information relevant to: '{purpose}'. "
                        f"Preserve key facts, numbers, and technical details."
                    ),
                },
                {"role": "user", "content": doc},
            ],
            temperature=0.0,
        )
        return response.choices[0].message.content

    # MAP phase: summarize each document in parallel
    summaries = await asyncio.gather(*[map_single(doc) for doc in documents])

    # REDUCE phase: combine summaries into a single coherent summary
    combined = "\n\n---\n\n".join(
        f"[Document {i+1}]: {s}" for i, s in enumerate(summaries)
    )

    response = await aclient.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {
                "role": "system",
                "content": (
                    f"You have summaries of {len(documents)} documents. Combine them "
                    f"into a single coherent summary of ~{reduce_target_tokens} tokens. "
                    f"Deduplicate overlapping information. Resolve contradictions by "
                    f"noting both perspectives. Purpose: '{purpose}'."
                ),
            },
            {"role": "user", "content": combined},
        ],
        temperature=0.0,
    )
    return response.choices[0].message.content
```

Map-reduce is particularly effective when combined with [Chunking Strategies](/chunking-strategies) -- the chunking strategy determines the boundaries of each map unit, and the quality of chunking directly affects the quality of per-chunk summaries.

### Progressive Summarization

Progressive summarization maintains a running summary that is refined as new information arrives. Rather than re-summarizing everything from scratch, each step incorporates new content into the existing summary.

```python
class ProgressiveSummarizer:
    """Maintain a running summary that incorporates new content."""

    def __init__(self, purpose: str, max_summary_tokens: int = 800):
        self.purpose = purpose
        self.max_summary_tokens = max_summary_tokens
        self.summary = ""
        self.items_incorporated = 0

    async def incorporate(self, new_content: str) -> str:
        """Incorporate new content into the running summary."""
        if not self.summary:
            # First item -- just summarize it
            self.summary = await self._summarize(new_content)
            self.items_incorporated = 1
            return self.summary

        response = await aclient.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "system",
                    "content": (
                        f"You maintain a running summary for this purpose: "
                        f"'{self.purpose}'. You have an existing summary "
                        f"(incorporating {self.items_incorporated} items) and new "
                        f"content to incorporate. Produce an updated summary of "
                        f"~{self.max_summary_tokens} tokens that:\n"
                        f"1. Retains all important information from the existing summary\n"
                        f"2. Integrates new relevant information from the new content\n"
                        f"3. Removes information that is now superseded or redundant\n"
                        f"4. Preserves specific facts, numbers, and names"
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"EXISTING SUMMARY:\n{self.summary}\n\n"
                        f"NEW CONTENT:\n{new_content}"
                    ),
                },
            ],
            temperature=0.0,
        )
        self.summary = response.choices[0].message.content
        self.items_incorporated += 1
        return self.summary

    async def _summarize(self, content: str) -> str:
        response = await aclient.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "system",
                    "content": (
                        f"Summarize in ~{self.max_summary_tokens} tokens. "
                        f"Purpose: '{self.purpose}'."
                    ),
                },
                {"role": "user", "content": content},
            ],
            temperature=0.0,
        )
        return response.choices[0].message.content
```

The risk of progressive summarization is information drift: details from early items may be gradually eroded as later items push them out. Mitigation strategies include maintaining a separate "key facts" list that is never compressed, or periodically re-summarizing from the original sources.

### Hierarchical Summarization

For very large document collections, hierarchical summarization organizes the compression into levels -- leaf summaries, section summaries, document summaries, and collection summaries.

```
Collection Summary (100 tokens)
    |
    +-- Category A Summary (200 tokens)
    |       |
    |       +-- Doc 1 Summary (300 tokens)
    |       |       |-- Chunk 1.1 (original)
    |       |       |-- Chunk 1.2 (original)
    |       |
    |       +-- Doc 2 Summary (300 tokens)
    |               |-- Chunk 2.1 (original)
    |               |-- Chunk 2.2 (original)
    |
    +-- Category B Summary (200 tokens)
            |
            +-- Doc 3 Summary (300 tokens)
            +-- Doc 4 Summary (300 tokens)
```

This structure enables efficient retrieval at different granularities. A high-level question ("What topics does this collection cover?") can be answered from the collection summary alone. A specific question ("What was the Q3 revenue figure?") can first route to the relevant category summary, then to the relevant document, then to the specific chunk -- each level acting as a filter that narrows the search space.

## Conversation Compression

Long-running conversations present a special compression challenge: the history grows linearly with interaction length, but the model's ability to use that history does not. Conversation compression techniques manage this growth while preserving the context needed for coherent dialogue.

### Rolling Summaries

The simplest approach maintains a summary of the conversation so far, updating it as new messages arrive.

```python
class ConversationCompressor:
    """Manage conversation history with rolling compression."""

    def __init__(
        self,
        max_history_tokens: int = 4000,
        summary_trigger_tokens: int = 3000,
        keep_recent_turns: int = 4,
    ):
        self.max_history_tokens = max_history_tokens
        self.summary_trigger_tokens = summary_trigger_tokens
        self.keep_recent_turns = keep_recent_turns
        self.messages: list[dict] = []
        self.summary: str = ""
        self.summary_turn_count: int = 0

    def add_turn(self, role: str, content: str):
        self.messages.append({"role": role, "content": content})

        if self._estimate_tokens() > self.summary_trigger_tokens:
            self._compress()

    def _compress(self):
        """Compress older turns into the rolling summary."""
        # Partition: messages to summarize vs. messages to keep
        cutoff = len(self.messages) - (self.keep_recent_turns * 2)
        if cutoff <= 0:
            return

        to_summarize = self.messages[:cutoff]
        self.messages = self.messages[cutoff:]

        # Build text to summarize
        history_text = "\n".join(
            f"{m['role'].upper()}: {m['content']}" for m in to_summarize
        )

        prompt = (
            f"You are compressing conversation history. "
            f"Current summary (covers {self.summary_turn_count} turns):\n"
            f"{self.summary or '(none yet)'}\n\n"
            f"New turns to incorporate:\n{history_text}\n\n"
            f"Produce an updated summary that preserves:\n"
            f"- Key decisions made and their reasoning\n"
            f"- Important facts, names, numbers mentioned\n"
            f"- User preferences and constraints stated\n"
            f"- Current state of any ongoing task\n"
            f"- Any commitments or action items\n"
            f"Omit: greetings, filler, repeated information."
        )

        self.summary = llm_call(prompt)
        self.summary_turn_count += len(to_summarize)

    def get_context(self) -> list[dict]:
        """Return the compressed context for the next LLM call."""
        context = []
        if self.summary:
            context.append({
                "role": "system",
                "content": (
                    f"[Conversation summary covering "
                    f"{self.summary_turn_count} earlier turns]:\n"
                    f"{self.summary}"
                ),
            })
        context.extend(self.messages)
        return context

    def _estimate_tokens(self) -> int:
        total = len(self.summary) // 4  # rough estimate
        for m in self.messages:
            total += len(m["content"]) // 4
        return total
```

### Hierarchical Conversation Summaries

For very long sessions -- a coding agent working over hours, a customer support conversation spanning multiple issues -- a single rolling summary eventually loses too much detail. Hierarchical summaries maintain multiple levels of compression.

```python
class HierarchicalConversationMemory:
    """Multi-level conversation compression."""

    def __init__(self):
        # Level 0: Raw recent messages (last ~10 turns)
        self.recent_messages: list[dict] = []

        # Level 1: Detailed summary of recent segment (~500 tokens)
        self.segment_summaries: list[str] = []

        # Level 2: High-level session summary (~200 tokens)
        self.session_summary: str = ""

        self.turns_in_current_segment: int = 0
        self.segment_size: int = 20  # turns per segment

    def add_turn(self, role: str, content: str):
        self.recent_messages.append({"role": role, "content": content})
        self.turns_in_current_segment += 1

        # When recent messages grow too large, compress a segment
        if self.turns_in_current_segment >= self.segment_size:
            self._compress_segment()

        # When too many segment summaries accumulate, compress the session
        if len(self.segment_summaries) >= 5:
            self._compress_session()

    def _compress_segment(self):
        """Compress oldest messages into a segment summary."""
        cutoff = len(self.recent_messages) - 8  # keep last 8 messages
        if cutoff <= 0:
            return

        to_compress = self.recent_messages[:cutoff]
        self.recent_messages = self.recent_messages[cutoff:]

        history = "\n".join(
            f"{m['role']}: {m['content']}" for m in to_compress
        )
        segment_summary = llm_call(
            f"Summarize this conversation segment in ~200 tokens. "
            f"Preserve decisions, facts, task state:\n{history}"
        )
        self.segment_summaries.append(segment_summary)
        self.turns_in_current_segment = len(self.recent_messages) // 2

    def _compress_session(self):
        """Compress segment summaries into session summary."""
        segments_text = "\n---\n".join(self.segment_summaries)

        self.session_summary = llm_call(
            f"Previous session summary:\n{self.session_summary or '(none)'}\n\n"
            f"New segment summaries:\n{segments_text}\n\n"
            f"Produce an updated high-level session summary (~200 tokens) "
            f"covering the full conversation arc."
        )
        self.segment_summaries = []

    def get_context(self) -> str:
        """Assemble the multi-level context."""
        parts = []
        if self.session_summary:
            parts.append(f"[Session overview]: {self.session_summary}")
        for i, seg in enumerate(self.segment_summaries):
            parts.append(f"[Recent segment {i+1}]: {seg}")
        parts.append("[Current conversation]:")
        for m in self.recent_messages:
            parts.append(f"{m['role'].upper()}: {m['content']}")
        return "\n\n".join(parts)
```

This three-level architecture mirrors how human memory works: a detailed short-term buffer (recent messages), medium-term episodic memories (segment summaries), and a long-term gist (session summary). The approach described in [Agent Memory](/agent-memory) extends this pattern with persistence across sessions.

### Entity-Centric Conversation Compression

An alternative to chronological summarization is entity-centric compression, which maintains a structured record of entities mentioned in the conversation and what is known about each.

```python
from pydantic import BaseModel

class EntityRecord(BaseModel):
    name: str
    entity_type: str  # "person", "company", "project", "concept"
    facts: list[str]
    last_mentioned_turn: int

class EntityMemory:
    """Track entities and their attributes across conversation."""

    def __init__(self):
        self.entities: dict[str, EntityRecord] = {}
        self.turn_count: int = 0

    def update_from_turn(self, role: str, content: str):
        """Extract and update entities from a conversation turn."""
        self.turn_count += 1

        # Use LLM to extract entity updates
        response = llm_call(
            f"Extract entity information from this message.\n"
            f"Message ({role}): {content}\n\n"
            f"Known entities: {list(self.entities.keys())}\n\n"
            f"For each entity mentioned, provide:\n"
            f"- name: entity name\n"
            f"- type: person/company/project/concept\n"
            f"- new_facts: list of new facts learned about this entity\n"
            f"Return as JSON list.",
            response_format="json"
        )

        for update in response:
            name = update["name"]
            if name in self.entities:
                self.entities[name].facts.extend(update["new_facts"])
                self.entities[name].last_mentioned_turn = self.turn_count
            else:
                self.entities[name] = EntityRecord(
                    name=name,
                    entity_type=update["type"],
                    facts=update["new_facts"],
                    last_mentioned_turn=self.turn_count,
                )

    def get_context(self, max_entities: int = 10) -> str:
        """Generate compressed entity context."""
        # Prioritize recently mentioned entities
        sorted_entities = sorted(
            self.entities.values(),
            key=lambda e: e.last_mentioned_turn,
            reverse=True,
        )[:max_entities]

        lines = ["[Entity context from conversation]:"]
        for entity in sorted_entities:
            facts = "; ".join(entity.facts[-5:])  # last 5 facts per entity
            lines.append(f"- {entity.name} ({entity.type}): {facts}")

        return "\n".join(lines)
```

Entity-centric compression is particularly valuable for customer support and advisory conversations where the same entities (user accounts, products, issues) are discussed repeatedly. It avoids the redundancy of chronological summaries that might mention "the user's account" dozens of times.

## Token-Level Compression

The most aggressive compression operates at the token level, removing individual tokens that carry low information content. This family of techniques was pioneered by research from Microsoft and others, achieving 2-10x compression ratios while preserving most of the downstream task performance.

### LLMLingua: Learned Prompt Compression

LLMLingua (Jiang et al., 2023) and its successor LLMLingua-2 use a small language model to estimate the information content of each token, then remove tokens with low perplexity (i.e., tokens that are highly predictable from context and therefore carry little information).

The intuition is simple: in the sentence "The quick brown fox jumps over the lazy dog," tokens like "the," "over," and "the" are highly predictable from context and can be removed with minimal information loss. The content-bearing tokens -- "quick," "brown," "fox," "jumps," "lazy," "dog" -- are the ones the model actually needs.

```python
from llmlingua import PromptCompressor

def compress_with_llmlingua(
    context: str,
    question: str,
    target_ratio: float = 0.5,
    model_name: str = "microsoft/llmlingua-2-bert-base-multilingual-cased-meetingbank"
) -> str:
    """Compress context using LLMLingua-2 token-level compression."""
    compressor = PromptCompressor(
        model_name=model_name,
        use_llmlingua2=True,
    )

    result = compressor.compress_prompt(
        context=[context],
        question=question,
        rate=target_ratio,           # target compression ratio
        condition_in_question="after", # consider question for relevance
        reorder_context="sort",       # put most relevant content first
        dynamic_context_compression_ratio=0.3,  # compress less relevant
                                                 # chunks more aggressively
    )

    return result["compressed_prompt"]
```

LLMLingua-2 achieves 2-5x compression with less than 2% degradation on many benchmarks. The key insight of the system is that a small BERT-class model (110M parameters) can predict which tokens a larger model needs, because token informativeness is largely model-independent.

```
Original (28 tokens):
"The annual revenue of Acme Corporation increased by 15.3% in
 the fiscal year 2023, reaching a total of $4.2 billion."

LLMLingua compressed (14 tokens):
"annual revenue Acme Corporation increased 15.3% fiscal year
 2023 reaching total $4.2 billion"

Compression ratio: 2x
Information preserved: all key facts (entity, metric, value, time)
Information lost: grammatical connectors, articles
```

### Selective Context

Selective Context (Li et al., 2023) takes a complementary approach: rather than dropping individual tokens, it evaluates the self-information of each lexical unit (word, phrase, or sentence) and drops those with the lowest information content.

```python
import math
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer

class SelectiveContextCompressor:
    """Remove low-information lexical units based on self-information."""

    def __init__(self, model_name: str = "gpt2"):
        self.tokenizer = AutoTokenizer.from_pretrained(model_name)
        self.model = AutoModelForCausalLM.from_pretrained(model_name)
        self.model.eval()

    def _compute_self_information(self, text: str) -> list[tuple[str, float]]:
        """Compute self-information for each token."""
        inputs = self.tokenizer(text, return_tensors="pt")
        with torch.no_grad():
            outputs = self.model(**inputs)
            logits = outputs.logits

        # Self-information = -log P(token | context)
        token_infos = []
        for i in range(1, inputs["input_ids"].shape[1]):
            token_id = inputs["input_ids"][0, i]
            log_probs = torch.log_softmax(logits[0, i - 1], dim=-1)
            self_info = -log_probs[token_id].item()
            token_str = self.tokenizer.decode(token_id)
            token_infos.append((token_str, self_info))

        return token_infos

    def compress(
        self,
        text: str,
        target_ratio: float = 0.5,
        unit: str = "sentence",
    ) -> str:
        """Compress text by removing low-information units."""
        if unit == "sentence":
            return self._compress_by_sentence(text, target_ratio)
        else:
            return self._compress_by_token(text, target_ratio)

    def _compress_by_sentence(
        self, text: str, target_ratio: float
    ) -> str:
        """Remove low-information sentences."""
        sentences = [s.strip() for s in text.split(". ") if s.strip()]

        # Compute average self-information per sentence
        sentence_scores = []
        for sent in sentences:
            token_infos = self._compute_self_information(sent)
            if token_infos:
                avg_info = sum(info for _, info in token_infos) / len(token_infos)
            else:
                avg_info = 0.0
            sentence_scores.append((sent, avg_info))

        # Sort by information content (descending) and keep top fraction
        sentence_scores.sort(key=lambda x: x[1], reverse=True)
        keep_count = max(1, int(len(sentence_scores) * target_ratio))
        kept = sentence_scores[:keep_count]

        # Restore original order
        kept_set = {s for s, _ in kept}
        result = [s for s in sentences if s in kept_set]
        return ". ".join(result) + "."
```

### AutoCompressors

AutoCompressors (Chevalier et al., 2023) take a fundamentally different approach: instead of dropping tokens from the text representation, they train a model to produce a small set of "summary tokens" -- dense vector representations that capture the content of a longer passage. These summary tokens are then prepended to the context in place of the original text.

```
┌─────────────────────────────────────────┐
│     Original Context (2000 tokens)      │
│  "The quarterly earnings report for..." │
└──────────────────┬──────────────────────┘
                   │
                   v
         ┌─────────────────┐
         │ AutoCompressor   │
         │ (fine-tuned LM)  │
         └────────┬────────┘
                  │
                  v
    ┌──────────────────────────┐
    │ Summary Tokens (50 soft  │
    │ tokens -- not human-     │
    │ readable, but encode     │
    │ the full passage content │
    │ in the embedding space)  │
    └──────────────────────────┘
                  │
                  v
    ┌──────────────────────────────────┐
    │ [Summary Tokens] + [New Query]   │
    │  50 tokens      + 200 tokens     │
    │  = 250 tokens total              │
    │  (vs. 2200 without compression)  │
    └──────────────────────────────────┘
```

This approach achieves extreme compression ratios (40x+) but requires a specially trained compressor model and produces representations that are not human-interpretable. It is most suitable for systems where the compressed context is consumed only by models, not inspected by humans.

## Retrieval as Compression

The most powerful form of compression is not compressing existing content but avoiding the need for compression entirely by retrieving only what is needed. As covered in [Advanced RAG](/advanced-rag), precision-oriented retrieval is fundamentally a compression strategy: selecting 5 highly relevant passages from a corpus of 10,000 achieves a 2000x "compression ratio" while preserving the most useful information.

### Precision Over Recall

The traditional information retrieval mindset optimizes for recall -- "don't miss anything relevant." For context compression, the priority inverts: optimize for precision -- "don't include anything irrelevant."

```python
class PrecisionRetriever:
    """Retrieval pipeline optimized for context compression."""

    def __init__(self, vector_store, reranker, llm_filter):
        self.vector_store = vector_store
        self.reranker = reranker
        self.llm_filter = llm_filter

    async def retrieve(
        self,
        query: str,
        token_budget: int = 2000,
    ) -> list[str]:
        """Retrieve and filter passages to fit within token budget."""

        # Stage 1: Broad retrieval (high recall)
        candidates = await self.vector_store.search(query, top_k=50)

        # Stage 2: Reranking (improve precision)
        reranked = self.reranker.rerank(query, candidates, top_k=15)

        # Stage 3: LLM relevance filter (maximize precision)
        filtered = await self.llm_filter.filter(
            query=query,
            passages=reranked,
            threshold=0.7,  # only keep passages with >70% relevance
        )

        # Stage 4: Token budget enforcement
        selected = []
        token_count = 0
        for passage in filtered:
            passage_tokens = len(passage.split()) * 1.3  # rough estimate
            if token_count + passage_tokens > token_budget:
                break
            selected.append(passage)
            token_count += passage_tokens

        return selected
```

### Multi-Stage Compression Pipeline

In production systems, retrieval and compression are often combined in a pipeline where each stage reduces the token count while preserving the information that matters.

```
┌────────────────────────────────┐
│ Corpus: 10M documents          │  Stage 0: Full corpus
└───────────────┬────────────────┘
                │ BM25 / Vector search
                v
┌────────────────────────────────┐
│ Retrieved: 50 passages         │  Stage 1: Retrieval
│ (~25,000 tokens)               │  ~400x compression
└───────────────┬────────────────┘
                │ Cross-encoder reranking
                v
┌────────────────────────────────┐
│ Reranked: 10 passages          │  Stage 2: Reranking
│ (~5,000 tokens)                │  ~5x compression
└───────────────┬────────────────┘
                │ Query-aware extraction
                v
┌────────────────────────────────┐
│ Extracted: key sentences       │  Stage 3: Extraction
│ (~2,000 tokens)                │  ~2.5x compression
└───────────────┬────────────────┘
                │ Abstractive summarization
                v
┌────────────────────────────────┐
│ Compressed: dense summary      │  Stage 4: Summarization
│ (~800 tokens)                  │  ~2.5x compression
└────────────────────────────────┘

Total compression: 10M docs → 800 tokens
Effective ratio: ~12,500x
```

This staged approach lets each technique operate in its optimal range. Retrieval handles the bulk reduction. Reranking improves precision. Extraction removes irrelevant sentences within passages. Summarization resolves redundancy across passages and increases information density.

## Structured Compression

Converting prose to structured formats -- JSON, tables, bullet points, or custom schemas -- often achieves significant token savings while preserving or even improving the model's ability to extract information.

### Prose to Structured Data

Consider a typical RAG passage about a company:

```
Prose (67 tokens):
"Acme Corporation, founded in 2015 by Jane Smith and headquartered in
San Francisco, California, is a technology company that specializes in
artificial intelligence and machine learning solutions for the healthcare
industry. The company reported annual revenue of $4.2 billion in fiscal
year 2023, representing a 15.3% increase over the previous year."

Structured (38 tokens):
Company: Acme Corporation
Founded: 2015
Founder: Jane Smith
HQ: San Francisco, CA
Sector: AI/ML for Healthcare
Revenue: $4.2B (FY2023, +15.3% YoY)
```

The structured version is 43% fewer tokens and arguably easier for the model to parse. The tradeoff is the loss of natural language fluency, which matters if the model needs to generate a natural-language response that quotes or paraphrases the source.

```python
def prose_to_structured(
    text: str,
    schema: dict,
    purpose: str = "general"
) -> str:
    """Convert prose to a structured format for token efficiency."""
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {
                "role": "system",
                "content": (
                    f"Convert the following text into a compact structured format "
                    f"using this schema:\n{json.dumps(schema, indent=2)}\n\n"
                    f"Rules:\n"
                    f"- Use abbreviations where standard (e.g., CA, AI/ML, YoY)\n"
                    f"- Omit fields that have no data in the source\n"
                    f"- Use compact value formats (e.g., $4.2B not $4,200,000,000)\n"
                    f"- Preserve all specific numbers, dates, and names\n"
                    f"Purpose: {purpose}"
                ),
            },
            {"role": "user", "content": text},
        ],
        temperature=0.0,
        response_format={"type": "json_object"},
    )
    return response.choices[0].message.content
```

### Table Compression for Multi-Entity Context

When context contains information about multiple comparable entities, tabular format achieves dramatic compression.

```
Prose (180 tokens):
"In Q3 2023, Company A reported revenue of $2.1 billion with a net
margin of 12%. Company B reported revenue of $1.8 billion with a net
margin of 15%. Company C reported revenue of $3.4 billion with a net
margin of 8%. Company D reported revenue of $0.9 billion with a net
margin of 22%."

Table (45 tokens):
| Company | Revenue  | Net Margin |
|---------|----------|------------|
| A       | $2.1B    | 12%        |
| B       | $1.8B    | 15%        |
| C       | $3.4B    | 8%         |
| D       | $0.9B    | 22%        |
```

The table is 75% fewer tokens and far easier for the model to compare entities -- the structured layout enables direct column-wise comparison that the model must infer from scattered prose in the uncompressed version.

### Structured Compression for Tool Outputs

Agent systems that call tools often receive verbose JSON responses. Compressing tool outputs before injecting them into context prevents a single API response from consuming thousands of tokens.

```python
def compress_tool_output(
    tool_name: str,
    raw_output: dict,
    relevant_fields: list[str] | None = None,
    max_items: int = 10,
) -> str:
    """Compress a tool's JSON output for context injection."""

    if relevant_fields:
        # Keep only specified fields
        if isinstance(raw_output, list):
            compressed = [
                {k: v for k, v in item.items() if k in relevant_fields}
                for item in raw_output[:max_items]
            ]
        elif isinstance(raw_output, dict):
            compressed = {
                k: v for k, v in raw_output.items()
                if k in relevant_fields
            }
        else:
            compressed = raw_output
    else:
        compressed = raw_output

    # Format compactly
    result = f"[{tool_name} result]:\n"
    if isinstance(compressed, list):
        total = len(raw_output) if isinstance(raw_output, list) else 0
        result += json.dumps(compressed, separators=(",", ":"))
        if total > max_items:
            result += f"\n({total - max_items} more items omitted)"
    else:
        result += json.dumps(compressed, separators=(",", ":"))

    return result
```

## Compressive Memory for Long-Running Agents

Agents that operate over extended periods -- hours, days, or indefinitely -- cannot rely on conversation compression alone. They need a compressive memory architecture that stores processed, compressed representations of past experience and retrieves them when relevant.

### The Compressive Memory Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    CONTEXT WINDOW                        │
│  ┌──────────┐ ┌──────────────┐ ┌──────────────────────┐│
│  │ System   │ │ Retrieved    │ │ Recent conversation  ││
│  │ prompt   │ │ memories     │ │ (uncompressed)       ││
│  │          │ │ (compressed) │ │                      ││
│  └──────────┘ └──────┬───────┘ └──────────────────────┘│
└──────────────────────┼──────────────────────────────────┘
                       │ retrieve
                       │
          ┌────────────┴────────────────┐
          │     COMPRESSIVE MEMORY      │
          │  ┌───────────────────────┐  │
          │  │ Episodic Store        │  │ Compressed records of
          │  │ (vector DB)           │  │ past interactions and
          │  │                       │  │ their outcomes
          │  ├───────────────────────┤  │
          │  │ Semantic Store        │  │ Distilled facts and
          │  │ (key-value + vector)  │  │ learned knowledge
          │  ├───────────────────────┤  │
          │  │ Procedural Store      │  │ Compressed plans,
          │  │ (structured records)  │  │ strategies, workflows
          │  └───────────────────────┘  │
          └─────────────────────────────┘
                       ^
                       │ compress + store
                       │
          ┌────────────┴────────────────┐
          │    COMPRESSION PIPELINE     │
          │  1. Extract key information │
          │  2. Structure into records  │
          │  3. Embed for retrieval     │
          │  4. Store with metadata     │
          └─────────────────────────────┘
```

```python
from dataclasses import dataclass, field
from datetime import datetime
import hashlib

@dataclass
class MemoryRecord:
    content: str               # compressed content
    record_type: str           # "episodic", "semantic", "procedural"
    source_turn_range: tuple[int, int]  # which turns this covers
    created_at: datetime = field(default_factory=datetime.now)
    importance: float = 0.5    # 0-1 importance score
    access_count: int = 0      # retrieval frequency
    metadata: dict = field(default_factory=dict)

    @property
    def id(self) -> str:
        return hashlib.sha256(
            f"{self.content}{self.created_at}".encode()
        ).hexdigest()[:16]


class CompressiveMemoryStore:
    """Long-term compressed memory for persistent agents."""

    def __init__(self, vector_store, llm):
        self.vector_store = vector_store
        self.llm = llm
        self.records: dict[str, MemoryRecord] = {}

    async def compress_and_store(
        self,
        conversation_segment: list[dict],
        turn_range: tuple[int, int],
    ):
        """Compress a conversation segment into memory records."""

        text = "\n".join(
            f"{m['role']}: {m['content']}" for m in conversation_segment
        )

        # Extract different types of memories in parallel
        episodic, semantic, procedural = await asyncio.gather(
            self._extract_episodic(text),
            self._extract_semantic(text),
            self._extract_procedural(text),
        )

        # Store each extracted memory
        for content, record_type, importance in [
            *[(e, "episodic", 0.5) for e in episodic],
            *[(s, "semantic", 0.7) for s in semantic],
            *[(p, "procedural", 0.6) for p in procedural],
        ]:
            if content.strip():
                record = MemoryRecord(
                    content=content,
                    record_type=record_type,
                    source_turn_range=turn_range,
                    importance=importance,
                )
                self.records[record.id] = record
                await self.vector_store.upsert(
                    id=record.id,
                    text=content,
                    metadata={
                        "type": record_type,
                        "importance": importance,
                        "turn_range": str(turn_range),
                    },
                )

    async def retrieve(
        self,
        query: str,
        token_budget: int = 1000,
        type_filter: str | None = None,
    ) -> str:
        """Retrieve relevant compressed memories within token budget."""
        filters = {}
        if type_filter:
            filters["type"] = type_filter

        results = await self.vector_store.search(
            query=query,
            top_k=20,
            filters=filters,
        )

        # Rank by combined relevance and importance
        scored = []
        for result in results:
            record = self.records.get(result.id)
            if record:
                combined_score = (
                    result.similarity * 0.6 +
                    record.importance * 0.3 +
                    min(record.access_count / 10, 1.0) * 0.1
                )
                scored.append((record, combined_score))
                record.access_count += 1

        scored.sort(key=lambda x: x[1], reverse=True)

        # Pack within token budget
        selected = []
        tokens_used = 0
        for record, score in scored:
            record_tokens = len(record.content.split()) * 1.3
            if tokens_used + record_tokens > token_budget:
                break
            selected.append(record)
            tokens_used += record_tokens

        # Format for context injection
        if not selected:
            return ""

        parts = ["[Retrieved memories]:"]
        for record in selected:
            parts.append(f"[{record.record_type}] {record.content}")
        return "\n".join(parts)

    async def _extract_episodic(self, text: str) -> list[str]:
        """Extract episodic memories (what happened)."""
        response = await self.llm.generate(
            "Extract a list of key events/interactions from this conversation "
            "segment. Each should be a single concise sentence describing what "
            "happened and the outcome. Return as JSON list of strings.",
            text,
        )
        return json.loads(response)

    async def _extract_semantic(self, text: str) -> list[str]:
        """Extract semantic memories (facts learned)."""
        response = await self.llm.generate(
            "Extract factual information learned during this conversation. "
            "Include: user preferences, system configurations, domain facts, "
            "constraints discovered. Each fact as a concise statement. "
            "Return as JSON list of strings.",
            text,
        )
        return json.loads(response)

    async def _extract_procedural(self, text: str) -> list[str]:
        """Extract procedural memories (how to do things)."""
        response = await self.llm.generate(
            "Extract any procedures, workflows, or strategies discussed or "
            "developed in this conversation. Include what worked and what did "
            "not. Each as a concise description. Return as JSON list of strings.",
            text,
        )
        return json.loads(response)
```

This architecture connects directly to the memory systems described in [Agent Memory](/agent-memory) and the context management patterns in [Context Engineering](/context-engineering). The key insight is that compression is not a one-time operation but an ongoing process: as the agent operates, it continuously compresses recent experience into long-term memory, and retrieves from that memory to assemble context for each new interaction.

## Quality vs. Compression Tradeoff

Every compression technique trades information completeness for token efficiency. Understanding when this tradeoff is acceptable -- and when compression would destroy critical information -- is essential.

### Measuring Information Loss

The fundamental challenge is that "information loss" is task-dependent. A compression that drops company founding dates is lossless for a technical analysis task but lossy for a historical comparison. Three approaches to measuring loss:

**Downstream task performance.** The gold standard: compress the context, run the downstream task, and compare against the uncompressed baseline. The gap is the compression cost.

```python
async def measure_compression_loss(
    questions: list[str],
    contexts: list[str],
    compressor,
    evaluator,
    compression_ratios: list[float] = [0.25, 0.5, 0.75, 1.0],
) -> dict[float, float]:
    """Measure task performance at different compression ratios."""
    results = {}

    for ratio in compression_ratios:
        scores = []
        for question, context in zip(questions, contexts):
            if ratio < 1.0:
                compressed = compressor.compress(context, target_ratio=ratio)
            else:
                compressed = context  # baseline: no compression

            answer = await generate_answer(question, compressed)
            score = evaluator.evaluate(question, answer, context)
            scores.append(score)

        results[ratio] = sum(scores) / len(scores)

    return results

# Typical results:
# Ratio 1.00 (no compression): 0.85 accuracy
# Ratio 0.75 (25% compression): 0.84 accuracy (-1%)
# Ratio 0.50 (50% compression): 0.79 accuracy (-7%)
# Ratio 0.25 (75% compression): 0.62 accuracy (-27%)
```

**Information-theoretic metrics.** Measure the KL divergence between the model's output distribution when conditioned on compressed versus uncompressed context. High divergence indicates significant information loss.

**Human evaluation.** For subjective tasks (writing, advice, creative work), human evaluators compare outputs generated from compressed and uncompressed contexts, rating them on completeness, accuracy, and helpfulness.

### When Compression Hurts

Several patterns consistently resist compression:

**Precise numerical data.** Financial figures, measurements, dates, and quantities must be preserved exactly. Summarization that rounds "$4,237,891" to "approximately $4.2 million" may be acceptable for a summary but catastrophic for an accounting task.

**Logical arguments and proofs.** Multi-step reasoning chains lose coherence when intermediate steps are removed. A legal argument or mathematical proof compressed to its conclusion without the supporting steps is useless for a model that needs to verify or extend the reasoning.

**Code and structured data.** Source code, SQL queries, JSON schemas, and similar structured content have high information density by nature -- every token already matters. Compressing code by removing "low-information" tokens like variable names or type annotations destroys functionality.

**Contradictory or nuanced positions.** When a source contains opposing viewpoints or subtle qualifications, compression tends to flatten nuance. "The treatment is effective in 73% of cases but contraindicated for patients with condition X and requires monitoring for side effect Y" might compress to "The treatment is generally effective," losing critical safety information.

### The Compression Decision Framework

```
                    ┌──────────────────────────┐
                    │   Is the context within   │
                    │   the token budget?       │
                    └─────────┬────────────────┘
                              │
                    ┌─────────┴─────────┐
                    │ YES               │ NO
                    v                   v
           ┌───────────────┐  ┌────────────────────┐
           │ No compression │  │ Is precision        │
           │ needed         │  │ critical?           │
           └───────────────┘  └────────┬───────────┘
                                       │
                              ┌────────┴─────────┐
                              │ YES              │ NO
                              v                  v
                    ┌──────────────────┐ ┌─────────────────┐
                    │ Use extractive   │ │ Is redundancy    │
                    │ compression only │ │ significant?     │
                    │ (preserve exact  │ └────────┬────────┘
                    │ wording)         │          │
                    └──────────────────┘ ┌───────┴────────┐
                                         │ YES           │ NO
                                         v               v
                              ┌─────────────────┐ ┌──────────────┐
                              │ Use abstractive  │ │ Use retrieval │
                              │ + deduplication  │ │ with tighter  │
                              │ (map-reduce)     │ │ precision     │
                              └─────────────────┘ └──────────────┘
```

### Adaptive Compression Ratios

Rather than applying a fixed compression ratio, sophisticated systems adapt the compression level based on the content type and downstream task requirements.

```python
class AdaptiveCompressor:
    """Adjust compression ratio based on content characteristics."""

    # Content types and their compression tolerance
    COMPRESSION_PROFILES = {
        "narrative": {
            "max_ratio": 0.3,     # can compress aggressively
            "method": "abstractive",
            "preserve": ["key_events", "conclusions"],
        },
        "technical": {
            "max_ratio": 0.6,     # moderate compression
            "method": "extractive",
            "preserve": ["specifications", "procedures", "warnings"],
        },
        "numerical": {
            "max_ratio": 0.8,     # minimal compression
            "method": "structured",
            "preserve": ["all_numbers", "units", "relationships"],
        },
        "code": {
            "max_ratio": 0.9,     # almost no compression
            "method": "extractive",
            "preserve": ["function_signatures", "logic", "imports"],
        },
        "legal": {
            "max_ratio": 0.85,    # very conservative
            "method": "extractive",
            "preserve": ["definitions", "obligations", "conditions"],
        },
    }

    def __init__(self, classifier, compressors: dict):
        self.classifier = classifier
        self.compressors = compressors

    async def compress(
        self,
        text: str,
        token_budget: int,
        query: str | None = None,
    ) -> str:
        """Adaptively compress text based on detected content type."""
        # Classify content type
        content_type = await self.classifier.classify(text)
        profile = self.COMPRESSION_PROFILES.get(
            content_type,
            self.COMPRESSION_PROFILES["narrative"],
        )

        # Calculate required compression
        current_tokens = len(text.split()) * 1.3
        required_ratio = token_budget / current_tokens

        if required_ratio >= 1.0:
            return text  # fits already

        # Enforce minimum ratio for content type
        effective_ratio = max(required_ratio, profile["max_ratio"])

        if effective_ratio < required_ratio:
            # Cannot compress enough while preserving content quality
            # Fall back to extractive + truncation with warning
            compressed = await self.compressors["extractive"].compress(
                text, query=query, target_ratio=effective_ratio
            )
            return compressed + "\n[NOTE: Context truncated. Some information may be missing.]"

        # Apply the appropriate compression method
        compressor = self.compressors[profile["method"]]
        return await compressor.compress(
            text,
            query=query,
            target_ratio=required_ratio,
            preserve=profile["preserve"],
        )
```

## Putting It All Together: A Production Compression Pipeline

Real systems combine multiple compression techniques in a pipeline. Here is an end-to-end example for a RAG system that assembles context from multiple sources under a strict token budget.

```python
from dataclasses import dataclass
from enum import Enum

class CompressionStrategy(str, Enum):
    NONE = "none"
    EXTRACTIVE = "extractive"
    ABSTRACTIVE = "abstractive"
    STRUCTURED = "structured"
    TOKEN_LEVEL = "token_level"

@dataclass
class ContextBlock:
    """A block of context with metadata for compression decisions."""
    content: str
    source: str
    token_count: int
    priority: float          # 0-1, higher = more important
    compressible: bool       # False for code, schemas, etc.
    compression_applied: CompressionStrategy = CompressionStrategy.NONE

class ContextAssembler:
    """Assemble context from multiple sources within a token budget."""

    def __init__(
        self,
        token_budget: int = 8000,
        reserved_for_system: int = 800,
        reserved_for_output: int = 2000,
    ):
        self.available_tokens = (
            token_budget - reserved_for_system - reserved_for_output
        )
        self.extractive = QueryAwareExtractor()
        self.abstractive = AbstractiveSummarizer()
        self.structured = StructuredCompressor()

    async def assemble(
        self,
        blocks: list[ContextBlock],
        query: str,
    ) -> str:
        """Assemble context blocks into a single context string."""

        # Sort by priority (highest first)
        blocks.sort(key=lambda b: b.priority, reverse=True)

        total_tokens = sum(b.token_count for b in blocks)

        if total_tokens <= self.available_tokens:
            # Everything fits -- no compression needed
            return self._format_blocks(blocks)

        # Phase 1: Try to fit with extractive compression on low-priority blocks
        compressed_blocks = await self._phase_extractive(
            blocks, query, self.available_tokens
        )

        total_after_phase1 = sum(b.token_count for b in compressed_blocks)
        if total_after_phase1 <= self.available_tokens:
            return self._format_blocks(compressed_blocks)

        # Phase 2: Apply abstractive compression to medium-priority blocks
        compressed_blocks = await self._phase_abstractive(
            compressed_blocks, query, self.available_tokens
        )

        total_after_phase2 = sum(b.token_count for b in compressed_blocks)
        if total_after_phase2 <= self.available_tokens:
            return self._format_blocks(compressed_blocks)

        # Phase 3: Truncate lowest-priority blocks
        compressed_blocks = self._phase_truncate(
            compressed_blocks, self.available_tokens
        )

        return self._format_blocks(compressed_blocks)

    async def _phase_extractive(
        self,
        blocks: list[ContextBlock],
        query: str,
        budget: int,
    ) -> list[ContextBlock]:
        """Apply extractive compression to low-priority compressible blocks."""
        result = []
        for block in blocks:
            if block.priority < 0.5 and block.compressible:
                target_ratio = 0.5
                compressed_content = await self.extractive.compress(
                    block.content, query, target_ratio
                )
                result.append(ContextBlock(
                    content=compressed_content,
                    source=block.source,
                    token_count=int(block.token_count * target_ratio),
                    priority=block.priority,
                    compressible=block.compressible,
                    compression_applied=CompressionStrategy.EXTRACTIVE,
                ))
            else:
                result.append(block)
        return result

    async def _phase_abstractive(
        self,
        blocks: list[ContextBlock],
        query: str,
        budget: int,
    ) -> list[ContextBlock]:
        """Apply abstractive compression to medium-priority blocks."""
        total = sum(b.token_count for b in blocks)
        overage = total - budget

        result = []
        for block in blocks:
            if (
                block.priority < 0.8
                and block.compressible
                and block.compression_applied != CompressionStrategy.ABSTRACTIVE
                and overage > 0
            ):
                target_tokens = max(
                    100,
                    block.token_count - int(overage / len(blocks))
                )
                compressed = await self.abstractive.compress(
                    block.content, query, target_tokens
                )
                saved = block.token_count - target_tokens
                overage -= saved
                result.append(ContextBlock(
                    content=compressed,
                    source=block.source,
                    token_count=target_tokens,
                    priority=block.priority,
                    compressible=block.compressible,
                    compression_applied=CompressionStrategy.ABSTRACTIVE,
                ))
            else:
                result.append(block)
        return result

    def _phase_truncate(
        self,
        blocks: list[ContextBlock],
        budget: int,
    ) -> list[ContextBlock]:
        """Last resort: drop lowest-priority blocks to fit budget."""
        # Blocks are already sorted by priority (highest first)
        result = []
        tokens_used = 0
        for block in blocks:
            if tokens_used + block.token_count <= budget:
                result.append(block)
                tokens_used += block.token_count
            else:
                # Try to fit a truncated version
                remaining = budget - tokens_used
                if remaining > 100:
                    truncated_content = block.content[:remaining * 4]  # rough
                    result.append(ContextBlock(
                        content=truncated_content + "\n[truncated]",
                        source=block.source,
                        token_count=remaining,
                        priority=block.priority,
                        compressible=block.compressible,
                        compression_applied=CompressionStrategy.NONE,
                    ))
                break
        return result

    def _format_blocks(self, blocks: list[ContextBlock]) -> str:
        parts = []
        for block in blocks:
            header = f"[Source: {block.source}]"
            if block.compression_applied != CompressionStrategy.NONE:
                header += f" (compressed: {block.compression_applied.value})"
            parts.append(f"{header}\n{block.content}")
        return "\n\n---\n\n".join(parts)
```

## Benchmarking Compression Techniques

Different compression techniques suit different scenarios. The following comparison summarizes typical performance characteristics across the methods discussed.

```
┌───────────────────┬───────────┬─────────┬──────────┬────────────┐
│ Technique         │ Compress. │ Quality │ Latency  │ Best For   │
│                   │ Ratio     │ Preserv │ Cost     │            │
├───────────────────┼───────────┼─────────┼──────────┼────────────┤
│ TextRank          │ 2-5x      │ Medium  │ Low      │ Generic    │
│ (extractive)      │           │         │ (no LLM) │ summaries  │
├───────────────────┼───────────┼─────────┼──────────┼────────────┤
│ Query-aware       │ 3-10x     │ High    │ Low      │ RAG        │
│ extraction        │           │         │ (no LLM) │ pipelines  │
├───────────────────┼───────────┼─────────┼──────────┼────────────┤
│ LLM extraction    │ 3-10x     │ High    │ Medium   │ Complex    │
│                   │           │         │ (1 call) │ documents  │
├───────────────────┼───────────┼─────────┼──────────┼────────────┤
│ Single-pass       │ 3-10x     │ Medium- │ Medium   │ General    │
│ summarization     │           │ High    │ (1 call) │ compression│
├───────────────────┼───────────┼─────────┼──────────┼────────────┤
│ Map-reduce        │ 5-50x     │ Medium  │ High     │ Multi-doc  │
│ summarization     │           │         │ (N+1)    │ synthesis  │
├───────────────────┼───────────┼─────────┼──────────┼────────────┤
│ Progressive       │ 5-20x     │ Medium  │ Amortized│ Streaming  │
│ summarization     │           │         │ low      │ content    │
├───────────────────┼───────────┼─────────┼──────────┼────────────┤
│ LLMLingua-2       │ 2-5x      │ High    │ Low      │ Token      │
│ (token-level)     │           │         │ (BERT)   │ efficiency │
├───────────────────┼───────────┼─────────┼──────────┼────────────┤
│ Selective Context │ 2-4x      │ High    │ Low      │ Prompt     │
│                   │           │         │ (GPT-2)  │ compression│
├───────────────────┼───────────┼─────────┼──────────┼────────────┤
│ Structured        │ 2-4x      │ High    │ Medium   │ Entities,  │
│ compression       │           │         │ (1 call) │ tabular    │
├───────────────────┼───────────┼─────────┼──────────┼────────────┤
│ Precision         │ 100-      │ Highest │ Medium-  │ Large      │
│ retrieval         │ 10000x    │         │ High     │ corpora    │
└───────────────────┴───────────┴─────────┴──────────┴────────────┘
```

## Practical Guidelines

Based on the techniques and tradeoffs discussed, here are guidelines for implementing compression in production systems.

**Start with better retrieval.** Before investing in compression, ensure your retrieval pipeline returns only relevant content. Improving precision from 60% to 90% effectively "compresses" context by 33% with zero information loss. See [Advanced RAG](/advanced-rag) and [Chunking Strategies](/chunking-strategies) for strategies.

**Layer compression techniques.** Use retrieval for the bulk reduction, extractive methods for passage-level filtering, and abstractive methods only when you need to resolve redundancy across passages or achieve very aggressive compression ratios.

**Preserve the uncommon.** Compression naturally removes rare or unusual information in favor of common patterns. Explicitly protect specific facts, numbers, names, and edge cases -- these are often exactly the information the downstream task needs.

**Measure task-specific quality.** A 50% compression ratio that maintains 98% accuracy on one task might destroy performance on another. Always evaluate compression in the context of the specific downstream task, not in isolation.

**Budget for compression compute.** LLM-based compression costs tokens too. If you spend 1K tokens on a summarization call to save 2K tokens in the final call, the savings are real only if the final model is more expensive than the summarizer. Use cheap models (GPT-4o-mini, Claude 3.5 Haiku) for compression, reserving expensive models for the final generation.

**Cache compressed results.** If the same source content will be used across multiple queries or sessions, compress it once and cache the result. This is particularly effective for static knowledge base content, as discussed in [Context Window Management](/context-window-management).

**Make compression visible.** When compressed content is injected into context, annotate it: "[Summarized from 15 documents]" or "[Compressed: extractive, 3x ratio]." This gives the model (and human debuggers) information about potential gaps.

## Connections to Other Topics

Context compression connects to nearly every aspect of applied AI engineering:

- **Context assembly** ([Context Engineering](/context-engineering)): Compression is a core operation in context assembly pipelines, determining how much information fits within the token budget
- **Memory systems** ([Agent Memory](/agent-memory)): Compressive memory enables agents to maintain useful context across sessions without unbounded token growth
- **Document processing** ([Chunking Strategies](/chunking-strategies)): Chunk boundaries affect compression quality; good chunking reduces the need for compression
- **Retrieval quality** ([Advanced RAG](/advanced-rag)): Precision-oriented retrieval is the highest-leverage compression technique
- **Window management** ([Context Window Management](/context-window-management)): Compression is one of several strategies for operating within context window limits
- **Cost control** ([Cost Optimization](/cost-optimization)): Token reduction directly reduces API costs and latency
- **Model compression** ([Distillation & Compression](/distillation-compression)): While this article covers *context* compression (reducing input tokens), model compression reduces the model itself -- complementary approaches to the same efficiency goal
