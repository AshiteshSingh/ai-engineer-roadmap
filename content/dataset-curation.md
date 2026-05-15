# Dataset Curation: Synthetic Data, Quality Filtering & Annotation

The quality of training data is the single most consequential factor in fine-tuning success, yet dataset curation remains the least glamorous and most underinvested part of the AI engineering pipeline. This article examines the full lifecycle of instruction dataset creation, from synthetic data generation via Self-Instruct and Evol-Instruct to quality filtering heuristics, human annotation workflows, decontamination procedures, and the practical tooling (Argilla, Label Studio) that ties it all together. Whether you are building a domain-specific assistant or aligning a general-purpose model, the techniques covered here directly determine whether your fine-tuned model will be useful or merely trained.

## The Data Bottleneck

The LIMA paper (Zhou et al., 2023) demonstrated that 1,000 carefully curated instruction-response pairs could produce a model competitive with those trained on 52,000 examples (Alpaca) or 70,000+ examples (various open-source instruction sets). This finding crystallized a principle that experienced practitioners already knew: data quality dominates data quantity, often by an order of magnitude.

However, "quality" is multidimensional:

- **Correctness**: Responses must be factually accurate and logically sound
- **Completeness**: Responses should fully address the instruction
- **Diversity**: The dataset should cover the full distribution of expected tasks
- **Consistency**: Formatting, tone, and level of detail should be uniform
- **Difficulty calibration**: The mix of easy and hard examples should match target use cases
- **Decontamination**: Training data must not overlap with evaluation benchmarks

Building datasets that satisfy all these criteria requires systematic processes, not ad-hoc data collection.

## Instruction Dataset Formats

Two dominant formats have emerged for instruction fine-tuning:

### Alpaca Format

Introduced by the Stanford Alpaca project, this format uses three fields:

```json
{
    "instruction": "Explain the concept of gravitational lensing.",
    "input": "",
    "output": "Gravitational lensing occurs when a massive object..."
}
```

The optional `input` field provides additional context. This format is simple but limited to single-turn interactions.

### ShareGPT / Conversation Format

Used for multi-turn training data, this format represents full conversations:

```json
{
    "conversations": [
        {"from": "human", "value": "What is gravitational lensing?"},
        {"from": "gpt", "value": "Gravitational lensing is a phenomenon..."},
        {"from": "human", "value": "How was it first observed?"},
        {"from": "gpt", "value": "The first observation of gravitational lensing..."}
    ]
}
```

Most modern fine-tuning frameworks (Axolotl, LLaMA-Factory, TRL) support both formats and can convert between them. The conversation format is generally preferred because it teaches the model to handle multi-turn interactions naturally.

### Chat Template Application

Training data must be formatted using the model's chat template, which defines how system prompts, user messages, and assistant responses are tokenized:

```python
from transformers import AutoTokenizer

tokenizer = AutoTokenizer.from_pretrained("meta-llama/Llama-3-8B-Instruct")

messages = [
    {"role": "system", "content": "You are a helpful assistant."},
    {"role": "user", "content": "What is gravitational lensing?"},
    {"role": "assistant", "content": "Gravitational lensing occurs when..."}
]

formatted = tokenizer.apply_chat_template(
    messages,
    tokenize=False,
    add_generation_prompt=False
)
```

Getting the chat template wrong is a common source of degraded fine-tuning performance. The model learns spurious patterns from incorrect formatting rather than the intended instruction-following behavior.

## Synthetic Data Generation

### Self-Instruct

Wang et al. (2023) introduced Self-Instruct, a method for generating instruction datasets using a language model itself. The process:

1. Start with a seed set of 175 manually written instructions
2. Prompt the model to generate new instructions inspired by (but different from) random samples of existing instructions
3. For each generated instruction, prompt the model to identify whether it needs an input field and to produce the input if so
4. Prompt the model to generate the output (response)
5. Filter generated examples for quality

