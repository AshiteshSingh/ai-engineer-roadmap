# AWS Cost Optimization

## The 30-Second Pitch
AWS bills are notoriously opaque—hundreds of line items, hidden data-transfer charges, and idle resources bleeding cash across dozens of services. Cost optimization is not a one-time event; it is a continuous engineering discipline. Done well, it routinely yields 30–60% reductions without touching architecture. The framework is simple: measure (Cost Explorer + CUR), eliminate waste (idle resources, orphaned snapshots, zombie NAT traffic), commit appropriately (Savings Plans for compute, RIs for databases), and engineer for frugality from day one (Spot, Graviton, VPC endpoints, S3 lifecycle). For a consulting engagement, AWS Cost Optimization is often the fastest path to visible ROI with a new client—show them a $50K/month savings in week one and you own the account.

Related: [AWS Architecture](/aws-architecture) — Cost Optimization pillar | [Lambda](/aws-lambda-serverless) — memory tuning | [Compute & Containers](/aws-compute-containers) — Spot, Graviton | [VPC & Networking](/aws-vpc-networking) — NAT Gateway costs | [Storage & S3](/aws-storage-s3) — S3 storage classes | [Databases](/aws-databases-rds) — Aurora I/O-Optimized | [DynamoDB](/dynamodb-data-services) — capacity modes | [IAM & Security](/aws-iam-security) — SCPs for cost guardrails | [CI/CD & DevOps](/aws-cicd-devops) — Terraform cost estimation | [Observability](/aws-observability) — CloudWatch cost management

---

## 1. EC2 Pricing Models — Know Every Option

### On-Demand

Billing: per second (Linux/Windows), 60-second minimum. Highest per-unit cost. No contract.

**Use for:** unpredictable workloads, dev/test, instances running < 1 month, anything you're not ready to commit to.

**Rule of thumb:** if a workload runs > 500 hours/month and will exist for > 12 months, you should be on a Savings Plan or RI, not On-Demand.

---

### Reserved Instances (RI)

| Payment Option | Discount vs On-Demand | Upfront Cost | Risk |
|---|---|---|---|
| All Upfront (1-year Standard) | up to 40% | 100% upfront | Highest lock-in |
| Partial Upfront (1-year Standard) | ~35% | ~50% upfront | Medium |
| No Upfront (1-year Standard) | ~30% | $0 upfront | Lowest lock-in |
| All Upfront (3-year Standard) | up to 72% | 100% upfront | Highest lock-in |
| Convertible RI (1-year) | up to 54% | varies | Can swap instance type/OS |
| Convertible RI (3-year) | up to 66% | varies | Most flexible term RI |

**Standard RI vs Convertible RI:**
- Standard: fixed instance type, OS, tenancy. Cannot modify. Can sell on RI Marketplace.
- Convertible: can exchange for different instance type, OS, or tenancy within the same or higher value. Cannot sell on RI Marketplace.

**Scope:**
- **Regional RI:** applies to any matching instance in the region (same family + OS). Automatically applies to instances in any AZ. No capacity reservation.
- **Zonal RI:** applies to a specific AZ only. Provides capacity reservation — you are guaranteed the instance will launch when needed.

**RI Marketplace:** sell unused Standard RIs to other AWS customers. Can recoup unused committed capacity when workloads change. Convertible RIs cannot be listed.

**When to buy RIs:** use RIs only when you know the exact instance type and AZ and need capacity reservation. For everything else, Savings Plans are simpler.

**RI coverage target:** aim for 70–80% of steady-state compute on RI/SP; keep 20–30% on Spot or On-Demand to absorb variability.

---

### Savings Plans

Three types. All require 1-year or 3-year commitment. Billed in $/hour.

| Type | Applies To | Max Discount | Flexibility |
|---|---|---|---|
| Compute Savings Plans | EC2 (any type/region/OS), Fargate, Lambda | up to 66% | Highest — works across all compute |
| EC2 Instance Savings Plans | EC2 specific family in one region | up to 72% | Lower — locked to instance family |
| SageMaker Savings Plans | SageMaker Training, Inference, Processing | up to 64% | SageMaker only |

**Savings Plans vs RIs:**
- Savings Plans are simpler: no instance-type matching, no AZ selection, no exchange process.
- Use **Compute Savings Plans as your default** commitment vehicle.
- Use **EC2 Instance Savings Plans** when you know you'll stay in a specific instance family in a specific region and want the extra 6% discount.
- Use **RIs** only when you specifically need capacity reservation (zonal RI) or when dealing with database instances (RDS, ElastiCache, Redshift have RIs, not Savings Plans).

**Finding recommendations:** Cost Explorer → Savings Plans → Recommendations tab. Shows hourly commitment, estimated savings, payback period. Start with the 1-year Compute SP recommendation.

**Savings Plans purchase cadence and sizing:**

Start conservative — it is better to under-commit and supplement with On-Demand than to over-commit and pay for unused commitment. A practical sizing method:

```
Step 1: Look at your lowest hourly compute spend over the past 3 months.
        This is your "safe floor" — you will almost certainly not go below this.
Step 2: Start with 80% of that floor as your initial Compute SP hourly commitment.
Step 3: Review monthly. If SP utilization > 95% for 4+ weeks, add more commitment.
Step 4: Never purchase > 90% of current floor in a single tranche.

Example:
  Lowest hourly On-Demand spend (90-day window): $2.40/hr
  Initial Compute SP purchase: 80% × $2.40 = $1.92/hr commitment (1-year, all upfront)
  Annual commitment cost: $1.92 × 8,760 hr × (1 - 0.34 discount) ≈ $11,100
  Annual On-Demand equivalent: $1.92 × 8,760 = $16,819
  Savings: ~$5,700/year on this tranche alone
```

**SP utilization monitoring:** create a Savings Plans Utilization Budget that alerts when utilization < 80%. Below 80% means you're paying for commitment you're not using — either workloads decreased, or you over-committed. Investigate before purchasing additional SPs.

---

### Spot Instances

Up to 90% discount on spare EC2 capacity. AWS can reclaim with a 2-minute warning.

**Interruption handling:**
- Poll IMDSv2 endpoint `http://169.254.169.254/latest/meta-data/spot/termination-time` every 5 seconds — when it returns a value, termination is ~2 minutes away.
- Or subscribe to EventBridge rule: source `aws.ec2`, detail-type `EC2 Spot Instance Interruption Warning`.
- On warning: checkpoint state to S3/EFS, drain connections, deregister from load balancer, complete the current unit of work if < 90 seconds remain.

**Instance diversification:** the key to Spot reliability. Run across 5–10 instance types in 2–3 AZs. Each unique pool has independent interruption probability. Diversification reduces effective interruption rate from ~5% to < 1%.

**Spot Fleet allocation strategies:**
| Strategy | Description | Best For |
|---|---|---|
| `lowestPrice` | Always launch from cheapest pool | Cost-sensitive, interruption-tolerant |
| `diversified` | Distribute evenly across pools | Steady-state batch workloads |
| `capacityOptimized` | Choose pools with most available capacity | ML training, latency-sensitive batch |
| `priceCapacityOptimized` | Balance price + capacity (default recommended) | Most production use cases |

**EC2 Auto Scaling mixed instances policy:** set On-Demand base (e.g., 2 instances) + On-Demand percentage (20%) + Spot percentage (80%). ASG handles diversification and replacement automatically.

