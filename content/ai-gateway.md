# AI Gateways: Rate Limiting, Fallbacks & Multi-Provider Routing

As organizations integrate LLM capabilities across multiple products and teams, the direct-to-provider API call pattern -- where each service independently manages its own API keys, retry logic, and error handling -- becomes untenable. AI gateways emerge as the centralized control plane for LLM traffic, analogous to how API gateways (Kong, Envoy) standardized REST API management a decade ago. This article examines the architecture, capabilities, and implementation patterns of AI gateways, from rate limiting and provider fallback chains through multi-provider routing to the emerging ecosystem of managed gateway solutions.

## TL;DR

- An AI gateway is a reverse proxy that centralizes API keys, rate limiting, fallback logic, cost tracking, and request transformation for all LLM traffic across an organization.
- Rate limiting must operate on multiple dimensions simultaneously: requests per minute, tokens per minute, and cost per day — at user, team, and provider levels.
- Provider fallback chains combined with circuit breakers keep services resilient when upstream LLM providers degrade or go down.
- ML-based model routers (Martian, Not Diamond, Unify) select the optimal model per request, cutting costs by 40–60% at equivalent quality compared to always using a frontier model.
- The gateway is the best place to enforce compliance: geographic routing, PII filtering, and immutable audit logs can be applied centrally without modifying application code.

## Why AI Gateways Exist

Consider an organization with five teams, each building LLM-powered features. Without a gateway, each team independently:

- Manages API keys for OpenAI, Anthropic, Google, and self-hosted models
- Implements retry logic with exponential backoff
- Handles rate limiting and quota management
- Logs usage for cost tracking
- Implements fallback logic when a provider has an outage
- Negotiates and manages provider contracts

This leads to duplicated code, inconsistent error handling, no centralized cost visibility, and no ability to enforce organization-wide policies. An AI gateway consolidates all of this into a single layer.

```text
Without Gateway:                    With Gateway:
┌────────┐                          ┌────────┐
│Service A│──┐                      │Service A│──┐
└────────┘  │  ┌──────────┐        └────────┘  │
┌────────┐  ├──│ OpenAI   │        ┌────────┐  │  ┌──────────┐  ┌──────────┐
│Service B│──┤  └──────────┘        │Service B│──┼──│AI Gateway│──│ OpenAI   │
└────────┘  │  ┌──────────┐        └────────┘  │  │          │  └──────────┘
┌────────┐  ├──│ Anthropic│        ┌────────┐  │  │          │  ┌──────────┐
│Service C│──┘  └──────────┘        │Service C│──┘  │          │──│ Anthropic│
└────────┘     ┌──────────┐        └────────┘     │          │  └──────────┘
               │ Google   │                        │          │  ┌──────────┐
               └──────────┘                        │          │──│ Google   │
                                                   └──────────┘  └──────────┘
 5 services × 3 providers =                         Single integration point
 15 integrations to manage                          Centralized policies
```

## Core Architecture

An AI gateway sits in the request path between application services and LLM providers. Its architecture resembles a reverse proxy with LLM-specific middleware:

```python
class AIGateway:
    def __init__(self):
        self.middleware_chain = [
            AuthenticationMiddleware(),
            RateLimitMiddleware(),
            CacheMiddleware(),
            RequestTransformMiddleware(),
            CostTrackingMiddleware(),
            RetryMiddleware(),
            FallbackMiddleware(),
            LoadBalancerMiddleware(),
            ResponseTransformMiddleware(),
            LoggingMiddleware(),
        ]
        self.providers = {
            "openai": OpenAIProvider(),
            "anthropic": AnthropicProvider(),
            "google": GoogleProvider(),
            "self-hosted": SelfHostedProvider(),
        }

    async def handle_request(self, request: GatewayRequest) -> GatewayResponse:
        context = RequestContext(request)

        # Execute middleware chain (pre-processing)
        for middleware in self.middleware_chain:
            result = await middleware.before_request(context)
            if result.should_short_circuit:
                return result.response  # e.g., cache hit, rate limit

        # Route to provider
        provider = context.selected_provider
        response = await provider.call(context.transformed_request)

        # Execute middleware chain (post-processing, in reverse)
        for middleware in reversed(self.middleware_chain):
            response = await middleware.after_response(context, response)

        return response
```

### Request Flow

A typical request through an AI gateway follows this path:

1. **Authentication**: Verify the caller's API key or JWT. Map to an organization, team, and user.
2. **Rate limiting**: Check per-user, per-team, and per-organization rate limits.
3. **Cache lookup**: Check if an identical (or semantically similar) request has been cached.
4. **Request transformation**: Normalize the request into the target provider's format.
5. **Cost estimation**: Estimate token count and projected cost; check against budgets.
6. **Provider selection**: Choose the optimal provider based on routing rules.
7. **Retry/fallback**: If the primary provider fails, retry or fall back to alternatives.
8. **Response transformation**: Normalize the response back to the gateway's canonical format.
9. **Logging and metrics**: Record usage, latency, cost, and quality signals.

## Rate Limiting and Throttling

### Multi-Dimensional Rate Limits

LLM rate limiting must operate on multiple dimensions simultaneously:

```python
class MultiDimensionalRateLimiter:
    def __init__(self, redis: Redis):
        self.redis = redis
        self.limits = {
            # Per-user limits
            "user_rpm": TokenBucket(rate=60, capacity=60),       # 60 req/min
            "user_tpm": TokenBucket(rate=100000, capacity=200000), # 100K tok/min
            "user_daily_cost": FixedWindow(limit=10.0, window="1d"), # $10/day

            # Per-team limits
            "team_rpm": TokenBucket(rate=500, capacity=1000),
            "team_monthly_cost": FixedWindow(limit=5000.0, window="30d"),

            # Per-provider limits (to stay within provider quotas)
            "openai_rpm": TokenBucket(rate=10000, capacity=10000),
            "anthropic_rpm": TokenBucket(rate=4000, capacity=4000),
        }

    async def check(self, request: GatewayRequest) -> RateLimitResult:
        checks = [
            self._check_limit(f"user:{request.user_id}:rpm",
                            self.limits["user_rpm"], 1),
            self._check_limit(f"user:{request.user_id}:tpm",
                            self.limits["user_tpm"], request.estimated_tokens),
            self._check_limit(f"user:{request.user_id}:daily_cost",
                            self.limits["user_daily_cost"], request.estimated_cost),
            self._check_limit(f"team:{request.team_id}:rpm",
                            self.limits["team_rpm"], 1),
            self._check_limit(f"provider:{request.provider}:rpm",
                            self.limits[f"{request.provider}_rpm"], 1),
        ]

        results = await asyncio.gather(*checks)
        violations = [r for r in results if not r.allowed]

        if violations:
            # Return the most restrictive violation
            return RateLimitResult(
                allowed=False,
                retry_after=max(v.retry_after for v in violations),
                violated_limit=violations[0].limit_name,
            )
        return RateLimitResult(allowed=True)
```

### Token-Based Rate Limiting

Unlike traditional API rate limiting that counts requests, LLM rate limiting must account for token consumption. A single request generating 4000 tokens consumes vastly more resources than one generating 50 tokens:

```python
class TokenAwareRateLimiter:
    async def check_and_reserve(self, request: GatewayRequest) -> RateLimitResult:
        estimated_input_tokens = count_tokens(request.messages, request.model)
        estimated_output_tokens = request.max_tokens or 1024
        estimated_total = estimated_input_tokens + estimated_output_tokens

        # Reserve tokens upfront
        reserved = await self.token_bucket.try_consume(estimated_total)
        if not reserved:
            return RateLimitResult(allowed=False,
                                  retry_after=self.token_bucket.time_until_available(estimated_total))

        # After response, reconcile actual vs estimated
        # Return excess reservation to the bucket
        return RateLimitResult(allowed=True,
                              reservation_id=reservation.id,
                              estimated_tokens=estimated_total)

    async def reconcile(self, reservation_id: str, actual_tokens: int):
        reservation = await self.get_reservation(reservation_id)
        excess = reservation.estimated_tokens - actual_tokens
        if excess > 0:
            await self.token_bucket.refund(excess)
```

### Graceful Degradation Under Load

When rate limits are approached, a gateway can implement graduated responses rather than hard rejections:

```python
class GracefulDegradation:
    async def apply(self, request: GatewayRequest, utilization: float) -> GatewayRequest:
        if utilization < 0.7:
            return request  # Normal operation

        elif utilization < 0.85:
            # Reduce max_tokens for non-critical requests
            if request.priority != "critical":
                request.max_tokens = min(request.max_tokens, 512)
            return request

        elif utilization < 0.95:
            # Route to cheaper/faster models
            if request.priority == "low":
                request.model = self.get_cheaper_model(request.model)
            request.max_tokens = min(request.max_tokens, 256)
            return request

        else:
            # Reject non-critical requests
            if request.priority != "critical":
                raise RateLimitError("System at capacity. Only critical requests accepted.")
            return request
```

## Provider Fallback Chains

### Fallback Configuration

A fallback chain defines the order in which providers are tried when the primary provider fails:

```python
@dataclass
class FallbackConfig:
    primary: ProviderConfig
    fallbacks: list[ProviderConfig]
    conditions: list[FallbackCondition]

# Example configuration
fallback_config = FallbackConfig(
    primary=ProviderConfig(
        provider="anthropic",
        model="claude-sonnet-4-20250514",
        timeout_ms=30000,
    ),
    fallbacks=[
        ProviderConfig(
            provider="openai",
            model="gpt-4o",
            timeout_ms=30000,
        ),
        ProviderConfig(
            provider="google",
            model="gemini-2.0-flash",
            timeout_ms=30000,
        ),
        ProviderConfig(
            provider="self-hosted",
            model="llama-3.1-70b",
            timeout_ms=60000,
        ),
    ],
    conditions=[
        FallbackCondition.ON_ERROR_5XX,
        FallbackCondition.ON_TIMEOUT,
        FallbackCondition.ON_RATE_LIMIT,
        # Do NOT fall back on 4xx client errors (bad request, auth failure)
    ]
)
```

### Circuit Breaker Pattern

> **Tip:** Never fall back on 4xx client errors (bad request, auth failure) — only on 5xx server errors, timeouts, and rate limits. Falling back on client errors wastes budget and obscures bugs.

Blindly retrying a failing provider wastes time and can exacerbate outages. The circuit breaker pattern tracks provider health and stops sending requests to unhealthy providers:

```python
class CircuitBreaker:
    def __init__(self, failure_threshold=5, recovery_timeout=60, half_open_max=3):
        self.failure_threshold = failure_threshold
        self.recovery_timeout = recovery_timeout
        self.half_open_max = half_open_max
        self.state = "closed"          # closed, open, half_open
        self.failure_count = 0
        self.last_failure_time = None
        self.half_open_successes = 0

    async def call(self, provider_fn, request):
        if self.state == "open":
            if time.time() - self.last_failure_time > self.recovery_timeout:
                self.state = "half_open"
                self.half_open_successes = 0
            else:
                raise CircuitOpenError(f"Circuit open, retry after "
                                      f"{self.recovery_timeout}s")

        try:
            response = await provider_fn(request)

            if self.state == "half_open":
                self.half_open_successes += 1
                if self.half_open_successes >= self.half_open_max:
                    self.state = "closed"
                    self.failure_count = 0

            return response

        except (TimeoutError, ServerError, RateLimitError) as e:
            self.failure_count += 1
            self.last_failure_time = time.time()

            if self.failure_count >= self.failure_threshold:
                self.state = "open"

            raise

class FallbackHandler:
    def __init__(self, config: FallbackConfig):
        self.config = config
        self.circuit_breakers = {
            p.provider: CircuitBreaker()
            for p in [config.primary] + config.fallbacks
        }

    async def execute(self, request: GatewayRequest) -> GatewayResponse:
        providers = [self.config.primary] + self.config.fallbacks
        last_error = None

        for provider_config in providers:
            breaker = self.circuit_breakers[provider_config.provider]
            try:
                response = await breaker.call(
                    lambda req: self.call_provider(provider_config, req),
                    request
                )
                if provider_config != self.config.primary:
                    logger.warning(f"Served by fallback: {provider_config.provider}")
                return response

            except CircuitOpenError:
                logger.info(f"Circuit open for {provider_config.provider}, skipping")
                continue
            except Exception as e:
                last_error = e
                logger.error(f"Provider {provider_config.provider} failed: {e}")
                continue

        raise AllProvidersFailedError(
            f"All providers exhausted. Last error: {last_error}"
        )
```

