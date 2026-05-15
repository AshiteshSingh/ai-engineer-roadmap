# AWS Compute & Containers

## The 30-Second Pitch

AWS Compute & Containers is the layer of AWS that answers "where does my code run?" — spanning raw virtual machines (EC2), serverless functions ([Lambda](/aws/lambda-serverless)), managed containers (ECS/EKS/Fargate), and fully managed application hosting (App Runner). The core value proposition is a **spectrum of control vs. operational overhead**: EC2 gives you full OS control but requires patching; Fargate removes node management but limits customization; App Runner removes almost everything. An engineer choosing within this spectrum trades off latency-to-production, cost predictability, scaling granularity, and egress complexity. For a distributed systems or platform engineering interview, the expectation is to justify placement on that spectrum, understand the mechanics of auto scaling and load balancing, and reason about container networking, [IAM](/aws/iam-security) delegation, and deployment safety.

## How It Actually Works

### Mental Model: The Control Spectrum

```
More Control  <------------------------------------------------->  Less Control
EC2 (bare VM) | EC2 + ECS | ECS Fargate | App Runner | Lambda
              |           |             |            |
More Ops work | Node mgmt | No nodes    | No cluster | No infra
```

Every service uses EC2 hardware underneath. The higher you go, the more AWS handles:
- **EC2**: You manage OS, patches, capacity planning, auto-scaling groups
- **ECS on EC2**: AWS manages container placement; you still manage EC2 nodes
- **ECS Fargate / EKS Fargate**: AWS manages nodes entirely; you pay per vCPU-second
- **App Runner**: AWS manages load balancing, scaling, TLS, deployments
- **[Lambda](/aws/lambda-serverless)**: AWS manages everything except the function handler and 15-min limit

---

## 1. EC2 Fundamentals

### Instance Families

| Family Prefix | Optimized For | Key Use Cases |
|---|---|---|
| `c` (Compute) | vCPU-to-memory ratio ~2:1 | CPU-bound web servers, batch processing, gaming |
| `m` (General) | Balanced 1:4 vCPU:GiB | Most application servers, small databases |
| `r` (Memory) | High RAM (~8 GiB/vCPU) | In-memory caches (Redis), large JVM heaps, SAP HANA |
| `x` / `u` (Memory Extreme) | Massive RAM (up to 24 TB) | SAP, Oracle, in-memory databases at scale |
| `i` / `d` (Storage) | Local NVMe SSD | Cassandra, Elasticsearch, HDFS, temporal scratch |
| `p` / `g` (GPU) | NVIDIA GPUs | ML training (p4d = A100), inference (g5 = A10G) |
| `inf` (Inferentia) | AWS custom ML chip | Cost-efficient inference (~40% cheaper than g5) |
| `trn` (Trainium) | AWS custom training chip | Large model training (cheaper than p4 for NLP) |
| `hpc` | High-bandwidth networking | MPI workloads, CFD, molecular dynamics |
| `t` (Burstable) | CPU credits, baseline CPU | Dev/test, small web apps, infrequent spikes |

**Instance sizing convention**: `<family><generation>.<size>` — e.g., `m7g.2xlarge`
- Sizes: nano < micro < small < medium < large < xlarge < 2xl < 4xl < 8xl < 16xl < 32xl < metal
- `metal` = dedicated physical server, no hypervisor overhead, bare-metal access

**Generation matters**: Newer generations (7 vs 5) typically offer 10–20% better price-performance. Graviton3 (`g` suffix, e.g., `m7g`) is ARM64 and often 20–40% cheaper than equivalent x86.

### Pricing Models

| Model | Commitment | Discount vs On-Demand | Best For |
|---|---|---|---|
| **On-Demand** | None | 0% | Unpredictable, short bursts, prototyping |
| **Reserved (Standard)** | 1 or 3 yr, fixed family | Up to 72% | Steady-state baseline load |
| **Reserved (Convertible)** | 1 or 3 yr, flexible | Up to 66% | Steady-state with possible instance type changes |
| **Savings Plans (Compute)** | 1 or 3 yr, $/hr commitment | Up to 66% | Flexible — covers EC2, Fargate, Lambda automatically |
| **Savings Plans (EC2 Instance)** | 1 or 3 yr, specific family | Up to 72% | Committed to specific instance family per region |
| **Spot Instances** | None | Up to 90% | Fault-tolerant batch, stateless workers, ML training |
| **Dedicated Host** | On-demand or reserved | Varies | License compliance (BYOL), regulatory isolation |
| **Dedicated Instance** | On-demand | ~10% premium | Hardware isolation from other accounts |

**Spot interruption**: AWS gives a 2-minute warning via instance metadata event and an EventBridge event. You should checkpoint state, drain connections, and terminate gracefully. Spot interruption rates vary by AZ and instance type — choose instance types with `<5%` interruption frequency. See [Cost Optimization](/aws-cost-optimization) for Spot portfolio strategies and interruption-rate analysis.

**Savings Plans vs Reserved Instances**: Compute Savings Plans are the modern default — they apply automatically to EC2 (any region, family, size, OS), Fargate, and Lambda. No need to manage reservation inventory. EC2 Instance Savings Plans give the highest discount but lock you to a specific instance family in a specific region.

---

## 2. EC2 Lifecycle

### AMIs (Amazon Machine Images)

An AMI is a snapshot of an instance's root volume + launch permissions + block device mapping. It encodes: OS, pre-installed software, kernel parameters.

**Types**:
- **AWS-managed** (e.g., Amazon Linux 2023, Ubuntu 22.04): Maintained by AWS, regularly patched
- **Marketplace AMIs**: Third-party vendors; may have licensing costs per hour
- **Custom AMIs**: Golden images you bake with Packer; critical for fast Auto Scaling (pre-installed deps = faster boot)
- **EBS-backed vs Instance Store-backed**: EBS-backed is standard — root volume persists on stop (see [S3 & Storage](/aws/storage-s3) for EBS/EFS details). Instance store is ephemeral NVMe — fastest IOPS but data lost on stop/terminate.

**AMI lifecycle**: Build → Test → Share → Deprecate. Use EC2 Image Builder for automated, pipeline-based AMI creation with CIS hardening.

### User Data

Runs **once** at first boot (cloud-init). Used to bootstrap: install packages, pull config from S3/SSM Parameter Store, register with configuration management.

```bash
#!/bin/bash
# Runs as root on first launch
yum update -y
yum install -y amazon-cloudwatch-agent
/opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
  -a fetch-config -m ec2 -c ssm:/cloudwatch-config -s
```

For re-runs on every boot, use `/var/lib/cloud/scripts/per-boot/`. Max size: 16 KB plain text, 64 KB base64-encoded.

### Instance Metadata Service (IMDS)

A link-local HTTP endpoint (`169.254.169.254`) accessible only from inside the instance. Provides:
- Instance ID, type, AZ, region
- IAM role temporary credentials (`/latest/meta-data/iam/security-credentials/<role-name>`)
- User data (`/latest/user-data`)
- Network interfaces, public/private IPs

