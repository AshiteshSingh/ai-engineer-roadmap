# Few-Shot & Chain-of-Thought Prompting

In-context learning -- the ability of large language models to perform tasks from a handful of examples without parameter updates -- remains one of the most striking and theoretically puzzling capabilities of modern AI systems. This article traces the development from basic few-shot prompting through chain-of-thought reasoning to advanced techniques like self-consistency and tree-of-thought, grounding each in the research that introduced it. We examine not just how these techniques work but why they work, drawing on emerging theoretical understanding to guide practical application.

## In-Context Learning: The Foundation

When Brown et al. (2020) demonstrated in "Language Models are Few-Shot Learners" that GPT-3 could perform new tasks simply by prepending a few examples to the input, it challenged prevailing assumptions about how neural networks learn. Traditional machine learning requires updating model parameters through gradient descent on training examples. In-context learning achieves task adaptation purely through the input, with no parameter changes at all.

### How In-Context Learning Works

The mechanism behind in-context learning is still actively debated, but several important theoretical contributions have advanced our understanding:

**The Bayesian perspective.** Xie et al. (2022) in "An Explanation of In-context Learning as Implicit Bayesian Inference" argued that in-context learning can be understood as implicit Bayesian inference. The model maintains implicit beliefs about the task distribution, and each example in the context narrows this distribution toward the intended task. Under this view, few-shot examples are not "teaching" the model but rather disambiguating which of its pre-existing capabilities to activate.

**The linear model perspective.** Akyurek et al. (2023) and Von Oswald et al. (2023) showed that transformers trained on linear regression tasks implement gradient descent within their forward pass. The attention mechanism effectively performs an optimization step on the in-context examples, learning a task-specific linear model at inference time. While real LLM tasks are more complex than linear regression, this work suggests that in-context learning involves a form of implicit model construction.

**The task retrieval perspective.** Perhaps the most pragmatically useful view: in-context learning primarily works by retrieving and composing capabilities that the model already possesses from pretraining. This explains why in-context learning fails on tasks genuinely outside the model's training distribution but succeeds remarkably well on tasks that resemble, even distantly, patterns seen during training.

### Few-Shot Selection Strategies

Not all examples are equally effective as few-shot demonstrations. Research has identified several factors that influence example quality:

**Diversity.** Examples should cover the range of expected inputs. If classifying sentiment, include positive, negative, and neutral examples rather than three positive ones.

**Similarity.** Liu et al. (2022) showed in "What Makes Good In-Context Examples?" that selecting examples similar to the test input (via embedding-based retrieval) consistently outperforms random selection. This finding has practical implications for production systems:

```python
import numpy as np
from sentence_transformers import SentenceTransformer

class DynamicFewShotSelector:
    def __init__(self, example_pool, k=3):
        self.model = SentenceTransformer('all-MiniLM-L6-v2')
        self.examples = example_pool
        self.embeddings = self.model.encode(
            [ex['input'] for ex in example_pool]
        )
        self.k = k

    def select(self, query):
        query_emb = self.model.encode([query])
        similarities = np.dot(self.embeddings, query_emb.T).flatten()
        top_k_indices = np.argsort(similarities)[-self.k:][::-1]
        return [self.examples[i] for i in top_k_indices]

# Usage
selector = DynamicFewShotSelector(example_pool)
relevant_examples = selector.select("What's the return policy?")
prompt = format_few_shot_prompt(relevant_examples, user_query)
```

**Label balance.** For classification tasks, ensuring balanced representation of each class in the examples prevents the model from developing a frequency-based bias toward the most represented class.

**Order effects.** Lu et al. (2022) in "Fantastically Ordered Prompts and Where to Find Them" demonstrated that the order of few-shot examples can dramatically affect performance -- sometimes varying accuracy by 30+ percentage points. Their recommendation: when possible, try multiple orderings and select the best, or use techniques like calibration to mitigate order sensitivity.

## Chain-of-Thought Prompting

### The Original Insight

