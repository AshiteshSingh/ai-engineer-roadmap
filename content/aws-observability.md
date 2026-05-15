# AWS Observability & Monitoring

## The 30-Second Pitch

Observability is the ability to understand what your system is doing from the outside — without having to redeploy or add new instrumentation every time something breaks. AWS provides three first-party pillars: **CloudWatch** (metrics + logs + alarms), **X-Ray** (distributed traces), and **CloudTrail** (API audit trail), complemented by **AWS Config** for configuration compliance. Getting this stack right means the difference between a 5-minute postmortem and a 5-hour war room. For interviews, the expectation is to reason across all four services — when to use each, how to correlate across them, and how to design an observability stack that doesn't cost more than the app it monitors.

## How It Actually Works

### The Three Pillars + Audit

```
Metrics  →  CloudWatch Metrics / Alarms         "Is the system healthy?"
Logs     →  CloudWatch Logs / Logs Insights      "What did the system say?"
Traces   →  AWS X-Ray / ADOT                     "Where did the latency go?"
Audit    →  CloudTrail / AWS Config              "Who changed what, and when?"
```

Every observable system emits all three pillars. Metrics tell you _that_ something is wrong (latency p99 spike). Logs tell you _what_ happened (specific error message). Traces tell you _where_ in the distributed call chain it happened (DynamoDB throttle in a downstream Lambda). Audit tells you _who changed_ the system itself.

---

## 1. Amazon CloudWatch — Unified Observability

CloudWatch is the central telemetry hub for AWS. It ingests metrics from 70+ AWS services automatically, accepts custom metrics via API or the Embedded Metrics Format, stores and queries structured logs, and fires alarms that trigger automated responses. Almost every observability pattern on AWS starts here.

### Metrics

**Namespaces and Dimensions**

Every CloudWatch metric lives inside a **namespace** (e.g., `AWS/Lambda`, `AWS/EC2`, `MyApp/Payments`). Within a namespace, a metric is identified by its **name** + a set of **dimensions** (key-value pairs). A Lambda `Errors` metric with dimension `FunctionName=checkout` is a different time series from `FunctionName=auth` — even though both live in `AWS/Lambda`.

**Statistics**

| Statistic | Meaning |
|---|---|
| `SampleCount` | Number of data points in the period |
| `Sum` | Total across all data points |
| `Average` | Sum / SampleCount |
| `Min` / `Max` | Lowest / highest value in the period |
| `p50`, `p90`, `p99`, `p99.9` | Percentile — requires high-resolution or extended statistics |

**Resolution**

- **Standard resolution**: 1-minute granularity — default for most AWS service metrics
- **High resolution**: 1-second granularity — custom metrics published with `StorageResolution=1`; alarms can fire in 10-second periods; 3× the cost of standard

**Custom Metrics: PutMetricData vs EMF**

Option 1 — `PutMetricData` API call: synchronous, extra latency, counts against 150 TPS limit, costs $0.30/metric/month.

Option 2 — **Embedded Metrics Format (EMF)**: write a structured JSON log line with a special `_aws` envelope. CloudWatch Logs Agent (or the Lambda runtime) extracts the metric automatically, zero extra API calls. Best practice for Lambda — piggybacks on log ingestion you're already paying for.

EMF structured log for Lambda — emit a custom business metric:

```typescript
// Using @aws-lambda-powertools/metrics (preferred) or raw EMF JSON
import { Metrics, MetricUnits } from '@aws-lambda-powertools/metrics';

const metrics = new Metrics({
  namespace: 'MyApp/Payments',
  serviceName: 'checkout-service',
});

export const handler = async (event: APIGatewayEvent) => {
  const paymentAmount = event.body ? JSON.parse(event.body).amount : 0;

  // Emit custom metric — extracted from logs, no PutMetricData call
  metrics.addMetric('PaymentAmount', MetricUnits.Count, paymentAmount);
  metrics.addMetric('PaymentProcessed', MetricUnits.Count, 1);
  metrics.addDimension('PaymentMethod', event.headers['X-Payment-Method'] ?? 'unknown');

  try {
    await processPayment(paymentAmount);
    metrics.addMetric('PaymentSuccess', MetricUnits.Count, 1);
  } catch (err) {
    metrics.addMetric('PaymentFailure', MetricUnits.Count, 1);
    throw err;
  } finally {
    // Flushes EMF JSON to stdout — CloudWatch Logs extracts metrics automatically
    metrics.publishStoredMetrics();
  }
};
```

Raw EMF JSON written directly to stdout (lower-level reference):

```json
{
  "_aws": {
    "Timestamp": 1706000000000,
    "CloudWatchMetrics": [
      {
        "Namespace": "MyApp/Payments",
        "Dimensions": [["PaymentMethod"]],
        "Metrics": [
          { "Name": "PaymentAmount", "Unit": "None" },
          { "Name": "PaymentProcessed", "Unit": "Count" }
        ]
      }
    ]
  },
  "PaymentMethod": "stripe",
  "PaymentAmount": 149.99,
  "PaymentProcessed": 1,
  "correlationId": "req-abc-123"
}
```

**Metric Math**

Compose new time series from existing metrics using expressions evaluated server-side:

```
error_rate = errors / (errors + requests) * 100
```

Used in alarms and dashboards. Supports functions: `SUM()`, `AVG()`, `MAX()`, `FILL()`, `RATE()`, `SEARCH()` (cross-metric queries), `IF()`, `METRICS()`.

**Metric Insights**

SQL-like query language for CloudWatch metrics. Supports cross-account queries when combined with CloudWatch Observability Access Manager. Example:

```sql
SELECT AVG(Duration)
FROM SCHEMA("AWS/Lambda", FunctionName)
WHERE FunctionName LIKE 'prod-%'
GROUP BY FunctionName
ORDER BY AVG() DESC
LIMIT 10
```

**Specialized Insight Extensions**

