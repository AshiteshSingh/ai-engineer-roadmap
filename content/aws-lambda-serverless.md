# AWS Lambda & Serverless

## The 30-Second Pitch
AWS Lambda is a serverless compute service that runs code in response to events without provisioning or managing servers. It solves the operational overhead problem—no patching, no capacity planning, no idle-resource cost—by executing functions on demand and billing only for actual execution time (millisecond granularity). A team picks Lambda for event-driven workloads, APIs with variable traffic, background processing, and glue code in data pipelines. The broader "serverless" paradigm extends this to managed databases ([DynamoDB](/aws/dynamodb-data-services), Aurora Serverless), queues (SQS), storage ([S3](/aws/storage-s3)), and orchestration (Step Functions), enabling entire applications that scale to zero and to millions of requests with no infrastructure management.

## How It Actually Works

### Execution Model

Lambda runs inside **Firecracker microVMs**—lightweight VMs that boot in ~125ms and provide strong hardware-level isolation between tenants. Each Lambda function invocation runs in its own execution environment (a sandboxed container-like unit) that goes through this lifecycle:

```
[Event Source] --> [Lambda Service] --> [Find/Create Execution Environment]
                                              |
                                    [Cold Start: Download code,
                                     start runtime, run init code]
                                              |
                                    [Warm Start: Reuse env,
                                     skip init, jump to handler]
                                              |
                                         [Handler runs]
                                              |
                                    [Response returned to caller]
                                              |
                                    [Env kept warm ~5-15 min idle]
```

**Cold Start anatomy:**
1. Lambda service allocates compute capacity
2. Firecracker microVM boots
3. Runtime initializes (Node.js, Python, Java JVM, etc.)
4. Deployment package/container image is loaded
5. Code **outside** the handler runs (global scope, module imports, SDK client initialization)
6. Handler is invoked

Typical cold start durations (p99):
- Node.js / Python: 200–500ms (with layers, up to 1–2s)
- Java (JVM): 3–10s (GraalVM native reduces to ~500ms)
- Container images: 1–10s depending on image size and optimization

**Warm Start:** The execution environment is reused for subsequent invocations. Init code does not re-run. The handler receives a fresh event but global state (DB connections, SDK clients, caches) persists.

**Key implication:** Initialize SDK clients, establish DB connections, and load large configuration objects **outside** the handler so they are reused across warm invocations.

```javascript
// CORRECT: initialization outside handler
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm');

const ddb = new DynamoDBClient({ region: 'us-east-1' }); // created once per container
let cachedConfig = null;

async function getConfig() {
  if (!cachedConfig) {
    const ssm = new SSMClient({ region: 'us-east-1' });
    const res = await ssm.send(new GetParameterCommand({ Name: '/myapp/config', WithDecryption: true }));
    cachedConfig = JSON.parse(res.Parameter.Value);
  }
  return cachedConfig;
}

exports.handler = async (event) => {
  const config = await getConfig(); // SSM call skipped on warm starts
  // ...handler logic using ddb and config
};
```

### Concurrency Model

Lambda concurrency is **per-function, per-region**. Each concurrent execution requires its own environment.

- **Unreserved concurrency:** Shared pool from account limit (default 1000/region, adjustable)
- **Reserved concurrency:** Guarantees N environments for a function; also acts as a throttle cap
- **Provisioned concurrency:** Pre-warms N environments—they stay initialized with no cold start, billed continuously even when idle

```
Account concurrency limit (e.g., 1000)
├── Function A: reserved = 200  (guaranteed 200, up to 200)
├── Function B: reserved = 100  (guaranteed 100, up to 100)
└── Unreserved pool: 700 shared among all other functions
```

**Provisioned Concurrency** is the right answer for latency-sensitive APIs where cold start spikes are unacceptable (e.g., real-time inference endpoints, checkout flows). Cost: you pay for provisioned-concurrency-hours even when no invocations occur.

### Memory / CPU Relationship

Lambda does not expose CPU as a separate knob. **Memory allocation directly controls CPU allocation** in a linear relationship:
- 128 MB → ~0.08 vCPU
- 1,769 MB → exactly 1 vCPU
- 3,008 MB → ~1.7 vCPU
- 10,240 MB → ~6 vCPU

Increasing memory from 512 MB to 1,769 MB doubles CPU. For CPU-bound workloads (JSON parsing, image processing, ML inference), doubling memory can halve duration, often reducing cost despite higher per-ms rate. **AWS Lambda Power Tuning** automates this optimization.

---

## Lambda Deployment

### ZIP vs Container Images

| Dimension | ZIP Package | Container Image |
|---|---|---|
| Max size | 50 MB zipped / 250 MB unzipped | 10 GB |
| Supported runtimes | Managed runtimes (Node 18/20, Python 3.12, Java 17/21, etc.) | Any (custom base image) |
| Cold start | Generally faster | Slower for large images; mitigated by Lambda's image caching |
| Build tooling | `zip`, SAM, CDK | Docker |
| Best for | Standard runtimes, small deps | ML models, large binaries, custom runtimes |

**Container image cold starts** are optimized through **Lambda's container image caching**—images are cached at the AZ level after first use. Use Lambda-provided base images (`public.ecr.aws/lambda/python:3.12`) for best caching performance; they are pre-cached at Lambda's infrastructure level.

### Layers

A Lambda Layer is a ZIP archive published separately and shared across functions. Layers are mounted at `/opt/` in the execution environment.

- Up to **5 layers per function**; total unzipped deployment package (function + layers) ≤ 250 MB
- Common uses: shared libraries (e.g., `numpy`, `pandas` for data functions), common utilities, proprietary runtimes
- Layers are versioned (immutable). Referencing a specific layer ARN version is deterministic
- **AWS-provided layers:** Lambda Insights extension, AWS SDK (included by default in some runtimes), AWS Parameters and Secrets Lambda Extension

```yaml
# SAM template using layers
Globals:
  Function:
    Layers:
      - !Ref CommonUtilsLayer
      - arn:aws:lambda:us-east-1:580247275435:layer:LambdaInsightsExtension:38

Resources:
  CommonUtilsLayer:
    Type: AWS::Serverless::LayerVersion
    Properties:
      ContentUri: layers/common-utils/
      CompatibleRuntimes: [nodejs20.x]
```

