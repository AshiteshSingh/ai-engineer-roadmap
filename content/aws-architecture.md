# AWS Architecture Patterns & Well-Architected

## The 30-Second Pitch
The AWS Well-Architected Framework is a set of design principles and best practices distilled from reviewing thousands of production workloads. It provides a consistent approach to evaluate and improve architectures across six pillars: Operational Excellence, Security, Reliability, Performance Efficiency, Cost Optimization, and Sustainability. At a consulting company, this framework is the vocabulary for client conversations—it lets you quickly identify gaps in any architecture, prioritize remediation, and propose well-reasoned trade-offs. An architect who speaks fluently in WAF terms can run a Well-Architected Review, produce a risk report, and create a remediation roadmap, all of which are billable, repeatable engagements.

---

## 1. AWS Well-Architected Framework — All 6 Pillars

### Pillar 1: Operational Excellence
**Design Principles:** Operations-as-code, small frequent reversible changes, anticipate failure, learn from failures, refine procedures.

**Key Areas:**

**Infrastructure as Code (IaC)**
- CloudFormation: AWS-native, stateful stacks, drift detection, changesets for preview before apply
- CDK: synthesizes to CloudFormation; use constructs library for reusable patterns — see [CI/CD & DevOps](/aws/cicd-devops) for full CDK/CodePipeline coverage
- Terraform: cloud-agnostic, state file in S3+DynamoDB lock, better multi-account/multi-cloud
- Best practice: store all infra in git, require PR review, run `cfn-lint` / `terraform validate` in CI

**Runbooks & Playbooks**
- Runbook: step-by-step procedure for known operation (e.g., "scale up RDS read replicas")
- Playbook: decision tree for unknown/incident response
- Store in Systems Manager (SSM) Run Command documents for automated execution
- Tag runbooks by severity so on-call engineers find them in < 2 min

**Observability (see also Pillar 4 and dedicated Observability Stack section)**
- Metrics → CloudWatch Metrics + custom namespaces via PutMetricData
- Logs → CloudWatch Logs with structured JSON, Log Insights for ad-hoc queries
- Traces → AWS X-Ray, correlate with trace IDs in logs
- Synthetic canaries → CloudWatch Synthetics for user-journey monitoring
- Alarms → composite alarms to reduce noise; anomaly detection alarms for dynamic baselines

**Safe Deployments**
- Blue/Green: maintain two identical environments; switch traffic via ELB or Route 53; instant rollback
- Canary: route small % of traffic to new version ([CodeDeploy](/aws/cicd-devops) canary, [Lambda](/aws/lambda-serverless) weighted aliases, [ECS](/aws/compute-containers) service deployment circuit breaker)
- Feature flags: decouple deploy from release; CloudWatch Evidently for A/B and feature flags
- Deployment validation: pre-traffic and post-traffic hooks in CodeDeploy (Lambda), health checks in ECS

---

### Pillar 2: Security

**Design Principles:** Strong identity foundation, traceability, apply security at all layers, automate security, protect data in transit and at rest, keep people away from data, prepare for security events.

**Identity & Access Management** — see [IAM & Security](/aws/iam-security) for full deep-dive
- Root account: lock it, enable MFA, delete access keys — never use for daily work
- IAM users: only for humans without SSO; prefer IAM Identity Center (SSO) for people
- IAM roles: for services (EC2 instance profile, Lambda execution role, ECS task role) and cross-account access
- Least privilege: start with deny all, add only required actions; use Access Analyzer to surface unused permissions
- Permission boundaries: cap the max permissions a role can grant (useful for delegating IAM management)
- Service Control Policies (SCPs): organization-wide guardrails that override even root — cannot be overridden by account admin
- Session policies: further restrict AssumeRole sessions
- Conditions in policies: `aws:SourceIp`, `aws:RequestedRegion`, `aws:MultiFactorAuthPresent`, `aws:PrincipalTag`

**Detection** — see [IAM & Security](/aws/iam-security) for full coverage of GuardDuty, Security Hub, and CloudTrail
- CloudTrail: API call history, mandatory for forensics; enable for all regions, send to S3 + CloudWatch Logs
- GuardDuty: ML-based threat detection (unusual API calls, crypto mining, credential exfiltration, port scanning)
- Security Hub: aggregates findings from GuardDuty, Inspector, Macie, Firewall Manager; normalizes to ASFF
- AWS Config: continuous compliance; config rules (managed + custom Lambda) detect drift; conformance packs for bulk compliance
- CloudWatch Logs Insights: query logs for security events (`filter @message like /AccessDenied/`)
- EventBridge + Lambda: auto-remediation (quarantine EC2, rotate key) on GuardDuty finding

**Infrastructure Protection** — see [API Gateway & Networking](/aws/api-gateway-networking) for VPC, WAF, and Shield details; [IAM & Security](/aws/iam-security) for WAF managed rules and Network Firewall
- VPC Security Groups: stateful, instance-level; use as virtual firewalls; principle: default deny, explicit allow
- NACLs: stateless, subnet-level; use as coarse secondary layer (not primary)
- WAF: Layer 7 rules (SQL injection, XSS, rate limiting, IP allow/block lists, AWS Managed Rules); attach to ALB, CloudFront, API Gateway
- Shield Standard: automatic DDoS protection for all AWS customers (free)
- Shield Advanced: $3,000/month; DDoS cost protection, real-time metrics, AWS DDoS Response Team (DRT)
- Network Firewall: stateful, stateless, and Suricata-compatible IDS/IPS at VPC boundary
- Private endpoints (VPC Interface Endpoints): service traffic stays on AWS backbone, never traverses internet
- Bastion hosts → prefer SSM Session Manager (no inbound SSH ports, full audit log, no key management)

**Data Protection** — see [IAM & Security](/aws/iam-security) for KMS, Secrets Manager, and Macie deep-dives; [S3, CloudFront & Storage](/aws/storage-s3) for S3 encryption and Object Lock
- Encryption at rest: S3 SSE-S3 (default), SSE-KMS (audit trail, key rotation, cross-account), SSE-C (customer-managed)
- Encryption in transit: TLS 1.2+ enforced via bucket policies (`aws:SecureTransport`), ALB HTTPS listeners, API Gateway
- KMS: regional service, key material never leaves; envelope encryption (data key encrypted by CMK); automatic annual rotation
- Secrets Manager: stores and auto-rotates secrets (RDS, Redshift, custom); integrates with Lambda for rotation logic
- Parameter Store: SecureString type (KMS encrypted); hierarchical naming `/app/env/key`; free tier vs Advanced for large secrets
- S3 Macie: ML classification of sensitive data (PII, credentials in S3 buckets)
- S3 Object Lock: WORM (write once read many); Governance vs Compliance mode; used for regulatory retention

---

### Pillar 3: Reliability

**Design Principles:** Automatically recover from failure, test recovery procedures, scale horizontally, stop guessing capacity, manage change in automation.

**Foundations**
- Service limits / quotas: request increases proactively; use Service Quotas dashboard and alarms
- Network topology: multi-AZ by default; [Transit Gateway](/aws/api-gateway-networking) for hub-and-spoke VPC connectivity at scale
- DNS: [Route 53](/aws/api-gateway-networking) with health checks for automated failover; private hosted zones for internal service discovery

**Workload Architecture**
- Loose coupling: replace synchronous calls with async queues (SQS) or events (EventBridge) where latency allows — see [Messaging & Events](/aws-messaging-events) for SQS/SNS/EventBridge patterns
- Stateless services: store session state in [ElastiCache (Redis)](/aws/dynamodb-data-services) or [DynamoDB](/aws/dynamodb-data-services), not on instance; enables any-instance routing
- Idempotency: design all operations to be safely retried; use idempotency tokens (SQS message deduplication, DynamoDB conditional writes)
- Graceful degradation: circuit breakers, bulkheads, fallback responses when dependencies fail

**Change Management**
- [Auto Scaling Groups](/aws/compute-containers): dynamic scaling (target tracking, step, scheduled); ASG + ALB provides self-healing
- [ECS](/aws/compute-containers)/[EKS](/aws/compute-containers) rolling updates with health checks and deployment circuit breaker
- [RDS](/aws/dynamodb-data-services): Multi-AZ synchronous standby; failover < 60 seconds; avoid single-AZ in production

**Failure Management**
- Backup strategy: [AWS Backup](/aws/cicd-devops) for centralized, policy-driven backup across RDS, EBS, DynamoDB, EFS, FSx
- [RDS](/aws/dynamodb-data-services) automated backups: 35-day retention window, point-in-time recovery
- [S3](/aws/storage-s3) Versioning + MFA delete: protect against accidental deletion
- Chaos engineering: AWS Fault Injection Simulator (FIS) for controlled experiments (terminate instances, throttle network, inject latency)
- Health checks: ALB target health, Route 53 health checks, ECS task health; unhealthy targets removed automatically
- CloudWatch alarms → SNS → Auto Scaling: automated capacity response