```python
SELF_INSTRUCT_PROMPT = """Come up with a series of tasks and their solutions.
Here are some examples:

Task: {seed_example_1}
Solution: {solution_1}

Task: {seed_example_2}
Solution: {solution_2}

Task: {seed_example_3}
Solution: {solution_3}

Now generate a new, different task and its solution:

Task:"""

def self_instruct_generate(seed_examples, generator_model, n_samples=1000):
    generated = []
    pool = seed_examples.copy()

    for _ in range(n_samples):
        # Sample 3 random examples from the pool
        samples = random.sample(pool, min(3, len(pool)))
        prompt = format_prompt(samples)

        # Generate new instruction + response
        output = generator_model.generate(prompt, temperature=0.7, max_tokens=1024)
        instruction, response = parse_output(output)

        # Basic quality filtering
        if len(instruction.split()) < 3 or len(response.split()) < 10:
            continue
        if any(is_too_similar(instruction, ex['instruction']) for ex in pool):
            continue

        new_example = {"instruction": instruction, "output": response}
        generated.append(new_example)
        pool.append(new_example)

    return generated
```

Self-Instruct's limitation is that the generated data quality is bounded by the generating model's capabilities. If the model cannot solve a task correctly, it produces incorrect training data.

### Evol-Instruct

WizardLM (Xu et al., 2023) introduced Evol-Instruct, which iteratively evolves simple instructions into more complex ones through a series of evolution strategies:

**Depth evolution** (increasing complexity):
- Add constraints ("...in under 100 words, using only simple language")
- Increase reasoning depth ("...and explain why each step is necessary")
- Concretize abstract instructions with specific scenarios
- Replace general concepts with domain-specific terminology

**Breadth evolution** (increasing diversity):
- Generate entirely new instructions inspired by existing ones
- Mutate topic domains while preserving task structure
- Vary response formats (lists, essays, code, tables)

```python
EVOLUTION_STRATEGIES = {
    "add_constraints": "Rewrite the following instruction by adding 1-2 "
        "specific constraints that make it more challenging:\n{instruction}",
    "deepen_reasoning": "Rewrite the following instruction to require "
        "multi-step reasoning:\n{instruction}",
    "concretize": "Make the following instruction more concrete and "
        "specific with a real-world scenario:\n{instruction}",
    "increase_complexity": "Add one more requirement to the following "
        "instruction to make it harder:\n{instruction}",
}

def evol_instruct(seed_instructions, evolver_model, generations=4):
    current = seed_instructions.copy()

    for gen in range(generations):
        evolved = []
        for instruction in current:
            strategy = random.choice(list(EVOLUTION_STRATEGIES.keys()))
            prompt = EVOLUTION_STRATEGIES[strategy].format(instruction=instruction)
            new_instruction = evolver_model.generate(prompt)

            # Verify the evolved instruction is actually harder
            if complexity_score(new_instruction) > complexity_score(instruction):
                evolved.append(new_instruction)

        current = evolved

    # Generate responses for all evolved instructions
    return generate_responses(current, evolver_model)
```

### Magpie: Alignment Data from Scratch

Xu et al. (2024) introduced Magpie, a clever technique for generating instruction data by exploiting how instruction-tuned models behave when given only a system prompt without a user message. By providing just the chat template prefix (system prompt + user turn marker), the model "hallucinates" a plausible user instruction, which can then be completed with a response.

This approach generates highly naturalistic instructions that reflect how users actually interact with chat models, unlike the somewhat artificial prompts produced by Self-Instruct.

## Quality Filtering

Raw synthetic data is noisy. Quality filtering is essential to extract the signal:

### Heuristic Filters

```python
def apply_quality_filters(examples):
    filtered = []
    for ex in examples:
        instruction = ex.get("instruction", "")
        response = ex.get("output", "")

        # Length filters
        if len(response.split()) < 15:
            continue  # Too short to be useful
        if len(response.split()) > 2000:
            continue  # Suspiciously long, likely degenerate

        # Repetition filter
        if has_excessive_repetition(response, threshold=3):
            continue

        # Language quality
        if response.count("I'm sorry") > 0 and len(response.split()) < 50:
            continue  # Refusal without substance

        # Instruction-response alignment
        if starts_with_instruction_echo(response, instruction):
            continue  # Response just repeats the instruction

        # Format consistency
        if response.startswith("Sure!") or response.startswith("Of course!"):
            response = remove_sycophantic_prefix(response)
            ex["output"] = response

        filtered.append(ex)

    return filtered

def has_excessive_repetition(text, threshold=3):
    """Detect degenerate repetitive outputs."""
    sentences = text.split(". ")
    if len(sentences) < 4:
        return False
    # Check for repeated n-grams
    trigrams = [tuple(sentences[i:i+3]) for i in range(len(sentences)-2)]
    return max(Counter(trigrams).values()) >= threshold
```