**IMDSv1 vs IMDSv2**:
- **v1**: Simple GET, no auth — vulnerable to SSRF attacks (if app can be tricked into fetching arbitrary URLs, attacker gets IAM credentials)
- **v2**: Requires a PUT to get a session token first, then pass token in header — mitigates SSRF. **Enforce v2 for all new instances via the account-level default setting.**

```bash
# IMDSv2 flow
TOKEN=$(curl -X PUT "http://169.254.169.254/latest/api/token" \
  -H "X-aws-ec2-metadata-token-ttl-seconds: 21600")
curl -H "X-aws-ec2-metadata-token: $TOKEN" \
  http://169.254.169.254/latest/meta-data/instance-id
```

### Placement Groups

Control how instances are distributed across underlying hardware:

| Type | Strategy | Use Case | Tradeoff |
|---|---|---|---|
| **Cluster** | All instances in same rack/AZ | Low-latency HPC, MPI, GPU training | Single AZ = no HA |
| **Spread** | Instances on distinct hardware | HA for small critical sets (max 7/AZ) | Can't launch many |
| **Partition** | Groups of instances on separate racks | Hadoop, Cassandra, Kafka (rack-aware) | Balance of HA + scale |

Cluster placement groups give **10 Gbps enhanced networking** between instances and sub-millisecond latency. Required for p4d (A100) GPU clusters.

### Dedicated Hosts

A physical server allocated to you. Use cases:
- **BYOL (Bring Your Own License)**: Windows Server, SQL Server, Oracle licenses bound to physical cores/sockets
- **Compliance**: Regulations requiring dedicated hardware
- **Host affinity**: Restart instances on the same physical host

Dedicated Hosts give full visibility into sockets and physical cores. You can share them within an AWS Organization via RAM (Resource Access Manager).

---

## 3. Auto Scaling

### Launch Templates vs Launch Configurations

| Feature | Launch Configuration | Launch Template |
|---|---|---|
| Status | Legacy, no new features | Current, recommended |
| Versioning | No versioning | Versioned (`$Default`, `$Latest`) |
| Spot + On-Demand mix | No | Yes (mixed instances policy) |
| T2/T3 unlimited | No | Yes |
| Multiple instance types | No | Yes |
| Metadata options (IMDSv2) | No | Yes |

**Always use Launch Templates.** They support multiple instance types and purchase options in a single ASG, enabling cost-optimized mixed fleets.

### Scaling Policies

**Target Tracking** (simplest, recommended for most cases):
- Define a metric target (e.g., `ASGAverageCPUUtilization = 50%`)
- ASG automatically adjusts capacity to maintain that target
- Handles scale-out and scale-in automatically; scale-in cooldown prevents thrashing

**Step Scaling** (fine-grained control):
- Define metric alarm thresholds with different step adjustments
- e.g., CPU 50–70% → add 1, CPU 70–90% → add 2, CPU >90% → add 4
- Requires managing CloudWatch alarms separately

**Simple Scaling** (legacy): Fires once per alarm breach, with a cooldown. Don't use — Step Scaling supersedes it.

**Scheduled Scaling**:
- Pre-scale for known traffic patterns: business hours, weekly spikes, marketing events
- Set `MinCapacity`/`MaxCapacity`/`DesiredCapacity` on a cron schedule
- Combine with predictive scaling (ML-based forecasting) for variable patterns

**Predictive Scaling** (ML-based):
- Analyzes past 14 days of traffic patterns
- Pre-scales before predicted load, not in reaction to it
- Best for recurring patterns (daily office-hours traffic)

### Lifecycle Hooks

Pause instance launch or termination to perform custom actions:

```
Launch: Pending → Pending:Wait → [your code runs] → Pending:Proceed → InService
Terminate: Terminating → Terminating:Wait → [your code runs] → Terminating:Proceed → Terminated
```

Common uses:
- **Launch hook**: Install agents, pull config, warm caches, register with service mesh
- **Terminate hook**: Drain connections, deregister from service discovery, flush logs to S3, complete in-flight requests

Notifications go to SNS or SQS, or you can call `complete-lifecycle-action` from within the instance. Timeout is 1 hour default (max 48 hours).

### Warm Pools

A pool of pre-initialized, stopped (or running) instances that can be promoted to InService in seconds instead of minutes:

- Instances boot, run user data, install software → stop → wait in warm pool
- On scale-out: warm pool instance resumes (30-60 seconds) vs cold launch (minutes)
- Cost: stopped instances cost only EBS; running warm pool instances cost full EC2 hourly rate
- Critical for applications with long initialization (JVM warmup, ML model loading)

---

## 4. Load Balancers

> For API Gateway, VPC networking, and Route 53 integration, see [API Gateway & Networking](/aws/api-gateway-networking).

### ALB vs NLB vs CLB

| Feature | ALB (Application) | NLB (Network) | CLB (Classic) |
|---|---|---|---|
| OSI Layer | Layer 7 (HTTP/HTTPS/WebSocket/gRPC) | Layer 4 (TCP/UDP/TLS) | Layers 4 & 7 (legacy) |
| Routing | Path, host, header, query param, method | IP:port only | Basic HTTP path |
| Performance | ~1M RPS, variable latency | Millions RPS, ultra-low latency, static IPs | Don't use |
| Protocols | HTTP/1.1, HTTP/2, gRPC, WebSocket | TCP, UDP, TLS | HTTP, HTTPS, TCP |
| Static IPs | No (DNS-based) | Yes (Elastic IPs per AZ) | No |
| Lambda targets | Yes | No | No |
| IP targets | Yes | Yes | No |
| Preserve source IP | X-Forwarded-For header | Natively (client IP) | Limited |
| mTLS | Via listener rules | TLS passthrough | No |
| Use ELB when | HTTP microservices, API Gateway alternative, gRPC | NLB: gaming, IoT, on-prem NLB PrivateLink, DNS whitelisting | Migrating legacy only |

**Key decision**: NLB if you need static IPs (for IP whitelisting by customers/partners), ultra-low latency (<1ms additional), or non-HTTP protocols. ALB for everything HTTP — richer routing, WAF integration, Lambda targets.

### Target Groups

A target group is the "where traffic lands" abstraction:
- **Instance targets**: EC2 instances by ID (ports can differ per instance)
- **IP targets**: Any IP in the VPC or on-premises via Direct Connect (enables ECS awsvpc tasks)
- **Lambda targets**: ALB invokes Lambda with HTTP event (no VPC needed)
- **ALB targets**: NLB → ALB chaining (for static IPs + Layer 7 routing)

Each target group has its own health check configuration. A target is only sent traffic when it passes health checks.

### Health Checks

```
Healthy threshold: 3 consecutive successes → healthy
Unhealthy threshold: 2 consecutive failures → deregistered
Interval: 30 seconds (default)
Timeout: 5 seconds
```

For ALB: HTTP/HTTPS. Expect a 200 (or configurable range). For NLB: TCP (just connects), or HTTP/HTTPS (checks response code).

**Deregistration delay** (connection draining): ALB waits up to 300s (default) before removing a deregistered target, allowing in-flight requests to complete. Set to 30s for stateless APIs with fast requests.