Wei et al. (2022) introduced chain-of-thought (CoT) prompting in "Chain-of-Thought Prompting Elicits Reasoning in Large Language Models," demonstrating that including step-by-step reasoning in few-shot examples dramatically improves performance on reasoning tasks. The technique is startlingly simple: instead of showing only input-output pairs, show the reasoning process that connects them.

```
# Standard few-shot
Q: Roger has 5 tennis balls. He buys 2 more cans of tennis balls.
   Each can has 3 tennis balls. How many tennis balls does he have now?
A: 11

# Chain-of-thought few-shot
Q: Roger has 5 tennis balls. He buys 2 more cans of tennis balls.
   Each can has 3 tennis balls. How many tennis balls does he have now?
A: Roger starts with 5 balls. He buys 2 cans, each with 3 balls,
   so he gets 2 * 3 = 6 new balls. Total: 5 + 6 = 11. The answer is 11.
```

The results were striking: on the GSM8K math benchmark, chain-of-thought prompting improved PaLM 540B's accuracy from 17.9% to 58.1%. At the time of publication, the effect appeared strongly scale-dependent -- CoT provided little benefit for smaller models but large gains for models above ~100B parameters. By 2025, this picture has shifted considerably. Fine-tuning smaller models specifically for chain-of-thought reasoning -- a technique sometimes called "distilling" reasoning traces from larger models -- has made CoT effective at the 7B-13B parameter scale. Models like DeepSeek-R1-Distill and Qwen2.5-Math demonstrate that the reasoning capability can be baked in through targeted training rather than requiring sheer scale. Meanwhile, GSM8K itself has become a saturated benchmark: frontier models now exceed 90% accuracy even without explicit CoT prompting, and many open-weight models in the 7B-70B range surpass the 2022 state-of-the-art with standard prompting alone. The community has largely moved to harder benchmarks -- MATH, GPQA, and competition-level problem sets -- as the true tests of reasoning capability.

### Why Chain-of-Thought Works

Several hypotheses explain CoT's effectiveness:

**Extended computation.** By generating intermediate steps, the model performs more computation before producing the final answer. Each token generated during the reasoning chain is a forward pass through the entire network, effectively giving the model more "thinking time."

**Error localization.** When reasoning is explicit, errors tend to occur at specific steps rather than manifesting as mysterious wrong answers. This makes CoT outputs more debuggable and trustworthy.

**Compositional generalization.** Complex problems often require composing multiple simpler operations. CoT allows the model to solve each sub-problem sequentially, using the output of each step as input to the next. This is more reliable than attempting to compute the entire answer in a single forward pass.

**Training data alignment.** Pretraining data contains many examples of step-by-step reasoning (textbooks, tutorials, forum explanations). CoT prompting activates these patterns, aligning the generation process with reasoning traces the model has seen during training.

### Zero-Shot Chain-of-Thought

Kojima et al. (2022) discovered that simply appending "Let's think step by step" to a prompt could elicit chain-of-thought reasoning without any few-shot examples. This "zero-shot CoT" finding was remarkable because it demonstrated that the reasoning capability was already present in the model -- it just needed a simple trigger to activate.

```
Q: A bat and a ball cost $1.10 in total. The bat costs $1.00 more
   than the ball. How much does the ball cost?

# Without CoT trigger (common wrong answer)
A: $0.10

# With CoT trigger
A: Let's think step by step.
   Let the ball cost x dollars.
   Then the bat costs x + $1.00.
   Together: x + (x + $1.00) = $1.10
   2x + $1.00 = $1.10
   2x = $0.10
   x = $0.05
   The ball costs $0.05.
```

Subsequent research has explored variations of the trigger phrase. "Let's work through this carefully" and "Let's break this down" produce similar effects. The key insight is that these phrases shift the model's output distribution toward deliberate, step-by-step reasoning rather than pattern-matching toward a quick answer.

## Self-Consistency: Sampling Multiple Reasoning Paths

