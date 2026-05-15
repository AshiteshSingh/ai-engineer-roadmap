# AWS Messaging & Events

## The 30-Second Pitch
AWS Messaging & Events is the set of services—SQS, SNS, EventBridge, Kinesis, and MSK—that decouple application components so they communicate asynchronously without direct dependencies. It solves two core problems: **reliability** (a downstream service being slow or down no longer crashes the upstream caller) and **scalability** (each component scales independently based on its own load). Teams pick this stack for event-driven architectures, real-time data pipelines, fan-out notifications, and microservice integration. The strategic choice is not one service—it's understanding which tool fits each pattern: SQS for work queues, SNS for push fan-out, EventBridge for event routing and orchestration glue, Kinesis for ordered real-time streams, and MSK when you need Apache Kafka.

## How It Actually Works

The fundamental shift from synchronous HTTP calls to asynchronous messaging:

```
Synchronous (tight coupling):
Service A --> HTTP --> Service B
                         |
                    Service B slow/down → Service A fails

Asynchronous (loose coupling):
Service A --> Queue/Topic/Stream --> Service B
                   |
             Service A succeeds regardless of Service B state
             Service B processes at its own pace
             Failures don't propagate upstream
```

Every service in this stack trades one thing: **complexity for resilience**. You gain reliability, independent scaling, and replay capability. You pay with eventual consistency, harder debugging, and the need to handle idempotency.

---

## 1. Amazon SQS — Simple Queue Service

### Standard vs FIFO Queues

| Feature | Standard Queue | FIFO Queue |
|---|---|---|
| Throughput | Unlimited | 300 TPS (no batching), 3,000 TPS (batching) |
| Ordering | Best-effort (not guaranteed) | Strict FIFO per MessageGroupId |
| Delivery | At-least-once (duplicates possible) | Exactly-once (5-min deduplication window) |
| Deduplication | Not supported | Content-Based or explicit DeduplicationId |
| Message Groups | Not supported | MessageGroupId partitions ordering scope |
| Use Cases | High-throughput work queues, decoupling | Financial transactions, order state machines, idempotency-critical flows |
| Queue URL suffix | `.amazonaws.com/…/MyQueue` | `.amazonaws.com/…/MyQueue.fifo` |
| Pricing (per 1M req) | $0.40 | $0.50 |

**Key FIFO insight:** MessageGroupId is like a partition key—all messages with the same ID are processed strictly in order by a single consumer. Different MessageGroupIds can be processed in parallel. This lets you have ordering per customer/tenant while still scaling horizontally.

### Core Mechanics

**Message lifecycle:**
```
Producer sends message
    ↓
Message enters queue (visible)
    ↓
Consumer polls → message becomes invisible (visibility timeout starts)
    ↓
Consumer processes and calls DeleteMessage → message gone permanently
    OR
Visibility timeout expires → message reappears for retry
    ↓ (after maxReceiveCount retries)
Message sent to Dead-Letter Queue (DLQ)
```

**Visibility timeout:**
- Default: 30 seconds. Maximum: 12 hours.
- While a consumer holds the message, it's invisible to other consumers.
- If your [Lambda](/aws-lambda-serverless) function timeout is 5 minutes, set visibility timeout to at least 6 minutes—otherwise the message reappears mid-processing and another worker picks it up.
- Extend dynamically with `ChangeMessageVisibility` if processing takes longer than expected.

**Long polling vs short polling:**
- Short polling: returns immediately, even if queue is empty → wasteful API calls + cost.
- Long polling: `WaitTimeSeconds=20` — SQS waits up to 20s for a message to arrive before returning empty. **Always use long polling.** Reduces empty responses, lowers cost, decreases latency for new messages.

**Message retention:** 4 days default, configurable up to 14 days.

**Message size:** 256 KB max. For larger payloads, use the **SQS Extended Client Library** — it stores the actual payload in S3 and puts an S3 reference pointer in the SQS message body. The consumer retrieves the S3 object transparently.

**Dead-Letter Queue (DLQ):**
- Configured via Redrive Policy on the source queue.
- `maxReceiveCount`: how many times a message can be received before moving to DLQ (typical: 3–5).
- Monitor `ApproximateNumberOfMessagesNotVisible` for processing failures (messages currently held by consumers).
- Monitor `ApproximateNumberOfMessages` on the DLQ — any value above 0 means something is broken.
- **DLQ Redrive** (console/API): replay DLQ messages back to the source queue after you fix the bug. Available natively — no custom Lambda needed.

### Lambda Integration (Event Source Mapping)

SQS → Lambda is one of the most common patterns. Lambda polls the queue on your behalf.

| Parameter | Range | Recommendation |
|---|---|---|
| Batch size | 1–10,000 | 10–100 for typical workloads |
| Batch window | 0–300s | Set 5–30s to accumulate records for cost efficiency |
| Max concurrency | 2–1,000 | Set to protect downstream (DB connection limits) |
| Visibility timeout | 30s–12hr | 6× your Lambda timeout |

**Partial batch failure — the most important SQS + Lambda pattern:**

Without it: one failed message fails the entire batch → all messages retry → cascading duplicates.

```javascript
// Node.js Lambda — SQS with partial batch failure handling
export const handler = async (event) => {
  const batchItemFailures = [];

  await Promise.allSettled(
    event.Records.map(async (record) => {
      try {
        const body = JSON.parse(record.body);
        await processOrder(body);
      } catch (err) {
        console.error(`Failed to process message ${record.messageId}:`, err);
        // Return this message ID as failed — only this one retries
        batchItemFailures.push({ itemIdentifier: record.messageId });
      }
    })
  );

  return { batchItemFailures };
  // Failed messages return to queue; successful ones are deleted automatically
};

async function processOrder(order) {
  // your processing logic
}
```

Enable this by setting `FunctionResponseTypes: ["ReportBatchItemFailures"]` on the event source mapping.

