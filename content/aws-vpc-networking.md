# AWS VPC & Networking

## The 30-Second Pitch

Amazon VPC (Virtual Private Cloud) is the network foundation every AWS workload runs on. It is a logically isolated section of the AWS cloud where you define your own IP address space, subnets, route tables, and gateways — complete control over who can reach what, from where. When the question in an interview or a production incident is "why can't service A talk to service B?", the answer is almost always in a VPC construct: a missing route, a security group rule pointing at the wrong resource, a NACL blocking return traffic, or a missing endpoint forcing traffic through a NAT Gateway you didn't expect.

The deceptively simple primitives — subnets, route tables, security groups, NACLs — compose into complex topologies spanning multiple accounts, regions, and on-premises data centers. The patterns are well-established (public/private/data subnets per AZ; Transit Gateway for hub-and-spoke; PrivateLink for service exposure) but the gotchas are plentiful: NACLs are stateless, VPC peering is non-transitive, NAT Gateway costs are a common budget surprise, and DNS resolution requires two VPC settings to be enabled simultaneously.

For any distributed systems, platform, or senior cloud engineer interview, you are expected to design a multi-AZ 3-tier VPC from scratch, explain the difference between every connectivity option from peering to Direct Connect, and articulate the cost and security trade-offs at each layer. This article covers all of it.

---

## How It Actually Works

### Mental Model: Packets and Decisions

Every packet traversing your VPC hits a decision tree:

```
Packet enters subnet
        │
        ▼
   NACL Inbound?  ──── DENY ────► Drop
        │ ALLOW
        ▼
  Security Group?  ──── DENY ────► Drop
        │ ALLOW
        ▼
  Route Table  ──────────────────► local / IGW / NAT GW / TGW / VGW / endpoint
        │
        ▼
   Destination
        │
        ▼
  Security Group (return traffic — stateful: auto-allowed)
        │
        ▼
   NACL Outbound? ──── DENY ────► Drop
        │ ALLOW
        ▼
   Packet delivered
```

The critical insight: **Security Groups are stateful** (return traffic is automatically allowed), **NACLs are stateless** (you must explicitly allow return traffic including ephemeral ports 1024–65535). Route tables use **longest-prefix match** — a /28 route always wins over a /16 route for a matching destination. The **local route** (VPC CIDR → local) is always present and cannot be deleted or overridden.

---

## 1. VPC Fundamentals

### CIDR Design

A VPC spans the entire region and gets one or more CIDR blocks (IPv4 and/or IPv6). RFC 1918 private ranges are standard:

| Range | Size | Notes |
|---|---|---|
| `10.0.0.0/8` | 16.7M IPs | Too broad for a single VPC; pick a /16 or /20 slice |
| `172.16.0.0/12` | 1M IPs | Common for secondary CIDRs |
| `192.168.0.0/16` | 65,536 IPs | Common in small environments |

**VPC sizing rules of thumb:**
- Use `/16` for the VPC (65,536 IPs) — gives room for many subnets across many AZs
- Use `/24` for subnets (~256 IPs; 251 usable — AWS reserves 5 per subnet)
- Reserve the bottom of your range: AWS reserves `.0` (network), `.1` (VPC router), `.2` (DNS), `.3` (future), `.255` (broadcast)
- **Avoid** CIDR blocks that overlap with corporate networks or other VPCs you will peer with — overlapping CIDRs prevent VPC peering

```
10.0.1.0/24 — 256 IPs, 251 usable
Reserved: .0 (net), .1 (router), .2 (DNS), .3 (AWS future), .255 (broadcast)
```

A secondary CIDR can be added to an existing VPC (e.g., add `100.64.0.0/16` for additional capacity without renumbering).

### Public vs. Private Subnets

The distinction is purely about **route table entries**, not subnet attributes per se:

| Characteristic | Public Subnet | Private Subnet |
|---|---|---|
| Route to Internet | `0.0.0.0/0 → IGW` | None (or `0.0.0.0/0 → NAT GW`) |
| Resources can be reached from internet | Yes (if Elastic IP / public IP assigned) | No |
| Resources can reach internet | Yes (directly) | Yes (via NAT Gateway) |
| Typical tenants | Load balancers, bastion hosts, NAT Gateways | App servers, containers, databases |

**Auto-assign public IPv4**: a subnet-level setting. When enabled, new EC2 instances get a public IP automatically. Leave this OFF for private subnets.

### Route Tables

Every subnet is associated with exactly one route table. The **main route table** is assigned by default; you can create **custom route tables** and associate subnets explicitly.

Route evaluation order: **longest prefix match wins**.

```
Destination        Target           Notes
──────────────     ──────────────   ─────────────────────────────────────
10.0.0.0/16        local            Always present; VPC-internal traffic
0.0.0.0/0          igw-0abc123      Internet Gateway (public subnet)
pl-xxxx (S3 prefix list)  vpce-xxx  Gateway endpoint for S3 (free)
```

For a private subnet:
```
Destination        Target
──────────────     ──────────────
10.0.0.0/16        local
0.0.0.0/0          nat-0abc123    NAT Gateway in public subnet of same AZ
```

### Internet Gateway (IGW)

- **One per VPC** — you cannot attach multiple IGWs
- **Horizontally scaled**, redundant, no bandwidth bottleneck — AWS manages it
- Performs NAT for instances with public/Elastic IPs (1:1 static NAT, not port-multiplexing)
- Attaching an IGW does nothing on its own — you must add a `0.0.0.0/0 → igw` route to the subnet's route table