---

### Pillar 4: Performance Efficiency

**Design Principles:** Democratize advanced technologies, go global in minutes, use serverless architectures, experiment more often, consider mechanical sympathy.

**Selection**
- Compute: [Lambda](/aws/lambda-serverless) for bursty/event-driven, [Fargate](/aws/compute-containers) for containerized variable load, [EC2](/aws/compute-containers) for sustained/specialized
- Storage: [S3](/aws/storage-s3) for objects/static, [EBS](/aws/storage-s3) gp3 for block (IOPS independent of size), io2 Block Express for databases, [EFS](/aws/storage-s3) for shared POSIX
- Database: match data model to engine — [Aurora](/aws/dynamodb-data-services) for relational, [DynamoDB](/aws/dynamodb-data-services) for key-value/document, [ElastiCache](/aws/dynamodb-data-services) for cache, [Redshift](/aws/dynamodb-data-services) for analytics, OpenSearch for full-text/vector search
- Networking: placement groups (cluster for HPC/low latency, spread for fault isolation), enhanced networking (SR-IOV), EFA for MPI workloads — see [API Gateway & Networking](/aws/api-gateway-networking)

**Review**
- Compute Optimizer: ML-based right-sizing recommendations for [EC2](/aws/compute-containers), ECS (Fargate), [Lambda](/aws/lambda-serverless), [EBS](/aws/storage-s3)
- Performance testing: load test with Artillery, Gatling; profile with X-Ray to find bottlenecks

**Monitoring**
- CloudWatch Metrics: built-in + custom; 1-second resolution with high-resolution metrics
- Contributor Insights: identify heaviest traffic contributors in CloudWatch Logs (top talkers, error sources)
- X-Ray: service map, latency histograms, annotation-based filtering; identify hot spots in distributed calls
- RDS Performance Insights: database load by wait state, SQL statement, user — pinpoint slow queries

**Tradeoffs**
- Caching layers: [CloudFront](/aws/storage-s3) (CDN), [ElastiCache Redis/Memcached](/aws/dynamodb-data-services) (in-memory), [DynamoDB DAX](/aws/dynamodb-data-services) (microsecond DynamoDB reads)
- Read replicas: [Aurora](/aws/dynamodb-data-services) up to 15 read replicas; offload read traffic; Global Database for cross-region reads
- Asynchronous processing: move work off the hot path; return 202 Accepted + polling/webhook
- Data locality: place compute near data (same AZ) to minimize latency; use local zones for sub-millisecond to end users

---

### Pillar 5: Cost Optimization

**Design Principles:** Implement cloud financial management, adopt a consumption model, measure overall efficiency, stop spending on undifferentiated heavy lifting, analyze and attribute expenditure.

**Cloud Financial Management**
- Tagging strategy: mandatory tags enforced via SCPs or Config rules (`CostCenter`, `Project`, `Owner`, `Environment`)
- Cost allocation: AWS Cost Explorer, Cost and Usage Reports (CUR) to S3 + Athena/QuickSight for custom dashboards
- Budgets: AWS Budgets with alerts at 50%, 80%, 100% of monthly/quarterly budget; anomaly detection alerts
- FinOps team rituals: weekly cost review, monthly commitment review, quarterly rightsizing

**Expenditure Awareness**
- Cost Explorer: visualize, filter by service/tag/account; forecast; identify top cost drivers
- Trusted Advisor: cost-related checks (underutilized EC2, idle load balancers, unattached EBS)
- Savings Plans + Reserved Instances (RI) reporting: coverage and utilization dashboards

**Cost-Effective Resources (see also Cost Optimization Patterns section)**
- Right-size before committing: use Compute Optimizer; reduce instance size or switch to graviton
- Graviton3 (arm64): up to 40% better price/performance for general compute vs x86; supported in [EC2](/aws/compute-containers), [Lambda](/aws/lambda-serverless), Fargate, RDS
- [Spot Instances](/aws/compute-containers): up to 90% savings; use for fault-tolerant, stateless, batch workloads; Spot Fleet + capacity-optimized allocation
- Savings Plans: 1 or 3 year; Compute SP flexible across instance family/region/OS; EC2 Instance SP for specific family
- Storage tiering: [S3 Intelligent-Tiering](/aws/storage-s3), S3 Glacier for infrequent access, Glacier Deep Archive for archival
- Lifecycle policies: auto-transition or delete objects after N days

---

### Pillar 6: Sustainability

**Design Principles:** Understand impact, establish sustainability goals, maximize utilization, anticipate and adopt more efficient offerings, use managed services, reduce downstream impact.

**Region Selection**
- AWS publishes carbon intensity by region; `eu-north-1` (Stockholm), `eu-west-1` (Ireland), `us-west-2` (Oregon) are highest renewable energy mix
- Sustainability pillar includes "carbon-efficient region" as a selection criterion

**Usage Patterns**
- Right-size aggressively: idle resources waste energy and money
- Schedule non-production resources: Instance Scheduler to stop dev/staging at nights/weekends
- Graviton: lower energy per operation than x86
- Spot/Fargate: bin-packing by the provider reduces overall server count

**Software & Architecture Patterns**
- Minimize data movement: process at the edge ([Lambda@Edge](/aws/lambda-serverless), [CloudFront Functions](/aws/storage-s3)) or in the same AZ
- Asynchronous & batch: group work to maximize hardware utilization (SQS batching, Lambda batch processing)
- Serverless: eliminates idle capacity; resources only allocated during actual execution
- Managed services: AWS optimizes hardware, cooling, and power at scale better than individual customers

---

## 2. Architecture Patterns

### Microservices on AWS

**Decomposition Strategies**
- Decompose by business capability (Domain-Driven Design): each service owns a bounded context and its data
- Decompose by subdomain: core domain (competitive differentiator), supporting, generic (buy/SaaS)
- Anti-corruption layer: translate between bounded context models when integrating legacy or third-party systems
- Rule: each service should be independently deployable; a change to service A should not require redeployment of service B

**Bounded Contexts on AWS**
- Each context gets its own: [CodePipeline](/aws/cicd-devops), ECR repository, [ECS](/aws/compute-containers) service or [Lambda](/aws/lambda-serverless), [DynamoDB](/aws/dynamodb-data-services) table or [RDS](/aws/dynamodb-data-services) database, [IAM role](/aws/iam-security)
- Context boundary enforcement: services communicate only via well-defined APIs (REST, gRPC) or events — never direct DB access

**Service Mesh: AWS App Mesh**
- Envoy proxy sidecar injected alongside each service container ([ECS](/aws/compute-containers) or [EKS](/aws/compute-containers))
- Provides: traffic shaping (retries, timeouts, circuit breaker), observability (metrics to CloudWatch, traces to X-Ray), mTLS encryption
- Virtual services, virtual routers, virtual nodes: abstract the service topology
- When to use: > 5 services with complex inter-service routing; otherwise an ALB with target groups is simpler
- Alternative: [API Gateway](/aws/api-gateway-networking) HTTP API for north-south; App Mesh for east-west

---

### Event-Driven Architecture on AWS

**EventBridge (Event Bus)**
- Central event bus; default bus (AWS service events), custom buses (application events), partner buses (SaaS integrations)
- Rules: pattern-match on event JSON fields; route to [Lambda](/aws/lambda-serverless), SQS, SNS, Kinesis, Step Functions, [API Gateway](/aws/api-gateway-networking), etc.
- Schema Registry: auto-discovers event schemas; generates code bindings for Java, Python, TypeScript
- EventBridge Pipes: point-to-point source → filter → enrich → target; source: SQS, Kinesis, [DynamoDB Streams](/aws/dynamodb-data-services); no polling code required
- EventBridge Scheduler: cron/rate-based invocation of any API target without a Lambda trigger

**SNS Fanout Pattern**
- SNS topic → multiple SQS queues (one per subscriber); ensures each consumer gets every message independently
- Use case: order placed → notify inventory service, billing service, notification service simultaneously
- Filter policies: route only relevant events to each subscription (avoid each service filtering itself)
- FIFO SNS + FIFO SQS: ordered, deduplicated fanout for strict ordering requirements

**SQS Decoupling**
- Standard queue: at-least-once delivery, best-effort ordering, unlimited throughput
- FIFO queue: exactly-once processing, strict FIFO, 3,000 msg/sec with batching
- Visibility timeout: the period during which a received message is invisible to other consumers; set to 6× your Lambda/worker processing time
- Dead Letter Queue (DLQ): messages that fail maxReceiveCount go to DLQ; alarm on DLQ ApproximateNumberOfMessagesVisible
- Long polling: 20-second wait reduces empty receives and cost; set `ReceiveMessageWaitTimeSeconds = 20`
- Lambda SQS integration: Lambda polls SQS; scales concurrency proportional to queue depth; batch size 1–10,000