**FIFO queue + Lambda:** Lambda creates one concurrent execution per MessageGroupId. This preserves strict ordering per group while allowing parallelism across groups.

**Scaling behavior:** Lambda scales to `ceil(messageCount / batchSize)` concurrent executions, up to the concurrency limit. Set reserved concurrency on your Lambda to act as a throttle — protects downstream systems (RDS, third-party APIs) from being overwhelmed.

### SQS Fan-Out Pattern

One common problem: a single producer needs to notify multiple independent consumers. Direct point-to-point would create coupling. The solution:

```
Producer
    ↓
SNS Topic
    ├──→ SQS Queue A (Order Service)
    ├──→ SQS Queue B (Inventory Service)
    └──→ SQS Queue C (Analytics Service)
```

Each consumer gets its own queue. They scale independently. If one consumer is slow or down, it doesn't affect the others. The SQS queue buffers load, so the downstream service processes at its own pace.

### SQS Producer — Node.js with FIFO Queue

```javascript
// Node.js — send message to SQS FIFO queue
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';

const sqs = new SQSClient({ region: 'us-east-1' });

async function enqueueOrder(order) {
  const command = new SendMessageCommand({
    QueueUrl: 'https://sqs.us-east-1.amazonaws.com/123456789012/orders.fifo',
    MessageBody: JSON.stringify(order),
    // FIFO: group by customerId so orders per customer are strictly ordered
    MessageGroupId: order.customerId,
    // Deduplication: content-based hash (or provide explicit MessageDeduplicationId)
    MessageDeduplicationId: order.orderId,
    MessageAttributes: {
      event_type: { DataType: 'String', StringValue: 'order.placed' },
      order_value: { DataType: 'Number', StringValue: String(order.total) },
    },
  });

  const result = await sqs.send(command);
  console.log(`Enqueued order ${order.orderId}, SequenceNumber: ${result.SequenceNumber}`);
  return result;
}

// Extend visibility timeout if processing is taking longer than expected
async function extendVisibility(receiptHandle, extraSeconds = 60) {
  const { ChangeMessageVisibilityCommand } = await import('@aws-sdk/client-sqs');
  await sqs.send(new ChangeMessageVisibilityCommand({
    QueueUrl: 'https://sqs.us-east-1.amazonaws.com/123456789012/orders.fifo',
    ReceiptHandle: receiptHandle,
    VisibilityTimeout: extraSeconds,
  }));
}
```

### SQS + DLQ — CloudFormation / CDK Configuration

```yaml
# CloudFormation snippet — SQS queue with DLQ
OrdersDeadLetterQueue:
  Type: AWS::SQS::Queue
  Properties:
    QueueName: orders-dlq
    MessageRetentionPeriod: 1209600  # 14 days — keep failed messages long for investigation

OrdersQueue:
  Type: AWS::SQS::Queue
  Properties:
    QueueName: orders
    VisibilityTimeout: 360           # 6× Lambda timeout (Lambda timeout = 60s)
    ReceiveMessageWaitTimeSeconds: 20 # Always long polling
    MessageRetentionPeriod: 345600   # 4 days default
    RedrivePolicy:
      deadLetterTargetArn: !GetAtt OrdersDeadLetterQueue.Arn
      maxReceiveCount: 3             # 3 strikes before DLQ

# CloudWatch alarm — alert immediately when any message hits the DLQ
DLQDepthAlarm:
  Type: AWS::CloudWatch::Alarm
  Properties:
    AlarmName: orders-dlq-has-messages
    MetricName: ApproximateNumberOfMessagesVisible
    Namespace: AWS/SQS
    Dimensions:
      - Name: QueueName
        Value: orders-dlq
    Period: 60
    EvaluationPeriods: 1
    Threshold: 0
    ComparisonOperator: GreaterThanThreshold
    TreatMissingData: notBreaching
```

---

## 2. Amazon SNS — Simple Notification Service

### Core Model

SNS is **push-based** (vs SQS pull-based). A publisher sends one message to a topic; SNS immediately delivers it to all subscriptions in parallel.

```
Publisher → SNS Topic → [SQS Queue]
                      → [Lambda Function]
                      → [HTTP/HTTPS Endpoint]
                      → [Email address]
                      → [SMS / Mobile Push (APNs, FCM)]
                      → [Kinesis Firehose]
```

**Key characteristics:**
- No message retention (unlike SQS) — if a subscriber is down, SNS retries with backoff for HTTP endpoints; SQS queues buffer the message for the SQS subscriber.
- Up to 12.5 million subscriptions per topic.
- Messages up to 256 KB; use SNS Extended Client for larger payloads (stores in S3).

### Message Filtering Deep-Dive

Without filtering, every subscriber receives every message and must discard irrelevant ones — wasteful compute and cost. SNS filter policies solve this at the broker level.

```json
// Subscription filter policy on the "inventory-service" SQS subscription
// Only receives "order.placed" events with high-value orders
{
  "event_type": ["order.placed"],
  "order_value": [{"numeric": [">=", 1000]}],
  "region": ["eu-west-1", "us-east-1"]
}
```

```json
// Notification message with MessageAttributes that the filter evaluates
{
  "Message": "{\"orderId\": \"abc-123\", \"total\": 1500}",
  "MessageAttributes": {
    "event_type": { "DataType": "String", "StringValue": "order.placed" },
    "order_value": { "DataType": "Number", "StringValue": "1500" },
    "region":      { "DataType": "String", "StringValue": "eu-west-1" }
  }
}
```

**Filtering comparison:**

| Approach | Where filtered | Cost | Complexity |
|---|---|---|---|
| SNS filter policies | At SNS broker | Only matching messages delivered | Low — JSON config |
| EventBridge rules | At EventBridge | Only matching events routed | Medium — more expressive |
| Application-level | Inside Lambda/consumer | All messages delivered, Lambda time wasted | High — code to maintain |

