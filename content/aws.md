# Amazon Web Services

## The 30-Second Pitch
AWS is the market-leading cloud platform from Amazon — 200+ services spanning IaaS, PaaS, and SaaS, deployed across **33 geographic regions**, **105 Availability Zones**, and **600+ Points of Presence** worldwide. It solves the fundamental problem of capital expenditure and operational overhead for computing resources through on-demand, pay-as-you-go pricing. A team picks AWS for its unmatched breadth (no other cloud offers as many services), its mature ecosystem, its leadership in AI/ML (Bedrock, SageMaker), and the powerful serverless and event-driven primitives that enable rapid innovation without managing hardware. This hub links to **19 deep-dive articles** covering every major domain — use them to go from orientation to expert depth on any topic.

---

## Deep-Dive Knowledge Base

### Foundation & Security
- [IAM & Security](/aws-iam-security) — IAM principals, policy evaluation, STS, AssumeRole, permission boundaries, SCPs
- [VPC & Networking](/aws-vpc-networking) — VPC, subnets, security groups, NACLs, NAT Gateway, Transit Gateway, Direct Connect
- [Security Services](/aws-security-services) — WAF, Shield, Macie, Inspector v2, Network Firewall, Security Hub, centralized findings

### Compute
- [Lambda & Serverless](/aws-lambda-serverless) — Firecracker microVMs, cold starts, event sources, Lambda extensions, Powertools for AWS
- [Compute & Containers](/aws-compute-containers) — EC2, ECS, EKS, Fargate, App Runner, Graviton processors, Auto Scaling

### Storage & Data
- [Storage & S3](/aws-storage-s3) — S3 storage classes, lifecycle policies, Object Lambda, EBS, EFS, FSx families
- [DynamoDB & Data Services](/dynamodb-data-services) — Single-table design, GSI/LSI, DynamoDB Streams, DAX, Global Tables, on-demand capacity
- [Databases: RDS & Aurora](/aws-databases-rds) — RDS engines, Aurora architecture, Aurora Serverless v2, ElastiCache, RDS Proxy
- [Data Analytics](/aws-data-analytics) — Athena, Redshift, Glue, Lake Formation, EMR, OpenSearch, Kinesis analytics

### Integration & Messaging
- [Messaging & Events](/aws-messaging-events) — SQS, SNS, EventBridge, Kinesis, MSK, fan-out patterns, DLQ handling
- [Step Functions](/aws-step-functions) — Amazon States Language, Standard vs Express, SDK integrations, Saga pattern
- [API Gateway & Networking](/aws-api-gateway-networking) — REST/HTTP/WebSocket APIs, authorizers, throttling, VPC Link, usage plans

### Delivery & Operations
- [CloudFront & Route 53](/aws-cloudfront-route53) — CDN, edge computing, Lambda@Edge, CloudFront Functions, DNS routing policies
- [CI/CD & DevOps](/aws-cicd-devops) — CodePipeline, CodeBuild, CodeDeploy, CDK Pipelines, OIDC trust with GitHub Actions
- [Developer Tools](/aws-developer-tools) — CDK advanced patterns, SAM, Projen, AppConfig feature flags, CodeCatalyst

### AI/ML & Observability
- [AI/ML Services](/aws-ai-ml-services) — Bedrock, SageMaker, Bedrock Agents, Knowledge Bases, Rekognition, Textract
- [Observability](/aws-observability) — CloudWatch Metrics/Logs/Alarms, X-Ray, CloudTrail, Config, correlation IDs, dashboards

### Architecture & Cost
- [Architecture Patterns](/aws-architecture) — Well-Architected Framework, all 6 pillars, multi-region strategies, disaster recovery tiers
- [Cost Optimization](/aws-cost-optimization) — Savings Plans, Spot Instances, Graviton price/perf, right-sizing, FinOps tagging strategy

---

## How It Actually Works

The core mental model is **global infrastructure composed of Regions, Availability Zones, and edge locations**. A Region is a geographic area (e.g., `us-east-1`). Each Region contains multiple physically isolated AZs — separate data centers with independent power, cooling, and networking, connected by low-latency fiber. Edge locations (600+) serve CloudFront CDN and Route 53 DNS globally.

**Infrastructure numbers worth knowing:**
- 33 Regions (with more announced)
- 105 Availability Zones
- 600+ Points of Presence (CloudFront edge + regional caches)
- 200+ distinct services

