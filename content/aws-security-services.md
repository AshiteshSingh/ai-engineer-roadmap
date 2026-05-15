# AWS Security Services

## The 30-Second Pitch
AWS security is a layered discipline. No single service is "the security service" — you compose WAF (L7 filtering), Shield (DDoS), GuardDuty (threat detection), Macie (data discovery), Inspector (CVE scanning), Security Hub (aggregation), Network Firewall (stateful packet inspection), and IAM Access Analyzer (policy risk) into a defense-in-depth stack. The interview trap is treating these as interchangeable. Each operates at a different layer, detects different attack classes, and integrates at a different point in your architecture. This article covers all eight services with concrete configurations, attack scenarios, and the cross-service automation patterns that separate juniors from seniors.

Related: [IAM & Security](/aws-iam-security) covers the IAM foundation that all of these services depend on.

---

## 1. AWS WAF — Web Application Firewall

### Core Model

WAF operates at Layer 7 (HTTP/HTTPS). It attaches to a **resource** and evaluates every request against a **Web ACL** (Access Control List).

Supported resources:
- Amazon CloudFront distributions
- Application Load Balancers (ALB)
- Amazon API Gateway (REST + HTTP APIs)
- AWS AppSync (GraphQL)
- Amazon Cognito User Pools
- AWS App Runner, Verified Access

**Web ACL** is the container. Each Web ACL has:
1. An ordered list of **rules** (each with a priority number — lower = evaluated first)
2. A **default action**: `Allow` or `Block` (what happens when no rule matches)

**Rule** structure: a `Statement` that matches requests + an `Action` (Allow / Block / Count / CAPTCHA / Challenge).

**WCU (Web ACL Capacity Units)**: each rule type has a WCU cost. Default limit: 1,500 WCU per Web ACL (can be raised). Managed rule groups cost more WCU than simple IP set rules.

| Rule Type | Approximate WCU Cost |
|---|---|
| IP set match | 1 |
| Geo match | 1 |
| Regex pattern set | 25 |
| Rate-based rule | 2 |
| `AWSManagedRulesCommonRuleSet` | 700 |
| `AWSManagedRulesBotControlRuleSet` (Common) | 50 |

---

### AWS Managed Rule Groups

These are maintained by AWS. You subscribe to them — no need to write rules from scratch.

**`AWSManagedRulesCommonRuleSet` (CRS)**
The baseline for every web application. Covers OWASP Top 10: SQL injection, XSS, command injection, path traversal, SSRF primitives, protocol violations. ~700 WCU. Start here.

**`AWSManagedRulesKnownBadInputsRuleSet`**
Blocks known bad inputs beyond OWASP — includes Log4Shell (`${jndi:ldap://...}` payloads), Spring4Shell, exposed `.git` paths, common vulnerability scanners. ~200 WCU.

**`AWSManagedRulesAmazonIpReputationList`**
Amazon threat intelligence: known botnets, compromised hosts, scanners, Tor exit nodes. Updated continuously. ~25 WCU. Low cost, high value — add this to every Web ACL.

**`AWSManagedRulesSQLiRuleSet`**
Deep SQL injection detection beyond what CRS covers — multiple encoding bypass patterns, blind SQLi, time-based SQLi signatures. Use alongside CRS for SQL-heavy applications. ~200 WCU.

**`AWSManagedRulesBotControlRuleSet`**
Bot detection with two tiers:
- **Common** (free with WAF): block scrapers, fake user agents, non-browser clients, credential stuffing signatures
- **Targeted** ($1.50/million requests): JavaScript fingerprinting, browser interrogation, bot signature detection — catches sophisticated bots that mimic real browsers

Third-party managed groups (AWS Marketplace): F5 Rules for AWS WAF, Imperva, Fortinet, Trend Micro — useful if you already have vendor relationships.

---

### Custom Rules

**Rate-based rule** — block an IP that exceeds N requests in any 5-minute window. The most effective single rule against credential stuffing, brute force, and L7 DDoS:

```json
{
  "Name": "RateLimit-PerIP",
  "Priority": 1,
  "Action": { "Block": {} },
  "Statement": {
    "RateBasedStatement": {
      "Limit": 2000,
      "AggregateKeyType": "IP"
    }
  },
  "VisibilityConfig": {
    "SampledRequestsEnabled": true,
    "CloudWatchMetricsEnabled": true,
    "MetricName": "RateLimit-PerIP"
  }
}
```

Aggregate key options: `IP`, `FORWARDED_IP` (for requests behind a proxy), `HTTP_HEADER`, `HTTP_METHOD`, `QUERY_STRING`, `URI_PATH` — or a custom composite of multiple fields.

**Geo-block rule** — deny requests from countries that have no legitimate users of your application:
```json
{
  "Name": "GeoBlock-HighRisk",
  "Priority": 2,
  "Action": { "Block": {} },
  "Statement": {
    "GeoMatchStatement": {
      "CountryCodes": ["KP", "IR", "CU"]
    }
  }
}
```