**Kinesis Streaming**
- Kinesis Data Streams: real-time streaming; shards (1 MB/s in, 2 MB/s out each); consumers can replay data; retention 1–365 days
- Kinesis Data Firehose (now "Amazon Data Firehose"): fully managed ETL to S3, Redshift, OpenSearch, Splunk; transform via Lambda; no replay
- Kinesis Data Analytics (now "Managed Service for Apache Flink"): real-time SQL or Flink applications on streams
- When to use Kinesis vs SQS: Kinesis for ordered, replayable, multi-consumer streaming analytics; SQS for task queues with independent consumers

**Kinesis vs SQS Decision Matrix**

| Criterion | SQS | Kinesis Data Streams |
|---|---|---|
| Message ordering | FIFO only | Per-shard ordering |
| Replay | No | Yes (up to 365 days) |
| Multiple consumers | DLQ, no shared read | Fan-out via Enhanced Fan-Out |
| Throughput limit | Near unlimited | Per-shard limits |
| Best for | Task queues, decoupling | Streaming analytics, audit logs |

---

### CQRS + Event Sourcing on AWS

**Command Query Responsibility Segregation (CQRS)**
- Write model (Command side): accepts commands, validates, writes events to event store
- Read model (Query side): denormalized read tables optimized per query pattern; updated by consuming events
- AWS pattern: [DynamoDB](/aws/dynamodb-data-services) as event store (append-only, sort key = event sequence) → [DynamoDB Streams](/aws/dynamodb-data-services) → [Lambda](/aws/lambda-serverless) → read models in [Aurora](/aws/dynamodb-data-services), OpenSearch, or [ElastiCache](/aws/dynamodb-data-services)

**Event Sourcing**
- State is derived from a sequence of immutable events, not mutated in place
- Snapshot pattern: periodically snapshot current state to avoid replaying all events on every read
- EventBridge + DynamoDB Streams + Lambda: event-sourced microservice pattern
- Benefits: full audit trail, temporal queries ("what was the state at T?"), event replay for new read models

**Practical Implementation**
```
[Client] → [API Gateway] → [Command Lambda]
                                 |
                           [DynamoDB Event Store]  ← append only
                                 |
                         [DynamoDB Streams]
                                 |
                    ┌────────────┴─────────────┐
                [Read Model Lambda]      [Analytics Lambda]
                    |                         |
               [Aurora / ElastiCache]    [OpenSearch]
```

---

### Saga Pattern for Distributed Transactions

**Problem:** In microservices, you cannot use a database transaction across service boundaries. A saga is a sequence of local transactions coordinated via events or orchestration.

**Choreography-based Saga**
- Each service publishes events after its local transaction; downstream services react
- No central coordinator; decentralized, but hard to track overall progress
- Use when: simple linear flows with few steps

**Orchestration-based Saga**
- Central orchestrator (Step Functions State Machine) calls each service in sequence; handles compensating transactions on failure
- AWS [Step Functions](/aws-step-functions): ideal orchestrator; visual workflow, built-in retry/catch, supports Express Workflows (high volume, async)
- Pattern: Step Function calls [Lambda](/aws/lambda-serverless) for each service step; on failure, runs compensating Lambdas in reverse order

```
StepFunction: PlaceOrderSaga
  → ReserveInventory (Lambda) → success: next / fail: compensate
  → ChargeCreditCard (Lambda) → success: next / fail: refund inventory
  → ShipOrder (Lambda) → success: done / fail: refund both
```

**Compensating transactions:** must be idempotent; designed upfront; harder to retrofit

---

### Strangler Fig Pattern (Migration)

- Incrementally migrate monolith by routing new functionality to new services, while old paths still go to monolith
- AWS implementation: ALB path-based routing or [CloudFront](/aws/storage-s3) behaviors — new URLs → new microservice, old URLs → legacy app
- [API Gateway](/aws/api-gateway-networking) as facade: single domain, route by path to [Lambda](/aws/lambda-serverless) (new) or VPC Link → legacy NLB (old)
- Migrate one bounded context at a time; when all paths migrated, retire the monolith
- Anti-corruption layer: transform data formats between old and new models during coexistence

---

### Bulkhead & Circuit Breaker Patterns

**Bulkhead**
- Isolate failures; if one component fails, others continue
- AWS implementation: separate thread pools / SQS queues per service; VPC isolation; separate [Auto Scaling Groups](/aws/compute-containers)
- [Lambda](/aws/lambda-serverless) reserved concurrency: reserve capacity for critical functions, preventing noisy neighbors from consuming all concurrency

**Circuit Breaker**
- After N failures, open the circuit and return fallback immediately without attempting the failing dependency
- AWS implementation: App Mesh circuit breaker (outlier detection in Envoy); custom implementation in [Lambda](/aws/lambda-serverless) with [ElastiCache](/aws/dynamodb-data-services) state; AWS SDK has built-in retry/backoff
- CloudWatch alarm → Lambda → SSM Parameter Store flag → application reads flag to short-circuit calls

---

## 3. Multi-Tier Architectures

### 3-Tier Web Application

```
[Users] → [Route 53] → [CloudFront (CDN + WAF)]
                            |
                     [ALB (HTTPS, SSL termination)]
                            |
              [EC2 Auto Scaling Group / ECS Service]  ← App Tier (private subnet)
                            |
              ┌─────────────┴───────────────┐
         [Aurora MySQL Multi-AZ]     [ElastiCache Redis]  ← Data Tier (private subnet, no internet access)
```

- Web tier: static assets in [S3](/aws/storage-s3), served via [CloudFront](/aws/storage-s3); SPA communicates with backend API
- App tier: private subnets; outbound internet via [NAT Gateway](/aws/api-gateway-networking); fetches secrets from [Secrets Manager](/aws/iam-security) at startup
- Data tier: private subnets with no internet route; security groups restrict access to app tier only
- ALB: sticky sessions only if stateful (prefer stateless + [ElastiCache Redis](/aws/dynamodb-data-services)); HTTPS listener with ACM certificate

### Serverless Web Application

```
[Browser / Mobile] → [CloudFront] → [API Gateway (HTTP API or REST API)]
                                            |
                                    [Lambda Functions]
                                            |
                         ┌──────────────────┼──────────────────┐
                    [DynamoDB]        [S3 (objects)]     [SQS (async)]
                                            |
                                     [EventBridge]
                                            |
                                  [Downstream Lambdas]
```

- No servers to manage; scales to zero; pay per invocation — see [Lambda & Serverless](/aws/lambda-serverless) for full Lambda deep-dive
- Cold start mitigation: Provisioned Concurrency for latency-sensitive paths; Lambda SnapStart for Java
- Limits: 15-min max timeout, 10 GB memory, 512 MB–10 GB ephemeral /tmp storage, 250 MB deployment package (unzipped)
- Use Lambda Layers for shared dependencies (reduces package size, improves deployment speed)

### Container-Based Architecture (ECS Fargate / EKS)

```
[ALB] → [ECS Service (Fargate)] → [Service A containers]
                                → [Service B containers]
                                        |
                               [EFS (shared storage) or EBS per task]
                                        |
                             [Aurora Serverless v2 or RDS Multi-AZ]
```

- [ECS Fargate](/aws/compute-containers): no EC2 management; task definitions specify vCPU + memory; pay per task-second
- [EKS](/aws/compute-containers): Kubernetes control plane managed by AWS; worker nodes on EC2 (managed node groups) or Fargate — see [EC2, ECS & Containers](/aws/compute-containers) for full coverage
- Service Connect (ECS): built-in service discovery and traffic metrics via Cloud Map
- Karpenter (EKS): fast, cost-efficient node provisioning; replaces Cluster Autoscaler; supports Spot

---

## 4. High Availability Patterns

### Multi-AZ
- Minimum: 2 AZs (prefer 3 for avoiding split-brain in quorum systems)
- [EC2](/aws/compute-containers): ASG spans AZs; ALB distributes across targets in all AZs
- [RDS](/aws/dynamodb-data-services) Multi-AZ: synchronous replication to standby in different AZ; automated failover; standby not readable
- [Aurora](/aws/dynamodb-data-services): 6-way replication across 3 AZs for storage; can have reader instances in different AZs
- [ElastiCache Redis](/aws/dynamodb-data-services): Multi-AZ replication groups; automatic failover to replica
- [DynamoDB](/aws/dynamodb-data-services): inherently multi-AZ (global tables for multi-region); no configuration needed