Use SNS filter policies as the first line of defense. Use EventBridge when you need more complex routing logic (content-based filtering, cross-account, schema registry).

### SNS Publish — Node.js with MessageAttributes

```javascript
// Node.js — publish to SNS topic with MessageAttributes for subscriber filtering
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';

const sns = new SNSClient({ region: 'us-east-1' });

async function publishOrderEvent(order) {
  const command = new PublishCommand({
    TopicArn: 'arn:aws:sns:us-east-1:123456789012:order-events',
    Message: JSON.stringify({
      orderId: order.id,
      customerId: order.customerId,
      total: order.total,
      items: order.items,
      timestamp: new Date().toISOString(),
    }),
    Subject: 'Order Placed',
    // MessageAttributes are what SNS filter policies evaluate
    MessageAttributes: {
      event_type: {
        DataType: 'String',
        StringValue: 'order.placed',
      },
      order_value: {
        DataType: 'Number',
        StringValue: String(order.total),
      },
      customer_tier: {
        DataType: 'String',
        StringValue: order.customerTier, // 'standard' | 'premium' | 'enterprise'
      },
      region: {
        DataType: 'String',
        StringValue: order.fulfillmentRegion,
      },
    },
  });

  const result = await sns.send(command);
  console.log(`Published MessageId: ${result.MessageId}`);
  return result.MessageId;
}
```

### SNS FIFO Topics

Like SQS FIFO, but for pub/sub:
- Strict message ordering per MessageGroupId.
- Exactly-once delivery with deduplication.
- **Only SQS FIFO queues can subscribe** — no Lambda, HTTP, or email subscriptions.
- Use case: financial transactions fan-out where ordering and deduplication must be maintained downstream.

---

## 3. Amazon EventBridge — Event Bus

### Architecture

EventBridge is a **serverless event bus** that routes events between AWS services, your own applications, and third-party SaaS.

```
Event Source → EventBridge Bus → Rules (pattern match) → Targets
```

**Event bus types:**
- **Default bus**: receives events from AWS services (EC2 state changes, S3 puts, CodePipeline stages, etc.). Every AWS account has one.
- **Custom bus**: your application publishes here. Isolate domains (orders-bus, payments-bus).
- **Partner bus**: receives events from SaaS partners — Datadog, Zendesk, Shopify, GitHub, PagerDuty — without any polling or webhook management.

**Event structure:**
```json
{
  "version": "0",
  "id": "abc-123",
  "source": "com.myapp.orders",
  "detail-type": "Order Placed",
  "account": "123456789012",
  "region": "us-east-1",
  "time": "2026-03-28T10:00:00Z",
  "detail": {
    "orderId": "ord-789",
    "customerId": "cust-456",
    "total": 1500.00,
    "items": ["sku-001", "sku-002"]
  }
}
```

**Targets (20+):** Lambda, SQS, SNS, Step Functions, ECS tasks, API Gateway, Kinesis Data Streams, Kinesis Firehose, another EventBridge bus (cross-account/region), CodeBuild, CodePipeline, Systems Manager Automation.

### EventBridge Publish — Python

```python
# Python — publish custom event to EventBridge
import boto3
import json
from datetime import datetime, timezone

events = boto3.client('events', region_name='us-east-1')

def publish_order_event(order: dict) -> str:
    """Publish a custom domain event to the orders event bus."""
    event = {
        'Time': datetime.now(timezone.utc),
        'Source': 'com.myapp.orders',
        'DetailType': 'Order Placed',
        'EventBusName': 'orders-bus',  # custom bus, not the default
        'Detail': json.dumps({
            'orderId': order['id'],
            'customerId': order['customer_id'],
            'total': order['total'],
            'items': order['items'],
            'fulfillmentRegion': order.get('region', 'us-east-1'),
            'customerTier': order.get('tier', 'standard'),
        }),
    }

    response = events.put_events(Entries=[event])

    if response['FailedEntryCount'] > 0:
        failed = response['Entries'][0]
        raise RuntimeError(f"EventBridge publish failed: {failed['ErrorCode']} - {failed['ErrorMessage']}")

    entry_id = response['Entries'][0]['EventId']
    print(f"Published EventId: {entry_id}")
    return entry_id

# Batch publish — up to 10 events per PutEvents call
def publish_batch(events_list: list[dict]) -> dict:
    entries = [
        {
            'Source': 'com.myapp.orders',
            'DetailType': e['detail_type'],
            'EventBusName': 'orders-bus',
            'Detail': json.dumps(e['detail']),
        }
        for e in events_list
    ]

    # PutEvents accepts up to 10 entries per call, 256 KB total
    response = events.put_events(Entries=entries[:10])
    return {
        'failed': response['FailedEntryCount'],
        'entries': response['Entries'],
    }
```

### Event Pattern Matching

EventBridge matches on any field in the event JSON with expressive operators:

```json
// Rule pattern: match high-value orders from EU placed by premium customers
{
  "source": ["com.myapp.orders"],
  "detail-type": ["Order Placed"],
  "detail": {
    "total": [{ "numeric": [">=", 500] }],
    "region": [{ "prefix": "eu-" }],
    "customerTier": ["premium", "enterprise"],
    "fraudScore": [{ "numeric": ["<", 0.3] }]
  }
}
```

**Pattern operators:**
- `prefix` / `suffix`: string starts/ends with
- `exists: true/false`: field presence
- `equals-ignore-case`: case-insensitive string match
- `wildcard`: `*` glob matching
- `anything-but`: exclusion list
- `numeric`: range comparisons (`<`, `<=`, `=`, `>=`, `>`, `between`)
- `ip-address`: CIDR range matching

### EventBridge Pipes

Pipes are point-to-point integrations with optional filtering and enrichment — they replace the custom "glue" Lambda pattern.