### Model-Based Quality Scoring

Use a strong language model to score data quality:

```python
QUALITY_SCORING_PROMPT = """Rate the quality of this instruction-response pair
on a scale of 1-5:

Instruction: {instruction}
Response: {response}

Criteria:
- Accuracy: Is the response factually correct?
- Completeness: Does it fully address the instruction?
- Clarity: Is it well-written and easy to understand?
- Helpfulness: Would a user find this response useful?

Provide a single score (1-5) and a brief justification.
Score:"""

def score_examples(examples, scorer_model, threshold=4):
    """Filter examples using a model-based quality scorer."""
    high_quality = []
    for ex in examples:
        prompt = QUALITY_SCORING_PROMPT.format(
            instruction=ex["instruction"],
            response=ex["output"]
        )
        result = scorer_model.generate(prompt, max_tokens=100)
        score = extract_score(result)
        if score >= threshold:
            high_quality.append(ex)
    return high_quality
```

### Deduplication

Near-duplicate examples waste training budget and can cause overfitting to specific patterns:

```python
from datasketch import MinHash, MinHashLSH

def deduplicate_instructions(examples, threshold=0.7):
    """Remove near-duplicate instructions using MinHash LSH."""
    lsh = MinHashLSH(threshold=threshold, num_perm=128)
    unique = []

    for i, ex in enumerate(examples):
        # Create MinHash for the instruction
        mh = MinHash(num_perm=128)
        for word in ex["instruction"].lower().split():
            mh.update(word.encode('utf-8'))

        # Check if similar instruction already exists
        try:
            result = lsh.query(mh)
            if not result:
                lsh.insert(str(i), mh)
                unique.append(ex)
        except ValueError:
            lsh.insert(str(i), mh)
            unique.append(ex)

    return unique
```

## Data Decontamination

Training on data that overlaps with evaluation benchmarks inflates performance metrics and gives a misleading picture of model capabilities. Decontamination removes or flags such overlaps.

### N-gram Contamination Detection

```python
def detect_contamination(train_examples, benchmark_examples, n=13):
    """Detect n-gram overlaps between training data and benchmarks."""
    # Build n-gram index from benchmark
    benchmark_ngrams = set()
    for ex in benchmark_examples:
        text = ex["question"] + " " + ex.get("answer", "")
        words = text.lower().split()
        for i in range(len(words) - n + 1):
            benchmark_ngrams.add(tuple(words[i:i+n]))

    # Check each training example
    contaminated = []
    clean = []
    for ex in train_examples:
        text = ex["instruction"] + " " + ex["output"]
        words = text.lower().split()
        is_contaminated = False
        for i in range(len(words) - n + 1):
            if tuple(words[i:i+n]) in benchmark_ngrams:
                is_contaminated = True
                break
        if is_contaminated:
            contaminated.append(ex)
        else:
            clean.append(ex)

    print(f"Found {len(contaminated)} contaminated examples "
          f"({len(contaminated)/len(train_examples)*100:.1f}%)")
    return clean, contaminated
```

Standard benchmarks to check against include MMLU, HellaSwag, ARC, GSM8K, HumanEval, TruthfulQA, and WinoGrande. The GPT-4 technical report used 13-gram overlap detection as its primary decontamination method.

## Human Annotation Platforms

When synthetic data is insufficient, human annotation provides ground truth. Two open-source platforms dominate:

### Argilla

Argilla is purpose-built for AI data annotation, with native support for text classification, NER, preference ranking, and instruction-response evaluation:

```python
import argilla as rg

# Connect to Argilla server
rg.init(api_url="http://localhost:6900", api_key="your-api-key")

# Create a dataset for preference annotation
dataset = rg.FeedbackDataset(
    fields=[
        rg.TextField(name="instruction"),
        rg.TextField(name="response_a"),
        rg.TextField(name="response_b"),
    ],
    questions=[
        rg.RatingQuestion(
            name="preference",
            title="Which response is better?",
            values=[1, 2, 3, 4, 5],
            description="1=Response A much better, 5=Response B much better"
        ),
        rg.TextQuestion(
            name="justification",
            title="Why did you choose this preference?",
            required=False
        ),
    ],
    guidelines="Compare the two responses and rate which one better "
               "addresses the instruction. Consider accuracy, completeness, "
               "and clarity."
)

# Push to Argilla for annotation
dataset.push_to_argilla(name="preference-annotation")
```