## Multi-Provider Routing Strategies

### Routing Strategy Overview

| Strategy | Optimizes For | Trade-off | Best Use Case |
|----------|--------------|-----------|---------------|
| Cost-optimized | Lowest price | May sacrifice quality | Batch jobs, low-stakes tasks |
| Latency-optimized | Fastest TTFT | Cost varies | Real-time user interactions |
| Hedge routing | Tail latency (p99) | Higher cost (multiple calls) | High-value, latency-critical flows |
| ML-based routing | Quality/cost ratio | Classifier maintenance overhead | High-volume mixed workloads |

### Model Mapping

Different providers offer models with similar capabilities under different names. A gateway maintains a mapping that allows applications to request capabilities rather than specific models:

```python
MODEL_MAP = {
    # Canonical name -> provider-specific models
    "best": {
        "anthropic": "claude-opus-4-20250514",
        "openai": "gpt-4.5-preview",
        "google": "gemini-2.5-pro",
    },
    "balanced": {
        "anthropic": "claude-sonnet-4-20250514",
        "openai": "gpt-4o",
        "google": "gemini-2.0-flash",
    },
    "fast": {
        "anthropic": "claude-haiku-3-5",
        "openai": "gpt-4o-mini",
        "google": "gemini-2.0-flash-lite",
    },
    "embedding": {
        "openai": "text-embedding-3-large",
        "google": "text-embedding-004",
        "self-hosted": "bge-m3",
    }
}

class ModelMapper:
    def resolve(self, canonical_name: str, provider: str) -> str:
        if canonical_name in MODEL_MAP:
            return MODEL_MAP[canonical_name].get(provider)
        # If it's already a specific model name, pass through
        return canonical_name
```

### Cost-Optimized Routing

Route to the cheapest provider that meets quality requirements:

```python
class CostOptimizedRouter:
    def __init__(self):
        # Cost per million tokens (input, output)
        self.pricing = {
            ("anthropic", "claude-sonnet"): (3.0, 15.0),
            ("openai", "gpt-4o"): (2.5, 10.0),
            ("google", "gemini-2.0-flash"): (0.10, 0.40),
            ("self-hosted", "llama-70b"): (0.20, 0.60),
        }

    async def select_provider(self, request: GatewayRequest) -> ProviderConfig:
        estimated_input = count_tokens(request.messages)
        estimated_output = request.max_tokens or 1024

        candidates = []
        for (provider, model), (input_price, output_price) in self.pricing.items():
            estimated_cost = (
                estimated_input * input_price / 1_000_000 +
                estimated_output * output_price / 1_000_000
            )

            # Check if provider is healthy
            if self.is_healthy(provider):
                candidates.append(ProviderCandidate(
                    provider=provider,
                    model=model,
                    estimated_cost=estimated_cost,
                ))

        # Sort by cost and return cheapest
        candidates.sort(key=lambda c: c.estimated_cost)
        return candidates[0] if candidates else self.default_provider
```

### Latency-Optimized Routing

Route to the provider with the lowest current latency, using a moving average of recent response times:

```python
class LatencyOptimizedRouter:
    def __init__(self):
        self.latency_tracker = {}  # provider -> ExponentialMovingAverage

    async def select_provider(self, request: GatewayRequest) -> ProviderConfig:
        candidates = []
        for provider in self.available_providers:
            avg_ttft = self.latency_tracker.get(provider, {}).get("ttft_p50", float("inf"))
            candidates.append((provider, avg_ttft))

        # Select the fastest responsive provider
        candidates.sort(key=lambda c: c[1])
        return candidates[0][0]

    def record_latency(self, provider: str, ttft_ms: float, total_ms: float):
        if provider not in self.latency_tracker:
            self.latency_tracker[provider] = ExponentialMovingAverage(alpha=0.1)
        self.latency_tracker[provider].update(ttft_ms)
```

### Hedge Routing

For latency-critical requests, send the request to multiple providers simultaneously and use the first response:

```python
class HedgeRouter:
    async def execute(self, request: GatewayRequest,
                     providers: list[ProviderConfig],
                     max_hedges: int = 2) -> GatewayResponse:
        """Send to multiple providers, use first response."""
        tasks = [
            asyncio.create_task(self.call_provider(provider, request))
            for provider in providers[:max_hedges]
        ]

        # Wait for first successful response
        done, pending = await asyncio.wait(
            tasks,
            return_when=asyncio.FIRST_COMPLETED
        )

        # Cancel remaining requests to avoid unnecessary cost
        for task in pending:
            task.cancel()

        # Return the first successful result
        for task in done:
            if not task.exception():
                return task.result()

        # All hedged requests failed; raise the first error
        raise done.pop().exception()
```

Hedge routing reduces tail latency but increases cost (paying for multiple calls). It is best reserved for high-value, latency-critical requests.