### Multi-Region Active-Active
- Both regions serve production traffic simultaneously; true HA across regional failures
- [Route 53](/aws/api-gateway-networking) latency-based routing: users go to nearest healthy region
- [DynamoDB Global Tables](/aws/dynamodb-data-services): multi-master, eventual consistency; last-writer-wins conflict resolution
- [Aurora Global Database](/aws/dynamodb-data-services): primary region for writes, secondary regions for reads; < 1 second replication lag; can promote in < 1 minute
- [S3 Cross-Region Replication](/aws/storage-s3): asynchronous; replication time control (RTC) for < 15 min SLA
- Requires stateless app tier; session state in DynamoDB or ElastiCache Global Datastore
- Active-active tradeoff: complex conflict resolution, higher cost, more operational overhead

### Multi-Region Active-Passive
- Primary region serves traffic; secondary region is warm standby
- Route 53 failover routing: primary health check fails → DNS switches to secondary
- Lower cost than active-active; tolerate higher RTO (minutes, not seconds)
- Suitable for internal tools, B2B SaaS with contractual SLA > 30 min RTO

### Route 53 Routing Policies & Failover — see [API Gateway & Networking](/aws/api-gateway-networking) for full Route 53 coverage
- Simple: one record, no health check; no failover
- Failover: primary/secondary; requires health checks on primary; automatic failover when primary unhealthy
- Latency-based: route to region with lowest latency for the user
- Geolocation: route based on user's country/continent (compliance, data residency)
- Weighted: canary deployments, A/B testing (10% to new region)
- Multivalue answer: return multiple IPs (basic load distribution, not a replacement for ALB)
- Health checks: HTTP(S), TCP, CloudWatch alarm; evaluate every 10 or 30 seconds; failover after N consecutive failures (default 3)
- Private hosted zones: for VPC internal DNS; internal service discovery

---

## 5. Disaster Recovery Strategies

**RTO (Recovery Time Objective):** max acceptable downtime after disaster
**RPO (Recovery Point Objective):** max acceptable data loss (time since last backup)

### DR Spectrum (fastest/most expensive to slowest/cheapest)

| Strategy | RTO | RPO | Cost | Description |
|---|---|---|---|---|
| Multi-site active-active | Near zero | Near zero | Highest | Both sites live; Route 53 removes failed region |
| Warm Standby | Minutes | Seconds-minutes | High | Scaled-down but fully functional env in DR region; promote and scale up |
| Pilot Light | 10s of minutes | Minutes | Medium | Minimal running resources (DB replicated); launch and scale app tier on failover |
| Backup & Restore | Hours | Hours | Lowest | AMIs, RDS snapshots, S3 exports to DR region; rebuild from scratch |

**Backup & Restore**
- RPO hours; RTO hours; lowest cost
- [AWS Backup](/aws/cicd-devops): centralized, policy-driven, cross-region copy; backup vault with Vault Lock (WORM)
- Test restores quarterly; automate with Fault Injection Simulator

**Pilot Light**
- Keep a minimal version running: DB replication active, base AMIs registered, no app servers
- On failover: CloudFormation launches app tier, Route 53 updated
- Suitable for non-critical systems with RPO/RTO of 1 hour acceptable

**Warm Standby**
- Scaled-down replica of production: app servers running (minimum capacity), DB replication active
- On failover: scale up ASG, update [Route 53](/aws/api-gateway-networking) weights/failover
- RPO: seconds (if async replication) or near-zero ([Aurora Global Database](/aws/dynamodb-data-services)); RTO: minutes

**Multi-Site Active-Active**
- See High Availability section above
- Failover is automatic via Route 53 health checks; no manual intervention
- Most expensive but meets highest availability SLAs (99.999%+)

**Key DR Services**
- AWS Elastic Disaster Recovery (formerly CloudEndure): continuous replication of on-prem or cloud servers; failover in minutes
- [AWS Backup](/aws/cicd-devops): cross-region, cross-account backup management
- [Aurora Global Database](/aws/dynamodb-data-services): < 1 second cross-region replication; promote secondary in < 1 minute
- [S3 Cross-Region Replication](/aws/storage-s3) with Replication Time Control (RTC): 99.99% of objects replicated in < 15 minutes

---

## 6. Cost Optimization Patterns

### Rightsizing
- Use Compute Optimizer weekly; prioritize instances with < 10% average CPU utilization
- Step down instance family before instance size (e.g., c5.xlarge → c6g.large saves more than c5.xlarge → c5.large)
- Graviton migration: most apps run unmodified; Arm binaries needed; test before committing

### Spot Instances — see [EC2, ECS & Containers](/aws/compute-containers) for full Spot mechanics
- Up to 90% savings; instances can be interrupted with 2-minute warning
- Viable for: batch jobs, CI/CD workers, stateless web tier with ASG, ML training (with checkpointing)
- Spot best practices: diversify across multiple instance types and AZs (Spot Fleet, EC2 Fleet); use `capacity-optimized` allocation strategy; implement graceful shutdown on SIGTERM
- EC2 Auto Scaling with mixed instances: on-demand base capacity + Spot for scale-out

### Savings Plans vs Reserved Instances

| Type | Flexibility | Commitment | Savings |
|---|---|---|---|
| Compute Savings Plan | Any EC2, Fargate, Lambda; any region, OS, family | 1 or 3 year $/hr | Up to 66% |
| EC2 Instance SP | Specific instance family + region | 1 or 3 year | Up to 72% |
| RDS Reserved Instance | Specific engine + region + class | 1 or 3 year | Up to 69% |
| Savings Plan — upfront | Higher savings if pay all upfront | | Best rate |

- Never buy RIs/SPs without analyzing 3+ months of usage; over-commitment is wasted money
- Exchange convertible RIs: can change instance family, OS, tenancy within same engine type

### Data Transfer Cost Reduction
- Within same AZ: free; cross-AZ: $0.01/GB each way (biggest hidden cost in naively designed systems)
- [S3](/aws/storage-s3) → EC2 in same region: free; S3 → internet: $0.09/GB (use [CloudFront](/aws/storage-s3) to cache and reduce origin fetches)
- Use [VPC Interface Endpoints](/aws/api-gateway-networking) (PrivateLink) for AWS service traffic: eliminates NAT Gateway data processing charges
- CloudFront: cache-hit traffic avoids origin data transfer charges; compress responses (Gzip/Brotli)
- Place consumers and producers in same AZ where latency-sensitive; use replica reads in same AZ

### Storage Cost Optimization — see [S3, CloudFront & Storage](/aws/storage-s3) for full S3/EBS/EFS coverage
- [S3 Intelligent-Tiering](/aws/storage-s3): auto moves objects between Frequent/Infrequent/Archive tiers; no retrieval fees for Frequent/Infrequent
- S3 Lifecycle policies: transition to IA after 30 days, Glacier after 90 days, Deep Archive after 180 days
- [EBS](/aws/storage-s3): delete unattached volumes (alarm when state = available for > 7 days); switch to gp3 (same perf as gp2, 20% cheaper)
- [RDS](/aws/dynamodb-data-services): use Aurora Serverless v2 for variable workloads — scales in 0.5 ACU increments, scales to zero after idle period

### Lambda Cost Optimization — see [Lambda & Serverless](/aws/lambda-serverless) for full Lambda optimization guide
- Right-size memory: use AWS Lambda Power Tuning (Step Functions) to find optimal memory/cost balance
- ARM64 (Graviton2): 20% cheaper + 19% better performance in Lambda; change architecture field in function config
- Avoid unnecessary invocations: filter events at EventBridge rule level, not inside Lambda
- Batch processing: SQS batch size 10 (standard) or 10,000 (enhanced) to amortize invocation cost

---

## 7. Observability Stack

> Related: [Lambda & Serverless](/aws/lambda-serverless) for Lambda-specific observability (PowerTools, structured logging); [EC2, ECS & Containers](/aws/compute-containers) for container metrics and ADOT sidecar patterns. See also [Observability](/aws-observability) for the full dedicated deep-dive.

### CloudWatch Metrics
- Namespaces: `AWS/EC2`, `AWS/Lambda`, `AWS/RDS`, or custom (`MyApp/Orders`)
- PutMetricData: emit custom metrics from app code; 1-second resolution available (10× more expensive)
- Math expressions: combine metrics (e.g., `error_rate = Errors / Invocations * 100`)
- Metric streams: near-real-time streaming to S3 or Firehose (for Datadog, Splunk, etc.)

### CloudWatch Logs
- Log groups: one per application/service; set retention policy (never infinite in production — cost and compliance)
- Log Insights: SQL-like query language; cross-account query via resource policies; visualize time series
- Subscription filters: stream real-time to Lambda (custom processing), Kinesis, or OpenSearch
- Metric filters: extract metrics from log patterns (count `ERROR` occurrences per minute → alarm)
- CloudWatch Logs Anomaly Detection: ML-based; detect unusual log patterns automatically

### CloudWatch Alarms
- Static threshold vs anomaly detection band
- Composite alarms: logical AND/OR of alarms; reduce alert fatigue (only page if both disk + CPU are high)
- Alarm actions: SNS → PagerDuty/OpsGenie, Auto Scaling, Systems Manager OpsItems, Lambda auto-remediation
- Insufficient data state: treat as ALARM for production critical metrics

