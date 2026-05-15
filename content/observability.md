# Observability: Tracing, Logging & LLM Monitoring

Traditional observability -- metrics, logs, traces -- was designed for deterministic systems where the same input produces the same output. LLM-powered applications shatter this assumption: outputs are stochastic, quality is subjective, failure modes are semantic rather than syntactic, and a single user request may trigger multiple LLM calls across different models and providers. Building effective observability for AI systems requires extending classical approaches with LLM-specific instrumentation for token usage, response quality, prompt versioning, and end-to-end pipeline tracing. This article examines the observability stack for production AI applications, from low-level instrumentation through platform integration to debugging workflows.

## Why LLM Observability Is Fundamentally Different

Consider a traditional API endpoint that fetches data from a database and returns JSON. Observability is straightforward: log the request, measure latency, check the HTTP status code. If the response is wrong, examine the SQL query and the data.

Now consider an LLM-powered endpoint. The same input can produce different outputs across calls. A "successful" 200 response may contain a hallucinated answer, a refusal, or a response that is technically correct but unhelpful. Latency varies by 10x depending on output length. Costs scale with input and output token counts. The "query" (prompt) itself is a complex artifact that may include system instructions, few-shot examples, retrieved context, and conversation history.

The key observability challenges unique to LLM systems:

1. **Quality is not binary**: Unlike a database query that either returns the right rows or doesn't, LLM output quality exists on a spectrum that requires human or LLM-based evaluation.

2. **Cost is per-request variable**: Each request has a different token cost that depends on input length, output length, and the model used.

3. **Prompt is code**: The prompt template, system instructions, and few-shot examples are effectively part of the application logic, and changes to them can cause regressions just like code changes.

4. **Failure modes are semantic**: The system can fail by hallucinating, refusing appropriate requests, producing poorly formatted output, or leaking PII from context -- none of which produce error codes.

## The LLM Observability Stack

A complete observability stack for LLM applications has four layers:

```
┌─────────────────────────────────────────────┐
│           Evaluation & Analytics            │
│  Quality scoring, regression detection,     │
│  A/B testing, user feedback loops           │
├─────────────────────────────────────────────┤
│           Tracing & Lineage                 │
│  End-to-end request traces, span trees,     │
│  parent-child relationships across calls    │
├─────────────────────────────────────────────┤
│         Structured Logging                  │
│  Prompt/completion pairs, token counts,     │
│  model parameters, latency, cost            │
├─────────────────────────────────────────────┤
│          Infrastructure Metrics             │
│  GPU utilization, queue depth, error rates,  │
│  p50/p95/p99 latency, throughput            │
└─────────────────────────────────────────────┘
```

## Distributed Tracing for AI Pipelines

### The Trace Model

A single user request to an AI application often triggers a complex chain of operations:

1. Receive user message
2. Retrieve relevant documents (RAG)
3. Construct prompt with system instructions + context + history
4. Call LLM for initial response
5. Parse structured output
6. Call LLM again for validation or refinement
7. Return response to user

Each of these steps should be a **span** within a **trace**, following the OpenTelemetry model but extended for LLM-specific metadata:

```python
from opentelemetry import trace
from opentelemetry.trace import StatusCode
import time

tracer = trace.get_tracer("ai-pipeline")

class TracedLLMPipeline:
    async def handle_request(self, user_message: str, session_id: str):
        with tracer.start_as_current_span("ai_pipeline.handle_request") as root_span:
            root_span.set_attribute("session_id", session_id)
            root_span.set_attribute("input_length", len(user_message))

            # Step 1: Retrieval
            with tracer.start_as_current_span("ai_pipeline.retrieve") as retrieve_span:
                documents = await self.retrieve(user_message)
                retrieve_span.set_attribute("num_documents", len(documents))
                retrieve_span.set_attribute("total_context_tokens",
                    sum(count_tokens(d) for d in documents))

            # Step 2: LLM Generation
            with tracer.start_as_current_span("ai_pipeline.llm_generate") as llm_span:
                prompt = self.build_prompt(user_message, documents)
                start = time.monotonic()

                response = await self.llm_client.generate(prompt)

                llm_span.set_attribute("model", response.model)
                llm_span.set_attribute("prompt_tokens", response.usage.prompt_tokens)
                llm_span.set_attribute("completion_tokens", response.usage.completion_tokens)
                llm_span.set_attribute("total_tokens", response.usage.total_tokens)
                llm_span.set_attribute("ttft_ms", response.time_to_first_token_ms)
                llm_span.set_attribute("total_latency_ms",
                    (time.monotonic() - start) * 1000)
                llm_span.set_attribute("cost_usd", self.compute_cost(response))
                llm_span.set_attribute("finish_reason", response.finish_reason)

            # Step 3: Parse and validate
            with tracer.start_as_current_span("ai_pipeline.parse") as parse_span:
                parsed = self.parse_response(response)
                parse_span.set_attribute("parse_success", parsed is not None)

            root_span.set_attribute("total_cost_usd", self.total_cost)
            return parsed
```

