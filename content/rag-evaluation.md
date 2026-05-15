# RAG Evaluation: Faithfulness, Relevance & Failure Modes

Evaluating retrieval-augmented generation systems is fundamentally harder than evaluating either retrieval or generation in isolation. A RAG pipeline can fail at retrieval, at synthesis, or at the interface between the two -- and different failure modes require different diagnostic approaches. This article provides a comprehensive framework for RAG evaluation, covering automated metrics, human evaluation protocols, systematic failure analysis, and the operational practices that enable continuous improvement of production RAG systems.

## Why RAG Evaluation Is Hard

Traditional IR evaluation measures retrieval quality (precision, recall, nDCG) against relevance judgments. Traditional NLG evaluation measures generation quality (BLEU, ROUGE, human ratings) against reference texts. RAG evaluation must assess both simultaneously, plus the interaction between them.

Consider a system that retrieves the correct document but generates an answer that contradicts it (synthesis failure). Or one that retrieves irrelevant documents but generates a plausible-sounding answer from parametric knowledge (retrieval failure masked by hallucination). Or one that retrieves relevant documents but overloads the context with noise, causing the LLM to miss the key information (context poisoning). Each failure mode is invisible to metrics that evaluate only one stage. The retrieval strategies themselves -- hybrid search, reranking, HyDE -- each introduce distinct failure surfaces (see [Article 16: Retrieval Strategies](/retrieval-strategies) for the design space).

### The Evaluation Stack

A comprehensive RAG evaluation framework must assess four layers:

1. **Retrieval quality**: Did we find the right documents?
2. **Context relevance**: Are the retrieved documents actually useful for answering the question?
3. **Faithfulness**: Is the generated answer grounded in the retrieved context?
4. **Answer correctness**: Is the final answer actually correct?

## The RAGAS Framework

RAGAS (Retrieval Augmented Generation Assessment, Es et al., 2023) provides the most widely adopted automated evaluation framework for RAG systems. It defines metrics for each layer of the evaluation stack and provides LLM-based implementations that don't require ground truth reference answers. These LLM-based metrics are instances of the LLM-as-Judge pattern (see [Article 33: LLM-as-Judge](/llm-as-judge) for a thorough treatment of calibration, biases, and reliability).

### Faithfulness

Faithfulness measures whether the generated answer is supported by the retrieved context. A faithful answer contains only claims that can be verified against the provided documents.

**How RAGAS measures faithfulness**:

1. Extract individual claims/statements from the generated answer
2. For each claim, check whether it can be inferred from the retrieved context
3. Faithfulness = (number of supported claims) / (total claims)

```python
from ragas.metrics import faithfulness
from ragas import evaluate
from datasets import Dataset

# Prepare evaluation data
eval_data = Dataset.from_dict({
    "question": ["What is the capital of France?"],
    "answer": ["Paris is the capital of France, with a population of about 2.1 million."],
    "contexts": [["Paris is the capital and most populous city of France. The city proper has a population of 2,102,650."]],
})

result = evaluate(eval_data, metrics=[faithfulness])
print(f"Faithfulness: {result['faithfulness']:.3f}")
# Output: Faithfulness: 1.000 (both claims are supported by context)
```

**Interpreting faithfulness scores**:
- 1.0: Every claim in the answer is supported by the retrieved context
- 0.5-0.9: Some claims are supported; others are hallucinated or from parametric knowledge
- < 0.5: The answer is largely unsupported by the retrieved context

A low faithfulness score with a correct answer suggests the model is using parametric knowledge rather than the retrieved context -- a problem because parametric knowledge may be outdated or wrong for other queries.

### Context Relevance (Context Precision and Context Recall)

Context relevance evaluates the quality of the retrieved documents relative to the question.

**Context Precision**: What fraction of the retrieved documents are actually relevant?

```python
from ragas.metrics import context_precision

# High precision: all retrieved docs are relevant
# Low precision: many irrelevant docs retrieved (noise in context)
```

**Context Recall**: What fraction of the information needed to answer the question is present in the retrieved context?

```python
from ragas.metrics import context_recall

# Requires ground truth answer to compute
# Checks if every statement in the ground truth can be attributed to the context
eval_data = Dataset.from_dict({
    "question": ["What are the main causes of climate change?"],
    "answer": ["The main causes include greenhouse gas emissions, deforestation, and industrial processes."],
    "contexts": [["Greenhouse gas emissions from burning fossil fuels are the primary driver of climate change. Deforestation contributes by reducing CO2 absorption."]],
    "ground_truth": ["Climate change is primarily caused by greenhouse gas emissions from fossil fuels, deforestation, industrial processes, and agriculture."]
})

result = evaluate(eval_data, metrics=[context_recall])
# Context recall will be < 1.0 because "agriculture" is in ground truth but not in context
```

### Answer Relevance

Answer relevance measures whether the generated answer actually addresses the question asked. An answer might be faithful (fully supported by context) but irrelevant (answering a different question than what was asked).

RAGAS measures this by generating synthetic questions from the answer and computing the similarity between these generated questions and the original question. If the answer is relevant, the generated questions should be similar to the original.

