# Hallucination Detection & Mitigation: Grounding & Verification

Language models hallucinate -- they generate fluent, confident text that is factually wrong, unsupported by evidence, or entirely fabricated. This is not a bug to be patched but a fundamental property of probabilistic text generation. This article presents a systematic treatment of hallucination: its taxonomy, detection methods ranging from self-consistency checks to entailment verification, mitigation techniques including RAG and citation grounding, and production-grade verification pipelines like FActScore.

## The Nature of Hallucination

Hallucination in language models is the generation of content that is nonsensical or unfaithful to the provided source content (Maynez et al., 2020). Unlike human confabulation, which often fills gaps in memory with plausible reconstructions, LLM hallucination emerges from the statistical mechanics of next-token prediction. The model selects tokens that are probable given the context, but probability and truth are different things.

The term "hallucination" was borrowed from computer vision, where it referred to a neural network perceiving patterns that do not exist in the input. In NLP, Ji et al. (2023) in "Survey of Hallucination in Natural Language Generation" provided a comprehensive taxonomy that has become the standard reference.

### Why Models Hallucinate

Several factors contribute to hallucination. Training data noise means the model has learned incorrect associations from erroneous or contradictory training data. Exposure bias arises because during training, the model sees ground-truth prefixes, but during inference, it conditions on its own (potentially erroneous) outputs, leading to error accumulation. Knowledge cutoff means the model's knowledge is frozen at training time; questions about recent events produce confabulation. Distributional gaps mean that queries requiring knowledge the model has not seen lead to plausible-sounding but fabricated responses. And optimization pressure means RLHF training for helpfulness incentivizes the model to provide confident answers rather than admit uncertainty.

## Hallucination Taxonomy

### Intrinsic Hallucination

Intrinsic hallucination occurs when the model's output contradicts the source input. In a summarization task, an intrinsic hallucination changes the meaning of the source document:

```
Source: "The company reported Q3 revenue of $4.2 billion, up 12% year-over-year."
Hallucinated summary: "The company reported Q3 revenue of $4.8 billion, up 15%."
```

The model has generated specific numbers that contradict the source. This type of hallucination is particularly dangerous because it is difficult to detect without reference to the original document and the specific claims look authoritative.

### Extrinsic Hallucination

Extrinsic hallucination occurs when the model generates information that cannot be verified from the source -- neither supported nor contradicted. In a biography generation task:

```
Source: "Marie Curie won the Nobel Prize in Physics in 1903."
Hallucinated addition: "She celebrated her Nobel Prize by hosting a dinner
party at her laboratory in Paris, where she served Polish cuisine."
```

The dinner party detail is not contradicted by the source but is entirely fabricated. Extrinsic hallucinations are more common than intrinsic ones and harder to detect because they require world knowledge verification, not just source comparison.

### Open-Domain vs. Closed-Domain Hallucination

In closed-domain tasks (summarization, translation, data-to-text), hallucination can be detected by comparing output to input. In open-domain tasks (question answering, creative writing, conversation), there is no single source of truth, making detection far more challenging. Most production applications involve a mix of both: the model has access to retrieved documents (closed-domain) but may also draw on parametric knowledge (open-domain).

## Detection Methods

### Self-Consistency Checking

Wang et al. (2022) introduced self-consistency as a decoding strategy in "Self-Consistency Improves Chain of Thought Reasoning in Language Models." The core insight is that if a model truly knows something, it should produce consistent answers across multiple samples. Inconsistency signals uncertainty and potential hallucination:

```python
def check_self_consistency(
    model, prompt: str, n_samples: int = 5, temperature: float = 0.7
) -> tuple[str, float]:
    """Generate multiple responses and measure consistency."""
    responses = []
    for _ in range(n_samples):
        response = model.generate(prompt, temperature=temperature)
        responses.append(response)

    # Extract key claims from each response
    claims_per_response = [extract_claims(r) for r in responses]

    # Measure agreement across samples
    all_claims = set()
    for claims in claims_per_response:
        all_claims.update(claims)

    consistency_scores = {}
    for claim in all_claims:
        support_count = sum(
            1 for claims in claims_per_response if claim in claims
        )
        consistency_scores[claim] = support_count / n_samples

    # Return most consistent response and overall score
    avg_consistency = sum(consistency_scores.values()) / len(consistency_scores)
    best_response = select_most_consistent(responses, claims_per_response)
    return best_response, avg_consistency
```

