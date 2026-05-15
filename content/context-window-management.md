# Context Window Management: Token Budgets, Prioritization & Overflow Strategies

Every interaction with a large language model is bounded by a hard constraint: the context window. This fixed-size buffer -- measured in tokens, not characters or words -- determines the total amount of information the model can see at inference time, encompassing the system prompt, retrieved documents, conversation history, tool definitions, and the user's current message plus the model's generated response. Managing this finite resource effectively is one of the most impactful skills in applied AI engineering. A system that wastes context on irrelevant information, positions critical facts where the model's attention is weakest, or truncates carelessly when the window fills will underperform regardless of which model it uses. This article examines context window management from first principles: how tokens are counted, how window sizes vary across model families, how to allocate budgets across context components, why position within the window matters, and what to do when your content exceeds the available space.

Understanding context window management builds on several foundational topics. Tokenization mechanics are covered in depth in [Tokenization](/tokenization), the broader discipline of assembling context is explored in [Context Engineering](/context-engineering), and static instruction design is covered in [System Prompts](/system-prompts). This article focuses specifically on the engineering challenge of fitting the right information into a finite window and handling the cases where it does not fit.

## Token Counting Fundamentals

### Why Characters and Words Are Not Tokens

The most common misconception in context window management is treating tokens as roughly equivalent to words. They are not. A token is a unit of the model's vocabulary -- a subword piece produced by the tokenizer that was trained alongside the model. The relationship between characters, words, and tokens varies by language, content type, and which tokenizer is in use.

For English prose, a rough approximation is 1 token per 4 characters or 0.75 tokens per word. But this heuristic breaks down in important ways:

```
Text: "Hello, world!"
  GPT-4 (cl100k_base):  4 tokens  ["Hello", ",", " world", "!"]
  Claude (claude):       4 tokens  ["Hello", ",", " world", "!"]
  Llama 3 (tiktoken):   4 tokens  ["Hello", ",", " world", "!"]

Text: "pneumonoultramicroscopicsilicovolcanoconiosis"
  GPT-4:  9 tokens  (long unfamiliar word splits into many subwords)

Text: "{'user_id': 12345, 'action': 'click'}"
  GPT-4:  15 tokens (JSON syntax consumes more tokens than prose)

Text: "SELECT * FROM jobs WHERE is_remote_eu = TRUE"
  GPT-4:  12 tokens (SQL keywords and identifiers each take a token)
```

Code, JSON, XML, and structured data are particularly token-hungry. A JSON schema definition for a tool might appear to be "just 200 words" but could easily consume 400-600 tokens due to punctuation, brackets, and key names.

### Tokenizer Libraries and Their Differences

Different model families use different tokenizers, and counting tokens with the wrong tokenizer produces wrong numbers. The key libraries:

**tiktoken** (OpenAI): The standard for GPT-3.5, GPT-4, and GPT-4o models. Implements BPE (Byte Pair Encoding) with different encoding names for different model generations.

```python
import tiktoken

def count_tokens_openai(text: str, model: str = "gpt-4o") -> int:
    """Count tokens for OpenAI models using tiktoken."""
    encoding = tiktoken.encoding_for_model(model)
    return len(encoding.encode(text))

# Different encodings for different model generations
enc_gpt4o = tiktoken.encoding_for_model("gpt-4o")       # o200k_base
enc_gpt4 = tiktoken.encoding_for_model("gpt-4")          # cl100k_base
enc_gpt35 = tiktoken.encoding_for_model("gpt-3.5-turbo") # cl100k_base

text = "Context window management is a critical skill for AI engineers."
print(f"gpt-4o:      {len(enc_gpt4o.encode(text))} tokens")  # o200k_base
print(f"gpt-4:       {len(enc_gpt4.encode(text))} tokens")   # cl100k_base
```

**Anthropic tokenizer**: Claude models use a proprietary tokenizer. Anthropic provides token counts in API responses but does not distribute the tokenizer as a standalone library. For budget estimation, tiktoken's `cl100k_base` encoding is a reasonable proxy, typically within 5-10% of Claude's actual count.

**SentencePiece / Hugging Face tokenizers**: Open-weight models (Llama, Mistral, Gemma) use SentencePiece-based tokenizers distributed with the model weights. The `transformers` library loads them automatically.

```python
from transformers import AutoTokenizer

def count_tokens_hf(text: str, model_name: str) -> int:
    """Count tokens for Hugging Face models."""
    tokenizer = AutoTokenizer.from_pretrained(model_name)
    return len(tokenizer.encode(text))

# Each model family has its own tokenizer
llama_tok = AutoTokenizer.from_pretrained("meta-llama/Llama-3.1-8B")
mistral_tok = AutoTokenizer.from_pretrained("mistralai/Mistral-7B-v0.3")

text = "Context window management is a critical skill for AI engineers."
print(f"Llama 3.1:  {len(llama_tok.encode(text))} tokens")
print(f"Mistral:    {len(mistral_tok.encode(text))} tokens")
```

In TypeScript, the `js-tiktoken` package provides browser- and Node-compatible token counting for OpenAI models, while `@anthropic-ai/tokenizer` (when available) handles Claude:

```typescript
import { encodingForModel } from "js-tiktoken";

function countTokens(text: string, model: string = "gpt-4o"): number {
  const encoding = encodingForModel(model as Parameters<typeof encodingForModel>[0]);
  const tokens = encoding.encode(text);
  encoding.free(); // important: release WASM memory
  return tokens.length;
}

// For chat messages, account for message framing overhead
function countChatTokens(
  messages: Array<{ role: string; content: string }>,
  model: string = "gpt-4o"
): number {
  const encoding = encodingForModel(model as Parameters<typeof encodingForModel>[0]);
  let total = 0;
  for (const msg of messages) {
    total += 4; // message framing tokens (<|im_start|>, role, \n, <|im_end|>)
    total += encoding.encode(msg.content).length;
    total += encoding.encode(msg.role).length;
  }
  total += 2; // assistant priming tokens
  encoding.free();
  return total;
}
```

### Message Framing Overhead

A detail that catches engineers off guard: the Chat Completions API adds framing tokens around each message. Each message in the OpenAI format costs approximately 4 extra tokens for the special tokens that delineate the message role and boundaries. A conversation with 20 messages adds roughly 80 overhead tokens beyond the content itself. For Claude's Messages API, similar overhead exists but the exact count differs.

This framing cost is modest for long conversations but can be significant when you have many short messages, such as multi-turn tool-use sequences where each tool call and result is a separate message.

```python
def count_chat_tokens_openai(
    messages: list[dict],
    model: str = "gpt-4o"
) -> int:
    """Count tokens for a full chat completion request, including framing."""
    encoding = tiktoken.encoding_for_model(model)

    # Per-message overhead depends on model
    # gpt-4o and gpt-4: 3 tokens per message + 1 for role
    tokens_per_message = 4

    total = 0
    for message in messages:
        total += tokens_per_message
        for key, value in message.items():
            if isinstance(value, str):
                total += len(encoding.encode(value))

    total += 2  # assistant reply priming
    return total
```

## Context Window Sizes Across Model Families

Context window size is not just a number -- it is an architectural constraint that shapes what applications you can build. The following table captures the landscape as of early 2026:

```
Model Family            Context Window    Effective Sweet Spot    Notes
---------------------   ---------------   --------------------    -------------------------
GPT-4o                  128K tokens       ~64K                    Quality degrades past 64K
GPT-4o-mini             128K tokens       ~64K                    Cost-effective, same window
GPT-4.1                 1M tokens         ~128K                   Latest, extended context
o1 / o3                 200K tokens       ~100K                   Reasoning tokens consume window
Claude 3.5 Sonnet       200K tokens       ~100K                   Strong long-context performance
Claude 3.5 Haiku        200K tokens       ~100K                   Faster, same window size
Claude Opus 4           200K tokens       ~100K                   Highest quality, extended thinking
Gemini 1.5 Pro          2M tokens         ~500K                   Largest production window
Gemini 2.0 Flash        1M tokens         ~256K                   Cost-effective long context
Llama 3.1 (8B/70B)      128K tokens       ~32K                    Open weights, RoPE extended
Llama 3.3 70B           128K tokens       ~64K                    Improved long-context
Mistral Large           128K tokens       ~32K                    Sliding window attention
Mixtral 8x22B           64K tokens        ~32K                    Sparse MoE architecture
DeepSeek-V3             128K tokens       ~64K                    Strong multilingual
Qwen 2.5 (72B)          128K tokens       ~32K                    Good CJK tokenization
```

The "effective sweet spot" column deserves emphasis. Most models show measurable quality degradation well before the advertised maximum context length. The **RULER benchmark** (Hsieh et al., 2024) demonstrated that many models claiming 128K context windows show significant performance drops on needle-in-a-haystack tasks beyond 32K-64K tokens. The advertised window is the ceiling; the effective window for reliable performance is typically 25-50% of that ceiling.

### Architectural Implications

Context window size shapes application architecture in several ways:

**Small windows (4K-8K)**: Force aggressive context management. Every token counts. Systems must summarize aggressively, retrieve precisely, and keep system prompts minimal. Common in edge deployment and fine-tuned specialist models.

**Medium windows (32K-128K)**: The current sweet spot for most production applications. Large enough to include substantial retrieved context and conversation history without extreme compression. Most of this article's strategies target this range.

**Large windows (200K-2M)**: Enable "stuff it all in" approaches for some use cases -- entire codebases, full documents, long transcripts. But the lost-in-the-middle effect (covered below) means that naive stuffing rarely outperforms careful curation. Large windows are most valuable when the task genuinely requires holistic understanding of a large document rather than finding specific facts.

**Reasoning model windows**: Models like o1 and o3 use "reasoning tokens" (also called "thinking tokens") that consume the context window from the output side. If the model uses 50K tokens for internal reasoning, those tokens reduce the effective space available for your input context. This creates a unique budgeting challenge where you must account for both input and reasoning output.

## Token Budget Allocation Strategies

The core challenge of context window management is partitioning a finite resource among competing consumers. Every token spent on one component is a token unavailable for another. The allocation must balance competing concerns: comprehensive instructions versus room for dynamic content, rich conversation history versus space for retrieved documents, detailed tool schemas versus output generation room.

### The Five-Component Model

A typical LLM application's context window contains five distinct components, each with different characteristics:

```
┌──────────────────────────────────────────────────────────────┐
│                    CONTEXT WINDOW (128K)                      │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ 1. SYSTEM PROMPT                     [STATIC, FIXED]   │  │
│  │    Role definition, constraints, output format          │  │
│  │    Budget: 5-15% of effective window                    │  │
│  ├────────────────────────────────────────────────────────┤  │
│  │ 2. TOOL DEFINITIONS                  [STATIC, FIXED]   │  │
│  │    Function schemas, parameter descriptions             │  │
│  │    Budget: 5-20% (depends on tool count)                │  │
│  ├────────────────────────────────────────────────────────┤  │
│  │ 3. RETRIEVED CONTEXT                 [DYNAMIC, VARIABLE]│  │
│  │    RAG results, knowledge base hits, file contents      │  │
│  │    Budget: 20-40% of effective window                   │  │
│  ├────────────────────────────────────────────────────────┤  │
│  │ 4. CONVERSATION HISTORY              [DYNAMIC, GROWING] │  │
│  │    Prior turns, tool call results, assistant responses   │  │
│  │    Budget: 15-30% of effective window                   │  │
│  ├────────────────────────────────────────────────────────┤  │
│  │ 5. CURRENT TURN                      [DYNAMIC, VARIABLE]│  │
│  │    User message + expected output tokens                │  │
│  │    Budget: 10-20% input + reserved output space         │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  Reserved: OUTPUT GENERATION SPACE      [MUST PRESERVE]      │
│  The model needs room to generate its response.              │
│  Budget: 2K-8K tokens minimum, more for reasoning models     │
└──────────────────────────────────────────────────────────────┘
```

### Static vs. Dynamic Budget Partitioning

A critical design decision is how to handle the split between static components (system prompt, tool definitions) and dynamic components (retrieved context, history, user message).

**Fixed allocation** assigns a hard budget to each component. Simple but rigid -- it wastes tokens when a component does not use its full allocation:

```python
from dataclasses import dataclass

@dataclass
class FixedBudget:
    """Fixed token budget allocation. Simple but inflexible."""
    total_window: int = 128_000
    max_output_tokens: int = 4_096

    system_prompt: int = 2_000
    tool_definitions: int = 3_000
    retrieved_context: int = 8_000
    conversation_history: int = 6_000
    user_message: int = 2_000
    safety_margin: int = 500

    @property
    def effective_input_budget(self) -> int:
        return self.total_window - self.max_output_tokens

    @property
    def allocated(self) -> int:
        return (
            self.system_prompt
            + self.tool_definitions
            + self.retrieved_context
            + self.conversation_history
            + self.user_message
            + self.safety_margin
        )

    def validate(self) -> bool:
        return self.allocated <= self.effective_input_budget
```

**Proportional allocation** defines each component as a percentage of the effective window, allowing the system to adapt when the window size changes (e.g., when switching models):

```python
@dataclass
class ProportionalBudget:
    """Proportional budget allocation. Adapts to different window sizes."""
    total_window: int
    max_output_tokens: int

    # Percentages of effective input budget
    system_prompt_pct: float = 0.10
    tool_definitions_pct: float = 0.10
    retrieved_context_pct: float = 0.35
    conversation_history_pct: float = 0.25
    user_message_pct: float = 0.10
    safety_margin_pct: float = 0.05
    # Remaining 5% is unallocated buffer

    @property
    def effective_input(self) -> int:
        return self.total_window - self.max_output_tokens

    def budget_for(self, component: str) -> int:
        pct = getattr(self, f"{component}_pct", 0)
        return int(self.effective_input * pct)

    def allocate(self) -> dict[str, int]:
        return {
            "system_prompt": self.budget_for("system_prompt"),
            "tool_definitions": self.budget_for("tool_definitions"),
            "retrieved_context": self.budget_for("retrieved_context"),
            "conversation_history": self.budget_for("conversation_history"),
            "user_message": self.budget_for("user_message"),
            "safety_margin": self.budget_for("safety_margin"),
        }

# Same proportions, different models
gpt4o_budget = ProportionalBudget(total_window=128_000, max_output_tokens=4_096)
claude_budget = ProportionalBudget(total_window=200_000, max_output_tokens=8_192)
small_model_budget = ProportionalBudget(total_window=8_192, max_output_tokens=1_024)
```

**Dynamic allocation** is the most sophisticated approach. It measures each component's actual token count first, then redistributes unused budget to components that need more:

```python
import tiktoken

class DynamicBudgetAllocator:
    """Dynamic budget that reallocates unused space to where it is needed."""

    def __init__(
        self,
        total_window: int = 128_000,
        max_output_tokens: int = 4_096,
        model: str = "gpt-4o",
    ):
        self.total_window = total_window
        self.max_output_tokens = max_output_tokens
        self.encoding = tiktoken.encoding_for_model(model)
        self.effective_input = total_window - max_output_tokens

        # Minimum guaranteed budgets (tokens)
        self.minimums = {
            "system_prompt": 500,
            "tool_definitions": 0,
            "retrieved_context": 1_000,
            "conversation_history": 500,
            "user_message": 200,
            "safety_margin": 200,
        }

        # Maximum allowed budgets (tokens)
        self.maximums = {
            "system_prompt": 4_000,
            "tool_definitions": 8_000,
            "retrieved_context": 50_000,
            "conversation_history": 40_000,
            "user_message": 10_000,
            "safety_margin": 500,
        }

        # Priority order for receiving surplus tokens (highest first)
        self.overflow_priority = [
            "retrieved_context",
            "conversation_history",
            "user_message",
            "system_prompt",
            "tool_definitions",
        ]

    def count(self, text: str) -> int:
        return len(self.encoding.encode(text))

    def allocate(
        self,
        system_prompt: str,
        tool_definitions: str,
        retrieved_context: str,
        conversation_history: str,
        user_message: str,
    ) -> dict[str, dict]:
        """Allocate budget dynamically based on actual content sizes."""
        components = {
            "system_prompt": system_prompt,
            "tool_definitions": tool_definitions,
            "retrieved_context": retrieved_context,
            "conversation_history": conversation_history,
            "user_message": user_message,
        }

        # Measure actual sizes
        actual = {k: self.count(v) for k, v in components.items()}

        # Fixed components: system prompt and tool defs use what they need
        # (up to their maximum -- these are typically non-negotiable)
        fixed_usage = min(actual["system_prompt"], self.maximums["system_prompt"])
        fixed_usage += min(actual["tool_definitions"], self.maximums["tool_definitions"])

        # User message is also non-negotiable (never truncate the current request)
        user_usage = actual["user_message"]
        safety = self.minimums["safety_margin"]

        # Remaining budget for flexible components
        flexible_budget = self.effective_input - fixed_usage - user_usage - safety

        # Allocate remaining budget between retrieved context and history
        # Give priority to retrieved context (more immediately relevant)
        retrieved_budget = min(actual["retrieved_context"], int(flexible_budget * 0.6))
        history_budget = min(
            actual["conversation_history"],
            flexible_budget - retrieved_budget
        )

        # If history did not use its full share, give surplus to retrieval
        surplus = flexible_budget - retrieved_budget - history_budget
        if surplus > 0:
            retrieved_budget = min(
                actual["retrieved_context"],
                retrieved_budget + surplus
            )

        return {
            "system_prompt": {
                "actual": actual["system_prompt"],
                "budget": min(actual["system_prompt"], self.maximums["system_prompt"]),
                "truncated": actual["system_prompt"] > self.maximums["system_prompt"],
            },
            "tool_definitions": {
                "actual": actual["tool_definitions"],
                "budget": min(actual["tool_definitions"], self.maximums["tool_definitions"]),
                "truncated": actual["tool_definitions"] > self.maximums["tool_definitions"],
            },
            "retrieved_context": {
                "actual": actual["retrieved_context"],
                "budget": retrieved_budget,
                "truncated": actual["retrieved_context"] > retrieved_budget,
            },
            "conversation_history": {
                "actual": actual["conversation_history"],
                "budget": history_budget,
                "truncated": actual["conversation_history"] > history_budget,
            },
            "user_message": {
                "actual": actual["user_message"],
                "budget": user_usage,
                "truncated": False,  # never truncate user message
            },
            "total_used": fixed_usage + user_usage + retrieved_budget + history_budget + safety,
            "total_available": self.effective_input,
            "utilization": (fixed_usage + user_usage + retrieved_budget + history_budget + safety) / self.effective_input,
        }
```

### Task-Adaptive Budget Profiles

Different tasks have fundamentally different context needs. A code generation task needs heavy system prompt and retrieved context budget. A conversational task needs more history. A document Q&A task needs almost all budget for the document. Defining task profiles and switching between them is a production pattern:

```python
TASK_PROFILES: dict[str, dict[str, float]] = {
    "conversational": {
        "system_prompt": 0.08,
        "tool_definitions": 0.05,
        "retrieved_context": 0.15,
        "conversation_history": 0.55,
        "user_message": 0.12,
        "safety_margin": 0.05,
    },
    "document_qa": {
        "system_prompt": 0.05,
        "tool_definitions": 0.02,
        "retrieved_context": 0.70,
        "conversation_history": 0.05,
        "user_message": 0.13,
        "safety_margin": 0.05,
    },
    "code_generation": {
        "system_prompt": 0.15,
        "tool_definitions": 0.10,
        "retrieved_context": 0.40,
        "conversation_history": 0.15,
        "user_message": 0.15,
        "safety_margin": 0.05,
    },
    "agentic": {
        "system_prompt": 0.10,
        "tool_definitions": 0.20,
        "retrieved_context": 0.15,
        "conversation_history": 0.35,
        "user_message": 0.10,
        "safety_margin": 0.10,
    },
}

def get_budget(task_type: str, window_size: int, output_reserve: int) -> dict[str, int]:
    """Get token budgets for a specific task type and window size."""
    profile = TASK_PROFILES[task_type]
    effective = window_size - output_reserve
    return {k: int(v * effective) for k, v in profile.items()}
```

The TypeScript equivalent for a production application:

```typescript
type TaskType = "conversational" | "document_qa" | "code_generation" | "agentic";

interface BudgetAllocation {
  systemPrompt: number;
  toolDefinitions: number;
  retrievedContext: number;
  conversationHistory: number;
  userMessage: number;
  safetyMargin: number;
}

const TASK_PROFILES: Record<TaskType, Record<keyof BudgetAllocation, number>> = {
  conversational: {
    systemPrompt: 0.08,
    toolDefinitions: 0.05,
    retrievedContext: 0.15,
    conversationHistory: 0.55,
    userMessage: 0.12,
    safetyMargin: 0.05,
  },
  document_qa: {
    systemPrompt: 0.05,
    toolDefinitions: 0.02,
    retrievedContext: 0.70,
    conversationHistory: 0.05,
    userMessage: 0.13,
    safetyMargin: 0.05,
  },
  code_generation: {
    systemPrompt: 0.15,
    toolDefinitions: 0.10,
    retrievedContext: 0.40,
    conversationHistory: 0.15,
    userMessage: 0.15,
    safetyMargin: 0.05,
  },
  agentic: {
    systemPrompt: 0.10,
    toolDefinitions: 0.20,
    retrievedContext: 0.15,
    conversationHistory: 0.35,
    userMessage: 0.10,
    safetyMargin: 0.10,
  },
};

function allocateBudget(
  taskType: TaskType,
  windowSize: number,
  outputReserve: number
): BudgetAllocation {
  const profile = TASK_PROFILES[taskType];
  const effective = windowSize - outputReserve;
  return Object.fromEntries(
    Object.entries(profile).map(([k, v]) => [k, Math.floor(v * effective)])
  ) as BudgetAllocation;
}
```

## The Lost-in-the-Middle Effect

### The Research

**Liu et al. (2023)** published "Lost in the Middle: How Language Models Use Long Contexts," one of the most consequential findings for context window management. The paper demonstrated that language models exhibit a strong U-shaped attention pattern: they attend most strongly to information at the **beginning** and **end** of the context, while information in the **middle** receives significantly less attention.