**Best use cases:** batch processing, ML training, CI/CD build agents, stateless web-tier scale-out, dev/staging environments, video transcoding.

**Spot savings example — ML training cluster:**

```
10-node training cluster, c5.4xlarge (16 vCPU / 32 GB)

On-Demand:  $0.68/hr × 10 nodes = $6.80/hr
            Running 8 hr/day × 250 days/year = 2,000 hr/year
            Annual cost: $13,600

Spot (diversified c5.4xlarge + c5a.4xlarge + m5.4xlarge, ~80% On-Demand rate):
            ~$0.14/hr × 10 nodes = $1.40/hr (avg)
            Same 2,000 hr/year
            Annual cost: $2,800

Annual savings: $10,800 (79%)
Interruption buffer: add 15% time padding for checkpointing overhead
Effective annual cost including reruns: ~$3,200 vs $13,600 → still 76% savings
```

---

### Graviton (ARM64)

AWS-designed ARM64 processors. Available across most instance families.

| Generation | Instance Families | vs x86 Price/Performance |
|---|---|---|
| Graviton2 (2020) | m6g, c6g, r6g, t4g | ~20% better |
| Graviton3 (2022) | m7g, c7g, r7g | ~25% better (also Graviton3E for HPC) |
| Graviton4 (2024) | m8g, c8g, r8g | ~30% better |

Same instance size on Graviton3 is ~20% cheaper than equivalent x86. Combined with better performance, effective savings are 30–40% for compatible workloads.

**Compatibility:**
- Node.js 18+, Python 3.9+, Java 11+ (Corretto), Go 1.17+, Rust (native ARM64): full support.
- Native binaries (C extensions, custom compiled tools): must recompile for ARM64.
- Docker images: use multi-arch images (`linux/amd64,linux/arm64`) or ARM64-specific tags.

**Migration path:**
1. Update `Dockerfile` to use multi-arch base images (`FROM --platform=$BUILDPLATFORM python:3.12-slim`).
2. Set up `docker buildx` with `--platform linux/arm64` in CI.
3. Deploy to a Graviton instance alongside existing x86 instance.
4. Run integration tests; compare performance metrics.
5. Shift traffic via weighted target group.

See [Compute & Containers](/aws-compute-containers) for ECS/EKS Graviton node group configuration.

---

### Full Pricing Model Comparison

| Model | Discount vs On-Demand | Flexibility | Commitment | Best Use Case |
|---|---|---|---|---|
| On-Demand | 0% | Maximum | None | Dev/test, unpredictable, short-lived |
| EC2 Instance SP | up to 72% | Low (family/region) | 1 or 3 yr | Known instance family, high utilization |
| Compute SP | up to 66% | High (any EC2/Fargate/Lambda) | 1 or 3 yr | Default commitment vehicle |
| Standard RI | up to 72% | Low (exact type) | 1 or 3 yr | Need capacity reservation |
| Convertible RI | up to 66% | Medium (exchange allowed) | 1 or 3 yr | Planned instance family migrations |
| Spot | up to 90% | High | None | Fault-tolerant, interruptible workloads |
| Graviton | ~20% cheaper | Normal (any commitment) | Same as above | All compatible workloads |

---

## 2. Compute Optimizer & Right-Sizing

**AWS Compute Optimizer** applies ML models to 14 days of CloudWatch utilization metrics and generates recommendations for: EC2, ECS Fargate tasks, Lambda, EBS volumes, Auto Scaling Groups.

Typical findings: 20–40% of EC2 instances are over-provisioned by at least 2× on CPU.

**EC2 right-sizing process:**
1. Open Compute Optimizer → EC2 Instances → filter by "Over-provisioned".
2. Check p99 CPU utilization over 14 days. If p99 < 20%, the instance is a right-sizing candidate.
3. Check memory utilization (requires CloudWatch agent with `mem_used_percent` custom metric — Compute Optimizer needs this data).
4. Review recommendation: Compute Optimizer shows projected CPU/memory utilization on recommended instance.
5. For burstable instances (t3/t4g): check `CPUSurplusCreditsCharged` metric — if non-zero, the instance is undersized; if CPU credit balance is always > 50%, instance is oversized.