### CloudWatch Dashboards
- Cross-account, cross-region dashboards (share via console or embed via URL)
- Automatic dashboards: pre-built for all major AWS services; enable in one click
- Use dashboard as SLA evidence in customer-facing status pages

### Contributor Insights
- Analyzes CloudWatch Logs to find top N contributors matching a rule pattern
- Use case: identify top error-causing IP addresses, most frequent 5xx API paths, heaviest DynamoDB consumers
- DynamoDB Contributor Insights: partition-level hot key detection — critical for DynamoDB performance debugging

### AWS X-Ray
- Distributed tracing; trace ID propagated via HTTP header `X-Amzn-Trace-Id`
- Segments (whole service), subsegments (individual calls — DynamoDB, HTTP, SQL)
- Annotations: indexed key-value for filtering traces (`userId`, `orderId`)
- Metadata: non-indexed data stored with trace (payloads, debug info)
- X-Ray groups: filter traces by expression for targeted analysis
- Service map: visual graph of inter-service calls with latency and error rate per edge
- Integrate via: Lambda auto-instrumentation, X-Ray SDK in Node.js/Python/Java, AWS Distro for OpenTelemetry (ADOT)

### CloudWatch Evidently
- Feature flags: deploy code changes without releasing them; control rollout percentage
- A/B experiments: measure business impact of feature changes (conversion, latency, error rate)
- SafeDeploy integration: automatic rollback if experiment variant increases error rate above threshold

### AWS Distro for OpenTelemetry (ADOT)
- AWS-supported distribution of OpenTelemetry Collector + SDKs
- Collect traces and metrics from applications; send to X-Ray, CloudWatch, Prometheus, Jaeger simultaneously
- ECS/EKS sidecar container pattern: ADOT collector runs alongside app, receives OTLP, exports to AWS backends
- OpenTelemetry standard: avoids vendor lock-in on instrumentation; same SDK regardless of backend

### Managed Prometheus + Grafana
- Amazon Managed Service for Prometheus (AMP): PromQL, compatible with existing Prometheus tooling; auto-scales storage
- Amazon Managed Grafana (AMG): SSO via IAM Identity Center; connect to AMP, CloudWatch, OpenSearch, Athena
- EKS pattern: Prometheus operator scrapes pods → remote_write to AMP → Grafana dashboards

---

## 8. Migration Strategies — The 7 Rs

> Related: [CI/CD & DevOps](/aws/cicd-devops) for pipeline automation during migration; [EC2, ECS & Containers](/aws/compute-containers) for compute targets; [DynamoDB & Data Services](/aws/dynamodb-data-services) for DMS and database migration.

### Retire
- Decommission: application has no business value; turn it off
- Often 10–20% of application portfolio in a migration assessment
- Action: backup data, communicate deprecation, delete resources

### Retain
- Keep on-premises or in current environment; not ready for migration
- Reasons: compliance, recent capex, pending major refactor, dependency on unmovable system
- Revisit in 12–24 months

### Rehost (Lift & Shift)
- Move VMs to EC2 with minimal changes; fastest migration path
- Tools: AWS Application Migration Service (MGN); continuous replication, cutover with minutes of downtime
- When to use: large-scale migration with tight timeline; optimize later
- Limitations: don't benefit from cloud-native features; same license costs; same operational model

### Relocate
- Move entire on-premises VMware infrastructure to AWS VMware Cloud on AWS
- No application changes; same VMware tooling; fastest for VMware-heavy environments
- Less common; use when VMware skills are critical and re-platforming is too risky

### Replatform (Lift, Tinker & Shift)
- Small optimizations during migration without changing core architecture
- Examples: move to RDS from self-managed MySQL (no code changes); move to Elastic Beanstalk; containerize app
- Sweet spot: significant operational benefit with low risk and effort

### Repurchase (Drop & Shop)
- Replace with SaaS product; abandon existing license
- Examples: migrate on-prem CRM to Salesforce, email to Microsoft 365, data warehouse to Snowflake
- Often the right choice for commodity business functions (HR, ERP, collaboration)

### Refactor / Re-architect
- Rethink architecture to be cloud-native; highest complexity, highest long-term benefit
- Examples: decompose monolith into microservices; re-write to use [Lambda](/aws/lambda-serverless) + [DynamoDB](/aws/dynamodb-data-services); implement event-driven architecture
- When to use: app is a strategic differentiator; current architecture is a bottleneck to growth
- Requires most time and investment; justified when business agility value exceeds migration cost

### AWS Migration Hub
- Central tracking for all migration projects across all strategies
- Integrates with MGN, DMS, Server Migration Service, partner tools
- Dependency mapping via AWS Application Discovery Service (agent or agentless)
- Migration strategies tracked per application; progress dashboard

### Application Migration Service (MGN)
- Continuous block-level replication from source (on-prem, other cloud) to staging area in AWS
- Test cutovers: launch test instances without interrupting source; validate before final cutover
- Final cutover: drain traffic, final sync, convert to production EC2 instances; RTO in minutes

### Database Migration Service (DMS)
- Homogeneous (MySQL → Aurora MySQL) and heterogeneous (Oracle → Aurora PostgreSQL) migrations
- Schema Conversion Tool (SCT): convert stored procedures, views, functions for heterogeneous migrations
- Continuous data replication (CDC): migrate with minimal downtime; cut over when lag is seconds
- Full load + CDC: bulk load then stream changes; cutover when lag < 1 second

---

## 9. Landing Zone & AWS Control Tower

### AWS Organizations Structure
```
Root
 ├── Management Account (no workloads, billing, SCPs root)
 ├── Security OU
 │   ├── Log Archive Account (centralized CloudTrail, Config logs)
 │   └── Security Tooling Account (GuardDuty master, Security Hub master)
 ├── Infrastructure OU
 │   ├── Network Account (Transit Gateway, shared VPCs, DNS)
 │   └── Shared Services Account (ADConnector, internal tools)
 ├── Sandbox OU (SCPs: no production services, spend limit)
 ├── Dev OU
 ├── Test/QA OU
 └── Production OU
```

### AWS Control Tower — see [CI/CD & DevOps](/aws/cicd-devops) for IaC and account-vending pipelines
- Sets up a landing zone: account structure, baseline configuration, guardrails in < 1 hour
- Account Factory: self-service account vending via Service Catalog; new accounts provisioned with baseline controls, VPC, logging
- Account Factory for Terraform (AFT): Terraform-native account vending; codify account customizations
- Guardrails: proactive (prevent via [SCPs](/aws/iam-security)), detective (detect via Config Rules), or combination
- Mandatory guardrails: always enabled (e.g., CloudTrail enabled, S3 public access blocked)
- Strongly recommended guardrails: on by default but can disable
- Elective guardrails: opt-in for specific OUs

### Service Control Policies (SCPs) — see [IAM & Security](/aws/iam-security) for full SCP and IAM deep-dive
- Apply at OU or account level; define maximum permissions (allow list or deny list model)
- Deny list model (default): attach AWS managed `FullAWSAccess` + explicit deny policies — more flexible
- Allow list model: deny everything, explicitly allow what's permitted — more secure but operationally heavy
- Common SCPs: deny leaving org, require MFA for root, restrict regions (`aws:RequestedRegion`), prevent disabling CloudTrail/GuardDuty, enforce encryption, restrict EC2 instance types

```json
// SCP: Restrict to approved regions only
{
  "Effect": "Deny",
  "Action": "*",
  "Resource": "*",
  "Condition": {
    "StringNotEquals": {
      "aws:RequestedRegion": ["us-east-1", "us-west-2", "eu-west-1"]
    },
    "ForAllValues:StringNotLike": {
      "aws:PrincipalArn": ["arn:aws:iam::*:role/NetworkAdmin"]
    }
  }
}
```

### Account Vending at Scale
- Golden AMI pipeline: hardened base AMIs built with EC2 Image Builder, distributed to all accounts
- Baseline IaC: CloudFormation StackSets deploy security baselines (Config rules, GuardDuty enrollment, security groups) to all accounts automatically when new account created
- Tag policies: enforce consistent tag key names and values across org; prevent `Cost-Center` vs `CostCenter` inconsistency

---

## 10. Integration Services Deep Dive

### EventBridge

**Event Rules**
- Match on event pattern (exact value, prefix, numeric range, exists/not-exists, `anything-but`)
- Rule can route to multiple targets (up to 5); each target has its own input transformer
- Input transformer: reshape event JSON before sending to target (extract fields, add constants)
- Dead letter queue per rule: failed delivery attempts → SQS DLQ