### Trace Visualization

A well-instrumented trace for a RAG pipeline looks like this in a trace viewer:

```
ai_pipeline.handle_request (1,247ms, $0.0034)
├── ai_pipeline.retrieve (89ms)
│   ├── embedding.encode (12ms) [model=text-embedding-3-small, tokens=45]
│   └── vector_store.search (77ms) [results=5, min_score=0.82]
├── ai_pipeline.build_prompt (2ms) [total_tokens=3,847]
├── ai_pipeline.llm_generate (1,089ms) [$0.0034]
│   ├── [model=claude-sonnet, prompt=3847tok, completion=342tok]
│   ├── [ttft=234ms, itl=2.4ms]
│   └── [finish_reason=end_turn, cached_tokens=1200]
├── ai_pipeline.parse (4ms) [parse_success=true]
└── ai_pipeline.guardrails (63ms) [pii_detected=false, toxicity=0.02]
```

## Langfuse Integration

Langfuse is an open-source LLM observability platform that provides tracing, prompt management, evaluation, and analytics. Its data model is designed specifically for LLM workloads.

### Core Concepts

- **Trace**: Top-level container for a complete request lifecycle
- **Span**: A generic operation within a trace (retrieval, parsing, etc.)
- **Generation**: An LLM call with full input/output, model, usage, and cost tracking
- **Score**: A quality assessment attached to a trace or generation

```python
from langfuse import Langfuse
from langfuse.decorators import observe, langfuse_context

langfuse = Langfuse()

@observe()                   # Creates a trace automatically
async def handle_chat(user_message: str, session_id: str):
    langfuse_context.update_current_trace(
        session_id=session_id,
        user_id=get_current_user_id(),
        metadata={"feature": "chat", "version": "2.1"}
    )

    # Retrieval span
    documents = await retrieve_context(user_message)

    # LLM generation (automatically tracked)
    response = await generate_response(user_message, documents)

    # Score the interaction
    langfuse_context.score_current_trace(
        name="response_relevance",
        value=assess_relevance(user_message, response),
        comment="Automated relevance check"
    )

    return response

@observe(as_type="generation")   # Tracked as an LLM generation
async def generate_response(query: str, context: list[str]):
    messages = build_messages(query, context)
    response = await anthropic_client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=1024,
        messages=messages
    )
    # Langfuse decorator automatically captures:
    # - Input messages
    # - Output content
    # - Model name
    # - Token usage
    # - Latency
    return response.content[0].text

@observe()                       # Tracked as a span
async def retrieve_context(query: str) -> list[str]:
    embedding = await embed(query)
    results = await vector_store.search(embedding, top_k=5)
    langfuse_context.update_current_observation(
        metadata={"num_results": len(results), "top_score": results[0].score}
    )
    return [r.text for r in results]
```

### Prompt Management with Langfuse

Langfuse enables versioning and managing prompts as first-class objects, separate from application code:

```python
# Fetch the current production prompt from Langfuse
prompt = langfuse.get_prompt("rag-system-prompt", version=3)

# Use the prompt (automatically links generations to this prompt version)
messages = [
    {"role": "system", "content": prompt.compile(domain="finance")},
    {"role": "user", "content": user_query}
]
```

This decoupling allows prompt engineers to iterate on prompts without code deployments, while maintaining full traceability between prompt versions and output quality.

## Langsmith and Braintrust

### Langsmith

LangChain's Langsmith provides deep integration with the LangChain ecosystem and focuses on debugging complex chains and agents:

```python
import os
os.environ["LANGCHAIN_TRACING_V2"] = "true"
os.environ["LANGCHAIN_API_KEY"] = "ls-..."
os.environ["LANGCHAIN_PROJECT"] = "production-rag"

# All LangChain operations are automatically traced
from langchain_anthropic import ChatAnthropic
from langchain_core.prompts import ChatPromptTemplate

chain = ChatPromptTemplate.from_messages([
    ("system", "You are a helpful assistant."),
    ("user", "{question}")
]) | ChatAnthropic(model="claude-sonnet-4-20250514")

# This call is automatically traced in Langsmith
result = await chain.ainvoke({"question": "What is observability?"})
```

Langsmith's strength is its **playground** for iterating on prompts against recorded inputs and its **dataset and evaluation** features for systematic testing.

### Braintrust