**Lambda power tuning:**
- Lambda charges: (requests × $0.20/M) + (GB-seconds × $0.0000166667).
- Lower memory = cheaper per GB-second but longer duration = more GB-seconds total. The optimal is rarely the minimum.
- Tool: [AWS Lambda Power Tuning](https://github.com/alexcasalboni/aws-lambda-power-tuning) — open-source Step Functions workflow that tests your function at 10+ memory settings and plots cost vs performance curve.
- Common finding: 512 MB → 1024 MB doubles memory cost but halves duration, resulting in same GB-second total but 2× faster. Worth it for user-facing functions; 512 MB may be better for async batch.
- Also: Graviton2 (arm64) Lambda is 20% cheaper per GB-second than x86.

See [Lambda](/aws-lambda-serverless) for full Lambda cost optimization coverage.

**Lambda power tuning worked example:**

```
Function: image thumbnail generator
Invocations: 10M/month
x86 at 256 MB, avg duration 2,400 ms:
  GB-seconds: 10M × 2.4s × 0.25 GB = 6M GB-s
  Cost: 6M × $0.0000166667 = $100.00 + $2.00 requests = $102.00

x86 at 1024 MB, avg duration 600 ms (4× faster due to more CPU):
  GB-seconds: 10M × 0.6s × 1.0 GB = 6M GB-s
  Cost: $100.00 + $2.00 = $102.00 (identical — parallelism win)

arm64 at 1024 MB (20% discount on duration):
  Cost: 6M × $0.0000133334 = $80.00 + $2.00 = $82.00

Savings from arm64 alone: $20/month (20%) — no architecture change required.
```

**ECS Fargate right-sizing:**
- Compute Optimizer shows vCPU + memory utilization vs configured task definition.
- Target: set task CPU/memory to 120% of p99 utilization to leave headroom.
- Fargate pricing is per vCPU-hour + per GB-hour. Over-provisioning 4× the needed memory is a common and expensive mistake.
- Example: task using 0.25 vCPU / 0.5 GB configured as 1 vCPU / 2 GB → 4× overpay on memory, 4× overpay on vCPU.

**Right-sizing ROI formula:**

```
Monthly savings = sum over all instances of:
  (current_instance_hourly_cost - recommended_instance_hourly_cost) × hours_running

Example fleet: 50 × m5.2xlarge ($0.384/hr) running 24/7
  Compute Optimizer recommends: m5.xlarge ($0.192/hr) for 35 instances
  Savings: 35 × ($0.384 - $0.192) × 730 hr = $4,910/month
  Annual: $58,920
  Work effort: 2 days to validate + deploy via rolling update
  ROI: ~$29K/engineer-day
```

**Auto Scaling Group recommendations:** Compute Optimizer also analyzes ASGs. It may recommend a smaller instance type and/or different max/min scaling boundaries. Common finding: max capacity set to 20× normal load "just in case" — actual peak was 3× over 14 days — recommendation lowers max, reducing peak billing exposure.

---

## 3. Storage Cost Optimization

### S3 Storage Classes — Full Comparison

| Storage Class | $/GB/month | Min Duration | Retrieval Cost | Retrieval Latency | Availability |
|---|---|---|---|---|---|
| S3 Standard | $0.023 | None | None | Milliseconds | 99.99% |
| S3 Intelligent-Tiering | $0.023 (frequent) / $0.0125 (infrequent) / $0.004 (archive instant) | None | None (monitoring fee $0.0025/1K objects) | Milliseconds | 99.9% |
| S3 Standard-IA | $0.0125 | 30 days | $0.01/GB | Milliseconds | 99.9% |
| S3 One Zone-IA | $0.01 | 30 days | $0.01/GB | Milliseconds | 99.5% (single AZ) |
| S3 Glacier Instant Retrieval | $0.004 | 90 days | $0.03/GB | Milliseconds | 99.9% |
| S3 Glacier Flexible Retrieval | $0.0036 | 90 days | $0.01/GB (std, 3–5 hr) | Minutes to hours | 99.99% |
| S3 Glacier Deep Archive | $0.00099 | 180 days | $0.02/GB (std, 12 hr) | 12–48 hours | 99.99% |

**Key decision rules:**
- Objects accessed < once/month but > once/quarter → Standard-IA
- Objects accessed < once/quarter → Glacier Instant Retrieval (still millisecond access)
- Archives, compliance data, DR backups accessed rarely → Glacier Deep Archive ($0.001/GB is near-zero cost)
- Access patterns unknown or unpredictable → Intelligent-Tiering

**S3 Intelligent-Tiering mechanics:**
- Automatically moves objects between Frequent Access and Infrequent Access tiers based on 30-day rolling access window.
- Optional: enable Archive Instant Access tier (objects not accessed 90+ days), Deep Archive tier (180+ days).
- Monitoring fee: $0.0025 per 1,000 objects/month. Break-even vs Standard: objects > 128 KB, stored > 30 days with variable access.
- No retrieval fees for IA tier. This is the key differentiator vs Standard-IA.
- Best for: data lake objects, user uploads, ML training datasets with unpredictable reuse.

**S3 lifecycle policies — recommended baseline:**

```
Standard → Standard-IA: after 30 days
Standard-IA → Glacier Instant Retrieval: after 90 days
Glacier IR → Glacier Deep Archive: after 180 days
Non-current versions → delete: after 90 days
Incomplete multipart uploads → abort: after 7 days  ← silent cost driver
```

**S3 cost drivers (ranked by surprise factor):**
1. **Incomplete multipart uploads:** large files uploaded in parts that never completed. Still charged for stored parts. Create a lifecycle rule `AbortIncompleteMultipartUpload` after 7 days. This is free to fix and often worth $50–500/month on active data platforms.
2. **Request costs:** GET requests at $0.0004/1K, PUT/COPY/POST at $0.005/1K. A data pipeline doing 10M GETs/day = $4/day = $1,460/year. Cache aggressively.
3. **Data retrieval from IA/Glacier:** $0.01–$0.03/GB for retrievals. Unexpected access to archived data can generate large retrieval bills. Tag data with expected retrieval frequency.
4. **Cross-region replication:** charged as PUT + data transfer. S3 replication into another region = $0.02+/GB outbound.
5. **S3 Object Lambda:** additional compute charge on top of normal S3 costs.

---

### EBS Right-Sizing

**gp3 vs gp2 — migrate immediately:**

| Volume Type | Price | Baseline IOPS | Max IOPS | Max Throughput |
|---|---|---|---|---|
| gp2 | $0.10/GB/month | 3 IOPS/GB (min 100) | 16,000 | 250 MB/s |
| gp3 | $0.08/GB/month | 3,000 (flat baseline) | 16,000 (+$0.005/IOPS) | 1,000 MB/s (+$0.04/MB/s) |

gp3 is **20% cheaper** than gp2 at the same size, with a higher baseline IOPS (3,000 vs size-dependent). For a 100 GB gp2 volume: $10/month vs $8/month. At 1,000 GB: $100/month vs $80/month. No downtime required to change volume type.

**Idle EBS volumes:** volumes attached to stopped instances still accrue full gp3/gp2 charges. An idle 500 GB gp3 volume = $40/month. Policy: snapshot + delete when instance is stopped > 7 days.

**EBS Snapshot management:**
- Use AWS Data Lifecycle Manager (DLM) policies to create automated snapshot schedules and retention rules.
- Cross-region snapshot copy for DR: charged at destination region storage rates.
- Orphaned snapshots (source volume deleted): still billed. Run quarterly cleanup with a Lambda or AWS Config rule to identify snapshots with no associated volume.
- Snapshot pricing: $0.05/GB/month (incremental after first snapshot).

---

## 4. Network Cost Optimization

Network data transfer is the most commonly overlooked cost category. It does not appear on Compute Optimizer and requires manual analysis.

**Data transfer pricing tiers:**

| Traffic Type | Cost |
|---|---|
| Within same AZ (same EC2 instance IP) | Free |
| Cross-AZ (same region) | $0.01/GB **each direction** ($0.02/GB round-trip) |
| Cross-region | $0.02–$0.09/GB (varies by region pair) |
| Internet egress (EC2/ALB → internet) | $0.09/GB first 10 TB, $0.085 next 40 TB |
| CloudFront → internet | $0.0085–$0.02/GB (tiered by region) |
| VPC Endpoint (S3/DynamoDB gateway) | Free |
| NAT Gateway data processing | $0.045/GB |
| NAT Gateway hourly | $0.045/hr ($32.40/month per AZ) |

**The NAT Gateway trap:** a service making 10 TB/month of outbound calls to S3 or DynamoDB through a NAT Gateway incurs:
- NAT data processing: 10,000 GB × $0.045 = **$450/month**
- Fix: create VPC Gateway Endpoints for S3 and DynamoDB (free). Traffic routes within AWS backbone, bypasses NAT Gateway entirely.

**NAT Gateway savings formula:**
```
Monthly savings = monthly_GB_to_S3_or_DDB × $0.045
Example: 10 TB/month × 1,024 GB/TB × $0.045/GB = $460.80/month saved
Annual: $5,530
```
VPC Gateway Endpoints take 5 minutes to create and require no code changes — update route tables only.

**Traffic engineering for cost:**
- Place RDS read replicas in the **same AZ** as the primary compute fleet to eliminate cross-AZ read traffic.
- Use ElastiCache (same AZ or same region) to cache DynamoDB/RDS results — prevents repeated cross-AZ DB traffic.
- Co-locate microservices that call each other heavily in the same AZ. Accept the single-AZ risk for non-critical internal services, or factor cross-AZ cost into the HA decision.
- For Lambda calling S3/DynamoDB heavily: VPC Lambda with Gateway Endpoints, or non-VPC Lambda (which routes via internet-facing endpoints — no cross-AZ charge but no VPC control).

**CloudFront for egress cost reduction:**

```
Without CloudFront (EC2 → internet):
  100 TB/month × 1,024 GB × $0.085/GB = $8,704/month

With CloudFront (EC2 → CloudFront origin, CloudFront → internet):
  Origin fetch (cache miss): 20 TB × $0.0080/GB (Origin Shield) = $163.84
  Edge delivery: 100 TB × $0.0085/GB = $870.40
  Total: ~$1,034/month

Savings: $7,670/month (88%)
Cache hit rate assumption: 80%
```

**Cost analysis workflow:** enable VPC Flow Logs → deliver to S3 → create Athena table → query top source/destination pairs by byte count. Identify the top 5 cross-AZ communication patterns and co-locate or cache.

**VPC Interface Endpoints for additional services:** Gateway Endpoints cover only S3 and DynamoDB. For other services that generate high NAT traffic, create Interface Endpoints (charged at $0.01/hr/AZ + $0.01/GB processed). Break-even vs NAT Gateway: if a service generates > 35 GB/month through NAT, an Interface Endpoint saves money on data processing ($0.01/GB endpoint vs $0.045/GB NAT). Common candidates: SSM, Secrets Manager, ECR, SQS, SNS, Lambda, CloudWatch.

```
Interface Endpoint cost: $0.01/hr × 2 AZs × 730 hr = $14.60/month base
                       + $0.01/GB × data volume
NAT Gateway cost:        $0.045/GB × data volume

Break-even: $14.60 = ($0.045 - $0.01) × GB → 417 GB/month to break even per endpoint
If your SSM/Secrets Manager traffic > 417 GB/month: Interface Endpoint wins
If < 417 GB/month: keep using NAT Gateway for those services
```

See [VPC & Networking](/aws-vpc-networking) for full VPC endpoint and NAT Gateway architecture.

---

## 5. Database Cost Optimization

### Aurora

**Aurora I/O-Optimized pricing mode** (available for Aurora MySQL and PostgreSQL):
- Standard mode: $0.20/M I/O requests + $0.10/GB storage/month.
- I/O-Optimized mode: ~2.4× higher storage rate (~$0.225/GB/month) but **no per-I/O charge**.
- Break-even point: when I/O cost > 25% of total cluster cost, I/O-Optimized is cheaper.
- Check in Cost Explorer: Aurora I/O cost as % of total Aurora cost. If > 25%, switch to I/O-Optimized.
- Switch requires a brief cluster modification (no downtime for Multi-AZ). Takes effect within minutes.

**Aurora I/O-Optimized worked example:**

```
Aurora PostgreSQL cluster: db.r6g.2xlarge, 1 TB storage, us-east-1

Standard mode monthly cost:
  Instance: $0.52/hr × 2 (primary + replica) × 730 hr = $759.20
  Storage:  1,000 GB × $0.10/GB = $100.00
  I/O:      500M requests × $0.20/M = $100.00
  Total: $959.20
  I/O as % of total: 10.4% → stay on Standard mode

Scenario 2: write-heavy OLTP with 5B I/O requests/month
  I/O: 5,000M × $0.20/M = $1,000.00
  Total Standard: $759.20 + $100.00 + $1,000.00 = $1,859.20
  I/O as % of total: 53.8% → switch to I/O-Optimized

I/O-Optimized mode (same cluster):
  Instance: $759.20 (same)
  Storage:  1,000 GB × $0.225/GB = $225.00
  I/O:      FREE
  Total: $984.20

Savings: $1,859.20 - $984.20 = $875/month (47%)
Break-even I/O ratio: I/O cost > 25% of cluster total → switch
```

**Aurora Serverless v2:** scales in 0.5 ACU increments. Min 0.5 ACU. Good for variable workloads with predictable peaks. Cheaper than provisioned for low-utilization environments. Use provisioned instances for steady high-throughput — Serverless v2 is more expensive per ACU than equivalent provisioned instance at full utilization.

See [Databases](/aws-databases-rds) for Aurora architecture and configuration depth.

---

### DynamoDB Capacity Mode Selection

| Mode | Pricing | Idle Cost | Best For |
|---|---|---|---|
| On-Demand | $1.25/M WCU, $0.25/M RCU | Near-zero (storage only) | New tables, unpredictable traffic |
| Provisioned + Auto Scaling | $0.00065/WCU-hr, $0.00013/RCU-hr | Full provisioned cost even at 0 RPS | Steady, predictable traffic patterns |

**On-Demand vs Provisioned cost comparison (per million requests):**
- On-Demand write: 1M WCU = **$1.25**
- Provisioned write at 1,000 WCU sustained = 1,000 × $0.00065/hr × 730 hr/month = $474.50/month serving ~2.3B writes/month = **$0.21/M writes**

On-Demand is ~6× more expensive per request than provisioned at sustained load. The break-even is roughly when your provisioned capacity utilization stays above ~20% on average.

**Decision rule:**
1. Traffic < 10 RPS average or highly spiky → On-Demand.
2. Traffic > 10 RPS with predictable patterns → Provisioned + Auto Scaling.
3. Traffic > 100 RPS steady → Provisioned with right-sized capacity.

Auto Scaling target utilization: 70% — leaves 30% headroom for spikes while avoiding over-provisioning.

See [DynamoDB](/dynamodb-data-services) for full capacity planning and data modeling.

---

### ElastiCache

**Serverless vs provisioned:**
- ElastiCache Serverless: $0.00034/ECPU + $0.125/GB/hr storage. Auto-scales. Good for < 1,000 requests/second or sporadic workloads.
- Provisioned cluster (cache.r7g.large): ~$0.166/hr = $121/month. Handles 100K+ ops/sec.
- Break-even: above ~1,500–2,000 ECPU/sec sustained, provisioned is cheaper.

**RDS Reserved Instances:** commit to 1-year RIs for production databases. Typical savings: 40–60%. RDS Multi-AZ RI covers both primary and standby. Pay for the RI on one instance; the standby is covered automatically.

---

## 6. Tagging Strategy & Cost Allocation

Tagging is infrastructure. Without it, you cannot do chargeback, show-back, or enforce per-team budgets.

**Mandatory tag set:**

| Tag Key | Example Values | Purpose |
|---|---|---|
| `Environment` | `prod`, `staging`, `dev` | Separate production costs from lower environments |
| `Project` | `payments-api`, `data-platform` | Per-project cost tracking |
| `Owner` | `team-platform`, `team-data` | Chargeback target |
| `CostCenter` | `CC-1042`, `CC-2031` | Finance integration |
| `Service` | `checkout-service`, `image-resizer` | Microservice-level granularity |
| `ManagedBy` | `terraform`, `cdk`, `console` | Identifies unmanaged resources (console resources = drift risk) |

**Activation:** tags must be activated in the AWS Billing console (Cost Allocation Tags page) before they appear in Cost Explorer dimensions. Up to 500 user-defined tags can be activated.

**Enforcement options (pick at least two):**

1. **AWS Config rule `required-tags`:** flags resources missing mandatory tags. Set up auto-remediation (Lambda) to notify the owner or apply default tags.
2. **SCP (Service Control Policy):** in AWS Organizations, write an SCP that denies `ec2:RunInstances`, `rds:CreateDBInstance`, `lambda:CreateFunction`, etc., unless the mandatory tags are present. This is the strongest enforcement mechanism — blocks creation, not just flags.
3. **IaC policy-as-code:** use Checkov, OPA, or CDK Aspects to validate tags in pull requests before deployment reaches AWS.
4. **Tag Editor bulk update:** for existing untagged resources, use Tag Editor to bulk-apply tags across a resource type.

**Show-back vs chargeback:**
- **Show-back:** report costs to teams without financial transfer. Lower friction, faster adoption.
- **Chargeback:** actual cost allocation to team budgets/GL codes. Requires mature tagging and Finance buy-in.
- Start with show-back; move to chargeback after 3+ months of clean tagging data.

**Cost Explorer filters:** once tags are activated, filter by tag in Cost Explorer to produce per-team, per-project, or per-environment cost reports. Export to CSV monthly for team distribution.

See [IAM & Security](/aws-iam-security) for SCP structure and AWS Organizations management.

---

## 7. Cost Management Tools

### AWS Cost Explorer

- Visualization of costs by service, linked account, usage type, tag, AZ, API operation.
- **Cost Anomaly Detection:** ML-based; creates monitors for individual services or linked accounts; sends SNS alerts when spend deviates from expected. Catches surprise bills (runaway Lambda, forgotten EC2) within hours.
- **Forecasting:** 12-month projection based on historical trends. Confidence interval shown. Useful for budget planning and board decks.
- **Granularity:** hourly data available for 14 days. Daily/monthly for 13 months. For longer retention, use CUR.
- **Savings Plans and RI recommendations:** dedicated tabs show purchase recommendations with payback period and estimated savings. Start here before any commitment purchase.

---

### AWS Budgets

Four budget types:

| Type | What It Tracks | Alert On |
|---|---|---|
| Cost | $ spend | Actual or forecasted exceeds threshold |
| Usage | Resource usage (GB, hours, requests) | Actual or forecasted exceeds threshold |
| Reservation Coverage | % of usage covered by RIs | Coverage drops below threshold (e.g., < 70%) |
| Savings Plans Utilization | % of Savings Plans commitment used | Utilization drops below threshold (e.g., < 80%) |

**Budget actions:** when a threshold is crossed, Budgets can automatically:
- Apply an IAM policy (deny expensive resource creation)
- Apply an SCP (organization-wide restriction)
- Stop specific EC2 or RDS instances

This enables automated spend guardrails without manual intervention.

**Recommended baseline budgets:**
- Monthly cost budget per account/team with 80% forecasted alert + 100% actual alert.
- RI coverage budget: alert when coverage < 70%.
- SP utilization budget: alert when utilization < 80% (paying for commitment you're not using).

---

### AWS Cost and Usage Report (CUR)

The most granular billing data available. Every resource, every hour, with all attributes.

**Contents:** resource ID, usage type, usage amount, blended and unblended cost, amortized RI/SP cost (distributes upfront commitment cost evenly over the term), tags, AZ, region, line item type.

**Setup:**
1. Billing → Cost and Usage Reports → Create report.
2. Choose Parquet format (columnar — much faster for Athena queries than CSV).
3. Deliver to S3 bucket.
4. Create Athena table via Glue crawler or the CloudFormation template AWS provides.
5. Query with Athena; visualize in QuickSight.

**Useful CUR queries:**

```sql
-- Top 10 most expensive resource IDs this month
SELECT line_item_resource_id, SUM(line_item_unblended_cost) AS total_cost
FROM cur_report
WHERE month = '2026-03'
  AND line_item_line_item_type = 'Usage'
GROUP BY 1
ORDER BY 2 DESC
LIMIT 10;

-- NAT Gateway data processing cost
SELECT SUM(line_item_unblended_cost) AS nat_cost
FROM cur_report
WHERE product_product_name = 'Amazon Virtual Private Cloud'
  AND line_item_usage_type LIKE '%NatGateway-Bytes%';
```

**CUR vs Cost Explorer:** CUR is the source of truth. Cost Explorer is the UI layer on top of a summarized version. For forensics and anomaly root cause, always go to CUR.

---

### AWS Trusted Advisor

Cost optimization checks (available with Business or Enterprise support):

| Check | What It Finds |
|---|---|
| Low Utilization EC2 Instances | CPU < 10% over 14 days |
| Idle RDS DB Instances | No connections in 7 days |
| Idle Load Balancers | No requests in 7 days |
| Underutilized EBS Volumes | < 1 IOPS/day for 7 days |
| Unassociated Elastic IPs | EIP not attached to a running instance ($0.005/hr wasted) |
| Underutilized Redshift Clusters | < 5% cluster CPU over 7 days |
| Amazon RDS Reserved Instance Optimization | RDS instances not covered by RIs |

Free tier: 7 core checks (subset of cost + security). Business/Enterprise support: all 115+ checks + API access (use with EventBridge for automated remediation).

---

### CloudWatch Cost Management

CloudWatch is itself a non-trivial cost driver, especially in large-scale or log-heavy environments. See [Observability](/aws-observability) for full CloudWatch architecture.

**CloudWatch pricing components:**

| Component | Cost |
|---|---|
| Custom metrics | $0.30/metric/month (first 10K), $0.09/metric beyond |
| Log ingestion | $0.50/GB |
| Log storage | $0.03/GB/month |
| Log Insights queries | $0.005/GB scanned |
| Detailed monitoring (EC2) | $3.50/instance/month |
| Dashboard | $3.00/dashboard/month |
| Contributor Insights rules | $0.50/rule/month + $0.02/M events |

**Common CloudWatch cost traps:**
1. **Log verbosity:** `DEBUG` logging to CloudWatch Logs in production. A single Lambda writing 1 KB/invocation at 10M invocations/day = 10 GB/day = 300 GB/month = **$150/month** in ingestion alone. Set production log level to `INFO` or `WARN`.
2. **Log retention not set:** CloudWatch Logs keeps logs indefinitely by default. Set retention policies (e.g., 30 days for application logs, 90 days for audit logs). Storage at $0.03/GB accumulates on old log groups from retired services.
3. **Custom metrics at scale:** 10,000 custom metrics from a microservice fleet = $3,000/month. Use EMF (Embedded Metrics Format) to batch metrics into log lines — ingested as metrics at log cost ($0.50/GB), not metrics cost ($0.30/metric).
4. **Log Insights cold queries:** scanning 1 TB of logs for a single ad-hoc query = $5.00. Use log subscriptions to filter and forward only relevant logs to a lower-cost S3+Athena stack for historical queries.

**Cost reduction:**
- Export logs older than 30 days to S3 (log group export) + delete from CloudWatch. Query with Athena instead of Log Insights.
- Use structured JSON logging + EMF for metrics — keeps costs in the log ingestion tier.
- Aggregate per-instance metrics into fleet-level metrics before sending to CloudWatch (reduces metric count).

---

## 8. FinOps Maturity Model for AWS

### Crawl (Month 1–2)
- Enable Cost Explorer and navigate to the top 5 cost-driving services.
- Create at least 3 AWS Budgets: total account, per-service (EC2, RDS), anomaly detection.
- Activate cost allocation tags in Billing console. Define mandatory tag set (6 tags minimum).
- Identify idle resources: Trusted Advisor checks + manual review of stopped EC2 with attached EBS.
- Quick wins: delete unused EIPs, abort incomplete multipart uploads, migrate gp2 → gp3.

### Walk (Month 3–6)
- Implement RI/Savings Plans purchase strategy based on Cost Explorer recommendations.
- Right-size top 10 EC2 instances using Compute Optimizer + 14-day CloudWatch data.
- Implement S3 lifecycle policies on all buckets with data > 1 month old.
- Create VPC Gateway Endpoints for S3 and DynamoDB in all VPCs.
- Enable Cost Anomaly Detection monitors for all services and linked accounts.
- Tag compliance: achieve > 90% coverage for mandatory tags (measure in Cost Explorer by filtering on `aws:Resource` with missing tags).

### Run (Month 6+)
- Full tagging compliance enforced via SCP (block untagged resource creation).
- Chargeback to teams: monthly cost reports per team delivered automatically.
- Automated right-sizing: weekly Compute Optimizer export → Jira tickets for team action.
- Spot usage > 20% of total EC2 compute spend.
- Graviton adoption > 50% of eligible workloads.
- Unit economics dashboard: cost per API request, cost per job, cost per active user — tracked weekly.
- Quarterly FinOps review: leadership presentation with trend, savings achieved, next quarter targets.

### Quick-Win Priority Matrix

When starting a cost optimization engagement, triage by effort vs impact:

| Action | Effort | Typical Monthly Savings | Risk |
|---|---|---|---|
| gp2 → gp3 migration | 30 min | 20% of EBS bill | Near-zero (no downtime) |
| VPC Gateway Endpoints | 30 min | $0.045 × NAT traffic to S3/DDB | None |
| Abort incomplete multipart uploads | 15 min | Varies (check CUR) | None |
| Delete unattached EIPs | 15 min | $0.005/hr × count | None |
| Set CloudWatch log retention | 1 hr | $0.03/GB × stale log GB | None |
| Compute Savings Plans purchase | 1 hr | 30–66% of covered compute | Lock-in risk |
| Lambda arm64 migration | 1 day | 20% of Lambda duration cost | Recompile native deps |
| EC2 Graviton migration | 2–3 days | 20% of instance cost | Test arm64 compat |
| Right-size top 10 EC2 | 2–3 days | 10–40% of EC2 bill | Capacity risk if too small |
| Spot for batch/training | 1 week | 60–90% of batch compute | Interruption handling required |
| Full tagging + chargeback | 2–4 weeks | Enables future optimization | Organizational change mgmt |

Rule: always attack the top three "Near-zero risk" items in week one. They are essentially free money and build trust with the client.

---

## 9. Multi-Service Cost Calculator Scenarios

### Scenario 1: Serverless API (API Gateway + Lambda + DynamoDB)

Architecture: API Gateway HTTP API → Lambda (512 MB, 200 ms avg, 1M requests/day) → DynamoDB (1 WCU + 1 RCU per request, provisioned + auto-scaling)

```
Monthly requests: 30M

API Gateway HTTP API:
  30M × $1.00/M requests = $30.00

Lambda:
  Requests: 30M × $0.20/M = $6.00
  Duration: 30M × 0.2s × 512 MB/1024 × $0.0000166667/GB-s
           = 30M × 0.2 × 0.5 × $0.0000166667
           = $50.00
  Lambda total: $56.00

DynamoDB (provisioned at 700 WCU / 350 RCU, 70% target util):
  WCU: 700 × $0.00065/hr × 730 = $332.15/month
  RCU: 350 × $0.00013/hr × 730 = $33.22/month
  Storage: 50 GB × $0.25 = $12.50
  DynamoDB total: $377.87

Total: ~$464/month ($0.015 per 1,000 requests)

Optimization lever: switch Lambda to arm64 → save 20% on duration = -$10/month
Optimization lever: DynamoDB DAX cache (if read-heavy) → reduce RCU 80% = -$26/month
```

---

### Scenario 2: Containerized Service (ECS Fargate + ALB + Aurora Serverless v2)

Architecture: ALB → ECS Fargate (2 vCPU / 4 GB, 5 tasks average, 24/7) → Aurora Serverless v2 (min 0.5 ACU, max 32 ACU)

```
ECS Fargate (us-east-1):
  vCPU: 5 tasks × 2 vCPU × $0.04048/vCPU-hr × 730 hr = $295.50
  Memory: 5 tasks × 4 GB × $0.004445/GB-hr × 730 hr = $64.88
  Fargate total: $360.38

  Graviton (arm64) saving: ~20% = -$72.08 → $288.30

ALB:
  $16.20/month (LCU charges ~$20)
  ALB total: ~$36/month

Aurora Serverless v2 (avg 4 ACU for normal load):
  ACU-hours: 4 ACU × $0.12/ACU-hr × 730 = $350.40
  Storage: 100 GB × $0.10 = $10.00
  Aurora total: $360.40

Total (x86): ~$756/month
Total (Graviton): ~$684/month (9% savings)
With Aurora I/O-Optimized (high I/O workload): saves if I/O > 25% of DB cost

At 1K RPS with connection pooling (RDS Proxy): add $36/month for RDS Proxy
```

---

### Scenario 3: ML Training Pipeline (S3 + SageMaker + Step Functions)

Architecture: S3 (training data) → Step Functions → SageMaker Training Job (Spot) → S3 (model artifacts) → ECR (container image)

```
Training run: 4 hours, ml.p3.2xlarge (1× V100 GPU, 8 vCPU, 61 GB)

S3 storage (500 GB dataset + 10 GB model):
  Monthly: 510 GB × $0.023 = $11.73
  Data transfer to SageMaker (same region): free

SageMaker Training Job (On-Demand): $3.825/hr × 4 hr = $15.30/run
SageMaker Training Job (Spot):       $1.148/hr × 4 hr = $4.59/run (+15% buffer for interruptions)
                                     Effective: ~$5.28/run (76% savings)

Step Functions (Express Workflow):
  100 runs/month × $0.00001/state transition × 50 transitions = $0.05

ECR storage (10 GB image):
  $0.10/GB/month = $1.00

Cost per training run (Spot): ~$5.28
Cost per training run (On-Demand): $15.30
Monthly at 100 runs:
  On-Demand: $1,530 + $11.73 + $1.05 = $1,542.78
  Spot:        $528 + $11.73 + $1.05 = $540.78
  Savings:                             $1,002/month (65%)
```

---

## Interview Q&A

**Q: A team's AWS bill doubled last month. Walk me through how you'd investigate.**

A: Structured investigation in three phases. (1) **Triage in Cost Explorer:** switch to daily granularity, find the day the spike started. Filter by service — identify which service(s) drove the increase. If EC2 costs doubled, is it more instances or more hours on existing instances? (2) **Root cause in CUR:** write an Athena query on the CUR table filtering for the spike period and the offending service. Look at `line_item_resource_id` to find the specific resource. Check `line_item_usage_type` for surprises like `DataTransfer-Out-Bytes` or `NatGateway-Bytes`. (3) **Operational context:** correlate the spike date with deployment history (CodePipeline, CloudTrail API calls). Common culprits: Auto Scaling group launched 10× instances due to a bad metric alarm; new Lambda function running 24/7 instead of event-driven; S3 Intelligent-Tiering moved millions of objects back to frequent access; data transfer spiked due to a new cross-region sync job; Kinesis shard count doubled. Check CloudTrail for `RunInstances`, `CreateFunction`, `ModifyDBInstance` events around the spike date.

---

**Q: When would you use Savings Plans over Reserved Instances?**

A: Savings Plans should be your default commitment vehicle for EC2, Fargate, and Lambda. The reasons: (1) Compute Savings Plans apply across any instance type, region, and OS automatically — no need to predict exactly which instance family you'll use 12–36 months from now. (2) They also cover Fargate and Lambda, which RIs don't. (3) No exchange or marketplace process needed when workloads change. Use RIs instead of Savings Plans in two scenarios: (a) you need **capacity reservation** (zonal RI) — critical for regulated or high-availability workloads that can't tolerate launch failures; (b) for **database services** (RDS, ElastiCache, Redshift, OpenSearch) which have RIs but no Savings Plans.

---

**Q: Explain how to architect a workload to minimize data transfer costs.**

A: Four principles. (1) **Same-AZ co-location:** put RDS read replicas and ElastiCache nodes in the same AZ as the primary compute. Factor the cost: $0.01/GB each direction cross-AZ adds up to thousands per month at scale. (2) **VPC Gateway Endpoints:** free S3 and DynamoDB endpoints eliminate NAT Gateway data processing charges ($0.045/GB). Required in every VPC. (3) **CloudFront for egress:** shift internet delivery from EC2/ALB ($0.085/GB) to CloudFront ($0.0085/GB at edge) — 10× cheaper for cacheable content. (4) **Minimize cross-region traffic:** replicate data only when legally required for DR/compliance, not for convenience. Use S3 Transfer Acceleration only for inbound uploads from global users, not for internal transfers. Bonus: use VPC Interface Endpoints for services that support them (SQS, SNS, SSM, Secrets Manager) — eliminates NAT Gateway processing cost for those services.

---

**Q: How do you implement a tagging strategy at organizational scale?**

A: Three-layer approach. (1) **Define and document:** establish a mandatory tag taxonomy (6–8 tags minimum: Environment, Project, Owner, CostCenter, Service, ManagedBy). Publish to internal wiki. Agree on allowed values and formats. (2) **Enforce at the source:** IaC policy-as-code (Checkov in CI, CDK Aspects, Terraform `required_tags` variable validation) catches missing tags before they reach AWS. SCP in AWS Organizations blocks `RunInstances`, `CreateBucket`, `CreateFunction`, etc. without mandatory tags — this is the hard stop. (3) **Monitor and remediate:** AWS Config rule `required-tags` flags non-compliant existing resources. Monthly report from Cost Explorer shows untagged resource cost (filter: tag `Owner` is absent → shows spend without owner). The SCP approach is controversial because it can block developers; the pragmatic balance is to start with SCP warnings (SNS notification) before switching to hard deny, giving teams 30 days to remediate.

---

**Q: What is the AWS Well-Architected Cost Optimization pillar's key principle?**

A: **Adopt a consumption model — pay only for what you use, stop guessing capacity.** The five design principles: (1) implement cloud financial management (FinOps as a discipline); (2) adopt a consumption model (on-demand, Spot, serverless); (3) measure overall efficiency (unit economics: cost per business outcome); (4) stop spending money on undifferentiated heavy lifting (managed services over self-managed); (5) analyze and attribute expenditure (tagging + chargeback). The pillar explicitly frames cost as a team responsibility, not just a finance function. See [AWS Architecture](/aws-architecture) for full WAF coverage.

---

**Q: How do you decide when to switch from DynamoDB on-demand to provisioned capacity?**

A: The decision is purely mathematical. (1) Look at your actual RCU and WCU consumption in CloudWatch for the past 30 days — `ConsumedReadCapacityUnits` and `ConsumedWriteCapacityUnits`. (2) On-Demand costs $0.25/M RCU and $1.25/M WCU. Provisioned costs $0.00013/RCU-hr and $0.00065/WCU-hr. (3) At 1,000 RCU continuously for a month: On-Demand cost for 1,000 RCU × 3,600s × 730hr/month requests = prohibitive vs $95/month provisioned. The tipping point is roughly 1.5M reads/day or 300K writes/day — above that, provisioned is clearly cheaper. Use auto-scaling with 70% target utilization to handle daily traffic patterns. See [DynamoDB](/dynamodb-data-services) for full capacity planning.

---

**Q: What's the hidden cost many teams miss with NAT Gateways and how do you fix it?**

A: NAT Gateway data processing at $0.045/GB is charged on **every byte passing through**, including traffic from EC2/Lambda to S3 and DynamoDB — services with free VPC Gateway Endpoints. Many teams unknowingly route all their S3 and DynamoDB traffic through NAT Gateway because they haven't created Gateway Endpoints. A microservice making 10 TB/month of S3 calls through NAT Gateway pays $460/month that is entirely avoidable. The fix: create VPC Gateway Endpoints for `com.amazonaws.<region>.s3` and `com.amazonaws.<region>.dynamodb`, add them to the route tables for private subnets. Free, takes 5 minutes, no code changes required. Secondary hidden NAT cost: one NAT Gateway per AZ at $0.045/hr = $32/month/AZ. For three AZs: $97/month even with zero traffic. Consolidate to one NAT Gateway in dev/test environments (accept single-AZ risk).

---

**Q: How would you use Spot Instances for a production ML training workload safely?**

A: Five-part strategy. (1) **Checkpointing:** save model state to S3 every N steps (or every epoch). If interrupted, resume from last checkpoint. PyTorch and TensorFlow both support checkpoint callbacks. On a 2-minute warning, checkpoint immediately. (2) **Interruption handler:** poll the IMDSv2 metadata endpoint every 5 seconds; on `termination-time` response, trigger checkpoint + graceful shutdown. Or use EventBridge rule for `EC2 Spot Instance Interruption Warning` → Lambda → checkpoint trigger. (3) **Instance diversification:** use 5–10 instance types (p3.2xlarge, p3a.2xlarge, p3.8xlarge, g4dn.2xlarge, g5.2xlarge) across 2–3 AZs. The `capacityOptimized` or `priceCapacityOptimized` allocation strategy chooses pools with most available capacity, reducing interruption probability. (4) **Budget with interruption buffer:** training jobs interrupted and resumed typically add 10–20% wall-clock time. Factor this into SLA commitments, not cost — Spot savings far outweigh the time overhead. (5) **SageMaker managed Spot training:** SageMaker handles checkpointing and interruption recovery automatically. Enable with `use_spot_instances=True` + `max_wait` parameter. AWS manages all the interruption and resumption logic.

---

**Q: Explain S3 Intelligent-Tiering. When is it the right choice vs explicit lifecycle policies?**

A: S3 Intelligent-Tiering (S3 IT) automatically moves objects between Frequent Access ($0.023/GB), Infrequent Access ($0.0125/GB), Archive Instant Access ($0.004/GB), and Deep Archive ($0.00099/GB) tiers based on observed access patterns. It monitors access for each object independently and transitions after 30, 90, and 180 days of inactivity respectively. There are no retrieval fees for the IA tier, just a monitoring fee of $0.0025/1K objects/month. Use S3 IT when: access patterns are unknown or highly variable (ML training data, user uploads, analytics datasets), objects are > 128 KB (smaller objects don't save enough to offset the monitoring fee), and data is kept > 30 days. Use explicit lifecycle policies instead when: access patterns are predictable and uniform (logs that are accessed for 30 days then archived → lifecycle is more cost-efficient because you avoid the monitoring fee), objects are all small (< 128 KB), or you need specific class guarantees for compliance.

---

**Q: How do you enforce mandatory tagging without blocking developer productivity?**

A: Progressive enforcement with a grace period. Phase 1 (weeks 1–4): IaC linting only — Checkov/OPA in CI fails the PR if tags are missing. Zero AWS-side enforcement. Developers see failures in familiar tools. Phase 2 (weeks 5–8): AWS Config `required-tags` rule enabled; non-compliant resources generate SNS notifications to team Slack channels. No blocking. Phase 3 (month 3+): SCP applied to non-production accounts first. Developers have had two months to update their IaC. SCP denies resource creation without mandatory tags in dev/staging accounts. Phase 4 (month 4+): SCP applied to production accounts. Emergency exception process: any team can request a temporary tag exemption via Jira ticket (auto-approved, 7-day TTL) to handle incidents without being blocked. The key insight: block at the IaC layer, not at the AWS API layer, for 80% of cases. Most developers never run AWS CLI directly — their Terraform runs fail in CI before they even try to apply.

---

**Q: What does "unit economics" mean in cloud cost management and how do you measure it?**

A: Unit economics means measuring cost relative to a business outcome rather than in absolute dollars. Absolute AWS cost is meaningless without context — $100K/month is fine for a $10M ARR company and catastrophic for a $100K ARR startup. Unit metrics: **cost per API request** (total compute + DB cost ÷ monthly requests), **cost per active user** (total infrastructure ÷ MAU), **cost per transaction** (for e-commerce/fintech), **cost per model inference** (for ML services), **cost per GB processed** (for data platforms). To measure: tag all resources by service/project, export CUR to Athena, join with business metrics from your analytics DB or data warehouse. Build a QuickSight (or Grafana) dashboard showing unit cost trend over time — you want it declining as you scale (economics of scale) or staying flat at worst. The FinOps Foundation defines this as moving from "total cost" metrics to "unit cost" metrics as the mark of FinOps maturity.

---

## 10. Cost in IaC — Shift-Left Cost Awareness

Cost optimization that happens post-deployment is always harder than cost awareness built into the development workflow. See [CI/CD & DevOps](/aws-cicd-devops) for full IaC pipeline coverage.

### Infracost

Infracost is an open-source tool that generates cost estimates from Terraform plans before any infrastructure is deployed.

**How it works:**
1. Run `terraform plan -out=tfplan`
2. Run `infracost breakdown --path=tfplan`
3. Infracost queries the AWS pricing API and returns a per-resource cost breakdown with monthly totals.
4. Add to CI: `infracost diff` shows cost delta between current state and proposed change (PR-level cost impact).

**Example output:**

```
Project: aws_api_gateway + lambda + rds

Name                               Monthly Qty  Unit         Monthly Cost
──────────────────────────────────────────────────────────────────────────
aws_db_instance.main
  Database instance (db.r6g.2xlarge)   730    hours          $467.20
  Storage (gp3, 500 GB)                500    GB-months       $57.50
aws_lambda_function.api
  Requests                           10M      1M requests      $2.00
  Duration (512 MB, 200ms avg)       1M req   GB-seconds      $0.17
aws_nat_gateway.main
  NAT gateway                         730     hours            $32.85
  Data processed                       10     TB              $460.80  ← flag this

MONTHLY TOTAL: $1,020.52

PR comment: this change adds $312.40/month (+44%) vs current infrastructure.
```

Post `infracost diff` as a PR comment automatically. Engineers see cost impact before code merges. This catches expensive choices (forgotten NAT Gateway, oversized RDS instance) at the cheapest possible point — before they're deployed.

### CDK Aspects for Cost Enforcement

AWS CDK Aspects traverse the entire CDK construct tree and can enforce cost policies as code:

```typescript
// CDK Aspect: enforce gp3 on all EBS volumes
class EnforceGp3Volumes implements IAspect {
  visit(node: IConstruct) {
    if (node instanceof CfnVolume) {
      if (node.volumeType === 'gp2') {
        Annotations.of(node).addError(
          'gp2 volumes are not allowed. Use gp3 (20% cheaper).'
        );
      }
    }
  }
}

// CDK Aspect: require cost allocation tags on all taggable resources
class RequireCostTags implements IAspect {
  private requiredTags = ['Environment', 'Project', 'Owner', 'CostCenter'];
  visit(node: IConstruct) {
    if (Tags.isTaggable(node)) {
      for (const tag of this.requiredTags) {
        if (!node.tags.tagValues()[tag]) {
          Annotations.of(node).addError(`Missing required tag: ${tag}`);
        }
      }
    }
  }
}
```

Apply at the app level: `Aspects.of(app).add(new EnforceGp3Volumes())`. Failures surface as `cdk synth` errors — blocked before any CloudFormation deployment.

### Terraform Cost Policies (OPA/Conftest)

For Terraform-based organizations, use Open Policy Agent (OPA) with Conftest to enforce cost guardrails in CI:

```rego
# Deny non-Graviton instance families for production workloads
deny[msg] {
  resource := input.planned_values.root_module.resources[_]
  resource.type == "aws_instance"
  resource.values.tags.Environment == "prod"
  not startswith(resource.values.instance_type, "m7g")
  not startswith(resource.values.instance_type, "c7g")
  not startswith(resource.values.instance_type, "r7g")
  msg := sprintf("Production EC2 instance %v must use Graviton (m7g/c7g/r7g family)", [resource.address])
}
```

Run `conftest test tfplan.json` in CI before `terraform apply`. PRs that introduce non-Graviton instances or missing tags fail the pipeline with a clear error message.

---

## Red Flags to Avoid

- **"We don't need a tagging strategy yet — we'll add it later."** Tags cannot be retroactively applied to cost data. CUR data from untagged months is permanently unattributable. Start tagging on day one, enforce it on day 30.
- **"We're using On-Demand for everything because it's flexible."** Flexible is not a virtue — it's an excuse. Compute Savings Plans can be purchased in 30 minutes and immediately reduce bills 30–66% with zero architecture changes.
- **"Our cross-AZ traffic is fine, it's only $0.01/GB."** $0.01/GB × 100 TB/month round-trip = $2,048/month. At 1 PB/month (not unusual for data-intensive services): $20,480/month. Model your cross-AZ traffic before dismissing it.
- **"We have VPC endpoints for S3."** "Do you have them in all VPCs?" Almost always no. Missing Gateway Endpoints in a single VPC can cost hundreds per month. Audit all VPCs.
- **"Spot Instances are too unreliable for production."** Spot with proper diversification (5+ instance types, 3 AZs, `priceCapacityOptimized`) has > 99% uptime for batch workloads and works fine for stateless web tiers behind an ALB. The 90% cost reduction is not optional money.
- **"We use Compute Optimizer but haven't acted on any recommendations."** Compute Optimizer recommendations expire after 14 days as new metrics come in. Treat recommendations as Jira tickets with a 2-week SLA, not as a dashboard you glance at quarterly.
- **"We're on Savings Plans so costs are optimized."** Savings Plans cover the hourly rate for committed compute spend. They don't cover data transfer, S3 storage, Secrets Manager, CloudWatch, support fees, or database I/O — all of which can dwarf compute costs in data-heavy architectures.
- **"The DBA manages RDS costs, not us."** RDS I/O costs scale with your application's query patterns. Developers who write N+1 queries or miss indexes directly cause I/O overruns. Cost optimization is a full-stack responsibility.
- **"We delete EC2 instances when done."** EBS volumes attached to terminated instances are **not automatically deleted** unless you set `DeleteOnTermination: true` at launch. Check for orphaned volumes regularly — they accumulate silently at $0.08/GB/month.
- **"We snapshot for backup, that's enough."** Snapshots are incremental after the first, but if you never delete old snapshots, you pay for every historical incremental forever. Implement DLM retention policies (keep last 7 daily + 4 weekly + 12 monthly) and delete the rest.
