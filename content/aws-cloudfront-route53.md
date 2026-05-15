# AWS CloudFront & Route 53

## The 30-Second Pitch

CloudFront is AWS's global CDN — 600+ Points of Presence that cache your content at the edge, terminate TLS, and run code within milliseconds of your users. Route 53 is AWS's authoritative DNS service with intelligent traffic routing: latency-based, geolocation, weighted, and failover policies. Together they form the outermost layer of every serious AWS architecture — Route 53 directs users to the right endpoint, CloudFront delivers content fast and securely from the edge. Understanding how CloudFront cache policies, behaviors, and [Lambda@Edge](/aws/lambda-serverless) interact — and how Route 53 routing policies, health checks, and Alias records work — is mandatory for AWS Solutions Architect exams and production system design interviews alike.

## How It Actually Works

### CloudFront Request Flow

```
Client (Sydney)
    │
    ▼
Nearest PoP (Sydney ap-southeast-2 edge)
    │
    ├── Cache HIT ──────────────────────────── Return cached response (< 5ms)
    │
    └── Cache MISS
            │
            ▼
        Regional Edge Cache (Tokyo, ap-northeast-1)
            │
            ├── Cache HIT ──────────────────── Return cached response (< 20ms)
            │
            └── Cache MISS
                    │
                    ▼
                Origin Shield (optional, single region)
                    │
                    ▼
                Origin (S3 / ALB / API Gateway / EC2)
                    │
                    └─── Response cached at Regional Edge Cache → PoP → Client
```

**Key insight**: CloudFront has two cache tiers. The PoP is close to users (600+ globally). The Regional Edge Cache (~13 worldwide) sits between PoPs and origins, dramatically reducing origin load for cache misses. Origin Shield adds a third optional cache layer that collapses all PoP-to-origin traffic into a single region, cutting origin requests by 85%+ for high-traffic distributions.

---

## 1. Amazon CloudFront

### Core Architecture

**Distribution**: the top-level CloudFront resource. Has a domain name like `d1234abcd.cloudfront.net`. You attach a custom domain via Route 53 + ACM certificate.

**Origins**: where CloudFront fetches content on a cache miss.
- S3 bucket (static hosting, with Origin Access Control)
- Application Load Balancer
- EC2 instance (HTTP/HTTPS endpoint)
- API Gateway (Regional endpoint)
- Any public HTTPS server

**Behaviors**: ordered rules that match URL path patterns to origins and cache policies.

| Path Pattern | Origin | Cache Policy | Use Case |
|---|---|---|---|
| `/api/*` | API Gateway | CachingDisabled | Dynamic API — forward auth header |
| `/static/*` | S3 | CachingOptimized | JS/CSS/images — long TTL |
| `/images/*` | S3 | CachingOptimized (1yr) | Images with versioned filenames |
| `*` (default) | S3 SPA bucket | Managed-CachingOptimized (short) | SPA index.html |

Behaviors are evaluated in order; more specific patterns first. The default `*` is always last.

**Points of Presence**: 600+ edge locations in 90+ cities across 47 countries. Each PoP has compute (for CloudFront Functions / Lambda@Edge) and a cache layer.

**Regional Edge Caches**: 13 locations (North Virginia, Ohio, Oregon, São Paulo, Dublin, Frankfurt, Singapore, Tokyo, Sydney, Mumbai, Seoul, Stockholm, Cape Town). Larger cache capacity than PoPs; serve as an intermediate tier.

---

### Origin Access Control (OAC)

OAC is the modern way to secure S3 origins — only CloudFront can read from the bucket. Replace any legacy Origin Access Identity (OAI) with OAC for new distributions; OAI is deprecated.

```json
// S3 bucket policy — allows only your specific CloudFront distribution
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowCloudFrontServicePrincipal",
      "Effect": "Allow",
      "Principal": {
        "Service": "cloudfront.amazonaws.com"
      },
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::my-bucket/*",
      "Condition": {
        "StringEquals": {
          "AWS:SourceArn": "arn:aws:cloudfront::123456789012:distribution/EDFDVBD6EXAMPLE"
        }
      }
    }
  ]
}
```

**OAC vs OAI**:
| Feature | OAC (new) | OAI (legacy) |
|---|---|---|
| Supports all S3 regions | Yes | No (not China/GovCloud) |
| Supports S3 SSE-KMS | Yes | No |
| Key rotation | Automatic (CloudFront managed) | Manual |
| Supports POST/PUT to S3 | Yes | No |
| Bucket policy principal | `cloudfront.amazonaws.com` | IAM identity |

**Bucket must be private** (block all public access enabled). Remove any public ACLs.

---

### Cache Control

#### Cache Policies

Cache policies define what goes into the cache key and the TTL rules.

**Built-in managed policies**:
- `CachingOptimized` — high cache hit rate; cache key = URL path only; no headers/cookies; TTL default 86400s (1 day), max 31536000s (1 year)
- `CachingDisabled` — TTL = 0; no caching; use for dynamic API responses
- `CachingOptimized for Uncompressed Objects` — like above but no Accept-Encoding in cache key

**Custom cache policy** — when you need fine-grained control:

```
Cache Policy: my-api-with-auth
  TTL:
    Min: 0s
    Default: 60s
    Max: 86400s
  Cache Key:
    Query strings: Include "version", "lang"
    Headers: None (don't include Authorization — that's an origin request policy concern)
    Cookies: Include "session_id"
  Compression: gzip + br
```

**TTL resolution** (in order of precedence):
1. Cache policy min TTL — floor, CloudFront never caches shorter than this
2. `Cache-Control: max-age=X` from origin — honored if within [min, max] bounds
3. Cache policy default TTL — used when origin sends no `Cache-Control` header
4. Cache policy max TTL — ceiling, CloudFront never caches longer than this

#### Origin Request Policies

Origin request policies control what CloudFront forwards to the origin on a cache miss. These do NOT affect the cache key.

| Managed Policy | Forwards | Use Case |
|---|---|---|
| `AllViewer` | All headers, query strings, cookies | Dynamic APIs needing full context |
| `CORS-CustomOrigin` | CORS-relevant headers | Cross-origin S3 or custom origin |
| `CORS-S3Origin` | Minimal CORS headers | S3 with CORS |
| `AllViewerExceptHostHeader` | All except Host | Most API Gateway integrations |
| `UserAgentRefererHeaders` | User-Agent, Referer | Analytics-aware origins |

**Rule**: Keep cache key minimal (only what differentiates responses). Put everything else in origin request policy if origin needs it.

#### Response Headers Policies

Add security headers to every response without touching origin code.

```
// SecurityHeadersPolicy — attach to any behavior
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 1; mode=block
Referrer-Policy: strict-origin-when-cross-origin
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'
```

This is the correct place for security headers — not Lambda@Edge, not the origin. Zero performance cost.

---

### Cache Invalidation

```bash
# Invalidate all objects (costs $0.005/path after 1000 free paths/month)
aws cloudfront create-invalidation \
  --distribution-id EDFDVBD6EXAMPLE \
  --paths "/*"

# Targeted invalidation — only specific paths
aws cloudfront create-invalidation \
  --distribution-id EDFDVBD6EXAMPLE \
  --paths "/index.html" "/manifest.json" "/service-worker.js"
```

**Better approach for deployments: versioned filenames**

```
# Instead of invalidating app.js:
app.abc123.js   # content-addressed hash in filename
app.v2.js       # version in filename

# index.html stays the same name → short TTL (60s) or targeted invalidation
# All assets use long TTL (1 year) + versioned names → free, instant rollout
```