**IP set rule** — allowlist your office IPs for admin endpoints; blocklist known bad IPs from threat feeds. IP sets can be managed via API and updated without modifying the Web ACL.

**Label-based chaining** — attach a label in one rule, match it in another. Example: label requests from Tor exit nodes in rule 10, then block requests that are both labeled Tor AND targeting `/api/login` in rule 20. This enables multi-condition logic without a single complex rule.

**Count mode** — before switching any rule to `Block`, set it to `Count` first. Watch `CountedRequests` metrics in CloudWatch for 24–48 hours to verify false-positive rate. Then switch to `Block`.

---

### WAF Logging and Metrics

**Logging destinations** (configure one or more):
- Kinesis Data Firehose → S3 or OpenSearch Service (recommended for analysis at scale)
- CloudWatch Logs (for real-time alerting)
- S3 directly (cheapest, batch analysis)

**Log redaction**: mask sensitive headers before they hit the log destination. Standard practice: redact `Authorization` and `Cookie` headers to avoid storing tokens and session credentials in logs.

```json
{
  "LoggingConfiguration": {
    "RedactedFields": [
      { "SingleHeader": { "Name": "authorization" } },
      { "SingleHeader": { "Name": "cookie" } }
    ]
  }
}
```

**CloudWatch metrics** per Web ACL and per rule:
- `AllowedRequests` — total requests that passed
- `BlockedRequests` — total requests blocked
- `CountedRequests` — requests matched by count-mode rules
- `PassedRequests` — requests evaluated but not blocked by rule group

Set CloudWatch alarms: alert when `BlockedRequests` spikes (attack underway) or when `BlockedRequests` drops to zero on a production ACL that normally blocks traffic (WAF misconfiguration or detachment).

---

## 2. AWS Shield — DDoS Protection

### Shield Standard

**Free, automatic, always-on** for every AWS customer. No configuration required.

Protects against the most common volumetric L3/L4 DDoS attacks:
- SYN floods
- UDP reflection attacks (DNS amplification, NTP amplification, SSDP)
- ICMP floods
- Volumetric attacks up to hundreds of Gbps

AWS absorbs these attacks at the network edge before they reach your resources. You don't get visibility into Standard mitigations — they just happen.

---

### Shield Advanced

**$3,000/month** (committed 12-month subscription) + data transfer out fees. One subscription covers unlimited protected resources across the account.

What you get beyond Standard:

| Feature | Detail |
|---|---|
| L7 DDoS protection | For ELB, CloudFront, API Gateway, EC2 (via Elastic IP) |
| Route 53 health check integration | Automatically detects availability impact |
| DDoS cost protection | AWS credits for EC2/data transfer bills that spike due to attack |
| Real-time attack visibility | Shield dashboard: attack vector, magnitude, mitigation status |
| Advanced diagnostics | Post-event analysis reports |
| DDoS Response Team (DRT) access | 24/7 AWS security engineers during active attacks |
| Proactive engagement | DRT contacts you before an attack degrades availability |
| Automatic application layer protection | WAF rules auto-created during a detected L7 attack |

**Shield Advanced SRT** (DDoS Response Team): before an attack, they review your WAF rules and suggest improvements. During an attack, they write custom WAF rules to mitigate the specific attack pattern in real time. This is the main differentiator for large-scale internet-facing applications.

**When to buy Shield Advanced**: financial services, gaming backends, media streaming, e-commerce during peak events. If your revenue-per-minute during downtime exceeds the monthly fee, it pays for itself in one incident.

**Shield vs WAF — the split**:
- Shield handles **volumetric** L3/L4 attacks (bandwidth exhaustion, protocol attacks)
- WAF handles **application-layer** L7 attacks (SQLi, XSS, HTTP floods, credential stuffing)
- For L7 DDoS (HTTP flood), you need both: Shield Advanced detects the attack pattern, WAF blocks the traffic

---

## 3. Amazon GuardDuty — Threat Detection

GuardDuty is a **managed threat detection service** — it consumes logs you're already generating and runs ML + threat intelligence against them to surface findings. You do not need to configure detection rules. You enable it and findings appear.

### What It Analyzes

| Data Source | What It Finds |
|---|---|
| VPC Flow Logs | Port scanning, unusual outbound connections, C2 traffic |
| DNS logs | DNS tunneling, requests to malware C2 domains |
| CloudTrail management events | API abuse, privilege escalation, unusual access patterns |
| CloudTrail S3 data events | S3 data exfiltration, unusual GetObject volume |
| EKS audit logs | Container escape attempts, exec into pods, privilege misuse |
| RDS login events | Brute force against RDS, successful auth from unusual IPs |
| Lambda network activity | Lambda calling known malicious IPs, C2 communication |
| EBS malware scanning | Malware in EBS volumes of flagged instances |
| S3 object scanning (Malware Protection) | Malware in objects uploaded to S3 |