### Answer Correctness

Answer correctness compares the generated answer against a ground truth reference. This requires labeled data but provides the most definitive quality signal.

```python
from ragas.metrics import answer_correctness

eval_data = Dataset.from_dict({
    "question": ["When was Python first released?"],
    "answer": ["Python was first released in 1991 by Guido van Rossum."],
    "ground_truth": ["Python was first released on February 20, 1991."]
})

result = evaluate(eval_data, metrics=[answer_correctness])
# Score reflects both factual accuracy and completeness
```

## Building an Evaluation Dataset

The quality of your evaluation is bounded by the quality of your evaluation dataset. There is no shortcut here.

### Manual Curation

The gold standard: domain experts create question-answer-context triples:

```python
evaluation_set = [
    {
        "question": "What is the maximum batch size supported by the API?",
        "ground_truth_answer": "The API supports a maximum batch size of 2048 items per request.",
        "ground_truth_contexts": ["doc_id_47"],  # Documents that contain the answer
        "difficulty": "easy",
        "category": "factual",
        "source": "api_documentation"
    },
    {
        "question": "How does the retry mechanism interact with rate limiting?",
        "ground_truth_answer": "The retry mechanism uses exponential backoff starting at 1 second, and respects the Retry-After header from rate limit responses.",
        "ground_truth_contexts": ["doc_id_12", "doc_id_89"],
        "difficulty": "medium",
        "category": "procedural",
        "source": "api_documentation"
    }
]
```

### Synthetic Evaluation Data

For bootstrapping, generate evaluation questions from your documents using an LLM:

```python
def generate_eval_questions(document: str, n_questions: int = 5) -> list[dict]:
    """Generate evaluation questions with ground truth from a document."""
    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[{
            "role": "system",
            "content": """Generate evaluation questions from this document.
            For each question, provide:
            1. The question
            2. The answer (extracted directly from the document)
            3. The specific sentence(s) in the document that contain the answer
            4. Difficulty level (easy/medium/hard)

            Generate diverse question types: factual, inferential, comparative.
            Return as JSON array."""
        }, {
            "role": "user",
            "content": document
        }],
        response_format={"type": "json_object"}
    )
    return json.loads(response.choices[0].message.content)["questions"]
```

### Evaluation Dataset Quality Checklist