```
Source → [Filter] → [Enrichment] → Target
```

**Sources:** SQS, DynamoDB Streams, Kinesis Data Streams, Managed Kafka (MSK), self-managed Kafka, RabbitMQ, ActiveMQ.

**Enrichment (optional):** Lambda function, Step Functions (synchronous Express Workflow), API Gateway, EventBridge API Destination.

**Targets:** same 20+ targets as EventBridge rules.

**Real example — DynamoDB CDC to fulfillment queue:**
```
DynamoDB Streams (new INSERT events)
    → Filter: only "Order" entity type, status = "CONFIRMED"
    → Enrichment Lambda: fetch customer shipping address from CustomerTable
    → SQS FIFO Queue (fulfillment-service) partitioned by customerId
```

Without Pipes, this required: a Lambda consuming DynamoDB Streams, filtering records, calling the enrichment API, then publishing to SQS — all custom code to write, test, and operate. With Pipes, it's a configuration.

**EventBridge Pipes — CloudFormation definition:**
```yaml
# CloudFormation — DynamoDB Streams → filter → Lambda enrich → SQS FIFO
OrderFulfillmentPipe:
  Type: AWS::Pipes::Pipe
  Properties:
    Name: order-fulfillment-pipe
    RoleArn: !GetAtt PipeRole.Arn
    Source: !GetAtt OrdersTable.StreamArn
    SourceParameters:
      DynamoDBStreamParameters:
        StartingPosition: LATEST
        BatchSize: 10
      FilterCriteria:
        Filters:
          - Pattern: '{"eventName": ["INSERT"], "dynamodb": {"NewImage": {"entityType": {"S": ["Order"]}, "status": {"S": ["CONFIRMED"]}}}}'
    Enrichment: !GetAtt EnrichOrderFunction.Arn
    EnrichmentParameters:
      InputTemplate: |
        {
          "orderId": "<$.dynamodb.NewImage.orderId.S>",
          "customerId": "<$.dynamodb.NewImage.customerId.S>"
        }
    Target: !GetAtt FulfillmentQueue.Arn
    TargetParameters:
      SqsQueueParameters:
        MessageGroupId: <$.customerId>
        MessageDeduplicationId: <$.orderId>
```

### EventBridge Scheduler

Replaces CloudWatch Events Scheduler with more power:

- **Schedule types**: rate (`rate(5 minutes)`), cron (`cron(0 9 * * ? *)`), one-time (ISO 8601 timestamp).
- **270+ direct targets**: not just Lambda — invoke Step Functions, start ECS tasks, call API destinations, publish to SQS/SNS, start Glue jobs.
- **Timezone support**: schedules respect named timezones (e.g., `Europe/Bucharest`).
- **Flexible time windows**: distribute invocations over a window (e.g., within 15 minutes of 9am) to avoid thundering herd.
- **At-least-once delivery with retry**: Scheduler retries failed invocations for up to 24 hours.

**vs cron on Lambda:** Lambda cron (via CloudWatch Events) is cheaper for low-frequency tasks but has no state, no retry management, and limited target flexibility. Scheduler handles retries and targets 270+ services directly — prefer it for production scheduled workloads.

### Schema Registry

- **Auto-discovery**: EventBridge automatically infers schemas from events flowing through the default bus. Enable schema discovery on custom buses too.
- **Code bindings**: generate typed event classes for Java, Python, and TypeScript directly from the console or CDK. Eliminates manual event struct definitions.
- **OpenAPI-compatible**: schemas are stored as OpenAPI 3.0 — usable with API documentation tools and validators.

---

## 4. Amazon Kinesis — Real-Time Data Streaming

### Kinesis Data Streams

Kinesis is designed for **ordered, replayable, multi-consumer** data streams. This is the key difference from SQS.

**Shard = unit of capacity:**
- Write: 1 MB/s or 1,000 records/s per shard (whichever comes first)
- Read (standard): 2 MB/s per shard, shared across all consumers
- Read (Enhanced Fan-Out): 2 MB/s per shard **per consumer** (dedicated, not shared)

**Record routing:**
```
Producer sends record with partition key "customer-123"
    ↓
Kinesis MD5-hashes the partition key
    ↓
Hash maps to a shard based on hash key range
    ↓
All records with same partition key → same shard → preserved order
```

Use **high-cardinality partition keys** (UUIDs, customer IDs, not "order-type" with 3 values) to distribute load evenly across shards. Hot shards (all traffic to one shard) are a common production bottleneck.

**Shard capacity planning:**
```
Target write rate: 5,000 events/second, average 500 bytes each
Write throughput needed: 5,000 × 500B = 2.5 MB/s
Shards needed for write: ceil(2.5 / 1.0) = 3 shards

Target read rate: 3 independent consumers, each needing 2.5 MB/s
Without EFO: 3 consumers × 2.5 MB/s = 7.5 MB/s, but only 2 MB/s per shard × 3 shards = 6 MB/s → throttled
With EFO:    Each consumer gets dedicated 2 MB/s × 3 shards = 6 MB/s per consumer → no contention
```

**Retention:** 24 hours default. Configurable to 7 days (standard), up to 365 days (at additional cost). Multiple consumers can replay the same data independently.

**Enhanced Fan-Out (EFO):**

| Consumer Type | Read Throughput | Delivery Model | Cost |
|---|---|---|---|
| Standard (GetRecords) | 2 MB/s shared across all consumers | Polling | Base stream cost |
| Enhanced Fan-Out | 2 MB/s per consumer per shard | HTTP/2 push (~70ms latency) | ~$0.015/shard-hr additional |

Use EFO when you have more than 2 consumers reading the same stream, or when you need consistent low-latency delivery regardless of how many consumers are active.

