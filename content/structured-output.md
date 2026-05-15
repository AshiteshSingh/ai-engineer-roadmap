# Structured Output: JSON Mode, Tool Schemas & Constrained Decoding

Extracting structured, machine-parseable output from large language models is one of the most practically important challenges in production AI engineering. While LLMs generate free-form text by default, applications need JSON objects, database records, API calls, and typed data structures. This article surveys the landscape of structured output techniques, from API-level JSON mode through schema-driven function calling to compiler-level constrained decoding, examining how each approach works, when to use it, and the reliability tradeoffs involved.

## The Structured Output Problem

Language models generate text token by token, sampling from a probability distribution over the vocabulary at each step. Nothing in this process inherently guarantees that the output will conform to any particular structure. When you ask a model to produce JSON, several things can go wrong:

- **Syntax errors**: Missing commas, unmatched brackets, trailing characters
- **Schema violations**: Wrong field names, incorrect types, missing required fields
- **Extra content**: Explanatory text before or after the JSON
- **Hallucinated fields**: Fields that look plausible but were not requested
- **Inconsistent formatting**: Mixing formats within a single response

Each of these failure modes has a different frequency and different mitigation strategies. The structured output techniques we examine here address them at different layers of the stack.

## JSON Mode: API-Level Guarantees

### How JSON Mode Works

JSON mode, offered by OpenAI (since November 2023), Anthropic, Google, and other providers, instructs the model to produce valid JSON as output. The implementation works by modifying the sampling process: at each token generation step, the model's logits are masked to exclude tokens that would result in invalid JSON.

This is a form of constrained decoding at the API level. When JSON mode is active:

1. The model generates tokens normally but with a bias toward JSON-compatible tokens
2. If the model attempts to generate a token that would create invalid JSON syntax, that token is suppressed
3. The generation continues until a valid JSON object is complete

```python
# OpenAI JSON mode
from openai import OpenAI
client = OpenAI()

response = client.chat.completions.create(
    model="gpt-4o",
    response_format={"type": "json_object"},
    messages=[
        {"role": "system", "content": "Extract entities. Return JSON."},
        {"role": "user", "content": "Apple Inc. reported $94B revenue."}
    ]
)

# Guaranteed to be valid JSON
data = json.loads(response.choices[0].message.content)
```

### JSON Mode Limitations

JSON mode guarantees syntactic validity but not semantic correctness. It ensures you get valid JSON, but it does not ensure:

- The JSON matches your expected schema
- Required fields are present
- Values are the correct types
- The structure is what you asked for

For example, with JSON mode active, the model might return `{"result": "Apple Inc., $94B"}` instead of the structured extraction you wanted. The JSON is valid, but the schema is wrong.

### Structured Outputs (Schema Enforcement)

OpenAI extended JSON mode with "Structured Outputs" (2024), which accepts a JSON Schema definition and guarantees the output conforms to it:

```python
from pydantic import BaseModel

class EntityExtraction(BaseModel):
    entities: list[Entity]
    raw_text: str

class Entity(BaseModel):
    text: str
    entity_type: str  # "PERSON", "ORG", "LOCATION"
    confidence: float

response = client.beta.chat.completions.parse(
    model="gpt-4o",
    response_format=EntityExtraction,
    messages=[
        {"role": "system", "content": "Extract named entities."},
        {"role": "user", "content": "Tim Cook leads Apple in Cupertino."}
    ]
)

# Guaranteed to match the EntityExtraction schema
result = response.choices[0].message.parsed
```

This approach uses the JSON Schema to constrain token generation at each step, ensuring that the output not only is valid JSON but also matches the specified structure. It represents the current gold standard for structured output reliability from closed API providers.

## Function Calling and Tool Schemas

### The Function Calling Paradigm

Function calling (introduced by OpenAI in June 2023, now supported by most providers) takes a different approach to structured output. Instead of asking the model to generate JSON directly, you define functions (tools) that the model can "call," and the model generates the structured arguments for those function calls.