**Key layers:**

1. **Compute:** EC2 (virtual machines), Lambda (serverless, Firecracker microVMs), ECS/EKS (containers)
2. **Storage:** S3 (object, 11-nines durability), EBS (block, for EC2), EFS (shared NFS)
3. **Database:** RDS (managed relational), DynamoDB (managed NoSQL), Aurora (high-performance cloud-native)
4. **Networking:** VPC (private virtual network), CloudFront (CDN), Route 53 (DNS), API Gateway
5. **AI/ML:** Bedrock (foundation model API), SageMaker (end-to-end ML platform), 12+ purpose-built AI services

**Control Plane vs Data Plane:**

```
[User / App / CI]
        |
        | API call (HTTPS + SigV4 signing)
        v
[AWS Global Endpoint / Control Plane]
        |
        v
[Authentication & Authorization (IAM)]
     |          |
     | Allow    | Explicit Deny → rejected immediately
     v
[Command dispatched to Data Plane — specific Region]
        |
        v
[Resource: EC2 instance / S3 object / Lambda invocation]
```

The **control plane** handles API calls (management operations): creating/deleting/configuring resources. The **data plane** handles the actual work: serving requests to your EC2 instances, returning S3 objects, executing Lambda functions. AWS designs data planes for higher availability than control planes — your running workloads survive brief control plane disruptions.

**IAM — the authorization fabric:**
Every API call has a **principal** (who) calling an **action** (what) on a **resource** (which ARN). IAM evaluates policies in order: explicit Deny wins, then SCPs, then resource-based policies, then identity-based policies. The result is either Allow or an implicit Deny. See [IAM & Security](/aws-iam-security) for the full evaluation logic.

**Event-Driven Architecture:**
Many services emit events natively — S3 object created, DynamoDB record changed, SQS message received. EventBridge routes these to targets (Lambda, Step Functions, SQS, HTTP endpoints) using rules. This loose coupling is the dominant pattern for scalable, cost-efficient architectures on AWS.

---

## AWS Service Catalog

Quick reference for interviews and architecture decisions. Deep-dive articles linked from each section above.

### Compute

| Service | Description | Key Use Case |
|---|---|---|
| EC2 | Virtual machines, 700+ instance types | OS-level control, ML inference, legacy lift-and-shift |
| Lambda | Serverless functions up to 15 min, 10 GB memory | Event-driven APIs, glue code, async processing |
| ECS | AWS-native container orchestration | Docker microservices, simpler Kubernetes alternative |
| EKS | Managed Kubernetes control plane | Teams already on K8s, multi-cloud portability |
| Fargate | Serverless container runtime for ECS/EKS | No EC2 node management; pay-per-task |
| App Runner | Container → URL in minutes | Simplest container hosting, no infra knowledge needed |
| AWS Batch | Managed batch job queues | ML training jobs, simulations, large-scale ETL |
| Lightsail | Simplified VMs with fixed pricing | Simple web apps, dev/test, low traffic sites |

### Storage

| Service | Description | Key Use Case |
|---|---|---|
| S3 | Object storage, 11-nines durability, unlimited scale | Data lakes, static assets, backups, ML training data |
| EBS | Block storage volumes attached to EC2 | Database storage, OS volumes (gp3 default) |
| EFS | Managed NFS file system, auto-scaling | Shared storage across multiple EC2 or containers |
| FSx for Lustre | High-performance parallel file system | ML training, HPC, needs POSIX + high throughput |
| FSx for Windows | Managed Windows File Server | Windows workloads, SMB protocol, Active Directory |
| S3 Glacier | Archive tiers (Instant/Flexible/Deep Archive) | Long-term compliance, infrequently accessed data |

### Database

| Service | Description | Key Use Case |
|---|---|---|
| RDS | Managed relational: MySQL, PostgreSQL, MariaDB, Oracle, SQL Server | Traditional RDBMS with managed patching/backups |
| Aurora | Cloud-native relational, storage auto-scales to 128 TB | High-performance MySQL/PostgreSQL, 5× throughput |
| Aurora Serverless v2 | Fine-grained ACU auto-scaling | Variable or unpredictable relational workloads |
| DynamoDB | Managed NoSQL, single-digit ms at any scale | Key-value, document, high-throughput microservices |
| ElastiCache | Managed Redis or Memcached | Session store, rate limiting, DB query cache |
| Redshift | Columnar data warehouse, Redshift Serverless option | Analytics, BI, large-scale SQL on structured data |
| Neptune | Managed graph database (Gremlin, SPARQL, openCypher) | Social graphs, fraud detection, knowledge graphs |
| DocumentDB | MongoDB-compatible document database | Document workloads, MongoDB migration |
| Timestream | Time-series database | IoT telemetry, metrics, DevOps time-series data |