### Deployment Package Size Limits

| Limit | Value |
|---|---|
| Compressed ZIP (direct upload) | 50 MB |
| Uncompressed ZIP (from S3) | 250 MB |
| `/tmp` ephemeral storage | 512 MB – 10,240 MB (configurable) |
| Container image | 10 GB |
| Environment variables | 4 KB total |
| Concurrent executions per account | 1,000 (default, soft limit) |
| Function timeout | 15 minutes max |

---

## Lambda Triggers

### [API Gateway](/aws/api-gateway-networking) (REST API / HTTP API)

**REST API (v1):** Full-featured, supports usage plans, API keys, request/response mapping templates, caching. Higher cost.

**HTTP API (v2):** Lower latency (~60% cheaper), simpler configuration, supports JWT authorizers natively, ideal for most Lambda backends.

```javascript
// HTTP API event shape (v2)
// event.requestContext.http.method, event.rawPath, event.body (string)
exports.handler = async (event) => {
  const body = JSON.parse(event.body ?? '{}');
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'ok', received: body }),
  };
};
```

**Lambda Function URLs** (no API Gateway): Simple HTTPS endpoint per function, supports [IAM](/aws/iam-security) or no auth. Cheaper, no API Gateway features. Good for webhooks, simple backends.

### SQS

See [Messaging & Events](/aws-messaging-events) for SQS, SNS, EventBridge, and Kinesis architecture details.

Lambda polls SQS via a **event source mapping (ESM)**. The ESM long-polls the queue, batches messages, and invokes Lambda. Key behaviors:
- **Batch size:** 1–10,000 messages
- **Batch window:** Up to 300s (collects messages before invoking, reduces invocations)
- **Visibility timeout** must be ≥ 6× Lambda timeout to prevent reprocessing during execution
- **On failure:** Messages return to queue after visibility timeout expires; configure a **Dead Letter Queue (DLQ)** on the SQS queue (not Lambda's DLQ for SQS triggers)
- **Report batch item failures:** Return `batchItemFailures` in response to requeue only failed messages, not the entire batch

```javascript
exports.handler = async (event) => {
  const failures = [];
  for (const record of event.Records) {
    try {
      const body = JSON.parse(record.body);
      await processMessage(body);
    } catch (err) {
      console.error('Failed to process:', record.messageId, err);
      failures.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures: failures }; // only failed messages become visible again
};
```

### SNS

SNS pushes directly to Lambda (no polling). Lambda is an SNS subscription. Invocation is **asynchronous**—Lambda returns 202 immediately; SNS retries on failure per its retry policy. No batch size concept; each SNS message triggers one invocation. Use Lambda DLQ for failed async invocations.

### [S3](/aws/storage-s3)

S3 event notifications push to Lambda asynchronously when objects are created, deleted, etc. Critical: S3 notifications are **at-least-once**—handle idempotency. Common pattern: use the S3 object key as an idempotency key against DynamoDB.

```javascript
exports.handler = async (event) => {
  for (const record of event.Records) {
    const bucket = record.s3.bucket.name;
    const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));
    // Process object at s3://bucket/key
  }
};
```

### [DynamoDB](/aws/dynamodb-data-services) Streams

Lambda polls the stream via ESM. Receives ordered, batched change records (INSERT, MODIFY, REMOVE) with before/after images. Used for: cache invalidation, replication, triggering downstream workflows.
- **Parallelization factor:** 1–10 per shard (process multiple batches from a shard concurrently)
- **Starting position:** TRIM_HORIZON (all records), LATEST, AT_TIMESTAMP
- **Failure handling:** On error, the batch is retried until success or expiry (blocking). Use `bisectBatchOnFunctionError`, max retry attempts, and DLQ on the ESM to handle poison-pill records.

### EventBridge

Rule-based routing of events from AWS services, SaaS (via EventBridge partner integrations), or custom events. Lambda is a target. Key for event-driven architectures:
- **Schedule:** cron expressions or rate expressions (`rate(5 minutes)`)
- **Event pattern matching:** Filter on event source, detail-type, or any JSON field
- **EventBridge Pipes:** Point-to-point integration (source → optional filter/enrichment → target) with built-in batching, DLQ, and retry

```json
// EventBridge rule pattern: trigger Lambda on EC2 instance state change
{
  "source": ["aws.ec2"],
  "detail-type": ["EC2 Instance State-change Notification"],
  "detail": { "state": ["terminated"] }
}
```

### Kinesis Data Streams

Similar to DynamoDB Streams ESM. Lambda polls shards. Ordered within a shard. **Enhanced fan-out** allows multiple consumers at 2 MB/s per shard each (vs. shared 2 MB/s per stream for standard). Same failure handling patterns apply—blocking retry per shard until resolved.

### Cognito

Cognito User Pools triggers Lambda at specific points in the auth lifecycle:
- **Pre sign-up:** Custom validation, auto-confirm users
- **Pre token generation:** Add/suppress claims in JWTs
- **Post authentication:** Custom logging/analytics
- **Pre authentication:** Allow/deny sign-in
- **Migrate user:** Transparent migration from a legacy user store

---

## Lambda Best Practices

### Handler Patterns

**Thin handler pattern:** Handler does minimal work—parse input, validate, delegate to a service layer, return result. Keeps handler testable.

```javascript
// service.js — pure business logic, no Lambda dependency
async function processOrder(orderId, userId) { /* ... */ }

// handler.js — thin shell
const { processOrder } = require('./service');
exports.handler = async (event) => {
  const { orderId, userId } = JSON.parse(event.body);
  if (!orderId || !userId) return { statusCode: 400, body: 'Missing fields' };
  const result = await processOrder(orderId, userId);
  return { statusCode: 200, body: JSON.stringify(result) };
};
```

**Middy middleware (Node.js):** Declarative middleware pipeline for cross-cutting concerns.

```javascript
const middy = require('@middy/core');
const httpJsonBodyParser = require('@middy/http-json-body-parser');
const httpErrorHandler = require('@middy/http-error-handler');
const { ssm } = require('@middy/ssm');

const baseHandler = async (event) => {
  const config = event.ssm; // injected by middleware
  return { statusCode: 200, body: JSON.stringify({ result: 'ok' }) };
};

exports.handler = middy(baseHandler)
  .use(httpJsonBodyParser())
  .use(ssm({ fetchData: { config: '/myapp/config' }, cacheExpiry: 60_000 }))
  .use(httpErrorHandler());
```

### Environment Variables vs Parameter Store vs Secrets Manager

| Approach | Use Case | Rotation | Encryption | Cost |
|---|---|---|---|---|
| Env vars | Non-sensitive config, feature flags | Manual redeploy | KMS optional | Free |
| SSM Parameter Store Standard | Config, non-secret params | Manual | KMS optional | Free (4K params) |
| SSM Parameter Store Advanced | Large params (>4KB), history | Manual | KMS | $0.05/param/month |
| Secrets Manager | DB passwords, API keys | **Automatic** | KMS mandatory | $0.40/secret/month |

**Best practice:** Use Secrets Manager for credentials that should rotate (RDS passwords, API keys for third-party services). Use Parameter Store for configuration that is sensitive but static. Use environment variables only for non-sensitive configuration that changes with deployments.

**AWS Parameters and Secrets Lambda Extension** caches Parameter Store and Secrets Manager values locally, eliminating the network call on every warm invocation:

```javascript
// With the extension installed as a layer, fetch via localhost
const response = await fetch(
  `http://localhost:2773/systemsmanager/parameters/get?name=%2Fmyapp%2Fconfig`,
  { headers: { 'X-Aws-Parameters-Secrets-Token': process.env.AWS_SESSION_TOKEN } }
);
const { Parameter } = await response.json();
```

### Error Handling, Retries, and Dead Letter Queues

**Synchronous invocations** (API Gateway, Lambda Function URL): The caller receives the error synchronously. No automatic Lambda-level retry. The caller decides to retry.

**Asynchronous invocations** (S3, SNS, EventBridge): Lambda retries up to **2 additional times** with exponential backoff (1 min, then 2 min). After all retries fail, the event is discarded or sent to the function's DLQ (SQS queue or SNS topic).

```javascript
// terraform / cloudformation: configure function-level DLQ for async invocations
// aws cloudformation:
// DeadLetterConfig:
//   TargetArn: !GetAtt FailedEventsDLQ.Arn