Self-consistency is effective but expensive -- it requires multiple forward passes, multiplying inference cost by the number of samples. For production use, a balance must be struck between consistency checking thoroughness and latency/cost constraints.

### Entailment-Based Detection

Natural Language Inference (NLI) models can determine whether a hypothesis is entailed by, contradicted by, or neutral with respect to a premise. This maps directly to hallucination detection:

```python
from transformers import pipeline

nli_model = pipeline("text-classification",
                     model="cross-encoder/nli-deberta-v3-large")

def detect_hallucination_nli(
    source: str, generated: str
) -> list[dict]:
    """Check each generated sentence against source using NLI."""
    sentences = sent_tokenize(generated)
    results = []

    for sentence in sentences:
        # Check if source entails the generated sentence
        nli_result = nli_model(f"{source}</s></s>{sentence}")
        label = nli_result[0]["label"]
        score = nli_result[0]["score"]

        results.append({
            "sentence": sentence,
            "label": label,  # entailment, contradiction, neutral
            "score": score,
            "is_hallucination": label in ["contradiction", "neutral"]
                                and score > 0.7
        })

    return results
```

Entailment checking is particularly effective for closed-domain hallucination where source documents are available. For open-domain settings, it can be combined with retrieval -- first retrieve relevant documents, then check entailment against them.

### Token-Level Uncertainty Estimation

Model uncertainty at the token level can signal hallucination. Tokens generated with low probability or high entropy are more likely to be hallucinated:

```python
def compute_token_uncertainty(model, tokenizer, prompt: str, response: str):
    """Compute per-token entropy as uncertainty signal."""
    input_ids = tokenizer.encode(prompt + response, return_tensors="pt")
    prompt_len = len(tokenizer.encode(prompt))

    with torch.no_grad():
        outputs = model(input_ids)
        logits = outputs.logits

    # Compute entropy for each response token
    response_logits = logits[0, prompt_len - 1:-1]  # shift by 1 for next-token
    probs = torch.softmax(response_logits, dim=-1)
    entropy = -torch.sum(probs * torch.log(probs + 1e-10), dim=-1)

    tokens = tokenizer.convert_ids_to_tokens(input_ids[0, prompt_len:])

    return list(zip(tokens, entropy.tolist()))
```

High-entropy tokens warrant scrutiny. Research by Kadavath et al. (2022) in "Language Models (Mostly) Know What They Know" showed that model confidence correlates with accuracy, though the correlation is imperfect -- models can be confidently wrong.

### Semantic Similarity Cross-Check

For fact-heavy responses, semantic similarity between the generated text and retrieved evidence provides another detection signal:

```python
from sentence_transformers import SentenceTransformer, util

class SemanticGroundingChecker:
    def __init__(self):
        self.model = SentenceTransformer("all-MiniLM-L6-v2")

    def check_grounding(
        self, response: str, evidence_docs: list[str], threshold: float = 0.5
    ) -> list[dict]:
        response_sentences = sent_tokenize(response)
        evidence_embeddings = self.model.encode(evidence_docs)
        results = []

        for sentence in response_sentences:
            sent_embedding = self.model.encode(sentence)
            similarities = util.cos_sim(sent_embedding, evidence_embeddings)[0]
            max_sim = float(similarities.max())
            best_evidence_idx = int(similarities.argmax())

            results.append({
                "sentence": sentence,
                "max_similarity": max_sim,
                "grounded": max_sim >= threshold,
                "best_evidence": evidence_docs[best_evidence_idx]
            })

        return results
```

## Grounding Techniques

### Retrieval-Augmented Generation (RAG) for Grounding

RAG is the most widely deployed hallucination mitigation technique. By providing the model with retrieved documents as context, responses can be grounded in verifiable sources. The key design choices for hallucination reduction include chunk size and overlap (smaller chunks provide more precise grounding but less context; typical values are 256-512 tokens with 10-20% overlap), retrieval depth (more retrieved documents provide broader coverage but increase the chance of contradictory information), and prompt design that instructs the model to cite sources and stay within provided evidence:

```python
RAG_SYSTEM_PROMPT = """Answer the user's question based ONLY on the provided context.
If the context does not contain sufficient information to answer the question,
say "I don't have enough information to answer that question."

For each claim you make, cite the relevant source using [Source N] notation.

Context:
{retrieved_documents}
"""
```

### Citation Generation