- **CloudWatch Container Insights** — ECS/EKS metrics at cluster/service/task/pod/container level: CPU, memory, network I/O, disk I/O. Requires CloudWatch agent or Fluent Bit sidecar. EKS also requires the Container Insights add-on.
- **CloudWatch Lambda Insights** — per-invocation metrics beyond what `AWS/Lambda` provides: `init_duration`, `memory_utilization`, `cpu_total_time`, `tx_bytes`, `rx_bytes`. Requires the Lambda Insights extension layer (`arn:aws:lambda:...:layer:LambdaInsightsExtension:...`). Tied to [Lambda](/aws-lambda-serverless) execution environment lifecycle.

**Cross-Account / Cross-Region Monitoring**

CloudWatch Observability Access Manager lets you link source accounts (where workloads run) to a monitoring account (central observability). From the monitoring account you can view metrics, logs, and traces from all linked accounts without switching consoles — critical for multi-account AWS Organizations setups.

---

### Alarms

**Threshold Alarms**

```
State: OK → ALARM → INSUFFICIENT_DATA
Condition: Metric > threshold for N out of M consecutive data points
```

Example: `Lambda Errors > 5 for 3 out of 5 one-minute periods`. The N-of-M logic prevents transient spikes from triggering pages.

**Anomaly Detection Alarms**

CloudWatch trains an ML model on up to 2 weeks of historical data to establish a dynamic baseline. The alarm fires when a metric falls outside the `ANOMALY_DETECTION_BAND(metric, stddev_factor)`. No threshold to tune — the model adapts to time-of-day and day-of-week patterns automatically.

```
ANOMALY_DETECTION_BAND(m1, 2)
# metric m1 must stay within 2 standard deviations of predicted value
```

**Composite Alarms**

Combine multiple alarms using Boolean logic. This is the primary tool for reducing alert fatigue:

```
"checkout-service-degraded" =
  (ALARM("checkout-error-rate") OR ALARM("checkout-p99-latency"))
  AND NOT ALARM("upstream-dependency-down")
```

Use case: fire a single PagerDuty page when both error rate AND latency are elevated, but suppress it if the issue is known to be an upstream dependency outage.

**Alarm Actions**

- **SNS topic** — fan out to email, SMS, Lambda, HTTP endpoint, PagerDuty/Opsgenie
- **EC2 actions** — stop, terminate, reboot, or recover an instance
- **Auto Scaling** — scale out/in policies
- **SSM OpsCenter** — create an OpsItem for structured incident tracking
- **Systems Manager Incident Manager** — create and escalate an incident

**Missing Data Treatment**

| Setting | Behavior |
|---|---|
| `missing` | Alarm transitions to `INSUFFICIENT_DATA` |
| `notBreaching` | Treat missing points as within threshold (good for sparse metrics) |
| `breaching` | Treat missing points as exceeding threshold |
| `ignore` | Alarm state stays unchanged |

Default is `missing`. For heartbeat-style checks, use `breaching` — absence of data _is_ the problem.

---

### Logs

**Log Groups and Streams**

- **Log group**: named container for related logs; set **retention** (1 day to 10 years, or `Never Expire`) and optional **KMS encryption** per group. Lambda creates a log group per function automatically; EC2 requires CloudWatch agent config.
- **Log stream**: a sequence of events from a single source. Lambda creates one stream per execution environment container; EC2 creates one per instance.

If you never set retention, logs accumulate forever at $0.03/GB/month. Set retention on every log group — automate via AWS Config rule or Lambda at account-creation time.

**Structured Logging**

Write JSON to stdout/stderr. This enables powerful Logs Insights queries without regex parsing. Include a consistent set of fields: `level`, `timestamp`, `correlationId`, `requestId`, `service`, `message`.

```typescript
console.log(JSON.stringify({
  level: 'INFO',
  timestamp: new Date().toISOString(),
  service: 'checkout',
  correlationId: ctx.correlationId,
  requestId: context.awsRequestId,
  message: 'Payment processed',
  paymentId: payment.id,
  amount: payment.amount,
  durationMs: Date.now() - startTime,
}));
```

**CloudWatch Logs Insights**

Interactive query engine for log data. Queries run in parallel across all streams in a group. 15-minute query execution limit. Key commands: `fields`, `filter`, `stats`, `sort`, `limit`, `parse` (regex extraction), `pattern` (ML-based automatic pattern detection).

```
# Top 10 slowest Lambda invocations
filter @type = "REPORT"
| stats max(@duration) as maxDuration by @requestId
| sort maxDuration desc
| limit 10
```

```
# Error rate by hour — structured JSON logs
filter level = "ERROR"
| stats count() as errors by bin(1h)
| sort @timestamp desc
```

```
# Parse unstructured log lines with regex
parse @message "user=* action=* latency=*ms" as user, action, latencyMs
| filter action = "checkout"
| stats avg(latencyMs), p99(latencyMs) by user
| sort p99_latencyMs desc
```

**Metric Filters**

Create a CloudWatch metric from a log group without writing application code. Example: count all lines containing `"level":"ERROR"` as an `AppErrors` metric. Supports numeric value extraction (e.g., extract `durationMs` from JSON and publish as a metric). Lower-level alternative to EMF — EMF is preferred for new Lambda code.

**Log Subscriptions**

Stream log events in near real-time to a downstream processor. Three targets:

| Target | Use Case |
|---|---|
| Lambda function | Real-time enrichment, alerting, routing |
| Kinesis Data Streams | High-volume streaming to custom consumers |
| Kinesis Data Firehose | S3/OpenSearch/Splunk delivery with buffering |

Subscription filters support the same filter pattern syntax as metric filters. Multiple subscriptions per log group (up to 2 by default). Cross-account log streaming: source account's log group → subscription → resource-based policy allows destination account's Kinesis/Lambda.

---

### Dashboards

CloudWatch provides **automatic dashboards** for EC2, Lambda, DynamoDB, and other services — preconfigured, no setup required. **Custom dashboards** support widgets:

| Widget Type | Use Case |
|---|---|
| Metric graph | Time series, stacked area, bar chart |
| Log table | Logs Insights query results inline |
| Alarm status | RAG status of alarm list |
| Text (Markdown) | Section headers, runbook links |
| Explorer | Dynamic multi-resource metric view |