> **Note:** Always cancel pending hedged tasks as soon as the first response arrives. Failing to do so turns a latency optimization into a cost multiplier.

## Request/Response Transformation

### Canonical Format

The gateway defines a canonical request/response format and transforms to/from each provider's API:

```python
class RequestTransformer:
    """Transform canonical gateway format to provider-specific format."""

    def to_openai(self, request: GatewayRequest) -> dict:
        return {
            "model": request.model,
            "messages": request.messages,
            "temperature": request.temperature,
            "max_tokens": request.max_tokens,
            "tools": self._transform_tools_openai(request.tools),
            "stream": request.stream,
        }

    def to_anthropic(self, request: GatewayRequest) -> dict:
        system_message = None
        messages = []

        for msg in request.messages:
            if msg["role"] == "system":
                system_message = msg["content"]
            else:
                messages.append(msg)

        body = {
            "model": request.model,
            "messages": messages,
            "max_tokens": request.max_tokens or 1024,  # Required by Anthropic
            "temperature": request.temperature,
            "stream": request.stream,
        }

        if system_message:
            body["system"] = system_message

        if request.tools:
            body["tools"] = self._transform_tools_anthropic(request.tools)

        return body

    def to_google(self, request: GatewayRequest) -> dict:
        return {
            "contents": self._messages_to_google_contents(request.messages),
            "generationConfig": {
                "temperature": request.temperature,
                "maxOutputTokens": request.max_tokens,
            },
            "tools": self._transform_tools_google(request.tools),
        }
```

### Stream Normalization

Each provider has a slightly different SSE streaming format. The gateway normalizes all streams to a consistent format:

```python
class StreamNormalizer:
    async def normalize_anthropic_stream(self, raw_stream) -> AsyncIterator[StreamChunk]:
        async for event in raw_stream:
            if event.type == "content_block_delta":
                yield StreamChunk(
                    type="content",
                    content=event.delta.text,
                    model=event.model,
                )
            elif event.type == "message_delta":
                yield StreamChunk(
                    type="usage",
                    usage=Usage(
                        output_tokens=event.usage.output_tokens,
                    ),
                )
            elif event.type == "message_stop":
                yield StreamChunk(type="done")

    async def normalize_openai_stream(self, raw_stream) -> AsyncIterator[StreamChunk]:
        async for chunk in raw_stream:
            if chunk.choices[0].delta.content:
                yield StreamChunk(
                    type="content",
                    content=chunk.choices[0].delta.content,
                    model=chunk.model,
                )
            if chunk.choices[0].finish_reason:
                yield StreamChunk(type="done")
```

## Caching Layers

The gateway is the ideal location for caching because it sees all requests across all services:

```python
class GatewayCache:
    def __init__(self, redis: Redis, semantic_index=None):
        self.redis = redis
        self.semantic = semantic_index  # Optional vector store

    async def get(self, request: GatewayRequest) -> Optional[GatewayResponse]:
        # Only cache deterministic requests
        if request.temperature and request.temperature > 0:
            return None

        # Level 1: Exact match cache
        exact_key = self._exact_cache_key(request)
        cached = self.redis.get(exact_key)
        if cached:
            return GatewayResponse.from_cache(json.loads(cached))

        # Level 2: Semantic cache (if enabled)
        if self.semantic:
            similar = await self.semantic.find_similar(
                request.messages[-1]["content"],
                threshold=0.97,
            )
            if similar:
                return GatewayResponse.from_cache(similar.response)

        return None

    async def set(self, request: GatewayRequest, response: GatewayResponse):
        if request.temperature and request.temperature > 0:
            return

        exact_key = self._exact_cache_key(request)
        self.redis.setex(
            exact_key,
            3600,  # 1-hour TTL
            json.dumps(response.to_cache_dict())
        )

        if self.semantic:
            await self.semantic.index(
                text=request.messages[-1]["content"],
                response=response.to_cache_dict(),
            )
```

## The Gateway Ecosystem

### LiteLLM

LiteLLM is the most widely adopted open-source AI gateway. It provides a unified OpenAI-compatible API that routes to 100+ LLM providers:

```python
from litellm import completion

# Same interface, different providers
response = completion(
    model="anthropic/claude-sonnet-4-20250514",
    messages=[{"role": "user", "content": "Hello"}],
    fallbacks=["openai/gpt-4o", "gemini/gemini-2.0-flash"],
    timeout=30,
)

# LiteLLM proxy server (self-hosted gateway)
# config.yaml:
# model_list:
#   - model_name: best-model
#     litellm_params:
#       model: anthropic/claude-sonnet-4-20250514
#       api_key: sk-ant-...
#     model_info:
#       max_tokens: 8192
#   - model_name: best-model  # Same name = load balanced
#     litellm_params:
#       model: openai/gpt-4o
#       api_key: sk-...
#
# router_settings:
#   routing_strategy: latency-based-routing
#   allowed_fails: 3
#   cooldown_time: 60
```

### Portkey

Portkey provides a managed AI gateway with a focus on reliability and observability. Its "AI Gateway" product offers a configuration-driven approach:

```python
from portkey_ai import Portkey

portkey = Portkey(
    api_key="PORTKEY_API_KEY",
    config={
        "strategy": {
            "mode": "fallback",
        },
        "targets": [
            {
                "provider": "anthropic",
                "api_key": "ANTHROPIC_KEY",
                "override_params": {"model": "claude-sonnet-4-20250514"},
                "weight": 1,
            },
            {
                "provider": "openai",
                "api_key": "OPENAI_KEY",
                "override_params": {"model": "gpt-4o"},
                "weight": 1,
            },
        ],
        "cache": {"mode": "semantic", "max_age": 3600},
    }
)

response = portkey.chat.completions.create(
    messages=[{"role": "user", "content": "Hello"}],
    max_tokens=256,
)
```

### Cloudflare AI Gateway