### Networking

| Service | Description | Key Use Case |
|---|---|---|
| VPC | Logically isolated virtual network with CIDR control | Foundation for all AWS workloads |
| CloudFront | Global CDN + edge computing | Static asset delivery, API acceleration, DDoS mitigation |
| Route 53 | DNS with health checks + 7 routing policies | Domain management, latency routing, failover |
| API Gateway | Managed REST/HTTP/WebSocket API frontend | API proxy for Lambda, ECS, HTTP integrations |
| ALB | Application (L7) load balancer, content-based routing | HTTP/HTTPS routing, microservices, ECS/EKS |
| NLB | Network (L4) load balancer, static IPs, ultra-low latency | TCP/UDP, PrivateLink endpoints, consistent IP |
| Transit Gateway | Hub-and-spoke network hub | Multi-VPC connectivity + hybrid cloud networking |
| Direct Connect | Dedicated private line to AWS (1G / 10G / 100G) | Consistent bandwidth, compliance, hybrid workloads |

### AI / ML

| Service | Description | Key Use Case |
|---|---|---|
| Bedrock | Foundation model API: Claude, Llama, Titan, Mistral, Stable Diffusion | GenAI apps without managing model infrastructure |
| SageMaker | End-to-end ML platform: notebooks, training, inference, pipelines | Full MLOps lifecycle, custom model training |
| Bedrock Agents | Agentic workflows with tool use + memory | AI agents that call APIs and retrieve knowledge |
| Bedrock Knowledge Bases | Managed RAG with S3 + vector store | Serverless RAG, no embedding pipeline to maintain |
| Rekognition | Computer vision: faces, objects, text, moderation | Image/video analysis, content moderation |
| Textract | Document extraction: forms, tables, signatures (beyond OCR) | Form processing, mortgage docs, medical records |
| Comprehend | NLP: entities, sentiment, key phrases, custom classifiers | Text analytics pipelines, customer feedback |
| Transcribe | Speech-to-text with speaker diarization | Voice apps, call center transcription, captioning |
| Polly | Text-to-speech, 60+ voices, SSML support | Voice interfaces, e-learning narration |
| Translate | Neural machine translation, 75+ languages | Multilingual apps, real-time chat translation |
| Forecast | Time-series forecasting (AutoML) | Demand forecasting, inventory planning |
| Personalize | Recommendation engine (same algorithms as Amazon.com) | E-commerce, content streaming recommendations |

### DevOps & Management

| Service | Description | Key Use Case |
|---|---|---|
| CloudFormation | AWS-native IaC, stateful stacks, changesets | Stack-based provisioning, drift detection |
| CDK | Code-first IaC (TypeScript, Python, Go, Java) | Developer-friendly IaC that compiles to CloudFormation |
| Systems Manager | Operational management: Run Command, Patch Manager, Session Manager | Patch automation, no-SSH access, config management |
| Secrets Manager | Secret storage with automatic rotation | DB passwords, API keys, OAuth tokens |
| Parameter Store | Config and secret storage, free tier | Non-rotating config, feature flags, env vars |
| CloudWatch | Metrics, logs, alarms, dashboards, Synthetics | Unified observability across all AWS services |
| X-Ray | Distributed tracing with service map | Microservice latency debugging, bottleneck detection |
| CloudTrail | API audit trail for all management events | Compliance, forensics, security investigation |
| Config | Resource inventory + compliance rules + remediation | Drift detection, CIS benchmark enforcement |
| Trusted Advisor | Best practice checks across 5 categories | Cost savings, security gaps, service limit warnings |

### Integration & Messaging