**EventBridge Pipes**
- Point-to-point integration: source → filter → enrich → target
- Sources: SQS, Kinesis, [DynamoDB Streams](/aws/dynamodb-data-services), Kafka (MSK/self-managed)
- Enrichment step: [Lambda](/aws/lambda-serverless), [API Gateway](/aws/api-gateway-networking), Step Functions (synchronous) — add data before target
- Target: same as EventBridge rules; also SQS, Kinesis, DynamoDB, EventBridge bus, Step Functions
- Eliminates polling Lambda functions; reduces code; native filtering before Lambda invocation

**EventBridge Scheduler**
- Replaces CloudWatch Events scheduled rules; supports > 50M schedules
- One-time schedules: invoke exactly once at a specific time (e.g., schedule account deletion in 30 days)
- Recurring: rate or cron expression
- Flexible time window: ± N minutes around scheduled time (distribute invocations, avoid thundering herd)
- Targets: 270+ AWS services; supports templated targets with per-schedule payloads

### SQS Deep Dive

**Standard Queue**
- At-least-once delivery (possible duplicates); consumers must be idempotent
- Best-effort ordering; nearly unlimited throughput
- Visibility timeout: default 30s; set to 6× average processing time to avoid duplicate processing
- Message retention: 4 days default, max 14 days
- Long polling: `ReceiveMessageWaitTimeSeconds = 20`; reduces empty receives by 98%

**FIFO Queue**
- Exactly-once processing within 5-minute deduplication window (content or provided deduplication ID)
- Message groups: ordering guaranteed within a group; multiple groups processed in parallel
- 3,000 msg/s with batching; 300 msg/s without
- Use for financial transactions, ordered state machine events, idempotent command processing

**SQS + Lambda Pattern**
- Lambda polls SQS (not the reverse); up to 5 parallel polling batches per queue per function
- Batch size: 1–10,000; batch window: up to 300 seconds (collect more messages before invoking)
- Report batch item failures: partial failure handling — only fail individual messages, not entire batch
- Concurrency: Lambda scales up to (queue shard count × 5) concurrent executions

**Dead Letter Queue**
- Any message that fails `maxReceiveCount` times moved to DLQ
- DLQ must be same type as source (FIFO DLQ for FIFO source)
- Alarm on `ApproximateNumberOfMessagesVisible` in DLQ ≥ 1
- DLQ redrive: send messages back to source queue after fixing the bug

### SNS

- Push-based pub/sub; no message retention (unlike SQS); at-least-once delivery to all subscribers
- Topic types: Standard (best-effort ordering), FIFO (ordered, deduplicated — only SQS subscribers)
- Subscriptions: SQS, Lambda, HTTPS, email, SMS, mobile push
- Filter policies: JSON-based; match on message attributes or message body; reduce fan-out noise
- Message archiving: FIFO topics can archive to S3 for replay

**SNS + SQS Fanout Pattern**
```
[Producer] → [SNS Topic]
                 ├── [SQS Queue A] → [Lambda / Worker A]  (inventory)
                 ├── [SQS Queue B] → [Lambda / Worker B]  (billing)
                 └── [SQS Queue C] → [Lambda / Worker C]  (notifications)
```
- Each subscriber gets independent delivery; one consumer failure doesn't affect others
- Add SQS for buffering: SNS pushes at full rate; SQS absorbs bursts; Lambda processes at its own pace

### Kinesis Data Streams vs Firehose

| | Kinesis Data Streams | Amazon Data Firehose |
|---|---|---|
| Management | Provision shards manually (or on-demand mode) | Fully managed, serverless |
| Consumers | Custom (KCL, Lambda, Flink) | Built-in: S3, Redshift, OpenSearch, Splunk |
| Data retention | 1–365 days (replay) | No retention (deliver & discard) |
| Ordering | Per-shard order | No ordering guarantee |
| Latency | Sub-second | 60–900 second buffer |
| Throughput | 1 MB/s in, 2 MB/s out per shard | Auto-scales |
| Use when | Real-time analytics, multiple consumers, replay needed | ETL to data lake/warehouse, no custom consumer needed |

---

## 11. Consulting-Specific Patterns

### Multi-Tenant SaaS Architecture

**Tenant Isolation Models (spectrum of isolation vs cost)**

| Model | Isolation | Cost | Complexity |
|---|---|---|---|
| Silo (account per tenant) | Highest (blast radius limited to one account) | Highest | Medium |
| Pool (shared resources) | Lowest (logical isolation only) | Lowest | Highest (noisy neighbor risk) |
| Bridge (silo compute, pool storage) | Medium | Medium | Medium |

**Silo Model (Account-per-Tenant)**
- Each tenant gets a dedicated AWS account in the org; account = hard security boundary
- Control Tower Account Factory provisions new account + applies tenant-specific baseline
- Cross-tenant access: impossible by default (IAM trust boundaries); ideal for regulated industries, enterprise clients
- Billing: per-account Cost Explorer; tag policies; consolidated billing in management account

**Pool Model (Shared Infrastructure)**
- All tenants share [EC2](/aws/compute-containers)/[Lambda](/aws/lambda-serverless)/[RDS](/aws/dynamodb-data-services); tenant data isolated by `tenantId` column (row-level security) or [DynamoDB](/aws/dynamodb-data-services) partition key
- DynamoDB: `PK = tenant#<id>#resource#<id>` — all queries must include tenantId
- Aurora: Row Level Security (RLS) via PostgreSQL policies enforced at DB level
- Application-level isolation: every [API Gateway](/aws/api-gateway-networking) request validated against JWT `tenantId` claim; middleware prevents cross-tenant data access
- Noisy neighbor: reserved Lambda concurrency per tenant tier; DynamoDB per-partition WCU monitoring

**Tenant-Aware Observability**
- Embed `tenantId` in all structured logs; CloudWatch Logs Insights queries per tenant
- X-Ray annotations with `tenantId` for trace filtering
- Per-tenant CloudWatch custom metrics for SLA tracking and chargeback

### White-Labeling Architecture
- Custom domain per client: [Route 53](/aws/api-gateway-networking) hosted zones per tenant; ACM wildcard or per-domain certificates
- [CloudFront](/aws/storage-s3) distribution per tenant (or SNI on shared distribution): different origins, behaviors, cache policies per tenant
- Branding config in [DynamoDB](/aws/dynamodb-data-services): `tenantId` → logo URL, color scheme, feature flags; fetched on UI load
- Subdomain routing: `client1.saas.com`, `client2.saas.com` → same CloudFront → same origin → tenant resolved by `Host` header
- Custom domain BYOD (Bring Your Own Domain): client points CNAME to CloudFront distribution; ACM validates via DNS

### Client Isolation Strategies

**Data Isolation**
- Physical: separate databases (highest isolation, highest cost) — see [DynamoDB & Data Services](/aws/dynamodb-data-services) for database options
- Logical: shared database, separate schemas (Postgres), or row-level isolation with RLS
- Encryption: unique [KMS key](/aws/iam-security) per tenant; data is cryptographically isolated even if logical controls fail (expensive but used in financial services)

**Compute Isolation**
- [Fargate](/aws/compute-containers) task per tenant request: ephemeral, isolated, no shared process space
- [Lambda](/aws/lambda-serverless): separate functions per tenant tier (if behavioral customization needed) or shared function with tenant context

**Network Isolation**
- [VPC](/aws/api-gateway-networking) per tenant: used in silo model; peered or via [Transit Gateway](/aws/api-gateway-networking) to shared services
- [Security groups](/aws/api-gateway-networking) as tenant boundaries in pool model: restrict by app-layer tag, not network

**Blast Radius Containment**
- If one tenant's misconfiguration or attack compromises security, contain it to that tenant's account/resources
- SCP guardrails ensure even a compromised tenant account cannot affect others

---

## 12. Common Architecture Interview Questions

**Q: Walk me through designing a high-availability web application on AWS.**
A: Start with requirements: target availability (99.9% = 8.7 hr/year downtime, 99.99% = 52 min/year), RTO/RPO, expected traffic. For 99.99%, deploy across 3 AZs: ALB in all 3 AZs distributes traffic to ASG with instances in each AZ. Aurora Multi-AZ for DB (synchronous standby, automatic failover < 60s). ElastiCache Redis replication group across 2 AZs for session/cache. Static assets in S3 behind CloudFront. Route 53 active-passive to a second region for 99.999% or active-active with latency routing. CloudWatch alarms on all critical metrics; Auto Scaling on CPU/request count.

---

**Q: How would you migrate a monolith to microservices on AWS? What order do you tackle it?**
A: Use the Strangler Fig pattern — never rewrite the whole thing at once. First: identify bounded contexts via domain analysis (DDD). Second: extract the lowest-risk, highest-value context first (often auth or user service). Deploy new service on ECS Fargate or Lambda behind API Gateway. Route that path via ALB path-based routing to new service; monolith still handles everything else. Migrate data last (DMS CDC). Repeat per context. Never change the monolith's API contracts during transition. Monitor with X-Ray to confirm the new service handles load correctly before removing the old code path.