Dashboards are cross-account (with Observability Access Manager) and embeddable via snapshot URLs. JSON dashboard body is version-controllable — store in your IaC repo alongside the stack it monitors.

---

### CloudWatch Synthetics

**Canaries** are Puppeteer/Selenium scripts that run on a configurable schedule (every 1 minute to once a day) from AWS-managed infrastructure. They test your endpoints from the outside — catching issues before real users do.

**Built-in Blueprints**

| Blueprint | What It Tests |
|---|---|
| Heartbeat monitor | HTTP(S) endpoint availability + latency |
| API canary | REST/GraphQL API correctness (request/response validation) |
| Broken link checker | Crawls a page and verifies all links return 2xx |
| Visual monitoring | Screenshot comparison against a baseline (detects UI regressions) |
| GUI workflow | Multi-step Puppeteer flow (login → add to cart → checkout) |

Each canary step captures a screenshot, a HAR file (full network waterfall), and pass/fail status. Canary results automatically feed a CloudWatch alarm — alert when success rate drops below 100% or latency exceeds SLA.

---

## 2. AWS X-Ray — Distributed Tracing

X-Ray answers "where did the time go?" in a distributed system. It correlates work across Lambda, ECS, EC2, API Gateway, SQS, SNS, and DynamoDB into a single end-to-end trace.

### Core Concepts

| Concept | Description |
|---|---|
| **Trace** | Complete end-to-end journey of one request; identified by a `Trace-ID` header |
| **Segment** | Work done by one service (e.g., one Lambda invocation, one ECS task) |
| **Subsegment** | Granular breakdown within a segment: DB query, external HTTP call, custom block |
| **Annotation** | Indexed key-value pair (string, number, boolean) — filterable in X-Ray console and service map groups |
| **Metadata** | Arbitrary JSON data attached to a segment/subsegment — not indexed, not searchable, but visible in trace detail |
| **Sampling** | Rule-based decision of which requests to trace — balances observability cost vs. coverage |

**Sampling Rules**

Default rule: reservoir of 5 requests/second traced at 100%, then 5% of remaining requests. Custom rules override by service name, URL path, HTTP method, host, or resource ARN. Rule evaluation order: lower priority number = evaluated first.

```
Rule: "checkout-full-trace"
  host: *.myapp.com
  url_path: /checkout/*
  http_method: POST
  reservoir_size: 50      # first 50 req/s traced fully
  fixed_rate: 0.20        # 20% of remainder
  priority: 1             # evaluated before default
```

In production with high traffic, tracing 100% of requests would cost ~$5 per million traces and add latency overhead from the daemon. Sampling keeps costs predictable while providing statistically valid performance data.

### Integration

**Lambda**: enable **Active Tracing** in function configuration (one checkbox or `TracingConfig: Active` in CloudFormation). The X-Ray daemon runs as a managed sidecar — no daemon management required. Execution role needs `xray:PutTraceSegments` and `xray:PutTelemetryRecords`.

**ECS**: add an X-Ray daemon container as a sidecar in the task definition. Set `AWS_XRAY_DAEMON_ADDRESS` environment variable in your application container. Task execution role needs X-Ray permissions.

**EC2**: install and run the X-Ray daemon as a systemd service. The daemon buffers segments and sends them to the X-Ray API in batches.

**API Gateway**: enable X-Ray tracing per stage. The gateway injects `X-Amzn-Trace-Id` header for downstream propagation — any SDK-instrumented service receiving that header automatically links to the upstream trace.

**SDK Instrumentation** (Node.js example):

```typescript
import AWSXRay from 'aws-xray-sdk-core';
import * as AWSv3 from '@aws-sdk/client-dynamodb';
import express from 'express';

const app = express();

// Capture all outbound HTTPS calls automatically
AWSXRay.captureHTTPsGlobal(require('https'), true);

// Instrument AWS SDK v3 client
const ddbClient = AWSXRay.captureAWSv3Client(new AWSv3.DynamoDBClient({}));

app.use(AWSXRay.express.openSegment('checkout-service'));

app.post('/checkout', async (req, res) => {
  const segment = AWSXRay.getSegment();

  // Annotation: indexed, filterable in X-Ray console
  segment?.addAnnotation('tenantId', req.headers['x-tenant-id'] as string);
  segment?.addAnnotation('paymentMethod', req.body.paymentMethod);

  // Custom subsegment for a business operation
  const subsegment = segment?.addNewSubsegment('validate-inventory');
  try {
    await validateInventory(req.body.items);
    subsegment?.close();
  } catch (err) {
    subsegment?.addError(err as Error);
    subsegment?.close();
    throw err;
  }

  // DynamoDB call automatically traced (captureAWSv3Client)
  await ddbClient.send(new AWSv3.GetItemCommand({ ... }));

  res.json({ status: 'ok' });
});

app.use(AWSXRay.express.closeSegment());
```

### X-Ray Service Map

The service map is a real-time graph of your architecture as X-Ray observes it. Each node shows:
- Request rate (req/s)
- Error rate (4xx %)
- Fault rate (5xx %)
- Latency distribution (p50/p99 histogram)

Edges show call relationships and error propagation. Clicking a node filters to traces for that service. **Groups** let you save filter expressions as named views (e.g., `annotation.tenantId = "acme"` to see all traces for one tenant).

### AWS Distro for OpenTelemetry (ADOT)

ADOT is AWS's maintained distribution of the OpenTelemetry collector and language SDKs. It is the preferred choice for ECS/EKS workloads because:

- Vendor-agnostic: same code exports to X-Ray, Jaeger, Zipkin, or any OTLP backend
- OTLP exporter sends traces to X-Ray and metrics to CloudWatch
- ADOT Lambda Layer: drop-in automatic instrumentation for Lambda — no code changes required, configure via environment variables

```yaml
# ADOT Collector config: receive OTLP, export to X-Ray + CloudWatch
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317

exporters:
  awsxray:
    region: us-east-1
  awsemf:
    region: us-east-1
    namespace: MyApp/OTEL

service:
  pipelines:
    traces:
      receivers: [otlp]
      exporters: [awsxray]
    metrics:
      receivers: [otlp]
      exporters: [awsemf]
```