### SSL Termination

**ALB**: Terminates TLS at the load balancer. Certificate managed via ACM (free, auto-renewed). Backend talks HTTP — simpler, no cert rotation on instances.

**End-to-end encryption**: ALB terminates TLS → re-encrypts to backend with a second certificate. Required for PCI-DSS.

**NLB TLS termination**: Similar to ALB, but can also do **TLS passthrough** (NLB passes encrypted packets directly to backend, preserving client IP and handling at the application).

**SNI (Server Name Indication)**: Both ALB and NLB support multiple certificates per listener. The load balancer selects the certificate based on the SNI hostname in the client hello.

### Sticky Sessions

**ALB sticky sessions**: Load balancer inserts a cookie (`AWSALB`). Subsequent requests from the same client go to the same target. Duration: 1 second to 7 days.

**Application-based stickiness**: Use your own cookie — ALB encrypts the target info and routes based on it. Better for security (no ALB-internal cookie needed).

**Pitfall**: Sticky sessions defeat the purpose of horizontal scaling for stateless apps. Use them only for legacy apps with server-side session state you can't move to Redis/ElastiCache. Modern pattern: externalize session state, remove stickiness.

---

## 5. ECS Fundamentals

> ECS runs [Docker](/docker) containers. For Kubernetes concepts (pods, deployments, namespaces), see [Kubernetes](/kubernetes).

### Core Concepts

**Cluster**: Logical grouping of compute resources (EC2 instances or Fargate capacity). Namespace for services, tasks, and capacity providers.

**Task Definition**: The blueprint — an immutable, versioned specification defining:
- Container image(s) + resource requirements (CPU, memory)
- Network mode (bridge, host, awsvpc)
- Volumes and mounts
- [IAM](/aws/iam-security) task role + execution role
- Logging configuration
- Environment variables and secrets (from SSM Parameter Store / Secrets Manager)
- Health check command
- Dependencies between containers (`dependsOn: HEALTHY`)

```json
{
  "family": "api-service",
  "networkMode": "awsvpc",
  "taskRoleArn": "arn:aws:iam::123:role/api-task-role",
  "executionRoleArn": "arn:aws:iam::123:role/ecsTaskExecutionRole",
  "containerDefinitions": [{
    "name": "api",
    "image": "123.dkr.ecr.us-east-1.amazonaws.com/api:v1.2.3",
    "cpu": 512,
    "memory": 1024,
    "portMappings": [{"containerPort": 8080}],
    "secrets": [
      {"name": "DB_PASSWORD", "valueFrom": "arn:aws:ssm:us-east-1:123:parameter/db-password"}
    ],
    "logConfiguration": {
      "logDriver": "awslogs",
      "options": {
        "awslogs-group": "/ecs/api-service",
        "awslogs-region": "us-east-1",
        "awslogs-stream-prefix": "api"
      }
    }
  }],
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "512",
  "memory": "1024"
}
```

**Task**: A running instantiation of a task definition. One-off (like a batch job) or managed by a service. Each task gets its own ENI in awsvpc mode.

**Service**: Long-running tasks. Maintains desired count, integrates with ALB/NLB, handles rolling deployments, auto-scaling. Services are the primary unit of operation for HTTP services.

### Task Networking: awsvpc Mode

The key networking mode for modern ECS:
- Each task gets its own **Elastic Network Interface (ENI)** with a private IP in the VPC
- Security groups applied per-task (not per-host)
- Tasks are first-class [VPC & Networking](/aws-vpc-networking) citizens — can have subnet-level routing, VPC flow logs per-task IP
- Required for Fargate; optional but recommended for EC2 launch type
- **Tradeoff**: ENI limits per EC2 instance (e.g., `m5.large` = 3 ENIs × 10 IPs each). For EC2 launch type with many tasks, use **ENI trunking** (allows up to 120 tasks per instance).

**Bridge mode** (EC2 only): Tasks share the host network; port mapping is dynamic. Required for tasks needing host-level networking or when ENI limits are hit.

### Service Discovery

ECS integrates with AWS Cloud Map for service discovery:
- Services register themselves as Cloud Map instances
- DNS records (`api.namespace.local`) resolve to task IPs
- Health-check integration: unhealthy tasks are deregistered from DNS

For complex microservices: use **AWS App Mesh** (Envoy-based service mesh) for traffic management, circuit breaking, mutual TLS between services.

---

## 6. ECS Launch Types

### EC2 Launch Type

You provision and manage EC2 instances in the cluster. ECS places containers on those instances.

**Pros**:
- Full control over instance type (use GPUs, high-memory, bare metal)
- Cost-efficient for sustained, high-throughput workloads
- Can use Spot instances for dramatic cost reduction
- No per-vCPU-second pricing overhead

**Cons**:
- Must manage cluster scaling (ASG for ECS nodes), patching, AMI updates
- Capacity planning required
- ENI limits limit task density in awsvpc mode (mitigated by ENI trunking)

**ECS Container Agent**: Runs on each EC2 instance, communicates with ECS API, manages container lifecycle. Uses the instance's IAM instance profile for ECS API calls.

### Fargate Launch Type

Serverless container execution — AWS allocates, provisions, and terminates the underlying compute.

**Pros**:
- No node management — no AMI patching, no cluster autoscaler
- Pay per vCPU-second and GB-second while task runs (no idle cost)
- Each task isolated with its own microVM (Firecracker hypervisor) — security boundary between tenants
- Works with awsvpc natively — proper security group isolation

**Cons**:
- More expensive than EC2 for consistent long-running workloads (~20–30% premium)
- Limited instance types — can't use GPUs (only via specific Fargate GPU support)
- Cold start latency (~5–15 seconds for task launch vs <1s for warm EC2)
- No direct access to host; no `docker exec` into Fargate tasks in production (ECS Exec via SSM for debugging)

**Pricing example**: 1 vCPU + 2 GB task running 24/7 for 30 days in us-east-1 ≈ $35/month. Equivalent t3.micro (2 vCPU, 1 GiB) on-demand ≈ $8/month — but Fargate gives you dedicated resources + no ops overhead.

**Fargate Spot**: Up to 70% discount on Fargate tasks — same interruption model as EC2 Spot. Ideal for batch jobs, CI/CD workers, non-critical async processing.

### When to Use Which

| Scenario | Recommendation |
|---|---|
| HTTP API, variable traffic | ECS Fargate (no node management) |
| GPU inference | ECS on EC2 (g5/p4 instances) |
| Batch processing with cost sensitivity | ECS Fargate Spot |
| Very high task density, steady workload | ECS on EC2 with Reserved Instances |
| Dev/staging environments | Fargate (pay only when running) |
| On-prem compliance, specific instance types | ECS on EC2 |

---

## 7. ECS Deployment Strategies

### Rolling Update

Default deployment strategy. ECS gradually replaces old tasks with new:

```
minHealthyPercent: 100  → scale up before scale down (extra capacity)
maxPercent: 200         → allow up to 2x desired count during deployment
```