Forcing the model to generate inline citations creates accountability and enables verification:

```python
class CitationGroundedGenerator:
    def __init__(self, llm, retriever):
        self.llm = llm
        self.retriever = retriever

    def generate_with_citations(self, query: str) -> dict:
        # Retrieve and number documents
        docs = self.retriever.retrieve(query, top_k=5)
        numbered_context = "\n\n".join(
            f"[Source {i+1}]: {doc.text}" for i, doc in enumerate(docs)
        )

        response = self.llm.generate(
            system=f"""Answer using ONLY the provided sources.
            Cite sources inline as [Source N].
            {numbered_context}""",
            user=query
        )

        # Verify citations exist and are valid
        cited_sources = re.findall(r'\[Source (\d+)\]', response)
        valid_citations = all(
            1 <= int(n) <= len(docs) for n in cited_sources
        )

        return {
            "response": response,
            "sources": docs,
            "citations_valid": valid_citations,
            "num_citations": len(cited_sources)
        }
```

Gao et al. (2023) in "ALCE: Enabling Attributed Language Models" showed that attribution quality improves significantly when models are explicitly instructed to cite, and that citation accuracy can be automatically evaluated.

### Confidence Calibration

Well-calibrated models assign probabilities that reflect actual accuracy. If a model says it is 80% confident, it should be correct 80% of the time. In practice, LLMs are poorly calibrated -- they tend to be overconfident.

Calibration techniques include temperature scaling (a post-hoc calibration method that adjusts the softmax temperature to improve calibration), verbalized confidence (asking the model to express its confidence explicitly, which can then be calibrated against actual accuracy), and ensemble disagreement (using disagreement across multiple models or samples as a confidence signal):

```python
def calibrated_generation(model, prompt: str, n_samples: int = 10) -> dict:
    """Generate calibrated response using sampling-based confidence."""
    responses = [
        model.generate(prompt, temperature=0.7) for _ in range(n_samples)
    ]

    # Cluster similar responses
    clusters = cluster_responses(responses)

    # Confidence is proportion of samples in the largest cluster
    largest_cluster = max(clusters, key=len)
    confidence = len(largest_cluster) / n_samples

    return {
        "response": largest_cluster[0],  # Representative response
        "confidence": confidence,
        "num_unique_responses": len(clusters),
        "all_responses": responses
    }
```

### Teaching "I Don't Know"

One of the most effective hallucination mitigation strategies is training models to decline answering when they lack sufficient knowledge. This requires overcoming the helpfulness incentive from RLHF that penalizes non-answers.

Approaches include explicit training data with "I don't know" examples for unanswerable questions, reward model training that positively rewards honest uncertainty over confident fabrication, and prompt engineering with explicit instructions to decline when uncertain:

```python
UNCERTAINTY_AWARE_PROMPT = """You are a helpful assistant that values accuracy
above all else.

CRITICAL RULES:
1. If you are not confident in your answer, say "I'm not sure about this,
   but here's what I think: [answer with caveats]"
2. If the question requires information you don't have, say "I don't have
   reliable information about [topic]. I'd recommend checking [source type]."
3. Never fabricate specific numbers, dates, names, or citations.
4. Clearly distinguish between facts and your reasoning/speculation.
"""
```

## FActScore: Atomic Fact Evaluation

Min et al. (2023) introduced FActScore (Fine-grained Atomic evaluation of Factual Precision) in "FActScore: Fine-grained Atomic Evaluation of Factual Precision in Long Form Text Generation." FActScore decomposes generated text into atomic facts and verifies each one independently, providing a granular hallucination metric.

### The FActScore Pipeline