Argilla's strengths include integration with Hugging Face datasets, built-in inter-annotator agreement metrics, and support for active learning workflows where the most uncertain examples are prioritized for annotation.

### Label Studio

Label Studio is a more general-purpose annotation platform that supports text, images, audio, and video:

```xml
<!-- Label Studio XML config for instruction quality rating -->
<View>
  <Header value="Rate this instruction-response pair"/>
  <Text name="instruction" value="$instruction"/>
  <Text name="response" value="$response"/>
  <Rating name="quality" toName="response" maxRating="5"/>
  <Choices name="issues" toName="response" choice="multiple">
    <Choice value="Factually incorrect"/>
    <Choice value="Incomplete"/>
    <Choice value="Poorly written"/>
    <Choice value="Off-topic"/>
    <Choice value="Harmful content"/>
  </Choices>
  <TextArea name="notes" toName="response" placeholder="Optional notes..."/>
</View>
```

Label Studio excels at flexible annotation configurations and supports complex workflows with review stages, annotator management, and webhook integrations.

## Building a Complete Data Pipeline

Putting it all together, a production data curation pipeline looks like this:

```python
class DataCurationPipeline:
    def __init__(self, generator_model, scorer_model, benchmarks):
        self.generator = generator_model
        self.scorer = scorer_model
        self.benchmarks = benchmarks

    def run(self, seed_data, target_size=10000):
        # Stage 1: Generate synthetic data
        print("Stage 1: Generating synthetic instructions...")
        synthetic = self.generate_synthetic(seed_data, n=target_size * 3)

        # Stage 2: Apply heuristic filters
        print("Stage 2: Applying heuristic filters...")
        filtered = apply_quality_filters(synthetic)

        # Stage 3: Deduplicate
        print("Stage 3: Deduplicating...")
        deduped = deduplicate_instructions(filtered)

        # Stage 4: Model-based quality scoring
        print("Stage 4: Scoring quality...")
        scored = score_examples(deduped, self.scorer, threshold=4)

        # Stage 5: Decontaminate
        print("Stage 5: Decontaminating against benchmarks...")
        clean, _ = detect_contamination(scored, self.benchmarks)

        # Stage 6: Balance categories
        print("Stage 6: Balancing...")
        balanced = self.balance_categories(clean, target_size)

        # Stage 7: Format for training
        print("Stage 7: Formatting...")
        formatted = self.format_for_training(balanced)

        print(f"Final dataset: {len(formatted)} examples")
        return formatted

    def balance_categories(self, examples, target_size):
        """Ensure diverse task coverage."""
        categorized = categorize_by_task(examples)  # coding, math, writing, etc.
        balanced = []
        per_category = target_size // len(categorized)

        for category, exs in categorized.items():
            if len(exs) >= per_category:
                balanced.extend(random.sample(exs, per_category))
            else:
                balanced.extend(exs)  # Take all if insufficient

        return balanced
```

## Domain-Specific Data Strategies

### Medical/Legal/Scientific Domains

For specialized domains:
1. Start with domain-specific seed instructions written by subject matter experts
2. Use Evol-Instruct to generate variations within the domain
3. Have domain experts review a sample for accuracy (this is non-negotiable for high-stakes domains)
4. Mix in 10-20% general-domain instructions to maintain broad capabilities

### Code Generation

Code datasets have unique requirements:
- Include the full context (imports, function signatures, docstrings)
- Test generated code for correctness using execution-based validation
- Cover diverse programming languages and frameworks
- Include both generation (write code from spec) and comprehension (explain code) tasks

### Multi-Language

For multilingual datasets:
- Do not simply translate English data. Different languages have different conversational norms and task distributions.
- Include language-specific tasks (transliteration, formality levels, script-specific challenges)
- Balance language representation according to target user demographics

## Open-Source Dataset Landscape

Before building your own data from scratch, it is worth understanding what already exists. The open-source instruction and preference dataset ecosystem has matured considerably since the original Alpaca release, and many high-quality datasets are freely available. However, each comes with specific provenance characteristics and limitations that determine whether it is appropriate for your use case.