- With 100/200: ECS adds new tasks → waits for health → removes old tasks
- With 0/100: ECS removes old tasks first (brief downtime acceptable, saves cost)
- Circuit breaker: Auto-rollback if new tasks fail to reach steady state within configurable threshold

**Deployment circuit breaker** (enable this): ECS detects if new tasks are crashing/failing health checks and rolls back automatically. Track `consecutiveFailureThreshold` (default 3 failures).

### Blue/Green with CodeDeploy

> CodeDeploy integrates with the broader [CI/CD & DevOps](/aws/cicd-devops) pipeline (CodePipeline, CodeBuild).

Two separate target groups (blue = current, green = new). Traffic shifted between them:

```
Canary:      10% → green for 5 minutes → 100% → green (if no alarms)
Linear:      10% every 1 minute → 100%
AllAtOnce:   100% immediately (for staging)
```

Process:
1. ECS creates new task set with new image
2. CodeDeploy registers it with the green target group
3. ALB routes test traffic to green (via test listener on port 8443)
4. Automated tests run against green
5. CodeDeploy shifts production traffic (blue listener) to green
6. Old (blue) tasks remain for rollback window (default 1 hour), then terminated

**Advantage**: Instant rollback — just shift traffic back to blue target group. Zero downtime, no partial-state deployments.

### Service Auto-Scaling

Three scaling policy types mirror EC2 ASG:
- **Target tracking**: `ECSServiceAverageCPUUtilization`, `ECSServiceAverageMemoryUtilization`, or `ALBRequestCountPerTarget`
- **Step scaling**: CloudWatch alarm triggers → step adjustments
- **Scheduled scaling**: Predictable traffic patterns

`ALBRequestCountPerTarget` is the best metric for HTTP services — scales based on actual request pressure, not CPU (which may be low even under high load for I/O-bound services).

### Capacity Providers

Decouple services from launch type. A capacity provider links an ASG or Fargate to a cluster. Services use capacity provider strategies:

```json
{
  "capacityProviderStrategy": [
    {"capacityProvider": "FARGATE",      "weight": 1, "base": 1},
    {"capacityProvider": "FARGATE_SPOT", "weight": 4, "base": 0}
  ]
}
```

This runs 1 guaranteed Fargate task + 4 Fargate Spot tasks for every 1 Fargate → ~70% cost savings while maintaining HA.

**ADOT (AWS Distro for OpenTelemetry) sidecar**: A common capacity provider pattern deploys an ADOT collector as a sidecar for metrics/traces without changing application code.

---

## 8. EKS

> EKS is managed [Kubernetes](/kubernetes) on AWS. For core K8s concepts (pods, ReplicaSets, Services), see [Kubernetes](/kubernetes).

### Managed vs Self-Managed Node Groups

| Feature | Managed Node Groups | Self-Managed Node Groups |
|---|---|---|
| Provisioning | AWS provisions/joins nodes | You provision, bootstrap, join manually |
| AMI updates | Automated rolling upgrade | Manual |
| Draining | AWS cordons + drains before termination | Must handle manually |
| Spot support | Yes | Yes |
| Custom AMIs | Yes | Yes |
| Multiple instance types | Yes | Yes |
| Launch template | Required | Optional |
| Use case | 95% of workloads | Niche: custom bootstrap, specific OS |

### Fargate Profiles

Run pods serverlessly on EKS. Define namespace + label selectors → matching pods run on Fargate nodes:

```yaml
fargateProfile:
  fargateProfileName: "default"
  selectors:
    - namespace: "app"
      labels:
        tier: "backend"
    - namespace: "kube-system"  # for CoreDNS only
```

**Fargate on EKS tradeoffs vs Managed Node Groups**:
- No DaemonSets on Fargate (no Fluentd, no Datadog agent — use sidecar injection)
- No privileged containers
- 1:1 pod-to-node model (no bin-packing efficiency)
- Best for: isolated workloads, dev environments, specific compliance boundary pods

### EKS Add-ons

Managed lifecycle for cluster-critical components. AWS tests and distributes compatible versions:
- `vpc-cni` — AWS VPC CNI (pod networking via ENIs)
- `coredns` — Cluster DNS
- `kube-proxy` — iptables rules for Services
- `aws-ebs-csi-driver` — Dynamic [EBS](/aws/storage-s3) PV provisioning
- `aws-efs-csi-driver` — [EFS](/aws/storage-s3) PV provisioning (shared RWX)
- `aws-load-balancer-controller` — Provisions ALB/NLB from Ingress/Service objects
- `adot` — AWS Distro for OpenTelemetry
- `amazon-guardduty-agent` — Runtime threat detection

**Critical**: Without `vpc-cni` add-on management, upgrading EKS minor versions can break networking. Pin add-on versions to cluster version compatibility matrix.

### IRSA (IAM Roles for Service Accounts)

> IRSA is the primary way to grant EKS workloads AWS permissions. For IAM policies, roles, and OIDC federation concepts, see [IAM & Security](/aws/iam-security).

Associates an IAM role with a Kubernetes service account. Pods using that SA get temporary credentials via OIDC without needing instance profile credentials (no credential sharing across pods on same node).

**How it works**:
1. EKS cluster exposes an OIDC identity provider endpoint
2. Create IAM role with trust policy allowing the OIDC provider to assume it for a specific SA
3. Annotate the K8s service account with the role ARN
4. `eks-pod-identity-webhook` injects `AWS_ROLE_ARN` and `AWS_WEB_IDENTITY_TOKEN_FILE` env vars into matching pods
5. AWS SDK uses web identity token to call STS `AssumeRoleWithWebIdentity` → temporary credentials

```yaml
# Service Account with IRSA annotation
apiVersion: v1
kind: ServiceAccount
metadata:
  name: s3-reader
  namespace: app
  annotations:
    eks.amazonaws.com/role-arn: arn:aws:iam::123456789012:role/s3-reader-role
```

**EKS Pod Identity** (newer alternative to IRSA): Simpler setup — no OIDC trust policy boilerplate. Create a pod identity association that maps role to service account. Less config, same security model.

### EKS Anywhere

Run EKS on your own infrastructure (VMware vSphere, bare metal, Nutanix, Snow):
- Same EKS API, kubectl, Helm workflow
- AWS manages control plane upgrades and tooling (eksctl)
- Use cases: data sovereignty, air-gapped environments, on-prem regulatory requirements, gradual cloud migration
- **EKS Connector**: For clusters NOT managed by AWS (vanilla K8s, OpenShift) — register them in EKS console for visibility without AWS managing them

---

## 9. ECR (Elastic Container Registry)

> ECR stores [Docker](/docker) container images. For CI/CD pipelines that build and push images, see [CI/CD & DevOps](/aws/cicd-devops).

### Image Scanning

**Basic scanning** (free, deprecated): Scans on push using Clair for OS-level CVEs. Returns `COMPLETE` status.

**Enhanced scanning** (Amazon Inspector integration, recommended):
- Continuous scanning, not just on push
- Scans OS packages AND application dependencies (npm, pip, Maven)
- Severity: CRITICAL, HIGH, MEDIUM, LOW, INFORMATIONAL
- Findings sent to EventBridge → automate CI/CD blocks on CRITICAL findings
- Enable at registry level with `scanType: ENHANCED`