```python
class FActScoreEvaluator:
    def __init__(self, knowledge_source, nli_model):
        self.knowledge_source = knowledge_source
        self.nli_model = nli_model

    def evaluate(self, generated_text: str, topic: str) -> dict:
        # Step 1: Decompose into atomic facts
        atomic_facts = self.decompose_to_atomic_facts(generated_text)

        # Step 2: Retrieve evidence for each fact
        # Step 3: Verify each fact against evidence
        verified_facts = []
        for fact in atomic_facts:
            evidence = self.knowledge_source.retrieve(
                query=f"{topic}: {fact}", top_k=5
            )
            is_supported = self.verify_fact(fact, evidence)
            verified_facts.append({
                "fact": fact,
                "supported": is_supported,
                "evidence": evidence
            })

        # Step 4: Compute FActScore
        supported_count = sum(1 for f in verified_facts if f["supported"])
        factscore = supported_count / len(verified_facts) if verified_facts else 0

        return {
            "factscore": factscore,
            "total_facts": len(verified_facts),
            "supported_facts": supported_count,
            "details": verified_facts
        }

    def decompose_to_atomic_facts(self, text: str) -> list[str]:
        """Use LLM to decompose text into atomic, verifiable facts."""
        prompt = f"""Break the following text into individual atomic facts.
Each fact should be a single, verifiable claim.

Text: {text}

Atomic facts (one per line):"""
        response = self.llm.generate(prompt)
        return [line.strip() for line in response.strip().split("\n") if line.strip()]

    def verify_fact(self, fact: str, evidence: list[str]) -> bool:
        """Check if any evidence supports the fact."""
        for doc in evidence:
            result = self.nli_model(f"{doc}</s></s>{fact}")
            if result[0]["label"] == "entailment" and result[0]["score"] > 0.7:
                return True
        return False
```

FActScore provides several advantages over holistic evaluation. It is interpretable -- you can see exactly which facts are hallucinated. It is granular -- a response with 90% supported facts is clearly better than one with 50%, whereas holistic ratings might judge both as "partially hallucinated." And it is automatable -- the entire pipeline runs without human judgment, enabling large-scale evaluation.

### Limitations of FActScore

FActScore has known limitations. The decomposition step itself can introduce errors -- the LLM might decompose text incorrectly or miss implicit claims. The knowledge source may not contain relevant evidence, leading to false negatives (supported facts marked as unsupported). And the NLI verification step has its own error rate. Despite these limitations, FActScore remains the best-available automated metric for factual precision.

## Search-Augmented Verification

Retrieval-augmented generation grounds responses in a fixed corpus, but many claims require verification against the live web. Search-augmented verification uses search APIs -- Google, Bing, Brave Search -- to fact-check model outputs in real time, either during generation or as a post-generation audit step.

### The Perplexity Pattern

Perplexity AI popularized a generation pattern that interleaves search retrieval with response synthesis. Rather than retrieving once and generating, the system issues multiple targeted search queries as it constructs an answer, refining its evidence base iteratively. The pattern works roughly as follows: decompose the user's question into sub-questions, issue search queries for each, synthesize a response grounded in search results, and annotate each claim with its source URL. This produces responses with inline citations pointing to live web pages, enabling users to verify claims directly. The pattern has since been adopted by Google's AI Overviews, Microsoft Copilot, and several open-source projects.

The engineering challenge lies in latency -- each search query adds network round-trip time. Production implementations typically issue queries in parallel, cache results aggressively, and use streaming to present partial answers while searches complete.

### SAFE: Search-Augmented Factuality Evaluator

Wei et al. (2024) from Google DeepMind introduced SAFE (Search Augmented Factuality Evaluator), a method that uses an LLM as an agent to fact-check long-form responses. SAFE operates in three stages. First, it decomposes a response into individual atomic facts, similar to FActScore. Second, for each atomic fact, the agent iteratively generates Google Search queries, reasoning about the search results to determine whether the fact is supported, unsupported, or irrelevant. Third, it aggregates per-fact verdicts into an overall factuality score.

```python
class SearchAugmentedVerifier:
    def __init__(self, llm, search_client):
        self.llm = llm
        self.search = search_client

    def verify_claim(self, claim: str, max_searches: int = 3) -> dict:
        """Iteratively search and reason about a single claim."""
        search_history = []
        for step in range(max_searches):
            # Generate a search query targeting the claim
            query = self.llm.generate(
                f"Generate a Google search query to verify: '{claim}'\n"
                f"Previous searches: {search_history}\n"
                f"Query:"
            )
            results = self.search.query(query.strip())
            search_history.append({"query": query, "results": results})

            # Ask LLM to reason about whether evidence is sufficient
            verdict = self.llm.generate(
                f"Claim: '{claim}'\n"
                f"Search results: {results}\n"
                f"Is this claim supported, unsupported, or do you need "
                f"more evidence? Respond: SUPPORTED / UNSUPPORTED / CONTINUE"
            )

            if "SUPPORTED" in verdict:
                return {"claim": claim, "verdict": "supported",
                        "evidence": search_history}
            elif "UNSUPPORTED" in verdict:
                return {"claim": claim, "verdict": "unsupported",
                        "evidence": search_history}

        return {"claim": claim, "verdict": "inconclusive",
                "evidence": search_history}
```