---

## 3. AWS CloudTrail — API Audit Trail

CloudTrail records every AWS API call made in your account — who made it, from where, at what time, and what the response was. It is the authoritative answer to "who changed production?"

### What CloudTrail Captures

| Event Type | Examples | Default | Cost |
|---|---|---|---|
| **Management events** | `EC2:RunInstances`, `IAM:CreatePolicy`, `S3:CreateBucket` | Enabled (last 90 days in Event History) | Free for first copy per region |
| **Data events** | `S3:GetObject`, `Lambda:Invoke`, `DynamoDB:GetItem` | Disabled | ~$0.10/100K events |
| **Insights events** | Unusual `IAM:CreateAccessKey` volume, `EC2:RunInstances` burst | Disabled | ~$0.35/100K events analyzed |

Event History (90-day rolling window) is free but not queryable with custom SQL. For compliance and forensics, you need a **trail** that writes to S3.

### Configuration Best Practices

1. **Organization trail** — created in the management account, automatically captures all member accounts, single S3 bucket, single CloudWatch Logs group.
2. **All regions** — always enable multi-region to catch activity in opted-in and future regions.
3. **S3 + Object Lock** — store trail logs in a dedicated S3 bucket with Object Lock in compliance mode. This makes logs tamper-proof even if an attacker gains S3 access.
4. **Log File Validation** — CloudTrail writes a digest file (SHA-256 hash chain) every hour. `validate-logs` CLI command verifies no files were deleted or modified.
5. **CloudWatch Logs integration** — stream trail to a CloudWatch Logs group; create metric filters + alarms for:
   - Root account login
   - Console sign-in without MFA
   - IAM policy changes
   - CloudTrail itself being disabled or modified
   - Security group / NACL changes

### CloudTrail Lake

Managed event data store with up to 7-year retention. SQL queries via the console or API — no need to set up Athena, Glue catalog, or S3 partitioning. Immutable ingestion: events cannot be deleted. Use cases: compliance evidence, security investigations, SLA reporting.

### Key Forensics Queries

```sql
-- Find all IAM changes in the last 24 hours
SELECT eventTime, userIdentity.arn, eventName, sourceIPAddress
FROM cloudtrail_logs
WHERE eventSource = 'iam.amazonaws.com'
  AND eventTime > DATE_ADD('hour', -24, NOW())
ORDER BY eventTime DESC;

-- Find failed authorization attempts
SELECT eventTime, userIdentity.arn, errorCode, errorMessage, sourceIPAddress
FROM cloudtrail_logs
WHERE errorCode IN ('AccessDenied', 'UnauthorizedAccess', 'Client.UnauthorizedAccess')
ORDER BY eventTime DESC
LIMIT 100;

-- Who assumed a specific role?
SELECT eventTime, userIdentity.arn, sourceIPAddress,
       responseElements.credentials.expiration
FROM cloudtrail_logs
WHERE eventName = 'AssumeRole'
  AND requestParameters.roleArn = 'arn:aws:iam::123456789012:role/prod-admin'
ORDER BY eventTime DESC;
```

---

## 4. AWS Config — Configuration Compliance

While CloudTrail answers "who made this API call?", AWS Config answers "what is the current and historical state of my resources?" It continuously records configuration snapshots for every supported resource and evaluates them against rules.

### Core Concepts

- **Configuration item**: point-in-time snapshot of a resource's configuration (attributes, relationships to other resources, tags, IAM policies).
- **Configuration timeline**: full history of all configuration changes for a resource — who changed it, when, what it looked like before and after.
- **Config rules**: evaluate whether resources comply with a desired state. Two types:
  - **Managed rules**: 200+ AWS-provided rules (e.g., `encrypted-volumes`, `s3-bucket-public-read-prohibited`)
  - **Custom rules**: Lambda-backed rules for business-specific logic (e.g., "all EC2 instances must have a `CostCenter` tag")
- **Conformance packs**: bundles of rules + remediation actions mapped to compliance frameworks (CIS AWS Benchmark, NIST 800-53, HIPAA, PCI-DSS). Deploy a conformance pack to get 30+ rules in one action.
- **Remediation actions**: SSM Automation documents that auto-correct non-compliant resources (e.g., automatically enable S3 block public access when the rule fires).
- **Organization Config Rules**: deploy rules from the management account to all member accounts simultaneously.

### Common Managed Rules

| Rule | What It Checks |
|---|---|
| `encrypted-volumes` | All EBS volumes must be encrypted at rest |
| `s3-bucket-public-read-prohibited` | No S3 bucket with public read ACL or policy |
| `restricted-ssh` | No security group allows `0.0.0.0/0` on port 22 |
| `root-account-mfa-enabled` | Root account has MFA enabled |
| `cloudtrail-enabled` | CloudTrail is active in the region |
| `rds-storage-encrypted` | All RDS instances have storage encryption |
| `iam-password-policy` | Account password policy meets minimum requirements |
| `required-tags` | All resources have mandatory tags (e.g., `Environment`, `Owner`) |

### CloudTrail vs. AWS Config

| Question | Tool |
|---|---|
| "Who called `DeleteSecurityGroup` at 14:32?" | CloudTrail |
| "What did the security group look like before deletion?" | AWS Config timeline |
| "Which security groups allow unrestricted SSH right now?" | AWS Config rules |
| "Show me all API calls from a compromised access key" | CloudTrail |
| "When did this S3 bucket policy change, and what was the old policy?" | AWS Config |

Use them together: Config identifies non-compliant resources; CloudTrail identifies who made the change that caused non-compliance.

### Automated Remediation Flow

```
Resource changes state
        ↓
AWS Config detects configuration drift
        ↓
Config rule evaluates → NON_COMPLIANT
        ↓
EventBridge rule fires on Config compliance change event
        ↓
SSM Automation document runs (e.g., "AWSConfigRemediation-EnableS3BucketEncryption")
        ↓
Resource corrected → Config re-evaluates → COMPLIANT
        ↓
SNS notification: "Auto-remediated: s3-bucket-public-read-prohibited on bucket prod-uploads"
```