Wang et al. (2022) introduced self-consistency in "Self-Consistency Improves Chain of Thought Reasoning in Language Models," building on the observation that chain-of-thought reasoning can follow multiple valid paths to the same answer. The technique is straightforward:

1. Generate multiple chain-of-thought reasoning paths (using temperature > 0)
2. Extract the final answer from each path
3. Take a majority vote across all answers

```python
import collections

def self_consistent_answer(prompt, model, n_samples=10, temperature=0.7):
    """Generate multiple reasoning paths and vote on the answer."""
    answers = []
    reasoning_paths = []

    for _ in range(n_samples):
        response = model.generate(
            prompt + "\nLet's think step by step.",
            temperature=temperature
        )
        reasoning_paths.append(response)
        answer = extract_final_answer(response)
        answers.append(answer)

    # Majority vote
    vote_counts = collections.Counter(answers)
    best_answer = vote_counts.most_common(1)[0][0]
    confidence = vote_counts[best_answer] / len(answers)

    return {
        "answer": best_answer,
        "confidence": confidence,
        "vote_distribution": dict(vote_counts),
        "reasoning_paths": reasoning_paths
    }
```

Self-consistency improves on basic CoT by marginalizing over the reasoning process rather than relying on a single (potentially flawed) reasoning chain. On GSM8K, self-consistency with CoT pushed PaLM 540B's accuracy from 58.1% to 74.4%.

The confidence signal is a valuable byproduct: when all reasoning paths converge on the same answer, confidence is high and the answer is very likely correct. When paths diverge, the question may be ambiguous or the model may lack sufficient knowledge. This confidence signal can be used to route low-confidence queries to human review or alternative processing pipelines.

## Tree-of-Thought

Yao et al. (2023) generalized chain-of-thought into tree-of-thought (ToT), allowing the model to explore multiple reasoning branches at each step rather than committing to a single linear chain. ToT treats reasoning as search through a tree of possible thoughts, with each node representing an intermediate reasoning state.

The key components of ToT are:

1. **Thought generation**: At each step, generate multiple candidate next-thoughts
2. **Evaluation**: Assess each candidate thought's promise (via the model itself or an external evaluator)
3. **Search strategy**: Use BFS or DFS to explore the thought tree, pruning unpromising branches

```python
class TreeOfThought:
    def __init__(self, model, evaluator, breadth=3, depth=5):
        self.model = model
        self.evaluator = evaluator
        self.breadth = breadth
        self.max_depth = depth

    def solve(self, problem):
        root = ThoughtNode(state=problem, depth=0)
        return self._bfs(root)

    def _bfs(self, root):
        queue = [root]
        best_solution = None

        while queue:
            node = queue.pop(0)
            if node.depth >= self.max_depth:
                continue

            # Generate candidate next thoughts
            candidates = self.model.generate_thoughts(
                node.state, n=self.breadth
            )

            for thought in candidates:
                new_state = node.state + "\n" + thought
                score = self.evaluator.evaluate(new_state)

                child = ThoughtNode(
                    state=new_state,
                    depth=node.depth + 1,
                    score=score
                )

                if self.evaluator.is_solution(new_state):
                    if best_solution is None or score > best_solution.score:
                        best_solution = child
                elif score > PRUNING_THRESHOLD:
                    queue.append(child)

        return best_solution
```

ToT excels on problems that require exploration and backtracking -- tasks where committing to a wrong intermediate step dooms the entire reasoning chain. Examples include creative writing (where exploring multiple narrative directions is valuable), puzzle-solving (where dead ends are common), and strategic planning (where evaluating multiple options before committing is essential).

The cost, however, is significant: ToT requires many more model calls than standard CoT, making it impractical for latency-sensitive applications. In practice, ToT is best reserved for high-stakes reasoning tasks where accuracy justifies the computational cost.

## Least-to-Most Prompting