SAFE's key finding was that LLM-as-agent fact-checking achieves human-level accuracy on factuality benchmarks while costing roughly 20x less than human annotation. On a dataset of approximately 16,000 atomic facts, SAFE agreed with human raters 72% of the time, and in cases of disagreement, a panel of human raters preferred SAFE's judgment 76% of the time. This suggests that for many factual claims, search-augmented automated verification is not just cheaper but arguably more reliable than individual human judgment.

## Hallucination in Code and Structured Data

Hallucination is not limited to natural language prose. Code generation models hallucinate in distinctive ways that carry unique risks -- a fabricated API call compiles but fails at runtime, a non-existent package name opens the door to dependency confusion attacks.

### Package Hallucination

When a model suggests importing a package that does not exist in a package registry (npm, PyPI, crates.io), this is package hallucination. Lanyado et al. (2023) demonstrated that attackers can exploit this by registering the hallucinated package names and populating them with malicious code -- a supply chain attack vector unique to AI-assisted development. In their study, models like GPT-4 and CodeLlama hallucinated package names at rates between 5% and 20% depending on the programming language and prompt specificity.

Detection strategies include registry validation (checking whether every imported package actually exists in the relevant registry before presenting suggestions to users), version pinning verification (confirming that the suggested version of a real package actually exists), and namespace analysis (flagging packages with names suspiciously similar to popular packages but with slight misspellings).

### API Hallucination

Models frequently generate calls to API methods that do not exist, use incorrect parameter signatures, or reference deprecated interfaces. A model might generate `response.json(strict=True)` for a library that has no `strict` parameter, or call `torch.compile()` with arguments from a different version's signature. This is especially prevalent when models blend knowledge across library versions or confuse similarly named methods from different frameworks.

Practical mitigation involves providing the model with current API documentation through retrieval (see [Article 17: Advanced RAG](/advanced-rag) for retrieval strategies), using type-checking and static analysis as post-generation validation, and maintaining curated context about the specific library versions in use. Code-focused AI systems increasingly integrate with language servers and type checkers to catch these errors before they reach the user (see [Article 51: AI for Code](/ai-for-code) for deeper treatment of code generation reliability).

### Schema Fabrication

In data-oriented tasks, models may fabricate database columns, JSON fields, or API response structures that do not exist. A model asked to write a SQL query might reference a column that seems plausible given the table name but is not in the actual schema. Similarly, when generating code to parse an API response, the model may invent nested fields based on what a typical API might return rather than what the specific API actually returns.

The most effective mitigation is schema injection -- providing the exact schema (DDL statements, OpenAPI specs, JSON Schema definitions) as context for every structured-data task. When the model has the ground-truth schema in its context window, fabrication rates drop substantially.

## Long-Context Hallucination

As context windows have expanded from 4K to 128K tokens and beyond, a new category of hallucination has emerged: failures that arise specifically because of context length.

### The Lost-in-the-Middle Phenomenon

Liu et al. (2023) in "Lost in the Middle: How Language Models Use Long Contexts" demonstrated that LLM performance on information retrieval tasks degrades significantly when relevant information is placed in the middle of a long context. Models attend most strongly to the beginning and end of their context window, creating a U-shaped performance curve. Information at positions 4-8 (out of 10 retrieved documents) was used least effectively, with accuracy dropping by as much as 20 percentage points compared to information placed first or last.

This has direct implications for hallucination. When a model fails to attend to relevant evidence buried in the middle of a long context, it falls back on parametric knowledge -- which may be outdated or incorrect -- or fabricates a plausible-sounding answer. The hallucination is not caused by absence of evidence but by the model's failure to locate evidence that is present.

### Mitigation Through Retrieval Ordering

Understanding the lost-in-the-middle effect leads to practical mitigations. Place the most relevant retrieved documents at the beginning and end of the context, not in the middle. Reduce the total number of retrieved documents rather than stuffing the context window -- five highly relevant chunks often outperform twenty marginally relevant ones. Use hierarchical summarization to compress long contexts into shorter, more attention-friendly representations. And consider recursive retrieval strategies that re-rank and re-retrieve as the model generates, keeping the working context focused (see [Article 17: Advanced RAG](/advanced-rag) for hierarchical and recursive retrieval patterns).

### Context Length and Faithfulness Degradation