**Lambda integration (ESM):**
- Lambda polls shards and processes records in order per shard.
- `ParallelizationFactor` (1–10): split each shard into N parallel Lambda invocations, preserving order within each sub-range.
- `BisectBatchOnFunctionError`: on failure, split the batch in half recursively to isolate the poison-pill record.
- **Iterator age metric** (`GetRecords.IteratorAgeMilliseconds`): the lag between now and the timestamp of the last processed record. If this grows, you're falling behind — add shards or increase parallelization factor.

**Lambda Kinesis consumer — Python with error handling:**

```python
# Python Lambda — Kinesis consumer with bisect-on-error and iterator age monitoring
import json
import boto3
import time

cloudwatch = boto3.client('cloudwatch')

def handler(event, context):
    stream_name = event['Records'][0]['eventSourceARN'].split('/')[1]
    batch_failures = []

    for record in event['Records']:
        sequence_number = record['kinesis']['sequenceNumber']
        shard_id = record['eventID'].split(':')[0]

        # Emit iterator age as custom metric for latency SLO monitoring
        approximate_arrival = record['kinesis']['approximateArrivalTimestamp']
        iterator_age_ms = (time.time() - approximate_arrival) * 1000
        cloudwatch.put_metric_data(
            Namespace='MyApp/Kinesis',
            MetricData=[{
                'MetricName': 'ConsumerIteratorAge',
                'Value': iterator_age_ms,
                'Unit': 'Milliseconds',
                'Dimensions': [
                    {'Name': 'StreamName', 'Value': stream_name},
                    {'Name': 'ShardId', 'Value': shard_id},
                ],
            }],
        )

        try:
            payload = json.loads(record['kinesis']['data'])
            process_record(payload, sequence_number)
        except Exception as e:
            print(f"Failed record {sequence_number}: {e}")
            # BisectBatchOnFunctionError will split the batch and retry
            # But for idempotent handlers, also return the failing sequence number
            batch_failures.append({'itemIdentifier': record['kinesis']['sequenceNumber']})

    # Return failures — requires ReportBatchItemFailures on the ESM
    return {'batchItemFailures': batch_failures}

def process_record(payload: dict, sequence_number: str):
    # Idempotency check: DynamoDB conditional write using sequence_number as dedup key
    print(f"Processing seq={sequence_number}, orderId={payload.get('orderId')}")
```

**Resharding:**
- **Split**: divide one shard into two (increases capacity).
- **Merge**: combine two adjacent shards into one (reduces cost).
- No downtime during resharding.
- **Critical**: the parent shard must be fully exhausted (all records read) before records in child shards are processed. Lambda ESM handles this automatically; custom consumers must handle it explicitly.

```python
# Python — Kinesis producer with high-cardinality partition key
import boto3
import json
import uuid

kinesis = boto3.client('kinesis', region_name='us-east-1')

def publish_event(stream_name: str, customer_id: str, event: dict):
    response = kinesis.put_record(
        StreamName=stream_name,
        Data=json.dumps(event).encode('utf-8'),
        PartitionKey=customer_id  # high-cardinality: UUID per customer
    )
    return response['ShardId'], response['SequenceNumber']

# Bad: partition key = event type (only 5 values → hot shards guaranteed)
# kinesis.put_record(..., PartitionKey="order.placed")

# Good: partition key = customer ID (millions of values → even distribution)
publish_event('orders-stream', str(uuid.uuid4()), {"orderId": "abc", "total": 99})
```

### Kinesis Data Firehose (Amazon Data Firehose)

Firehose is **fully managed delivery** — no shard management, no consumer code, fire-and-forget.

**Destinations:** S3, Redshift (via S3 COPY), OpenSearch, Splunk, HTTP endpoints (custom), Apache Iceberg tables on S3.

**Buffering:** records are buffered before delivery. Firehose flushes when either condition is met first:
- Buffer size: 1–128 MB
- Buffer interval: 60–900 seconds

For near-real-time search ingestion, use 60s/1MB. For cost-optimized batch loads, use 300s/64MB.

**Data transformation:** attach a Lambda function. It receives batches, transforms each record (JSON → enriched JSON, PII masking, field extraction), and returns transformed records. Failed records go to an S3 error bucket.

**Format conversion (without Lambda):** Firehose can convert JSON → Parquet or JSON → ORC using a Glue Data Catalog schema. This is the cheapest way to get columnar format in S3 for Athena queries — no custom ETL.

**Dynamic partitioning:** partition S3 output by values extracted from the record itself:
```
s3://my-bucket/data/tenantId=!{partitionKeyFromQuery:tenantId}/year=!{timestamp:yyyy}/month=!{timestamp:MM}/
```
Records with different `tenantId` values land in different S3 prefixes automatically — multi-tenant analytics without preprocessing.

### Kinesis vs SQS — Decision Guide

| Dimension | Kinesis Data Streams | SQS Standard |
|---|---|---|
| Ordering | Per shard (by partition key) | Best-effort |
| Consumer count | Multiple independent consumers, same data | Competing consumers (each message to one) |
| Replay | Yes — re-read from any offset, up to 365d | No — once consumed and deleted, gone |
| Throughput | Shard-based (1 MB/s write per shard) | Virtually unlimited |
| Latency | ~200ms (standard), ~70ms (EFO) | Near-real-time for long polling |
| Message routing | None (partition key → shard only) | DLQ, visibility timeout, redrive |
| Max message size | 1 MB | 256 KB (or S3 via Extended Client) |
| Pricing model | Per shard-hour + PUT payload | Per API request |
| Management | Shard count, resharding | Mostly serverless |

**Choose Kinesis when:**
- Multiple independent services need to consume the same events (analytics + ML pipeline + audit log all reading the same stream)
- Ordered replay is required (event sourcing, audit trails)
- Throughput exceeds ~10,000 messages/second sustained
- Real-time analytics on the stream itself (Flink via Kinesis Analytics)