**OpenHermes** (Teknium, 2023-2024) is a family of synthetic instruction datasets generated primarily from GPT-4 outputs across diverse task categories. OpenHermes 2.5 contains approximately 1 million examples covering code, math, role-play, function calling, and general knowledge. Its strength is breadth and relatively high response quality, but it inherits GPT-4's stylistic tendencies -- verbose responses, hedging language, and a characteristic "certainly" / "absolutely" discourse pattern that transfers to fine-tuned models.

**UltraChat** (Ding et al., 2023) contains approximately 1.5 million multi-turn conversations generated by GPT-3.5-Turbo across three categories: questions about the world, creative writing, and assistance with existing materials. The UltraChat 200k subset (curated by HuggingFace) applies quality filtering to produce a cleaner training set. Its primary limitation is that GPT-3.5 responses are noticeably weaker than GPT-4 on reasoning and nuanced tasks, and the multi-turn structure sometimes exhibits shallow follow-up turns that do not genuinely extend the conversation.

**SlimOrca** (Open-Orca project, 2023) is a deduplicated and filtered subset of the larger OpenOrca dataset, itself generated by prompting GPT-4 and GPT-3.5 with Flan Collection tasks. SlimOrca retains roughly 518,000 examples after aggressive deduplication. Its provenance from Flan Collection tasks gives it strong coverage of traditional NLP tasks (summarization, translation, classification) but less coverage of open-ended creative and conversational scenarios.

**LMSYS-Chat-1M** (Zheng et al., 2024) is qualitatively different from the above: it consists of one million real user conversations collected from the Chatbot Arena platform, where users interact with various models. This dataset captures genuine user behavior -- including typos, ambiguous instructions, adversarial prompts, and multi-language queries -- making it invaluable for understanding real-world usage patterns. However, the responses come from different models of varying quality, so using it directly for SFT requires careful response filtering or regeneration.

**WildChat** (Zhao et al., 2024) similarly captures real user-ChatGPT conversations (approximately 1 million), collected with user consent via a research platform. It includes metadata such as language, toxicity flags, and user demographics. WildChat reveals that real user prompts are substantially different from synthetically generated instructions: they are often shorter, more ambiguous, and more likely to involve sensitive topics. This makes WildChat useful for distribution analysis and prompt mining even if the responses themselves are not used directly for training.

**UltraFeedback** (Cui et al., 2024) is a preference dataset containing approximately 64,000 prompts, each paired with four model responses scored by GPT-4 across dimensions of instruction-following, truthfulness, honesty, and helpfulness. This dataset was instrumental in training the Zephyr and Notus models via DPO (see Article 21 for the preference optimization techniques that consume such data). Its limitation is that GPT-4's scoring introduces systematic biases -- it tends to prefer longer, more structured responses and may not reflect genuine human preferences on stylistic dimensions.

When selecting open-source datasets, three practical principles apply. First, mix datasets with different provenance to avoid inheriting a single generator model's biases. Second, always apply your own quality filtering pipeline rather than trusting upstream curation. Third, check licensing: datasets generated from OpenAI models carry terms-of-service restrictions on training competing models, which may or may not be enforceable but should be understood.

## Embedding-Based Diversity Selection

The `balance_categories` method in the pipeline above uses categorical balancing -- assigning examples to predefined task categories and sampling evenly. This is a reasonable start but misses subtler dimensions of diversity. Two examples might both be categorized as "coding" but cover identical Python list comprehension tasks, while leaving database query generation entirely unrepresented.

Embedding-based diversity selection provides a more principled approach. The core idea is to embed all candidate examples into a vector space (see Article 13 for a detailed treatment of embedding models and similarity), then select a subset that maximally covers that space. This ensures diversity along every dimension the embedding model captures, not just the dimensions you thought to define categories for.