Cloudflare's AI Gateway runs at the edge, providing caching, rate limiting, and analytics close to users with minimal latency overhead:

```javascript
// Cloudflare AI Gateway endpoint
const response = await fetch(
    "https://gateway.ai.cloudflare.com/v1/{account_id}/{gateway_id}/openai/chat/completions",
    {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${OPENAI_API_KEY}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            model: "gpt-4o",
            messages: [{ role: "user", content: "Hello" }],
        }),
    }
);
```

Cloudflare's edge-based approach adds only 1-5ms of latency (compared to 20-50ms for a centralized gateway) and provides built-in analytics, caching, and rate limiting through their dashboard.

### Gateway Options Compared

| Gateway | Deployment | Best For | Latency Overhead |
|---------|-----------|----------|-----------------|
| LiteLLM | Self-hosted | Full control, 100+ providers | 20–50ms (centralized) |
| Portkey | Managed SaaS | Reliability + observability focus | Varies |
| Cloudflare AI Gateway | Edge (managed) | Low-latency, global distribution | 1–5ms |

## Authentication and Access Control

### Multi-Tenant Key Management

The gateway manages provider API keys centrally, issuing its own keys to internal consumers:

```python
class GatewayAuthManager:
    async def authenticate(self, request: Request) -> AuthContext:
        gateway_key = request.headers.get("Authorization", "").replace("Bearer ", "")

        # Validate gateway key
        key_info = await self.key_store.lookup(gateway_key)
        if not key_info:
            raise AuthenticationError("Invalid gateway key")

        if key_info.is_expired:
            raise AuthenticationError("Key expired")

        return AuthContext(
            org_id=key_info.org_id,
            team_id=key_info.team_id,
            user_id=key_info.user_id,
            allowed_models=key_info.allowed_models,
            rate_limit_tier=key_info.rate_limit_tier,
            budget_limit_usd=key_info.budget_limit_usd,
        )

    def get_provider_key(self, provider: str, org_id: str) -> str:
        """Retrieve the actual provider API key (never exposed to consumers)."""
        return self.vault.get_secret(f"provider_keys/{org_id}/{provider}")
```

### Model-Level Access Control

Not all teams should have access to all models. A gateway can enforce model-level permissions:

```python
class ModelAccessControl:
    def check_access(self, auth: AuthContext, requested_model: str) -> bool:
        # Check if the model is in the user's allowed list
        if auth.allowed_models and requested_model not in auth.allowed_models:
            raise ForbiddenError(
                f"Model {requested_model} not in allowed models: "
                f"{auth.allowed_models}"
            )

        # Check cost tier restrictions
        model_tier = self.get_model_tier(requested_model)
        if model_tier == "frontier" and auth.rate_limit_tier == "basic":
            raise ForbiddenError(
                "Frontier models require 'premium' rate limit tier"
            )

        return True
```

## ML-Based Model Routing

The routing strategies discussed so far -- cost-optimized, latency-optimized, hedge -- rely on static heuristics. A newer class of systems uses trained classifiers to dynamically route each request to the model most likely to produce the best result for that specific input. This shifts routing from "which provider is cheapest/fastest right now" to "which model will answer this particular question best."

### The Routing Problem

Not all prompts are created equal. A simple factual lookup ("What is the capital of France?") can be handled perfectly by a small, fast model, while a complex multi-step reasoning problem benefits from a frontier model. Sending every request to the most capable model wastes money; sending every request to the cheapest model sacrifices quality. The optimal strategy routes each request individually based on its characteristics.

```python
class MLModelRouter:
    """Route requests to the optimal model using a trained classifier."""

    def __init__(self, classifier_path: str):
        self.classifier = load_model(classifier_path)
        self.model_configs = {
            "simple": ProviderConfig(provider="openai", model="gpt-4o-mini"),
            "moderate": ProviderConfig(provider="anthropic", model="claude-haiku-3-5"),
            "complex": ProviderConfig(provider="anthropic", model="claude-sonnet-4-20250514"),
            "frontier": ProviderConfig(provider="anthropic", model="claude-opus-4-20250514"),
        }

    async def select_provider(self, request: GatewayRequest) -> ProviderConfig:
        # Extract features from the request
        features = self._extract_features(request)

        # Classify difficulty tier
        tier_probabilities = self.classifier.predict_proba(features)
        selected_tier = self._select_tier(tier_probabilities, request.quality_target)

        return self.model_configs[selected_tier]

    def _extract_features(self, request: GatewayRequest) -> dict:
        prompt_text = " ".join(m["content"] for m in request.messages)
        return {
            "prompt_length": len(prompt_text.split()),
            "num_messages": len(request.messages),
            "has_system_prompt": any(m["role"] == "system" for m in request.messages),
            "has_tools": bool(request.tools),
            "num_tools": len(request.tools or []),
            "contains_code": bool(re.search(r"```|def |function |class ", prompt_text)),
            "contains_math": bool(re.search(r"\d+[\+\-\*/]\d+|equation|calculate", prompt_text)),
            "question_complexity": self._estimate_complexity(prompt_text),
            "embedding": self._get_prompt_embedding(prompt_text),
        }

    def _select_tier(self, probabilities: dict, quality_target: float) -> str:
        """Select the cheapest tier that meets the quality target."""
        tiers_by_cost = ["simple", "moderate", "complex", "frontier"]
        cumulative_quality = 0.0

        for tier in tiers_by_cost:
            cumulative_quality += probabilities.get(tier, 0)
            if cumulative_quality >= quality_target:
                return tier

        return "frontier"  # Default to highest quality