### Elastic IPs

- **Static public IPv4** addresses allocated to your account — survive instance stop/start
- Charged **$0.005/hr when NOT attached** (or when attached to a stopped instance) — always release unused EIPs
- One public IP can be remapped to a different instance in seconds (useful for failover without DNS TTL)
- Limit: 5 per region by default (can be raised)

### NAT Gateway

- **Managed**, highly available **within a single AZ** — place one NAT Gateway per AZ for full HA
- Cost: **$0.045/hr** (≈$32/month) + **$0.045/GB** data processing — this data cost adds up fast for high-throughput workloads
- NAT Instance: the old DIY approach on a special AMI. **Deprecated for new deployments** — no auto-scaling, single point of failure, requires disabling source/dest check
- NAT Gateway does NOT support inbound connections from the internet — it is outbound-only

```bash
# Create NAT Gateway (requires Elastic IP)
aws ec2 allocate-address --domain vpc
aws ec2 create-nat-gateway \
  --subnet-id subnet-public-1a \
  --allocation-id eipalloc-0abc123 \
  --tag-specifications 'ResourceType=natgateway,Tags=[{Key=Name,Value=nat-1a}]'
```

### AZ Design: The 6-Subnet Pattern

For a typical 3-tier application across 2 AZs (minimum production setup):

```
Region us-east-1
└── VPC 10.0.0.0/16
    ├── public-1a       10.0.1.0/24   ──┐
    ├── public-1b       10.0.2.0/24   ──┤── IGW ── Internet
    │                                    │
    ├── private-app-1a  10.0.11.0/24 ───── NAT-1a (in public-1a)
    ├── private-app-1b  10.0.12.0/24 ───── NAT-1b (in public-1b)
    │
    ├── private-db-1a   10.0.21.0/24  (no internet route)
    └── private-db-1b   10.0.22.0/24  (no internet route)
```

Extend to 3 AZs for production (1a, 1b, 1c) = 9 subnets. Database subnets often have **no internet route at all** — not even via NAT — as a defense-in-depth measure.

---

## 2. Security Groups vs. NACLs

| Feature | Security Group | Network ACL (NACL) |
|---|---|---|
| Applies to | Individual ENI (instance/container/LB) | Entire subnet |
| Stateful? | **Yes** — return traffic auto-allowed | **No** — must allow both directions |
| Rule types | Allow only | Allow **and** Deny |
| Evaluation | All rules evaluated; most permissive wins | Rules evaluated in **order** (lowest number first); first match wins |
| Default (new) | Deny all inbound; allow all outbound | Allow all inbound and outbound |
| Default (VPC main NACL) | N/A | Allow all (rule 100 allow, rule * deny) |
| Rule limit | 60 inbound + 60 outbound (default) | 20 inbound + 20 outbound (default) |
| IP or SG reference | Both IP CIDR and other SG IDs | IP CIDR only |
| Use case | Fine-grained instance-level control | Subnet-wide allow/deny; emergency IP blocking |

### Stateless NACLs: Ephemeral Ports

Because NACLs are stateless, return traffic for a client TCP connection uses **ephemeral (client) ports 1024–65535**. If your NACL outbound rules only allow port 443, inbound HTTPS responses from the server will be blocked unless you also allow inbound 1024–65535.

```
Client (ephemeral :54321) ──→ Server :443   # inbound NACL: allow dst 443
Server :443 ──→ Client (ephemeral :54321)   # outbound NACL: must allow src 443, dst 1024-65535
```

### 3-Tier Security Group Pattern

```
Internet
    │  HTTPS :443
    ▼
[ALB SG]  — inbound: 443 from 0.0.0.0/0
    │  HTTP :8080
    ▼
[App SG]  — inbound: 8080 from sg-alb-id  (SG reference, not CIDR)
    │  Postgres :5432
    ▼
[DB SG]   — inbound: 5432 from sg-app-id  (SG reference)
```

Referencing SG IDs (not CIDRs) means the rule automatically applies to all instances in that group — no IP address management needed, and the rule is immune to IP changes.

```bash
# Create app security group that allows traffic from ALB SG
aws ec2 authorize-security-group-ingress \
  --group-id sg-app123 \
  --protocol tcp \
  --port 8080 \
  --source-group sg-alb456  # Reference SG, not CIDR

# Create DB security group allowing only app tier
aws ec2 authorize-security-group-ingress \
  --group-id sg-db789 \
  --protocol tcp \
  --port 5432 \
  --source-group sg-app123
```

### When to Use NACLs vs. Security Groups

Use **NACLs** when you need to:
- Block a specific IP address or CIDR (security groups can only allow)
- Apply a blanket rule to all resources in a subnet at once
- Create an emergency deny (e.g., blocking an attacker IP without modifying every SG)

Use **Security Groups** for everything else — they are easier to manage, stateful (less footgun potential), and support SG references.

---

## 3. VPC Connectivity

### VPC Peering

VPC peering creates a direct, private network connection between two VPCs. Traffic stays on the AWS backbone — no IGW, VPN, or separate hardware.

**Key properties:**
- **Non-transitive**: A↔B and B↔C does NOT enable A↔C. You must create a direct A↔C peering.
- Route tables on **both sides** must be updated with the peer's CIDR
- **No overlapping CIDRs** — peering fails if the VPCs have conflicting IP ranges
- No bandwidth limit; no single point of failure
- Cross-account and cross-region supported (inter-region traffic is encrypted by default)