```python
import numpy as np
from sentence_transformers import SentenceTransformer
from sklearn.cluster import KMeans

def select_diverse_subset(
    examples: list[dict],
    target_size: int,
    embedding_model: str = "BAAI/bge-large-en-v1.5"
) -> list[dict]:
    """Select a diverse subset using embedding clustering."""
    model = SentenceTransformer(embedding_model)

    # Embed all instructions
    instructions = [ex["instruction"] for ex in examples]
    embeddings = model.encode(instructions, show_progress_bar=True,
                              normalize_embeddings=True)

    # Cluster into target_size clusters
    n_clusters = target_size
    kmeans = KMeans(n_clusters=n_clusters, random_state=42, n_init=10)
    cluster_labels = kmeans.fit_predict(embeddings)

    # Select the example closest to each cluster centroid
    selected = []
    for cluster_id in range(n_clusters):
        cluster_mask = cluster_labels == cluster_id
        cluster_indices = np.where(cluster_mask)[0]
        cluster_embeddings = embeddings[cluster_indices]

        # Find the example nearest to the centroid
        centroid = kmeans.cluster_centers_[cluster_id]
        distances = np.linalg.norm(cluster_embeddings - centroid, axis=1)
        nearest_idx = cluster_indices[np.argmin(distances)]
        selected.append(examples[nearest_idx])

    return selected
```

A more sophisticated variant uses **facility location** maximization, which selects examples that maximize the sum of similarities from every unselected point to its nearest selected point. This is a submodular optimization problem with a greedy algorithm that provides a (1 - 1/e) approximation guarantee:

```python
def facility_location_selection(
    embeddings: np.ndarray,
    target_size: int
) -> list[int]:
    """Greedy facility location for diversity selection."""
    n = len(embeddings)
    # Precompute pairwise similarity matrix
    similarity = embeddings @ embeddings.T

    selected = []
    # Track max similarity from each point to any selected point
    max_sim_to_selected = np.full(n, -np.inf)

    for _ in range(target_size):
        # For each candidate, compute marginal gain
        gains = np.zeros(n)
        for candidate in range(n):
            if candidate in selected:
                gains[candidate] = -np.inf
                continue
            # Marginal gain: sum of improvements in nearest-selected similarity
            new_sims = similarity[:, candidate]
            improvements = np.maximum(new_sims - max_sim_to_selected, 0)
            gains[candidate] = improvements.sum()

        best = np.argmax(gains)
        selected.append(best)
        max_sim_to_selected = np.maximum(
            max_sim_to_selected, similarity[:, best]
        )

    return selected
```

In practice, the clustering approach works well for datasets under 500,000 examples. For larger datasets, compute the embeddings in batches, apply an initial random down-sample to a manageable size (10-20x your target), then run diversity selection on that subset. The embedding computation is the bottleneck, not the selection algorithm.

## Preference Data Construction

Instruction data teaches a model *what* to say. Preference data teaches it *which* of several possible responses is better -- a fundamentally different signal that drives alignment techniques like DPO, ORPO, and PPO (see Article 21 for the optimization methods that consume preference pairs). Constructing high-quality preference pairs requires deliberate methodology because the pairing itself encodes the signal.

### Rejection Sampling

Rejection sampling is the simplest preference construction method. Generate multiple candidate responses for each prompt, score them using a reward model or quality rubric, then pair the highest-scoring response (chosen) with a lower-scoring one (rejected):

```python
def build_preference_pairs_rejection(
    prompts: list[str],
    generator_model,
    scorer_model,
    n_candidates: int = 8
) -> list[dict]:
    """Build preference pairs via rejection sampling."""
    pairs = []
    for prompt in prompts:
        # Generate multiple candidates
        candidates = [
            generator_model.generate(prompt, temperature=0.9)
            for _ in range(n_candidates)
        ]

        # Score each candidate
        scored = []
        for response in candidates:
            score = scorer_model.score(prompt, response)
            scored.append((response, score))

        scored.sort(key=lambda x: x[1], reverse=True)

        # Pair the best with the worst (or a median candidate)
        if scored[0][1] - scored[-1][1] > 0.5:  # Ensure meaningful gap
            pairs.append({
                "prompt": prompt,
                "chosen": scored[0][0],
                "rejected": scored[-1][0]
            })

    return pairs
```

The temperature parameter matters: too low and all candidates are nearly identical (no preference signal), too high and rejected candidates are incoherently bad (the model learns nothing useful from trivially bad examples). A temperature range of 0.7-1.0 typically produces useful variance.

### Best-of-N Sampling

Best-of-N is a refinement where you select the single best response from N candidates as the chosen response, using the current policy's own generations. This creates preference pairs that reflect the model's actual capability frontier -- the chosen response represents what the model *can* do at its best, while the rejected response represents its typical or below-average output. This distinction matters because preference learning is most effective when both responses are within the model's capability range.