**Shift-left integration**: Block ECR push in CI pipeline if `aws ecr describe-image-scan-findings` returns CRITICAL findings.

### Lifecycle Policies

Automated cleanup rules to control storage costs:

```json
{
  "rules": [
    {
      "rulePriority": 1,
      "description": "Keep last 10 production images",
      "selection": {
        "tagStatus": "tagged",
        "tagPrefixList": ["prod-"],
        "countType": "imageCountMoreThan",
        "countNumber": 10
      },
      "action": {"type": "expire"}
    },
    {
      "rulePriority": 2,
      "description": "Expire untagged images older than 7 days",
      "selection": {
        "tagStatus": "untagged",
        "countType": "sinceImagePushed",
        "countUnit": "days",
        "countNumber": 7
      },
      "action": {"type": "expire"}
    }
  ]
}
```

Rules evaluated in priority order. Common pattern: keep last N tagged images per prefix + expire untagged after 7 days.

### Cross-Region and Cross-Account Replication

**Cross-region replication** (replication configuration on the registry):
- Replicate to up to 25 destination regions
- Async replication — eventual consistency, not synchronous
- Use case: deploy same image from the nearest region; disaster recovery

**Cross-account replication** (pull-through cache or registry permissions):
- **Pull-through cache**: Proxy and cache images from upstream registries (Docker Hub, ECR Public, Quay) in your private ECR. Reduces rate-limit exposure and external traffic costs.
- **Registry permissions**: Allow another account's principals to push/pull using a registry-level policy (different from repository policy).

**ECR Public**: Free, unauthenticated pull globally. Use for open-source distribution. Private ECR: requires `docker login` via `aws ecr get-login-password`.

---

## 10. App Runner

Fully managed service for containerized web applications and APIs. Abstracts away clusters, load balancers, VPCs, auto-scaling, and TLS.

### How It Works

1. Point App Runner at an ECR image or a GitHub repo (source code auto-built via Buildpacks)
2. App Runner deploys, configures load balancing, issues ACM certificate, sets up auto-scaling
3. Configure CPU/memory per instance (0.25–4 vCPU, 0.5–12 GB)
4. App Runner scales from 0 to N instances based on concurrent requests

### Auto-Scaling

- Scale based on **max concurrency per instance** (default 100 concurrent requests)
- Min instances: 0 (pause to 0 = cold starts, save cost) or 1+ (no cold start, ~$5/month minimum)
- Max instances: 1–25 (adjustable via service quota)
- Provisioned concurrency (warm instances): eliminates cold starts for predictable load

### Use Cases

| Fit | Not a Fit |
|---|---|
| HTTP/HTTPS APIs with variable traffic | Non-HTTP (gRPC, WebSocket, TCP) |
| Startups/teams without platform expertise | Fine-grained networking (specific VPC subnets, SGs) |
| Dev/test/staging environments | Very high scale (>25 instances) |
| Migrate from Heroku/Render to AWS | Need GPU instances |
| Single-service deployments | Multi-container (sidecar patterns) |

**VPC connector**: App Runner can reach resources in your VPC (RDS, ElastiCache) via a VPC connector. Outbound only — VPC resources must accept inbound from the VPC connector's security group.

**vs ECS Fargate**: App Runner is simpler but less flexible. No task definitions, no service discovery, no capacity providers. ECS Fargate if you need: multi-container tasks, VPC-native inbound, custom routing, service mesh, or more than 25 instances.

---

## 11. Graviton (ARM64)

AWS Graviton (Graviton2/3/4) are AWS-designed 64-bit ARM processors using Neoverse N1/V1 microarchitecture.

### Performance and Cost Benefits

| Metric | Graviton3 vs comparable x86 |
|---|---|
| Price/performance | 20–40% better |
| Energy efficiency | 60% less energy |
| Memory bandwidth | 2x vs Graviton2 |
| Float point | 2x vs Graviton2 |
| ML performance | 3x vs Graviton2 (BFLOAT16) |

**Specific data points**:
- `c7g` (Graviton3) vs `c6i` (Intel Ice Lake): 25% better performance, 20% cheaper
- `m7g` vs `m6i`: Similar perf, 15–20% cost reduction
- Fargate Graviton: 20% cost reduction vs x86 Fargate tasks

### Migration Considerations

**Code compatibility**:
- Most interpreted languages (Python, Node.js, Ruby, Java JVM) — compile at runtime, no changes needed
- Go: Recompile with `GOARCH=arm64` — typically zero code changes
- Rust: `cargo build --target aarch64-unknown-linux-gnu` — zero code changes
- C/C++: Recompile — potential SIMD intrinsics changes (x86 SSE/AVX → ARM NEON)
- Docker: Build multi-arch images with `docker buildx` and `--platform linux/amd64,linux/arm64`

```dockerfile
# Build multi-arch image
# FROM --platform=$BUILDPLATFORM enables cross-compilation
FROM --platform=$BUILDPLATFORM node:18-alpine AS builder
ARG TARGETPLATFORM
ARG BUILDPLATFORM
```

```bash
# Build and push multi-arch manifest
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  --tag 123.dkr.ecr.us-east-1.amazonaws.com/myapp:latest \
  --push .
```

**ECS/EKS**: Specify CPU architecture in task definition / node selector:
```json
"runtimePlatform": {
  "cpuArchitecture": "ARM64",
  "operatingSystemFamily": "LINUX"
}
```

**When NOT to migrate**:
- 32-bit software (rare now)
- Native x86 binaries without source (commercial ISV)
- Applications heavily reliant on x86 SIMD without ARM equivalents
- Sensitive performance benchmarks you can't revalidate

---

## 12. AWS Batch

Managed batch computing service. Provisions and manages EC2/Fargate compute based on submitted jobs.

### Core Concepts

**Compute Environment**: The pool of EC2 or Fargate resources.
- **Managed**: AWS provisions instances. Specify instance types, VPC, max vCPUs, spot vs on-demand.
- **Unmanaged**: You manage the EC2 instances; AWS just places jobs.

**Job Queue**: Jobs are submitted to queues. Multiple queues can map to one or more compute environments with priorities.

**Job Definition**: Like an ECS task definition — [Docker](/docker) image, CPU/memory, retries, timeout, environment variables, [IAM](/aws/iam-security) role, volumes.

**Job**: A unit of work. Can be array jobs (same definition, N independent runs — useful for hyperparameter sweeps) or dependent jobs (job B waits for job A).

### When to Use Batch

| Use Case | Why Batch |
|---|---|
| ML training at scale | Spot instances, auto-provisioning, job queues |
| Data ETL pipelines | Managed infrastructure, retry logic |
| Genomics / scientific compute | HPC instances, array jobs |
| Video transcoding | Spot for cost, output in S3 |
| Nightly report generation | Scheduled, pay only when running |