Zhou et al. (2023) introduced least-to-most prompting in "Least-to-Most Prompting Enables Complex Reasoning in Large Language Models," addressing a specific failure mode of chain-of-thought: when a problem requires solving sub-problems that are themselves complex, CoT often fails because it tries to handle everything in a single reasoning chain.

Least-to-most prompting works in two stages:

**Stage 1 -- Decomposition**: Ask the model to break the problem into sub-problems, ordered from simplest to most complex.

**Stage 2 -- Sequential solving**: Solve each sub-problem in order, with each solution added to the context for solving subsequent sub-problems.

```
# Stage 1: Decomposition
Problem: "How long would it take to fill a swimming pool using
a garden hose, given that the pool is 20,000 gallons and the
hose flows at 10 gallons per minute, but you can only run the
hose for 8 hours per day?"

Sub-problems to solve:
1. How many gallons per hour does the hose deliver?
2. How many gallons per day (with the 8-hour limit)?
3. How many days to fill the full 20,000 gallons?
4. Convert to a meaningful time estimate.

# Stage 2: Sequential solving
Sub-problem 1: 10 gal/min * 60 min/hr = 600 gallons per hour

Sub-problem 2 (using result from 1):
600 gal/hr * 8 hr/day = 4,800 gallons per day

Sub-problem 3 (using result from 2):
20,000 / 4,800 = 4.17 days

Sub-problem 4 (using result from 3):
Approximately 4 days and 4 hours.
```

The key advantage of least-to-most over standard CoT is that each sub-problem is simpler than the original, reducing the chance of reasoning errors. The approach is particularly effective for compositional generalization -- problems that combine elements in ways not directly seen during training but whose individual components are well-understood.

## Advanced CoT Variants

### Contrastive Chain-of-Thought

Chia et al. (2023) proposed providing both correct and incorrect reasoning examples, helping the model learn not just how to reason but how to avoid common reasoning errors:

```
# Correct reasoning
Q: If a store offers 20% off and then an additional 10% off
   the reduced price, what is the total discount?
A: First discount: 20% off means you pay 80%.
   Second discount: 10% off the reduced price means 90% of 80% = 72%.
   Total discount: 100% - 72% = 28%.

# Common incorrect reasoning (marked as wrong)
WRONG: 20% + 10% = 30% total discount.
WHY WRONG: The second discount applies to the already-reduced
price, not the original price. Discounts don't simply add.
```

### Program-of-Thought

Chen et al. (2023) introduced program-of-thought prompting, where instead of reasoning in natural language, the model generates executable code that performs the computation:

```
Q: A store has 4 shelves. Each shelf has 3 rows. Each row holds
   8 books. If 15 books are checked out, how many remain?

# Program-of-thought
shelves = 4
rows_per_shelf = 3
books_per_row = 8
total_books = shelves * rows_per_shelf * books_per_row  # 96
checked_out = 15
remaining = total_books - checked_out  # 81
print(remaining)  # 81
```

This approach offloads arithmetic to a code interpreter, eliminating calculation errors that plague natural language reasoning. The model's job becomes translating the problem into code rather than performing the computation itself -- a task that plays to LLMs' strengths.

## Reasoning Tokens and Extended Thinking

The release of OpenAI's o1 in late 2024, followed by o3 and DeepSeek-R1 in early 2025, marked a fundamental shift in how chain-of-thought reasoning is implemented. Rather than relying on prompt-based CoT -- where the user or system prompt instructs the model to reason step-by-step -- these models perform extended internal reasoning as part of their inference process, generating hidden "reasoning tokens" before producing a visible response. The model has been trained, typically through reinforcement learning, to allocate variable amounts of internal computation depending on problem difficulty.

This creates a new taxonomy for practitioners. There are now three distinct approaches to eliciting reasoning:

**Prompt-based CoT.** The original approach: append "Let's think step by step" or provide few-shot examples with reasoning traces. This remains the right choice for standard models (GPT-4o, Claude Sonnet, Gemini Pro) where you want explicit, inspectable reasoning in the output. It is also the only option when you need to control the reasoning format -- for instance, when downstream parsing depends on a specific structure (see [Article 10: Structured Output](/structured-output) for techniques on enforcing output format alongside reasoning).