---

### Finding Types (know these cold)

GuardDuty findings follow the format `ThreatPurpose:ResourceType/ThreatFamilyName`.

**Credential theft / exfiltration:**
- `UnauthorizedAccess:IAMUser/InstanceCredentialExfiltration.OutsideAWS` — EC2 instance credentials (from the metadata service) are being called from an IP outside AWS. This is the #1 critical finding. Instance credentials should never leave AWS.
- `UnauthorizedAccess:IAMUser/ConsoleLoginSuccess.B` — console login from an unusual country

**Malware / C2:**
- `Backdoor:EC2/C&CActivity.B` — EC2 instance communicating with a known command-and-control server
- `Trojan:EC2/BlackholeTraffic` — instance connecting to a known blackhole domain (malware C2)

**Cryptomining:**
- `CryptoCurrency:EC2/BitcoinTool.B` — EC2 sending requests to a Bitcoin mining pool
- `CryptoCurrency:EC2/BitcoinTool.B!DNS` — DNS query to a known mining pool domain

**Data exfiltration:**
- `Exfiltration:S3/AnomalousBehavior` — S3 GetObject/ListBuckets patterns deviate significantly from the principal's baseline
- `Exfiltration:S3/ObjectRead.Unusual` — large volume of object reads from an unusual IP

**Privilege escalation:**
- `PrivilegeEscalation:IAMUser/AdministrativePermissions` — IAM user attaching admin policies to themselves
- `PrivilegeEscalation:Lambda/RolePolicy` — Lambda function modifying its own execution role

**Reconnaissance:**
- `Recon:EC2/PortProbeUnprotectedPort` — external IP probing ports on your EC2 instance
- `Recon:IAMUser/NetworkPermissions` — API calls enumerating network configuration

**Pen test tools:**
- `PenTest:IAMUser/KaliLinux` — API calls with Kali Linux user agent (attacker using Kali, or someone testing)
- `PenTest:IAMUser/ParrotLinux` — same pattern for Parrot OS

---

### Integration and Automated Response

**GuardDuty → EventBridge → Lambda** is the standard automated response pattern:

```
GuardDuty finding
  → EventBridge rule (filter by finding type / severity)
    → Lambda function
      → EC2: change security group to quarantine SG (no inbound/outbound)
      → IAM: call sts:RevokeOldCredentials or attach DenyAll policy to role
      → SNS: notify security team
      → Systems Manager: run a forensic investigation runbook
```

Example Lambda response to `InstanceCredentialExfiltration`:
1. Identify the EC2 instance from the finding
2. Attach a deny-all SCP-equivalent inline policy to the instance's IAM role
3. Create an EBS snapshot for forensics
4. Move the instance into an isolated security group (no 0.0.0.0/0 rules)
5. Post alert to security Slack channel via SNS

**Multi-account setup** (required at scale): designate a **GuardDuty administrator account** (usually the security tooling account in AWS Organizations). Member accounts are enrolled via Organizations. All findings flow to the administrator account for centralized review.

**GuardDuty does NOT replace**: WAF (doesn't block requests in real time), Inspector (doesn't scan for CVEs), or CloudTrail (doesn't log API calls — it consumes CloudTrail but doesn't replace it).

---

## 4. Amazon Macie — S3 Data Discovery

Macie uses ML to find **sensitive data** in S3. It is specifically S3-focused — no other service.

### What Macie Detects

**Sensitive data categories:**
- PII: SSN, driver's license, passport number, date of birth, phone number, email address
- Financial: credit card numbers (PCI data), bank account numbers, routing numbers
- Credentials: AWS access keys, private keys, passwords, API tokens
- Health data: PHI covered by HIPAA (diagnosis codes, patient IDs, NPI numbers)
- Custom data identifiers: regex + keyword patterns you define (e.g., internal employee IDs)

**Two scan modes:**
- **Automated sensitive data discovery**: continuous background scanning of all S3 buckets. Samples objects using statistical sampling — does not scan every byte of every object. Designed for continuous visibility at low cost.
- **Sensitive data discovery jobs**: targeted scans of specific buckets/prefixes/object types. Scans every matching object. Use for compliance audits and one-time deep scans.

### Finding Types

**Sensitive data findings**: exact location of sensitive data — bucket name, object key, line number, column offset.

**Policy findings** (bucket configuration problems):
- `Policy:IAMUser/S3BlockPublicAccessDisabled` — someone disabled S3 Block Public Access on a bucket
- `Policy:IAMUser/S3BucketSharedExternally` — bucket policy grants access to an external AWS account or public
- `Policy:IAMUser/S3BucketEncryptionDisabled` — bucket allows unencrypted uploads
- `Policy:IAMUser/S3BucketReplicatedExternally` — replication is configured to an external account

### Integration Pattern