Beyond the positional effect, overall hallucination rates tend to increase with context length even when relevant information is positioned optimally. As context grows, the model must distinguish signal from noise across a larger input space. Levy et al. (2024) found that models' ability to answer simple factual questions degraded as the total context length increased, even when the answer appeared in the same position. This suggests that for high-stakes applications, keeping context windows as concise as possible -- through aggressive retrieval filtering and summarization -- is preferable to maximizing context utilization. For a systematic approach to budgeting tokens, ordering information for attention, and managing the trade-offs between context volume and quality, see [Context Engineering](/context-engineering). Evaluation frameworks for RAG systems should measure faithfulness as a function of context size (see [Article 18: RAG Evaluation](/rag-evaluation) for metrics and evaluation methodology).

## Automated Fact-Checking at Scale

FActScore established the paradigm of atomic-fact verification, but production systems require evaluation models that are faster, cheaper, and tuned for specific deployment contexts. Several specialized models and benchmarks have emerged to fill this gap.

### FActScore-LLM and Self-Evaluation

The original FActScore pipeline relied on retrieval plus NLI to verify facts. Subsequent work showed that LLMs themselves can serve as fact-checkers. FActScore-LLM replaces the retrieval-and-NLI pipeline with a single LLM call that evaluates whether a given atomic fact is likely true, using the model's parametric knowledge. While this sacrifices the grounding benefit of retrieval, it dramatically reduces pipeline complexity and latency. In practice, strong models like GPT-4 achieve FActScore-LLM accuracy within a few points of retrieval-based FActScore on well-known entities, though accuracy degrades for obscure or recent topics where the model's training data is sparse.

A hybrid approach works best in production: use the LLM's self-evaluation as a fast first pass, then route low-confidence facts to retrieval-based verification or search-augmented checking.

### Vectara Hallucination Evaluation Model (HEM)

Vectara released HEM, an open model specifically fine-tuned to detect hallucination in LLM outputs given a source document. HEM is trained as a cross-encoder on (document, summary) pairs labeled for factual consistency. Unlike general-purpose NLI models, HEM is optimized specifically for the LLM hallucination detection use case, achieving strong performance on hallucination benchmarks including SummEval, FRANK, and AggreFact.

HEM's advantage in production is its focus: because it is a single-purpose model, it is smaller and faster than general NLI models while being more accurate on the specific task of detecting whether a generated passage is faithful to a source document. It slots directly into the multi-stage verification pipeline described earlier as a replacement or complement to the NLI checker.

### Hughes Hallucination Evaluation Model

The Hughes Hallucination Evaluation Model (HHEM), developed by Vectara and later contributed to the open-source community, extends hallucination detection to conversational and multi-turn settings. HHEM evaluates whether an LLM response is consistent with a provided context, assigning a hallucination probability score between 0 and 1. It has been widely adopted as a component in evaluation harnesses like RAGAS and DeepEval, where it provides a lightweight, model-based alternative to human judgment for faithfulness evaluation.

### Building a Production Evaluation Harness

A practical fact-checking system at scale combines multiple models, each contributing a different signal:

```python
class FactCheckingHarness:
    def __init__(self):
        self.hem_model = load_model("vectara/hallucination_evaluation_model")
        self.search_verifier = SearchAugmentedVerifier(llm, search_client)
        self.nli_model = load_nli_model("cross-encoder/nli-deberta-v3-large")

    def evaluate(
        self, response: str, context: str, claims: list[str]
    ) -> dict:
        # Fast pass: HEM on full response
        hem_score = self.hem_model.score(context, response)

        if hem_score > 0.9:
            return {"verdict": "faithful", "score": hem_score, "method": "hem"}

        # Medium pass: NLI on individual claims
        nli_results = [
            self.nli_model.check(context, claim) for claim in claims
        ]
        flagged = [c for c, r in zip(claims, nli_results) if not r.entailed]

        if not flagged:
            return {"verdict": "faithful", "score": hem_score,
                    "method": "hem+nli"}

        # Slow pass: search verification on flagged claims only
        search_results = [
            self.search_verifier.verify_claim(claim) for claim in flagged
        ]

        return {
            "verdict": "needs_review" if any(
                r["verdict"] == "unsupported" for r in search_results
            ) else "faithful",
            "score": hem_score,
            "flagged_claims": flagged,
            "search_verification": search_results,
            "method": "hem+nli+search"
        }
```