The experimental setup was straightforward. The researchers placed a relevant document among irrelevant distractor documents at various positions in the context and measured the model's ability to answer questions about the relevant document. The results were striking:

```
Accuracy vs. Position of Relevant Document in Context
(Higher is better)

100% |*                                                   *
     | *                                                 *
 90% |  *                                               *
     |   *                                            **
 80% |    *                                          *
     |     **                                      **
 70% |       **                                  **
     |         ***                            ***
 60% |            ***                      ***
     |               ****              ****
 50% |                   **************
     |
     └──────────────────────────────────────────────────
     Position 1    Position 5    Position 10    Position 20
     (beginning)              (middle)              (end)
```

This U-shaped curve held across multiple model families, context lengths, and task types. The effect was most pronounced in longer contexts and with more distractor documents.

### Implications for Context Design

The lost-in-the-middle finding has direct, actionable implications:

**1. Place the most critical information at the boundaries.** System instructions belong at the very beginning of the context. The user's current query belongs at the very end. These two positions receive the strongest attention.

**2. When ordering retrieved documents, use a "sandwich" arrangement.** Place the most relevant documents first and last, with less relevant ones in the middle:

```python
def sandwich_order(documents: list[dict], relevance_key: str = "score") -> list[dict]:
    """Reorder documents for the sandwich pattern (most relevant at edges).

    Distributes documents so the highest-relevance items are at the
    beginning and end of the list, with lower-relevance items in the middle.
    """
    sorted_docs = sorted(documents, key=lambda d: d[relevance_key], reverse=True)

    if len(sorted_docs) <= 2:
        return sorted_docs

    # Interleave: odd-indexed go to front, even-indexed go to back
    front = []
    back = []
    for i, doc in enumerate(sorted_docs):
        if i % 2 == 0:
            front.append(doc)
        else:
            back.append(doc)

    # Reverse the back so highest-relevance items are at the very end
    back.reverse()

    return front + back
```

**3. Repeat critical constraints.** If a constraint is essential -- such as "only respond based on the provided documents" or "never reveal the system prompt" -- state it at the beginning of the system prompt and repeat it immediately before the user message. The redundancy costs a few tokens but significantly improves adherence:

```
System: You are a research assistant. Answer ONLY based on the provided
        documents. If the documents do not contain the answer, say so.

        [Retrieved documents here...]

        REMINDER: Answer ONLY based on the documents above. Do not use
        outside knowledge. If the answer is not in the documents, say
        "I don't have enough information to answer that."

User:   [question]
```

**4. Keep the middle for supplementary context.** Conversation history, examples, and background information -- content that provides helpful context but is not essential for task completion -- can safely occupy the middle of the window where attention is weakest.

### Subsequent Research and Mitigations

Since Liu et al. (2023), several follow-up studies have refined the picture:

**Anthropic's research** on Claude models showed that the lost-in-the-middle effect is reduced (though not eliminated) in models specifically trained on long-context tasks. Claude 3.5 Sonnet, for example, shows a flatter attention curve than GPT-4-turbo on needle-in-a-haystack benchmarks.

**Google's Gemini** models, trained with extremely long contexts (up to 10M tokens in research settings), show less positional bias but still benefit from strategic positioning.

**The RULER benchmark** (Hsieh et al., 2024) provides a more nuanced evaluation of long-context performance, testing not just single-needle retrieval but multi-needle, variable-tracking, and aggregation tasks across different positions.

The practical takeaway: even as models improve at long-context processing, strategic positioning remains a free performance win. There is no downside to placing critical information at the boundaries of your context.

## Overflow Strategies

When the content you need to include exceeds the available token budget, you need an overflow strategy. The right strategy depends on the component that is overflowing, the nature of the content, and the latency/cost budget of your application.

### Strategy 1: Truncation

The simplest overflow strategy. Remove content that does not fit. The question is *what* to remove.

**FIFO (First In, First Out) truncation** removes the oldest content. Most commonly applied to conversation history -- when the history exceeds its budget, drop the earliest turns:

```python
def truncate_fifo(
    messages: list[dict],
    max_tokens: int,
    count_fn: callable,
    preserve_system: bool = True,
) -> list[dict]:
    """Truncate conversation history FIFO, keeping most recent messages.

    Optionally preserves the system message regardless of age.
    """
    if preserve_system:
        system_msgs = [m for m in messages if m["role"] == "system"]
        other_msgs = [m for m in messages if m["role"] != "system"]
        system_tokens = sum(count_fn(m["content"]) for m in system_msgs)
        remaining_budget = max_tokens - system_tokens
    else:
        system_msgs = []
        other_msgs = messages
        remaining_budget = max_tokens

    # Walk backwards from most recent, accumulating messages
    kept = []
    used = 0
    for msg in reversed(other_msgs):
        msg_tokens = count_fn(msg["content"])
        if used + msg_tokens > remaining_budget:
            break
        kept.append(msg)
        used += msg_tokens

    kept.reverse()
    return system_msgs + kept
```

**LIFO (Last In, First Out) truncation** removes the newest content. Rarely used for conversation history but occasionally useful for retrieved context when you want to keep the most relevant (first-retrieved) results and drop the tail:

```python
def truncate_lifo(
    documents: list[str],
    max_tokens: int,
    count_fn: callable,
) -> list[str]:
    """Keep documents from the beginning, drop from the end."""
    kept = []
    used = 0
    for doc in documents:
        doc_tokens = count_fn(doc)
        if used + doc_tokens > max_tokens:
            break
        kept.append(doc)
        used += doc_tokens
    return kept
```

**Priority-based truncation** assigns a priority to each content unit and removes lowest-priority content first. This is the most flexible approach and works well when you have metadata about content importance:

```python
from dataclasses import dataclass, field
from typing import Any

@dataclass
class ContextBlock:
    content: str
    tokens: int
    priority: float  # higher = more important
    category: str    # for logging/debugging
    metadata: dict = field(default_factory=dict)

def truncate_by_priority(
    blocks: list[ContextBlock],
    max_tokens: int,
    protected_categories: set[str] | None = None,
) -> list[ContextBlock]:
    """Truncate by removing lowest-priority blocks first.

    Protected categories are never removed (e.g., system prompt, user message).
    """
    protected_categories = protected_categories or {"system_prompt", "user_message"}

    protected = [b for b in blocks if b.category in protected_categories]
    removable = [b for b in blocks if b.category not in protected_categories]

    protected_tokens = sum(b.tokens for b in protected)
    remaining_budget = max_tokens - protected_tokens

    # Sort removable blocks by priority (highest first)
    removable.sort(key=lambda b: b.priority, reverse=True)

    kept = []
    used = 0
    for block in removable:
        if used + block.tokens <= remaining_budget:
            kept.append(block)
            used += block.tokens

    # Reconstruct in original order
    all_blocks = protected + kept
    original_order = {id(b): i for i, b in enumerate(blocks)}
    all_blocks.sort(key=lambda b: original_order.get(id(b), float("inf")))

    return all_blocks
```

### Strategy 2: Sliding Window

A sliding window maintains a fixed-size view over a growing sequence, typically conversation history. As new messages arrive, old messages slide out. This differs from simple FIFO truncation in that the window can be designed to preserve specific structural properties:

```python
class SlidingWindowHistory:
    """Sliding window over conversation history with structural guarantees."""

    def __init__(
        self,
        max_tokens: int,
        count_fn: callable,
        preserve_first_n: int = 2,  # always keep the first N messages (context setting)
        preserve_pairs: bool = True,  # never break user/assistant pairs
    ):
        self.max_tokens = max_tokens
        self.count_fn = count_fn
        self.preserve_first_n = preserve_first_n
        self.preserve_pairs = preserve_pairs
        self.messages: list[dict] = []

    def add(self, message: dict) -> None:
        self.messages.append(message)
        self._enforce_window()

    def _enforce_window(self) -> None:
        """Slide the window to fit within budget."""
        total = sum(self.count_fn(m["content"]) for m in self.messages)

        if total <= self.max_tokens:
            return

        # Protected: first N messages
        protected_head = self.messages[:self.preserve_first_n]
        slidable = self.messages[self.preserve_first_n:]

        protected_tokens = sum(self.count_fn(m["content"]) for m in protected_head)
        remaining = self.max_tokens - protected_tokens

        # Remove from the beginning of the slidable portion
        while slidable and sum(self.count_fn(m["content"]) for m in slidable) > remaining:
            if self.preserve_pairs and len(slidable) >= 2:
                # Remove a user/assistant pair together
                if slidable[0]["role"] == "user" and slidable[1]["role"] == "assistant":
                    slidable = slidable[2:]
                else:
                    slidable = slidable[1:]
            else:
                slidable = slidable[1:]

        self.messages = protected_head + slidable

    def get_messages(self) -> list[dict]:
        return list(self.messages)
```

The TypeScript equivalent:

```typescript
interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
}

class SlidingWindowHistory {
  private messages: Message[] = [];

  constructor(
    private maxTokens: number,
    private countFn: (text: string) => number,
    private preserveFirstN: number = 2,
  ) {}

  add(message: Message): void {
    this.messages.push(message);
    this.enforceWindow();
  }

  private enforceWindow(): void {
    const total = this.messages.reduce(
      (sum, m) => sum + this.countFn(m.content), 0
    );

    if (total <= this.maxTokens) return;

    const protectedHead = this.messages.slice(0, this.preserveFirstN);
    let slidable = this.messages.slice(this.preserveFirstN);

    const protectedTokens = protectedHead.reduce(
      (sum, m) => sum + this.countFn(m.content), 0
    );
    const remaining = this.maxTokens - protectedTokens;

    while (
      slidable.length > 0 &&
      slidable.reduce((sum, m) => sum + this.countFn(m.content), 0) > remaining
    ) {
      // Remove pairs to maintain conversation coherence
      if (
        slidable.length >= 2 &&
        slidable[0].role === "user" &&
        slidable[1].role === "assistant"
      ) {
        slidable = slidable.slice(2);
      } else {
        slidable = slidable.slice(1);
      }
    }

    this.messages = [...protectedHead, ...slidable];
  }

  getMessages(): Message[] {
    return [...this.messages];
  }
}
```

### Strategy 3: Summarization-Based Compression

When truncation loses too much information, summarization can compress content while preserving key facts. The trade-off is latency and cost -- you need an LLM call (or a smaller summarization model) to produce the summary.

**Progressive summarization** summarizes conversation history as it grows, maintaining a running summary of older turns while keeping recent turns verbatim:

```python
class ProgressiveSummarizer:
    """Maintains a progressively summarized conversation history.

    Structure:
      [System prompt]
      [Running summary of old turns]  <-- compressed
      [Recent N turns verbatim]       <-- full fidelity
      [Current user message]
    """

    def __init__(
        self,
        llm_client,
        count_fn: callable,
        history_budget: int = 6_000,
        recent_turns_to_keep: int = 6,
        summary_budget: int = 800,
    ):
        self.llm = llm_client
        self.count_fn = count_fn
        self.history_budget = history_budget
        self.recent_turns = recent_turns_to_keep
        self.summary_budget = summary_budget
        self.running_summary: str = ""
        self.messages: list[dict] = []

    def add_message(self, message: dict) -> None:
        self.messages.append(message)
        self._maybe_compress()

    def _maybe_compress(self) -> None:
        """Compress history when it exceeds budget."""
        total = self.count_fn(self.running_summary) + sum(
            self.count_fn(m["content"]) for m in self.messages
        )

        if total <= self.history_budget:
            return

        # Keep the last N turns verbatim
        recent = self.messages[-self.recent_turns:]
        to_summarize = self.messages[:-self.recent_turns]

        if not to_summarize:
            return

        # Build text to summarize (old summary + turns being compressed)
        text_to_compress = ""
        if self.running_summary:
            text_to_compress += f"Previous summary: {self.running_summary}\n\n"
        text_to_compress += "New turns to incorporate:\n"
        for msg in to_summarize:
            text_to_compress += f"{msg['role']}: {msg['content']}\n"

        # Summarize with the LLM
        self.running_summary = self._summarize(text_to_compress)
        self.messages = recent

    def _summarize(self, text: str) -> str:
        """Produce a concise summary of conversation history."""
        response = self.llm.chat.completions.create(
            model="gpt-4o-mini",  # cheap model for summarization
            messages=[{
                "role": "system",
                "content": (
                    "Summarize the following conversation history concisely. "
                    "Preserve: key decisions, user preferences, important facts, "
                    "and any commitments or action items. "
                    f"Keep the summary under {self.summary_budget} tokens."
                ),
            }, {
                "role": "user",
                "content": text,
            }],
            max_tokens=self.summary_budget,
        )
        return response.choices[0].message.content

    def get_context(self) -> list[dict]:
        """Return the compressed history for inclusion in context."""
        result = []
        if self.running_summary:
            result.append({
                "role": "system",
                "content": f"[Conversation summary so far]: {self.running_summary}",
            })
        result.extend(self.messages)
        return result
```

**Hierarchical summarization** extends this pattern by maintaining summaries at multiple granularities -- a high-level session summary, a mid-level topic summary, and verbatim recent turns. This is particularly useful for long-running agent sessions. See [Memory Architectures](/agent-memory) for a deeper treatment of persistent memory patterns.

### Strategy 4: Semantic Compression

Beyond summarization, there are techniques that compress context without full LLM-based rewriting:

**Extractive compression** identifies and keeps only the most relevant sentences from a larger body of text:

```python
from sentence_transformers import SentenceTransformer
import numpy as np

class ExtractiveCompressor:
    """Compress documents by extracting the most query-relevant sentences."""

    def __init__(self, model_name: str = "all-MiniLM-L6-v2"):
        self.model = SentenceTransformer(model_name)

    def compress(
        self,
        document: str,
        query: str,
        target_tokens: int,
        count_fn: callable,
    ) -> str:
        """Extract the most relevant sentences to fit within a token budget."""
        sentences = self._split_sentences(document)

        if not sentences:
            return document

        # Embed query and all sentences
        query_emb = self.model.encode([query])
        sent_embs = self.model.encode(sentences)

        # Score by cosine similarity to query
        similarities = np.dot(sent_embs, query_emb.T).flatten()

        # Rank sentences and greedily select top ones within budget
        ranked_indices = np.argsort(similarities)[::-1]

        selected = []
        used_tokens = 0
        for idx in ranked_indices:
            sent = sentences[idx]
            sent_tokens = count_fn(sent)
            if used_tokens + sent_tokens > target_tokens:
                continue
            selected.append((idx, sent))  # preserve original order
            used_tokens += sent_tokens

        # Return sentences in their original document order
        selected.sort(key=lambda x: x[0])
        return " ".join(sent for _, sent in selected)

    def _split_sentences(self, text: str) -> list[str]:
        """Simple sentence splitting. Use spaCy or nltk for production."""
        import re
        return [s.strip() for s in re.split(r'(?<=[.!?])\s+', text) if s.strip()]
```