| Service | Description | Key Use Case |
|---|---|---|
| SQS | Managed queues (Standard + FIFO), DLQ support | Decoupling, work queues, async task offload |
| SNS | Pub/sub: push to SQS, Lambda, email, SMS, HTTP | Fan-out notifications, multi-consumer event broadcast |
| EventBridge | Serverless event bus with content-based routing rules | Event-driven microservices, SaaS integration (100+ sources) |
| Kinesis Data Streams | Real-time streaming, up to 365-day retention | Clickstream, log aggregation, IoT, replay capability |
| Kinesis Firehose | Streaming delivery to S3/Redshift/OpenSearch (near real-time) | Zero-code ingestion pipeline, automatic batching |
| MSK | Managed Apache Kafka, full Kafka API compatibility | Teams with existing Kafka workloads and tooling |
| Step Functions | Visual workflow orchestration (ASL state machine) | Multi-step processes, Saga pattern, human approval steps |

### Security

| Service | Description | Key Use Case |
|---|---|---|
| IAM | Identity and access management, policy evaluation | Every AWS API call authorization decision |
| IAM Identity Center | SSO + multi-account access management (successor to SSO) | Human access to many AWS accounts via one login |
| KMS | Managed encryption keys (AES-256, RSA, ECC) | Envelope encryption for S3, EBS, RDS, Secrets Manager |
| ACM | SSL/TLS certificate provisioning and auto-renewal | HTTPS for ALB, CloudFront, API Gateway |
| WAF | Web Application Firewall, managed rule groups | OWASP Top 10 protection, rate limiting, bot control |
| Shield | DDoS protection (Standard: free; Advanced: $3k/mo) | Layer 3/4 volumetric + Layer 7 application DDoS |
| GuardDuty | ML-based threat detection across CloudTrail/DNS/VPC flow logs | Unusual API patterns, credential exfiltration, crypto mining |
| Macie | S3 sensitive data discovery with ML classifiers | PII detection, credential leaks, compliance scanning |
| Inspector | Automated vulnerability scanning for EC2/ECR/Lambda | CVE detection, reachability analysis, SBOM |
| Security Hub | Centralized security findings, ASFF normalization | Multi-account security posture, compliance dashboard |

---

## Patterns You Should Know

### 1. Serverless API Backend with AI Integration

API Gateway handles HTTP requests, Lambda runs business logic, Bedrock provides the foundation model. Uses the current Messages API format.

```javascript
// Lambda (Node.js) — Bedrock Messages API (Claude 3+)
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

const client = new BedrockRuntimeClient({ region: 'us-east-1' });

export const handler = async (event) => {
    const { prompt } = JSON.parse(event.body);

    const payload = {
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
    };

    const command = new InvokeModelCommand({
        modelId: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify(payload),
    });

    const response = await client.send(command);
    const result = JSON.parse(Buffer.from(response.body).toString());

    return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: result.content[0].text }),
    };
};
```

### 2. Event-Driven Data Processing Pipeline

S3 upload triggers Lambda via EventBridge (or direct S3 notification), processes the file, stores results in DynamoDB. Classic RAG ingestion pattern.

```yaml
# SAM template — S3 → Lambda → DynamoDB
Resources:
  DocumentProcessorFunction:
    Type: AWS::Serverless::Function
    Properties:
      CodeUri: src/
      Handler: processor.handler
      Runtime: nodejs22.x
      Timeout: 300
      MemorySize: 1024
      Policies:
        - S3ReadPolicy:
            BucketName: !Ref SourceBucket
        - DynamoDBCrudPolicy:
            TableName: !Ref MetadataTable
      Environment:
        Variables:
          METADATA_TABLE: !Ref MetadataTable
      Events:
        FileUpload:
          Type: S3
          Properties:
            Bucket: !Ref SourceBucket
            Events: s3:ObjectCreated:*
            Filter:
              S3Key:
                Rules:
                  - Name: suffix
                    Value: .pdf
```

```javascript
// processor.handler — extract, embed, store
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';

const s3 = new S3Client();
const ddb = new DynamoDBClient();

export const handler = async (event) => {
    for (const record of event.Records) {
        const bucket = record.s3.bucket.name;
        const key = decodeURIComponent(record.s3.object.key);

        // 1. Fetch document from S3
        const { Body } = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        const text = await Body.transformToString();

        // 2. Store processing metadata in DynamoDB
        await ddb.send(new PutItemCommand({
            TableName: process.env.METADATA_TABLE,
            Item: {
                documentId: { S: key },
                processedAt: { S: new Date().toISOString() },
                status: { S: 'processed' },
                sizeBytes: { N: String(record.s3.object.size) },
            },
        }));
    }
};
```

### 3. Containerized Microservice on ECS Fargate