**Choose SQS when:**
- Work queue pattern — each job processed by exactly one worker
- Variable, unpredictable load (SQS scales to zero cost, Kinesis charges per shard-hour)
- You need DLQ + redrive for poison-pill handling
- Fan-out to different services (combine with SNS)

### Amazon MSK — Managed Kafka

MSK runs Apache Kafka on managed EC2 brokers. Same API as open-source Kafka 2.8+.

**MSK vs Kinesis:**

| Feature | MSK | Kinesis |
|---|---|---|
| API | Apache Kafka (standard clients) | AWS SDK (proprietary) |
| Consumer groups | Native Kafka consumer groups + offset commit | Application-managed or Lambda ESM |
| Topic compaction | Yes (log compaction) | No |
| Exactly-once semantics | Yes (Kafka transactions) | No (at-least-once) |
| Connector ecosystem | Kafka Connect (Debezium, S3 Sink, etc.) | Limited (Firehose only) |
| Existing Kafka code | Drop-in replacement | Full rewrite needed |
| Operational overhead | Medium (broker config, partition management) | Low (shard-based) |

**MSK Serverless:** auto-scales capacity, no broker sizing decisions, pay per throughput. Best for variable workloads and teams that want Kafka semantics without broker management.

**MSK Connect:** run Kafka Connect connectors fully managed — Debezium for CDC (change data capture from PostgreSQL/MySQL/[DynamoDB](/dynamodb-data-services) Streams), S3 Sink Connector for data lake ingestion, OpenSearch Sink for search indexing.

**When to choose MSK over Kinesis:**
- You have existing Kafka client code (producers/consumers) — zero migration cost.
- You need Kafka-specific features: log compaction, exactly-once transactions, consumer group offset management.
- You're running Debezium CDC from a relational database.
- Your team has Kafka expertise and prefers open-source tooling.

---

## 5. Orchestration vs Choreography

Two fundamental patterns for coordinating microservices:

### Choreography (EventBridge / SNS)

Services react to events independently. No central coordinator.

```
Order Service publishes "order.placed"
    ├── Payment Service subscribes → charges card → publishes "payment.completed"
    ├── Inventory Service subscribes → reserves items → publishes "inventory.reserved"
    └── Notification Service subscribes → sends confirmation email

(No service knows about the others — only the events)
```

**Pros:** Maximum loose coupling. Adding a new subscriber doesn't change any existing service. Natural fit for [AWS Architecture](/aws-architecture) event-driven patterns.
**Cons:** Hard to trace a single order across all services. No single view of workflow state. Compensating transactions (saga pattern) are complex to implement and debug.

### Orchestration (Step Functions)

A central workflow definition coordinates all steps. The orchestrator calls each service and handles results.

```
Step Functions Workflow: "Process Order"
    1. InvokePaymentService → wait for result
    2. If payment fails → InvokeRefundCompensation → END (failure)
    3. InvokeInventoryService → wait for result
    4. If inventory unavailable → InvokeWaitlistService
    5. InvokeFulfillmentService
    6. InvokeNotificationService
    7. END (success)
```

**Pros:** Full visibility in Step Functions console — see exactly where each order is. Built-in retry/backoff/timeout per step. Error handling and compensation logic are explicit. Human approval steps possible (waitForTaskToken pattern).
**Cons:** The orchestrator becomes a dependency. Changes to the workflow require deploying the orchestrator. More upfront design work.

### Decision Guide

| Situation | Pattern |
|---|---|
| New subscribers added frequently without changing producers | Choreography |
| Complex multi-step flow with error handling + compensation | Orchestration |
| Need audit trail of every step's state | Orchestration |
| Simple fanout (notify N services of one event) | Choreography |
| Human approval or long-running waits (days/weeks) | Orchestration |
| Cross-team boundaries where services are truly independent | Choreography |

**Step Functions preview:** For the full deep-dive on Step Functions, see the `/aws-step-functions` article. Key concepts: Standard Workflows (durable, up to 1 year, exactly-once), Express Workflows (high-volume, at-least-once, up to 5 min), direct SDK integrations (call DynamoDB, SQS, SageMaker without Lambda glue), and the `.waitForTaskToken` pattern for async human-in-the-loop approval.

---

## 6. Patterns & Anti-Patterns

### Event-Driven Architecture Patterns

**Fan-out** — one event, many independent consumers:
```
SNS Topic
    ├── SQS Queue → Lambda (billing)
    ├── SQS Queue → Lambda (inventory)
    └── SQS Queue → Lambda (analytics)
```
Each consumer has its own queue. Consumer failure doesn't affect others. Each scales independently.

**Competing consumers** — one queue, many workers processing in parallel:
```
SQS Queue ────→ Lambda (instance 1)
           ├──→ Lambda (instance 2)
           └──→ Lambda (instance 3)
```
Each message goes to exactly one Lambda instance. Lambda auto-scales the consumer count. Set reserved concurrency to cap how many concurrent workers hit your downstream database.

**Inbox pattern** — durable event persistence before processing:
```
EventBridge → Lambda → Write to DynamoDB (inbox table) → Return 200
                             ↓ (separate async process)
                       Read from inbox → Process → Mark processed
```
Prevents message loss if processing fails mid-flight. The message is safe in DynamoDB before any processing begins. The processor is idempotent — it checks if the event was already processed (deduplication key in DynamoDB).

**Outbox pattern** — consistent event publishing from a database transaction:
```
Order Service writes:
    ├── orders table: { id: "abc", status: "confirmed" }
    └── outbox table: { id: "evt-1", payload: "order.confirmed", published: false }
(single DB transaction — both writes or neither)

CDC process ([DynamoDB Streams](/dynamodb-data-services) or Debezium):
    └── Reads outbox table INSERT → publishes to EventBridge/SNS → marks published: true
```
Solves the dual-write problem: without outbox, you could write to DB but fail to publish the event (or vice versa). With outbox, the event is part of the same transaction as the data change — consistency is guaranteed.