```

### Production Routing Systems

Several companies have built production routing systems around this idea:

**Martian** trains routing models on large-scale evaluation datasets, learning which LLM performs best on which types of inputs. Their router takes a prompt, evaluates it against learned performance profiles, and selects the model with the highest expected quality at the lowest cost. The key insight is that routing decisions can be made in under 5ms, adding negligible latency while potentially cutting costs by 40-60% at equivalent quality.

**Not Diamond** approaches routing as a recommendation problem. Their system maintains performance matrices across models and task types, updated continuously from production feedback. When a request arrives, the router predicts which model will score highest on that specific task and routes accordingly. They publish benchmarks showing their router outperforming any single model because it selects the best model per-question.

**Unify** provides a routing API that lets developers specify quality/cost/latency tradeoffs as constraints. Given a prompt and a target like "maximize quality with cost under $0.002 per request," their router selects the optimal model from their supported set. This constraint-based interface is particularly useful because it lets product teams express business requirements directly rather than choosing models manually.

### Training the Router

The classifier itself is typically a lightweight model -- a fine-tuned BERT, a small feedforward network over embeddings, or even a logistic regression over engineered features.

Training data comes from running evaluation suites across all candidate models and recording which model produced the best output for each input. The router's accuracy improves over time as production feedback (user ratings, downstream task success) augments the training data. This creates a flywheel: more routing decisions generate more performance data, which trains a better router, which makes better decisions.

For a deeper treatment of how model selection interacts with cost management, see [Article 39: Cost Optimization](/cost-optimization).

> **Tip:** Even a simple heuristic router (short prompt → small model, code/math → frontier model) delivers meaningful cost savings before you invest in training a full ML classifier.

## Prompt Adaptation

Routing between providers is not just a matter of swapping model names and API endpoints. Different providers handle prompts differently in subtle ways that can significantly affect output quality. A gateway that routes between providers without adapting prompts risks degraded performance that erases the benefits of routing.

### System Prompt Handling

The most visible difference across providers is system prompt handling. OpenAI and Google accept system prompts as a message with `role: "system"` in the messages array. Anthropic uses a top-level `system` field separate from the messages array. This structural difference is straightforward to handle in the request transformer, but the behavioral implications are subtler.

Different models respond differently to system prompt instructions. A system prompt that works well with Claude -- perhaps relying on its tendency to follow detailed instructions closely -- may need restructuring for GPT-4o, which may respond better to shorter, more directive system prompts. A production gateway can maintain provider-specific system prompt variants:

```python
class PromptAdapter:
    """Adapt prompts when routing between providers."""

    def __init__(self):
        self.system_prompt_variants = {}
        self.tool_format_registry = {}

    def adapt_request(self, request: GatewayRequest,
                      target_provider: str) -> GatewayRequest:
        adapted = request.copy()

        # Adapt system prompt if variants exist
        adapted.messages = self._adapt_system_prompt(
            request.messages, target_provider, request.prompt_id
        )

        # Adapt tool definitions to target provider format
        if request.tools:
            adapted.tools = self._adapt_tools(request.tools, target_provider)

        # Adapt provider-specific parameters
        adapted = self._adapt_parameters(adapted, target_provider)

        return adapted

    def _adapt_system_prompt(self, messages: list, provider: str,
                              prompt_id: str = None) -> list:
        if not prompt_id or prompt_id not in self.system_prompt_variants:
            return messages  # No variants registered, pass through

        variants = self.system_prompt_variants[prompt_id]
        if provider not in variants:
            return messages  # No variant for this provider

        adapted_messages = []
        for msg in messages:
            if msg["role"] == "system":
                adapted_messages.append({
                    "role": "system",
                    "content": variants[provider],
                })
            else:
                adapted_messages.append(msg)

        return adapted_messages
```

### Tool Format Differences

Tool calling -- function calling in OpenAI's terminology -- is where provider APIs diverge most significantly. The schema structure, parameter naming, and response format all differ:

```python
class ToolFormatAdapter:
    def to_openai_tools(self, canonical_tools: list[dict]) -> list[dict]:
        return [{
            "type": "function",
            "function": {
                "name": tool["name"],
                "description": tool["description"],
                "parameters": tool["input_schema"],
            }
        } for tool in canonical_tools]

    def to_anthropic_tools(self, canonical_tools: list[dict]) -> list[dict]:
        return [{
            "name": tool["name"],
            "description": tool["description"],
            "input_schema": tool["input_schema"],
        } for tool in canonical_tools]

    def to_google_tools(self, canonical_tools: list[dict]) -> list[dict]:
        return [{
            "functionDeclarations": [{
                "name": tool["name"],
                "description": tool["description"],
                "parameters": self._convert_to_google_schema(tool["input_schema"]),
            } for tool in canonical_tools]
        }]

    def normalize_tool_response(self, response: dict, provider: str) -> dict:
        """Normalize tool call responses back to canonical format."""
        if provider == "openai":
            tool_calls = response["choices"][0]["message"].get("tool_calls", [])
            return [{
                "id": tc["id"],
                "name": tc["function"]["name"],
                "arguments": json.loads(tc["function"]["arguments"]),
            } for tc in tool_calls]

        elif provider == "anthropic":
            content_blocks = response.get("content", [])
            return [{
                "id": block["id"],
                "name": block["name"],
                "arguments": block["input"],
            } for block in content_blocks if block["type"] == "tool_use"]