```
Macie finding
  → EventBridge rule
    → Lambda:
        - Tag S3 object with "sensitivity=HIGH"
        - Block public access on bucket
        - SNS alert to DLP team
        - Write finding to Security Hub (ASFF format)
```

**Cost**: $1/bucket/month for automated discovery (first 30 days free). $0.10–$1.00/GB for sensitive data discovery jobs (varies by object type). At scale, automated discovery is cheap; jobs are metered.

**PCI/HIPAA use case**: run a Macie job before any data migration to verify no PII/PHI is in the wrong S3 bucket. This is also a common audit requirement.

---

## 5. Amazon Inspector — Vulnerability Assessment

Inspector v2 (current) is fundamentally different from v1: it is **always-on and continuous**, not manually triggered.

### What Inspector Scans

| Target | What It Finds |
|---|---|
| EC2 instances | OS-level CVEs (via SSM agent), network reachability to open ports |
| ECR container images | CVEs in OS packages and language packages (npm, pip, gem, Maven, NuGet) |
| Lambda functions | CVEs in function dependencies + Lambda layer packages |

**Inspector score** = base CVSS score × network reachability factor × active exploit availability. An EC2 instance with a critical CVE that has an active exploit AND a public-facing port gets the highest score. Same CVE on an instance with no public network path scores lower.

**ECR scanning workflow**:
1. Image pushed to ECR → Inspector scans immediately
2. New CVE added to NVD database → Inspector re-scans existing images without a push
3. Findings appear in Inspector console + Security Hub

**Lambda scanning**: checks all packages in `requirements.txt`, `package.json`, `Gemfile.lock`, `pom.xml`, etc. Also scans Lambda layers. Runs on function creation + on each new deployment.

### Integration with CI/CD

Block deployments if critical CVEs are present. Example in a CodePipeline stage after the ECR push:

```bash
# Query Inspector findings for the just-pushed image
aws inspector2 list-findings \
  --filter-criteria '{
    "ecrImageRepositoryName": [{"comparison":"EQUALS","value":"my-app"}],
    "ecrImageTags": [{"comparison":"EQUALS","value":"'"$IMAGE_TAG"'"}]
  }' \
  --query 'findings[?inspectorScore > `9.0`].title' \
  --output text

# If output is non-empty, fail the pipeline stage
```

For ECR, you can also configure **enhanced scanning** at the repository level and use `scanFrequency: CONTINUOUS_SCAN`. When combined with lifecycle policies that block images with CRITICAL findings from being tagged as `latest`, you get automatic deployment gates.