Braintrust focuses on evaluation and experimentation. Its core abstraction is the **experiment**: a set of inputs run through a pipeline, scored, and compared against a baseline:

```python
from braintrust import Eval

await Eval("rag-pipeline", {
    "data": lambda: load_eval_dataset(),       # Test cases
    "task": lambda input: rag_pipeline(input),  # Your pipeline
    "scores": [
        relevance_scorer,      # Custom scoring function
        faithfulness_scorer,   # Does output match retrieved context?
        toxicity_scorer,       # Safety check
    ],
})
```

## Structured Logging for LLM Calls

### Log Schema

Every LLM call should emit a structured log entry with enough information to reproduce, debug, and analyze the call:

```python
import structlog

logger = structlog.get_logger()

async def call_llm_with_logging(messages, model, params):
    request_id = generate_request_id()
    start_time = time.monotonic()

    try:
        response = await llm_client.generate(messages, model, **params)
        elapsed_ms = (time.monotonic() - start_time) * 1000

        logger.info(
            "llm_call_success",
            request_id=request_id,
            model=model,
            provider="anthropic",
            prompt_tokens=response.usage.prompt_tokens,
            completion_tokens=response.usage.completion_tokens,
            cached_tokens=response.usage.get("cached_tokens", 0),
            total_tokens=response.usage.total_tokens,
            latency_ms=round(elapsed_ms, 2),
            ttft_ms=response.time_to_first_token_ms,
            cost_usd=compute_cost(model, response.usage),
            finish_reason=response.finish_reason,
            temperature=params.get("temperature"),
            max_tokens=params.get("max_tokens"),
            has_tools=bool(params.get("tools")),
            tool_calls=len(response.tool_calls) if response.tool_calls else 0,
            # DO NOT log full prompt/completion in production
            # (PII risk, storage cost). Log a hash instead.
            prompt_hash=hash_messages(messages),
            output_length=len(response.content),
        )
        return response

    except Exception as e:
        elapsed_ms = (time.monotonic() - start_time) * 1000
        logger.error(
            "llm_call_error",
            request_id=request_id,
            model=model,
            error_type=type(e).__name__,
            error_message=str(e),
            latency_ms=round(elapsed_ms, 2),
            is_retryable=is_retryable_error(e),
        )
        raise
```

### What Not to Log

A critical decision is what NOT to log in production:

- **Full prompts and completions**: These may contain PII, proprietary data, or user secrets. Log them only in development/staging or to a separate, access-controlled store with retention policies.
- **API keys**: Never log authentication credentials. Use redaction filters.
- **Embedding vectors**: These are high-dimensional and expensive to store. Log only metadata about embedding operations.

```python
class LogRedactor:
    PATTERNS = [
        (r'sk-[a-zA-Z0-9]{48}', '[REDACTED_API_KEY]'),
        (r'\b\d{3}-\d{2}-\d{4}\b', '[REDACTED_SSN]'),
        (r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b', '[REDACTED_EMAIL]'),
    ]

    @classmethod
    def redact(cls, text: str) -> str:
        for pattern, replacement in cls.PATTERNS:
            text = re.sub(pattern, replacement, text)
        return text
```

## Latency Tracking and SLAs

### Multi-Dimensional Latency

LLM latency has multiple components that must be tracked independently:

```python
@dataclass
class LatencyBreakdown:
    queue_wait_ms: float      # Time waiting in request queue
    prefill_ms: float         # Time to process input tokens
    ttft_ms: float            # Time to first output token
    decode_ms: float          # Time for all output tokens
    total_ms: float           # End-to-end latency
    itl_ms: float             # Average inter-token latency
    network_ms: float         # Network round-trip (for API calls)
    tokens_per_second: float  # Output throughput

    @property
    def decode_efficiency(self) -> float:
        """Fraction of total time spent actually generating tokens."""
        return self.decode_ms / self.total_ms
```

### SLA Definition for LLM Services

```python
# Example SLA definitions
SLAS = {
    "chat_interactive": {
        "ttft_p50_ms": 500,
        "ttft_p95_ms": 2000,
        "itl_p95_ms": 50,
        "availability": 0.999,
        "error_rate": 0.001,
    },
    "batch_processing": {
        "completion_p95_ms": 30000,
        "throughput_tokens_per_second": 1000,
        "availability": 0.995,
    },
    "agent_pipeline": {
        "e2e_p95_ms": 60000,      # Agent loops can be long
        "per_step_p95_ms": 5000,
        "max_steps": 15,
        "availability": 0.99,
    }
}
```

## Error Classification

### LLM-Specific Error Taxonomy

Not all errors are equal. A comprehensive error taxonomy helps prioritize debugging:

```python
class LLMErrorClassifier:
    @staticmethod
    def classify(error: Exception) -> ErrorClassification:
        if isinstance(error, RateLimitError):
            return ErrorClassification(
                category="rate_limit",
                severity="warning",
                is_retryable=True,
                suggested_action="back_off_and_retry",
                user_impact="delayed_response"
            )
        elif isinstance(error, ContextLengthExceeded):
            return ErrorClassification(
                category="context_overflow",
                severity="error",
                is_retryable=False,
                suggested_action="truncate_input_or_use_larger_context_model",
                user_impact="request_failed"
            )
        elif isinstance(error, ContentFilterError):
            return ErrorClassification(
                category="safety_filter",
                severity="warning",
                is_retryable=False,
                suggested_action="review_input_for_policy_violation",
                user_impact="request_refused"
            )
        elif isinstance(error, (TimeoutError, ConnectionError)):
            return ErrorClassification(
                category="infrastructure",
                severity="error",
                is_retryable=True,
                suggested_action="retry_with_fallback_provider",
                user_impact="delayed_response"
            )
        elif isinstance(error, InvalidResponseFormat):
            return ErrorClassification(
                category="output_parsing",
                severity="warning",
                is_retryable=True,
                suggested_action="retry_with_stricter_prompt",
                user_impact="degraded_quality"
            )
```

### Semantic Failure Detection

Beyond hard errors, LLM systems need to detect semantic failures:

```python
class SemanticFailureDetector:
    def check_response(self, request, response) -> list[SemanticIssue]:
        issues = []

        # Refusal detection
        refusal_phrases = ["I cannot", "I'm unable to", "I don't have access"]
        if any(phrase in response.content for phrase in refusal_phrases):
            issues.append(SemanticIssue("unexpected_refusal", severity="medium"))

        # Hallucination indicators
        if response.has_citations and not self.verify_citations(response):
            issues.append(SemanticIssue("citation_hallucination", severity="high"))

        # Output format violation
        if request.expected_format == "json":
            try:
                json.loads(response.content)
            except json.JSONDecodeError:
                issues.append(SemanticIssue("format_violation", severity="high"))

        # Truncation
        if response.finish_reason == "length":
            issues.append(SemanticIssue("truncated_output", severity="medium"))

        # Language mismatch
        if detect_language(response.content) != request.expected_language:
            issues.append(SemanticIssue("language_mismatch", severity="medium"))

        return issues
```

## Production Debugging Patterns

### The Debugging Workflow

When an LLM-powered feature produces bad results in production, the debugging workflow differs from traditional software:

1. **Find the trace**: Use the request ID to locate the full trace in your observability platform.

2. **Inspect the prompt**: What was the actual prompt sent to the model? Was the system prompt correct? Was the right context retrieved?

3. **Check the model and parameters**: Was the right model used? What were the temperature, max_tokens, and other parameters?

4. **Examine the raw output**: What did the model actually return? Was there a parsing error downstream?

5. **Replay the request**: Send the exact same prompt to the same model and see if the issue reproduces. If it does, it's a prompt problem. If it doesn't (stochastic failure), it's a robustness problem.

6. **Check for regressions**: Compare against previous traces for similar inputs. Did a prompt change or model update cause the regression?

```python
class LLMDebugger:
    def __init__(self, langfuse_client):
        self.langfuse = langfuse_client

    async def replay_trace(self, trace_id: str) -> ReplayResult:
        """Replay a production trace for debugging."""
        trace = self.langfuse.get_trace(trace_id)

        # Extract all generations from the trace
        generations = [obs for obs in trace.observations
                      if obs.type == "GENERATION"]

        results = []
        for gen in generations:
            # Replay with exact same parameters
            replay = await self.llm_client.generate(
                messages=gen.input,
                model=gen.model,
                temperature=gen.model_parameters.get("temperature", 1.0),
                max_tokens=gen.model_parameters.get("max_tokens"),
            )

            results.append(ReplayResult(
                original_output=gen.output,
                replay_output=replay.content,
                outputs_match=gen.output == replay.content,
                similarity=compute_similarity(gen.output, replay.content),
            ))

        return results
```

### Alerting on LLM-Specific Conditions

```python
# Alerting rules for LLM observability
ALERT_RULES = [
    {
        "name": "high_error_rate",
        "condition": "error_rate > 0.05 over 5 minutes",
        "severity": "critical",
        "action": "page_on_call"
    },
    {
        "name": "latency_spike",
        "condition": "p95_ttft > 5000ms over 10 minutes",
        "severity": "warning",
        "action": "slack_notification"
    },
    {
        "name": "cost_spike",
        "condition": "hourly_cost > 2x rolling_avg_hourly_cost",
        "severity": "warning",
        "action": "slack_notification + throttle_non_critical"
    },
    {
        "name": "quality_degradation",
        "condition": "avg_relevance_score < 0.7 over 1 hour",
        "severity": "warning",
        "action": "slack_notification"
    },
    {
        "name": "hallucination_spike",
        "condition": "hallucination_rate > 0.1 over 30 minutes",
        "severity": "critical",
        "action": "page_on_call + enable_guardrails"
    },
    {
        "name": "cache_miss_rate",
        "condition": "cache_hit_rate < 0.3 over 1 hour",
        "severity": "info",
        "action": "log_for_review"
    }
]
```