```

Beyond structural differences, models also vary in how reliably they follow tool schemas. Some models require explicit instructions in the system prompt to prefer tool use over text responses, while others default to structured tool calls when tools are available.

> **Tip:** A mature gateway tracks tool call success rates per provider and adjusts routing accordingly -- if a particular model frequently generates malformed tool arguments for a given function schema, the router should learn to avoid that pairing.

## Gateway Observability and Analytics

An AI gateway occupies a unique position in the infrastructure stack: every LLM request flows through it, making it the single richest source of operational data about an organization's AI usage. The gateway sees what no individual service can -- aggregate patterns across all teams, providers, and models.

### Unified Cost and Latency Dashboards

Because the gateway normalizes requests across providers, it can produce apples-to-apples comparisons that would be impossible when teams manage their own provider integrations:

```python
class GatewayAnalytics:
    """Aggregate analytics across all gateway traffic."""

    async def record_request(self, context: RequestContext, response: GatewayResponse):
        metrics = {
            "timestamp": datetime.utcnow().isoformat(),
            "org_id": context.auth.org_id,
            "team_id": context.auth.team_id,
            "user_id": context.auth.user_id,
            "provider": context.selected_provider,
            "model": context.resolved_model,
            "canonical_model": context.canonical_model,
            "input_tokens": response.usage.input_tokens,
            "output_tokens": response.usage.output_tokens,
            "total_tokens": response.usage.total_tokens,
            "cost_usd": self._calculate_cost(
                context.selected_provider,
                context.resolved_model,
                response.usage,
            ),
            "ttft_ms": response.time_to_first_token_ms,
            "total_latency_ms": response.total_latency_ms,
            "cache_hit": context.cache_hit,
            "fallback_used": context.fallback_used,
            "fallback_reason": context.fallback_reason,
            "status": "success" if not response.error else "error",
            "error_type": response.error_type,
        }

        await self.metrics_store.write(metrics)
        await self._update_real_time_counters(metrics)

    async def get_cost_breakdown(self, org_id: str,
                                  period: str = "30d") -> dict:
        return await self.metrics_store.query(f"""
            SELECT
                team_id,
                provider,
                canonical_model,
                COUNT(*) as request_count,
                SUM(cost_usd) as total_cost,
                AVG(total_latency_ms) as avg_latency,
                SUM(CASE WHEN cache_hit THEN 1 ELSE 0 END)::float
                    / COUNT(*) as cache_hit_rate,
                SUM(CASE WHEN fallback_used THEN 1 ELSE 0 END)::float
                    / COUNT(*) as fallback_rate
            FROM gateway_metrics
            WHERE org_id = '{org_id}'
              AND timestamp > NOW() - INTERVAL '{period}'
            GROUP BY team_id, provider, canonical_model
            ORDER BY total_cost DESC
        """)
```

### Connecting to Observability Platforms

The gateway should export traces in standard formats (OpenTelemetry) so they integrate with existing observability infrastructure. For LLM-specific observability, platforms like Langfuse provide purpose-built tooling for tracing multi-step LLM pipelines, tracking prompt versions, and measuring output quality. A gateway can push structured trace data directly into these platforms:

```python
class GatewayTraceExporter:
    """Export gateway traces to observability platforms."""

    def __init__(self, langfuse_client=None, otel_exporter=None):
        self.langfuse = langfuse_client
        self.otel = otel_exporter

    async def export_trace(self, context: RequestContext,
                           response: GatewayResponse):
        # OpenTelemetry span for general observability
        if self.otel:
            with self.otel.start_span("llm.gateway.request") as span:
                span.set_attribute("llm.provider", context.selected_provider)
                span.set_attribute("llm.model", context.resolved_model)
                span.set_attribute("llm.tokens.input", response.usage.input_tokens)
                span.set_attribute("llm.tokens.output", response.usage.output_tokens)
                span.set_attribute("llm.cost.usd", response.cost_usd)
                span.set_attribute("llm.latency.ttft_ms", response.time_to_first_token_ms)

        # Langfuse trace for LLM-specific observability
        if self.langfuse:
            trace = self.langfuse.trace(
                name=f"gateway.{context.canonical_model}",
                metadata={
                    "gateway_request_id": context.request_id,
                    "team_id": context.auth.team_id,
                    "routing_strategy": context.routing_strategy,
                    "fallback_used": context.fallback_used,
                },
            )
            trace.generation(
                name=context.resolved_model,
                model=context.resolved_model,
                input=context.request.messages,
                output=response.content,
                usage={
                    "input": response.usage.input_tokens,
                    "output": response.usage.output_tokens,
                    "total": response.usage.total_tokens,
                    "unit": "TOKENS",
                },
                metadata={
                    "provider": context.selected_provider,
                    "cost_usd": response.cost_usd,
                    "cache_hit": context.cache_hit,
                },
            )
```

The gateway-to-observability pipeline is particularly powerful because it provides a single integration point. Rather than instrumenting every service that calls an LLM, you instrument the gateway once and get visibility into all LLM usage across the organization. For a comprehensive treatment of LLM observability beyond the gateway layer, see [Article 40: Observability](/observability).

## Compliance and Data Residency

As AI regulation matures, gateways become the natural enforcement point for compliance requirements. Because every LLM request passes through the gateway, it can enforce data handling policies consistently without requiring changes to application code.

### Geographic Routing for Regulatory Compliance

Data residency regulations -- the EU's GDPR, Germany's BSI requirements, financial sector rules like DORA -- may require that certain data never leaves a geographic region. A gateway can enforce geographic routing policies based on the data's classification or the user's jurisdiction:

```python
class ComplianceRouter:
    """Route requests based on data residency and compliance requirements."""

    def __init__(self):
        self.region_providers = {
            "eu": [
                ProviderConfig(provider="azure-eu", model="gpt-4o",
                              endpoint="https://eu-west.api.cognitive.microsoft.com"),
                ProviderConfig(provider="self-hosted-eu", model="llama-3.1-70b",
                              endpoint="https://llm.eu-west-1.internal"),
            ],
            "us": [
                ProviderConfig(provider="openai", model="gpt-4o"),
                ProviderConfig(provider="anthropic", model="claude-sonnet-4-20250514"),
            ],
            "ap": [
                ProviderConfig(provider="azure-ap", model="gpt-4o",
                              endpoint="https://ap-southeast.api.cognitive.microsoft.com"),
            ],
        }

    async def select_provider(self, request: GatewayRequest,
                               auth: AuthContext) -> ProviderConfig:
        required_region = self._determine_required_region(request, auth)

        if required_region:
            eligible = self.region_providers.get(required_region, [])
            if not eligible:
                raise ComplianceError(
                    f"No providers available in required region: {required_region}"
                )
            # Apply normal routing logic within the eligible set
            return self._select_best(eligible, request)

        # No residency requirement -- use global routing
        return self._global_select(request)

    def _determine_required_region(self, request: GatewayRequest,
                                    auth: AuthContext) -> str | None:
        # Check user jurisdiction
        if auth.jurisdiction == "eu":
            return "eu"

        # Check data classification
        if request.metadata.get("data_classification") == "eu_pii":
            return "eu"

        # Check team-level compliance policy
        team_policy = self.compliance_policies.get(auth.team_id)
        if team_policy and team_policy.required_region:
            return team_policy.required_region

        return None