**CQRS with events** — separate read and write models:
```
Command: "Place Order" → Write Model (DynamoDB) → Domain Event → EventBridge
                                                                       ↓
                                                              Read Model updater
                                                                       ↓
                                                              Read Model (Elasticsearch/Redis)

Query: "Get Order Status" → Read Model (fast, denormalized)
```

### Common Mistakes

- **SQS visibility timeout shorter than Lambda timeout** → Lambda takes 6 minutes, visibility timeout is 30 seconds → message reappears → another Lambda picks it up → duplicate processing. Fix: set visibility timeout to at least 6× Lambda timeout.
- **Not returning `batchItemFailures`** → one bad message in a batch of 100 fails all 100 → exponential retry storm. Fix: always implement partial batch failure response.
- **Hot partition key in Kinesis** → using event type as partition key (5 distinct values for 10 shards) → all writes to 2 shards → 1 MB/s cap per shard hit instantly. Fix: use high-cardinality keys (customer UUID).
- **SQS FIFO for high-throughput** → 3,000 TPS max with batching. If you need > 3,000 TPS with ordering, use Kinesis with a high-cardinality partition key.
- **SNS without filter policies** → all consumers receive all messages, pay for all Lambda invocations, waste CPU filtering → cost and performance problem at scale. Fix: add filter policies on each subscription.
- **No DLQ configured** → failed messages retry up to `maxReceiveCount` then disappear silently. Fix: always configure a DLQ and alarm on `ApproximateNumberOfMessages` > 0 on the DLQ.
- **Publishing directly to SNS from inside a DB transaction** → if the SNS publish succeeds but the DB transaction rolls back, you've published an event for something that didn't happen. Fix: use the outbox pattern.

---

## Red Flags to Avoid

- Synchronous HTTP calls between microservices for non-latency-critical paths — use SQS/EventBridge instead
- One SQS queue shared by services with different processing requirements — each consumer should have its own queue
- Infinite retry without DLQ — broken consumers spin forever on poison-pill messages
- Lambda timeout longer than visibility timeout — guaranteed duplicate processing
- Standard SQS queue for a workflow that requires strict ordering — use FIFO or Kinesis
- Not handling idempotency in consumers — at-least-once delivery means you will get duplicates; your handler must be idempotent (check if already processed before acting)
- Kinesis with no monitoring on iterator age — you won't know you're falling behind until hours later
- Cross-account event routing without explicit resource policies — EventBridge/SNS cross-account requires [IAM & Security](/aws-iam-security) resource policies on the target bus/topic
- Ignoring Kinesis shard-hour cost for bursty workloads — 10 shards × 24hr = 240 shard-hours/day at $0.015 each even at zero traffic; SQS charges nothing for idle queues

---

**Q: What's the difference between SQS and SNS? When do you use each?**
A: SQS is pull-based: a consumer polls for messages, each message is delivered to one consumer, and messages are retained until deleted (up to 14 days). SNS is push-based: the broker delivers a message to all subscribers immediately (fan-out), messages are not retained. Use SQS for work queues where a single worker should process each job. Use SNS when you need to notify multiple independent consumers of the same event simultaneously. They're often combined: SNS for fan-out delivery → multiple SQS queues for independent processing.

**Q: How do you ensure exactly-once processing with SQS?**
A: SQS Standard guarantees at-least-once delivery — duplicates are possible. SQS FIFO provides exactly-once delivery using a 5-minute deduplication window (content-based hash or explicit DeduplicationId). However, for true exactly-once processing semantics, your consumer must also be idempotent — check a DynamoDB table for the message ID before processing, and write a processed record atomically with the business action. FIFO prevents duplicate delivery, but network retries from the producer can still cause duplicates if you're not using a consistent DeduplicationId.

**Q: Explain the SQS visibility timeout and what happens when it expires.**
A: When a consumer receives a message, SQS makes it invisible to other consumers for the visibility timeout duration (default 30s, max 12hr). This prevents two consumers from processing the same message. If the consumer successfully processes the message and calls DeleteMessage, the message is permanently deleted. If the consumer fails (crashes, times out, throws an exception) and doesn't call DeleteMessage, the visibility timeout expires and the message reappears in the queue — available for any consumer to pick up again. After `maxReceiveCount` reappearances, the message moves to the DLQ. The critical mistake: setting visibility timeout shorter than your processing time → the message reappears while you're still working on it.

**Q: When would you choose Kinesis over SQS? What are the trade-offs?**
A: Choose Kinesis when you need (1) ordered replay — re-read historical data from any point, (2) multiple independent consumers reading the same records (analytics service + ML pipeline + audit log all consuming the same stream simultaneously — SQS would require SNS fan-out with separate queues and triplicated data), or (3) sustained high throughput (>10K events/second). Trade-offs: Kinesis costs per shard-hour even at zero load (SQS costs nothing idle); shard management requires capacity planning; max record size is 1 MB (vs 256 KB for SQS but with S3 extension). For variable workloads and work-queue patterns, SQS wins on simplicity and cost.

**Q: How do you handle a poison-pill message in SQS that causes your Lambda to always fail?**
A: Three-layer defense: (1) Implement partial batch failure — return `batchItemFailures` so only the failing message retries, not the whole batch. (2) Configure a DLQ with `maxReceiveCount = 3` — after 3 failures, the message moves to the DLQ automatically. (3) Set a CloudWatch alarm on `ApproximateNumberOfMessages` on the DLQ > 0. Once in the DLQ, investigate the message body (log it, send to S3 for analysis), fix the processing bug, then use DLQ Redrive to replay messages back to the source queue. Never set `maxReceiveCount` to 1 — some failures are transient (downstream timeout); you want a few retries before declaring a message poison.