// Proper error handling in handler
exports.handler = async (event) => {
  try {
    await riskyOperation(event);
  } catch (err) {
    if (isRetryable(err)) throw err;       // rethrow → Lambda retries
    await logToDeadLetterStore(event, err); // non-retryable: store and swallow
    return { statusCode: 200 };            // ack to avoid pointless retries
  }
};
```

**ESM (SQS, Kinesis, DynamoDB Streams) failure behavior:**
- SQS: failed batches re-enqueue to queue (up to queue's maxReceiveCount), then to SQS DLQ
- Kinesis/DDB Streams: entire shard blocks until resolved (configure `BisectBatchOnFunctionError`, `MaximumRetryAttempts`, and ESM-level DLQ)

### AWS Lambda Power Tuning

Open-source Step Functions state machine (AWS published) that tests a function at multiple memory configurations, measuring duration and cost, and recommends the optimal setting.

```bash
# Deploy via SAR (Serverless Application Repository)
# Then invoke the state machine with:
{
  "lambdaARN": "arn:aws:lambda:us-east-1:123:function:my-function",
  "powerValues": [128, 256, 512, 1024, 1769, 3008],
  "num": 10,
  "payload": { "test": true },
  "parallelInvocation": true,
  "strategy": "cost"  // or "speed" or "balanced"
}
```

The tool generates a visualization URL with cost/duration curves. The "balanced" strategy finds the knee of the curve—the point of diminishing returns on performance per dollar. **Always run power tuning before setting memory on production functions.**

---

## Serverless Patterns

### Fan-Out Pattern

One event triggers multiple parallel Lambda executions. Implementations:
1. **SNS → multiple Lambda subscriptions** (each Lambda gets every message)
2. **EventBridge rule → multiple targets** (event routing with filtering)
3. **Lambda → SQS FIFO (multiple queues)** (controlled fan-out with ordering)
4. **Step Functions parallel state** (when you need to aggregate results)

```
[S3 Upload Event]
      |
   [Lambda: Router]
      |
  ┌───┼───┐
  ▼   ▼   ▼
[Thumb] [OCR] [Virus Scan]  ← parallel Lambda invocations
  └───┬───┘
      ▼
[Step Functions: WaitForTaskToken to aggregate]
```

### Saga Pattern

Manages distributed transactions across multiple services without a global transaction coordinator. Each step publishes an event on success or triggers a compensating transaction on failure.

**Choreography (EventBridge):** Services react to events independently. Decoupled but harder to trace.
**Orchestration (Step Functions):** A central orchestrator (state machine) calls each service and handles failures with explicit compensation steps. Easier to understand the full flow.

```
Order Saga (Step Functions orchestration):
[Reserve Inventory] → success → [Charge Payment] → success → [Send Confirmation]
        ↓ fail                        ↓ fail
[No compensation needed]    [Release Inventory (compensate)]
```

### Event Sourcing

Instead of storing current state, store all events that led to that state. The current state is derived by replaying events.

- **Event store:** DynamoDB or DynamoDB Streams → Lambda → event log S3/DynamoDB
- Lambda handles event ingestion and snapshots
- Snapshots prevent having to replay the full history on every read

### CQRS (Command Query Responsibility Segregation)

Separate the write model (commands) from the read model (queries). With Lambda:
- **Command path:** [API Gateway](/aws/api-gateway-networking) → Lambda → [DynamoDB](/aws/dynamodb-data-services) (write-optimized)
- **Query path:** [API Gateway](/aws/api-gateway-networking) → Lambda → ElasticSearch/DynamoDB GSI (read-optimized)
- DynamoDB Streams → Lambda → sync read model asynchronously

```
[POST /orders]              [GET /orders/summary]
      ↓                            ↓
[Write Lambda]              [Read Lambda]
      ↓                            ↓
[DynamoDB table]         [DynamoDB GSI / OpenSearch]
      ↓