**Prompt compression** techniques like LLMLingua (Jiang et al., 2023) use a small language model to identify and remove tokens that contribute least to the prompt's meaning, achieving 2-5x compression with minimal quality loss. The approach scores each token by its perplexity contribution and removes low-information tokens:

```
Original (48 tokens):
"The quarterly earnings report for Q3 2025 shows that the company's
revenue increased by 15% compared to the previous quarter, reaching
a total of $2.3 billion, which exceeded analyst expectations by
approximately 3 percentage points."

Compressed (22 tokens):
"Q3 2025 earnings: revenue increased 15% quarter-over-quarter,
reaching $2.3 billion, exceeding expectations by 3 points."
```

This is a lossy compression -- some nuance is lost -- but for context that is supplementary rather than primary, the trade-off is often worthwhile.

## Practical Patterns

### Token Counting Middleware

In production systems, token counting should be a middleware concern rather than something each component handles individually. A middleware layer counts tokens at each stage of context assembly and enforces budgets:

```python
from dataclasses import dataclass, field
from typing import Callable
import time

@dataclass
class TokenMetrics:
    component: str
    input_tokens: int
    output_tokens: int  # after any truncation/compression
    budget: int
    truncated: bool
    timestamp: float = field(default_factory=time.time)

class TokenBudgetMiddleware:
    """Middleware that enforces token budgets during context assembly."""

    def __init__(
        self,
        count_fn: Callable[[str], int],
        total_budget: int,
        output_reserve: int,
        logger=None,
    ):
        self.count_fn = count_fn
        self.total_budget = total_budget
        self.output_reserve = output_reserve
        self.effective_budget = total_budget - output_reserve
        self.logger = logger
        self.metrics: list[TokenMetrics] = []
        self.used: int = 0

    def add_component(
        self,
        name: str,
        content: str,
        budget: int,
        truncate_fn: Callable[[str, int], str] | None = None,
    ) -> str:
        """Add a component to the context, enforcing its budget.

        Returns the (possibly truncated) content.
        """
        actual_tokens = self.count_fn(content)

        # Enforce component-level budget
        effective_budget = min(budget, self.effective_budget - self.used)

        if actual_tokens <= effective_budget:
            # Fits within budget
            self.used += actual_tokens
            self.metrics.append(TokenMetrics(
                component=name,
                input_tokens=actual_tokens,
                output_tokens=actual_tokens,
                budget=effective_budget,
                truncated=False,
            ))
            return content

        # Exceeds budget -- truncate if possible
        if truncate_fn:
            truncated = truncate_fn(content, effective_budget)
            truncated_tokens = self.count_fn(truncated)
            self.used += truncated_tokens
            self.metrics.append(TokenMetrics(
                component=name,
                input_tokens=actual_tokens,
                output_tokens=truncated_tokens,
                budget=effective_budget,
                truncated=True,
            ))
            if self.logger:
                self.logger.warning(
                    f"Token budget exceeded for {name}: "
                    f"{actual_tokens} -> {truncated_tokens} "
                    f"(budget: {effective_budget})"
                )
            return truncated

        # No truncation function -- include as-is but log warning
        self.used += actual_tokens
        self.metrics.append(TokenMetrics(
            component=name,
            input_tokens=actual_tokens,
            output_tokens=actual_tokens,
            budget=effective_budget,
            truncated=False,
        ))
        if self.logger:
            self.logger.error(
                f"Component {name} exceeds budget ({actual_tokens} > {effective_budget}) "
                f"and no truncation function provided"
            )
        return content

    def remaining(self) -> int:
        return self.effective_budget - self.used

    def utilization(self) -> float:
        return self.used / self.effective_budget

    def report(self) -> dict:
        return {
            "total_budget": self.total_budget,
            "output_reserve": self.output_reserve,
            "effective_budget": self.effective_budget,
            "used": self.used,
            "remaining": self.remaining(),
            "utilization": f"{self.utilization():.1%}",
            "components": [
                {
                    "name": m.component,
                    "input_tokens": m.input_tokens,
                    "output_tokens": m.output_tokens,
                    "budget": m.budget,
                    "truncated": m.truncated,
                }
                for m in self.metrics
            ],
        }
```

Usage:

```python
import tiktoken

enc = tiktoken.encoding_for_model("gpt-4o")
count = lambda text: len(enc.encode(text))

middleware = TokenBudgetMiddleware(
    count_fn=count,
    total_budget=128_000,
    output_reserve=4_096,
    logger=logging.getLogger("context"),
)

# System prompt -- no truncation (fail-safe: it must fit)
system = middleware.add_component("system_prompt", system_prompt_text, budget=2_000)

# Tools -- no truncation (schemas must be complete)
tools = middleware.add_component("tool_definitions", tool_schemas_text, budget=3_000)

# Retrieved context -- truncate by dropping lowest-relevance chunks
retrieved = middleware.add_component(
    "retrieved_context",
    retrieved_text,
    budget=8_000,
    truncate_fn=lambda text, budget: truncate_chunks_by_relevance(text, budget, count),
)

# Conversation history -- truncate FIFO
history = middleware.add_component(
    "conversation_history",
    history_text,
    budget=middleware.remaining() - 2_000,  # leave room for user message
    truncate_fn=lambda text, budget: truncate_history_fifo(text, budget, count),
)

# User message -- never truncate
user = middleware.add_component("user_message", user_message, budget=middleware.remaining())

print(middleware.report())
```

### Budget Enforcement in TypeScript

For TypeScript applications, particularly those using the Vercel AI SDK or similar frameworks, budget enforcement can be integrated into the message assembly pipeline:

```typescript
import { encodingForModel } from "js-tiktoken";

interface ContextComponent {
  name: string;
  content: string;
  budget: number;
  priority: number; // higher = harder to cut
  truncatable: boolean;
}

interface AssembledContext {
  messages: Array<{ role: string; content: string }>;
  metrics: {
    totalTokens: number;
    budget: number;
    utilization: number;
    truncatedComponents: string[];
  };
}

class ContextAssembler {
  private encoding;

  constructor(
    private modelWindowSize: number,
    private outputReserve: number,
    model: string = "gpt-4o",
  ) {
    this.encoding = encodingForModel(
      model as Parameters<typeof encodingForModel>[0]
    );
  }

  private countTokens(text: string): number {
    return this.encoding.encode(text).length;
  }

  assemble(components: ContextComponent[]): AssembledContext {
    const effectiveBudget = this.modelWindowSize - this.outputReserve;
    const truncated: string[] = [];

    // Sort by priority (lowest first -- these get cut first)
    const sorted = [...components].sort((a, b) => a.priority - b.priority);

    // First pass: measure everything
    const measured = sorted.map((c) => ({
      ...c,
      tokens: this.countTokens(c.content),
    }));

    // Calculate total demand
    const totalDemand = measured.reduce((sum, c) => sum + c.tokens, 0);

    if (totalDemand <= effectiveBudget) {
      // Everything fits -- return in original order
      const messages = components.map((c) => ({
        role: c.name === "user_message" ? "user" : "system",
        content: c.content,
      }));
      return {
        messages,
        metrics: {
          totalTokens: totalDemand,
          budget: effectiveBudget,
          utilization: totalDemand / effectiveBudget,
          truncatedComponents: [],
        },
      };
    }

    // Need to cut. Remove from lowest-priority truncatable components
    let excess = totalDemand - effectiveBudget;
    for (const component of measured) {
      if (excess <= 0) break;
      if (!component.truncatable) continue;

      const maxCut = component.tokens - Math.floor(component.budget * 0.1);
      const actualCut = Math.min(maxCut, excess);

      if (actualCut > 0) {
        const targetTokens = component.tokens - actualCut;
        component.content = this.truncateToTokens(
          component.content,
          targetTokens
        );
        component.tokens = targetTokens;
        excess -= actualCut;
        truncated.push(component.name);
      }
    }

    // Reconstruct in original order
    const nameToContent = new Map(measured.map((c) => [c.name, c.content]));
    const messages = components.map((c) => ({
      role: c.name === "user_message" ? "user" : "system",
      content: nameToContent.get(c.name) ?? c.content,
    }));

    const finalTokens = measured.reduce((sum, c) => sum + c.tokens, 0);

    return {
      messages,
      metrics: {
        totalTokens: finalTokens,
        budget: effectiveBudget,
        utilization: finalTokens / effectiveBudget,
        truncatedComponents: truncated,
      },
    };
  }

  private truncateToTokens(text: string, maxTokens: number): string {
    const tokens = this.encoding.encode(text);
    if (tokens.length <= maxTokens) return text;
    const truncatedTokens = tokens.slice(0, maxTokens);
    return this.encoding.decode(truncatedTokens);
  }

  dispose(): void {
    this.encoding.free();
  }
}
```