- **Diverse question types**: Include factual, conceptual, comparative, and procedural questions
- **Varying difficulty**: Easy (single document, explicit answer), medium (requires synthesis), hard (multi-hop, implicit)
- **Negative examples**: Include questions that cannot be answered from the corpus (to test the system's ability to say "I don't know")
- **Updated regularly**: As the document corpus changes, evaluation questions must be refreshed
- **Minimum size**: 100+ questions for statistical significance, ideally 500+ for robust evaluation

## Common Failure Modes

### Retrieval Failures

**Wrong documents retrieved**: The most basic failure. The embedding similarity between the query and the correct document is lower than between the query and irrelevant documents.

Diagnosis:
```python
def diagnose_retrieval_failure(query: str, expected_doc_ids: list[str], retriever, k: int = 20):
    """Diagnose why expected documents weren't retrieved."""
    results = retriever.search(query, top_k=k)
    retrieved_ids = [r.id for r in results]

    for expected_id in expected_doc_ids:
        if expected_id in retrieved_ids:
            rank = retrieved_ids.index(expected_id) + 1
            print(f"Doc {expected_id}: Found at rank {rank}")
        else:
            # Check the similarity score
            expected_doc = get_document(expected_id)
            query_emb = embed(query)
            doc_emb = embed(expected_doc.text)
            similarity = cosine_similarity(query_emb, doc_emb)

            # Compare to the similarity of the last retrieved result
            last_retrieved_sim = results[-1].score

            print(f"Doc {expected_id}: NOT FOUND")
            print(f"  Similarity to query: {similarity:.4f}")
            print(f"  Threshold (rank {k}): {last_retrieved_sim:.4f}")
            print(f"  Gap: {last_retrieved_sim - similarity:.4f}")

            # Check if it's a chunking issue
            chunks = get_chunks_for_document(expected_id)
            for chunk in chunks:
                chunk_sim = cosine_similarity(query_emb, embed(chunk.text))
                print(f"  Chunk {chunk.id} similarity: {chunk_sim:.4f}")
```

Common causes:
- **Vocabulary mismatch**: Query uses different terminology than the document
- **Chunking issues**: The relevant information is split across chunks, diluting the embedding
- **Embedding model limitation**: The embedding model doesn't understand the domain

**Correct document retrieved but wrong chunk**: The document is in the corpus, but the chunk containing the answer scored lower than other chunks from the same document.

Fix: Improve chunking strategy, add parent-child relationships, or use document-level retrieval with chunk-level reranking. Multi-hop and agentic retrieval approaches (see [Article 17: Advanced RAG](/advanced-rag)) can also recover from single-stage retrieval misses by iteratively refining the search.

### Synthesis Failures

**Hallucination despite correct context**: The LLM generates claims not supported by the retrieved documents, even when the documents contain the correct information.

```python
def detect_hallucination(question: str, context: list[str], answer: str) -> dict:
    """Use an LLM to detect hallucinated claims in the answer."""
    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[{
            "role": "system",
            "content": """Analyze the answer for claims not supported by the provided context.
            For each claim in the answer, classify it as:
            - SUPPORTED: Directly stated or clearly implied by the context
            - UNSUPPORTED: Not found in the context (potential hallucination)
            - PARTIALLY_SUPPORTED: Related information exists but the specific claim is not verified

            Return JSON: {"claims": [{"text": "...", "status": "...", "evidence": "..."}]}"""
        }, {
            "role": "user",
            "content": f"Context:\n{chr(10).join(context)}\n\nQuestion: {question}\n\nAnswer: {answer}"
        }],
        response_format={"type": "json_object"}
    )
    return json.loads(response.choices[0].message.content)
```

Common causes:
- **Insufficient instruction**: The system prompt doesn't strongly enough instruct the LLM to only use provided context
- **Parametric knowledge leakage**: The LLM's pre-training knowledge overwrites the context
- **Ambiguous context**: Multiple documents provide conflicting information

**Answer is too vague or generic**: The LLM produces a safe but unhelpful response, even with relevant context available.

Common causes:
- **Lost in the Middle** (Liu et al., 2023): Relevant information is in the middle of a long context, where LLM attention is weakest
- **Context overload**: Too many documents dilute the signal
- **Poor prompt engineering**: The generation prompt doesn't encourage specificity (see [Article 11: Prompt Optimization](/prompt-optimization) for systematic approaches to prompt improvement)

### Context Poisoning

**Adversarial or outdated content in the retrieval corpus**: If the corpus contains incorrect, outdated, or intentionally misleading content, and this content is retrieved, the LLM will faithfully reproduce the incorrect information.

This is particularly insidious because the answer will score well on faithfulness (it accurately reflects the context) but poorly on correctness. Defenses include:

- **Source quality scoring**: Weight retrieval results by source authority
- **Temporal recency weighting**: Prefer newer documents, especially for fast-changing topics
- **Cross-reference verification**: Retrieve from multiple independent sources and check for consistency

## Debugging RAG Pipelines

### The Trace-Based Approach

Every RAG query should produce a trace that can be inspected for debugging:

```python
@dataclass
class RAGTrace:
    query: str
    timestamp: datetime

    # Retrieval stage
    query_embedding: list[float]  # For debugging embedding issues
    retrieval_strategy: str
    retrieved_docs: list[dict]  # id, text, score, metadata
    retrieval_latency_ms: float

    # Reranking stage (if applicable)
    reranked_docs: list[dict]
    reranking_latency_ms: float

    # Generation stage
    prompt_tokens: int
    completion_tokens: int
    generation_latency_ms: float
    generated_answer: str

    # Evaluation (computed post-hoc or in real-time)
    faithfulness_score: float = None
    relevance_score: float = None
    user_feedback: str = None  # thumbs up/down, correction

class RAGDebugger:
    def analyze_trace(self, trace: RAGTrace) -> dict:
        """Analyze a trace for common issues."""
        issues = []

        # Check retrieval quality
        if all(doc["score"] < 0.3 for doc in trace.retrieved_docs):
            issues.append({
                "stage": "retrieval",
                "issue": "low_similarity_scores",
                "detail": "All retrieved documents have low similarity scores",
                "suggestion": "Check if the query domain matches the corpus. Consider query expansion or HyDE."
            })

        # Check for context duplication
        texts = [doc["text"] for doc in trace.retrieved_docs]
        unique_ratio = len(set(texts)) / len(texts) if texts else 1
        if unique_ratio < 0.8:
            issues.append({
                "stage": "retrieval",
                "issue": "duplicate_chunks",
                "detail": f"Only {unique_ratio:.0%} of retrieved chunks are unique",
                "suggestion": "Review chunking strategy for overlapping chunks. Add deduplication."
            })

        # Check context utilization
        if trace.faithfulness_score and trace.faithfulness_score < 0.5:
            issues.append({
                "stage": "generation",
                "issue": "low_faithfulness",
                "detail": "Answer is not well-grounded in retrieved context",
                "suggestion": "Strengthen grounding instructions in the system prompt. Check if context is too long."
            })

        return {"issues": issues, "trace_id": id(trace)}
```

### Systematic Error Analysis

Beyond individual trace debugging, aggregate analysis reveals systematic issues:

```python
def systematic_analysis(traces: list[RAGTrace], eval_results: list[dict]) -> dict:
    """Identify systematic failure patterns across evaluation results."""

    # Group failures by category
    failure_categories = {
        "retrieval_failure": [],    # Low context recall
        "synthesis_failure": [],    # Low faithfulness despite good retrieval
        "relevance_failure": [],    # Answer doesn't address the question
        "no_answer_needed": [],     # System should have said "I don't know"
    }

    for trace, eval_result in zip(traces, eval_results):
        if eval_result["context_recall"] < 0.3:
            failure_categories["retrieval_failure"].append(trace)
        elif eval_result["context_recall"] > 0.7 and eval_result["faithfulness"] < 0.5:
            failure_categories["synthesis_failure"].append(trace)
        elif eval_result["answer_relevance"] < 0.5:
            failure_categories["relevance_failure"].append(trace)

    # Analyze each category
    report = {}
    for category, traces in failure_categories.items():
        if not traces:
            continue

        report[category] = {
            "count": len(traces),
            "percentage": len(traces) / len(eval_results) * 100,
            "example_queries": [t.query for t in traces[:5]],
            "common_patterns": analyze_common_patterns(traces)
        }

    return report
```

## A/B Testing Retrieval Changes

RAG systems evolve continuously -- new embedding models, different chunking strategies, updated rerankers. A/B testing is essential for validating that changes actually improve the system.

### Online A/B Testing

```python
import hashlib
import random

class RAGABTest:
    def __init__(self, control_pipeline, treatment_pipeline, traffic_split: float = 0.1):
        self.control = control_pipeline
        self.treatment = treatment_pipeline
        self.traffic_split = traffic_split
        self.metrics = {"control": [], "treatment": []}

    def route_query(self, query: str, user_id: str) -> str:
        """Deterministic routing based on user_id for consistency."""
        hash_val = int(hashlib.md5(user_id.encode()).hexdigest(), 16)
        return "treatment" if (hash_val % 100) < (self.traffic_split * 100) else "control"

    async def answer(self, query: str, user_id: str) -> dict:
        variant = self.route_query(query, user_id)
        pipeline = self.treatment if variant == "treatment" else self.control

        result = await pipeline.answer(query)
        result["ab_variant"] = variant

        # Log for analysis
        self.metrics[variant].append({
            "query": query,
            "latency_ms": result["latency_ms"],
            "num_docs_retrieved": len(result["sources"]),
            "user_feedback": None  # Populated later via feedback endpoint
        })

        return result

    def analyze_results(self) -> dict:
        """Statistical analysis of A/B test results."""
        control_feedback = [m for m in self.metrics["control"] if m["user_feedback"] is not None]
        treatment_feedback = [m for m in self.metrics["treatment"] if m["user_feedback"] is not None]

        control_positive_rate = sum(1 for m in control_feedback if m["user_feedback"] == "positive") / len(control_feedback) if control_feedback else 0
        treatment_positive_rate = sum(1 for m in treatment_feedback if m["user_feedback"] == "positive") / len(treatment_feedback) if treatment_feedback else 0

        return {
            "control_positive_rate": control_positive_rate,
            "treatment_positive_rate": treatment_positive_rate,
            "lift": (treatment_positive_rate - control_positive_rate) / control_positive_rate if control_positive_rate > 0 else None,
            "control_n": len(control_feedback),
            "treatment_n": len(treatment_feedback)
        }
```

### Offline Evaluation Before A/B Testing

Always run offline evaluation before exposing users to changes:

```python
def offline_comparison(
    eval_dataset: list[dict],
    control_pipeline,
    treatment_pipeline,
    metrics: list = ["faithfulness", "context_recall", "answer_correctness"]
) -> dict:
    """Compare two pipelines on the same evaluation dataset."""
    control_results = []
    treatment_results = []

    for item in eval_dataset:
        query = item["question"]

        # Run both pipelines
        control_answer = control_pipeline.answer(query)
        treatment_answer = treatment_pipeline.answer(query)

        # Evaluate both
        control_eval = evaluate_answer(
            query, control_answer, item["ground_truth"], item["contexts"], metrics
        )
        treatment_eval = evaluate_answer(
            query, treatment_answer, item["ground_truth"], item["contexts"], metrics
        )

        control_results.append(control_eval)
        treatment_results.append(treatment_eval)

    # Aggregate and compare
    comparison = {}
    for metric in metrics:
        control_scores = [r[metric] for r in control_results]
        treatment_scores = [r[metric] for r in treatment_results]

        comparison[metric] = {
            "control_mean": np.mean(control_scores),
            "treatment_mean": np.mean(treatment_scores),
            "delta": np.mean(treatment_scores) - np.mean(control_scores),
            "p_value": scipy.stats.ttest_rel(treatment_scores, control_scores).pvalue,
            # Per-query breakdown for diagnosis
            "improved": sum(1 for t, c in zip(treatment_scores, control_scores) if t > c),
            "degraded": sum(1 for t, c in zip(treatment_scores, control_scores) if t < c),
            "unchanged": sum(1 for t, c in zip(treatment_scores, control_scores) if t == c)
        }

    return comparison
```

### What to Measure in A/B Tests

**Primary metrics**:
- User satisfaction (thumbs up/down, explicit feedback)
- Task completion rate (for task-oriented RAG, e.g., customer support)
- Follow-up question rate (lower is better -- indicates the first answer was sufficient)

**Secondary metrics**:
- Latency (p50, p95, p99)
- Token usage (cost proxy)
- Retrieval diversity (are we returning results from diverse sources?)

**Guardrail metrics** (should not degrade):
- Hallucination rate (monitor faithfulness scores)
- "I don't know" rate (should not increase significantly)
- Error rate (system failures, timeouts)

## Continuous Evaluation in Production

### User Feedback Loops

The most valuable evaluation signal comes from users. Design feedback mechanisms that are low-friction:

```python
class FeedbackCollector:
    def collect_implicit_feedback(self, query: str, answer: str, user_actions: dict):
        """Collect implicit signals from user behavior."""
        signals = {
            "copied_answer": user_actions.get("copied", False),      # Positive signal
            "reformulated_query": user_actions.get("new_query", None), # Negative signal
            "clicked_source": user_actions.get("source_click", False), # Engagement
            "time_on_answer": user_actions.get("dwell_time_ms", 0),   # Engagement
            "abandoned": user_actions.get("abandoned", False),         # Strong negative
        }
        return signals

    def collect_explicit_feedback(self, query: str, answer: str) -> dict:
        """Explicit feedback UI elements."""
        return {
            "thumbs": "up|down",
            "correction": "optional free-text correction",
            "missing_info": "what information was missing?",
            "wrong_info": "what was incorrect?"
        }
```

### Monitoring Dashboard Essentials

A production RAG monitoring dashboard should track:

1. **Real-time**: Query volume, latency distribution, error rate
2. **Daily**: Average faithfulness, relevance, and correctness scores (sampled)
3. **Weekly**: Systematic failure analysis, retrieval coverage gaps, feedback trends
4. **Per change**: Before/after comparison on evaluation dataset

```python
# Lightweight production monitoring with sampling
class RAGMonitor:
    def __init__(self, sample_rate: float = 0.05):
        self.sample_rate = sample_rate

    async def monitor_query(self, trace: RAGTrace):
        """Sample queries for automated evaluation."""
        if random.random() > self.sample_rate:
            return  # Skip this query

        # Compute automated metrics
        faithfulness = await compute_faithfulness(
            trace.query, trace.retrieved_docs, trace.generated_answer
        )

        # Log to monitoring system
        self.log_metric("faithfulness", faithfulness, tags={
            "retrieval_strategy": trace.retrieval_strategy,
            "doc_count": len(trace.retrieved_docs)
        })

        # Alert on degradation
        if faithfulness < 0.3:
            self.alert(f"Low faithfulness ({faithfulness:.2f}) for query: {trace.query[:100]}")
```

## Alternative Evaluation Frameworks

RAGAS is the most cited RAG evaluation framework, but it is far from the only option. Several production-grade alternatives have emerged, each with distinct strengths. The right choice depends on your deployment context, existing infrastructure, and the specific quality dimensions you need to track.

### DeepEval

DeepEval is an open-source evaluation framework that emphasizes unit-test-style assertions for LLM outputs. Where RAGAS focuses on metrics, DeepEval focuses on test cases -- you define pass/fail thresholds and run evaluation suites like conventional test suites.

```python
from deepeval import assert_test
from deepeval.test_case import LLMTestCase
from deepeval.metrics import FaithfulnessMetric, AnswerRelevancyMetric

faithfulness = FaithfulnessMetric(threshold=0.7)
relevancy = AnswerRelevancyMetric(threshold=0.7)

test_case = LLMTestCase(
    input="What is the refund policy?",
    actual_output="Refunds are available within 30 days of purchase.",
    retrieval_context=["Our refund policy allows returns within 30 days."]
)

# Fails with AssertionError if either metric is below threshold
assert_test(test_case, [faithfulness, relevancy])
```

DeepEval's test-oriented design integrates naturally into CI/CD pipelines. It also provides a broader set of built-in metrics than RAGAS, including hallucination detection, toxicity, and bias scoring. Use DeepEval when you want to treat evaluation as part of your test suite rather than as a separate analytics workflow.

### TruLens

TruLens provides a feedback-function abstraction that decouples what you measure from how you measure it. Each feedback function can be backed by an LLM judge, a BERT-based scorer, or a custom function. TruLens wraps your RAG pipeline and intercepts calls to record full traces alongside feedback scores.

The key differentiator is its instrumentation layer: TruLens can wrap LangChain chains, LlamaIndex query engines, and custom pipelines with minimal code changes, recording every intermediate step. This makes it particularly strong for debugging -- you get a full trace of what was retrieved, what was sent to the LLM, and what was returned, alongside quality scores at each stage.

Use TruLens when you need deep instrumentation of an existing LangChain or LlamaIndex pipeline and want a visual dashboard for trace-level debugging.

### Langfuse

Langfuse is an open-source observability platform that combines tracing, evaluation, and prompt management. Unlike the other frameworks listed here, Langfuse is primarily an observability tool that happens to support evaluation, rather than an evaluation framework that happens to support observability.

Langfuse's evaluation support includes LLM-as-Judge scoring, user feedback collection, and annotation queues for human evaluation. Its main strength is production monitoring: it captures traces from live traffic, allows you to score a sample of queries using LLM judges, and tracks quality metrics over time. The prompt management layer lets you version prompts and link quality regressions to specific prompt changes.

Use Langfuse when your primary need is production observability with evaluation as a component, especially if you want an open-source alternative to commercial LLM observability platforms.

### Phoenix / Arize

Phoenix (by Arize AI) bridges ML observability and LLM evaluation. It provides embedding-based analysis -- you can visualize retrieval results in embedding space to understand why certain queries retrieve the wrong documents. Phoenix also supports LLM-as-Judge evaluation with built-in templates for faithfulness, relevance, and hallucination detection.

Phoenix stands out for its drift detection capabilities. In traditional ML, data drift degrades model performance; in RAG systems, document corpus drift (new documents, updated content, changed terminology) can silently degrade retrieval quality. Phoenix can detect when the distribution of query embeddings diverges from the distribution of document embeddings, flagging retrieval degradation before it manifests as user complaints.

Use Phoenix when you need embedding-level analysis of retrieval quality, drift detection, or integration with broader ML observability workflows.

### Choosing a Framework

| Criterion | RAGAS | DeepEval | TruLens | Langfuse | Phoenix |
|---|---|---|---|---|---|
| Primary paradigm | Metrics library | Test suite | Instrumentation | Observability | ML observability |
| CI/CD integration | Manual | Native | Manual | Via API | Via API |
| Production monitoring | Limited | Limited | Strong | Strong | Strong |
| Custom metrics | Moderate | Strong | Strong | Strong | Moderate |
| Open source | Yes | Yes | Yes | Yes | Yes |
| Visual debugging | No | Dashboard | Dashboard | Dashboard | Notebook + dashboard |

In practice, these tools are complementary rather than exclusive. A common pattern is to use RAGAS or DeepEval for offline evaluation during development, and Langfuse or Phoenix for production monitoring.

## LLM-as-Judge Reliability

Every LLM-based evaluation metric in the frameworks above -- faithfulness scoring, relevance assessment, hallucination detection -- relies on an LLM judge. This introduces a fundamental dependency: your evaluation is only as reliable as the judge model. For a comprehensive treatment of this pattern, see [Article 33: LLM-as-Judge](/llm-as-judge). Here we focus on the specific failure modes that arise when applying LLM judges to RAG evaluation.

### When LLM-Based Metrics Fail

**Faithfulness overestimation with paraphrasing**. LLM judges tend to mark paraphrased claims as "supported" even when the paraphrase subtly changes the meaning. A RAG answer that says "the policy was enacted in 2019" when the context says "the policy was proposed in 2019" may receive a high faithfulness score because the overall sentence structure is similar. This is especially dangerous for domains where precision matters -- legal, medical, financial.

**Self-consistency bias**. When the judge model is the same model (or model family) that generated the answer, it tends to rate the answer more favorably. This creates a systematic upward bias in faithfulness and relevance scores. Mitigation: use a different model family for judging than for generation, or use multiple judge models and take the minimum score.

**Length and fluency bias**. LLM judges consistently prefer longer, more fluent answers -- even when the shorter answer is more accurate. In RAG evaluation, this means a verbose hallucinated answer may score higher than a terse faithful one. Structured evaluation rubrics that force the judge to evaluate claim-by-claim (as RAGAS does for faithfulness) partially mitigate this, but do not eliminate it.

**Domain knowledge leakage**. When the judge model has parametric knowledge about the topic, it may mark claims as "supported by context" because they are factually true, even if the context does not actually contain that information. This inflates faithfulness scores and masks retrieval failures.

### Validating Against Human Judgments

No LLM-based evaluation should be deployed without calibration against human judgments. The calibration process:

1. **Collect a calibration set**: Take 100-200 representative RAG outputs and have domain experts score them on the same dimensions your LLM judge uses (faithfulness, relevance, correctness). Use the same scale -- if the LLM judge outputs 0-1 continuous scores, have humans use a 1-5 Likert scale and normalize.

2. **Compute agreement metrics**: Calculate Cohen's kappa or Kendall's tau between human and LLM scores. For RAG faithfulness evaluation, published benchmarks report Cohen's kappa of 0.5-0.7 between GPT-4-class judges and expert annotators -- moderate to substantial agreement, but far from perfect.

3. **Identify systematic disagreements**: Partition the cases where human and LLM scores diverge by more than one standard deviation. Look for patterns: does the LLM judge consistently overrate answers on certain topics? Does it fail to catch certain types of hallucination?

4. **Calibrate or adjust**: Based on the disagreement analysis, either adjust the judge prompt (adding domain-specific rubric examples), adjust the score thresholds (if the LLM judge is systematically lenient, lower the "pass" threshold), or flag certain query categories for mandatory human review.

### RAG-Specific Calibration Techniques

**Claim-level calibration**. Rather than calibrating at the answer level, calibrate at the claim level. Extract claims from 50 answers, have humans label each claim as supported/unsupported, and measure the LLM judge's claim-level precision and recall. This gives a more granular view of where the judge fails.

**Adversarial calibration examples**. Create synthetic test cases designed to fool the judge: answers with subtle factual modifications, answers that are correct but unsupported by context, and answers that faithfully reproduce incorrect context. These adversarial cases stress-test the judge and reveal its blind spots.

**Multi-judge ensembles**. Run the same evaluation through 2-3 different judge models (e.g., GPT-4o, Claude, Gemini) and flag cases where judges disagree. Disagreement is a strong signal that human review is needed. The ensemble agreement rate also serves as a confidence score for each evaluation.

## Evaluating Agentic RAG

Standard RAG evaluation assumes a single retrieval step followed by a single generation step. Agentic RAG systems -- where an LLM dynamically decides what to retrieve, when to retrieve, and whether to iterate -- break this assumption. The evaluation challenge is no longer just "did the system produce a good answer?" but "did the system take a good path to the answer?" For background on these architectures, see [Article 17: Advanced RAG](/advanced-rag).

### Multi-Step Retrieval Evaluation

An agentic RAG system might reformulate the query, search multiple indexes, read and discard documents, and perform several rounds of retrieval before generating an answer. Evaluating only the final answer misses critical information about pipeline efficiency and robustness.

**Step-level evaluation** assigns quality scores to each intermediate step:

```python
@dataclass
class AgenticRAGStep:
    step_type: str          # "query_reformulation", "retrieval", "rerank", "filter", "synthesize"
    input_state: dict       # What the agent knew before this step
    action: str             # What the agent decided to do
    result: dict            # What the step produced
    was_necessary: bool     # Human annotation: was this step needed?
    was_correct: bool       # Human annotation: did this step move toward the answer?

@dataclass
class AgenticRAGTrajectory:
    question: str
    steps: list[AgenticRAGStep]
    final_answer: str
    total_retrieval_calls: int
    total_tokens_used: int
    total_latency_ms: float

def evaluate_trajectory(trajectory: AgenticRAGTrajectory, ground_truth: dict) -> dict:
    """Evaluate both the answer and the path taken to reach it."""
    # Answer quality (standard metrics)
    answer_score = evaluate_answer_correctness(trajectory.final_answer, ground_truth["answer"])
    faithfulness = evaluate_faithfulness(trajectory.final_answer, trajectory.steps)

    # Trajectory quality
    necessary_steps = sum(1 for s in trajectory.steps if s.was_necessary)
    trajectory_efficiency = necessary_steps / len(trajectory.steps) if trajectory.steps else 1.0

    # Did the agent recover from mistakes?
    recoveries = sum(
        1 for i, s in enumerate(trajectory.steps)
        if not s.was_correct and i + 1 < len(trajectory.steps) and trajectory.steps[i + 1].was_correct
    )

    return {
        "answer_correctness": answer_score,
        "faithfulness": faithfulness,
        "trajectory_efficiency": trajectory_efficiency,
        "total_steps": len(trajectory.steps),
        "recovery_count": recoveries,
        "cost_tokens": trajectory.total_tokens_used,
        "latency_ms": trajectory.total_latency_ms
    }
```

### Trajectory Evaluation for Complex Pipelines

For systems that involve tool selection (choosing between vector search, SQL queries, API calls, or web search), trajectory evaluation must also assess tool selection quality:

- **Tool precision**: When the agent chose to use a tool, was it the right tool for that sub-problem?
- **Tool recall**: Were there steps where the agent should have used a tool but did not?
- **Ordering efficiency**: Did the agent sequence its tool calls in a logical order, or did it waste steps on redundant or out-of-order operations?
- **Termination quality**: Did the agent stop retrieving when it had sufficient information, or did it continue unnecessarily (wasting tokens and latency)?

These trajectory metrics are more informative than answer-only metrics for improving agentic RAG systems, because they identify which component of the agent loop needs improvement -- the retrieval strategy selection, the stopping criterion, or the synthesis step. The approach shares DNA with agent evaluation methods used outside RAG contexts; see the broader evaluation patterns in [Article 11: Prompt Optimization](/prompt-optimization) for how systematic optimization applies to these multi-step systems.

### Practical Considerations

Human annotation of trajectories is expensive -- labeling 100 multi-step trajectories may take 10-20 hours of expert time. Two pragmatic shortcuts:

1. **Annotate only disagreement cases**: Run automated answer-level evaluation first. Only annotate trajectories where the answer was wrong or where automated metrics diverge. This focuses human effort on the cases that matter.

2. **Use LLM judges for trajectory assessment**: An LLM can assess whether a retrieval step was necessary or whether a query reformulation improved the search, though with lower reliability than human annotators. Use LLM trajectory judgments as a first-pass filter and human annotation as the gold standard for a calibration subset.

## Evaluation Economics

LLM-based evaluation is not free. Running RAGAS faithfulness evaluation on a single query-answer pair requires one or two LLM calls (claim extraction + claim verification), each consuming tokens. At scale, evaluation costs can rival the cost of the RAG system itself.

### Cost Estimates

A rough cost model for LLM-based RAG evaluation:

| Metric | LLM calls per item | ~Tokens per call | Cost per 1K items (GPT-4o) |
|---|---|---|---|
| Faithfulness | 2 | 1,500 | ~$15 |
| Context relevance | 1 | 1,000 | ~$5 |
| Answer relevance | 1 | 800 | ~$4 |
| Answer correctness | 1 | 1,200 | ~$6 |
| Full suite (4 metrics) | 5 | ~5,500 | ~$30 |

For a production system handling 100K queries per day, evaluating every query with the full suite would cost approximately $3,000 per day -- clearly impractical. This makes evaluation economics a first-order design concern.

### Strategies for Reducing Evaluation Cost

**Sampling**. The most straightforward approach. Evaluate a random sample of production queries rather than every query. Statistical power analysis determines the sample size:

- To detect a 5% change in faithfulness with 95% confidence, you need approximately 1,500 evaluated samples.
- To detect a 10% change, approximately 400 samples suffice.
- For monitoring (detecting large regressions), 100-200 daily evaluations are often adequate.

Stratified sampling improves efficiency: sample more heavily from query categories with historically lower scores or higher variance.

**Cheaper judge models**. Not every evaluation requires GPT-4o. For many RAG evaluation tasks, smaller models provide sufficient discrimination:

```python
class TieredEvaluation:
    """Use cheap models for screening, expensive models for precision."""

    def __init__(self):
        self.fast_judge = "gpt-4o-mini"   # ~10x cheaper
        self.precise_judge = "gpt-4o"

    async def evaluate(self, query: str, answer: str, context: list[str]) -> dict:
        # First pass: cheap model
        fast_score = await self.score_faithfulness(query, answer, context, model=self.fast_judge)

        # Second pass: expensive model only for borderline cases
        if 0.3 < fast_score < 0.8:  # Borderline -- needs precise judgment
            precise_score = await self.score_faithfulness(
                query, answer, context, model=self.precise_judge
            )
            return {"faithfulness": precise_score, "judge": "precise", "cost_tier": "high"}

        # Clear pass or clear fail -- trust the cheap model
        return {"faithfulness": fast_score, "judge": "fast", "cost_tier": "low"}
```

This tiered approach typically reduces evaluation cost by 60-80% while maintaining quality for the cases that matter most -- the borderline ones where a wrong evaluation judgment would lead to incorrect system decisions.

**Caching evaluation results**. Many RAG systems produce identical or near-identical answers for similar queries. Cache evaluation results keyed on (context_hash, answer_hash) to avoid re-evaluating equivalent outputs. For systems with stable document corpora, this cache hit rate can be substantial.

**Offline batch evaluation**. Rather than evaluating in real-time (which adds latency and cost to every query), run evaluation in daily or hourly batches. This allows you to use spot instances or lower-priority API tiers and to aggregate results for trend analysis rather than per-query alerting. Reserve real-time evaluation for critical-path quality gates (e.g., before surfacing answers on high-stakes topics).

**Metric selection**. Not every query needs every metric. Faithfulness is the most operationally critical metric for most RAG systems -- it directly measures hallucination. Context recall requires ground truth and is therefore better suited to periodic offline evaluation. Answer relevance is most useful during development and A/B testing. Choosing which metrics to run on which queries reduces cost without sacrificing coverage of the dimensions that matter most.

## Summary and Key Takeaways

- **Evaluate all four layers**: retrieval quality, context relevance, faithfulness, and answer correctness. Metrics that evaluate only one stage will miss critical failures.
- **RAGAS** provides a practical, LLM-based evaluation framework that doesn't require ground truth for all metrics. Use it as a starting point, not the final word. Alternatives like DeepEval, TruLens, Langfuse, and Phoenix offer complementary strengths -- test-oriented workflows, deep instrumentation, production observability, and embedding-level analysis respectively.
- **Faithfulness is the most critical metric** for production RAG systems. An unfaithful answer erodes user trust regardless of how correct it happens to be.
- **Build a curated evaluation dataset** of at least 100 diverse questions with ground truth. This is the most valuable investment you can make in RAG quality.
- **Failure mode analysis** should be systematic: categorize failures (retrieval failure, synthesis failure, context poisoning), quantify each category, and prioritize fixes by impact.
- **Debugging requires traces**: Log the full pipeline trace (query, retrieved documents, scores, generated answer) for every query that receives negative feedback.
- **A/B test every change**: Run offline evaluation first, then online A/B testing with proper statistical analysis. RAG changes can have unexpected second-order effects.
- **User feedback** is the ground truth signal. Design low-friction feedback mechanisms and close the loop by using feedback to improve the evaluation dataset.
- **LLM judges are imperfect**: They overestimate faithfulness for paraphrased content, exhibit self-consistency bias, and prefer longer answers. Always calibrate against human judgments on a representative sample before trusting automated scores.
- **Agentic RAG requires trajectory evaluation**: For multi-step retrieval systems, evaluating only the final answer misses critical information about pipeline efficiency, tool selection quality, and recovery from intermediate failures.
- **Evaluation has a cost**: A full LLM-based evaluation suite costs roughly $30 per 1,000 items. Use sampling, tiered judge models, caching, and selective metric application to keep evaluation economically sustainable at production scale.
- The field is moving toward continuous, automated evaluation integrated into the serving pipeline rather than periodic batch evaluation. Monitor faithfulness and relevance in real-time with sampling.