```bash
# Create peering connection
aws ec2 create-vpc-peering-connection \
  --vpc-id vpc-aaaa \
  --peer-vpc-id vpc-bbbb \
  --peer-region us-west-2  # omit for same-region

# Accept from the peer side (or use same account for same-region)
aws ec2 accept-vpc-peering-connection --vpc-peering-connection-id pcx-0abc123

# Add route on BOTH sides
aws ec2 create-route \
  --route-table-id rtb-aaaa \
  --destination-cidr-block 10.1.0.0/16 \
  --vpc-peering-connection-id pcx-0abc123
```

**When to use**: Small number of VPCs (< 5–10); direct billing simplicity; when transitive routing is not needed.

### Transit Gateway (TGW)

TGW is a regional network hub. Attach many VPCs, VPN connections, and Direct Connect gateways to a single TGW and get **transitive routing** — A can reach C through the hub.

```
VPC-Prod-1 ──┐
VPC-Prod-2 ──┤
VPC-Dev    ──┤── TGW ──── On-Prem (via VPN or DX)
VPC-Shared ──┤
VPC-Mgmt   ──┘
```

**TGW Route Tables for segmentation:**

| Route Table | Attached VPCs | Can reach |
|---|---|---|
| `rt-prod` | Prod-1, Prod-2, Shared | Each other + Shared + On-Prem |
| `rt-dev` | Dev | Shared only (isolated from Prod) |
| `rt-shared` | Shared | All (central services) |

```
# TGW association: which route table a VPC uses for outbound lookups
# TGW propagation: which route tables learn this VPC's CIDR automatically

TGW Attachment (VPC-Dev) → associated with rt-dev
                         → propagates CIDR into rt-dev and rt-shared (not rt-prod)
```

**Cost**: $0.05/hr per attachment (VPC, VPN, DX GW) + $0.02/GB data processed.
**Inter-region peering**: TGWs in different regions can be peered — single control plane for global network.

**When to use**: > 5 VPCs; need transitive routing; hybrid connectivity (on-prem + cloud); environment segmentation.

### AWS PrivateLink (VPC Endpoints)

PrivateLink enables private connectivity to AWS services (and your own services) without traffic leaving the AWS network.

#### Gateway Endpoints (S3, DynamoDB only)

- **Free** — no hourly or data processing charge
- Implemented as a **route table entry** (prefix list → endpoint)
- No security group; controlled via **endpoint policy** (IAM-style JSON)
- Traffic stays within AWS backbone, does NOT leave to the internet via NAT

```bash
aws ec2 create-vpc-endpoint \
  --vpc-id vpc-aaaa \
  --service-name com.amazonaws.us-east-1.s3 \
  --route-table-ids rtb-private-1a rtb-private-1b \
  --vpc-endpoint-type Gateway
```

#### Interface Endpoints (all other services)

- Creates an **ENI (Elastic Network Interface)** in your subnet with a private IP
- Costs: **$0.01/hr per AZ** + **$0.01/GB** data processed
- Has a security group — controls which sources can reach the endpoint
- Enables **private DNS**: resolves `s3.amazonaws.com` (or any service endpoint) to the private IP automatically (requires `enableDnsHostnames` and `enableDnsSupport` on the VPC)

```bash
aws ec2 create-vpc-endpoint \
  --vpc-id vpc-aaaa \
  --service-name com.amazonaws.us-east-1.ssm \
  --vpc-endpoint-type Interface \
  --subnet-ids subnet-private-1a subnet-private-1b \
  --security-group-ids sg-endpoint123 \
  --private-dns-enabled
```

#### PrivateLink for Custom Services

Expose your NLB as a **VPC endpoint service** — other accounts create interface endpoints to reach your service without VPC peering or public internet:

```
Consumer VPC ──[Interface Endpoint]──► AWS PrivateLink ──► Provider VPC NLB ──► Your app
```

No peering required, no overlapping CIDR concerns, consumer-controlled, cross-account. Ideal for ISV / platform team patterns.

See [IAM & Security](/aws-iam-security) for writing endpoint policies that restrict which IAM principals and S3 bucket prefixes are accessible via the endpoint.

### Site-to-Site VPN

Connects your on-premises network to a VPC over the public internet, encrypted with IPsec.

**Components:**
- **Virtual Private Gateway (VGW)**: AWS-side endpoint; attached to your VPC
- **Customer Gateway (CGW)**: represents your on-prem VPN device in AWS (just stores IP + routing config)
- **VPN Connection**: two IPsec tunnels per connection for redundancy (each 1.25 Gbps limit)

```
On-Prem Router ──[Tunnel 1]──► VGW (us-east-1a endpoint)
               ──[Tunnel 2]──► VGW (us-east-1b endpoint)
```

**Routing options:**
- **Static**: manually enter on-prem CIDRs in VGW config
- **Dynamic (BGP)**: preferred — route propagation to route tables, automatic failover

```bash
# Enable route propagation from VGW to route table
aws ec2 enable-vgw-route-propagation \
  --route-table-id rtb-private \
  --gateway-id vgw-0abc123
```

**VPN + TGW**: Attach VPN to TGW instead of VGW to share on-prem connectivity across many VPCs.

### AWS Direct Connect (DX)

Dedicated physical connection from your data center to an AWS DX location — bypasses the public internet entirely.

| Type | Bandwidth | Provisioning | Use Case |
|---|---|---|---|
| **Dedicated** | 1, 10, 100 Gbps | Weeks (own cross-connect at DX location) | Predictable high-throughput; enterprise |
| **Hosted** | 50 Mbps – 10 Gbps | Days (via DX Partner) | Faster provisioning; flexible sizing |