Docker container deployed behind an ALB. ECS handles health checks, rolling deployments, and scaling. Secrets pulled from Secrets Manager at task startup.

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
EXPOSE 8080
USER node
CMD ["node", "server.js"]
```

```json
{
  "family": "ai-microservice",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "1024",
  "memory": "2048",
  "executionRoleArn": "arn:aws:iam::ACCOUNT:role/ecsTaskExecutionRole",
  "taskRoleArn": "arn:aws:iam::ACCOUNT:role/ecsTaskRole",
  "containerDefinitions": [{
    "name": "app",
    "image": "ACCOUNT.dkr.ecr.us-east-1.amazonaws.com/ai-service:latest",
    "portMappings": [{ "containerPort": 8080 }],
    "secrets": [
      { "name": "DB_PASSWORD", "valueFrom": "arn:aws:secretsmanager:us-east-1:ACCOUNT:secret:prod/db-password" }
    ],
    "logConfiguration": {
      "logDriver": "awslogs",
      "options": {
        "awslogs-group": "/ecs/ai-microservice",
        "awslogs-region": "us-east-1",
        "awslogs-stream-prefix": "ecs"
      }
    }
  }]
}
```

### 4. Multi-Cloud Strategy with AWS as Primary

AWS handles core AI/ML and scalable backend services. Other clouds used for specific integrations. Key patterns:

- **Identity federation:** IAM Identity Center with SAML 2.0 grants corporate identities access to AWS accounts without IAM users
- **Network connectivity:** AWS Direct Connect or Site-to-Site VPN for on-prem/hybrid; VPC peering or Transit Gateway for multi-account
- **IaC portability:** Terraform (or Pulumi) manages resources across AWS, Azure, and GCP from a single codebase
- **Cloud-native services:** Use managed Kubernetes (EKS/AKS/GKE) rather than cloud-proprietary orchestration to preserve portability
- **Strategy:** AWS for AI/ML leadership (SageMaker, Bedrock) and global infrastructure; Azure for Microsoft 365/AD integration; GCP for BigQuery analytics or Vertex AI models

### 5. Event-Driven Microservices with Dead-Letter Queue

Decoupled processing with guaranteed delivery semantics. The DLQ captures failed messages for later analysis or replay rather than silently dropping them.

```
API Gateway
     |
     v
Lambda (synchronous — validates, enqueues)
     |
     v
SQS Queue (VisibilityTimeout = 3× max processing time)
     |
     v
Lambda (async consumer — batchSize=10, bisectOnError=true)
     |          \
     v           v (on failure after maxReceiveCount)