---

**Q: A customer's RDS database is the bottleneck. What are your options?**
A: Depends on where the bottleneck is. If reads: add read replicas (up to 5 for MySQL, 15 for Aurora); update connection strings. If Aurora: use Aurora Endpoints (reader endpoint auto-load-balances across replicas). Add ElastiCache (Redis) for frequently read, rarely changed data (caching layer). If writes: consider vertical scaling first (less disruption); then evaluate schema/query optimization via Performance Insights; for extreme write scale, partition the data or move write-heavy tables to DynamoDB. If connection count: use RDS Proxy (connection pooling); Lambda can create 1,000+ connections — RDS Proxy multiplexes them to < 100 DB connections.

---

**Q: Explain how you'd implement least-privilege IAM across a multi-account organization.**
A: Three layers. (1) SCPs at OU level set absolute ceilings — no IAM policy in any account can exceed what the SCP allows. (2) IAM permission boundaries on all developer-vended roles cap what they can grant. (3) Roles themselves use least privilege with condition keys (`aws:SourceIp`, `aws:RequestedRegion`). Use IAM Access Analyzer to find unused permissions and external resource access. Automate policy generation with Access Analyzer policy generation (analyzes CloudTrail for used actions, generates minimal policy). Enforce via CI/CD: fail PRs that add `*` actions or `*` resources without justification. Quarterly IAM reviews using Credential Report and Access Advisor.

---

**Q: When would you choose Step Functions over EventBridge for orchestrating a workflow?**
A: Step Functions when you need durable execution state, complex branching/retry/catch logic, human approval steps, or when you need to correlate results of parallel branches. It's an orchestrator — it waits, retries, and tracks each step's state with full visibility. EventBridge when you have a simple event chain where each service is independently responsible for its own next action (choreography). EventBridge has no state — if you need to know "did all 3 services finish?" use Step Functions. Practical rule: Step Functions for business processes with 3+ steps requiring error handling; EventBridge for fan-out notification and loose coupling.

---

**Q: How do you handle idempotency in a distributed system on AWS?**
A: Idempotency means processing the same request multiple times produces the same outcome. Techniques: (1) Idempotency keys in API requests; store in DynamoDB with TTL; Lambda Powertools provides built-in idempotency with DynamoDB. (2) SQS FIFO MessageDeduplicationId: prevent duplicate processing within 5-minute window. (3) DynamoDB conditional writes: `ConditionExpression = "attribute_not_exists(orderId)"` prevents double-write. (4) Database-level unique constraints: last-resort catch. Design every Lambda and worker to be idempotent by default — you will get duplicate messages from SQS (at-least-once delivery).

---

**Q: A client asks if they should go multi-region. How do you advise them?**
A: Ask what availability SLA they actually need. Multi-region is expensive and complex — only justified for specific scenarios: (1) Regulatory data residency requirements (data must stay in EU), (2) Availability requirement > 99.95% that can't be met by multi-AZ, (3) Latency requirements for global user base, (4) Disaster recovery with RTO < 30 minutes. For most workloads, multi-AZ + Route 53 health checks achieves 99.95% uptime. If they do go multi-region: start with active-passive (Route 53 failover) — simpler, handles most DR requirements. Active-active only if latency (global users) or availability (99.999%) demands it — it requires solving data conflict resolution, which adds significant complexity.

---

**Q: How does your observability strategy differ between Lambda and ECS?**
A: Lambda: auto-instruments with CloudWatch Logs (stdout/stderr), X-Ray active tracing (one checkbox), built-in metrics (Duration, Errors, Throttles, ConcurrentExecutions). Key addition: structured JSON logging, correlation IDs, Lambda Powertools for TypeScript/Python. ECS/Fargate: no auto-instrumentation; sidecar ADOT collector + application SDK for traces; CloudWatch agent sidecar for container metrics. Need to configure log driver (`awslogs`) explicitly. More operational setup but more control. For both: add `tenantId`, `requestId`, `correlationId` as X-Ray annotations and log fields — essential for root cause analysis in production.

---

**Q: What's the difference between RTO and RPO, and how do they drive your DR architecture choice?**
A: RPO is how much data you can afford to lose — drives replication frequency and synchrony. RTO is how long the system can be down — drives automation and warm capacity. If RPO = 1 hour, hourly snapshots + restore is sufficient. If RPO = 0, you need synchronous replication (Aurora Multi-AZ, DynamoDB Global Tables with strong consistency). If RTO = 4 hours, you can afford to rebuild from AMIs + snapshots (pilot light). If RTO = 5 minutes, you need a warm standby already running. The key consulting insight: clients almost always say "zero RPO, zero RTO" until they hear the cost. Have them quantify the cost of 1 hour of downtime vs the cost of active-active infrastructure — that frames the right trade-off conversation.

---

**Q: How does SCP inheritance work in AWS Organizations? Can an account override an SCP?**
A: SCPs flow down the hierarchy (root → OU → account) and are evaluated as an intersection. An effective permission at the account level = (IAM policy) AND (all SCPs in the hierarchy chain). An account cannot override or bypass an SCP — even the account's root user is restricted by SCPs. If the OU has an SCP denying `ec2:RunInstances` in `ap-southeast-1`, no IAM policy in that account — including AdministratorAccess — can allow it. This is what makes SCPs the right tool for organization-wide guardrails. Important gotcha: SCPs do not apply to the Management Account — another reason to keep no workloads there.

---

**Q: Design a cost-optimized data processing pipeline that runs nightly.**
A: Use Spot Instances for compute — nightly batch is fault-tolerant, schedule is flexible, Spot interruption is recoverable with checkpointing. Architecture: EventBridge Scheduler triggers Step Functions at midnight. Step Function launches EMR cluster (Spot instance fleet with instance diversification) or ECS Fargate Spot tasks. Input data in S3 (Intelligent-Tiering). Results written back to S3. EMR or ECS terminates after job completes — no idle capacity. Estimated savings vs on-demand EC2 running 24/7: 80–90%. Additional: use S3 Lifecycle to transition inputs to IA after 30 days, Glacier after 90 days. Tag all resources with `Project` and `CostCenter` for attribution.

---

## Serverless Architecture Patterns Catalog

### Pattern 1: Fan-Out (Broadcast to Multiple Consumers)
```
API Gateway → Lambda (publisher)
                  ↓
               SNS Topic
              /    |    \
        Lambda  Lambda  SQS Queue
        (email) (SMS)   → Lambda (async)
```
Use case: User registration triggers email, SMS, and async enrichment in parallel.
Key design: SNS subscription filter policies so each consumer only processes relevant events. See [Messaging & Events](/aws-messaging-events) for SNS/SQS deep-dive.

### Pattern 2: Scatter-Gather (Parallel Queries → Aggregate)
```
API Request → Lambda (orchestrator)
                  ↓ parallel invocations
           ┌──Lambda A──┐
           │            │
           ├──Lambda B──┤ → Lambda (aggregator)
           │            │
           └──Lambda C──┘
```
Implementation in [Step Functions](/aws-step-functions): `Parallel` state type; all branches complete before aggregation.
Use case: Price comparison API — query 5 suppliers in parallel, return cheapest.

### Pattern 3: Claim-Check (Large Payload Handling)
```
Publisher → S3 (store large payload) → SNS/SQS (send S3 key only)
                                           ↓
                                        Consumer → S3 (retrieve payload)
```
Why: SQS/SNS have 256 KB payload limits; S3 objects up to 5 TB.
Implementation: publisher writes to S3, sends `s3://bucket/key` as the event payload; consumer fetches from S3 on receipt.

### Pattern 4: Saga (Distributed Transaction Compensation)
```
Step Functions Workflow:
1. Reserve Inventory  → SUCCESS
2. Charge Payment     → FAILURE
   ↓ (Catch: PaymentFailed)
3. Release Inventory  ← compensation step
4. Notify Customer    ← compensation step
5. Fail workflow
```
Key: each forward step has a corresponding compensation step. Compensation steps must be idempotent.
Compare: Choreography-based Saga (each service listens for events and compensates independently) vs Orchestration-based Saga ([Step Functions](/aws-step-functions) coordinates).

### Pattern 5: Competing Consumers (Work Queue)
```
High-volume events → SQS Standard Queue
                          ↓
               Lambda (auto-scales to consume)
               (N concurrent Lambdas competing for messages)
```
Key settings:
- `BatchSize`: 10-100 messages per invocation
- `MaximumConcurrency`: cap on Lambda concurrency (protect downstream DB)
- `BisectBatchOnFunctionError`: true — isolate poison pills
- `ReportBatchItemFailures`: partial failure support