### On-Policy Generation

The most effective preference pairs use **on-policy data** -- responses generated by the model currently being trained, not by a different or stronger model. Off-policy data (e.g., pairs constructed from GPT-4 vs. GPT-3.5 outputs) teaches the model to distinguish quality levels it may not be able to produce itself, which limits learning signal.

Iterative DPO exploits this insight: after each round of DPO training, generate new responses from the updated model, construct fresh preference pairs, and train again. Each iteration's preference data is on-policy for that iteration's model:

```python
def iterative_preference_construction(
    prompts: list[str],
    model,
    judge_model,
    n_iterations: int = 3
):
    """Build preference data iteratively with on-policy generations."""
    for iteration in range(n_iterations):
        # Generate pairs of responses from current model
        pairs = []
        for prompt in prompts:
            response_a = model.generate(prompt, temperature=0.8)
            response_b = model.generate(prompt, temperature=0.8)

            # Use judge model to determine preference
            preference = judge_model.judge(prompt, response_a, response_b)

            pairs.append({
                "prompt": prompt,
                "chosen": response_a if preference == "A" else response_b,
                "rejected": response_b if preference == "A" else response_a
            })

        # Train DPO on this iteration's pairs
        model = train_dpo(model, pairs)

    return model
```

A common mistake is pairing a strong chosen response with a catastrophically bad rejected response. The model learns very little from such pairs because the distinction is obvious. The most informative preference pairs involve responses that are close in quality but differ on specific dimensions -- one is slightly more accurate, better structured, or more concise. This forces the model to learn fine-grained quality distinctions.

For a rigorous treatment of how human annotators should evaluate and label preference pairs, see Article 34 on annotation design and inter-rater reliability.

## Persona-Driven Data Generation

Self-Instruct and Evol-Instruct tend to converge on a narrow distribution of instruction types because the generating model defaults to its most probable outputs. Even with temperature sampling, a model prompted to "generate a new task" will repeatedly produce variations on common themes -- text summarization, translation, sentiment analysis -- while neglecting the long tail of tasks that real users actually need.

Persona-driven generation addresses this by conditioning instruction generation on diverse synthetic personas, each representing a different type of user with distinct expertise, goals, and communication styles. Rather than asking "generate a task," you ask "what question would a forensic accountant ask?" or "what task would a high school biology teacher need help with?"

```python
PERSONA_EXAMPLES = [
    "A marine biologist studying coral reef ecosystems in Southeast Asia",
    "A first-generation college student writing graduate school applications",
    "A small business owner managing inventory for a bakery",
    "A retired civil engineer reviewing building safety codes",
    "A data journalist investigating campaign finance records",
    "A non-native English speaker preparing for a job interview in Canada",
    "A game designer prototyping a turn-based strategy mechanic",
    "A hospice nurse explaining treatment options to a patient's family",
]

def persona_driven_generation(
    personas: list[str],
    generator_model,
    instructions_per_persona: int = 10
) -> list[dict]:
    """Generate diverse instructions conditioned on personas."""
    all_examples = []

    for persona in personas:
        prompt = f"""You are generating training data for an AI assistant.
Consider this user persona: {persona}

Generate {instructions_per_persona} realistic questions or tasks that this
person might ask an AI assistant. The tasks should reflect their specific
expertise, needs, and communication style. Include a mix of simple and
complex requests.

Format each as:
Task: [the instruction]
---"""
        output = generator_model.generate(prompt, temperature=0.8,
                                          max_tokens=2048)
        instructions = parse_tasks(output)

        for instruction in instructions:
            response = generator_model.generate(
                f"Respond helpfully to: {instruction}",
                temperature=0.4
            )
            all_examples.append({
                "instruction": instruction,
                "output": response,
                "metadata": {"persona": persona}
            })

    return all_examples
```

The key insight from post-Magpie research is that persona diversity translates directly into instruction diversity. A dataset generated from 1,000 diverse personas covers far more of the real user distribution than one generated from generic prompting, even at the same total size. The personas themselves can be generated systematically by sampling across dimensions: profession, education level, geographic region, age group, native language, and specific domain of interest.

Scaling this approach requires generating the personas themselves programmatically. One effective method is to prompt a strong model to produce persona descriptions along structured axes, then use combinatorial expansion:

```python
def generate_persona_grid(generator_model, n_personas: int = 500) -> list[str]:
    """Generate diverse personas across structured dimensions."""
    dimensions = {
        "profession": "Generate 50 diverse professions spanning blue-collar, "
                      "white-collar, creative, technical, and service roles.",
        "expertise_level": ["novice", "intermediate", "expert"],
        "context": "Generate 30 specific situations where someone would "
                   "consult an AI assistant (at work, studying, personal "
                   "project, emergency, etc.)",
    }

    professions = parse_list(generator_model.generate(dimensions["profession"]))
    contexts = parse_list(generator_model.generate(dimensions["context"]))

    personas = []
    for _ in range(n_personas):
        prof = random.choice(professions)
        level = random.choice(dimensions["expertise_level"])
        ctx = random.choice(contexts)
        persona = f"A {level}-level {prof} who is {ctx}"
        personas.append(persona)

    return personas
```

This combinatorial approach can generate thousands of unique personas, each producing a distinct cluster of instructions. When combined with embedding-based diversity selection (described above), the two techniques complement each other: persona-driven generation produces a broad initial pool, and embedding-based selection ensures the final dataset maximally covers the space without redundancy.

## Evaluating Your Curated Dataset

Before committing a curated dataset to an expensive training run, evaluate the dataset itself. Beyond the per-example quality metrics discussed earlier, assess the dataset as a whole:

- **Coverage analysis**: Embed all instructions and visualize the distribution (UMAP or t-SNE). Gaps in the embedding space correspond to task categories your dataset does not cover. Compare against the embedding distribution of real user queries if available (datasets like LMSYS-Chat-1M or WildChat provide this reference distribution).
- **Difficulty distribution**: Score instruction difficulty (e.g., by measuring response length or using a complexity classifier) and verify the distribution matches your target. A dataset skewed entirely toward simple tasks will not teach the model to handle hard ones.
- **Benchmark overlap**: Run decontamination against all benchmarks you plan to evaluate on (see Article 32 for a thorough treatment of contamination detection and benchmark design).

## Summary and Key Takeaways

- **Data quality dominates quantity**: 1,000 excellent examples outperform 50,000 mediocre ones (LIMA). Invest time in curation, not just generation.
- **Self-Instruct and Evol-Instruct** are the foundational synthetic data generation methods. Self-Instruct bootstraps from seed examples; Evol-Instruct systematically increases complexity.
- **Multi-stage quality filtering** is essential: heuristic filters catch obvious issues, model-based scoring identifies subtle quality problems, and deduplication prevents overfitting.
- **Decontamination** against evaluation benchmarks is a professional obligation. Use 13-gram overlap detection at minimum (see Article 32 for benchmark design and contamination methodology).
- **Two dataset formats dominate**: Alpaca (single-turn) and ShareGPT/conversation (multi-turn). Most modern training frameworks support both.
- **Annotation platforms** (Argilla, Label Studio) provide structured workflows for human review. Argilla is more AI-native; Label Studio is more flexible. See Article 34 for annotation protocol design and inter-rater reliability methodology.
- **Domain-specific datasets** require subject matter expert involvement. No amount of synthetic generation compensates for domain-incorrect training data.
- **Open-source datasets** (OpenHermes, UltraChat, SlimOrca, LMSYS-Chat-1M, WildChat, UltraFeedback) provide strong starting points, but each carries provenance biases. Mix sources and apply your own filtering.
- **Embedding-based diversity selection** (clustering, facility location) produces more uniformly diverse datasets than categorical balancing. Use embeddings to audit coverage gaps before training (see Article 13 for embedding model fundamentals).
- **Preference data construction** differs fundamentally from instruction data. Rejection sampling, best-of-N, and on-policy generation each produce preference pairs with different learning dynamics. On-policy iterative construction yields the strongest alignment signal (see Article 21 for the optimization methods that consume this data).
- **Persona-driven generation** breaks the diversity ceiling of generic synthetic data by conditioning instruction generation on hundreds or thousands of diverse user personas.
- The complete pipeline is: **generate -> filter -> deduplicate -> score -> decontaminate -> diversify -> format**. Automating this pipeline with reproducible scripts is one of the highest-leverage investments in any fine-tuning project.