DynamoDB      SQS DLQ → CloudWatch Alarm → SNS alert
```

Key configuration details:
- Set `FunctionResponseTypes: [ReportBatchItemFailures]` on the event source mapping so Lambda reports individual failed items — successfully processed messages are not retried
- Set `maxReceiveCount` on the source queue to 3–5 before sending to DLQ
- DLQ alarm: if `ApproximateNumberOfMessagesVisible > 0` for 5 minutes, page on-call
- For FIFO queues: message group ID controls ordering; DLQ must also be FIFO type

---

## Key Decision Frameworks

### Lambda vs Fargate vs EC2

| Criterion | Lambda | Fargate | EC2 |
|---|---|---|---|
| Max execution time | 15 minutes | Unlimited | Unlimited |
| Idle cost | $0 (scales to zero) | $0 (scales to zero) | Per-hour billing |
| Cold start latency | 200 ms – 10 s | 10 – 60 s | Minutes (or pre-warmed ASG) |
| State model | Stateless (ephemeral /tmp) | Container-level ephemeral storage | Full OS persistent storage |
| OS control | None | None | Full (AMI, kernel params) |
| Max memory | 10 GB | 120 GB | Instance-defined (up to TBs) |
| GPU support | No | Yes (p-family instances) | Yes (full GPU instance catalog) |
| Best for | Event-driven, <15 min, spiky traffic | Containerized APIs, long-running tasks | ML inference, OS control, steady-state high throughput |

**Heuristic:** Start with Lambda. Migrate to Fargate when you hit the 15-min limit or need more memory/CPU consistency. Migrate to EC2 when you need GPU, specific OS configuration, or the math says reserved instances are cheaper.

### SQS vs Kinesis vs EventBridge

| Criterion | SQS | Kinesis Data Streams | EventBridge |
|---|---|---|---|
| Message ordering | Best-effort (FIFO queue: strict) | Per-shard strict ordering | None |
| Replay / retention | DLQ only, max 14 days | Up to 365 days | No replay |
| Consumer model | Competing consumers (one message → one consumer) | Multiple independent consumers per shard | Many rules → many targets |
| Throughput | Unlimited (standard); 3,000 msg/s per API call (FIFO) | 1 MB/s write per shard | Unlimited (soft limits apply) |
| Latency | Near real-time (polling) | Real-time (<1s) | Near real-time |
| Pricing model | Per request | Per shard-hour + per GB | Per event |
| Best for | Work queues, task offload, decoupling services | Real-time analytics, log aggregation, data replay | Event routing, SaaS integration, cross-service choreography |

**Heuristic:** Use SQS for task queues between services. Use Kinesis when you need multiple consumers reading the same stream independently, or need replay. Use EventBridge as the event bus when routing events between many services or reacting to AWS/SaaS events.

### SQL vs NoSQL on AWS

| Criterion | Aurora / RDS | DynamoDB |
|---|---|---|
| Schema | Defined schema, migrations required | Schemaless (per-item attributes) |
| Query flexibility | Full SQL: joins, aggregations, ad-hoc | Primary key + GSI only; no joins |
| Consistency | Strong (ACID transactions) | Eventual (default) or strong read (extra cost) |
| Scaling | Vertical + read replicas (horizontal limited) | Horizontal, unlimited scale |
| Latency | Low ms (with connection pooling + RDS Proxy) | Single-digit ms at any scale |
| Cost at scale | Predictable instance cost | Per request (can get expensive at high read/write) |
| Best for | Complex queries, reporting, existing SQL workloads | Known access patterns, >100K RPS, key-value/session |

---

## What Interviewers Actually Ask

**Q: Explain how IAM works. How do you grant an EC2 instance permission to read from an S3 bucket?**
**A:** IAM is the authorization fabric for every AWS API call. Every call has a **principal** (who is calling), an **action** (e.g., `s3:GetObject`), and a **resource** (the bucket ARN). For an EC2 instance, you never use user credentials — instead, create an **IAM Role** with a policy granting `s3:GetObject` on the target bucket, and attach that role as the instance profile. The EC2 metadata service (`169.254.169.254`) vends temporary STS credentials to the instance automatically. The application uses the SDK which reads these credentials transparently.

**Q: When would you choose Aurora over DynamoDB, or vice versa?**
**A:** Choose **Aurora** when you need relational queries, joins, transactions (ACID), or complex reporting — essentially when you have a well-defined schema and multiple access patterns that benefit from SQL. Choose **DynamoDB** for massively scalable, predictably low-latency workloads with known, simple access patterns: key-value stores, session management, shopping carts, event sourcing. DynamoDB's trade-off is that you must design your access patterns upfront (single-table design). If you need ad-hoc querying over DynamoDB data, export to S3 and query with Athena.

**Q: You have a Lambda function timing out intermittently. Walk me through debugging.**
**A:** Structured approach: (1) **CloudWatch Logs** — filter for the specific request ID showing the timeout; look for the last logged line before timeout to identify where it hangs. (2) **Lambda metrics** — `Duration` p99 vs configured timeout, `Throttles`, `ConcurrentExecutions`. (3) **X-Ray trace** — find the specific slow segment; is it a downstream HTTP call, a database query, or CPU? (4) Check if the Lambda is inside a VPC and hitting a cold start ENI attachment delay. (5) Increase `MemorySize` — Lambda CPU is proportional to memory, so more memory means faster CPU-bound work. (6) Verify downstream dependencies: check RDS connection pool exhaustion (add RDS Proxy), check DynamoDB provisioned capacity vs consumed capacity.

**Q: Design a system to process thousands of PDFs, extract text, and make it queryable.**
**A:** Classic event-driven serverless RAG pipeline: (1) Users upload PDFs to S3. (2) S3 event triggers a Lambda or Step Functions workflow per file. (3) Lambda calls Textract for high-accuracy extraction (forms, tables, signatures — not just raw text). (4) Text is chunked (e.g., 512-token overlapping windows) and sent to Bedrock (Titan Embeddings or Cohere) to produce vectors. (5) Vectors + metadata stored in OpenSearch (k-NN index) or pgvector on Aurora. (6) Query API: API Gateway → Lambda → embed the query → ANN search → retrieve top-k chunks → send context + question to Bedrock (Claude) → return answer. For scale: use SQS between upload and processing to handle burst, Dead Letter Queue for failed documents, Step Functions for retry/branching logic.

**Q: When would you NOT use Lambda?**
**A:** Avoid Lambda for: (1) Processes running longer than 15 minutes (use Fargate or ECS). (2) Workloads requiring GPU (EC2 GPU instances). (3) Steady, predictable high throughput where a reserved EC2 or Fargate service is cheaper (e.g., >1M invocations/day of a heavy function). (4) Applications requiring a persistent in-memory cache (Lambda instances are recycled; use ElastiCache). (5) Tasks needing specific OS-level configuration, kernel modules, or direct hardware access. (6) WebSocket servers requiring persistent connections (use API Gateway WebSocket + connection store, or ECS).

**Q: How does AWS billing work? How do you control costs?**
**A:** AWS billing is **pay-per-use**: EC2 charges per second (after first minute), Lambda per 1ms of compute, S3 per GB stored + per request. Key levers for cost control: (1) **Compute savings** — Savings Plans (1 or 3 year commitment, up to 66% off) cover EC2, Lambda, and Fargate regardless of instance type; Spot Instances for fault-tolerant batch workloads (up to 90% off). (2) **Graviton** — ARM-based instances up to 40% cheaper than x86 for same workload. (3) **Right-sizing** — use Compute Optimizer recommendations; turn off dev environments overnight with Instance Scheduler. (4) **Storage tiering** — S3 Intelligent-Tiering, EBS gp3 vs io2 selection, lifecycle rules to Glacier. (5) **FinOps practices** — mandatory `project`, `env`, `team` tags on all resources; Cost Explorer anomaly detection alerts; per-team budget alarms via AWS Budgets. (6) **Architecture** — cache aggressively with ElastiCache/DAX to reduce DB calls; use SQS batching; prefer Lambda@Edge for simple transforms over full Lambda invocations.

**Q: Explain the shared responsibility model.**
**A:** AWS is responsible for **security of the cloud** — the physical infrastructure, data center facilities, network hardware, hypervisors, and the managed services themselves (e.g., the RDS database engine patching). The customer is responsible for **security in the cloud** — everything they put on top: IAM policies, encryption configuration, security group rules, patching the OS on EC2 instances, application-layer security, and data classification. The boundary shifts depending on the service: with Lambda you don't patch an OS (AWS responsibility), but with EC2 you do (your responsibility). This model means a misconfigured S3 bucket is always the customer's fault, not AWS's.

**Q: How would you architect a greenfield application? Walk me through your decision process.**
**A:** Framework: (1) **Traffic pattern** — spiky/event-driven → Lambda; steady/containerized → Fargate; ML inference → EC2 GPU or SageMaker. (2) **Data model** — relational with complex queries → Aurora; known key-value patterns, massive scale → DynamoDB; analytics → Redshift + Athena over S3. (3) **HA/DR** — Multi-AZ by default for all stateful resources; decide if you need multi-region (RTO/RPO requirements). (4) **Security baseline** — VPC with private subnets for all backend resources; Secrets Manager for credentials; CloudTrail + GuardDuty enabled from day one; WAF in front of public APIs. (5) **Observability** — structured JSON logs to CloudWatch with correlation IDs; X-Ray tracing; dashboards and alarms before go-live. (6) **IaC** — CDK or Terraform from day one; no manual console changes in production. (7) **Cost** — tag everything; enable Cost Explorer; set budget alarms.

**Q: How do you manage secrets in AWS?**
**A:** Never hardcode or commit secrets. Use **Secrets Manager** for anything that needs automatic rotation — it rotates RDS passwords natively and supports custom Lambda rotation for any other secret. Use **Parameter Store** (SecureString type, KMS-encrypted) for non-rotating config. In Lambda: reference secrets via SDK calls in the initialization code (outside the handler), cached for the lifetime of the execution environment. In ECS: reference via `secrets` in the task definition — the agent fetches and injects them as environment variables at task start. In EKS: use the Secrets Store CSI Driver to mount Secrets Manager values as files. Access to secrets is controlled via IAM — the role or task role must have `secretsmanager:GetSecretValue` permission on the specific ARN.

**Q: Explain AZ outage vs Region outage. How do you design for each?**
**A:** An **AZ outage** is a failure within one data center complex — occurs a few times per year in large regions. Design for it by distributing resources across a minimum of 2 (ideally 3) AZs: Multi-AZ RDS/Aurora, Auto Scaling Groups with `AZRebalance`, ALB/NLB across AZs, ECS task placement spread by AZ. A **Region outage** is a full geographic failure — extremely rare but catastrophic without preparation. Design with a DR strategy keyed to your RTO/RPO: pilot light (replicated data, minimal infra), warm standby (scaled-down live replica), or active-active (Route 53 with health checks routing traffic across two regions). Data replication: S3 Cross-Region Replication, DynamoDB Global Tables, Aurora Global Database (replication lag <1s). Runbooks for DNS failover should be tested quarterly.

---

## How It Connects to This Role's Stack

As a **Senior Full Stack AI Engineer** in a multi-cloud environment, AWS is the core platform for AI/ML workloads and scalable backend services.

- **LlamaIndex / RAG on AWS:** Data sources in S3, embedding models via Bedrock (Titan Embeddings) or SageMaker, vector storage in OpenSearch (k-NN) or Aurora pgvector, orchestration in Lambda + Step Functions. Bedrock Knowledge Bases can replace custom embedding pipelines entirely for standard RAG use cases.
- **Node.js on AWS:** Lambda supports Node.js 22.x natively. Containerize with Docker for ECS Fargate or EKS. AWS SDK v3 is modular (import only what you use), ships with native ESM support, and has built-in retry/backoff logic.
- **Multi-Cloud integration:** AWS for core AI/ML (SageMaker, Bedrock) and global scale; Azure for enterprise AD/Microsoft integration (IAM Identity Center + SAML 2.0); GCP for BigQuery or Vertex AI-specific models. Use Terraform for cross-cloud IaC, and Kubernetes as the portable compute layer. Direct Connect or site-to-site VPN for network connectivity between clouds.
- **CI/CD:** AWS CodePipeline + CodeBuild + CodeDeploy for fully-managed pipelines, or GitHub Actions with OIDC (no long-lived access keys — assume a role via the GitHub Actions OIDC provider). CDK Pipelines for self-mutating infrastructure pipelines. See [CI/CD & DevOps](/aws-cicd-devops) for full coverage.
- **Microservices / Kubernetes:** EKS for K8s workloads; ECS for simpler Docker orchestration. AWS Load Balancer Controller integrates ALB with Kubernetes ingress. App Mesh for service mesh. ECR for private container registry.

---

## Red Flags to Avoid

- **"I just use the Console for everything."** Senior engineers automate with CloudFormation, CDK, or Terraform. Manual console changes in production are an anti-pattern — no audit trail, not repeatable.
- **"IAM is just for users."** Failing to understand IAM roles for services (EC2 instance profiles, Lambda execution roles, ECS task roles) is a fundamental gap. Service-to-service permissions are the majority of IAM policy usage in production.
- **"We put everything in the public subnet."** Backend resources (databases, internal APIs, Lambda functions calling internal services) belong in private subnets. Mention NAT Gateway for outbound-only internet access from private subnets.
- **"Lambda is for everything, it's always cheaper."** Not recognizing Lambda's limitations (15-min timeout, cold starts, per-invocation cost at scale, no GPU) shows inexperience. Run the math for steady-state traffic.
- **"High availability means multiple EC2s in the same AZ."** This misses the core failure domain concept. Multi-AZ is the minimum for any production stateful resource.
- **"We store database passwords in environment variables in the code."** Major security anti-pattern — must mention Secrets Manager, rotation, and least-privilege IAM on the secret ARN.
- **"AWS is the only cloud we need."** For a multi-cloud role, failing to articulate where AWS excels versus where Azure or GCP may be a better fit shows shallow strategic thinking.
- **"S3 is a file system."** S3 is an object store. No append, no in-place partial writes, no directory rename as an atomic operation. Treating it like POSIX causes correctness and performance bugs.
- **"We can optimize cost later."** Cost decisions baked in early (instance types, storage classes, data transfer architecture) are expensive to undo. FinOps tagging, budget alarms, and Savings Plan analysis should happen at architecture time, not after the first surprise bill.
- **"Encryption is optional — we'll add it later."** KMS encryption for S3, EBS, RDS, and Secrets Manager is a checkbox at creation time. Enabling encryption on an existing unencrypted EBS volume requires creating a new volume from a snapshot — disruptive. Bake it in from the start.