**Batch vs ECS vs [Lambda](/aws/lambda-serverless)**:
- [Lambda](/aws/lambda-serverless): max 15 min, 10 GB memory — use for event-driven quick processing
- ECS Service: long-running services; Batch: one-off jobs with queue semantics
- Batch: has job queue, job dependency graph, array jobs, managed retries — ECS lacks these
- Batch on Fargate: when you want no EC2 management AND need >15 minutes

**Fair Share Scheduling**: Distribute Batch compute across teams/projects based on configurable shares. Prevents one team's backlog from starving another.

---

## 13. Container Patterns

### Sidecar Pattern

A helper container in the same pod/task that augments the main container without modifying it.

```
[Pod / ECS Task]
├── main container: api (port 8080)
└── sidecar container: envoy proxy (port 8443 → 8080)
                       fluentd (reads logs from shared volume)
                       datadog-agent (scrapes /metrics)
```

**ECS sidecar in task definition**:
```json
{
  "containerDefinitions": [
    {
      "name": "api",
      "image": "myapp:latest",
      "dependsOn": [{"containerName": "log-router", "condition": "START"}]
    },
    {
      "name": "log-router",
      "image": "amazon/aws-for-fluent-bit:latest",
      "essential": false,
      "firelensConfiguration": {"type": "fluentbit"}
    }
  ]
}
```

**AWS FireLens**: Native ECS sidecar for log routing. Fluent Bit sidecar intercepts container stdout/stderr and routes to CloudWatch, Kinesis, S3, or Splunk without changing application code.

### Ambassador Pattern

A proxy sidecar that acts as an ambassador to external services. The main container connects to localhost; the ambassador handles service discovery, retries, circuit breaking, and mTLS to the external service.

```
[ECS Task]
├── main container: connects to localhost:6379
└── ambassador: envoy or redis-proxy
    → resolves ElastiCache cluster DNS
    → handles connection pooling
    → adds retries with exponential backoff
```

Use case: Connecting to AWS services with complex retry/circuit-break logic without polluting application code. Service mesh sidecar proxies (Envoy via App Mesh) implement this pattern.

### Adapter Pattern

A sidecar that normalizes the interface of the main container to conform to a standard. The main container exposes a proprietary metrics/log format; the adapter translates to a standard.

```
[Pod]
├── main container: legacy app exporting custom /stats
└── adapter: prometheus-exporter sidecar
    → reads /stats (proprietary)
    → exposes /metrics (Prometheus format)
    → Prometheus scrapes adapter, not main container
```

Common in EKS: OpenTelemetry Collector as adapter, consuming app-specific telemetry and exporting to CloudWatch, Jaeger, or X-Ray.

---

## 14. Common Interview Questions

**Q: Walk me through what happens when an ECS Fargate task starts.**

**A:** 1) ECS scheduler receives a `RunTask` or service scale-out event. 2) ECS control plane selects Fargate capacity in the target AZ. 3) AWS provisions a Firecracker microVM (takes ~5-10 seconds for cold start). 4) The ECS agent inside the microVM pulls credentials from the IAM execution role via STS, authenticates with ECR, and pulls the container image. 5) The ENI is provisioned in the VPC subnet and attached to the task (awsvpc mode). 6) Containers start in dependency order (per `dependsOn`). 7) The ECS agent begins reporting the task's health to the ECS control plane. 8) If behind a load balancer, the target registers and starts receiving health checks; once passing, traffic is routed.

---

**Q: How would you design an auto-scaling strategy for an ECS service handling an API with highly variable traffic (10x spikes)?**

**A:** Use three layers: 1) **Target tracking on `ALBRequestCountPerTarget`** set to ~500 req/task — scales proportionally to actual HTTP load, not CPU. 2) **Scheduled scale-out** before known traffic events (marketing campaigns, business hours). 3) **Warm pool or minimum capacity** of at least 2 tasks across 2 AZs for zero-downtime during scale-up. For the underlying capacity (if EC2 launch type), a **Capacity Provider** with a mixed ASG (On-Demand base + Spot for burst) reduces cost by 60-70%. Set scale-in cooldown to 300s to avoid thrashing after spike. Enable deployment circuit breaker to auto-rollback failed deploys during high-traffic windows.

---

**Q: Spot instances interrupted your training job at 80% completion. How do you handle this?**

**A:** Design for interruption from day one: 1) Checkpoint model weights every N steps to S3 (e.g., every 1000 steps). 2) Subscribe to the EC2 Spot interruption notice via instance metadata (`/latest/meta-data/spot/termination-time`) or EventBridge. On notice, flush current checkpoint immediately and gracefully terminate. 3) Re-launch the job with `--resume-from-checkpoint` pointing to the last S3 checkpoint. 4) Use a job queue (SQS or AWS Batch) that holds the job spec — failure re-enqueues it automatically. 5) For AWS Batch: set `attempts: 5` in the job definition; Batch handles re-queue on spot interruption. 6) Consider Spot + On-Demand mixed fleet: run 1 On-Demand instance as "master" + N Spot workers; if a worker is interrupted, the master redistributes work.

---

**Q: What's the difference between an ECS task role and an ECS execution role?**

**A:** The **execution role** is used by the ECS agent (not your code) to pull images from ECR, read secrets from SSM/Secrets Manager, and write logs to CloudWatch. It's operational infrastructure — your application never uses it. The **task role** is used by your application code running inside the container to call AWS services (e.g., S3, [DynamoDB](/aws/dynamodb-data-services), SQS). Credentials are delivered via the IMDS endpoint inside the task (`169.254.170.2` — an ECS-internal metadata endpoint). Always apply least privilege: the task role should only have permissions your application actually needs. See [IAM & Security](/aws/iam-security) for role and policy design.

---

**Q: ALB vs NLB — when does the choice matter?**

**A:** Choose NLB when: (1) customers need to whitelist static IPs (NLB has Elastic IPs; ALB is DNS-only), (2) you have non-HTTP protocols (TCP, UDP, raw TLS passthrough), (3) ultra-low latency is critical — NLB operates at L4 with ~100 microsecond overhead vs ALB's milliseconds at L7. Choose ALB when: (1) you need content-based routing (path, host, header), (2) you need WAF integration, (3) targets include [Lambda](/aws/lambda-serverless) functions, (4) you need gRPC support, (5) you need sticky sessions or advanced health checks. A common hybrid: NLB (for static IP) in front of ALB (for routing) using ALB as an NLB target. See [API Gateway & Networking](/aws/api-gateway-networking) for VPC, Route 53, and API Gateway context.

---

**Q: Explain IRSA and why it's better than using EC2 instance profiles for EKS workloads.**

**A:** With EC2 instance profiles, every pod on the same node shares the node's IAM credentials. If one pod is compromised, the attacker gets credentials for all workloads on that node. IRSA ([IAM](/aws/iam-security) Roles for Service Accounts) solves this with OIDC federation: each pod gets a projected JWT token for its service account; the AWS SDK exchanges this for temporary role credentials via STS `AssumeRoleWithWebIdentity`. The key benefit is **blast radius reduction** — a compromised pod can only access resources permitted by its specific service account's IAM role, not the entire node's permissions. Additionally, you get full auditability in CloudTrail: you can see exactly which pod (via the role session name) called which API.