**Virtual Interfaces (VIFs):**

| VIF Type | Connects To | Use Case |
|---|---|---|
| **Private VIF** | VGW or TGW | Access resources inside a VPC |
| **Transit VIF** | TGW | Access many VPCs via Transit Gateway |
| **Public VIF** | AWS public endpoints | Access S3, DynamoDB without traversing internet |

**High Availability with DX + VPN Failover:**

```
Primary:   On-Prem ──[DX 10Gbps]──► TGW   (BGP MED = 100, preferred)
Failover:  On-Prem ──[VPN IPsec]──► TGW   (BGP MED = 200 or AS prepend)
```

BGP prefers lower MED — DX with MED 100 wins; VPN takes over if DX fails.

**Link Aggregation Group (LAG)**: Bundle 2–4 DX connections for higher aggregate bandwidth and active/active redundancy.

---

## 4. DNS in VPC

### Route 53 Resolver (VPC+2 Resolver)

Every VPC gets a DNS resolver at the **VPC base IP + 2** (e.g., `10.0.0.2` for a `10.0.0.0/16` VPC). This resolver handles all DNS queries from instances in the VPC.

**Two VPC settings that must BOTH be enabled** for EC2 instances to get public DNS names:

| Setting | What it does |
|---|---|
| `enableDnsSupport` | Enables the VPC+2 DNS resolver |
| `enableDnsHostnames` | Assigns public DNS hostnames to instances with public IPs |

If either is disabled, `ec2-xx-xx-xx-xx.compute-1.amazonaws.com` won't resolve, and interface endpoint private DNS won't work.

```bash
aws ec2 modify-vpc-attribute --vpc-id vpc-aaaa --enable-dns-support '{"Value":true}'
aws ec2 modify-vpc-attribute --vpc-id vpc-aaaa --enable-dns-hostnames '{"Value":true}'
```

### Private Hosted Zones

Associate a Route 53 private hosted zone with one or more VPCs — instances resolve `db.internal.mycompany.com` to a private IP without leaving the VPC:

```bash
aws route53 create-hosted-zone \
  --name internal.mycompany.com \
  --caller-reference $(date +%s) \
  --hosted-zone-config PrivateZone=true \
  --vpc VPCRegion=us-east-1,VPCId=vpc-aaaa
```

### Hybrid DNS: Resolver Endpoints

For hybrid environments where on-prem systems need to resolve AWS private DNS, or AWS needs to forward to on-prem DNS:

| Endpoint Type | Direction | Use Case |
|---|---|---|
| **Inbound Resolver Endpoint** | On-prem → AWS | On-prem DNS servers forward `*.internal.aws` to ENIs in VPC |
| **Outbound Resolver Endpoint** | AWS → On-prem | VPC instances query `*.corp.local` which forwards to on-prem DNS |

**Resolver Rules** (attached to Outbound endpoints):
- **Forward rule**: specific domain → target on-prem DNS IPs (e.g., `corp.local → 192.168.1.53`)
- **System rule**: AWS-managed auto-defined domains (`.amazonaws.com`, private hosted zones)
- **Recursive rule**: default for everything else → Route 53 Resolver

```
VPC instance: nslookup db.corp.local
  → VPC+2 resolver
  → Forward rule: corp.local → outbound endpoint
  → Outbound endpoint ENI → On-prem DNS 192.168.1.53
  → Returns 192.168.50.100 (on-prem IP)
```

Resolver rules can be **shared via RAM (Resource Access Manager)** across accounts in an organization.

---

## 5. Load Balancers

### Full Comparison

| Feature | ALB (Application) | NLB (Network) | GWLB (Gateway) |
|---|---|---|---|
| OSI Layer | 7 (HTTP/HTTPS) | 4 (TCP/UDP/TLS) | 3+4 (IP/TCP/UDP) |
| Protocols | HTTP, HTTPS, WebSocket, gRPC | TCP, UDP, TLS | Any IP traffic |
| Use case | Web apps, microservices, API routing | Extreme performance, TCP/UDP, PrivateLink | Security appliances (IDS/IPS, firewalls) |
| Static IP per AZ | No (use Global Accelerator) | Yes (or Elastic IP) | Yes |
| SSL/TLS termination | Yes | Yes (or passthrough) | No (transparent) |
| Target types | Instance, IP, Lambda, ALB | Instance, IP, ALB | Instance, IP |
| Sticky sessions | Yes (duration-based or app cookie) | Yes (source IP) | N/A |
| WAF integration | Yes | No | No |
| Request/response mod | Yes (redirect, fixed-response, headers) | No | No |
| Cross-zone load balancing | On by default | Off by default (charge applies if on) | On by default |
| Preserve source IP | Via X-Forwarded-For header | Yes (native) | Yes |
| PrivateLink provider | No | Yes | No |
| Latency | ~1ms | Sub-millisecond | N/A (bump-in-the-wire) |

### ALB: Advanced Routing

ALB listener rules are evaluated top-to-bottom; first match wins. Supports path, host, HTTP header, query string, and source IP conditions:

```yaml
# CloudFormation: ALB Listener Rules
ListenerRuleAPI:
  Type: AWS::ElasticLoadBalancingV2::ListenerRule
  Properties:
    ListenerArn: !Ref ALBListener
    Priority: 10
    Conditions:
      - Field: path-pattern
        Values: ["/api/*"]
    Actions:
      - Type: forward
        TargetGroupArn: !Ref APITargetGroup

ListenerRuleStatic:
  Type: AWS::ElasticLoadBalancingV2::ListenerRule
  Properties:
    ListenerArn: !Ref ALBListener
    Priority: 20
    Conditions:
      - Field: host-header
        Values: ["static.myapp.com"]
    Actions:
      - Type: redirect
        RedirectConfig:
          Host: "cdn.myapp.com"
          StatusCode: HTTP_301

ListenerRuleDefault:
  Type: AWS::ElasticLoadBalancingV2::ListenerRule
  Properties:
    ListenerArn: !Ref ALBListener
    Priority: 100
    Conditions:
      - Field: path-pattern
        Values: ["/*"]
    Actions:
      - Type: forward
        TargetGroupArn: !Ref WebTargetGroup
```

See [Security Services](/aws-security-services) for attaching AWS WAF to ALB to block malicious traffic at the load balancer layer before it reaches application servers.

### NLB: Key Characteristics

- Static IP per AZ — critical for whitelisting by IP (e.g., partner firewall rules)
- TLS passthrough: NLB forwards encrypted traffic without terminating; the EC2 instance handles TLS (certificate lives on server, not LB)
- **No security group on NLB itself** (traffic is controlled by target security groups and source IP NACLs)
- **PrivateLink provider**: expose your NLB as a private endpoint service to other VPCs/accounts

### GWLB: Bump-in-the-Wire

GWLB inserts security appliances transparently into traffic flows using **Geneve encapsulation** (port 6081):

```
Client
  │
  ▼
GWLB (receives packet)
  │  Geneve encapsulation
  ▼
Security Appliance (IDS/IPS/firewall — inspects and optionally drops)
  │  Returns packet to GWLB
  ▼
GWLB (strips encapsulation, forwards original packet)
  │
  ▼
Destination EC2
```

Route traffic through GWLB via route table entries — `0.0.0.0/0 → GWLB endpoint`. See [Compute & Containers](/aws-compute-containers) for EKS/ECS networking considerations when deploying to VPCs with GWLB in the path.

---

## 6. VPC Flow Logs & Network Observability

### Flow Logs

Flow logs capture metadata about IP traffic going to and from network interfaces. They do NOT capture the payload — just the 5-tuple + metadata.

**Default fields captured:**
```
version account-id interface-id srcaddr dstaddr srcport dstport protocol
packets bytes start end action log-status
```

**Version 5 custom format** adds critical context:
```
${vpc-id} ${subnet-id} ${instance-id} ${tcp-flags} ${pkt-srcaddr} ${pkt-dstaddr}
${flow-direction} ${traffic-path}
```

`pkt-srcaddr`/`pkt-dstaddr` show the **original** source/destination before NAT translation (useful for tracing through NAT Gateways).

**Destinations:**

| Destination | Query Tool | Latency | Cost |
|---|---|---|---|
| CloudWatch Logs | CloudWatch Logs Insights | Near real-time | Higher (CW ingestion + storage) |
| S3 | Athena + Glue | 5–15 min delay | Lower (S3 storage only) |
| Kinesis Data Firehose | Real-time processing (Splunk, OpenSearch) | Near real-time | Firehose + destination |

```bash
# Enable flow logs to S3
aws ec2 create-flow-logs \
  --resource-type VPC \
  --resource-ids vpc-aaaa \
  --traffic-type ALL \
  --log-destination-type s3 \
  --log-destination arn:aws:s3:::my-flow-logs-bucket/vpc-logs/ \
  --log-format '${version} ${vpc-id} ${subnet-id} ${instance-id} ${srcaddr} ${dstaddr} ${srcport} ${dstport} ${protocol} ${packets} ${bytes} ${start} ${end} ${action} ${tcp-flags}'
```

### Athena Query: Top Talkers and Blocked Connections

```sql
-- Top 10 source IPs by bytes transferred
SELECT srcaddr, SUM(bytes) AS total_bytes
FROM vpc_flow_logs
WHERE action = 'ACCEPT'
  AND start >= to_unixtime(current_timestamp - interval '1' hour)
GROUP BY srcaddr
ORDER BY total_bytes DESC
LIMIT 10;

-- Find REJECTED connections (potential attack or misconfiguration)
SELECT srcaddr, dstaddr, dstport, protocol, COUNT(*) AS reject_count
FROM vpc_flow_logs
WHERE action = 'REJECT'
  AND start >= to_unixtime(current_timestamp - interval '1' hour)
GROUP BY srcaddr, dstaddr, dstport, protocol
ORDER BY reject_count DESC
LIMIT 20;

-- Cross-AZ traffic (identify cost sources)
SELECT srcaddr, dstaddr, SUM(bytes) AS bytes
FROM vpc_flow_logs
WHERE subnet_id != dst_subnet_id  -- simplified; filter by known subnet CIDRs
GROUP BY srcaddr, dstaddr
ORDER BY bytes DESC;
```

### Reachability Analyzer

Automated path analysis — you specify a source and destination, AWS traces the logical path and reports exactly which component (SG rule, NACL, route table, peering) blocks connectivity:

```bash
aws ec2 create-network-insights-path \
  --source eni-source123 \
  --destination eni-dest456 \
  --protocol tcp \
  --destination-port 443

aws ec2 start-network-insights-analysis \
  --network-insights-path-id nip-0abc123
```