### Caching Token Counts

Token counting is not free. For large contexts or high-throughput systems, caching token counts avoids redundant computation:

```python
from functools import lru_cache
import hashlib

class CachedTokenCounter:
    """Token counter with LRU cache for repeated content."""

    def __init__(self, model: str = "gpt-4o", cache_size: int = 4096):
        self.encoding = tiktoken.encoding_for_model(model)
        self._count_cached = lru_cache(maxsize=cache_size)(self._count_impl)

    def _count_impl(self, content_hash: str, content: str) -> int:
        return len(self.encoding.encode(content))

    def count(self, content: str) -> int:
        # Hash the content for cache key (handles long strings efficiently)
        content_hash = hashlib.sha256(content.encode()).hexdigest()[:16]
        return self._count_cached(content_hash, content)

    def count_messages(self, messages: list[dict]) -> int:
        total = 0
        for msg in messages:
            total += 4  # message framing
            total += self.count(msg.get("content", ""))
            total += self.count(msg.get("role", ""))
        total += 2  # assistant priming
        return total
```

For system prompts and tool definitions that do not change between requests, the count can be computed once at startup and reused:

```python
class StaticContextRegistry:
    """Pre-compute and cache token counts for static context components."""

    def __init__(self, count_fn: callable):
        self.count_fn = count_fn
        self._registry: dict[str, tuple[str, int]] = {}

    def register(self, name: str, content: str) -> None:
        """Register a static context component and cache its token count."""
        tokens = self.count_fn(content)
        self._registry[name] = (content, tokens)

    def get(self, name: str) -> tuple[str, int]:
        """Get content and cached token count."""
        return self._registry[name]

    def total_static_tokens(self) -> int:
        """Total tokens consumed by all static components."""
        return sum(tokens for _, tokens in self._registry.values())

    def remaining_budget(self, total_budget: int, output_reserve: int) -> int:
        """How many tokens remain for dynamic content."""
        return total_budget - output_reserve - self.total_static_tokens()
```

### Dynamic Allocation Based on Task Type

Production systems often serve multiple task types through a single endpoint. A request classifier can determine the task type and apply the appropriate budget profile:

```python
class AdaptiveContextManager:
    """Manages context with task-adaptive budget allocation."""

    TASK_PROFILES = {
        "simple_qa": {
            "system_prompt": 0.08,
            "tools": 0.02,
            "retrieval": 0.60,
            "history": 0.10,
            "user": 0.15,
            "margin": 0.05,
        },
        "multi_turn_conversation": {
            "system_prompt": 0.08,
            "tools": 0.05,
            "retrieval": 0.15,
            "history": 0.55,
            "user": 0.12,
            "margin": 0.05,
        },
        "tool_heavy_agent": {
            "system_prompt": 0.10,
            "tools": 0.25,
            "retrieval": 0.10,
            "history": 0.35,
            "user": 0.10,
            "margin": 0.10,
        },
        "long_document_analysis": {
            "system_prompt": 0.03,
            "tools": 0.02,
            "retrieval": 0.75,
            "history": 0.05,
            "user": 0.10,
            "margin": 0.05,
        },
    }

    def __init__(self, model_window: int, output_reserve: int, count_fn: callable):
        self.model_window = model_window
        self.output_reserve = output_reserve
        self.effective = model_window - output_reserve
        self.count_fn = count_fn

    def classify_task(self, messages: list[dict], tools: list | None) -> str:
        """Classify the task type from the request shape."""
        has_tools = bool(tools and len(tools) > 5)
        history_length = len([m for m in messages if m["role"] != "system"])

        # Simple heuristics -- replace with a classifier in production
        if has_tools and history_length > 4:
            return "tool_heavy_agent"
        if history_length > 10:
            return "multi_turn_conversation"

        # Check if there is a large document in the messages
        max_msg_tokens = max(
            (self.count_fn(m["content"]) for m in messages if m["role"] == "user"),
            default=0,
        )
        if max_msg_tokens > 2000:
            return "long_document_analysis"

        return "simple_qa"

    def get_budgets(self, task_type: str) -> dict[str, int]:
        profile = self.TASK_PROFILES[task_type]
        return {k: int(v * self.effective) for k, v in profile.items()}
```

## Advanced Topics

### Prompt Caching and Budget Strategy