[DynamoDB Streams → Sync Lambda → OpenSearch]
```

---

## Lambda + VPC

See [VPC & Networking](/aws-vpc-networking) for subnets, routing tables, security groups, and VPC Endpoints in depth.

### When to Use

Attach Lambda to a VPC **only when the function needs to access VPC-private resources**:
- RDS / Aurora (in private subnets)
- ElastiCache Redis / Memcached
- OpenSearch in VPC
- EC2-based services
- MSK (Managed Kafka)

**Do not attach to VPC** if the function only calls public AWS services (DynamoDB, S3, SSM, Secrets Manager)—use VPC Endpoints instead and avoid the cold start penalty.

### Cold Start Impact

When Lambda is VPC-attached, it must provision an **Elastic Network Interface (ENI)** in your VPC. Historically this added 10–15 seconds to cold starts. As of 2020, AWS overhauled this:
- **Hyperplane ENIs:** ENIs are pre-created and shared across functions in the same VPC/subnet/security group. Cold start penalty is now negligible (same as non-VPC Lambda).
- The old behavior (slow cold starts) is no longer a concern for functions using the current VPC integration.

### NAT Gateway

VPC-attached Lambda functions in private subnets cannot reach the internet by default. For internet access:
1. Private subnet → NAT Gateway (in public subnet) → Internet Gateway
2. Or use VPC endpoints for AWS services (S3, DynamoDB, SSM, Secrets Manager) to keep traffic off the internet and avoid NAT Gateway charges

**NAT Gateway cost:** $0.045/hour + $0.045/GB data processed. For high-throughput Lambda functions calling external APIs, NAT Gateway costs can dominate. Consider: PrivateLink, VPC endpoints, or restructuring to avoid NAT.

```
Private Subnet (Lambda)
      ↓
[Route table: 0.0.0.0/0 → NAT GW]
      ↓
NAT Gateway (Public Subnet, Elastic IP)
      ↓
Internet Gateway
      ↓
Internet
```

---

## Observability

### CloudWatch Logs

Lambda automatically sends stdout/stderr to CloudWatch Logs. Each function has a log group (`/aws/lambda/<function-name>`). Each execution environment writes to its own log stream.

**Structured logging** is essential for querying with CloudWatch Insights:

```javascript
// Use structured JSON logging instead of console.log strings
const logger = {
  info: (msg, meta = {}) => console.log(JSON.stringify({
    level: 'INFO', message: msg, timestamp: new Date().toISOString(), ...meta
  })),
  error: (msg, meta = {}) => console.error(JSON.stringify({
    level: 'ERROR', message: msg, timestamp: new Date().toISOString(), ...meta
  })),
};

exports.handler = async (event) => {
  const requestId = event.requestContext?.requestId;
  logger.info('Handler invoked', { requestId, path: event.rawPath });
  try {
    const result = await processEvent(event);
    logger.info('Success', { requestId, resultId: result.id });
    return { statusCode: 200, body: JSON.stringify(result) };
  } catch (err) {
    logger.error('Handler failed', { requestId, error: err.message, stack: err.stack });
    throw err;
  }
};
```

**CloudWatch Logs Insights query examples:**
```sql
-- Find slowest invocations
fields @timestamp, @duration, @memoryUsed
| filter @type = "REPORT"
| sort @duration desc
| limit 20

-- Count errors by function
fields @timestamp
| filter @message like /ERROR/
| stats count(*) as errorCount by bin(5m)
```

**Log retention:** Set explicitly (default: never expire). Unchecked retention is a cost trap. Typical: 30–90 days for production, 7 days for dev.

### Lambda Insights

A CloudWatch agent extension layer that collects enhanced system-level metrics: CPU utilization, memory utilization, disk I/O, network, cold start counts. Enables dashboards not available in default Lambda metrics. Enable via the `LambdaInsightsExtension` layer.

### X-Ray Tracing

Distributed tracing for Lambda. Captures:
- Cold start durations (as an initialization segment)
- Handler execution
- AWS SDK calls (DynamoDB, S3, SQS) as subsegments
- Custom subsegments via the X-Ray SDK

```javascript
const AWSXRay = require('aws-xray-sdk-core');
const AWS = AWSXRay.captureAWS(require('aws-sdk')); // all SDK calls traced

exports.handler = async (event) => {
  const segment = AWSXRay.getSegment();
  const subsegment = segment.addNewSubsegment('custom-db-operation');
  try {
    await runQuery();
    subsegment.close();
  } catch (err) {
    subsegment.addError(err);
    subsegment.close();
    throw err;
  }
};
```

Enable tracing in SAM/CloudFormation:
```yaml
Globals:
  Function:
    Tracing: Active  # PassThrough = no sampling, Active = use sampling rules
```

**Sampling:** By default, X-Ray samples 5% of requests (minimum 1 req/sec). Configure custom sampling rules in the X-Ray console. High-volume production functions should use sampling to control costs.

### Key Metrics to Monitor

| Metric | What It Signals |
|---|---|
| `Errors` | Unhandled exceptions / handler threw |
| `Throttles` | Concurrency limit hit; scale reserved limit or request quota increase |
| `Duration` (p50, p99) | Performance; p99 spikes indicate cold starts or slow dependencies |
| `ConcurrentExecutions` | Approaching account limit; plan for reserved concurrency |
| `IteratorAge` (Streams) | Consumer lag; ESM can't keep up with stream throughput |
| `DeadLetterErrors` | Failed to write to DLQ; permissions or DLQ capacity issue |

---

## Cost Optimization

### Pricing Model

Lambda pricing has two components:
1. **Request charges:** $0.20 per 1 million requests ($0.0000002 per request)
2. **Duration charges:** Billed in 1ms increments
   - x86: $0.0000166667 per GB-second
   - ARM64 (Graviton2): $0.0000133334 per GB-second (**20% cheaper**)

**Duration cost formula:**
```
Cost = (invocations × duration_seconds × memory_GB) × price_per_GB_second
```

For 1M invocations at 512 MB, 200ms average duration:
- x86: 1,000,000 × 0.2s × 0.5 GB × $0.0000166667 = **$1.67/month**
- ARM64: 1,000,000 × 0.2s × 0.5 GB × $0.0000133334 = **$1.33/month**

The **free tier** covers 1M requests/month and 400,000 GB-seconds/month forever (not just first year).

### ARM64 (Graviton2) Savings

Switch from `x86_64` to `arm64` architecture:
- **20% lower duration cost**
- Graviton2 often executes workloads **faster**, compounding savings
- Supported for all managed runtimes (Node.js, Python, Java, Go, Ruby, .NET)
- **Not available in every region** (check AWS docs)
- Requires recompiling native modules (e.g., `bcrypt`, `sharp`) for ARM

```yaml
# SAM: switch to arm64
Properties:
  Architectures: [arm64]
  Runtime: nodejs20.x