**Training-based reasoning.** Models like o3 and DeepSeek-R1 have internalized the CoT process. They allocate reasoning tokens automatically, often producing more thorough analysis than prompt-based CoT achieves. The key advantage is that the model learns *when* and *how much* to reason through reinforcement learning, rather than reasoning at a fixed depth regardless of problem difficulty. A simple factual lookup gets minimal reasoning; a multi-step proof gets extensive internal deliberation. The tradeoff is reduced transparency -- reasoning tokens in o1/o3 are hidden by default, and even when exposed (as in DeepSeek-R1), the traces can be verbose and difficult to parse.

**Hybrid approaches.** Claude's "extended thinking" feature and similar mechanisms offer a middle ground: the model produces a visible thinking block that the user can inspect, followed by a concise response. This preserves the debuggability advantage of prompt-based CoT while leveraging training-time reasoning optimization. In practice, this is often the best choice for agentic applications where you need both strong reasoning and the ability to audit the model's thought process.

A common mistake is to use prompt-based CoT with a reasoning model. Telling o3 to "think step by step" is redundant at best and counterproductive at worst -- the model may produce a superficial prompt-satisfying chain on top of its internal reasoning, wasting tokens without improving accuracy. The general guidance: if the model has built-in reasoning, trust it. If it does not, provide CoT scaffolding through the prompt. For a broader view of how these prompting decisions fit into systematic prompt development, see [Article 7: Prompt Engineering Fundamentals](/prompt-engineering-fundamentals).

## CoT Faithfulness and Interpretability

The appeal of chain-of-thought reasoning extends beyond accuracy: explicit reasoning traces promise interpretability. If a model shows its work, we can verify its logic, catch errors, and build trust. But a growing body of research challenges the assumption that CoT traces faithfully represent the model's internal computation.

**The faithfulness problem.** Turpin et al. (2023) in "Language Models Don't Always Say What They Think" demonstrated that models can produce plausible-looking chain-of-thought reasoning that is systematically unfaithful to the actual factors driving the model's answer. In their experiments, they introduced biasing features into few-shot examples -- such as making the correct answer always "(A)" -- and found that models would choose the biased answer while generating elaborate reasoning chains that never mentioned the bias. The model "knew" the answer was (A) because of the pattern in the examples, but its CoT confabulated a substantive justification.

**Causal unfaithfulness.** Lanham et al. (2023) in "Measuring Faithfulness in Chain-of-Thought Reasoning" took a more systematic approach, testing whether the conclusions stated in CoT traces actually depend on the reasoning steps that precede them. They found that truncating or corrupting intermediate reasoning steps often had little effect on the final answer, suggesting that the model was arriving at the answer through internal mechanisms that the CoT trace merely post-hoc rationalized. On easier problems, the chain-of-thought was particularly likely to be unfaithful -- the model already "knew" the answer and generated reasoning to match.

These findings have concrete implications for practitioners:

**Debugging.** When a CoT trace leads to a wrong answer, the visible error in the chain may not be the actual cause of failure. Fixing the surface-level reasoning error (e.g., by adding a contrastive example showing the correct reasoning) may not help if the model's real failure is in its internal representations. This is a case where [Article 11: Prompt Optimization](/prompt-optimization) techniques like DSPy can outperform manual prompt debugging, because they optimize against task outcomes rather than reasoning aesthetics.

**Trust calibration.** CoT should be treated as a useful but imperfect signal. A convincing reasoning chain does not guarantee the answer is correct, and an awkward-looking chain does not mean the answer is wrong. Self-consistency (sampling multiple reasoning paths) remains a more reliable indicator of correctness than the apparent quality of any single chain.