## Metrics Dashboard Design

An effective LLM observability dashboard organizes metrics into four quadrants:

### Operational Health
- Request rate (req/min) by model and endpoint
- Error rate by error category
- P50/P95/P99 latency (TTFT and total)
- Queue depth and queue wait time
- Active requests / concurrent sessions

### Cost and Usage
- Token consumption (input/output/cached) by model, feature, and user
- Dollar cost over time with breakdown
- Cost per request distribution
- Cache hit rate and estimated savings
- Budget utilization percentage

### Quality Signals
- Average evaluation scores (relevance, faithfulness, helpfulness)
- User feedback (thumbs up/down, explicit ratings)
- Semantic failure rates (refusals, format violations, truncations)
- Guardrail trigger rates (toxicity, PII detection)

### Model and Prompt Performance
- Per-prompt-version quality scores
- Model comparison (when A/B testing)
- Token efficiency (useful tokens / total tokens)
- Retry rates by model and error type

## OpenTelemetry GenAI Semantic Conventions

The OpenTelemetry project has recognized that AI workloads require first-class semantic conventions -- standardized attribute names and span structures that allow interoperability across vendors, frameworks, and observability backends. The **GenAI Semantic Conventions** (currently incubating within the OTel specification) define how LLM calls, embedding operations, and AI pipeline spans should be described in traces.

### Why Standardization Matters

Without conventions, every team invents its own attribute names. One team logs `model_name`, another logs `llm.model`, another logs `ai.model_id`. Dashboards break when you switch observability vendors. Cross-team analysis requires painful schema mapping. The OTel GenAI conventions solve this by defining a canonical vocabulary:

```python
# OTel GenAI semantic convention attributes (incubating)
# See: https://opentelemetry.io/docs/specs/semconv/gen-ai/

GENAI_SYSTEM = "gen_ai.system"                          # "openai", "anthropic", etc.
GENAI_REQUEST_MODEL = "gen_ai.request.model"            # "claude-sonnet-4-20250514"
GENAI_REQUEST_MAX_TOKENS = "gen_ai.request.max_tokens"
GENAI_REQUEST_TEMPERATURE = "gen_ai.request.temperature"
GENAI_REQUEST_TOP_P = "gen_ai.request.top_p"

GENAI_RESPONSE_MODEL = "gen_ai.response.model"          # Actual model used
GENAI_RESPONSE_FINISH_REASONS = "gen_ai.response.finish_reasons"

GENAI_USAGE_INPUT_TOKENS = "gen_ai.usage.input_tokens"
GENAI_USAGE_OUTPUT_TOKENS = "gen_ai.usage.output_tokens"

# Span naming convention: "{gen_ai.operation.name} {gen_ai.request.model}"
# Example: "chat claude-sonnet-4-20250514"
```

### Extending the Conventions for Agent Workloads

The base conventions cover single LLM calls, but production AI systems involve multi-step pipelines, tool use, and agent loops. Teams extending OTel for agents typically add attributes at several levels:

```python
from opentelemetry import trace

tracer = trace.get_tracer("agent-pipeline", "1.0.0")

def create_agent_span(agent_name: str, task: str):
    span = tracer.start_span(
        f"gen_ai.agent.execute {agent_name}",
        attributes={
            # Standard GenAI attributes
            "gen_ai.system": "custom_agent",
            "gen_ai.request.model": "claude-sonnet-4-20250514",
            # Agent-specific extensions
            "gen_ai.agent.name": agent_name,
            "gen_ai.agent.max_steps": 10,
            "gen_ai.agent.task": task,
            "gen_ai.agent.tools_available": ["search", "calculator", "code_exec"],
        }
    )
    return span

def record_tool_call(span, tool_name: str, duration_ms: float, success: bool):
    """Record a tool invocation as a span event."""
    span.add_event("gen_ai.tool.call", attributes={
        "gen_ai.tool.name": tool_name,
        "gen_ai.tool.duration_ms": duration_ms,
        "gen_ai.tool.success": success,
    })
```