```

Real-world savings: Companies have reported 30–40% cost reduction by switching to ARM64 after factoring in both price reduction and performance improvement.

### Other Cost Levers

- **Right-size memory with Power Tuning:** Over-provisioned memory is the most common cost waste. A function at 1769 MB running in 100ms costs the same as one at 3008 MB running in 59ms—but neither may be optimal.
- **Reduce invocation count:** Use batch windows for SQS/Kinesis, EventBridge Pipes for fan-out rather than individual invocations.
- **Optimize cold starts:** Shorter init code = less billed duration during cold start. Container image opt: use distroless or Lambda base images, multi-stage Docker builds.
- **Provisioned Concurrency trade-off:** Eliminates cold starts but adds hourly cost. Worth it when p99 latency SLA cannot tolerate cold start spikes. Use Application Auto Scaling to scale provisioned concurrency on a schedule.

```yaml
# Auto Scaling provisioned concurrency by schedule
Resources:
  FunctionAliasProdScalableTarget:
    Type: AWS::ApplicationAutoScaling::ScalableTarget
    Properties:
      ServiceNamespace: lambda
      ResourceId: !Sub "function:${MyFunction}:prod"
      ScalableDimension: lambda:function:ProvisionedConcurrency
      MinCapacity: 2
      MaxCapacity: 100

  ScaleOutSchedule:
    Type: AWS::ApplicationAutoScaling::ScalingPolicy
    Properties:
      PolicyType: TargetTrackingScaling
      TargetTrackingScalingPolicyConfiguration:
        TargetValue: 0.7  # scale when 70% of provisioned concurrency utilized
        PredefinedMetricSpecification:
          PredefinedMetricType: LambdaProvisionedConcurrencyUtilization
```

---

## Lambda@Edge vs CloudFront Functions

Both run code at [CloudFront](/aws/storage-s3) edge locations but differ significantly.

| Dimension | Lambda@Edge | CloudFront Functions |
|---|---|---|
| Runtime | Node.js 14/18, Python 3.9 | JavaScript (ES5.1, restricted) |
| Max execution time | 5s (viewer), 30s (origin) | 1ms |
| Memory | 128 MB–10 GB | 2 MB |
| Max package size | 1 MB (viewer), 50 MB (origin) | 10 KB |
| Network access | Yes (external HTTP calls) | No |
| Cost | $0.60/M requests + duration | $0.10/M invocations |
| Triggers | Viewer request/response, origin request/response | Viewer request/response only |
| Use cases | Auth, A/B testing, URL rewriting, server-side rendering, dynamic content | Simple rewrites, header manipulation, query string normalization |

**Lambda@Edge** is deployed to us-east-1 and replicated to edge locations automatically. It cannot access VPC resources.

**CloudFront Functions** are ultra-lightweight and designed for simple, sub-millisecond request/response manipulation. They are ~6× cheaper than Lambda@Edge for viewer request/response events.

```javascript
// CloudFront Function: add security headers (viewer response trigger)
function handler(event) {
  var response = event.response;
  var headers = response.headers;
  headers['strict-transport-security'] = { value: 'max-age=63072000; includeSubdomains; preload' };
  headers['x-content-type-options'] = { value: 'nosniff' };
  headers['x-frame-options'] = { value: 'DENY' };
  return response;
}