For higher-risk remediations (e.g., terminating EC2 instances, rotating IAM credentials) use **manual remediation** with an approval gate via SSM Change Manager rather than fully automatic execution. The rule still fires immediately; a human approves the SSM document run.

**Aggregator**: AWS Config Aggregator consolidates compliance data from all accounts and regions into a single view. Query across your entire organization: "show me all non-compliant resources in all production accounts."

---

## 5. Observability Strategy — Putting It Together

### Three Pillars Mapping

```
Metrics  → CloudWatch Metrics (namespace/dimension)
           ↓ custom: EMF in Lambda / PutMetricData elsewhere
           ↓ alarms → SNS → PagerDuty/Opsgenie/Slack

Logs     → CloudWatch Logs (structured JSON)
           ↓ Logs Insights for ad-hoc queries
           ↓ metric filters for automated counters
           ↓ subscriptions → Kinesis Firehose → S3 → Athena (long-term)

Traces   → X-Ray (Lambda, EC2, ECS simple workloads)
           ADOT → X-Ray (ECS/EKS production, multi-language)
           ↓ service map for visual dependency analysis
           ↓ trace filtering by annotation (tenantId, userId)

Network  → VPC Flow Logs → CloudWatch Logs or S3
           ↓ Logs Insights queries for security / connectivity debugging
           ↓ metric filters: rejected traffic counters → alarms
```

### VPC Flow Logs as a Fourth Signal

VPC Flow Logs capture accepted and rejected network traffic at the ENI, subnet, or VPC level. They are CloudWatch Logs data — stored in a log group and queryable with Logs Insights. They are not application-level observability but are essential for network security forensics and connectivity debugging.

Key use cases:
- **Security**: detect port scans, lateral movement, unexpected outbound connections (e.g., data exfiltration to external IPs)
- **Connectivity debugging**: confirm whether a packet was accepted or rejected by a security group/NACL — eliminates "is it the app or the network?" ambiguity
- **Cost attribution**: identify which ENIs are generating cross-AZ or internet transfer costs

```
# Logs Insights: find rejected traffic to a specific port
fields srcAddr, dstAddr, dstPort, action, protocol
| filter action = "REJECT" and dstPort = 5432
| stats count() as rejections by srcAddr
| sort rejections desc
| limit 20
```

Flow logs have 1–15 minute delivery lag (not real-time). For real-time network threat detection, combine VPC Flow Logs with Amazon GuardDuty — GuardDuty ingests flow logs automatically and applies ML threat detection without you querying them manually.

### Correlation IDs — The Connective Tissue

Without correlation IDs, debugging a multi-service request means cross-referencing timestamps in three separate consoles. With them, you can filter CloudWatch Logs, X-Ray traces, and CloudTrail events to a single logical request.

**Implementation pattern**:

1. **API Gateway**: inject `$context.requestId` as a custom header `X-Correlation-Id` in the integration request (or generate a UUID via a Lambda authorizer).
2. **Lambda**: read `X-Correlation-Id` from the event, fall back to `context.awsRequestId`. Add as X-Ray annotation and include in every log line.
3. **SQS/SNS**: pass `correlationId` as a message attribute. Receiving Lambda reads it from the event and continues propagating.
4. **DynamoDB writes**: store `correlationId` as an attribute for data-level forensics.

```typescript
// Lambda receiving from API Gateway
export const handler = async (event: APIGatewayEvent, context: Context) => {
  const correlationId =
    event.headers['X-Correlation-Id'] ?? context.awsRequestId;

  // Add to X-Ray for trace filtering
  AWSXRay.getSegment()?.addAnnotation('correlationId', correlationId);

  // Include in all logs
  const log = (msg: string, extra?: object) =>
    console.log(JSON.stringify({
      correlationId, requestId: context.awsRequestId,
      service: 'checkout', message: msg, ...extra,
    }));

  log('Processing payment', { amount: event.body });

  // Propagate to SQS
  await sqsClient.send(new SendMessageCommand({
    QueueUrl: process.env.QUEUE_URL!,
    MessageBody: JSON.stringify(payload),
    MessageAttributes: {
      correlationId: { DataType: 'String', StringValue: correlationId },
    },
  }));
};
```

### Cost-Effective Observability

| Resource | Pricing | Optimization |
|---|---|---|
| Custom metrics | $0.30/metric/month (first 10K) | Use EMF in Lambda — shares log cost |
| Logs ingest | $0.50/GB | Set log retention on every group; reduce verbosity in hot paths |
| Logs storage | $0.03/GB/month | Retention policy; archive cold logs to S3 via Firehose |
| Logs Insights | $0.005/GB scanned | Narrow time range and log group; save frequent queries |
| X-Ray traces | $5.00/million traces | Default sampling (5 req/s + 5%) is sufficient for most workloads |
| CloudWatch dashboards | First 3 free, $3/dashboard/month | Consolidate — fewer, denser dashboards beat many sparse ones |
| CloudTrail data events | $0.10/100K events | Enable only for S3 buckets and Lambda functions that require audit |

**Biggest wins**: (1) set retention on all log groups on day one — forgotten groups grow unbounded, (2) use EMF instead of custom PutMetricData in Lambda, (3) keep X-Ray sampling at defaults unless you have a specific low-traffic debugging need.

### Alerting Best Practices: USE + RED Methods

**USE** (for infrastructure — EC2, RDS, ECS nodes):
- **U**tilization — CPU %, memory %, disk I/O %
- **S**aturation — queue depth, run queue length, connection pool exhaustion
- **E**rrors — disk errors, network errors, hardware faults

**RED** (for services — APIs, Lambda, ECS tasks):
- **R**ate — requests per second
- **E**rrors — error rate (4xx, 5xx)
- **D**uration — latency p50/p99/p999

**Composite alarm pattern for a service**:

```
"checkout-service-health" = (
  ALARM("checkout-error-rate-high")         # RED: error rate > 1%
  OR ALARM("checkout-p99-latency-high")     # RED: p99 > 3s
)
AND NOT ALARM("payment-provider-degraded")  # suppress if known upstream issue
```

Single page fires. Alarm description includes runbook URL. On-call engineer gets one notification instead of five.

### Incident Response Walkthrough — Production Latency Spike

This is the end-to-end investigation flow when a composite alarm fires:

```
1. COMPOSITE ALARM fires: "checkout-service-degraded"
   ↓ CloudWatch Alarm → SNS → PagerDuty page

2. DASHBOARD CHECK (30 seconds)
   - Open CloudWatch automatic Lambda dashboard
   - Confirm: p99 Duration spiked from 200ms → 4s at 14:47 UTC
   - Error rate: flat (no 5xx increase — latency, not errors)

3. X-RAY SERVICE MAP (1 minute)
   - checkout-lambda → dynamodb shows 3.8s avg latency
   - Other downstream services (SQS, external API) look normal
   - DynamoDB node is orange: high latency, low fault rate

4. X-RAY TRACE DRILL-DOWN (2 minutes)
   - Filter traces: annotation.service = "checkout", duration > 2s
   - Open a slow trace: DynamoDB GetItem subsegment = 3.7s
   - Check annotation: tableArn = "orders-table"
   - Metadata shows: ReturnedItemCount = 1, ConsumedCapacity = 14.5 RCU

5. CLOUDWATCH LOGS INSIGHTS (2 minutes)
   filter @type = "REPORT" and @duration > 2000
   | stats count(), avg(@duration), max(@duration) by bin(5m)
   → spike started at 14:45 UTC, correlated with deployment event

6. CLOUDTRAIL (1 minute)
   - Filter: eventSource = dynamodb.amazonaws.com, eventTime around 14:43
   - Find: UpdateTable event — provisioned throughput changed from 100 to 5 RCU
   - userIdentity.arn: arn:aws:iam::123456789:role/ci-deploy-role

7. ROOT CAUSE: CI/CD pipeline Terraform apply reduced DynamoDB capacity
   RESOLUTION: Revert table throughput; add Config rule to alert on capacity decreases
   FOLLOW-UP: Add DynamoDB ConsumedReadCapacityUnits alarm to composite alarm
```

Total investigation time: ~6 minutes with full observability stack. Without it: indefinite.

---

## 6. Amazon Managed Grafana & Managed Prometheus

For Kubernetes-native teams or multi-cloud environments, AWS provides fully managed versions of the two dominant open-source observability tools.

### Amazon Managed Service for Prometheus (AMP)

- CNCF-compatible managed Prometheus — standard PromQL queries, standard scrape configs
- Remote-write from EKS (via Prometheus server or ADOT collector), ECS (via ADOT), or on-premises
- 150-day default retention (configurable); no cluster to size or WAL to manage
- Integrates with Amazon Managed Grafana as a native data source
- IAM-based authentication via SigV4 signing — no Prometheus Basic Auth to manage

```yaml
# EKS: ADOT collector remote-writes to AMP
exporters:
  prometheusremotewrite:
    endpoint: "https://aps-workspaces.us-east-1.amazonaws.com/workspaces/ws-xxx/api/v1/remote_write"
    auth:
      authenticator: sigv4auth
```

### Amazon Managed Grafana (AMG)

- Fully managed Grafana — no server to provision, automatic upgrades, built-in HA
- IAM Identity Center (SSO) authentication — no local Grafana users to manage
- Native data source plugins: CloudWatch, X-Ray, AMP, Timestream, Athena, OpenSearch
- Existing Grafana dashboards (JSON export) import directly
- Use AMG when: you already have Grafana dashboards, you're running EKS, or you want a unified view across CloudWatch and Prometheus metrics

**When to use AMP + AMG vs native CloudWatch**:
- CloudWatch native: simple Lambda/ECS workloads, team already lives in AWS Console, minimal Kubernetes
- AMP + AMG: Kubernetes-heavy stack, existing Grafana expertise, need PromQL flexibility, multi-cloud metrics

**Example PromQL queries against AMP (EKS workloads)**:

```promql
# Request rate by pod (RED: Rate)
sum(rate(http_requests_total{namespace="prod"}[5m])) by (pod)

# Error rate percentage (RED: Errors)
sum(rate(http_requests_total{status=~"5.."}[5m]))
  / sum(rate(http_requests_total[5m])) * 100

# p99 latency by service (RED: Duration)
histogram_quantile(0.99,
  sum(rate(http_request_duration_seconds_bucket{namespace="prod"}[5m]))
  by (le, service)
)

# CPU throttling ratio (USE: Saturation)
sum(rate(container_cpu_cfs_throttled_seconds_total[5m]))
  / sum(rate(container_cpu_cfs_periods_total[5m])) * 100
```

### CloudWatch Evidently — Feature Flags & A/B Testing

A related observability-adjacent service: **Amazon CloudWatch Evidently** lets you run controlled feature rollouts and A/B experiments. Define a feature with percentage-based traffic splits, then analyze experiment results using CloudWatch Evidently metrics alongside your standard CloudWatch dashboards. Useful when you want to gate a new payment flow to 5% of traffic and compare conversion rates before full rollout — all within the same AWS observability console rather than a third-party feature flag SaaS.

### CloudWatch Internet Monitor

Monitors internet-facing application health from the perspective of end users across ISPs and AWS edge locations. Automatically detects when an internet routing issue, ISP outage, or AWS region problem is impacting your users' connectivity — and tells you what percentage of your traffic is affected and from which geography. Integrates with CloudWatch alarms. Relevant for global applications where customer-reported issues may be ISP-side rather than your infrastructure.

---

### Lambda Cold Start Observability

Cold starts are often the highest-impact latency spikes in Lambda-based systems and need dedicated observability. Key metrics and where to find them:

| Signal | Source | How to Alert |
|---|---|---|
| `InitDuration` in REPORT logs | CloudWatch Logs | Metric filter → alarm on p99 > 2s |
| `init_duration` metric | Lambda Insights layer | CloudWatch alarm on max |
| Cold start rate | EMF custom metric | Emit `ColdStart=1` in first invocation, `ColdStart=0` thereafter |
| Concurrent executions burst | `AWS/Lambda:ConcurrentExecutions` | Alarm near account concurrency limit |

```typescript
// Track cold starts with EMF
const isColdStart = (() => {
  let first = true;
  return () => { const v = first; first = false; return v; };
})();

export const handler = async (event: unknown, context: Context) => {
  metrics.addMetric('ColdStart', MetricUnits.Count, isColdStart() ? 1 : 0);
  metrics.addDimension('FunctionName', context.functionName);
  metrics.publishStoredMetrics();
  // ... handler logic
};
```

Cold start alarms should trigger investigation into: provisioned concurrency coverage gaps, Lambda layer size reduction, memory size tuning (more memory = faster init), or moving initialization code outside the handler.

---

## Interview Q&A

**Q: How does CloudWatch differ from X-Ray? When do you use each?**

A: CloudWatch is the metrics, logs, and alarms platform — it tells you _that_ something is wrong (error rate spike, latency alarm) and gives you the log lines around the failure. X-Ray is distributed tracing — it tells you _where_ in the call chain the problem originated by linking segments from API Gateway through Lambda through DynamoDB into a single trace. Use CloudWatch for operational dashboards and alerting; use X-Ray when you need to debug _which_ downstream dependency is causing latency or errors. In practice you use both: CloudWatch fires the alarm, X-Ray helps you identify the root cause.

---

**Q: How would you debug a performance regression in a Lambda-based microservice?**

A: Start at CloudWatch metrics: check `Duration` (p99), `Errors`, `Throttles`, and `ConcurrentExecutions` for the affected function. If Lambda Insights is enabled, check `init_duration` for cold start increases and `memory_utilization` to rule out memory pressure. Next, query CloudWatch Logs Insights for REPORT lines to find the slowest individual invocations. Then open X-Ray service map to see if the latency is inside the Lambda (CPU-bound) or waiting on a downstream call (DynamoDB, an external API). Drill into specific slow traces in X-Ray to see subsegment timing. Common culprits: cold starts (increase provisioned concurrency or memory), DynamoDB hot partitions (check `ConsumedCapacity` metric), N+1 queries (visible as many DynamoDB subsegments per trace).

---

**Q: What is the Embedded Metrics Format (EMF) and why is it better than PutMetricData in Lambda?**

A: EMF is a structured JSON envelope written to stdout that CloudWatch Logs automatically parses and extracts as a CloudWatch metric — no separate API call. The advantages in Lambda are: (1) zero additional latency — the metric write is synchronous with the log write that was happening anyway; (2) no PutMetricData API call means no additional IAM permission, no extra cost per call, no risk of hitting the 150 TPS limit; (3) the same log line contains both the human-readable message and the metric, so you never lose context when debugging; (4) the raw data is queryable in Logs Insights even before metric aggregation. The trade-off is that EMF metrics have the same 1-hour resolution floor as CloudWatch custom metrics by default unless you use high-resolution storage.

---

**Q: Explain how you'd implement distributed tracing across an API Gateway → Lambda → SQS → Lambda chain.**

A: (1) Enable X-Ray tracing on the API Gateway stage — the gateway injects `X-Amzn-Trace-Id` into the request. (2) Enable active tracing on both Lambda functions — the runtime automatically creates a segment linked to the incoming trace header. (3) The first Lambda passes the trace ID to SQS as a message attribute (`AWSTraceHeader`). When SQS delivers to the second Lambda, the runtime reads this attribute and links the new segment to the original trace. (4) Add X-Ray SDK instrumentation in both functions: `captureAWSv3Client` for the SQS and DynamoDB clients, custom subsegments for business logic, and annotations (`tenantId`, `orderId`) for filtering. (5) Also propagate a `correlationId` custom header through SQS message attributes — X-Ray trace IDs expire after 30 days but business-level correlation IDs in logs persist for the full log group retention period.

---

**Q: How do you set up alerting that reduces noise and avoids alert fatigue?**

A: Four techniques: (1) **N-of-M data points** in threshold alarms — `3 out of 5 periods` eliminates single-spike false positives; (2) **Composite alarms** — only page when _both_ error rate AND latency are elevated, not when either crosses a threshold in isolation; (3) **Anomaly detection alarms** — let CloudWatch learn the baseline instead of setting static thresholds that fire every Monday morning when batch jobs run; (4) suppress known upstream issues — composite alarm with `AND NOT ALARM("dependency-degraded")` prevents cascading alerts from an upstream outage. Operationally: every alarm needs a runbook link in its description, a defined severity, and an owner. Alarms with no owner get ignored and create fatigue.

---

**Q: What does CloudTrail capture vs AWS Config? How do they complement each other?**

A: CloudTrail is an event log of API calls: who called what API, when, from where, with what parameters, and what the response was. AWS Config is a configuration recorder: it maintains a timeline of resource state snapshots and evaluates current state against compliance rules. CloudTrail answers "what happened?" Config answers "what does it look like now, and what did it look like before?" Complement: Config's rule fires and marks a resource non-compliant → you use CloudTrail to find which API call caused the drift → you have both the what (Config before/after) and the who/when (CloudTrail event).

---

**Q: A client says "our prod environment was changed and we don't know who did it." What do you investigate?**

A: Start with CloudTrail Event History for the time window in question. Filter by the affected resource ARN or by event source (e.g., `ec2.amazonaws.com`). Look for `ModifySecurityGroup`, `UpdateFunctionCode`, `PutBucketPolicy`, or whichever resource type is affected. Check `userIdentity` to identify the IAM principal (role, user, or service). Cross-reference with AWS Config timeline for the resource — it shows the exact before/after configuration diff. If the access key or role ARN is unfamiliar, check CloudTrail for `AssumeRole` events to trace the assumed role chain back to the original principal. If it happened across an AWS Org, use the organization trail in the management account. If the client doesn't have a trail configured, CloudTrail Event History only covers the last 90 days and only management events — data events and older history are gone.