```

### PII Filtering at the Gateway Layer

A gateway can inspect and sanitize requests before they reach external LLM providers, stripping or masking personally identifiable information. This is especially important when using third-party API providers where data may be logged or used for training:

```python
class PIIFilter:
    """Detect and mask PII before requests reach external providers."""

    def __init__(self):
        self.patterns = {
            "email": re.compile(r'\b[\w.+-]+@[\w-]+\.[\w.-]+\b'),
            "phone": re.compile(r'\b\d{3}[-.]?\d{3}[-.]?\d{4}\b'),
            "ssn": re.compile(r'\b\d{3}-\d{2}-\d{4}\b'),
            "credit_card": re.compile(r'\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b'),
        }
        # For production use, supplement regex with NER models
        self.ner_model = load_ner_model("pii-detection-v2")

    async def filter_request(self, request: GatewayRequest,
                              policy: PIIPolicy) -> GatewayRequest:
        if policy.mode == "disabled":
            return request

        filtered = request.copy()
        pii_detections = []

        for i, message in enumerate(filtered.messages):
            content = message["content"]

            # Regex-based detection
            for pii_type, pattern in self.patterns.items():
                matches = pattern.findall(content)
                for match in matches:
                    pii_detections.append(PIIDetection(
                        type=pii_type, value=match, message_index=i
                    ))

            # NER-based detection for names, addresses, etc.
            ner_results = self.ner_model.predict(content)
            for entity in ner_results:
                if entity.label in ("PERSON", "ADDRESS", "ORG"):
                    pii_detections.append(PIIDetection(
                        type=entity.label.lower(), value=entity.text,
                        message_index=i
                    ))

        if not pii_detections:
            return filtered

        if policy.mode == "block":
            raise PIIBlockedError(
                f"Request blocked: {len(pii_detections)} PII instances detected. "
                f"Types: {set(d.type for d in pii_detections)}"
            )

        elif policy.mode == "mask":
            for detection in pii_detections:
                msg = filtered.messages[detection.message_index]
                placeholder = f"[{detection.type.upper()}_REDACTED]"
                msg["content"] = msg["content"].replace(
                    detection.value, placeholder
                )

        return filtered
```

The gateway can apply different PII policies per team or data classification level. An internal HR chatbot processing employee records might require strict PII masking when calling external providers but allow unmasked calls to self-hosted models within the organization's own infrastructure. Audit logs at the gateway layer record which requests contained PII, which policy was applied, and whether data was masked or blocked -- critical evidence for regulatory compliance audits.

> **Note:** Regex alone is not sufficient for reliable PII detection. Supplement pattern matching with an NER model to catch names, addresses, and other unstructured personal data that regexes miss.

For organizations operating under the EU AI Act or similar regulatory frameworks, the gateway's compliance layer provides the technical controls that governance policies require. The gateway's centralized audit log, combined with its PII filtering and geographic routing capabilities, directly addresses the transparency and accountability obligations that AI regulations impose. For a thorough examination of AI governance requirements and how to build compliant systems, see [Article 47: AI Governance](/ai-governance).

## Key Takeaways

- **AI gateways are the control plane for LLM traffic**, providing centralized management of provider keys, rate limiting, fallback logic, cost tracking, and request transformation across an organization.
- **Multi-dimensional rate limiting** is essential -- limit by requests per minute, tokens per minute, and cost per day, applied at user, team, and organization levels simultaneously.
- **Circuit breakers prevent cascading failures** when providers experience outages. Automatically stop routing to unhealthy providers and periodically probe for recovery.
- **Provider fallback chains** should be ordered by preference (quality, cost, or latency) and triggered only on server errors and timeouts, not client errors.
- **Request/response transformation** enables provider-agnostic applications. The gateway normalizes between OpenAI, Anthropic, and Google formats so applications code against a single API.
- **The gateway is the optimal caching location** because it sees all traffic across all services, maximizing cache hit rates through exact-match and semantic caching.
- **ML-based model routing** (Martian, Not Diamond, Unify) goes beyond static heuristics by using trained classifiers to select the optimal model per-request, cutting costs by 40-60% at equivalent quality.
- **Prompt adaptation is essential for multi-provider routing** -- system prompt handling, tool calling formats, and parameter semantics differ across providers, and naive routing without adaptation degrades output quality.
- **The gateway is the richest observability data source** in the AI stack. A single instrumentation point captures cost, latency, cache hit rates, and fallback frequency across all teams, providers, and models.
- **Compliance and data residency** enforcement belongs at the gateway layer. Geographic routing, PII filtering, and audit logging can be applied consistently to all LLM traffic without modifying application code.
- **LiteLLM, Portkey, and Cloudflare AI Gateway** represent three approaches: open-source self-hosted (LiteLLM), managed SaaS (Portkey), and edge-native (Cloudflare). The right choice depends on operational maturity, latency requirements, and preference for managed vs. self-hosted infrastructure.
- **Start with a gateway early**: retrofitting gateway patterns into an organization where teams have already built direct provider integrations is significantly harder than starting with a gateway from day one.