### Pattern 6: Inbox/Outbox for Reliability
```
Outbox Pattern (write atomically to DB + outbox):
  Application → DynamoDB (item + outbox record in same transaction)
                              ↓ DynamoDB Streams
                          Lambda → EventBridge → consumers

Inbox Pattern (idempotent processing):
  SQS message → Lambda checks DynamoDB idempotency table
                  → already processed? Return. New? Process + mark.
```
Why Outbox: prevents "wrote to DB but failed to publish event" dual-write problem.
Why Inbox: prevents duplicate processing of SQS at-least-once delivery.

---

## CQRS + Event Sourcing on AWS

### CQRS — Command Query Responsibility Segregation
```
Write Path:
  POST /orders → Lambda (Command Handler)
                      ↓
                 DynamoDB (write model: normalized, append-only)
                      ↓ DynamoDB Streams
                 Lambda (Projection) → DynamoDB (read model: denormalized, query-optimized)
                                    → OpenSearch (full-text search)
                                    → ElastiCache (hot read cache)

Read Path:
  GET /orders/search → Lambda → OpenSearch
  GET /orders/{id}   → Lambda → DynamoDB read model (or ElastiCache)
```

Benefit: read model is optimized for query patterns; write model is optimized for integrity; scale read/write independently.

### Event Sourcing
Instead of storing current state, store every event that led to current state:
```
Events table (append-only):
  orderId | version | eventType      | eventData
  ord-1   | 1       | OrderCreated   | {customerId, items, total}
  ord-1   | 2       | PaymentCharged | {amount, transactionId}
  ord-1   | 3       | ItemShipped    | {carrier, trackingId}
  ord-1   | 4       | OrderDelivered | {deliveredAt}
```

To get current state: replay events in order (`ORDER BY version ASC`).
Benefits: full audit trail, time-travel (state at any past moment), event-driven projection.

```javascript
// DynamoDB event store with optimistic locking
async function appendEvent(orderId, expectedVersion, eventType, eventData) {
  await ddb.send(new PutItemCommand({
    TableName: 'OrderEvents',
    Item: {
      orderId: { S: orderId },
      version: { N: (expectedVersion + 1).toString() },
      eventType: { S: eventType },
      eventData: { M: marshall(eventData) },
      timestamp: { S: new Date().toISOString() },
    },
    // Optimistic locking: fail if someone else already wrote this version
    ConditionExpression: 'attribute_not_exists(orderId) OR version = :expected',
    ExpressionAttributeValues: { ':expected': { N: expectedVersion.toString() } },
  }));
}
```

---

## Multi-Region Active-Active Architecture

### Design Principles
1. **Data plane runs in every region** — no cross-region API calls for normal operations
2. **Control plane can be regional** — deployment, management operations tolerate latency
3. **Data replication is asynchronous** — accept < 1s lag for DynamoDB Global Tables, Aurora Global
4. **Conflict resolution is designed upfront** — not an afterthought
5. **DNS routing handles failover** — Route 53 latency routing + health checks; see [VPC & Networking](/aws-vpc-networking) for Route 53 routing policies

### Reference Architecture
```
                    Route 53 (Latency routing)
                   /                            \
          us-east-1                          eu-west-1
         ALB                                    ALB
          ↓                                      ↓
      ECS Fargate                            ECS Fargate
          ↓                                      ↓
   DynamoDB ←────── Global Tables ──────► DynamoDB
   (replica)          (< 1s lag)           (primary)
          ↓                                      ↓
   Aurora Global                          Aurora Global
   (secondary, read-only)                 (primary, writes)
```

### Regional Isolation Pattern (Cell-Based Architecture)
- Assign each customer/tenant a "home cell" (cell = specific AZ or small region cluster)
- Customer requests always routed to their home cell
- One cell failure doesn't affect other cells
- Eliminates cross-cell dependencies and shared-fate failures
- Used at scale by: Amazon.com, Netflix, Route 53

### Zonal Shift
- AWS native feature for ALB/NLB: instantly remove an impaired AZ from routing
- No DNS TTL delay (unlike Route 53 failover) — takes effect in <1 second
- Initiated via CLI: `aws arc-zonal-shift start-zonal-shift --resource-identifier arn:aws:elasticloadbalancing:...`
- ARC (Application Recovery Controller) manages multi-region failover manually or automated

---

## AWS Landing Zone Accelerator

Landing Zone Accelerator on AWS is an open-source solution that automates a full multi-account AWS organization setup.

### What It Deploys
- AWS Organizations with OU structure
- AWS Control Tower with guardrails
- Security baseline: CloudTrail (org-level), AWS Config, Security Hub, GuardDuty, Macie across all accounts — see [Security Services](/aws-security-services) for coverage of these tools
- Network baseline: centralized Transit Gateway, VPC templates per account, Direct Connect ready
- Identity: IAM Identity Center with permission sets
- Logging: centralized CloudWatch + S3 log archive account

### Configuration-Driven
```yaml
# accounts-config.yaml (abbreviated)
mandatoryAccounts:
  - name: Management
  - name: LogArchive
  - name: Audit

workloadAccounts:
  - name: SharedServices
    description: Shared services (AD, DNS, ECR)
    email: shared-services@company.com
    organizationalUnit: Infrastructure

  - name: ProductionWorkload
    email: prod@company.com
    organizationalUnit: Workloads/Production
```

All infrastructure changes are applied via CodePipeline when configuration YAML is committed — GitOps for org-level governance.

---

## Well-Architected Tool — Practical Usage

The AWS Well-Architected Tool provides a structured review process that produces a risk report and remediation backlog.

### Conducting a Review
1. Define the workload (name, description, team, environment)
2. Answer ~60 questions across 6 pillars (30-90 min)
3. Review High/Medium/Low risk findings
4. Create improvement plan: prioritize top 5 high-risk findings
5. Share report with stakeholders

### Key Questions Often Marked "At Risk"
- "Do you have defined recovery objectives?" — RPO/RTO must be documented
- "How do you perform patch management?" — automated patching via SSM Patch Manager
- "How do you implement traceability?" — distributed tracing required (X-Ray/ADOT); see [Observability](/aws-observability) for full tracing stack
- "How do you allocate costs to workloads?" — tag governance required; see [Cost Optimization](/aws-cost-optimization) for tagging strategy
- "How do you implement service limits management?" — Service Quotas alerting

### Milestone-Based Architecture Evolution
- Create milestone after each significant improvement
- Compare milestones to show risk reduction over time
- Use as evidence in compliance reviews (SOC 2, ISO 27001, HIPAA)

---

## Red Flags to Avoid

- "We deploy directly to production from developer machines." — Must have CI/CD with canary or blue/green, not YOLO deploys.
- "We use the root account for daily operations." — Root account should be locked; SSO roles for all human access.
- "Single-AZ is fine for production." — Any RDS, ECS, ElastiCache in production must be Multi-AZ.
- "Microservices means we split by technical layer (frontend/backend/DB)." — Split by business capability, not technical concern.
- "We don't need CloudTrail, it's expensive." — CloudTrail is required for security forensics, compliance, and root cause analysis. The cost is trivial vs the risk.
- "We use one AWS account for everything." — Blast radius, cost attribution, security boundaries all argue for account-per-environment at minimum.
- "Spot instances are unreliable for production." — Spot is reliable when you diversify instance types/AZs and implement graceful shutdown. Many companies run entire production fleets on Spot.
- "We'll add monitoring later." — Observability is not optional; design it in from day one. You cannot debug what you cannot observe.
- "FIFO SQS for everything." — FIFO queues have throughput limits and higher cost; only use where strict ordering or deduplication is required.
- "We just use the highest RDS instance size." — Oversizing is waste; right-size with Performance Insights and Compute Optimizer, then commit with RIs/Savings Plans.

---

## AWS Deep-Dive Articles

| Topic | Article |
|---|---|
| AWS overview & services map | [/aws](/aws) |
| Lambda, serverless, Step Functions | [/aws-lambda-serverless](/aws/lambda-serverless) |
| API Gateway, VPC, Route 53, ALB, CloudFront | [/aws-api-gateway-networking](/aws/api-gateway-networking) |
| IAM, SCPs, GuardDuty, KMS, Security Hub | [/aws-iam-security](/aws/iam-security) |
| EC2, ECS, EKS, Fargate, Spot, Graviton | [/aws-compute-containers](/aws/compute-containers) |
| S3, CloudFront CDN, EBS, EFS, Glacier | [/aws-storage-s3](/aws/storage-s3) |
| CI/CD, CodePipeline, CDK, IaC, AWS Backup | [/aws-cicd-devops](/aws/cicd-devops) |
| DynamoDB, RDS, Aurora, ElastiCache, Redshift | [/dynamodb-data-services](/aws/dynamodb-data-services) |
| Bedrock, SageMaker, AI/ML services | [/aws-ai-ml-services](/aws/ai-ml-services) |