The standardization effort is significant because it enables **portable observability**: instrument once with OTel conventions, and your traces are legible in Langfuse, Datadog, Honeycomb, Jaeger, or any backend that supports OTel. This is the same portability that OTel brought to traditional web services, now extended to AI workloads. For teams routing traffic through an AI gateway (see Article 42), the gateway itself can inject these standardized attributes at the infrastructure layer, ensuring consistent instrumentation even across teams that instrument their own code differently.

## Agent Trace Visualization

Single LLM calls produce linear traces -- a request span with metadata. Agent executions produce **tree-shaped traces** with branching, loops, and nested sub-agent invocations. Visualizing these effectively is critical for debugging agent behavior and understanding why an agent took a particular path.

### The Agent Trace Structure

An agent trace differs from a standard pipeline trace in several ways. The number of spans is not fixed at development time -- it depends on the agent's decisions. Spans may represent reasoning steps, tool calls, sub-agent delegations, or retry loops. Some branches may be abandoned mid-execution. The trace captures not just what happened, but what the agent *decided* at each step.

```
agent.execute "research_assistant" (14,230ms, $0.0187, 7 steps)
├── agent.step.1 (2,102ms)
│   ├── gen_ai.chat claude-sonnet (1,890ms) [in=1240tok, out=186tok]
│   │   └── [decision: call tool "web_search"]
│   └── gen_ai.tool.call web_search (198ms) [results=8]
├── agent.step.2 (3,450ms)
│   ├── gen_ai.chat claude-sonnet (1,200ms) [in=2890tok, out=340tok]
│   │   └── [decision: call tools "read_page" x3]
│   ├── gen_ai.tool.call read_page (780ms) [url=..., tokens=3200]
│   ├── gen_ai.tool.call read_page (620ms) [url=..., tokens=2100]
│   └── gen_ai.tool.call read_page (840ms) [url=..., tokens=2800]
├── agent.step.3 (1,980ms)
│   ├── gen_ai.chat claude-sonnet (1,640ms) [in=8900tok, out=420tok]
│   │   └── [decision: delegate to "fact_checker" sub-agent]
│   └── agent.execute "fact_checker" (320ms, 2 steps)      ← nested agent
│       ├── agent.step.1: gen_ai.chat claude-haiku (180ms)
│       └── agent.step.2: gen_ai.chat claude-haiku (120ms)
│           └── [result: 3/3 claims verified]
├── agent.step.4-6 ... (synthesis and formatting)
└── agent.step.7 (1,100ms)
    └── gen_ai.chat claude-sonnet (1,100ms) [in=4200tok, out=890tok]
        └── [decision: return final answer]
```

### What to Capture at Each Node

Effective agent trace visualization requires specific metadata at each level of the tree:

**At the agent level**: total steps taken versus maximum allowed, total cost, total latency, whether the agent completed successfully or hit a limit, the original task description, and which tools were available. These aggregate metrics appear in the root span and enable quick triage -- an agent that consumed 14 of its 15 allowed steps is close to failure regardless of whether it produced a correct answer.

**At the step level**: the LLM's reasoning (if using chain-of-thought), the decision made (which tool to call, whether to delegate, or whether to return a final answer), input token count (which grows as conversation history accumulates), and the latency breakdown. Step-level data reveals whether the agent is spending tokens efficiently or spinning in unproductive loops.

**At the tool call level**: the tool name, input parameters, return value (or a truncated summary), latency, and whether the call succeeded. Tool call spans are where agent failures most often originate -- a search returning irrelevant results, an API returning an error, or a code execution timing out. This layer of detail is essential for the kind of trajectory analysis discussed in Article 30.

### Navigating Complex Traces

Production agent traces can span dozens of steps and hundreds of individual spans. Observability platforms that support agent traces typically provide several navigation aids: **timeline views** showing parallel tool calls and their overlap, **decision trees** highlighting the branching points where the agent chose between alternative actions, **cost waterfall charts** showing where tokens and dollars were spent, and **diff views** comparing two traces of the same task to identify where they diverged. When reviewing a failing agent execution, the most productive debugging pattern is to find the first step where the agent's reasoning diverged from the correct path, then inspect the tool output or LLM response that caused the divergence.

## Online Evaluation in Observability

Offline evaluation (see Article 31 for methodology and Article 33 for LLM-as-Judge specifics) answers the question "how well does my system perform on a curated test set?" Online evaluation answers a different question: "how well is my system performing right now, on real production traffic?" The two are complementary. Offline evaluation catches regressions before deployment. Online evaluation catches regressions that only manifest under real-world input distributions -- the long tail of user queries that no test set fully covers.

### Sampling Strategies

Running an LLM judge on every production request is cost-prohibitive for most applications. Instead, production online evaluation uses **sampling**:

```python
import random
import hashlib

class OnlineEvaluationSampler:
    def __init__(self, sample_rate: float = 0.05, expensive_eval_rate: float = 0.01):
        self.sample_rate = sample_rate                # 5% for cheap evals
        self.expensive_eval_rate = expensive_eval_rate  # 1% for LLM-as-judge

    def should_evaluate(self, trace_id: str, eval_type: str = "standard") -> bool:
        # Deterministic sampling based on trace_id ensures
        # the same trace is always evaluated or always skipped,
        # enabling consistent debugging
        hash_val = int(hashlib.sha256(trace_id.encode()).hexdigest(), 16) % 10000
        rate = self.expensive_eval_rate if eval_type == "expensive" else self.sample_rate
        return hash_val < (rate * 10000)

    def select_evaluations(self, trace_id: str, response: str) -> list[str]:
        evals = []
        if self.should_evaluate(trace_id, "standard"):
            evals.extend(["format_check", "language_check", "length_check"])
        if self.should_evaluate(trace_id, "expensive"):
            evals.extend(["relevance_judge", "faithfulness_judge"])
        return evals
```

### The Evaluation Pipeline

Online evaluation runs asynchronously -- it must not add latency to user-facing requests. A typical architecture ingests sampled traces from a queue, runs evaluation logic, and writes scores back to the observability platform:

```python
from langfuse import Langfuse

langfuse = Langfuse()

async def online_evaluation_worker(trace_queue):
    """Async worker that evaluates sampled production traces."""
    async for trace_data in trace_queue:
        trace_id = trace_data["trace_id"]
        user_input = trace_data["input"]
        model_output = trace_data["output"]
        retrieved_context = trace_data.get("context", [])

        # Cheap heuristic evaluations (run on all sampled traces)
        scores = {}
        scores["output_length"] = len(model_output.split())
        scores["has_refusal"] = float(any(
            p in model_output.lower()
            for p in ["i cannot", "i'm unable", "i don't have"]
        ))
        scores["json_valid"] = float(is_valid_json(model_output)) \
            if trace_data.get("expected_format") == "json" else None

        # Expensive LLM-as-judge evaluation (run on smaller sample)
        if trace_data.get("run_llm_judge"):
            judge_response = await llm_judge.evaluate(
                input=user_input,
                output=model_output,
                context=retrieved_context,
                criteria=["relevance", "faithfulness", "completeness"]
            )
            scores.update(judge_response.scores)

        # Write scores back to Langfuse, attached to the original trace
        for score_name, score_value in scores.items():
            if score_value is not None:
                langfuse.score(
                    trace_id=trace_id,
                    name=score_name,
                    value=score_value,
                    source="online_evaluation"
                )
```

### Closing the Feedback Loop

The real power of online evaluation emerges when scores feed back into operational decisions. Aggregate scores over time windows to detect quality degradation. Slice by prompt version to validate that a new prompt performs at least as well as the previous version on real traffic. Slice by user segment to surface quality disparities -- the system may perform well for English queries but poorly for other languages, or well for common topics but poorly for niche domains. When online evaluation detects a regression, the traces that triggered the alert contain everything needed to diagnose the issue: the exact input, the retrieved context, the model output, and the judge's reasoning. This tight coupling between evaluation and tracing is what makes observability-native evaluation more actionable than standalone evaluation suites.

## Cost Attribution

LLM API costs are a first-class operational concern, often exceeding traditional compute costs by an order of magnitude. But a monthly invoice from your model provider is not actionable -- it tells you what you spent, not *why* you spent it. Cost attribution assigns every dollar of LLM spend to specific product features, customer segments, and business outcomes, enabling the unit economics analysis that determines whether an AI feature is viable at scale.

### Tagging for Attribution

The foundation of cost attribution is consistent tagging at the point of every LLM call. Every generation must carry metadata that identifies the business context:

```python
@dataclass
class CostAttribution:
    feature: str           # "chat", "search", "summarization", "code_review"
    customer_id: str       # For per-customer accounting
    customer_tier: str     # "free", "pro", "enterprise"
    environment: str       # "production", "staging", "evaluation"
    prompt_name: str       # Which prompt template triggered this call
    model: str             # The model used
    is_retry: bool         # Retries should be attributed separately

def compute_and_attribute_cost(response, attribution: CostAttribution) -> float:
    """Compute dollar cost and emit attributed metrics."""
    cost = compute_cost(response.model, response.usage)

    # Emit as a metric with attribution dimensions
    metrics.record("llm.cost_usd", cost, tags={
        "feature": attribution.feature,
        "customer_tier": attribution.customer_tier,
        "model": attribution.model,
        "prompt_name": attribution.prompt_name,
        "is_retry": str(attribution.is_retry),
    })

    # Also store on the trace span for drill-down
    current_span = trace.get_current_span()
    current_span.set_attribute("cost.usd", cost)
    current_span.set_attribute("cost.feature", attribution.feature)
    current_span.set_attribute("cost.customer_id", attribution.customer_id)

    return cost
```