Major providers now offer prompt caching (Anthropic's cache control, OpenAI's automatic caching, Google's context caching). This changes the cost calculus of context management significantly. Cached tokens are typically 75-90% cheaper than uncached tokens, which means the cost penalty for including more static context is dramatically reduced.

The architectural implication: structure your context so that the static prefix (system prompt + tool definitions) is as long and stable as possible. Dynamic content (retrieved docs, history, user message) should come after the cached prefix.

```
┌────────────────────────────────────────────────────────┐
│  CACHED PREFIX (static between requests)               │
│  ┌──────────────────────────────────────────────────┐  │
│  │ System prompt                                     │  │
│  │ Tool definitions                                  │  │
│  │ Static knowledge/instructions                     │  │
│  │ Few-shot examples (if stable)                     │  │
│  └──────────────────────────────────────────────────┘  │
│  DYNAMIC SUFFIX (changes per request)                  │
│  ┌──────────────────────────────────────────────────┐  │
│  │ Retrieved context                                 │  │
│  │ Conversation history                              │  │
│  │ User message                                      │  │
│  └──────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────┘
```

With caching, you might choose to include a more comprehensive system prompt (2000 tokens instead of 800) because the marginal cost of those extra cached tokens is negligible, while the marginal quality improvement from better instructions is meaningful.

### Multi-Model Budget Strategies

Production systems that route between models of different context window sizes need model-aware budget management:

```python
MODEL_SPECS = {
    "gpt-4o": {"window": 128_000, "output_max": 16_384, "cost_per_1k_input": 0.0025},
    "gpt-4o-mini": {"window": 128_000, "output_max": 16_384, "cost_per_1k_input": 0.00015},
    "claude-sonnet-4-20250514": {"window": 200_000, "output_max": 8_192, "cost_per_1k_input": 0.003},
    "claude-haiku-3-5": {"window": 200_000, "output_max": 8_192, "cost_per_1k_input": 0.0008},
    "gemini-2.0-flash": {"window": 1_000_000, "output_max": 8_192, "cost_per_1k_input": 0.0001},
}

def select_model_for_context(
    required_input_tokens: int,
    required_output_tokens: int,
    quality_requirement: str = "standard",
) -> str:
    """Select the cheapest model that fits the context requirements."""
    candidates = []

    for model, spec in MODEL_SPECS.items():
        effective_input = spec["window"] - min(required_output_tokens, spec["output_max"])
        if required_input_tokens > effective_input:
            continue
        if quality_requirement == "high" and "mini" in model:
            continue
        candidates.append((model, spec["cost_per_1k_input"] * required_input_tokens / 1000))

    if not candidates:
        raise ValueError(
            f"No model can fit {required_input_tokens} input + "
            f"{required_output_tokens} output tokens"
        )

    # Return cheapest viable model
    return min(candidates, key=lambda x: x[1])[0]
```

### Handling Tool-Use Loops

Agentic systems with tool use present a unique context management challenge. Each tool call-and-response cycle adds messages to the history, and a single complex task might involve 10-30 tool calls. The context grows rapidly:

```
Turn 1: User message                          ~200 tokens
Turn 2: Assistant (tool call)                  ~100 tokens
Turn 3: Tool result                            ~500 tokens
Turn 4: Assistant (tool call)                  ~100 tokens
Turn 5: Tool result                            ~800 tokens
...
Turn 20: Assistant (tool call)                 ~100 tokens
Turn 21: Tool result                           ~1200 tokens
Turn 22: Assistant (final response)            ~500 tokens

Total accumulated: ~8,000-15,000 tokens for a single task
```

Strategies for managing tool-use context:

**1. Summarize completed tool sequences.** Once a tool call has been processed and its result incorporated into the assistant's reasoning, the raw tool call and result can be summarized:

```python
def compress_tool_history(
    messages: list[dict],
    count_fn: callable,
    budget: int,
) -> list[dict]:
    """Compress completed tool call sequences in conversation history."""
    compressed = []
    i = 0

    while i < len(messages):
        msg = messages[i]

        # Detect a tool-call sequence: assistant(tool_call) -> tool(result) -> ...
        if (
            msg["role"] == "assistant"
            and i + 1 < len(messages)
            and messages[i + 1]["role"] == "tool"
        ):
            # Collect the entire tool sequence
            sequence = [msg]
            j = i + 1
            while j < len(messages) and messages[j]["role"] == "tool":
                sequence.append(messages[j])
                j += 1

            # Summarize if the sequence is large
            sequence_tokens = sum(count_fn(m["content"]) for m in sequence)
            if sequence_tokens > 500:
                summary = summarize_tool_sequence(sequence)
                compressed.append({
                    "role": "system",
                    "content": f"[Tool use summary]: {summary}",
                })
            else:
                compressed.extend(sequence)

            i = j
        else:
            compressed.append(msg)
            i += 1

    return compressed
```

**2. Limit tool result size.** Truncate tool results before they enter the context. A database query that returns 500 rows should be truncated to the first 20 with a note about the truncation:

```python
def truncate_tool_result(result: str, max_tokens: int, count_fn: callable) -> str:
    """Truncate a tool result to fit within a token budget."""
    actual = count_fn(result)
    if actual <= max_tokens:
        return result

    # For structured data (JSON, tables), try to preserve headers + first N items
    # For text, truncate with a marker
    truncated = result[:max_tokens * 4]  # rough char estimate
    while count_fn(truncated) > max_tokens - 20:
        truncated = truncated[:int(len(truncated) * 0.9)]

    return truncated + f"\n\n[Truncated: showing ~{count_fn(truncated)} of {actual} tokens]"
```

### Monitoring and Observability

Context window usage should be monitored in production, as covered in [Observability](/observability). Key metrics to track:

```python
# Metrics to emit on every LLM call
context_metrics = {
    # Budget utilization
    "context.total_tokens": total_input_tokens,
    "context.budget_utilization": total_input_tokens / effective_budget,
    "context.output_tokens": response_tokens,

    # Component breakdown
    "context.system_prompt_tokens": system_tokens,
    "context.tool_definition_tokens": tool_tokens,
    "context.retrieved_context_tokens": retrieval_tokens,
    "context.history_tokens": history_tokens,
    "context.user_message_tokens": user_tokens,

    # Overflow events
    "context.truncation_events": num_truncations,
    "context.summarization_events": num_summarizations,

    # Quality signals
    "context.retrieval_relevance_mean": mean_relevance_score,
    "context.history_turns_kept": turns_kept,
    "context.history_turns_dropped": turns_dropped,
}
```

Alert on:
- Budget utilization consistently above 90% (risk of truncation)
- Frequent truncation events (indicates the budget allocation needs retuning)
- Large variance in component token counts (unpredictable content sizes)
- Decreasing history turns kept (conversations getting too long for the window)

## Common Pitfalls

**1. Counting tokens after assembly, not before.** The time to discover that your context exceeds the window is during assembly, not when the API returns a 400 error. Always count tokens as you build the context, not after.

**2. Ignoring output token reservation.** The context window includes both input and output. If you fill 127K of a 128K window, the model has only 1K tokens for its response. For reasoning models, this is catastrophic -- they may need 10K-50K tokens for their chain-of-thought.

**3. Treating all content as equally important.** A system prompt instruction about safety is not equivalent to the 15th retrieved document. Priority-based truncation exists because content importance varies by orders of magnitude.

**4. Using character count as a token proxy.** The 4-characters-per-token heuristic breaks down for code, JSON, non-English text, and structured data. Always use the actual tokenizer for budget-critical decisions. Use character estimation only for rough planning.

**5. Forgetting message framing overhead.** A conversation with 50 short messages has 200+ overhead tokens from message framing alone. For agentic systems with many tool calls, this overhead adds up.

**6. Over-compressing conversation history.** Aggressive summarization can destroy information the model needs to maintain coherence. The user said "use the same format as before" -- but "before" was summarized away. Keep enough recent turns verbatim to support back-references.

**7. Not adapting to model differences.** The same text produces different token counts on different tokenizers. Moving from GPT-4 (cl100k_base) to GPT-4o (o200k_base) changes your token counts. Moving from OpenAI to Claude changes them further. Budget calculations must be model-aware.

## Connections to Other Topics

Context window management is a practical engineering discipline that intersects with several foundational topics in this series:

- **Tokenization mechanics** ([Tokenization](/tokenization)): Understanding how text becomes tokens is prerequisite to managing token budgets
- **Context assembly** ([Context Engineering](/context-engineering)): The broader discipline of designing what goes into the context window
- **Instruction design** ([Prompt Engineering Fundamentals](/prompt-engineering-fundamentals), [System Prompts](/system-prompts)): Static context that competes for token budget
- **Retrieval** ([Retrieval Strategies](/retrieval-strategies), [Chunking Strategies](/chunking-strategies)): Dynamic context that is the largest budget consumer in most RAG systems
- **Memory systems** ([Memory Architectures](/agent-memory)): Long-term context management across sessions, complementing the within-session strategies covered here
- **Cost management** ([Cost Optimization](/cost-optimization)): Token usage directly determines inference cost; budget management is cost management
- **Evaluation** ([Eval Fundamentals](/eval-fundamentals)): Measuring whether your context management strategy actually improves output quality
- **Agent design** ([Agent Architectures](/agent-architectures), [Function Calling](/function-calling)): Agentic systems face the most acute context management challenges due to tool-use loops