// Lambda@Edge: JWT verification (viewer request trigger)
// Can make external calls (e.g., JWKS endpoint), use full Node.js crypto
exports.handler = async (event) => {
  const request = event.Records[0].cf.request;
  const token = request.headers['authorization']?.[0]?.value?.replace('Bearer ', '');
  if (!token || !(await verifyJwt(token))) {
    return { status: '401', body: 'Unauthorized' };
  }
  return request; // continue to origin
};
```

**Decision rule:**
- Header manipulation, URL rewriting, simple redirects → **CloudFront Functions**
- Auth/authorization, external API calls, complex logic, server-side rendering → **Lambda@Edge**

---

## Step Functions Integration

### Orchestration vs Choreography

**Orchestration (Step Functions):** A central state machine explicitly controls the flow—calls services, handles errors, manages retries, branches conditionally. The workflow is visible and auditable.

**Choreography (EventBridge/SNS):** Services react to events from other services. No central coordinator. Highly decoupled but flow is implicit and harder to trace.

**Choose orchestration when:**
- Workflow has conditional branches or loops
- Need guaranteed ordering of steps
- Require explicit compensation (saga)
- Need visibility into workflow execution state
- Long-running workflows (hours/days)

**Choose choreography when:**
- True decoupling is paramount
- Broadcast to unknown/multiple consumers
- Event streams with no defined "end"

### Step Functions + Lambda Integration

**Standard Workflows:** Exactly-once execution, durable execution history (90 days), 1 year max duration. Best for business-critical workflows.

**Express Workflows:** At-least-once, no execution history in console (use CloudWatch), 5 min max duration, 100K executions/sec. Best for high-volume event processing.

```json
{
  "Comment": "Order Processing Workflow",
  "StartAt": "ValidateOrder",
  "States": {
    "ValidateOrder": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:us-east-1:123:function:ValidateOrder",
      "Retry": [{ "ErrorEquals": ["Lambda.ServiceException"], "MaxAttempts": 3 }],
      "Catch": [{ "ErrorEquals": ["ValidationError"], "Next": "HandleInvalidOrder" }],
      "Next": "ProcessPayment"
    },
    "ProcessPayment": {
      "Type": "Task",
      "Resource": "arn:aws:states:::lambda:invoke.waitForTaskToken",
      "Parameters": {
        "FunctionName": "ProcessPayment",
        "Payload": {
          "orderId.$": "$.orderId",
          "taskToken.$": "$$.Task.Token"
        }
      },
      "HeartbeatSeconds": 3600,
      "Next": "FulfillOrder"
    },
    "FulfillOrder": { "Type": "Task", "Resource": "...", "End": true },
    "HandleInvalidOrder": { "Type": "Fail", "Error": "InvalidOrder" }
  }
}
```

**WaitForTaskToken pattern:** Lambda initiates an async operation (e.g., human approval, third-party payment) and returns immediately. Step Functions pauses and resumes when the callback `SendTaskSuccess` or `SendTaskFailure` is called with the token.

**SDK Integrations (optimistic integrations):** Step Functions can call [DynamoDB](/aws/dynamodb-data-services), SQS, SNS, [ECS](/aws/compute-containers), Glue, etc. directly without Lambda as a wrapper—reducing latency and cost.

---

## Common Interview Questions

**Q: What is a Lambda cold start and how do you reduce it?**
A: A cold start occurs when Lambda must provision a new execution environment—boot the Firecracker microVM, initialize the runtime, and run the init code outside the handler. It adds latency to the first invocation on a new or idle environment. Reduction strategies: (1) choose a fast-starting runtime (Node.js, Python over Java); (2) minimize deployment package size—fewer modules = faster require/import; (3) move all SDK initialization outside the handler; (4) use Provisioned Concurrency for latency-sensitive functions; (5) for containers, use Lambda base images; (6) reduce init code complexity—lazy-load what you can.

---

**Q: How does Lambda concurrency work, and what happens when you hit the limit?**
A: Lambda concurrency is the number of execution environments running simultaneously. The account has a regional limit (default 1,000). When the limit is hit, new invocations are throttled—for synchronous callers (API Gateway), they receive a 429 error. For async invocations, Lambda retries. Mitigation: request a limit increase, use reserved concurrency to protect critical functions, implement exponential backoff in callers, and use SQS as a buffer to absorb traffic spikes without throttling.

---

**Q: Explain the difference between SQS Standard and FIFO queues for Lambda triggers.**
A: Standard queues offer unlimited throughput and at-least-once delivery with best-effort ordering. Lambda processes batches from multiple shards in parallel. FIFO queues guarantee exactly-once processing and strict ordering within a message group. Lambda's ESM for FIFO scales to at most one batch per message group ID concurrently, preserving order. Use Standard when ordering doesn't matter and throughput is paramount. Use FIFO when processing order matters (e.g., financial transactions, state transitions) and throughput requirements are moderate (3,000 messages/sec per FIFO queue with batching).

---

**Q: When would you use Step Functions instead of just chaining Lambda functions directly?**
A: Direct chaining (Lambda calls Lambda) is an anti-pattern for complex workflows: errors are hard to handle, state must be passed through all calls, and there's no visibility into where an execution failed. Use Step Functions when: (1) you need retry logic and error handling per step; (2) the workflow has branches or parallel paths; (3) you need audit trail/execution history; (4) long-running workflows exceed Lambda's 15-min timeout; (5) you need human approval steps (WaitForTaskToken); (6) you want to call AWS services without Lambda intermediaries using SDK integrations. See [Step Functions](/aws-step-functions) for full orchestration coverage.

---

**Q: How do you handle idempotency in Lambda?**
A: Lambda can be invoked more than once for the same event (async retries, at-least-once triggers like S3/SNS). Idempotent handlers produce the same outcome regardless of how many times they execute. Implementation: (1) use a unique event/request ID as an idempotency key; (2) store processed IDs in DynamoDB with a TTL equal to the retry window; (3) check if the key exists before processing; (4) use DynamoDB conditional writes to atomically "claim" processing. The **AWS Lambda Powertools** library (`@aws-lambda-powertools/idempotency`) provides a decorator pattern that handles this automatically.

```javascript
// AWS Lambda Powertools idempotency (Node.js)
const { makeIdempotent } = require('@aws-lambda-powertools/idempotency');
const { DynamoDBPersistenceLayer } = require('@aws-lambda-powertools/idempotency/dynamodb');

const persistenceStore = new DynamoDBPersistenceLayer({ tableName: 'IdempotencyTable' });