Returns: `REACHABLE` or a precise explanation of the blocking component. Invaluable for debugging "why can't my Lambda reach RDS?" without manually auditing every SG and route table.

### Network Access Analyzer

Proactively audits your entire VPC topology to find **unintended access paths** — e.g., finding any path from the internet to your RDS instances that you didn't explicitly intend. Runs without needing a specific source/destination pair.

### Traffic Mirroring

Copy raw packet traffic from ENIs to an inspection appliance (an NLB, Packet Capture instance). Use for:
- Deep packet inspection (DPI)
- IDS/IPS running on EC2
- Forensic analysis of suspected compromised instances

Only available on Nitro-based instances.

---

## 7. High Availability Patterns

### NAT Gateway HA: Per-AZ Design

**Anti-pattern** (single NAT Gateway):
```
AZ-1: private-app-1a → NAT-1a (public-1a) → Internet   ✓
AZ-2: private-app-1b → NAT-1a (public-1a) → Internet   ✗ cross-AZ traffic
                                                           + single point of failure
```

**Correct pattern** (NAT Gateway per AZ):
```
AZ-1: private-app-1a → NAT-1a (public-1a) → Internet   ✓ same-AZ, HA
AZ-2: private-app-1b → NAT-1b (public-1b) → Internet   ✓ same-AZ, HA
```

Route tables must be **AZ-specific** — `rtb-private-1a` routes `0.0.0.0/0` to `nat-1a`, and `rtb-private-1b` routes to `nat-1b`. If AZ-1 fails, AZ-2 traffic is unaffected.

**Cost vs. HA trade-off**: Two NAT Gateways = ~$64/month vs. ~$32/month. For production, always pay for per-AZ NAT Gateways.

### Multi-AZ Subnet Design Matrix

| Resource | AZ-1 Subnet | AZ-2 Subnet | Route Table | Notes |
|---|---|---|---|---|
| ALB | public-1a | public-1b | main (→ IGW) | Must span 2+ AZs |
| NAT Gateway | public-1a | public-1b | N/A | One per AZ |
| ECS/EKS tasks | private-app-1a | private-app-1b | private (→ NAT same AZ) | Register in both AZs |
| RDS Primary | private-db-1a | — | private (no internet) | — |
| RDS Standby | — | private-db-1b | private (no internet) | Multi-AZ failover |
| ElastiCache | private-db-1a | private-db-1b | private (no internet) | Cluster mode spans AZs |

### TGW HA

TGW attachments are **multi-AZ by default** — specify subnets in each AZ when attaching a VPC. TGW itself is a regional service with AWS-managed HA. Use separate route tables per environment:

```
TGW Attachment for VPC-Prod → subnets: private-1a, private-1b (both AZs)
TGW Route Table rt-prod:
  10.0.0.0/16 → attachment-prod-1
  10.1.0.0/16 → attachment-prod-2
  10.99.0.0/16 → attachment-shared
  0.0.0.0/0 → attachment-firewall (centralized egress inspection)
```

### Direct Connect HA

For mission-critical workloads:
```
Tier 1 (highest priority): 2× Dedicated DX from 2 different DX locations (different providers)
Tier 2 (failover):         VPN over internet as final fallback
```

BGP routing: DX routes have lower MED → preferred. VPN routes have higher MED → used only when DX is down. See [CloudFront & Route 53](/aws-cloudfront-route53) for global traffic management layered on top of hybrid connectivity.

---

## 8. Cost Optimization

### NAT Gateway: The Hidden Cost

NAT Gateway data processing at $0.045/GB is the most common VPC budget surprise. Strategies to reduce it:

**1. Gateway Endpoints for S3 and DynamoDB (free)**

Before: EC2 → NAT Gateway ($0.045/GB) → S3
After: EC2 → S3 Gateway Endpoint (free) → S3

If your workloads read/write heavily from S3 (data pipelines, ML training, log archival), this single change can save hundreds per month.

**2. Interface Endpoints for other AWS services**

Break-even calculation:
```
NAT Gateway data cost:      N GB/month × $0.045
Interface Endpoint cost:    $0.01/hr × 2 AZs × 730 hrs + N GB × $0.01
                          = $14.60/month base + N × $0.01

Break even: N × $0.045 = $14.60 + N × $0.01
            N × $0.035 = $14.60
            N ≈ 417 GB/month

For > 417 GB/month through NAT to a single service, Interface Endpoint saves money.
```

**3. Identify cross-AZ traffic with Flow Logs**

Cross-AZ data transfer costs $0.01/GB each direction. Use Athena queries on flow logs to identify top cross-AZ talkers. Common culprit: an EC2 instance in AZ-1 connecting to an ElastiCache node or RDS read replica in AZ-2.

Fixes:
- Use ElastiCache cluster mode with replicas in each AZ; configure client to prefer local AZ node
- Use RDS read replicas per AZ; route read queries to same-AZ replica
- For ECS/EKS, use `topologySpreadConstraints` or `AZ affinity` to keep caller and callee in same AZ

**4. VPN vs. Direct Connect**

| Scenario | Recommendation |
|---|---|
| < 500 GB/month data transfer, variable | VPN ($0.05/hr/tunnel + data) |
| > 1 TB/month data transfer, consistent | DX (better data pricing, higher base cost) |
| Low latency required (< 10ms) | DX (dedicated, no internet congestion) |
| Fast provisioning needed | VPN (minutes) vs DX (weeks) |

See [Cost Optimization](/aws-cost-optimization) for a full AWS cost optimization framework, reserved capacity strategies, and cost anomaly detection patterns.