### Unit Economics by Feature

Once attribution tags are in place, you can answer the questions that matter for product decisions:

- **Cost per conversation**: what does an average chat session cost, across all the LLM calls it triggers (routing, generation, guardrails, evaluation)? If a chat feature costs $0.12 per session and the user pays $20/month for 200 sessions, the LLM cost alone is $24 -- the feature loses money.

- **Cost per customer tier**: free-tier users may generate 80% of traffic but 30% of revenue. Enterprise users may have longer prompts (more context, more history) that cost 3x more per call. Without attribution, you cannot model this.

- **Cost of retries and fallbacks**: if 8% of requests fail and are retried (potentially on a more expensive fallback model -- the kind of routing described in Article 42), that retry cost should be tracked separately. A high retry rate is both a reliability and a cost problem.

- **Cost of evaluation itself**: if you run LLM-as-judge on 5% of production traffic (see the online evaluation section above), the judge calls have their own token cost. This meta-cost must be attributed to the observability system, not to the product feature being evaluated.

### Budget Controls

Cost attribution enables proactive budget controls rather than reactive invoice shock:

```python
class CostBudgetController:
    def __init__(self, budgets: dict[str, float]):
        # Daily budgets per feature in USD
        self.budgets = budgets   # {"chat": 500, "search": 200, "summarization": 100}
        self.spent: dict[str, float] = defaultdict(float)

    async def check_budget(self, feature: str, estimated_cost: float) -> BudgetDecision:
        current = self.spent[feature]
        budget = self.budgets.get(feature, float("inf"))
        utilization = (current + estimated_cost) / budget

        if utilization > 1.0:
            return BudgetDecision(
                allowed=False,
                reason=f"{feature} daily budget exhausted (${current:.2f}/${budget:.2f})",
                suggested_action="degrade_to_smaller_model"
            )
        elif utilization > 0.8:
            return BudgetDecision(
                allowed=True,
                warning=f"{feature} at {utilization:.0%} of daily budget",
                suggested_action="alert_team"
            )
        else:
            return BudgetDecision(allowed=True)
```

The budget controller integrates with the AI gateway layer (see Article 42) to enforce limits at the routing level. When a feature approaches its budget, the system can automatically degrade to a smaller, cheaper model rather than cutting off users entirely.

## Summary and Key Takeaways

1. **LLM observability extends traditional observability** with token tracking, cost monitoring, quality evaluation, and prompt versioning. Standard APM tools are necessary but not sufficient.

2. **Distributed tracing is essential** for multi-step AI pipelines. Each retrieval, LLM call, parsing step, and guardrail check should be a span within a trace, with LLM-specific attributes (tokens, cost, model) on each span.

3. **Langfuse, Langsmith, and Braintrust** each offer different strengths: Langfuse for open-source tracing and prompt management, Langsmith for LangChain ecosystem integration, Braintrust for evaluation-centric workflows.

4. **Structured logging must balance detail and privacy**: log enough metadata to debug issues (model, tokens, latency, cost, error type) without storing full prompts and completions that may contain sensitive data.

5. **Error classification needs a semantic layer**: beyond HTTP errors and exceptions, detect refusals, hallucinations, format violations, and language mismatches as first-class failure modes.

6. **The replay workflow is uniquely important** for LLM debugging. The ability to replay a production trace with the exact same prompt and parameters is essential for distinguishing prompt problems from stochastic failures.

7. **Alert on cost and quality, not just availability**: a 100% available LLM service that hallucinates 20% of the time or costs 5x the expected amount is still failing its users.

8. **OpenTelemetry GenAI semantic conventions are the path to portable instrumentation**: standardized attribute names for LLM calls enable vendor-neutral traces that work across observability backends without schema mapping.

9. **Agent traces require tree-shaped visualization**: multi-step agent executions with branching tool calls and sub-agent delegations demand specialized trace viewers that surface decision points, cost waterfalls, and trajectory divergence (see Article 30 for trajectory analysis methodology).

10. **Online evaluation bridges the gap between offline benchmarks and production quality**: running LLM-as-judge (see Article 33) on sampled production traffic provides continuous quality monitoring that catches regressions no test set anticipates, with evaluation methodology grounded in the fundamentals of Article 31.

11. **Cost attribution turns opaque LLM invoices into actionable unit economics**: tagging every LLM call with feature, customer, and business context enables per-feature budgeting, per-customer profitability analysis, and automatic degradation when budgets are exhausted.