---

**Q: How would you design a cost-effective observability stack for a startup?**

A: Use AWS native tools for the first 6–12 months — avoid paying for Datadog or New Relic at startup scale. (1) EMF for all Lambda custom metrics — zero incremental cost on top of existing log ingestion. (2) Set retention to 30 days on all log groups immediately — use a CloudFormation custom resource or EventBridge + Lambda to enforce this automatically on any new log group. (3) X-Ray with default sampling (5 req/s + 5%) — trace coverage without predictable high cost. (4) One composite alarm per service: `(p99 > SLA) OR (error rate > 1%)` → SNS → Slack. (5) Three automatic CloudWatch dashboards (free): Lambda, API Gateway, DynamoDB. One custom dashboard for business KPIs (EMF metrics). (6) Skip AMP/AMG until you have EKS with multiple clusters — overkill for ECS or Lambda workloads.

---

**Q: What are CloudWatch composite alarms and when do you use them?**

A: Composite alarms evaluate a Boolean expression over other alarm states — `ALARM`, `OK`, or `INSUFFICIENT_DATA`. They do not directly evaluate any metric; they aggregate child alarm states. Use cases: (1) **Noise reduction** — "service is degraded" fires only when both error rate AND latency alarms are in ALARM, not either alone; (2) **Suppression** — add `AND NOT ALARM("maintenance-mode")` to prevent pages during planned deployments; (3) **Aggregation** — single alarm for an entire service to a human on-call while child alarms carry more detail for automation; (4) **Cross-account health** — a monitoring account composite alarm aggregating child alarms from multiple source accounts for a single organizational health view.

---

**Q: How do you ensure log retention compliance (90-day, 1-year, 7-year) across all accounts?**

A: Three layers: (1) **Preventive** — AWS Organizations SCP denying `logs:DeleteRetentionPolicy` and `logs:PutRetentionPolicy` below the minimum for production OUs. (2) **Detective** — AWS Config managed rule `cloudwatch-log-group-encrypted` and a custom Config rule checking that `retentionInDays >= 90` for all log groups; non-compliant groups trigger SNS notification. (3) **Corrective** — EventBridge rule on `CreateLogGroup` event → Lambda that calls `PutRetentionPolicy` with the account-appropriate retention value. For 7-year compliance (SOC2, HIPAA), stream logs via Kinesis Firehose to an S3 bucket with Object Lock (governance or compliance mode) — CloudWatch Logs retention does not provide tamper-evident storage, but S3 Object Lock does.

---

**Q: Explain sampling in X-Ray. Why not trace 100% of requests in production?**

A: Sampling determines the fraction of requests for which X-Ray creates and records a full trace. At 100%, a service handling 10,000 req/s would generate 10,000 traces/sec × $5/M = $50/hour — plus the latency overhead of the X-Ray SDK recording every segment. The default rule (5 req/s reservoir + 5% of the rest) captures all low-traffic paths fully while reducing high-traffic path costs by 95%. The remaining 5% is still statistically representative for latency distributions and error rate analysis. For critical low-volume paths (checkout, auth), increase the reservoir size so every request is traced. For high-volume read paths (homepage, search), the 5% default is usually sufficient. Custom sampling rules let you set different rates per URL pattern, HTTP method, or service name — so you can trace 100% of errors (`errorCode != null`) while sampling 1% of successful requests.

---

## Red Flags to Avoid

- **No log retention policy** — forgetting to set retention means log groups grow indefinitely. At $0.03/GB/month a busy service will accumulate gigabytes fast. Set retention on every log group at creation time.
- **PutMetricData in hot Lambda paths** — every call adds ~10ms of latency and counts against a 150 TPS API limit. Use EMF instead.
- **Tracing 100% of requests without capping** — can turn a $5/month X-Ray bill into $500 at scale. Always configure sampling rules appropriate to your traffic volume.
- **Unstructured log lines in Lambda** — `console.log("error:", err)` is unparseable by Logs Insights. Always `JSON.stringify` your log objects.
- **No composite alarms** — alerting directly on individual metrics means 5–10 notifications per incident. Composite alarms give one actionable signal per service degradation.
- **Missing data treatment left as default `missing`** — for heartbeat metrics (canary success), `missing` means a completely down endpoint never triggers an alarm if CloudWatch has no data. Set to `breaching`.
- **CloudTrail data events disabled on sensitive S3 buckets** — management events (bucket creation) are free, but `GetObject` and `PutObject` are data events that require explicit enablement. A breach via S3 exfiltration produces no CloudTrail evidence without them.
- **No organization trail** — per-account trails are easy to miss in new accounts. An organization trail in the management account covers all current and future accounts automatically.
- **Dashboards without runbook links** — alarms that fire without context force on-call engineers to rediscover the investigation steps every time. Every alarm description should link to a runbook.
- **Ignoring `INSUFFICIENT_DATA` alarms** — this state often means the metric stopped flowing (metric filter broken, CloudWatch agent stopped, Lambda function not invoked). Treat it as actionable, not neutral.
- **No correlation ID strategy** — debugging a multi-Lambda failure without correlation IDs means manually cross-referencing timestamps across three log groups. Define the propagation strategy before your first microservice goes to production.

---

## See Also

- [Lambda & Serverless](/aws-lambda-serverless) — Lambda Insights layer, EMF patterns, X-Ray active tracing, cold start metrics
- [IAM & Security](/aws-iam-security) — CloudTrail forensics for IAM events, least-privilege for X-Ray daemon roles
- [AWS Architecture](/aws-architecture) — Observability as a Well-Architected operational excellence pillar
- [Compute & Containers](/aws-compute-containers) — Container Insights for ECS/EKS, ADOT collector sidecar patterns
- [CI/CD & DevOps](/aws-cicd-devops) — Deployment monitoring, canary alarms for blue/green rollbacks
- [VPC & Networking](/aws-vpc-networking) — VPC Flow Logs as a CloudWatch Logs data source for network observability
- [Cost Optimization](/aws-cost-optimization) — CloudWatch cost management, log retention economics, X-Ray sampling math