---

**Q: How do you handle blue/green deployments in ECS with zero downtime?**

**A:** Use ECS + CodeDeploy blue/green (see [CI/CD & DevOps](/aws/cicd-devops) for the full CodePipeline setup): 1) Service has two target groups (blue = current, green = new). ALB listener routes 100% to blue. 2) Deploy new task set to the cluster, register with green target group. 3) ALB test listener (port 8443) routes to green for automated integration tests. 4) On pass, CodeDeploy shifts production traffic: either all-at-once, canary (10% for N minutes then 100%), or linear (10% every minute). 5) Old (blue) tasks remain running during rollback window. 6) Rollback: one API call shifts traffic back to blue immediately. The key: because traffic shifting is instant (ALB routing rule change), rollback takes seconds, not minutes — unlike rolling updates which must drain and re-deploy.

---

**Q: You need to run 1,000 batch jobs, each processing a 100MB file from S3, completing in 2 minutes. Design the system.**

**A:** This is a textbook AWS Batch array job: 1) Upload 1,000 files to S3. 2) Create a Batch job definition pointing to a container that reads `AWS_BATCH_JOB_ARRAY_INDEX` env var and maps it to a file (stored in [DynamoDB](/aws/dynamodb-data-services) or parameter store). 3) Submit one array job with `arraySize: 1000`. 4) Compute environment: managed, Fargate Spot (2 minutes per job, low risk of spot interruption; or EC2 Spot). 5) Set job retry attempts to 3 (for spot interruptions). 6) Batch manages concurrency based on `maxvCpus` — with 1000 jobs × 0.5 vCPU each = 500 vCPUs max (adjust as needed). 7) CloudWatch metrics + EventBridge to alert on job failures. Total cost estimate: 1000 jobs × 2 min × 0.5 vCPU × Fargate Spot pricing ≈ $5–10.

---

**Q: What is the ENI trunking feature in ECS and when do you need it?**

**A:** In awsvpc networking mode, each ECS task gets its own ENI. EC2 instances have ENI limits (e.g., `m5.large` = 3 ENIs). Without trunking, you can only run 3 tasks per `m5.large`. With ENI trunking (a.k.a. "task networking for ECS on EC2 with vpc-cni-like trunking"), ECS uses a trunk ENI attached to the instance and branch ENIs for each task — enabling up to 120 tasks per instance. Enable it by setting `awsvpcTrunking: enabled` in the ECS account settings. Requires ECS-optimized AMI with specific platform version. The tradeoff: more complex networking; Fargate sidesteps this entirely.

---

**Q: Compare ECS Fargate and Lambda for a workload that processes images uploaded to S3.**

**A:** Key dimensions: **Duration** — [Lambda](/aws/lambda-serverless) max 15 minutes; if image processing takes >15 min (video, high-res), use Fargate. **Memory** — Lambda max 10 GB; Fargate up to 30 GB, GPU option. **Concurrency** — Lambda scales per-event to thousands simultaneously with no warm-up (on provisioned concurrency); Fargate scales on metrics with some lag. **Cost** — Lambda is cheaper for sporadic/short jobs (pay per 100ms); Fargate better for sustained load (pay per vCPU-second but no invocation overhead). **Operations** — Lambda is simpler (no Dockerfile, no cluster). **Decision**: For typical web images (<60s, <1GB, high burst): [Lambda](/aws/lambda-serverless). For RAW photos, ML pipelines, video thumbnailing: ECS Fargate. For batch-nightly processing of thousands of images: AWS Batch. Images are stored in [S3](/aws/storage-s3).

---

**Q: How does Graviton migration work in practice for a containerized ECS service?**

**A:** 1) Build a multi-arch Docker image: use `docker buildx build --platform linux/amd64,linux/arm64` and push a manifest list to ECR. 2) Update ECS task definition to add `runtimePlatform: {cpuArchitecture: ARM64}`. 3) Run the ARM64 task in a shadow environment, validate functional correctness and performance. 4) Update the service with the new task definition — rolling deploy. 5) Monitor: CPU utilization, latency p99, error rates. For most Node.js/Python/JVM services, this is a 2-4 hour effort for 20% cost reduction. The main risk: native extensions (.node files, Python C extensions) compiled for x86. Audit `package.json` for native deps and verify their ARM64 support first.

---

## EKS with Karpenter — Intelligent Node Auto-Scaling

Karpenter is an open-source node provisioner for Kubernetes (maintained by AWS) that replaces Cluster Autoscaler with faster, more efficient scaling.

### Karpenter vs Cluster Autoscaler
| Criterion | Cluster Autoscaler | Karpenter |
|---|---|---|
| Scale-out latency | 2-4 min | 30-60s |
| Node selection | Node groups (fixed type) | Any instance type (best fit) |
| Bin packing | Suboptimal | Optimized (consolidation) |
| Spot diversity | Manual configuration | Automatic (diversify types) |
| Node consolidation | Manual deprovisioning | Automatic (removes underutilized nodes) |
| Configuration | Node group limits | NodeClass + NodePool |

### Karpenter NodePool Configuration
```yaml
# NodePool: defines constraints for nodes Karpenter can provision
apiVersion: karpenter.sh/v1
kind: NodePool
metadata:
  name: general
spec:
  template:
    spec:
      nodeClassRef:
        name: al2023   # EC2NodeClass reference
      requirements:
        # Prefer Graviton (ARM64) for 20-40% cost savings
        - key: kubernetes.io/arch
          operator: In
          values: ["arm64", "amd64"]  # arm64 preferred by weight
        - key: karpenter.sh/capacity-type
          operator: In
          values: ["spot", "on-demand"]  # prefer Spot
        - key: node.kubernetes.io/instance-type
          operator: In
          # Diverse instance types reduce Spot interruption probability
          values: ["m7g.large", "m7g.xlarge", "m6g.large", "c7g.large", "c7g.xlarge", "m5.large", "m5.xlarge"]
        - key: topology.kubernetes.io/zone
          operator: In
          values: ["us-east-1a", "us-east-1b", "us-east-1c"]
  limits:
    cpu: 1000        # Max 1000 vCPUs total across this NodePool
    memory: 4000Gi
  disruption:
    consolidationPolicy: WhenUnderutilized  # Remove nodes with low utilization
    consolidateAfter: 30s
    expireAfter: 720h  # Force rotate nodes every 30 days (security patching)

---
# EC2NodeClass: AWS-specific node configuration
apiVersion: karpenter.k8s.aws/v1
kind: EC2NodeClass
metadata:
  name: al2023
spec:
  amiFamily: AL2023  # Amazon Linux 2023 (vs AL2 for older AMIs)
  role: KarpenterNodeRole
  subnetSelectorTerms:
    - tags:
        karpenter.sh/discovery: my-cluster
  securityGroupSelectorTerms:
    - tags:
        karpenter.sh/discovery: my-cluster
  blockDeviceMappings:
    - deviceName: /dev/xvda
      ebs:
        volumeSize: 50Gi
        volumeType: gp3
        iops: 3000
        encrypted: true
```