exports.handler = makeIdempotent(
  async (event) => {
    // this body runs exactly once per unique event
    await processPayment(event.paymentId, event.amount);
  },
  { persistenceStore, config: { eventKeyJmesPath: 'paymentId' } }
);
```

---

**Q: What's the difference between Lambda's function-level DLQ and an SQS queue's DLQ?**
A: Lambda's function-level DLQ handles **failed asynchronous invocations** (events from S3, SNS, EventBridge) after all Lambda-level retries are exhausted. It does not apply to SQS-triggered invocations. For SQS triggers, the DLQ must be configured on the **SQS queue** itself (via the queue's redrive policy), which receives messages after `maxReceiveCount` delivery attempts. Additionally, when using partial batch failure reporting (`batchItemFailures`), failed messages return to the SQS queue individually and eventually go to the SQS DLQ—not Lambda's DLQ.

---

**Q: How does Lambda pricing work, and how would you optimize costs for a high-volume function?**
A: Lambda charges per request ($0.20/M) plus per GB-second of duration. For optimization: (1) run Power Tuning to find the memory sweet spot—often lower memory with longer duration is cheaper than more memory with shorter duration, but sometimes the opposite; (2) switch to ARM64/Graviton2 for 20% duration cost savings; (3) reduce average duration by optimizing hot paths, using connection pooling, and caching SSM/Secrets Manager results via the Parameters and Secrets extension; (4) use batch windows for SQS to reduce invocation count; (5) for very high, steady traffic, compare Lambda cost to a long-running Fargate container.

---

**Q: You have a Lambda function processing DynamoDB Streams that keeps failing on a bad record. What do you do?**
A: DynamoDB Streams processing is blocking—a failed batch keeps retrying until it expires or succeeds, which can halt all downstream processing for that shard. Solutions: (1) set `BisectBatchOnFunctionError: true` on the ESM—splits the batch in half recursively to isolate the bad record; (2) configure `MaximumRetryAttempts` to limit retries; (3) configure a DLQ on the **event source mapping** (not the Lambda function DLQ) to capture permanently failed records for later inspection; (4) implement poison pill detection in the handler and route bad records to an S3 error bucket or SQS dead letter queue manually.

---

**Q: Explain the trade-offs between Lambda@Edge and CloudFront Functions.**
A: CloudFront Functions are ultra-cheap ($0.10/M), execute in under 1ms, but are limited to 2 MB memory, 10 KB code, no network access, and only viewer request/response triggers. They are ideal for simple URL rewrites, header normalization, and cookie manipulation. Lambda@Edge is 6× more expensive but supports full Node.js, up to 10 GB memory, 50 MB packages, 30s execution at origin, and can make external HTTP calls. Use Lambda@Edge for JWT verification, A/B testing with external config, dynamic image resizing, and server-side rendering. Use CloudFront Functions for everything else to minimize cost.

---

**Q: How would you design a serverless system to handle 100,000 file uploads per hour with processing?**
A: (1) **Ingestion:** Pre-signed S3 URLs for direct browser-to-S3 upload (no Lambda in the upload path—avoids size limits and costs). (2) **Trigger:** S3 ObjectCreated event → SQS Standard queue (decouples upload rate from processing rate, absorbs bursts). (3) **Processing Lambda:** ESM from SQS with batch size 10, batch window 30s. Processes files in parallel up to Lambda concurrency limit. Implements partial batch failure reporting. (4) **Concurrency:** Set reserved concurrency to prevent starving other functions; ~28 uploads/second → ~3–5 concurrent Lambdas needed at 200ms/file. (5) **Failure path:** SQS DLQ for failed files → alert SNS → manual review. (6) **Observability:** Structured logs, CloudWatch dashboard on IteratorAge (if using Kinesis), SQS `ApproximateNumberOfMessagesNotVisible`, Lambda `Errors` and `Duration`.

---

## Lambda Extensions — Runtime Enhancements

Lambda Extensions are processes that run alongside the Lambda function handler in the same execution environment. They enable integrations for monitoring, security, and configuration without modifying function code.

### Extension Types
- **Internal extensions**: run as part of the runtime process (e.g., exec wrappers)
- **External extensions**: separate processes alongside the Lambda function; registered for `INVOKE` and/or `SHUTDOWN` lifecycle events

### AWS-Managed Extensions (as Lambda Layers)
| Extension | Purpose | Impact |
|---|---|---|
| **Parameters & Secrets** | Cache SSM Parameter Store + Secrets Manager values; HTTP API on port 2773 | Reduces calls to SSM/ASM; up to ~75% cost reduction vs direct SDK calls |
| **CloudWatch Lambda Insights** | Per-invocation performance metrics (init duration, memory used, network) | ~1.3 MB layer; minimal overhead |
| **ADOT (OpenTelemetry)** | Collect traces/metrics via OpenTelemetry Collector; send to X-Ray, CloudWatch, third-party | Standardized instrumentation |
| **Datadog Agent** | Forward metrics/logs/traces to Datadog | Requires Datadog account |

### Parameters & Secrets Extension — Deep Dive
```javascript
// Instead of calling SSM SDK (creates new HTTP call per invocation)
// Use the Parameters & Secrets extension (caches with TTL)

const PARAMS_PORT = 2773; // extension listens on this port

async function getParameter(name) {
  const response = await fetch(
    `http://localhost:${PARAMS_PORT}/systemsmanager/parameters/get?name=${encodeURIComponent(name)}&withDecryption=true`,
    { headers: { 'X-Aws-Parameters-Secrets-Token': process.env.AWS_SESSION_TOKEN } }
  );
  const { Parameter } = await response.json();
  return Parameter.Value;
}

async function getSecret(secretId) {
  const response = await fetch(
    `http://localhost:${PARAMS_PORT}/secretsmanager/get?secretId=${encodeURIComponent(secretId)}`,
    { headers: { 'X-Aws-Parameters-Secrets-Token': process.env.AWS_SESSION_TOKEN } }
  );
  const { SecretString } = await response.json();
  return JSON.parse(SecretString);
}

// Cache TTL: default 300s for SSM, 300s for Secrets Manager (configurable via env vars)
// PARAMETERS_SECRETS_EXTENSION_CACHE_SIZE: max cached items (default 1000)
// SSM_PARAMETER_STORE_TTL: override TTL in seconds
```

---

## Lambda SnapStart — Eliminating Java Cold Starts

SnapStart addresses the Java JVM's notoriously long cold starts (3–10s) by pre-initializing the runtime and taking a snapshot.

### How It Works
1. Lambda initializes the function during publish of a new version (runs `INIT` phase including your init code)
2. Takes a snapshot of the initialized execution environment (memory + disk state)
3. Encrypts and caches the snapshot
4. On cold start: restores from snapshot in ~150–500ms instead of running full JVM init

### Supported Runtimes
- Java 11 (Corretto), Java 17 (Corretto), Java 21 (Corretto)
- Only for versioned functions (requires `PublishVersion: true`)

### Hooks for Snapshot Safety
```java
import com.amazonaws.services.lambda.runtime.snapstart.CRaCInterface;
import org.crac.Context;
import org.crac.Resource;

// Implement CRaC hooks to handle state that shouldn't persist across snapshots
public class Handler implements RequestHandler<APIGatewayProxyRequestEvent, APIGatewayProxyResponseEvent>, Resource {

    private DatabaseConnection dbConnection;

    public Handler() {
        Core.getGlobalContext().register(this);
        // Initialize expensive resources once
        dbConnection = new DatabaseConnection(System.getenv("DB_URL"));
    }

    @Override
    public void beforeCheckpoint(Context<? extends Resource> context) {
        // Close connections before snapshot — they'll be invalid after restore
        dbConnection.close();
    }