```python
tools = [
    {
        "type": "function",
        "function": {
            "name": "extract_entities",
            "description": "Extract named entities from text",
            "parameters": {
                "type": "object",
                "properties": {
                    "entities": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "text": {"type": "string"},
                                "type": {
                                    "type": "string",
                                    "enum": ["PERSON", "ORG", "LOCATION"]
                                },
                                "confidence": {
                                    "type": "number",
                                    "minimum": 0,
                                    "maximum": 1
                                }
                            },
                            "required": ["text", "type", "confidence"]
                        }
                    }
                },
                "required": ["entities"]
            }
        }
    }
]

response = client.chat.completions.create(
    model="gpt-4o",
    tools=tools,
    tool_choice={"type": "function", "function": {"name": "extract_entities"}},
    messages=[{"role": "user", "content": "Tim Cook leads Apple in Cupertino."}]
)

# Parse the function call arguments
args = json.loads(
    response.choices[0].message.tool_calls[0].function.arguments
)
```

### Function Calling vs. JSON Mode

The distinction between function calling and JSON mode is often confusing. Here is how they differ:

**Function calling** is designed for agentic workflows where the model decides which action to take and provides the parameters. The model can choose among multiple tools, decide not to call any tool, or call multiple tools. The structured output is a byproduct of the tool-calling interface.

**JSON mode / Structured Outputs** is designed for extraction and formatting tasks where you always want structured output. There is no choice about whether to produce structure -- the model always returns the specified format.

In practice, function calling is often repurposed as a structured output mechanism by forcing a specific tool choice. This works but is semantically misleading and may not benefit from the same level of schema enforcement as dedicated structured output APIs.

### Multi-Tool Schemas

Production applications often define multiple tools, and the model selects the appropriate one based on the user's request:

```python
tools = [
    {
        "type": "function",
        "function": {
            "name": "search_knowledge_base",
            "description": "Search internal documentation",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                    "filters": {
                        "type": "object",
                        "properties": {
                            "category": {"type": "string"},
                            "date_range": {"type": "string"}
                        }
                    }
                },
                "required": ["query"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "create_ticket",
            "description": "Create a support ticket",
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "priority": {
                        "type": "string",
                        "enum": ["low", "medium", "high", "critical"]
                    },
                    "description": {"type": "string"}
                },
                "required": ["title", "priority", "description"]
            }
        }
    }
]
```

The quality of tool selection depends heavily on the function names and descriptions. Well-written descriptions that clearly explain when each tool should be used significantly improve routing accuracy.

## Pydantic and Zod Integration

### Pydantic for Python

Pydantic has become the de facto standard for defining structured output schemas in Python LLM applications. Libraries like Instructor (by Jason Liu) and LangChain provide first-class Pydantic integration:

```python
from pydantic import BaseModel, Field
from typing import Literal
import instructor

class SentimentAnalysis(BaseModel):
    """Analyze the sentiment of the given text."""
    sentiment: Literal["positive", "negative", "neutral"]
    confidence: float = Field(ge=0, le=1, description="Confidence score")
    reasoning: str = Field(description="Brief explanation of the sentiment")
    key_phrases: list[str] = Field(
        max_length=5,
        description="Phrases that most influenced the sentiment"
    )

client = instructor.from_openai(OpenAI())

result = client.chat.completions.create(
    model="gpt-4o",
    response_model=SentimentAnalysis,
    messages=[
        {"role": "user", "content": "The product works great but shipping was slow."}
    ]
)

# result is a validated SentimentAnalysis instance
print(result.sentiment)     # "positive"
print(result.confidence)    # 0.65
print(result.key_phrases)   # ["works great", "shipping was slow"]
```

Instructor handles the conversion from Pydantic model to JSON Schema, sends it to the API, parses the response, validates it against the Pydantic model, and retries if validation fails. This retry mechanism is important: even with JSON mode, models occasionally produce outputs that fail validation (e.g., a confidence score of 1.5 when the maximum is 1.0).

### Zod for TypeScript

Zod serves the same role in the TypeScript ecosystem:

```typescript
import { z } from "zod";
import { generateObject } from "ai";  // Vercel AI SDK

const SentimentSchema = z.object({
  sentiment: z.enum(["positive", "negative", "neutral"]),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
  key_phrases: z.array(z.string()).max(5),
});

const result = await generateObject({
  model: openai("gpt-4o"),
  schema: SentimentSchema,
  prompt: "Analyze: The product works great but shipping was slow.",
});

// result.object is typed and validated
console.log(result.object.sentiment);
```

The Vercel AI SDK's `generateObject` function uses Zod schemas to provide TypeScript-native structured output with full type inference, schema validation, and automatic retry.

### Schema Design Best Practices

Well-designed schemas improve both reliability and output quality:

**Use enums for categorical fields.** Instead of `type: string` for a category, use an enum with the valid options. This reduces hallucination and improves consistency.

**Add descriptions to every field.** Field descriptions function as mini-prompts, guiding the model on what each field should contain. Without descriptions, the model guesses based on field names alone.

**Use optional fields judiciously.** Required fields are extracted more reliably than optional ones. If a field is important, make it required with a sensible default rather than optional.

**Flatten deeply nested structures.** Models handle flat or shallowly nested schemas more reliably than deeply nested ones. If you need complex structure, consider decomposing into multiple extraction steps.

```python
# Prefer this (flat)
class ExtractedEvent(BaseModel):
    event_name: str
    event_date: str
    event_location: str
    organizer_name: str
    organizer_email: str

# Over this (deeply nested)
class ExtractedEvent(BaseModel):
    event: EventDetails
    organizer: OrganizerDetails
    metadata: EventMetadata
```

## Constrained Decoding: Grammar-Based Generation

### The Core Idea

Constrained decoding modifies the token sampling process to ensure that only tokens consistent with a predefined grammar are ever selected. Unlike JSON mode (which applies loose JSON constraints) or schema enforcement (which validates against a JSON Schema), constrained decoding can enforce arbitrary formal grammars -- context-free grammars, regular expressions, or custom constraint systems.

### Outlines

Outlines (Willard and Louf, 2023) is the most prominent open-source constrained decoding library. It works by precomputing a finite-state machine (FSM) from a regular expression or JSON Schema, then using this FSM to mask invalid tokens at each generation step:

```python
import outlines

model = outlines.models.transformers("mistralai/Mistral-7B-v0.1")

# Regex-based constraint
phone_generator = outlines.generate.regex(
    model, r"\(\d{3}\) \d{3}-\d{4}"
)
result = phone_generator("Generate a US phone number:")
# Always matches the pattern: (555) 123-4567

# JSON Schema constraint
schema = {
    "type": "object",
    "properties": {
        "name": {"type": "string"},
        "age": {"type": "integer", "minimum": 0, "maximum": 150},
        "occupation": {"type": "string"}
    },
    "required": ["name", "age"]
}

json_generator = outlines.generate.json(model, schema)
result = json_generator("Extract person info from: John is a 30-year-old engineer")
# Guaranteed to match the schema
```

The key innovation in Outlines is the precomputation step. By building the FSM before generation starts, the per-token overhead of constraint checking is minimal -- just a lookup in the FSM state transition table.

### Microsoft Guidance

Guidance (from Microsoft) takes a template-based approach to constrained generation, interleaving fixed text with generated text:

```python
from guidance import models, gen, select

model = models.Transformers("mistralai/Mistral-7B-v0.1")

program = model + f"""\
Analyze the sentiment of: "Great product, terrible shipping"

Sentiment: {select(["positive", "negative", "mixed"])}
Confidence: {gen(regex=r"0\.\d{2}", name="confidence")}
Reasoning: {gen(max_tokens=50, stop="\n", name="reasoning")}
"""

print(program["confidence"])  # "0.73"
print(program["reasoning"])   # Generated explanation
```

Guidance provides fine-grained control over which parts of the output are fixed and which are generated, with constraints on the generated parts. This is particularly useful for complex output formats that combine structured and unstructured elements.