---

## Interview Q&A

---

**Q: What's the difference between a Security Group and a NACL?**

A: Security Groups are stateful, instance-level firewalls that only support allow rules. Return traffic is automatically permitted regardless of outbound rules. NACLs are stateless, subnet-level ACLs that support both allow and deny rules; you must explicitly allow both inbound and outbound traffic (including ephemeral ports 1024–65535 for return traffic). In practice, use Security Groups for all normal access control and NACLs for emergency IP blocking or an extra layer of subnet-wide policy. NACLs evaluate rules in order — the first match wins — which is a common gotcha when troubleshooting.

---

**Q: Explain VPC peering vs. Transit Gateway — when do you use each?**

A: VPC peering is a direct, point-to-point private connection between two VPCs. It has no bandwidth limit and no per-hour charge but is non-transitive (you need N×(N-1)/2 peering connections for full mesh). Transit Gateway is a regional hub that enables transitive routing — any attached VPC or VPN can reach any other attached network through the hub. Use peering for 2–5 VPCs with simple topology; use TGW when you have many VPCs, need on-prem connectivity shared across them, or need network segmentation via separate TGW route tables (e.g., prod vs. dev isolation).

---

**Q: How does DNS resolution work in a VPC?**

A: Every VPC has a built-in DNS resolver at VPC base + 2 (e.g., `10.0.0.2`). Instances send all DNS queries there. For public DNS, it forwards to Route 53 public resolvers. For private hosted zones associated with the VPC, it returns the private IP. Two VPC attributes must both be `true`: `enableDnsSupport` (enables the resolver) and `enableDnsHostnames` (assigns EC2 public DNS names). For hybrid scenarios, you deploy Route 53 Resolver inbound endpoints (so on-prem can query AWS DNS) and outbound endpoints with forwarding rules (so VPC instances forward `corp.local` queries to on-prem DNS servers).

---

**Q: A Lambda function in a VPC can't reach the internet. What are the likely causes and fixes?**

A: The most common causes in order of likelihood:
1. **No NAT Gateway** — Lambda in a VPC gets a private IP from the subnet, not a public IP. It needs a NAT Gateway in a public subnet with a route `0.0.0.0/0 → NAT GW` in the private subnet's route table.
2. **Lambda is in a public subnet** — counterintuitive but: even in a public subnet, Lambda ENIs don't get public IPs. Must use private subnet + NAT.
3. **Security Group blocks outbound** — check that the Lambda's SG allows outbound 443/80 to `0.0.0.0/0`.
4. **NACL blocks outbound or inbound return** — verify NACL allows outbound 443 and inbound 1024–65535 (ephemeral ports).
5. **Missing VPC endpoint** — if the Lambda only needs to reach AWS services (S3, Secrets Manager, SSM), use VPC endpoints instead; cheaper and more reliable than routing through NAT.

See [Lambda](/aws-lambda-serverless) for the full Lambda VPC cold start and ENI attachment mechanics.

---

**Q: How do you design VPC networking for a 3-tier web application across 2 AZs?**

A: Use a `/16` VPC with 6 subnets across 2 AZs: `public-1a/1b` (10.0.1.0/24, 10.0.2.0/24), `private-app-1a/1b` (10.0.11.0/24, 10.0.12.0/24), `private-db-1a/1b` (10.0.21.0/24, 10.0.22.0/24). Public subnets route `0.0.0.0/0` to an IGW and host the ALB and one NAT Gateway per AZ. Private app subnets route to their AZ's NAT Gateway and host ECS/EKS tasks. Private DB subnets have no internet route (not even NAT) and host RDS Multi-AZ. Three security groups: ALB SG (allows 443 from `0.0.0.0/0`), app SG (allows 8080 from ALB SG), DB SG (allows 5432 from app SG). Gateway endpoints for S3 and DynamoDB eliminate NAT costs for those services.

---

**Q: What's AWS PrivateLink and when would you use it over VPC peering?**

A: PrivateLink exposes a service (backed by an NLB) as a private endpoint that consumers connect to via an Interface Endpoint in their own VPC. Traffic never crosses the public internet, and the consumer doesn't need peering or overlapping-CIDR awareness. Use PrivateLink when: (1) you want to expose a service to many consumers without granting full VPC access that peering implies; (2) the service provider and consumer have overlapping CIDRs (peering can't be used); (3) you're building a SaaS platform and want tenant isolation; (4) you need to cross organizational boundaries cleanly. PrivateLink is one-directional (consumer can reach the service, not vice versa). Peering is simpler for full bidirectional VPC-to-VPC connectivity within a small, trusted network.

---

**Q: How would you reduce data transfer costs in a multi-AZ architecture?**

A: Three levers: First, add Gateway endpoints for S3 and DynamoDB — free, removes NAT Gateway data processing costs for those services (often the biggest win). Second, analyze cross-AZ traffic with VPC Flow Logs + Athena — find top cross-AZ talkers and co-locate them or add per-AZ replicas for caches/databases. Third, audit Interface Endpoint break-even: if a service consumes more than ~417 GB/month through NAT, an Interface Endpoint is cheaper despite its $14.60/month base cost. Also review Data Transfer pricing: same-AZ traffic is free; cross-AZ is $0.01/GB each way; internet egress is $0.09/GB. See [Cost Optimization](/aws-cost-optimization) for comprehensive cost management patterns.

---

**Q: Design a hybrid network with HA connecting an on-premises data center to AWS.**