    @Override
    public void afterRestore(Context<? extends Resource> context) {
        // Re-establish connections after restore
        dbConnection = new DatabaseConnection(System.getenv("DB_URL"));
    }
}
```

### What to Avoid in SnapStart
- **Unique random seeds**: re-seeded from same snapshot → `SecureRandom.generateSeed()` needed after restore
- **Network connections**: close before snapshot, re-open after restore
- **Time-dependent state**: timestamps taken during init will be stale after restore
- **Hardcoded unique IDs**: regenerate after restore

---

## Lambda Function URLs

Function URLs provide a built-in HTTPS endpoint for invoking Lambda directly without API Gateway.

```
https://<url-id>.lambda-url.<region>.on.aws
```

### Auth Types
| AuthType | Use Case | IAM Required? |
|---|---|---|
| `NONE` | Public API, webhooks (Stripe, GitHub) | No — anyone can invoke |
| `AWS_IAM` | Internal service-to-service | Yes — IAM Sig v4 |

### CORS Configuration
```typescript
// CDK: Lambda Function URL with CORS
const fnUrl = myFunction.addFunctionUrl({
  authType: lambda.FunctionUrlAuthType.NONE,
  cors: {
    allowedOrigins: ['https://myapp.com'],
    allowedHeaders: ['content-type', 'authorization'],
    allowedMethods: [lambda.HttpMethod.POST, lambda.HttpMethod.GET],
    maxAge: cdk.Duration.hours(1),
  },
});
new cdk.CfnOutput(this, 'FunctionUrl', { value: fnUrl.url });
```

### Streaming Responses
Function URLs support `RESPONSE_STREAM` invoke mode — return data progressively (like SSE/chunked transfer):
```javascript
const { Readable } = require('stream');

exports.handler = awslambda.streamifyResponse(async (event, responseStream, context) => {
  responseStream.setContentType('text/plain');

  const tokens = ['Hello', ' ', 'from', ' ', 'streaming', ' ', 'Lambda'];
  for (const token of tokens) {
    responseStream.write(token);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  responseStream.end();
});
```
Use case: streaming LLM completions from Lambda without buffering the full response.

### Function URL vs API Gateway
| Criterion | Function URL | API Gateway |
|---|---|---|
| Cost | Free (Lambda invoke cost only) | $3.50-$1.00/M requests + data |
| Features | Single endpoint, no routing | Multiple routes, auth, throttling, caching |
| Custom domain | Via CloudFront | Native support |
| Response streaming | Yes (RESPONSE_STREAM mode) | No (buffered only) |
| Best for | Webhooks, simple single-function APIs, streaming | Multi-function APIs, enterprise features |

---

## AWS Lambda Powertools — Production Toolkit

Lambda Powertools (TypeScript/Python/Java/.NET) is an AWS-maintained suite of utilities for production Lambda functions.

### Logger — Structured JSON Logging
```typescript
import { Logger } from '@aws-lambda-powertools/logger';

const logger = new Logger({ serviceName: 'orders-service', logLevel: 'INFO' });

export const handler = async (event: APIGatewayProxyEvent) => {
  // Inject correlation ID, cold start flag, account ID automatically
  logger.addContext(context);

  // Structured log — every field is queryable in CloudWatch Logs Insights
  logger.info('Processing order', {
    orderId: event.pathParameters?.id,
    userId: event.requestContext.authorizer?.claims.sub,
  });

  try {
    const result = await processOrder(event);
    logger.info('Order processed', { orderId: result.id, durationMs: result.duration });
    return { statusCode: 200, body: JSON.stringify(result) };
  } catch (err) {
    logger.error('Order processing failed', err as Error);
    return { statusCode: 500, body: 'Internal error' };
  }
};
```

### Tracer — X-Ray Integration
```typescript
import { Tracer } from '@aws-lambda-powertools/tracer';

const tracer = new Tracer({ serviceName: 'orders-service' });
const ddb = tracer.captureAWSv3Client(new DynamoDBClient({})); // auto-trace all DDB calls

export const handler = async (event: any) => {
  const segment = tracer.getSegment();
  const subsegment = segment.addNewSubsegment('## processPayment');

  tracer.putAnnotation('orderId', event.orderId); // indexed — searchable in X-Ray
  tracer.putMetadata('orderDetails', event);       // not indexed — visible in trace

  try {
    const result = await chargePayment(event);
    tracer.putAnnotation('paymentStatus', 'SUCCESS');
    return result;
  } catch (err) {
    subsegment.addError(err as Error);
    throw err;
  } finally {
    subsegment.close();
  }
};
```

### Feature Flags
```typescript
import { AppConfigProvider } from '@aws-lambda-powertools/parameters/appconfig';

const provider = new AppConfigProvider({ environment: 'production', application: 'orders' });

export const handler = async (event: any) => {
  const flags = await provider.getJSON('feature-flags');

  if (flags.newCheckoutFlow) {
    return await newCheckout(event);
  }
  return await legacyCheckout(event);
};
```

---

## Red Flags to Avoid

- **"I initialize my DB connection inside the handler."** This creates a new connection on every cold start and also on every warm invocation that has an idle connection timeout. Always initialize outside the handler and handle reconnection logic gracefully.
- **"Cold starts aren't a problem, just set the timeout high."** A high timeout doesn't prevent cold starts—it just means failures take longer. The right answer is right-sizing, fast runtimes, and Provisioned Concurrency where needed.
- **"Lambda scales infinitely."** Lambda scales to the regional concurrency limit (default 1,000). Burst scaling is also rate-limited (500–3,000 new environments per minute depending on region). Design SQS buffers for true spike absorption.
- **"Use Lambda for everything."** Lambda has a 15-minute timeout. ML training, video transcoding, and long ETL jobs belong in [Fargate / EC2](/aws/compute-containers), or AWS Batch.
- **"VPC = slower Lambda"** — This was true before 2020. Hyperplane ENIs eliminated the ENI provisioning cold start. Modern VPC Lambda has negligible cold start overhead compared to non-VPC.
- **"Standard Workflow for everything in Step Functions."** Standard Workflows are expensive ($0.025 per 1,000 state transitions) at high volume. Express Workflows at $1/M executions + duration are 100× cheaper for high-frequency flows.
- **"Secrets in environment variables are fine."** Env vars are encrypted at rest but visible in Lambda configuration to anyone with IAM access to the function. Secrets Manager or SSM SecureString adds proper access control and rotation.
- **"I use Lambda@Edge for security headers."** CloudFront Functions are 6× cheaper and execute in <1ms—the correct tool for this use case.