### llama.cpp Grammar Support

For local inference with GGUF models, llama.cpp supports GBNF (GGML BNF) grammars that constrain generation at the C++ level:

```
# GBNF grammar for a simple JSON object
root   ::= "{" ws members ws "}"
members ::= pair ("," ws pair)*
pair    ::= string ws ":" ws value
string  ::= "\"" [a-zA-Z_][a-zA-Z0-9_]* "\""
value   ::= string | number | "true" | "false" | "null"
number  ::= [0-9]+ ("." [0-9]+)?
ws     ::= [ \t\n]*
```

This approach has zero Python overhead since constraints are enforced in the inference engine itself. For latency-sensitive applications using local models, GBNF grammars provide the most performant constrained decoding option.

## Reliable Structured Extraction Patterns

### The Retry Pattern

Even with the best constrained decoding, structured extraction can fail. The retry pattern adds robustness by attempting extraction multiple times with different strategies:

```python
import instructor
from tenacity import retry, stop_after_attempt, wait_exponential

client = instructor.from_openai(
    OpenAI(),
    max_retries=3  # Automatic retry with validation feedback
)

# Instructor automatically:
# 1. Sends the schema to the API
# 2. Parses the response
# 3. Validates against the Pydantic model
# 4. If validation fails, sends the error back to the model
#    as context for the retry
# 5. Repeats up to max_retries times
```

The key insight in Instructor's retry mechanism is that validation errors are sent back to the model as part of the retry prompt. This gives the model specific feedback about what went wrong, dramatically improving the success rate of subsequent attempts.

### The Decomposition Pattern

Complex extractions are more reliable when decomposed into multiple simpler extractions:

```python
# Instead of extracting everything at once:
class ComplexDocument(BaseModel):
    title: str
    authors: list[Author]
    abstract: str
    key_findings: list[Finding]
    methodology: Methodology
    references: list[Reference]

# Decompose into focused extractions:
class TitleAndAuthors(BaseModel):
    title: str
    authors: list[Author]

class AbstractAndFindings(BaseModel):
    abstract: str
    key_findings: list[Finding]

class MethodologyExtraction(BaseModel):
    methodology: Methodology

# Extract each separately, then combine
title_authors = extract(text, TitleAndAuthors)
abstract_findings = extract(text, AbstractAndFindings)
methodology = extract(text, MethodologyExtraction)

result = ComplexDocument(
    title=title_authors.title,
    authors=title_authors.authors,
    abstract=abstract_findings.abstract,
    key_findings=abstract_findings.key_findings,
    methodology=methodology.methodology,
    references=extract_references(text)  # Specialized extractor
)
```

Each focused extraction has a higher success rate than a single monolithic extraction, and failures in one component do not affect the others.

### The Validation Layer Pattern

Adding a post-extraction validation layer catches semantic errors that schema validation misses:

```python
from pydantic import BaseModel, field_validator, model_validator

class FinancialExtraction(BaseModel):
    company: str
    revenue: float
    expenses: float
    profit: float
    currency: str
    fiscal_year: int

    @field_validator("fiscal_year")
    @classmethod
    def validate_fiscal_year(cls, v):
        if v < 1900 or v > 2030:
            raise ValueError(f"Fiscal year {v} is out of range")
        return v

    @model_validator(mode="after")
    def validate_profit_calculation(self):
        expected_profit = self.revenue - self.expenses
        if abs(self.profit - expected_profit) > 0.01 * self.revenue:
            raise ValueError(
                f"Profit ({self.profit}) doesn't match "
                f"revenue ({self.revenue}) - expenses ({self.expenses})"
            )
        return self
```

Model validators catch logical inconsistencies (like profit not equaling revenue minus expenses) that no schema can enforce. When combined with Instructor's retry mechanism, these validators trigger automatic correction by the model.

### The Streaming Structured Output Pattern

For long extractions, streaming the structured output improves user experience:

```python
from instructor import from_openai
from openai import OpenAI

client = from_openai(OpenAI())

# Stream partial results
for partial in client.chat.completions.create_partial(
    model="gpt-4o",
    response_model=ArticleAnalysis,
    messages=[{"role": "user", "content": long_article}],
    stream=True,
):
    # partial is a partially-filled Pydantic model
    if partial.title:
        display_title(partial.title)
    if partial.key_points:
        display_points(partial.key_points)
```

Streaming structured output is more complex than streaming text because the output must remain valid at each intermediate step. Libraries like Instructor handle this by emitting partial Pydantic models that become more complete over time.

## Structured Output Latency and Performance

Structured output is not free. Every enforcement mechanism -- JSON mode, schema validation, constrained decoding -- introduces overhead that affects throughput, time to first token (TTFT), and tokens per second (TPS). Understanding these tradeoffs is essential for production systems where latency budgets are tight.

### JSON Mode and Schema Enforcement Overhead

When a cloud provider enables JSON mode, the logit masking that prevents invalid tokens adds minimal per-token latency -- typically under 1ms per token on the provider side, since the mask is precomputed. The more significant cost is indirect: JSON syntax tokens (braces, colons, quotes, commas) consume part of the output token budget without carrying semantic content. For a simple extraction that produces 200 tokens of useful data, JSON formatting overhead adds roughly 30-60 additional tokens depending on schema complexity. This is a 15-30% throughput tax.