**Q: Design an event-driven order processing system that handles payment, inventory, and fulfillment.**
A: Depends on consistency requirements. For high-consistency: Step Functions orchestration — "Process Order" workflow calls Payment, then Inventory, with explicit compensation steps if either fails. This gives full visibility and deterministic error handling. For high-throughput/loose-coupling: saga with choreography — Order Service publishes "order.placed" to EventBridge; Payment Service subscribes, charges card, publishes "payment.completed" or "payment.failed"; Inventory Service subscribes to "payment.completed", reserves stock, publishes "inventory.reserved"; Fulfillment subscribes and ships. Each service has its own SQS queue (via SNS fan-out) for buffering. Use the outbox pattern in each service to ensure DB writes and event publishes are atomic. Add a Saga Coordinator Lambda that subscribes to failure events and triggers compensating transactions (refunds, stock release).

**Q: What's the difference between EventBridge and SNS for event routing?**
A: SNS is simpler and faster — publish to a topic, subscribers get the message with basic attribute-based filtering. EventBridge is more powerful — richer content-based filtering (match on any nested JSON field, numeric ranges, prefix/suffix, wildcard), 20+ target types, cross-account/cross-region routing, Schema Registry for type safety, built-in archive and replay, and partner event sources. SNS is better for simple fan-out where you control both publisher and subscribers. EventBridge is better for complex routing rules, cross-account event buses, third-party SaaS integration, and when you need schema discovery and code bindings. For [observability](/aws-observability), EventBridge integrates directly with CloudWatch and has native archive/replay for debugging production incidents.

**Q: How does EventBridge Pipes simplify event-driven architectures?**
A: Pipes replace the common pattern of writing a "glue" Lambda that (1) consumes from a source like DynamoDB Streams or Kinesis, (2) filters records, (3) calls an enrichment API, and (4) publishes to a target like SQS or SNS. Without Pipes, that's hundreds of lines of Lambda code for something that's fundamentally infrastructure configuration. Pipes make the filter and enrichment steps declarative — you define them in a JSON config, and AWS manages the polling, retry, and delivery. This reduces the number of Lambdas you maintain, eliminates custom error handling for the transport layer, and makes the data flow visible in the AWS console rather than buried in code.

**Q: Explain fan-out vs competing consumers patterns.**
A: Fan-out: one message → many consumers, each gets a copy. Implemented with SNS → multiple SQS queues. Use case: "order placed" event must be processed by billing, inventory, and analytics independently. Each consumer is isolated — billing failure doesn't affect inventory. Competing consumers: one queue → many workers, each message goes to exactly one worker. Implemented with SQS + multiple Lambda instances (or ECS tasks). Use case: 10,000 image resize jobs in a queue — scale to 100 Lambda instances to process them in parallel, each image processed once. These patterns are often combined: SNS fan-out to three SQS queues, each queue processed by competing consumers (multiple Lambda instances per queue for throughput).

**Q: How do you debug a Kinesis-Lambda pipeline that's falling behind?**
A: First, check `GetRecords.IteratorAgeMilliseconds` — this metric shows the age of the oldest record being processed. If it's growing, you're producing faster than consuming. Diagnosis path: (1) Check Lambda concurrency — are you hitting the concurrency limit? If so, request a limit increase or increase `ParallelizationFactor` on the event source mapping (up to 10x per shard). (2) Check Lambda duration — if functions take 30s each and you're polling every second, you'll fall behind. Optimize the handler or add shards. (3) Check shard count — if write throughput exceeds `shards × 1 MB/s`, you need to split shards. (4) Check for errors — Lambda `BisectBatchOnFunctionError` might be splitting batches repeatedly on a poison-pill record. Check the DLQ. (5) Check EFO — if you have >2 consumers sharing the 2 MB/s read limit per shard, enable Enhanced Fan-Out for each consumer to get dedicated throughput. Monitor [Observability](/aws-observability) dashboards with iterator age as the primary SLO metric for Kinesis pipelines.

**Q: What's the outbox pattern and why is it important for distributed systems?**
A: The outbox pattern solves the dual-write problem: in a distributed system, you can't atomically write to a database and publish an event to a message broker (they're separate systems). Without outbox, you might write to the DB successfully but fail to publish the event (event lost), or publish the event but fail the DB write (phantom event). With outbox: write your business data and the event payload to the same database in a single transaction (both succeed or both fail). A separate CDC process ([DynamoDB Streams](/dynamodb-data-services), Debezium for PostgreSQL/MySQL) reads the outbox table and publishes events to the broker. The CDC process is idempotent — if it crashes, it re-reads from the last checkpoint. This guarantees that every committed DB write eventually produces exactly one event, with no losses and no phantoms. It's the foundation of reliable event-driven microservices. Cost: one extra table per service and a CDC process (which DynamoDB Streams + Lambda provides cheaply on AWS).

---

## Cross-References

- [Lambda](/aws-lambda-serverless) — Lambda Event Source Mapping for SQS, Kinesis, DynamoDB Streams; concurrency and partial batch failure
- [DynamoDB](/dynamodb-data-services) — DynamoDB Streams as Kinesis/EventBridge Pipes source; outbox pattern implementation
- [AWS Architecture](/aws-architecture) — event-driven architecture patterns, saga pattern, CQRS
- [Step Functions](/aws-step-functions) — orchestration vs choreography; Standard and Express Workflows; waitForTaskToken
- [IAM & Security](/aws-iam-security) — SQS/SNS resource policies for cross-account access; EventBridge cross-account bus permissions
- [Observability](/aws-observability) — SQS DLQ alarms, Kinesis iterator age monitoring, EventBridge rule invocation metrics
- [Cost Optimization](/aws-cost-optimization) — Kinesis shard-hour vs SQS per-request cost models; Firehose buffering for S3 cost
- [AI/ML Services](/aws-ai-ml-services) — Kinesis Data Streams as real-time inference pipeline input; Firehose for ML training data collection