**Model selection.** Faithfulness appears to improve with training specifically targeting faithful reasoning. Models trained with process reward models (PRMs) -- which reward correct intermediate steps, not just correct final answers -- tend to produce more faithful chains than models trained with outcome reward models (ORMs) alone. When interpretability of reasoning is critical (medical, legal, financial applications), prefer models with explicit process supervision.

## ReAct: Reasoning Plus Acting

Yao et al. (2022) introduced ReAct in "ReAct: Synergizing Reasoning and Acting in Language Models," a paradigm that interleaves chain-of-thought reasoning with concrete actions -- typically tool calls or environment interactions. Where standard CoT is purely internal (the model reasons but cannot observe new information), ReAct allows the model to think, act, observe, and then think again in a loop.

A ReAct trace follows a characteristic pattern:

```
Question: What is the elevation range for the area that the
eastern sector of the Colorado orogeny extends into?

Thought 1: I need to find where the eastern sector of the Colorado
orogeny extends, then find the elevation range of that area.

Action 1: Search["eastern sector of the Colorado orogeny"]

Observation 1: The Colorado orogeny was an episode of mountain
building that included much of eastern Utah and western Colorado.
The eastern sector extends into the High Plains.

Thought 2: The eastern sector extends into the High Plains.
I need to find the elevation range of the High Plains.

Action 2: Search["High Plains elevation range"]

Observation 2: The High Plains rise in elevation from around
1,800 feet to over 7,000 feet.

Thought 3: The elevation range is approximately 1,800 to 7,000 feet.

Answer: The elevation range is approximately 1,800 to 7,000 feet.
```

The significance of ReAct is that it bridges the gap between chain-of-thought reasoning and agentic tool use. Standard CoT asks the model to reason from what it already knows. ReAct lets the model identify knowledge gaps, take actions to fill them, and incorporate new information into its reasoning. This is the foundation of most modern agent architectures -- the pattern of "think about what to do, do it, observe the result, think again" is essentially ReAct generalized.

In practice, ReAct naturally connects to multi-hop reasoning in retrieval-augmented generation. When a question requires synthesizing information from multiple sources, a ReAct-style agent can retrieve one document, reason about what additional information is needed, retrieve a second document, and synthesize. This iterative retrieve-and-reason loop is explored in depth in [Article 17: Advanced RAG](/advanced-rag), where it appears as the core mechanism behind agentic RAG architectures.

The key design decisions when implementing ReAct are:

**Action space definition.** What tools can the model invoke? A narrow action space (just search) keeps the model focused but limits capability. A broad action space (search, calculate, code execution, API calls) increases capability but also increases the chance of the model choosing an inappropriate action or getting stuck in unproductive loops.

**Observation formatting.** How should tool outputs be presented back to the model? Raw tool outputs may be too verbose or poorly formatted. Summarizing or truncating observations keeps the context window manageable but risks losing important details.

**Termination conditions.** When should the model stop its think-act-observe loop? Without explicit termination logic, models can enter infinite loops of redundant searches or reasoning circles. Setting a maximum number of steps and including a "finish" action are practical necessities.

```python
class ReActAgent:
    def __init__(self, model, tools, max_steps=8):
        self.model = model
        self.tools = {t.name: t for t in tools}
        self.max_steps = max_steps

    def run(self, question):
        trajectory = [f"Question: {question}"]

        for step in range(1, self.max_steps + 1):
            # Generate thought and action
            response = self.model.generate(
                self._build_prompt(trajectory),
                stop=["\nObservation"]
            )
            trajectory.append(response)

            # Parse action
            action, action_input = self._parse_action(response)

            if action == "Finish":
                return action_input

            # Execute action and get observation
            observation = self.tools[action].run(action_input)
            trajectory.append(
                f"Observation {step}: {observation}"
            )

        return "Maximum steps reached without answer."
```

ReAct's influence extends well beyond its original paper. The pattern has become the default architecture for LLM agents -- frameworks like LangChain, LlamaIndex, and the Anthropic tool-use API all implement variations of the ReAct loop. Understanding ReAct as formalized CoT-with-actions clarifies why these agent frameworks work the way they do and helps practitioners debug them when they fail.