**When invalidation is the right tool**:
- CMS content update (can't change the URL)
- Emergency security patch to a file at a fixed URL
- Removing sensitive data that was accidentally cached

**Cost**: first 1000 invalidation paths/month free; $0.005/path after. `/*` counts as 1 path but invalidates everything.

---

### Origin Groups: Automatic Failover

```
Origin Group: my-failover-group
  ├── Primary: my-s3-bucket-us-east-1
  └── Failover: my-s3-bucket-us-west-2

Failover on: 500, 502, 503, 504 (configurable)
```

CloudFront attempts the primary origin. On a qualifying HTTP error status, it immediately retries the request against the failover origin. This is active-passive — traffic only goes to failover when primary fails.

---

### Origin Shield

Optional additional caching layer between Regional Edge Caches and your origin.

```
Without Origin Shield:
  13 Regional Edge Caches → each sends separate cache-miss requests to origin

With Origin Shield (us-east-1):
  13 Regional Edge Caches → all route through Origin Shield → 1 request to origin per unique object
```

- **Cost**: $0.0075 per 10,000 origin requests
- **Latency added**: ~1–5 ms (choose the Origin Shield region closest to your origin)
- **Best for**: origins with expensive compute (API Gateway + Lambda), media streaming origins, any origin with strict rate limits
- **Not needed if**: origin is another CloudFront distribution or fully distributed (like S3 with replication)

---

### Edge Computing: CloudFront Functions vs Lambda@Edge

| Dimension | CloudFront Functions | Lambda@Edge |
|---|---|---|
| Execution location | PoP (600+ locations) | Regional Edge Cache (~13 locations) |
| Max memory | 2 MB | 128 MB – 10 GB |
| Max package size | 10 KB | 1 MB (ZIP) / 50 MB (container) |
| Max execution time | 1 ms | 5 s (viewer) / 30 s (origin) |
| Language | JavaScript (ES5.1 subset) | Node.js, Python |
| Network access | No | Yes |
| Environment variables | No | Yes |
| Cost | $0.10/M invocations | $0.60/M executions + $0.00000625/128MB-second |
| Triggers | Viewer Request, Viewer Response | Viewer Request, Viewer Response, Origin Request, Origin Response |
| Cold starts | None | Yes (but warmed across region) |
| Access to request body | No | Yes (Origin Request/Response) |

**Decision rule**: CloudFront Functions for anything that runs in < 1ms with no external calls. Lambda@Edge for everything else.

**CloudFront Functions — URL normalization example**:

```javascript
// CloudFront Function: normalize URL path and add security header
// Runs at viewer request — before cache lookup
function handler(event) {
  var request = event.request;
  var uri = request.uri;

  // Remove trailing slash (except root)
  if (uri !== '/' && uri.endsWith('/')) {
    return {
      statusCode: 301,
      statusDescription: 'Moved Permanently',
      headers: {
        location: { value: uri.slice(0, -1) }
      }
    };
  }

  // SPA routing: no extension → serve index.html
  if (!uri.includes('.')) {
    request.uri = '/index.html';
  }

  return request;
}
```

**Lambda@Edge — JWT validation at viewer request**:

```javascript
// Lambda@Edge: validate JWT before allowing access to origin
// Node.js 18.x, deployed to us-east-1, replicated globally
const jwt = require('jsonwebtoken');

exports.handler = async (event) => {
  const request = event.Records[0].cf.request;
  const headers = request.headers;

  const authHeader = headers['authorization']?.[0]?.value;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return {
      status: '401',
      statusDescription: 'Unauthorized',
      headers: {
        'www-authenticate': [{ key: 'WWW-Authenticate', value: 'Bearer' }],
        'content-type': [{ key: 'Content-Type', value: 'application/json' }]
      },
      body: JSON.stringify({ error: 'Missing or invalid token' })
    };
  }

  try {
    const token = authHeader.slice(7);
    // PUBLIC_KEY fetched from SSM at cold start, cached in closure
    jwt.verify(token, PUBLIC_KEY, { algorithms: ['RS256'] });
    return request; // allow through to origin
  } catch (err) {
    return {
      status: '403',
      statusDescription: 'Forbidden',
      body: JSON.stringify({ error: 'Token invalid or expired' })
    };
  }
};
```

**Lambda@Edge gotchas**:
- Must be deployed in `us-east-1` — CloudFront replicates to edge locations automatically
- Cannot use Lambda VPC configuration
- Cannot use Lambda layers that aren't in `us-east-1`
- Environment variables have 128-byte limit per key/value at viewer trigger; use SSM Parameter Store
- Billed for both execution and replication storage

---

### Signed URLs and Signed Cookies

Use these to restrict CloudFront delivery to authenticated users.

**Signed URL**: access to a single specific object.
```
https://d1234.cloudfront.net/private/video.mp4
  ?Expires=1735689600
  &Signature=<RSA-SHA1-signature>
  &Key-Pair-Id=K2JCJMDEHXQW5F
```

**Signed Cookie**: access to multiple objects matching a wildcard pattern (`/private/*`). Better for HLS video with multiple segment files.
```
Set-Cookie: CloudFront-Expires=1735689600; Domain=d1234.cloudfront.net; Secure; HttpOnly
Set-Cookie: CloudFront-Signature=<sig>; Domain=...; Secure; HttpOnly
Set-Cookie: CloudFront-Key-Pair-Id=K2JCJMDEHXQW5F; Domain=...; Secure; HttpOnly
```

**Key groups** (modern approach — use this, not root account key pairs):
- Create RSA-2048 key pair outside AWS (or with `openssl genrsa`)
- Upload public key to CloudFront → create key group
- Attach key group to distribution behavior
- Sign with private key in your application code
- Rotate: add new key to key group, redeploy signing code, remove old key — zero downtime

```bash
# Generate key pair
openssl genrsa -out private_key.pem 2048
openssl rsa -pubout -in private_key.pem -out public_key.pem

# Upload public key to CloudFront
aws cloudfront create-public-key \
  --public-key-config \
    Name=my-signing-key-2024,\
    EncodedKey="$(cat public_key.pem)",\
    CallerReference=my-ref-2024
```

---

### Real-Time Logs

```
CloudFront PoP
    │  (< 1 second delay)
    ▼
Kinesis Data Streams
    │
    ├── Kinesis Data Firehose → S3 → Athena (ad-hoc queries)
    └── Lambda consumer → OpenSearch (real-time dashboards)
```

Fields available: timestamp, c-ip, cs-uri-stem, sc-status, cs-bytes, time-taken, x-edge-location, x-edge-result-type (Hit/Miss/RefreshHit/Error), cs-uri-query, cs-headers, ...

**Standard logs** (simpler, cheaper): delivered to S3 every ~5 minutes; no real-time; free (just S3 storage cost). Use for historical audit and compliance rather than operations.

---

### CloudFront Costs Summary

| Component | Price |
|---|---|
| Data transfer out (0–10 TB/mo) | $0.0085/GB |
| Data transfer out (10–50 TB/mo) | $0.0080/GB |
| HTTP requests | $0.0075/10K |
| HTTPS requests | $0.0100/10K |
| Origin Shield requests | $0.0075/10K |
| CloudFront Functions | $0.10/M invocations |
| Lambda@Edge invocations | $0.60/M |
| Lambda@Edge duration | $0.00000625 per 128MB-second |
| Cache invalidation (after 1000 paths/mo) | $0.005/path |

**CloudFront vs EC2/ALB egress**: EC2 data transfer out costs $0.09/GB. CloudFront costs $0.0085/GB — over 10x cheaper for the same bytes. For high-traffic applications serving static content, CloudFront pays for itself purely on egress savings.

---

## 2. Amazon Route 53

### DNS Fundamentals

**Hosted Zones**:
- **Public hosted zone**: authoritative DNS for a domain accessible on the internet (`example.com`)
- **Private hosted zone**: DNS resolution only within associated VPCs (`internal.example.com`); same name can shadow public zone inside VPC

**Record types**:
| Type | Description | Notes |
|---|---|---|
| A | IPv4 address | `93.184.216.34` |
| AAAA | IPv6 address | `2606:2800:220:1:248:1893:25c8:1946` |
| CNAME | Canonical name alias | Cannot be used at zone apex; charged per query |
| Alias | Route 53 extension — maps to AWS resource | Free queries; can be at apex; health-check aware |
| MX | Mail exchanger | Priority + mail server hostname |
| TXT | Text record | SPF, DKIM, domain verification |
| NS | Name server | Delegated at zone creation; do not change |
| SOA | Start of authority | Auto-managed by Route 53 |
| SRV | Service locator | Host/port/priority/weight for service discovery |
| CAA | Certification Authority Authorization | Controls which CAs can issue certificates |

**Alias vs CNAME** — the most tested Route 53 distinction:

| | Alias | CNAME |
|---|---|---|
| At zone apex (example.com) | Yes | No |
| Points to | AWS resource (CloudFront, ALB, API GW, S3, another hosted zone) | Any hostname |
| Query cost | Free | Charged |
| TTL | Set by AWS target (not configurable) | Configurable |
| Health check integration | Yes | No |
| Visible in dig/nslookup | Returns A record | Returns CNAME record |

**Rule**: Always use Alias for `example.com` → CloudFront or ALB. Use CNAME only for subdomains pointing to non-AWS resources.

---

### Routing Policies

#### 1. Simple

Returns all values. If multiple values exist, DNS resolver picks randomly. No health checks per record.

```
www.example.com  A  Simple  →  [1.2.3.4, 5.6.7.8]  (both returned, client picks)
```

Use when you have one endpoint and no failover requirement.

#### 2. Weighted

Distributes traffic by percentage weight. All records must share the same name and type.

```
api.example.com  A  Weighted  Weight=90  →  prod-alb-arn
api.example.com  A  Weighted  Weight=10  →  canary-alb-arn
```

- Set weight to 0 to stop traffic to an endpoint without deleting the record
- Weights are relative (not percentages): weight=1 and weight=3 → 25%/75%
- Use for: A/B testing, gradual traffic migration, canary deployments

#### 3. Latency

Routes to the AWS region with lowest measured network latency for the user. Latency is measured from the user's resolver to AWS regions (not your servers specifically).

```
api.example.com  A  Latency  Region=us-east-1  →  alb-us-east-1
api.example.com  A  Latency  Region=eu-west-1  →  alb-eu-west-1
api.example.com  A  Latency  Region=ap-southeast-1  →  alb-ap-southeast-1
```

AWS periodically measures latency and updates the routing data. Not real-time per query.

#### 4. Failover

Active-passive DR. Primary record requires a health check. If primary is unhealthy, Route 53 returns secondary.

```
app.example.com  A  Failover  PRIMARY    Health-check-id=hc-1  →  primary-alb
app.example.com  A  Failover  SECONDARY  (no health check)      →  dr-alb-or-s3-static
```

Failover is triggered when Route 53 marks the health check unhealthy. DNS TTL must expire before clients see new IP.

#### 5. Geolocation

Routes based on the geographic location of the DNS resolver (user's IP geolocation database).

```
shop.example.com  A  Geolocation  Location=Germany       →  eu-alb
shop.example.com  A  Geolocation  Location=United States →  us-alb
shop.example.com  A  Geolocation  Location=Default       →  global-alb
```

- Most specific match wins: Country > Continent > Default
- US-state-level routing available for US traffic
- **Always create a Default record** — users in unspecified countries get an error otherwise
- Use for: GDPR data residency, language-specific content, regulatory compliance

#### 6. Geoproximity

Routes based on distance between user and AWS resources, with optional bias adjustment. Requires Route 53 Traffic Flow (visual editor, $50/month/policy record).

```
Geoproximity Policy:
  us-east-1 region  bias=+25  (expand effective area)
  eu-west-1 region  bias=0
```

Bias range: -99 (shrink coverage area) to +99 (expand). Use when latency routing isn't precise enough for geographic distribution requirements.

#### 7. Multivalue Answer

Returns up to 8 healthy records randomly. Route 53 omits unhealthy records from the response.

```
service.example.com  A  Multivalue  Health-check=hc-1  →  10.0.1.10
service.example.com  A  Multivalue  Health-check=hc-2  →  10.0.1.11
service.example.com  A  Multivalue  Health-check=hc-3  →  10.0.1.12
```

**Not a load balancer** — client picks from returned IPs; distribution is approximate. Better than Simple for resilience because unhealthy IPs are excluded from DNS responses.

---

### Health Checks

**Types**:
- **Endpoint health check**: HTTP/HTTPS/TCP request to IP or domain. Route 53 sends requests from 15 global health checkers; endpoint is healthy if >18% respond OK.
- **CloudWatch alarm health check**: integrates a CloudWatch alarm — unhealthy when alarm is in ALARM state. Allows complex custom health logic.
- **Calculated health check**: aggregates up to 256 child health checks with AND/OR logic. "Healthy if at least 3 of 5 child checks pass."

**Configuration**:
```
Endpoint: https://api.example.com/health
Protocol: HTTPS
Port: 443
Path: /health
Interval: 30s (standard) or 10s (fast — 2x cost)
Threshold: 3 consecutive failures = unhealthy
String matching: response body must contain "OK"
```

**Pricing**:
- Standard endpoint (30s): $0.50/month per check
- Fast endpoint (10s): $1.00/month per check
- CloudWatch alarm: $0.50/month per check

**Health check → routing**: attach a health check to Failover, Weighted, Latency, Multivalue, or Geolocation records. Route 53 automatically excludes unhealthy records from DNS responses.

**Calculated health check pattern** for regional failover:
```
Parent: "us-east-1 healthy"
  ├── Child: ALB health check (HTTP 200 on /health)
  ├── Child: RDS writable check (CloudWatch alarm: DatabaseConnections > 0)
  └── Child: DynamoDB replication lag (CloudWatch alarm)

→ Region is "healthy" only if all three children are healthy
→ Calculated check drives Failover routing policy
```

---

### DNSSEC

Cryptographically signs DNS records to prevent cache poisoning (DNS spoofing). Route 53 supports DNSSEC for public hosted zones.

```bash
# Enable DNSSEC signing for a hosted zone
aws route53 enable-hosted-zone-dnssec \
  --hosted-zone-id Z1234567890ABC

# Route 53 creates a KSK (Key Signing Key) in AWS KMS
# KSK signs the ZSK (Zone Signing Key) which signs DNS records
# You must add DS record at domain registrar to complete chain of trust
```

- KMS key must be in `us-east-1` for Route 53
- Requires adding DS (Delegation Signer) record at your registrar
- Monitor `DNSSECInternalFailure` CloudWatch metric

---

### Route 53 Resolver

The default DNS resolver in every VPC lives at VPC CIDR + 2 (e.g., `10.0.0.2` for `10.0.0.0/16`). It resolves both public DNS and private hosted zone records.

**Hybrid DNS — connecting on-premises with AWS DNS**:

```
On-Premises Network ←──────────────────── AWS VPC
Corporate DNS server                       Route 53 Resolver
(resolves corp.example.com)                (resolves aws.internal.example.com)

Problem: On-prem can't resolve aws.internal.example.com
         AWS Lambda can't resolve corp.example.com
```

**Inbound Resolver Endpoint**: allows on-premises DNS to forward queries to Route 53.
```
On-premises DNS → Inbound Endpoint (ENIs in your VPC, e.g., 10.0.1.5, 10.0.1.6)
                → Route 53 Resolver
                → Private hosted zone record
```

**Outbound Resolver Endpoint**: allows VPC resources to forward queries to on-premises DNS.
```
VPC resource queries corp.example.com
    → Route 53 Resolver checks Resolver Rules
    → Forwarding rule: corp.example.com → 192.168.1.53 (on-prem DNS)
    → Outbound Endpoint (ENIs) → on-premises DNS server
```

**Resolver Rules**:
- Forwarding rule: forward specific domains to specified DNS servers
- System rule: overrides forwarding for AWS-internal domains (cannot be deleted)
- Share via RAM: share resolver rules across accounts in an AWS Organization

---

### Route 53 Application Recovery Controller (ARC)

ARC provides tooling for reliable multi-region failover beyond basic DNS health checks.

**Readiness Checks**: continuously verify that your DR resources are actually ready.
```
Readiness Check: "us-west-2 DR is ready"
  ├── EC2 Auto Scaling Group capacity ≥ 10 instances
  ├── RDS replica lag < 5 minutes
  └── DynamoDB Global Table replication status = IN_SYNC

→ If any check fails, ARC alerts BEFORE you need to fail over
```

**Routing Controls**: on/off switches for traffic, independent of health checks.
```
Routing Control: us-east-1-traffic  [ON]
Routing Control: us-west-2-traffic  [OFF]

→ Toggle routing controls to shift traffic manually or via automation
→ Control plane is distributed across 5 cells — highly available even during regional failure
```

**Zonal Shift** (ALB/NLB native feature): immediately shift traffic away from an impaired Availability Zone.
```bash
# Shift traffic away from AZ us-east-1b for 3 hours
aws arc-zonal-shift start-zonal-shift \
  --resource-identifier arn:aws:elasticloadbalancing:us-east-1:123:loadbalancer/app/my-alb/abc \
  --away-from us-east-1b \
  --expires-in 3h \
  --comment "AZ impairment detected, shifting traffic"
```

No DNS TTL delay — ALB/NLB stops routing new connections to the impaired AZ within seconds.

---

### Domain Registration

Route 53 doubles as a domain registrar:
- Register `.com` for $14/year, `.io` for $42.50/year
- Auto-renew enabled by default (important: disable for test domains to avoid surprise charges)
- DNSSEC enabled at registration for new domains
- Transfer lock: 60 days after registration or transfer before you can transfer out (ICANN rule)
- Transfer in: unlock domain at source registrar, get auth code, initiate in Route 53 console

```bash
# Check domain availability
aws route53domains check-domain-availability \
  --region us-east-1 \
  --domain-name myapp.com

# Register domain
aws route53domains register-domain \
  --region us-east-1 \
  --domain-name myapp.com \
  --duration-in-years 1 \
  --admin-contact file://contact.json \
  --auto-renew
```

---

## 3. Architecture Patterns

### SPA + CloudFront + S3 + API Gateway

```
Browser
    │
    ▼
Route 53 (Alias record → CloudFront distribution)
    │
    ▼
CloudFront (custom domain: app.example.com, ACM cert)
    │
    ├── Behavior: /api/*
    │     Origin: API Gateway (Regional)
    │     Cache Policy: CachingDisabled
    │     Origin Request Policy: AllViewerExceptHostHeader
    │     (Authorization header forwarded to API GW)
    │
    ├── Behavior: /static/*
    │     Origin: S3 (OAC)
    │     Cache Policy: CachingOptimized (max-age=31536000)
    │     Compress: true
    │
    └── Default Behavior: /*
          Origin: S3 (OAC)
          Cache Policy: Custom (max-age=60 — short for index.html)
          Custom Error Response: 403/404 → /index.html, 200 (SPA routing)
          Response Headers Policy: SecurityHeadersPolicy
          WAF ACL: attached (rate limiting, geo-blocking)
```

**Custom error response** is critical for SPA routing — S3 returns 403/404 for routes like `/dashboard`, and CloudFront must remap those to `index.html` with a 200 status so the React/Vue router handles navigation.

**ACM certificate**: must be in `us-east-1` for CloudFront (even if your stack is in `eu-west-1`). Request via ACM, validate via Route 53 DNS validation (automatic CNAME record).

---

### Multi-Region Active-Active with Route 53

```
Users worldwide
    │
    ▼
Route 53 — Latency routing policy
    │
    ├── us-east-1  ALB  [Health check: hc-east]
    │       │
    │       ├── ECS Fargate service (app)
    │       └── RDS Aurora Global (primary writer)
    │
    ├── eu-west-1  ALB  [Health check: hc-eu]
    │       │
    │       ├── ECS Fargate service (app)
    │       └── RDS Aurora Global (reader endpoint)
    │
    └── ap-southeast-1  ALB  [Health check: hc-ap]
            │
            ├── ECS Fargate service (app)
            └── RDS Aurora Global (reader endpoint)

DynamoDB Global Tables: replicated across all 3 regions
S3 Cross-Region Replication: assets in all regions

Route 53 ARC:
  Routing controls: manual override per region
  Readiness checks: Aurora replication lag, ECS desired vs running
```

**Write routing**: for strong consistency, writes must go to the primary Aurora region. Either:
- Route write traffic to `us-east-1` specifically (separate DNS record)
- Use DynamoDB Global Tables (any region, last-writer-wins)

**Failover sequence**: health check fails in `eu-west-1` → Route 53 removes `eu-west-1` from Latency policy → users who previously resolved to EU now resolve to nearest healthy region (us-east-1 or ap-southeast-1)

---

### Blue/Green Deployments with Route 53

```
Phase 1 (production = Blue):
  app.example.com  Weighted  Weight=100  →  blue-alb.example.com
  app.example.com  Weighted  Weight=0    →  green-alb.example.com

Phase 2 (canary — 10% to Green):
  app.example.com  Weighted  Weight=90   →  blue-alb.example.com
  app.example.com  Weighted  Weight=10   →  green-alb.example.com

Phase 3 (50/50 validation):
  app.example.com  Weighted  Weight=50   →  blue-alb
  app.example.com  Weighted  Weight=50   →  green-alb

Phase 4 (full cutover):
  app.example.com  Weighted  Weight=0    →  blue-alb  (keep for rollback)
  app.example.com  Weighted  Weight=100  →  green-alb

Rollback: flip weights back to 100/0 in favor of blue
```

**DNS TTL consideration**: set TTL to 60s or lower before starting migration so failback is fast. After migration stabilizes, set TTL back to 300s.

---

### Zero-Downtime Domain Migration to Route 53

```
Day 1 — Setup (no traffic impact):
  1. Create hosted zone in Route 53 for example.com
  2. Recreate all DNS records in Route 53 exactly as at current registrar
  3. Note Route 53 name servers (4 NS records in hosted zone)

Day 2 — Lower TTL at current registrar:
  4. Reduce TTL on all records to 60s
  5. Wait 24–48 hours (old TTL must fully expire everywhere)

Day 3 — Migrate:
  6. At current registrar: update NS records to Route 53 NS servers
  7. DNS propagation: 24–48 hours (TTL was 60s so most resolvers catch up quickly)
  8. Monitor: dig example.com NS — watch for Route 53 NS to appear

Day 7+ — Cleanup:
  9. Transfer domain registration to Route 53 (optional — can keep registrar elsewhere)
  10. Restore TTLs to 300s
```

**Never change nameservers and records simultaneously** — change records first, verify, then change NS.

---

## Interview Q&A

**Q: Explain how CloudFront caching works. How would you configure it for a React SPA with an API backend?**

A: CloudFront caches at two tiers: 600+ PoPs close to users and 13 Regional Edge Caches behind them. For a React SPA: two behaviors — `/api/*` points to API Gateway with `CachingDisabled` policy and `AllViewerExceptHostHeader` origin request policy so Authorization headers reach the API; the default `/*` behavior points to S3 with a short TTL (60s) for `index.html` and a custom error response mapping 403/404 to `/index.html` with 200 status for client-side routing. Static assets use versioned filenames and a 1-year max-age cache policy. Attach a SecurityHeadersPolicy response policy to the default behavior for free security headers across all responses.

---

**Q: What's the difference between Origin Access Control and Origin Access Identity?**

A: Both restrict S3 bucket access to CloudFront only, preventing direct S3 URL access. OAI is the legacy mechanism using a special IAM identity — doesn't work in all S3 regions, doesn't support SSE-KMS encrypted buckets, requires manual key rotation. OAC is the replacement: uses `cloudfront.amazonaws.com` as the service principal with a condition on the specific distribution ARN. More secure, supports all regions, supports SSE-KMS, supports signed requests (POST/PUT). Always use OAC for new distributions.

---

**Q: When would you use Lambda@Edge vs CloudFront Functions?**

A: CloudFront Functions for anything sub-millisecond with no I/O: URL normalization, simple redirects, A/B test cookie assignment, adding security headers (though a response headers policy is better for that), light authentication token format checking. Lambda@Edge when you need: network calls (fetch user attributes from DynamoDB, call auth service), Node.js packages, meaningful compute (image resizing, SSR), request body access (origin triggers only), or timeouts > 1ms. Lambda@Edge costs 6x more per invocation and runs at only 13 locations vs 600+ for CloudFront Functions.

---

**Q: How do you implement signed URLs for private content in CloudFront?**

A: Create a key group: generate RSA-2048 key pair locally, upload the public key to CloudFront, create a key group containing it, attach the key group to the distribution behavior for your private content. In your application (typically a Lambda behind API Gateway), sign URLs server-side using the private key — include the resource URL, expiration timestamp, and IP restriction (optional). The signature is RSA-SHA1 over a policy document. For HLS video or multiple files, use signed cookies instead — three cookies (Policy, Signature, Key-Pair-Id) scoped to a domain/path wildcard. Never expose the private key — store in Secrets Manager and load at Lambda warm start.

---

**Q: Explain the difference between Route 53 CNAME and Alias records.**

A: CNAME is a standard DNS record that aliases one hostname to another. It resolves to a hostname, which requires a second DNS lookup. It cannot be used at the zone apex (`example.com`). Queries are charged. Alias is a Route 53 extension that behaves like CNAME but resolves directly to the IP of an AWS resource (CloudFront, ALB, API Gateway, S3 website endpoint, or another Route 53 hosted zone). Alias can be at the zone apex, queries are free, and Alias records inherit the health check awareness of the target resource. For `example.com` → CloudFront, you must use Alias. For `www.example.com` → some external CDN, CNAME works fine.

---

**Q: How does Route 53 failover routing work? What triggers the failover?**

A: You create two records with the same name — one PRIMARY and one SECONDARY. The primary record requires a health check. Route 53 continuously polls the health check endpoint from 15 global health checker locations. If more than 18% of health checkers report unhealthy over the configured threshold (default: 3 consecutive failures), Route 53 marks the check unhealthy. DNS responses then return only the secondary record. Clients with cached DNS must wait for TTL expiry before seeing the change — set TTL to 60s for DR scenarios. Note: Route 53 health checks originate from AWS IP ranges; make sure your firewall allows them.

---

**Q: Design a multi-region active-active architecture using Route 53 and DynamoDB.**

A: Route 53 Latency routing with health checks on ALBs in 3+ regions (us-east-1, eu-west-1, ap-southeast-1). Each region runs an independent application stack: ECS Fargate or Lambda, behind an ALB, reading/writing DynamoDB Global Tables (multi-region, multi-master). DynamoDB Global Tables uses last-writer-wins conflict resolution — model your writes to avoid conflicts or use a conditional write pattern. For read-heavy workloads, DAX in each region. CloudFront in front of static assets in all regions. Route 53 ARC for readiness checks (DynamoDB replication lag < threshold) and routing controls for controlled failover. S3 with Cross-Region Replication for static asset consistency. ACM certs in each region for ALB + one in us-east-1 for CloudFront.

---

**Q: How would you migrate a domain from another registrar to Route 53 with zero downtime?**

A: Never touch nameservers and DNS records simultaneously. Step 1: create a Route 53 hosted zone and replicate all records exactly. Step 2: lower TTL on all records at the current registrar to 60s; wait for old TTL to expire (24–48 hours). Step 3: update the NS records at the current registrar to the 4 Route 53 nameservers. Monitor with `dig example.com NS +trace`. DNS propagates within minutes to hours since TTL is 60s. Step 4: after 48 hours, optionally initiate domain transfer to Route 53 (requires unlocking domain, getting auth code, 60-day post-transfer lock). Restore TTLs after stable.

---

**Q: What is Route 53 Application Recovery Controller and when would you use it?**

A: ARC is a set of tools for operationalizing multi-region failover. It has three components: Readiness Checks (continuously verify that DR resources — ASG capacity, DB replication lag, etc. — are ready before you need them), Routing Controls (on/off traffic switches that live in a 5-cell distributed control plane, highly available even during regional outages, used for deterministic traffic shifting), and Zonal Shift (instantly move ALB/NLB traffic away from a specific AZ without DNS TTL delays). Use ARC when you need reliability guarantees that go beyond "health check → DNS failover" — specifically when you need to test DR readiness, require manual failover with audit trail, or need sub-minute AZ-level traffic shifts.

---

**Q: How do you add security headers to all CloudFront responses without modifying the origin?**

A: Create a Response Headers Policy in CloudFront with the desired headers (HSTS, X-Frame-Options, X-Content-Type-Options, CSP, Referrer-Policy). Attach it to the distribution behavior. CloudFront injects these headers into every response before returning to the client — no Lambda@Edge, no origin changes needed. You can use the managed `SecurityHeadersPolicy` or create a custom one. For CSP with nonces (required for inline scripts), you do need Lambda@Edge at origin response to generate per-request nonces, but for static CSP this is zero-cost and instant.

---

**Q: A CloudFront distribution is not caching. What are the most common causes?**

A:
1. **`Cache-Control: no-cache` or `no-store` from origin** — CloudFront respects these; override with cache policy min/max TTL to force caching regardless.
2. **Cache key too broad** — including session cookies or User-Agent in cache key fragments the cache into millions of unique objects; each is effectively a miss.
3. **Authorization header in cache key** — every unique token = unique cache entry = always a miss. Authorization belongs in origin request policy only, not cache key.
4. **Query string variation** — if cache policy includes all query strings and URLs have unique timestamps or request IDs, every request is a cache miss.
5. **Origin returns different status codes** — CloudFront only caches 2xx and 3xx by default; 4xx/5xx bypass cache.
6. **Behavior path pattern wrong** — request matches default `*` behavior instead of your configured behavior.
7. **TTL = 0** — `CachingDisabled` policy applied to a behavior that should be cached.
8. **POST/PUT/DELETE requests** — CloudFront never caches non-GET/HEAD requests.

Check `x-cache: Miss from cloudfront` vs `Hit from cloudfront` headers; examine `x-edge-result-type` in real-time logs.

---

## Red Flags to Avoid

- **Using OAI instead of OAC for new distributions** — OAI is deprecated; OAC supports SSE-KMS and all S3 regions
- **Putting Authorization header in the cache key** — every unique JWT = unique cache entry = 0% cache hit rate; put it in origin request policy only
- **Forgetting custom error response for SPA** — without 403/404 → 200 /index.html remapping, direct URL access and browser refresh breaks SPA routing
- **Requesting ACM certificate in wrong region** — CloudFront requires the cert to be in `us-east-1` even if your stack is elsewhere
- **Using CloudFront Functions when Lambda@Edge is needed** — CF Functions have no network access, 10 KB code limit, 2 MB memory; JWT validation with fetch calls to auth service needs Lambda@Edge
- **Invalidating `/*` on every deployment** — use versioned asset filenames instead; invalidation is a signal that your deployment strategy is wrong
- **CNAME at zone apex** — `example.com CNAME myapp.example.com` is invalid DNS; use Alias record for apex
- **Missing Default record in Geolocation routing** — users from unspecified countries get NXDOMAIN errors; always include a Default record
- **Setting TTL to 300s during blue/green migration** — lower to 60s before traffic shift; 5-minute DNS caching delays fast rollback
- **Lambda@Edge deployed outside us-east-1** — CloudFront only replicates Lambda@Edge from us-east-1; deploying elsewhere makes it impossible to attach to a distribution
- **Not enabling Origin Shield for media streaming** — without it, 13 Regional Edge Caches each independently hammer the origin; one Origin Shield region serializes that to a trickle
- **Health checks blocked by security groups** — Route 53 health checkers use well-known IP ranges; if your ALB SG doesn't allow them, health checks always fail and failover is permanently triggered
- **Private hosted zone with overlapping names across VPCs without proper association** — unexpected DNS resolution failures from the wrong zone winning

---

## See Also

- [Storage & S3](/aws-storage-s3) — S3 static site hosting, OAC bucket policies, S3 Cross-Region Replication for multi-region assets
- [API Gateway & Networking](/aws-api-gateway-networking) — CloudFront + API Gateway Regional endpoint pattern, WAF integration
- [Lambda](/aws-lambda-serverless) — Lambda@Edge deployment, us-east-1 constraint, cold starts at edge
- [VPC & Networking](/aws-vpc-networking) — Route 53 Resolver inbound/outbound endpoints, hybrid DNS, private hosted zones
- [Security Services](/aws-security-services) — WAF ACL on CloudFront distributions, Shield Advanced, geo-blocking
- [AWS Architecture](/aws-architecture) — multi-region active-active patterns, DynamoDB Global Tables, ARC
- [IAM & Security](/aws-iam-security) — OAC service principal conditions, signed URL key groups, resource-based policies
- [Cost Optimization](/aws-cost-optimization) — CloudFront vs ALB/EC2 egress cost comparison, Origin Shield ROI