Schema enforcement (OpenAI's Structured Outputs) adds slightly more overhead than bare JSON mode because the constraint mask must be updated at each step to reflect which tokens are valid given the current position in the schema. In practice, the additional latency per token remains small (low single-digit milliseconds), but TTFT increases measurably -- typically 50-150ms -- because the schema must be compiled into a constraint representation before generation begins. OpenAI caches compiled schemas, so repeated calls with the same schema amortize this cost.

### Constrained Decoding Performance

For self-hosted models, constrained decoding frameworks introduce more visible overhead. Outlines precomputes a finite-state machine from the schema or regex, and this precomputation step can take 100ms to several seconds for complex schemas. Once built, the per-token overhead is a lookup in the FSM transition table -- fast, but not zero. Benchmarks from the Outlines team show 5-15% TPS reduction compared to unconstrained generation on typical hardware.

GBNF grammars in llama.cpp operate at the C++ level and avoid Python overhead entirely, making them the fastest constrained decoding option for local inference. The per-token cost of grammar checking is typically under 0.5ms, which is negligible compared to the model forward pass itself. For latency-sensitive local deployments, GBNF grammars add near-zero overhead.

The performance picture changes significantly with schema complexity. A simple flat object with five string fields introduces minimal overhead regardless of the enforcement method. A deeply nested schema with arrays of objects, enums, and conditional fields can increase constrained decoding overhead by 3-5x because the FSM state space grows combinatorially. This is another reason to prefer flat schemas, beyond the reliability benefits discussed in the schema design section above. For more on how constrained decoding interacts with KV cache management, speculative decoding, and other inference optimizations, see [Article 05: Inference Optimization](/inference-optimization).

### Prompt-Only Performance Baseline

The prompt-only approach ("Please return JSON") has zero enforcement overhead -- no logit masking, no FSM, no schema compilation. This makes it the fastest option in raw TPS terms. However, the hidden cost is unreliability: when the model produces malformed output, you must retry the entire request. If a prompt-only approach fails 10% of the time, the effective throughput including retries is lower than a constrained approach that succeeds on every attempt. For high-volume pipelines processing thousands of extractions, even a 5% retry rate negates any throughput advantage from skipping enforcement.

## Structured Output in Agent Loops

Function calling becomes significantly more complex in multi-step agent interactions, where the model makes a sequence of tool calls, observes results, and decides on next actions. The structured output mechanism must handle not just single extractions but ongoing conversations between the model and external systems.

### Multi-Turn Tool Calling

In a typical agent loop, the model generates a tool call, the application executes it and returns the result, and the model generates either another tool call or a final response. Each tool call is a structured output that must conform to the tool's parameter schema. The conversation history grows with each turn, and the model must maintain coherence across the entire sequence:

```python
messages = [{"role": "user", "content": "Find flights from NYC to London, then book the cheapest one."}]

while True:
    response = client.chat.completions.create(
        model="gpt-4o",
        tools=tools,
        messages=messages,
    )

    if response.choices[0].finish_reason == "stop":
        break  # Model produced a final text response

    for tool_call in response.choices[0].message.tool_calls:
        result = execute_tool(tool_call.function.name,
                              json.loads(tool_call.function.arguments))
        messages.append(response.choices[0].message)
        messages.append({
            "role": "tool",
            "tool_call_id": tool_call.id,
            "content": json.dumps(result),
        })
```

### Parallel Tool Calls

Modern APIs support parallel tool calls, where the model generates multiple tool invocations in a single response. This is critical for performance -- an agent that needs to search three databases sequentially takes 3x longer than one that searches all three in parallel. The structured output mechanism must produce multiple valid tool call objects in a single generation step.

Parallel tool calls introduce coordination challenges. The model must generate arguments for each call independently, since the calls execute concurrently and cannot depend on each other's results. This requires the model to plan ahead and decompose the task into independent subtasks. When parallel tool calls return, all results are appended to the conversation before the model generates its next response, giving it the complete picture.

### Error Recovery in Agent Loops

Tool execution failures are inevitable in production agent systems. A database query might time out, an API might return an error, or the model might generate arguments that are schema-valid but semantically wrong (e.g., searching for a nonexistent ID). Robust agent loops need structured error handling. For a thorough treatment of error recovery, retry strategies, and execution sandboxing, see [Article 25: Function Calling & Tool Integration](/function-calling).

The standard pattern is to return errors as structured tool results rather than raising exceptions:

```python
def execute_tool(name: str, args: dict) -> dict:
    try:
        result = tool_registry[name](**args)
        return {"status": "success", "data": result}
    except ValidationError as e:
        return {"status": "error", "error_type": "validation",
                "message": str(e)}
    except TimeoutError:
        return {"status": "error", "error_type": "timeout",
                "message": f"Tool {name} timed out after 30s"}
    except Exception as e:
        return {"status": "error", "error_type": "internal",
                "message": f"Unexpected error: {str(e)}"}
```

When the model receives an error result, it can decide whether to retry with different arguments, try an alternative tool, or report the failure to the user. This self-correcting behavior emerges naturally from the conversation structure -- the model sees the error in context and adjusts its approach. The quality of error recovery depends heavily on how the system prompt instructs the model to handle failures (see [Article 09: System Prompt Design](/system-prompts) for patterns on structuring these instructions).

## Provider-Specific Structured Output Features

The structured output landscape varies significantly across providers. Each has made different tradeoffs between flexibility, reliability, and developer experience.

### OpenAI

OpenAI offers the most mature structured output ecosystem. JSON mode (November 2023) provides syntactic guarantees. Structured Outputs (August 2024) adds full JSON Schema enforcement with near-100% compliance rates. Function calling supports parallel tool calls, forced tool choice, and `strict: true` mode that applies the same schema enforcement used in Structured Outputs to tool parameters. The `response_format` parameter accepts both `json_object` (loose) and `json_schema` (strict) types. OpenAI also supports streaming structured output with partial JSON delivery.

Limitations: JSON Schema support excludes some features like `patternProperties`, `minProperties`, and custom formats. Recursive schemas are supported but limited to finite depth.

### Anthropic

Anthropic supports function calling (tool use) with JSON Schema-based parameter definitions. Claude models support parallel tool calls and forced tool choice via the `tool_choice` parameter. Anthropic does not offer a standalone JSON mode equivalent to OpenAI's `response_format: json_object`; instead, structured output is achieved through tool use or prompt engineering. Claude's strong instruction-following means that prompt-based structured output is more reliable than with many other models -- but schema enforcement through tool use remains the recommended path for production.

### Google (Gemini)

Gemini supports JSON mode via `response_mime_type: "application/json"` and schema enforcement via `response_schema`. Function calling supports parallel calls and forced function selection. Gemini's unique feature is enum mode (`response_mime_type: "text/x.enum"`), which constrains output to one of a predefined set of values -- useful for classification tasks. Google also supports controlled generation for Gemma open models via the same interfaces available in their API.

### Open-Source Ecosystem

For self-hosted models, the structured output story centers on inference frameworks rather than model providers. vLLM supports Outlines-based constrained decoding natively via the `guided_json`, `guided_regex`, and `guided_grammar` parameters in its API. TGI (Text Generation Inference by Hugging Face) supports grammar-based constraints. llama.cpp provides GBNF grammar support. SGLang offers constrained decoding with a focus on high-throughput batch scenarios.

The open-source advantage is full control over the constraint mechanism -- you can define arbitrary grammars, not just JSON Schema. The disadvantage is that you are responsible for performance tuning, and constrained decoding interacts with other inference optimizations (continuous batching, speculative decoding, KV cache management) in ways that require careful configuration. These interactions are covered in detail in [Article 05: Inference Optimization](/inference-optimization).

| Feature | OpenAI | Anthropic | Google Gemini | vLLM / Open-Source |
|---------|--------|-----------|---------------|---------------------|
| JSON mode | Yes | Via tool use | Yes | Via Outlines |
| Schema enforcement | Yes (strict) | Via tool use | Yes | Yes (grammar/Outlines) |
| Parallel tool calls | Yes | Yes | Yes | Framework-dependent |
| Forced tool choice | Yes | Yes | Yes | Framework-dependent |
| Streaming structured output | Yes | Yes | Yes | Partial support |
| Regex constraints | No | No | No | Yes (Outlines, GBNF) |
| Arbitrary grammar | No | No | No | Yes (GBNF, Guidance) |
| Enum mode | No | No | Yes | Via constrained decoding |

## XML and YAML Output Modes

Not all structured output is JSON. Depending on the use case, XML or YAML can be preferable formats, and some models handle them more naturally than others.

### When XML Is Preferred

XML excels in scenarios involving document markup, mixed content (text interleaved with structured annotations), and hierarchical data with attributes. Anthropic's Claude models in particular have strong XML handling, partly because XML tags are used extensively in Claude's own prompting conventions for delimiting sections of input.

XML is also advantageous for inline annotation tasks where you need to mark up spans within text:

```xml
<analysis>
  <entity type="PERSON" confidence="0.95">Tim Cook</entity> leads
  <entity type="ORG" confidence="0.98">Apple</entity> in
  <entity type="LOCATION" confidence="0.92">Cupertino</entity>.
</analysis>
```

This kind of inline markup is awkward to express in JSON, which separates structure from content. XML preserves the original text while adding annotations around it.

The main downside of XML output is the lack of provider-level enforcement. No major API provider offers an "XML mode" equivalent to JSON mode. You must rely on prompt engineering and post-hoc validation to ensure well-formed XML. For Anthropic models, the strong instruction-following and native XML familiarity make prompt-based XML output highly reliable in practice. See [Article 09: System Prompt Design](/system-prompts) for guidance on structuring XML output instructions.

### When YAML Is Preferred

YAML is more readable than JSON for configuration-like outputs and data with extensive string content. It avoids the quoting and escaping overhead of JSON, and its indentation-based structure is more compact for deeply nested data. YAML is particularly useful when the structured output will be reviewed or edited by humans:

```yaml
analysis:
  sentiment: positive
  confidence: 0.82
  reasoning: >
    The review expresses strong satisfaction with the product's
    core functionality while noting minor issues with delivery
    timing that do not significantly impact overall sentiment.
  key_phrases:
    - "works great"
    - "excellent quality"
    - "shipping was slow"
```

YAML's multi-line string support (using `>` for folded or `|` for literal blocks) makes it natural for outputs that mix short structured fields with longer text content. JSON requires escaping newlines within strings, which is both harder for the model to generate correctly and less readable in logs and debugging output.

The tradeoff is that YAML parsing is more complex than JSON parsing, YAML has well-known security concerns (arbitrary code execution via `yaml.load` in Python -- always use `yaml.safe_load`), and there is no provider-level YAML enforcement. Like XML, YAML output relies on prompt engineering. Models generally produce valid YAML with high reliability for simple structures, but complex nested YAML with mixed block and flow styles is error-prone.

### Choosing Between JSON, XML, and YAML

Use **JSON** when you need provider-level schema enforcement, when interoperating with APIs, or when the output will be consumed programmatically without human review. JSON is the default choice and the only format with dedicated API support across providers.

Use **XML** when you need inline text annotation, when working with document markup, or when using Anthropic models that handle XML natively. XML is also appropriate for outputs consumed by XML-native systems.

Use **YAML** when human readability is a priority, when outputs contain significant multi-line text content, or when the output serves as configuration. Always validate YAML output carefully, as subtle indentation errors are harder to catch than JSON syntax errors.

For RAG pipelines that extract structured information from retrieved documents, the choice of output format interacts with the retrieval and generation strategy. See [Article 17: Advanced RAG](/advanced-rag) for patterns on structuring extraction outputs in multi-hop retrieval workflows.

## Choosing the Right Approach

### Decision Framework

| Scenario | Recommended Approach | Why |
|----------|---------------------|-----|
| Simple JSON from cloud API | Structured Outputs / JSON mode | Highest reliability, no extra dependencies |
| Complex extraction with validation | Pydantic + Instructor | Retry with validation feedback |
| Local model, strict format | Outlines or GBNF grammar | Zero API dependency, guaranteed format |
| Agentic tool use | Function calling | Native tool selection semantics |
| Mixed structured/unstructured | Guidance templates | Fine-grained control |
| High-throughput extraction | Constrained decoding + batching | Performance at scale |

### Reliability Hierarchy

From most to least reliable:

1. **Constrained decoding with grammar** -- Mathematically impossible to produce invalid output
2. **Structured Outputs with JSON Schema** -- API-level enforcement, very high reliability
3. **Pydantic/Zod with retry** -- High reliability through validation and retry
4. **JSON mode** -- Syntactic validity guaranteed, schema not enforced
5. **Prompt-only** ("Please return JSON") -- Unreliable, especially for complex schemas

For production applications, aim for level 2 or above. Level 5 (prompt-only) is acceptable only for prototyping or when using models that do not support structured output APIs.

## Summary and Key Takeaways

- Structured output is essential for production LLM applications but is not guaranteed by default; models generate free-form text and need explicit constraints to produce structured data.
- JSON mode guarantees syntactic validity but not schema conformance; use Structured Outputs or constrained decoding for schema-level guarantees.
- Function calling is designed for agentic tool selection, not pure structured extraction; use the right mechanism for the right use case.
- Pydantic (Python) and Zod (TypeScript) provide the best developer experience for defining and validating structured output schemas; libraries like Instructor and the Vercel AI SDK integrate them with LLM APIs.
- Constrained decoding (Outlines, Guidance, GBNF grammars) provides the strongest guarantees by modifying the token sampling process to enforce formal grammars; this is the gold standard for local model deployments.
- Production extraction pipelines should combine schema definition, constrained generation, validation with retry, and semantic validation for maximum reliability.
- Complex extractions should be decomposed into simpler, focused extractions that are individually more reliable and independently recoverable.
- Structured output overhead varies from near-zero (GBNF grammars) to noticeable (complex schema compilation), and the retry cost of unreliable prompt-only approaches often exceeds the overhead of proper enforcement.
- Agent loops require structured output at every turn; parallel tool calls, error recovery, and multi-step coordination all depend on reliable schema conformance at each step.
- XML and YAML are viable structured output formats for specific use cases -- inline annotation, human-readable configuration, multi-line text -- but lack the provider-level enforcement available for JSON.
- The field is converging toward schema-driven generation as the standard approach, with Pydantic/Zod schemas serving as the universal interface between application code and LLM output.