**Inspector does NOT**: do runtime threat detection (that's GuardDuty), scan non-AWS infrastructure, or monitor for active exploitation (it finds the vulnerability, not the exploit attempt).

---

## 6. AWS Security Hub — Centralized Findings

Security Hub is the **aggregation and normalization layer**. It does not generate findings of its own — it collects findings from other services.

### Data Sources

Security Hub ingests findings from:
- Amazon GuardDuty
- Amazon Inspector
- Amazon Macie
- AWS Firewall Manager
- IAM Access Analyzer
- AWS Systems Manager Patch Manager
- AWS Config
- Third-party integrations (Splunk, Palo Alto, CrowdStrike, etc.)

All findings are normalized to **ASFF (AWS Security Finding Format)** — a standard JSON schema with fields like `Severity`, `Types`, `Resources`, `Remediation`, `WorkflowState`.

### Security Standards

Security Hub continuously evaluates your environment against compliance frameworks:

| Standard | What It Checks |
|---|---|
| AWS Foundational Security Best Practices (FSBP) | AWS-specific best practices (~300 controls) |
| CIS AWS Foundations Benchmark v1.4 / v3.0 | CIS hardening baseline |
| PCI DSS v3.2.1 | Payment card industry requirements |
| NIST SP 800-53 Rev. 5 | US federal security controls |

**Commonly failed FSBP controls** and their fixes:

| Control | Failure Condition | Fix |
|---|---|---|
| `EC2.6` | VPC Flow Logs disabled | Enable on VPC via Terraform or console |
| `IAM.1` | No MFA on root account | Enable hardware MFA on root (cannot be automated — manual) |
| `S3.1` | S3 Block Public Access not enabled at account level | `aws s3control put-public-access-block --account-id ...` |
| `CloudTrail.1` | CloudTrail not enabled in all regions | Enable multi-region trail with S3 logging |
| `Config.1` | AWS Config not enabled | Enable Config recorder with all resource types |
| `GuardDuty.1` | GuardDuty not enabled | Enable via Organizations across all accounts |

### Automation Rules and Workflow

**Security Hub Automation Rules** (native, no Lambda needed for simple cases):
- Suppress known false positives: if finding title matches `X` and resource tag is `env=dev`, suppress it
- Auto-assign severity: elevate all Inspector findings with CVSS > 8.0 to CRITICAL
- Set workflow status: move findings to `RESOLVED` when the underlying issue is fixed

**EventBridge integration** for complex responses:
```
Security Hub finding (ASFF)
  → EventBridge rule: { "source": ["aws.securityhub"], "detail.findings.Severity.Label": ["CRITICAL"] }
    → Lambda / Step Functions:
        - Create Jira ticket with finding details
        - Post to #security-alerts Slack channel
        - Trigger automated remediation runbook
```

**Cross-account aggregation**: designate a **Security Hub aggregator region**. Enable finding aggregation from all regions and all member accounts (via Organizations). One pane of glass for the entire org.

---

## 7. AWS Network Firewall

Network Firewall provides **VPC-level stateful packet inspection** — the layer between Security Groups/NACLs and WAF.

### Layer Comparison

| Control | Layer | Stateful? | Scope |
|---|---|---|---|
| Security Groups | L3/L4 | Stateful (connection tracking) | ENI level |
| NACLs | L3/L4 | Stateless (per-packet) | Subnet level |
| AWS Network Firewall | L3–L7 | Both (stateless fast path + stateful IPS) | VPC level |
| AWS WAF | L7 | Stateful | CloudFront/ALB/API GW |

### Deployment Pattern

Network Firewall is deployed in a **dedicated firewall subnet** in each AZ. Traffic is routed through it via route table manipulation:

```
Internet Gateway
  → Firewall subnet (Network Firewall endpoint)
    → Application subnet (EC2, ECS, etc.)
```

For multi-VPC architectures: deploy Network Firewall in an **inspection VPC** and route all inter-VPC and internet traffic through it via Transit Gateway. This is the centralized inspection model.

### Rule Types

**Stateless rules** (5-tuple, evaluated first): source IP, dest IP, source port, dest port, protocol. Fast path — processed at line rate. Actions: pass, drop, forward to stateful engine.

**Stateful rules** (three formats):
1. **5-tuple rules**: like NACLs but stateful — block TCP from specific CIDRs
2. **Domain list rules**: allow or block by domain name (FQDN). Inspects SNI in TLS + HTTP Host header. Use for egress filtering:
   ```
   ALLOWLIST mode: only allow *.amazonaws.com, *.python.org, api.stripe.com
   ```
3. **Suricata-compatible IDS/IPS rules**: full Suricata rule syntax for content inspection, protocol analysis, regex matching

**Suricata rule examples:**

Block DNS queries to known malware C2:
```
alert dns $HOME_NET any -> any 53 (msg:"Malware C2 DNS Query"; dns.query; content:"malware.evil.com"; nocase; sid:1000001; rev:1;)
```

Detect HTTP traffic with Log4Shell payload:
```
alert http $EXTERNAL_NET any -> $HTTP_SERVERS any (msg:"Log4Shell JNDI Injection Attempt"; http.uri; content:"${jndi:"; fast_pattern; nocase; sid:1000002; rev:1;)
```

Block outbound SMTP (prevent EC2 spam):
```
drop tcp $HOME_NET any -> any 25 (msg:"Block outbound SMTP"; sid:1000003; rev:1;)
```

### Logging

Configure logging for:
- **Alert logs**: packets that matched drop/alert rules (your IDS events)
- **Flow logs**: all accepted TCP/UDP/ICMP flows (full traffic visibility)

Destinations: S3, Kinesis Data Firehose, CloudWatch Logs.

### AWS Firewall Manager

Firewall Manager is the **centralized policy management** layer for:
- AWS WAF (Web ACL policies across all accounts)
- Shield Advanced (apply to all ALBs/CloudFront distributions)
- Network Firewall (deploy firewall policies to all VPCs)
- Security Groups (enforce baseline SG rules, audit over-permissive rules)
- Route 53 DNS Firewall

Use Firewall Manager when you have 10+ accounts. Without it, managing WAF rules across 50 accounts is manual and error-prone.

---

## 8. IAM Access Analyzer

Access Analyzer analyzes **resource-based policies** to find unintended external access. The key question it answers: "Can someone outside my account/organization access this resource?"

### What It Analyzes

Resources analyzed for external access:
- S3 buckets and access points
- IAM roles (trust policies)
- KMS keys (key policies)
- Lambda functions and layers (resource-based policies)
- SQS queues
- SNS topics
- Secrets Manager secrets

**Finding example**: "S3 bucket `prod-data` allows `s3:GetObject` by `*` (public)" or "IAM role `DataRole` can be assumed by account `555555555555` (external)".

### Three Analyzer Types

| Analyzer | Zone of Trust | Flags Access From |
|---|---|---|
| Account | Single AWS account | Outside the account |
| Organization | Entire AWS Organization | Outside the organization |
| Unused access | Account | Roles/keys/permissions unused >90 days |

### Policy Validation

Before deploying any IAM policy, validate it:
```bash
aws accessanalyzer validate-policy \
  --policy-document file://policy.json \
  --policy-type IDENTITY_POLICY
```

Returns: `ERROR` (syntax/logic errors), `WARNING` (best practice violations), `SUGGESTION` (improvement opportunities), `SECURITY_WARNING` (privilege escalation risks).

Integrate into CI/CD: fail the PR if `validate-policy` returns `SECURITY_WARNING` or `ERROR`.

### Policy Generation (Least Privilege)

Access Analyzer can **generate a least-privilege policy** by analyzing CloudTrail:

1. Enable CloudTrail (must have been running during the observation period)
2. Call `GeneratePolicy` for a specific IAM principal
3. Access Analyzer replays all CloudTrail events for that principal
4. Output: a policy with only the exact actions and resources that principal actually used

This is the most practical path to least privilege for existing roles that have accumulated too many permissions over time.

### Unused Access Analyzer

Finds:
- IAM roles with no activity in >90 days
- Access keys not used in >90 days
- Permissions granted but never exercised (permission-level unused access)

Action: periodically review the unused access findings and remove or disable stale roles/keys. This is a compliance requirement in SOC 2, PCI DSS, and ISO 27001.

---

## 9. Security Reference Architecture

### Defense-in-Depth Layers

```
Internet
  ↓
AWS Shield Standard/Advanced (L3/L4 DDoS)
  ↓
Amazon CloudFront + WAF (L7 filtering, geo-block, rate limit, OWASP rules)
  ↓
AWS Network Firewall (stateful IPS, domain filtering, Suricata rules)
  ↓
Application Load Balancer + WAF (second WAF layer for internal traffic)
  ↓
App Tier — EC2/ECS/Lambda (Security Groups: least-privilege inbound/outbound)
  ↓
DB Tier (Security Groups: allow only app tier; KMS encryption at rest)
  ↓
IAM (least privilege roles; no wildcard actions; permission boundaries on dev roles)
  ↓
GuardDuty (continuous threat detection across all layers)
  ↓
CloudTrail + Security Hub (audit log + centralized findings)
```

Each layer fails independently — a misconfiguration at one layer does not expose the resource directly.

### Security Account Structure (AWS Organizations)

Recommended account layout:

| Account | Purpose | What Lives Here |
|---|---|---|
| Management account | Organization root | SCPs only — zero workloads |
| Security tooling account | Centralized detection | GuardDuty administrator, Security Hub aggregator, Macie administrator, IAM Access Analyzer org-level |
| Log archive account | Immutable audit logs | CloudTrail org trail → S3 (deny-delete bucket policy), Config history |
| Audit account | Read-only access for auditors | Cross-account read-only IAM roles into all accounts |
| Shared services account | Shared infra | DNS, VPN, Transit Gateway, Network Firewall inspection VPC |
| Workload accounts | Applications | Dev / Staging / Prod (separate accounts per environment) |

**SCPs on the management account** enforce non-negotiables: prevent CloudTrail deletion, prevent GuardDuty disabling, prevent leaving the Organization, restrict to approved regions.

---

## Interview Q&A

**Q: How would you protect an API Gateway endpoint from SQL injection and DDoS?**

A: Two-layer approach. Attach a WAF Web ACL to the API Gateway with: (1) `AWSManagedRulesCommonRuleSet` for SQLi/XSS/OWASP coverage, (2) `AWSManagedRulesSQLiRuleSet` for deep SQL injection coverage, (3) a rate-based rule capping each IP at 1,000 requests/5 minutes. For DDoS: Shield Standard is automatic and handles L3/L4. Shield Advanced adds L7 DDoS detection with automatic WAF rule creation during attacks. For egress control: Network Firewall if the API calls external services, blocking unexpected outbound destinations.

---

**Q: Explain GuardDuty's detection capabilities. What does it NOT protect against?**

A: GuardDuty uses ML trained on a baseline of normal behavior for each account, combined with Amazon and third-party threat intelligence feeds. It detects: credential abuse (stolen keys used from unusual locations), malware C2 communication, cryptomining, data exfiltration anomalies, privilege escalation, network scanning, and pen test tool signatures. What it does NOT do: block traffic in real time (it detects, does not prevent), scan for CVEs (that's Inspector), protect web app layer (that's WAF), discover sensitive data in S3 (that's Macie), or validate IAM policy configuration (that's Access Analyzer).

---

**Q: What's the difference between AWS WAF, Shield, and Network Firewall?**

A: WAF = L7 HTTP/HTTPS filtering (SQLi, XSS, rate limiting, bot detection) attached to CloudFront/ALB/API GW. Shield = DDoS protection: Standard (free, L3/L4 volumetric) and Advanced (paid, adds L7 + DRT + cost protection). Network Firewall = VPC-level stateful IPS (Suricata rules, domain filtering, 5-tuple rules) for east-west traffic, VPC egress, and traffic that doesn't flow through a CloudFront/ALB WAF attachment point. They are complementary: WAF handles app-layer attacks at the edge; Shield handles bandwidth/protocol attacks; Network Firewall handles internal network traffic inspection.

---

**Q: How do you implement automated incident response when GuardDuty detects compromised credentials?**

A: GuardDuty emits the finding `UnauthorizedAccess:IAMUser/InstanceCredentialExfiltration.OutsideAWS`. EventBridge rule matches on finding type → triggers Lambda. Lambda steps: (1) parse the affected EC2 instance ID and IAM role from the finding, (2) attach an inline deny-all policy to the IAM role to invalidate all active sessions (`sts:RevokeOldCredentials` only works for AssumeRole sessions; an explicit Deny in IAM policy is more reliable), (3) move the EC2 instance to a quarantine security group (no inbound, no outbound except to forensics S3 bucket), (4) create an EBS snapshot, (5) post full finding details to SNS → Slack/PagerDuty. Document as a runbook in SSM Automation so the Lambda response is auditable and can be manually invoked too.

---

**Q: What is Security Hub and how does it relate to GuardDuty and Macie?**

A: Security Hub is the aggregation and compliance layer. GuardDuty and Macie generate findings independently — Security Hub ingests those findings (normalized to ASFF), adds compliance framework mapping (is this finding a FSBP violation? a CIS control failure?), and provides a unified dashboard. Security Hub also evaluates ~300 FSBP controls by querying AWS Config — these are configuration checks (is MFA enabled? is CloudTrail running?) rather than threat detections. In a well-architected org: GuardDuty → Security Hub, Macie → Security Hub, Inspector → Security Hub, all flowing to one EventBridge → SIEM integration.

---

**Q: How would you use Amazon Inspector in a CI/CD pipeline to prevent vulnerable container deployments?**

A: Configure ECR with enhanced scanning (`CONTINUOUS_SCAN`). In the CodePipeline or GitHub Actions workflow, after the `docker push`: query `aws inspector2 list-findings` filtered to the specific image digest and tag. Parse the response for findings with `inspectorScore > 9.0` (CRITICAL). If any exist, fail the pipeline stage and post the CVE details as a PR comment. For the actual enforcement gate, use an ECR lifecycle policy in combination with an image signing step (AWS Signer + ECR image signing) so only images that passed the Inspector check get signed, and the runtime (ECS task definition / EKS admission controller) only allows signed images.

---

**Q: A GuardDuty finding shows EC2 instance credentials are being used from an external IP. What do you do?**

A: This is `UnauthorizedAccess:IAMUser/InstanceCredentialExfiltration.OutsideAWS` — treat as active breach. Immediate actions (minutes): (1) Identify the EC2 instance from the `resource.instanceDetails` field in the finding. (2) Attach a deny-all inline policy to the instance's IAM role — this immediately invalidates all API calls using those credentials, regardless of where they're being called from. (3) Quarantine the instance: replace its security group with an isolation SG. (4) Snapshot EBS volumes before any changes. Investigation (next hour): (5) Review CloudTrail for all API calls made with those credentials (from both inside and outside AWS) in the window before and after the finding. (6) Determine how the credentials were exfiltrated — SSM session logs, application logs, IMDSv1 access logs. (7) Check if IMDSv2 was not enforced (IMDSv1 + SSRF is the classic exfiltration path — enforce `HttpTokens: required` on all instances). Remediation: rotate all secrets that instance could access, review what actions were taken with the leaked credentials (look for IAM changes, S3 access, new resources created).

---

**Q: Explain IAM Access Analyzer's policy generation feature. How does it improve least privilege?**

A: Most IAM roles in mature AWS accounts have accumulated permissions over years — developers add what they need but never remove what they no longer need. Access Analyzer's `GeneratePolicy` operation solves this by replaying actual CloudTrail usage. Given a principal and a time window (up to 90 days of CloudTrail history), it produces a policy that contains exactly the `Action` + `Resource` combinations that principal actually called. This is ground-truth least privilege rather than best-guess least privilege. The workflow: run GeneratePolicy in staging or dev (where the role has been exercised fully), review the output, replace the existing over-permissive policy. One caveat: it only captures actions that were actually invoked during the observation period — if a permission is needed for a disaster recovery scenario that didn't run, it won't appear. Supplement with manual review of DR runbooks.

---

**Q: How do you architect a centralized security monitoring setup across 50 AWS accounts?**

A: Use AWS Organizations throughout. (1) **GuardDuty**: designate the security tooling account as administrator via Organizations. All member accounts auto-enroll. All findings aggregate in the admin account. (2) **Security Hub**: enable auto-enrollment via Organizations. Configure a single aggregator region. All findings from all accounts and all regions flow to one place. (3) **CloudTrail**: create an organization trail in the management account — all API calls from all accounts go to a single S3 bucket in the log archive account (with a deny-delete bucket policy). (4) **Macie**: security tooling account as Macie administrator — auto-enables on new accounts via Organizations. (5) **AWS Config**: organization-level Config aggregator — collects resource configuration history and compliance data across all accounts. (6) **EventBridge**: in the security tooling account, create EventBridge rules that route CRITICAL/HIGH findings to Lambda for auto-remediation and to SNS for alerting. (7) **Firewall Manager**: manage WAF, Shield Advanced, and Network Firewall policies centrally from the security tooling account.

---

**Q: What is the AWS Network Firewall and when is it needed over Security Groups + NACLs?**

A: Security Groups and NACLs are L3/L4 controls — they can block by IP, port, and protocol but cannot inspect packet content. Network Firewall adds: Suricata-compatible L7 inspection (inspect HTTP/DNS/TLS payload content), domain-based filtering (block all DNS/HTTP traffic to `*.malware.com` or only allow traffic to an approved domain list), stateful flow tracking across connections, and IDS/IPS alert logging. Use Network Firewall when you need: (1) egress filtering for EC2/ECS workloads (allow access only to specific domains), (2) east-west traffic inspection between VPCs via TGW, (3) detection of application-layer threats in non-HTTP traffic (where WAF can't help), (4) compliance requirements that mandate IDS/IPS at the network layer. Security Groups + NACLs are sufficient for basic inbound traffic restriction; Network Firewall is for environments that need defense-in-depth with content inspection.

---

**Q: How would you detect and respond to a cryptomining attack on EC2?**

A: **Detection**: GuardDuty finding `CryptoCurrency:EC2/BitcoinTool.B` (outbound connection to mining pool IP) or `CryptoCurrency:EC2/BitcoinTool.B!DNS` (DNS query to mining pool domain). Also watch for: `Backdoor:EC2/C&CActivity.B` (the initial compromise), and CloudWatch metrics showing CPU spike to 100% sustained on EC2 (set a CloudWatch alarm: `CPUUtilization > 90% for 30 minutes`). **Response**: EventBridge rule on `CryptoCurrency:EC2/*` finding → Lambda: (1) quarantine instance (isolation SG), (2) snapshot EBS for forensics, (3) deny IAM role to prevent lateral movement, (4) notify security team. **Investigation**: how was the instance compromised? Check for: IMDSv1 + SSRF exploit (credential theft), unpatched CVE (Inspector findings), exposed SSH port (GuardDuty `Recon:EC2/PortProbeUnprotectedPort` may have preceded this), or compromised AMI. **Prevention**: enforce IMDSv2 everywhere, enable Inspector for continuous CVE scanning, block outbound connections to mining pool IPs via Network Firewall or GuardDuty + automated response.

---

## Red Flags to Avoid

- Using WAF Count mode as a permanent setting — Count never blocks anything. It's for testing only. After validating the false-positive rate, switch to Block.
- Attaching WAF only to CloudFront and not to ALB — internal or direct-to-ALB traffic bypasses WAF entirely. Protect both.
- Enabling GuardDuty but ignoring findings — GuardDuty findings require action. An unreviewed CRITICAL finding is a breach you chose to ignore. Set up EventBridge → SNS alerting on HIGH/CRITICAL findings.
- Confusing Shield Standard and Shield Advanced — Standard is free and automatic. Advanced is $3K/month and requires opting in. Not the same thing in an interview.
- Running Inspector v1 (manual, deprecated) — Inspector v2 is always-on and continuous. If your interview answer involves "schedule a scan", you're describing v1.
- Deploying Network Firewall but not updating route tables — Firewall endpoints are not auto-inserted into the data path. You must update route tables to route traffic through the firewall endpoint. Without this, Network Firewall does nothing.
- Using IAM Access Analyzer only for finding external access and missing the unused access and policy generation features — all three analyzer types have distinct value.
- Building Security Hub without EventBridge automation — Security Hub without automated response is a compliance dashboard, not a security posture. CRITICAL findings need automated triage.
- Not enforcing IMDSv2 on EC2 — IMDSv1 + any SSRF vulnerability = instant credential theft. `HttpTokens: required` should be a default in your AMI pipeline or enforced via Config rule.
- Conflating Macie and Inspector — Macie finds sensitive data in S3 objects. Inspector finds CVEs in software packages. They do not overlap.

---

**Related articles:**
- [IAM & Security](/aws-iam-security) — IAM policy evaluation, SCP patterns, and the IAM foundation all security services build on
- [VPC & Networking](/aws-vpc-networking) — Network Firewall placement architecture, WAF + CloudFront topology
- [AWS Architecture](/aws-architecture) — Security pillar of the Well-Architected Framework, defense-in-depth design
- [Observability](/aws-observability) — CloudTrail integration, Security Hub → alerting pipelines
- [CI/CD & DevOps](/aws-cicd-devops) — Inspector in CI/CD pipelines, policy validation in PR gates
- [Compute & Containers](/aws-compute-containers) — ECR container image scanning, ECS/EKS security posture
- [Lambda](/aws-lambda-serverless) — Lambda scanning with Inspector, automated remediation functions
- [Cost Optimization](/aws-cost-optimization) — Shield Advanced pricing model, WAF Bot Control cost tiers