> Karpenter's subnet and security group selectors are tag-based — ensure your [VPC & Networking](/aws-vpc-networking) subnets carry the `karpenter.sh/discovery` tag matching the cluster name.

### Pod Disruption Budgets for Karpenter Consolidation
```yaml
# Prevent all pods from being evicted simultaneously during consolidation
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: api-pdb
spec:
  selector:
    matchLabels:
      app: api
  minAvailable: "50%"  # At least 50% of pods must remain available
```

---

## Graviton Migration Guide

AWS Graviton3 (ARM64) instances offer 20-40% better price-performance vs equivalent x86 instances. This is one of the highest ROI optimizations available. See [Cost Optimization](/aws-cost-optimization) for how Graviton fits into a broader savings strategy alongside Savings Plans and Spot.

### Compatibility Check
Most modern runtimes and languages are Graviton-compatible:
- ✅ Node.js 18+, Python 3.9+, Go 1.18+, Java 11+ (Corretto), .NET 6+, Rust
- ✅ Docker: use multi-arch base images (`node:20-alpine` is multi-arch)
- ⚠️ Native compiled code: must recompile for `linux/arm64`
- ❌ x86-only binaries (some older proprietary software)

### Migration Steps
```bash
# Step 1: Check if your container images are multi-arch
docker manifest inspect node:20-alpine | grep architecture
# Should show both amd64 and arm64 variants

# Step 2: Build multi-arch images in CI/CD
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  --tag 123456789012.dkr.ecr.us-east-1.amazonaws.com/my-app:latest \
  --push .

# Step 3: Test on Graviton (canary)
# EKS: use nodeSelector or node affinity
spec:
  nodeSelector:
    kubernetes.io/arch: arm64
  containers:
    - image: 123456789012.dkr.ecr.us-east-1.amazonaws.com/my-app:latest

# Step 4: Update Karpenter NodePool to prefer arm64 (see above)
# Step 5: Monitor for issues; rollback nodeSelector to amd64 if needed
```

### Cost Savings Calculator
```
m7g.xlarge (Graviton3 ARM64): $0.1632/hr
m7i.xlarge (Intel x86):       $0.2016/hr
Savings: 19% per instance

r7g.2xlarge (Graviton3):      $0.5376/hr
r7i.2xlarge (Intel):          $0.6048/hr
Savings: 11% per instance

For a 20-node cluster averaging m7g.xlarge:
Monthly savings: 20 × ($0.2016 - $0.1632) × 730 = $561/month
Annual savings: $6,732
```

---

## AWS App Runner — Fastest Path to Production

App Runner is fully managed: you provide source code or container image, AWS handles everything (load balancer, auto-scaling, TLS, deployments).

### When to Choose App Runner vs ECS Fargate
| Criterion | App Runner | ECS Fargate |
|---|---|---|
| Setup time | 5 minutes | 30-60 minutes |
| Configuration | Minimal (CPU/memory only) | Full ECS task/service/ALB setup |
| Auto-scaling | Automatic (no config) | Manual scaling policy config |
| Custom networking | VPC connector (egress only) | Full VPC integration |
| Load balancer | Built-in, not customizable | ALB (full control) |
| Custom domains | Yes | Via Route 53 + ACM |
| Health checks | HTTP path only | Full ALB health check config |
| Cost (idle) | Scales to 0 (paused, resumes in ~seconds) | Minimum 0.25 vCPU if running |
| Best for | Simple containerized APIs, prototypes, internal tools | Production microservices, complex networking |

### App Runner Configuration
```yaml
# apprunner.yaml (source-based deployment)
version: 1.0
runtime: nodejs18
build:
  commands:
    build:
      - npm install
      - npm run build
run:
  runtime-version: 18.12.0
  command: node dist/server.js
  network:
    port: 8080
    env: PORT
  env:
    - name: NODE_ENV
      value: production
  secrets:
    - name: DATABASE_URL
      value-from: arn:aws:secretsmanager:us-east-1:123456789012:secret:db-url

# CDK: App Runner service
const service = new apprunner.Service(this, 'ApiService', {
  source: apprunner.Source.fromEcr({
    imageConfiguration: { port: 8080, environmentSecrets: { DB_URL: apprunner.Secret.fromSecretsManager(dbSecret) } },
    repository: ecrRepo,
    tagOrDigest: 'latest',
  }),
  cpu: apprunner.Cpu.ONE_VCPU,
  memory: apprunner.Memory.TWO_GB,
  autoDeploymentsEnabled: true,  // redeploy on new ECR push
  vpcConnector,  // for private DB access
});
```

> The IAM role that App Runner uses to pull from ECR and read Secrets Manager is a separate service role — see [IAM & Security](/aws-iam-security) for the exact trust policy required.

---

## AWS Batch — Managed Batch Computing

AWS Batch is ideal for ML training jobs, genomics analysis, financial simulations, and any large-scale parallel compute that would be awkward in [Lambda](/aws-lambda-serverless) or ECS.

### Key Concepts
- **Compute Environment**: pool of EC2/Fargate resources (managed or unmanaged)
  - Managed: AWS provisions and scales instances; specify min/max vCPUs; Spot or On-Demand
  - EC2 type: use for GPU instances (p3/g5), custom AMIs, persistent scratch storage
  - Fargate type: no instance management; faster to start; limited to 16 vCPU, 120 GB RAM per job
- **Job Queue**: submit jobs to queue; queue is linked to 1+ compute environments (priority order)
- **Job Definition**: template defining container image, vCPU, memory, [IAM role](/aws-iam-security), volumes, retry strategy
- **Job**: single execution instance of a job definition

### ML Training Job Pattern
```python
# Submit a Batch job for model training
import boto3
batch = boto3.client('batch')

response = batch.submit_job(
    jobName='train-model-v42',
    jobQueue='ml-training-queue',
    jobDefinition='model-training-job:3',
    containerOverrides={
        'command': ['python', 'train.py', '--epochs', '50', '--model', 'bert-base'],
        'environment': [
            {'name': 'S3_TRAINING_DATA', 'value': 's3://my-ml-bucket/training/v3/'},
            {'name': 'S3_OUTPUT', 'value': 's3://my-ml-bucket/models/v42/'},
        ],
        'resourceRequirements': [
            {'type': 'GPU', 'value': '1'},  # Request 1 GPU
        ]
    },
    retryStrategy={'attempts': 3},
    timeout={'attemptDurationSeconds': 7200},  # 2-hour timeout
)

# Monitor
batch.describe_jobs(jobs=[response['jobId']])
```

### Array Jobs — Hyperparameter Tuning
```python
# Submit 100 parallel jobs for hyperparameter sweep
response = batch.submit_job(
    jobName='hyperparam-sweep',
    jobQueue='ml-training-queue',
    jobDefinition='hyperparam-job',
    arrayProperties={'size': 100},  # creates 100 child jobs (index 0-99)
    # Each child job gets AWS_BATCH_JOB_ARRAY_INDEX env var (0-99)
    # Use index to select hyperparameters from a config file
)
```