A: Production HA hybrid design:

```
On-prem DC (primary location)
  ├── DX 10 Gbps (DX Location A) ──[Private VIF]──► TGW (us-east-1)
  └── VPN IPsec (backup)         ──[VPN attach]──► TGW

On-prem DC (DR location, optional)
  └── DX 10 Gbps (DX Location B) ──[Private VIF]──► TGW (us-east-1)
```

BGP: DX routes advertised with lower MED (100), VPN with higher MED (200). TGW propagates routes to all attached VPCs. For multi-region: inter-region TGW peering with route tables that permit cross-region traffic selectively. DX uses a LAG (Link Aggregation Group) at each location for additional redundancy. On-prem DNS: Route 53 Outbound Resolver Endpoints forward `corp.local` to on-prem; Inbound Endpoints let on-prem resolve `aws.internal`. See [CloudFront & Route 53](/aws-cloudfront-route53) for global traffic distribution layered on top of this hybrid topology.

---

**Q: How does a Gateway Endpoint differ from an Interface Endpoint?**

A: Gateway endpoints (S3 and DynamoDB only) are implemented as route table entries — a prefix list pointing to the endpoint, not an ENI. They are completely free (no hourly charge, no data charge) and have no security group. Interface endpoints (all other services, including custom PrivateLink services) create an ENI in your subnet with a private IP. They cost $0.01/hr per AZ plus $0.01/GB. They have their own security group and support private DNS (the service's public DNS name resolves to the private ENI IP inside the VPC). Interface endpoints work across VPN and Direct Connect; Gateway endpoints do not (on-prem hosts must use Interface endpoints to reach S3 privately).

---

**Q: What happens to traffic routing if a NAT Gateway in one AZ fails?**

A: If you have **one shared NAT Gateway**: all private subnets route `0.0.0.0/0` to it. If it fails, all internet-bound traffic from all private subnets drops. Recovery requires creating a new NAT Gateway and updating route tables — not automatic.

If you have **per-AZ NAT Gateways** (correct pattern): each AZ's private subnets route to their local NAT Gateway. If AZ-1's NAT fails, only AZ-1 private subnets lose internet egress. AZ-2 is unaffected. You can manually update AZ-1's route table to point to AZ-2's NAT Gateway as a workaround (incurring cross-AZ transfer costs), but AWS recommends accepting the AZ-level failure rather than creating cross-AZ NAT dependency. The correct production response is fixing the failed AZ (NAT Gateways themselves rarely fail — usually the AZ itself has an outage) or failing over at the application layer.

---

**Q: Explain how Transit Gateway route tables enable network segmentation.**

A: Each TGW attachment (VPC, VPN, DX) is associated with exactly one TGW route table (which it uses for outbound route lookups) and can propagate its CIDR into multiple route tables. This creates fine-grained segmentation:

```
TGW rt-prod:   propagates from VPC-Prod-1, VPC-Prod-2, VPC-Shared, On-Prem-VPN
               → prod VPCs + shared services + on-prem can talk to each other

TGW rt-dev:    propagates from VPC-Dev, VPC-Shared
               → dev can reach shared services but NOT prod VPCs
               → on-prem can optionally be excluded

TGW rt-shared: propagates from all VPCs
               → shared services (DNS, monitoring, artifact repos) are reachable from everywhere
```

The key mechanic: `propagation` controls which CIDRs appear in a route table; `association` controls which route table an attachment consults for outbound traffic. A VPC associated with `rt-dev` only sees routes in `rt-dev` — it has no visibility into `rt-prod`'s routes even though those VPCs are attached to the same TGW. See [AWS Architecture](/aws-architecture) for multi-account, multi-VPC reference architectures using TGW as the network backbone.

---

## Red Flags to Avoid

- **Single NAT Gateway for all AZs** — saves ~$32/month, costs you an outage when the AZ or NAT has an issue
- **Putting Lambda in a public subnet expecting internet access** — Lambda ENIs never get public IPs; always use private subnet + NAT
- **Forgetting NACL ephemeral ports** — if you tighten NACLs, you must allow inbound 1024–65535 for return traffic or all TCP connections silently fail
- **Overlapping CIDRs when planning peering or TGW** — impossible to fix later without re-IP-ing; plan your CIDR allocation before provisioning
- **`0.0.0.0/0` security group rules on internal services** — app and DB tiers should never have `0.0.0.0/0` inbound; always reference the upstream SG ID
- **Not using VPC Gateway Endpoints for S3/DynamoDB** — free to add, immediate NAT cost reduction; there is no reason not to have them
- **Enabling `enableDnsHostnames` without `enableDnsSupport`** — the DNS resolver does not work; VPC endpoint private DNS breaks silently
- **VPC peering without updating both route tables** — the connection is established but traffic is one-way; always update both sides
- **Not propagating BGP routes from VGW/TGW** — static routes in route tables don't auto-update when on-prem prefixes change; enable route propagation
- **Attaching IGW but not adding it to route table** — IGW attachment is a prerequisite, not sufficient; the subnet's route table needs `0.0.0.0/0 → igw`
- **Using NACLs as a primary security control** — they are stateless, order-dependent, and lack SG-reference capability; reserve them for emergency blocking
- **Ignoring cross-AZ data transfer costs** — for data-heavy workloads, cross-AZ traffic at $0.01/GB each way adds up faster than EC2 or RDS costs
- **Direct Connect without VPN backup** — DX is reliable but not infallible; always provision a VPN tunnel as a BGP failover path