## Practical Considerations for Production

### When to Use Each Technique

| Technique | Best For | Cost | Latency |
|-----------|----------|------|---------|
| Zero-shot | Simple tasks, strong models | Low | Low |
| Few-shot | Format control, classification | Low-Medium | Low |
| Zero-shot CoT | Reasoning tasks, quick deployment | Low | Medium |
| Few-shot CoT | Complex reasoning, reliable format | Medium | Medium |
| Self-consistency | High-stakes reasoning | High | High |
| Tree-of-thought | Exploration, creative tasks | Very High | Very High |
| Least-to-most | Compositional problems | Medium-High | High |

### Combining Techniques

These techniques are not mutually exclusive. A production system might use:

1. **Dynamic few-shot selection** to choose relevant examples
2. **Chain-of-thought** within each example
3. **Self-consistency** for high-stakes decisions
4. **Confidence-based routing** to escalate uncertain cases

```python
def answer_with_confidence(query, examples_pool, model):
    # Dynamic few-shot selection
    examples = select_similar_examples(query, examples_pool, k=3)

    # Build CoT prompt
    prompt = build_cot_prompt(examples, query)

    # Self-consistency for confidence
    result = self_consistent_answer(prompt, model, n_samples=5)

    if result["confidence"] >= 0.8:
        return result["answer"]
    elif result["confidence"] >= 0.5:
        # Try with more samples
        result = self_consistent_answer(prompt, model, n_samples=15)
        return result["answer"]
    else:
        # Escalate to human review
        return flag_for_review(query, result)
```

### Cost-Performance Tradeoffs

Every advanced prompting technique increases cost (more tokens generated, more API calls). The decision of which technique to use should be driven by the value of correctness for the specific application:

- **Customer-facing chatbot**: Zero-shot or few-shot, prioritizing latency
- **Medical diagnosis support**: Self-consistency with CoT, prioritizing accuracy
- **Code generation**: Few-shot CoT with program-of-thought, balancing both
- **Research analysis**: Tree-of-thought, where cost is secondary to depth

## Summary and Key Takeaways

- In-context learning allows models to adapt to new tasks through examples alone, likely through a mechanism that combines implicit Bayesian inference with capability retrieval from pretraining.
- Few-shot example selection significantly impacts performance; embedding-based similarity retrieval outperforms random selection, and example order matters more than most practitioners realize.
- Chain-of-thought prompting (Wei et al., 2022) remains one of the highest-impact techniques, improving reasoning performance by making intermediate steps explicit. While originally observed only in models above ~100B parameters, fine-tuned smaller models (7B-13B) now produce effective CoT, and benchmarks like GSM8K have been largely saturated.
- Zero-shot CoT ("Let's think step by step") provides much of CoT's benefit without requiring curated examples, making it a strong default for reasoning tasks.
- Self-consistency (Wang et al., 2022) improves on CoT by sampling multiple reasoning paths and voting, providing both better answers and a useful confidence signal.
- Tree-of-thought enables exploration and backtracking but at significant computational cost; reserve it for problems where exploration is essential.
- Least-to-most prompting addresses compositional generalization by decomposing problems into ordered sub-problems, solving each with the context of prior solutions.
- Reasoning-native models (o1/o3, DeepSeek-R1) internalize CoT through training, making prompt-based CoT redundant for these models. Use prompt-based CoT for standard models; trust built-in reasoning for reasoning-optimized models.
- CoT faithfulness is not guaranteed -- research shows models can produce plausible reasoning chains that do not reflect their actual decision-making process. Treat CoT as a useful but imperfect interpretability tool.
- ReAct (Yao et al., 2022) bridges CoT and tool use by interleaving reasoning and actions, forming the foundation of modern agent architectures.
- In production, combine techniques based on the cost-accuracy tradeoff appropriate for your application, and use confidence signals to route queries appropriately.