This tiered approach keeps costs low for straightforward cases (the HEM fast pass handles the majority of requests) while providing thorough verification for ambiguous or high-risk outputs.

## Production Verification Pipelines

### Multi-Stage Verification

A production hallucination detection pipeline should combine multiple signals:

```python
class HallucinationDetectionPipeline:
    def __init__(self):
        self.nli_checker = NLIGroundingChecker()
        self.semantic_checker = SemanticGroundingChecker()
        self.consistency_checker = SelfConsistencyChecker()

    async def verify(
        self, query: str, response: str, context: list[str]
    ) -> VerificationResult:
        # Run checks in parallel
        nli_result, semantic_result, consistency_result = await asyncio.gather(
            self.nli_checker.check(response, context),
            self.semantic_checker.check(response, context),
            self.consistency_checker.check(query, response, n_samples=3),
        )

        # Aggregate signals
        scores = {
            "nli_grounding": nli_result.score,
            "semantic_grounding": semantic_result.score,
            "self_consistency": consistency_result.score,
        }

        # Weighted combination
        weights = {"nli_grounding": 0.4, "semantic_grounding": 0.3,
                    "self_consistency": 0.3}
        overall_score = sum(
            scores[k] * weights[k] for k in scores
        )

        # Per-sentence breakdown
        flagged_sentences = self._identify_risky_sentences(
            nli_result, semantic_result
        )

        return VerificationResult(
            overall_score=overall_score,
            component_scores=scores,
            flagged_sentences=flagged_sentences,
            recommendation="pass" if overall_score > 0.7 else "review"
        )
```

### Human-in-the-Loop Verification

For high-stakes applications (medical, legal, financial), automated detection should be complemented with human review. The pipeline can route low-confidence responses to human reviewers:

```python
class HumanInTheLoopRouter:
    def __init__(self, confidence_threshold: float = 0.7):
        self.threshold = confidence_threshold

    def route(self, verification_result: VerificationResult) -> str:
        if verification_result.overall_score > self.threshold:
            return "auto_approve"
        elif verification_result.overall_score > 0.4:
            return "human_review"
        else:
            return "auto_reject"
```

## Hallucination in Vision-Language Models

Hallucination is not limited to text-only models. Vision-language models (VLMs) exhibit their own hallucination patterns, including describing objects that are not present in an image, misattributing spatial relationships, and fabricating text that appears in a scene. The CHAIR (Caption Hallucination Assessment with Image Relevance) metric and the POPE (Polling-based Object Probing Evaluation) benchmark provide standardized evaluation for visual hallucination. Mitigation strategies specific to VLMs -- including visual grounding, attention supervision, and contrastive decoding -- are covered in depth in [Article 49: Vision-Language Models](/vision-language-models).

## Key Takeaways

- **Hallucination is inherent** to probabilistic text generation, not a bug to be patched. Mitigation requires layered approaches.
- **The intrinsic/extrinsic taxonomy** distinguishes between outputs that contradict the source (intrinsic) and outputs that add unverifiable information (extrinsic). Both require different detection strategies.
- **Self-consistency checking** leverages the insight that confident knowledge produces consistent outputs across samples; inconsistency signals potential hallucination.
- **NLI-based entailment checking** provides precise, sentence-level hallucination detection for closed-domain tasks where source documents are available.
- **RAG with citations** is the most practical grounding technique for production systems, combining retrieval-based evidence with explicit source attribution.
- **Confidence calibration** and teaching models to say "I don't know" are underrated strategies that address the root cause of helpfulness-driven hallucination.
- **FActScore** provides a rigorous, automated metric for factual precision by decomposing text into atomic facts and verifying each independently.
- **Search-augmented verification** using live web search (the Perplexity pattern, SAFE) provides real-time fact-checking that goes beyond static knowledge bases.
- **Code hallucination** -- fabricated packages, non-existent APIs, invented schemas -- requires domain-specific detection strategies including registry validation and schema injection.
- **Long-context hallucination** worsens with context length; the lost-in-the-middle effect means retrieval ordering and context conciseness are critical design decisions.
- **Specialized evaluation models** (HEM, HHEM, FActScore-LLM) enable tiered verification pipelines that balance cost, latency, and thoroughness.
- **Production pipelines** should combine multiple detection signals (NLI, semantic similarity, self-consistency, search verification) and include human-in-the-loop review for high-stakes applications.
