# AWS Storage & S3

## The 30-Second Pitch
AWS Storage is the broadest and most mature cloud storage portfolio available, spanning object storage (S3), block storage (EBS), file storage (EFS, FSx), hybrid gateways (Storage Gateway), and unified backup (AWS Backup). S3 alone underpins much of the modern web — from static asset hosting to data lake foundations to ML training datasets. Understanding the full storage stack is essential for designing cost-efficient, durable, and high-performance architectures, and it is one of the most heavily tested domains in AWS Solutions Architect and Developer certification exams.

## How It Actually Works

### S3 Core Model
S3 is a globally-addressed, regionally-stored **flat object store**. There is no true filesystem hierarchy — what looks like a folder path (`data/2024/jan/file.csv`) is just a **key** with slashes in it. Every object has:

- **Bucket**: the top-level namespace container, globally unique across all AWS accounts
- **Key**: the full path-like identifier within the bucket
- **Value**: the object data (bytes), up to 5 TB per object
- **Version ID**: populated when versioning is enabled
- **Metadata**: system metadata (Content-Type, ETag, Last-Modified) and up to 2 KB of user-defined key-value pairs
- **Tags**: up to 10 key-value pairs, used for cost allocation, lifecycle rules, and access policies

**Consistency model** (post-December 2020): S3 provides **strong read-after-write consistency** for all operations — PUT, DELETE, LIST. There is no longer any eventual consistency window for new or overwritten objects.

```
PUT s3://my-bucket/data/file.csv
    ↓
[S3 Control Plane] → IAM Auth → Bucket Policy check → Object Lock check
    ↓
[S3 Data Plane]  → 3+ AZ replication (for Standard class) → 200 OK + ETag
    ↓
Subsequent GET   → reads the newly written version immediately (strong consistency)
```

---

## S3 Fundamentals

### Buckets
- Names must be globally unique, 3–63 characters, lowercase, no underscores
- Created in a specific Region; data never leaves the Region unless you explicitly configure replication
- No limit on the number of objects; default soft limit of 100 buckets per account (can be raised)
- **Bucket ownership**: the AWS account that creates the bucket owns it; object ownership can be configured

### Object Versioning
Enable versioning on a bucket to keep multiple variants of every object:
- Each PUT creates a new **Version ID** (opaque string)
- A DELETE without a Version ID inserts a **delete marker** (soft delete); the object is not actually removed
- A DELETE with a specific Version ID permanently removes that version
- Suspending versioning stops creating new versions but preserves existing ones
- **MFA Delete**: requires MFA token plus credentials to change versioning state or delete versioned objects — highest protection against accidental or malicious deletion. Can only be enabled/disabled by the root account.

### Multipart Upload
Mandatory for objects >5 GB, recommended for objects >100 MB:
1. **Initiate** — returns an `UploadId`
2. **Upload Parts** — each part (min 5 MB except the last) is uploaded in parallel; each returns an `ETag`
3. **Complete** — S3 assembles the parts in order using the ETag list
4. **Abort** — cleans up incomplete parts (important for cost; incomplete parts accrue storage charges until aborted or lifecycle-expired)

---

## S3 Storage Classes

| Class | Min Duration | Min Object Size | AZs | Use Case | Approx. Storage Cost |
|---|---|---|---|---|---|
| **Standard** | None | None | ≥3 | Frequently accessed, active data | ~$0.023/GB/mo |
| **Intelligent-Tiering** | None | None (< 128KB not monitored) | ≥3 | Unknown/changing access patterns | ~$0.023/GB/mo + $0.0025/1k objects monitoring |
| **Standard-IA** | 30 days | 128 KB | ≥3 | Infrequently accessed, rapid retrieval | ~$0.0125/GB/mo + retrieval fee |
| **One Zone-IA** | 30 days | 128 KB | 1 | Reproducible infrequent data, lower cost | ~$0.01/GB/mo |
| **Glacier Instant Retrieval** | 90 days | 128 KB | ≥3 | Archive with ms retrieval | ~$0.004/GB/mo |
| **Glacier Flexible Retrieval** | 90 days | 40 KB | ≥3 | Archive, retrieval in minutes to hours | ~$0.0036/GB/mo |
| **Glacier Deep Archive** | 180 days | 40 KB | ≥3 | Long-term compliance archive | ~$0.00099/GB/mo |

**Intelligent-Tiering tiers** (automatic, no retrieval charge):
- Frequent Access (default)
- Infrequent Access (moved after 30 days of no access)
- Archive Instant Access (moved after 90 days)
- Archive Access (optional, moved after 90–730 days, requires activation)
- Deep Archive Access (optional, moved after 180–730 days, requires activation)

**Key decision rules:**
- Use **Standard** for active hot data, static websites, ML training data being actively read
- Use **Standard-IA** for backups, DR copies, logs older than 30 days
- Use **One Zone-IA** only for data you can regenerate (thumbnail cache, derived datasets)
- Use **Glacier Instant** for medical images, news archives — occasional but fast retrieval
- Use **Glacier Flexible** for quarterly regulatory reports — hours-acceptable latency
- Use **Glacier Deep Archive** for 7-year compliance retention, tape replacement

---

## S3 Lifecycle Policies

Lifecycle rules automate transitions between storage classes and expiration:

```json
{
  "Rules": [
    {
      "ID": "move-logs-to-cold-storage",
      "Status": "Enabled",
      "Filter": { "Prefix": "logs/" },
      "Transitions": [
        { "Days": 30,  "StorageClass": "STANDARD_IA" },
        { "Days": 90,  "StorageClass": "GLACIER_IR" },
        { "Days": 365, "StorageClass": "DEEP_ARCHIVE" }
      ],
      "Expiration": { "Days": 2555 },
      "NoncurrentVersionTransitions": [
        { "NoncurrentDays": 30, "StorageClass": "STANDARD_IA" }
      ],
      "NoncurrentVersionExpiration": { "NoncurrentDays": 90 },
      "AbortIncompleteMultipartUpload": { "DaysAfterInitiation": 7 }
    }
  ]
}
```

**Critical details:**
- Transitions have a **minimum 30-day** residency requirement for Standard-IA and One Zone-IA (you pay the min duration even if you transition earlier)
- `AbortIncompleteMultipartUpload` — always add this rule; orphaned parts accumulate silently and cost money
- `NoncurrentVersionExpiration` — cleans up old versions in versioned buckets; without it, storage grows unboundedly
- Lifecycle rules propagate asynchronously; actual transition may lag the configured day by ~1 day

---

## S3 Security

### Bucket Policies (Resource-Based)
JSON policies attached directly to the bucket. Support cross-account access and anonymous public access. Evaluated alongside IAM identity policies using the **least-privilege intersection rule**: an action is allowed only if both the IAM policy AND the bucket policy allow it (with the exception that an explicit Deny anywhere overrides all Allows).

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowCloudFrontOAC",
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

### ACLs (Legacy — Avoid)
Object and bucket Access Control Lists predate bucket policies. AWS recommends disabling ACLs entirely by setting **Object Ownership** to `BucketOwnerEnforced`. This also means all objects uploaded to the bucket are owned by the bucket owner regardless of who uploaded them — critical for cross-account upload scenarios.

### Block Public Access (BPA)
Four independent settings, configurable at account level and bucket level:
1. `BlockPublicAcls` — rejects any ACL grant that allows public access
2. `IgnorePublicAcls` — ignores existing public ACLs
3. `BlockPublicPolicy` — rejects bucket policies that grant public access
4. `RestrictPublicBuckets` — restricts access to buckets with public policies to only AWS services and authorized users

**Best practice**: Enable all four at the account level. Disable selectively only for intentionally public buckets (e.g., static website hosting).

### Presigned URLs
Allow temporary, time-limited access to private S3 objects without exposing credentials:

```javascript
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const client = new S3Client({ region: "us-east-1" });

// Presigned GET — allow download for 1 hour
const getUrl = await getSignedUrl(
  client,
  new GetObjectCommand({ Bucket: "my-bucket", Key: "report.pdf" }),
  { expiresIn: 3600 }
);

// Presigned PUT — allow direct browser upload for 15 minutes
const putUrl = await getSignedUrl(
  client,
  new PutObjectCommand({
    Bucket: "my-bucket",
    Key: "uploads/user-photo.jpg",
    ContentType: "image/jpeg",
  }),
  { expiresIn: 900 }
);
```

**Presigned POST** (HTML form uploads): More powerful than presigned PUT — supports conditions (max file size, allowed prefixes, content-type restrictions). Uses a Policy document + Signature rather than a URL query string. Preferred for browser-based uploads where you need server-side validation of upload parameters.

**Key facts:**
- The presigned URL is signed using the credentials of the IAM principal that generates it
- If the principal's permissions are revoked before expiry, the URL stops working
- Max expiry: 12 hours for IAM role credentials (STS token limit), 7 days for IAM user credentials
- Always use HTTPS; the URL embeds the signature and must not be logged in plaintext

---

## S3 Performance

### Prefix-Based Parallelism
S3 scales automatically per prefix. Each unique prefix path supports at least **3,500 PUT/COPY/POST/DELETE** and **5,500 GET/HEAD** requests per second. To maximize throughput for high-traffic workloads:
- Spread objects across many different prefixes (not all under `data/2024/`)
- Use random or hashed prefixes for hot key patterns: `a3f2/user-uploads/...`, `b7c1/user-uploads/...`

### S3 Transfer Acceleration
Routes uploads/downloads through **[CloudFront](/aws-cloudfront-route53) edge locations** using AWS's private network backbone instead of the public internet. Adds ~$0.04/GB over standard transfer costs. Useful for:
- Users uploading large files from geographically distant locations
- Global applications where latency to the bucket's Region is high

Enable at the bucket level; use the `.s3-accelerate.amazonaws.com` endpoint.

### Byte-Range Fetches
Use `Range: bytes=0-1048575` HTTP headers to download only a portion of an object. Enables:
- Parallel multi-threaded downloads (split large object into ranges, download concurrently)
- Partial reads for columnar formats (Parquet footer at end of file)
- Failure resilience (retry only the failed range, not the whole object)

---

## S3 Advanced Features

### S3 Select
Execute SQL-like queries directly on S3 objects (CSV, JSON, Parquet, gzip/bzip2 compressed CSV/JSON) — only the matching rows are returned over the network:

```sql
SELECT s.name, s.age FROM S3Object s WHERE s.age > 25
```

Reduces data transfer by up to 400x for selective queries. Does not support JOINs or aggregations across multiple files. For complex analytics, use **Amazon Athena** (S3 Select under the hood, plus query planning) or **Redshift Spectrum** — see [Data Analytics](/aws-data-analytics) for full Athena + Glue + Redshift patterns.

### S3 Object Lambda
Intercept `GetObject` requests with a Lambda function to transform data on the fly — resize images, redact PII, convert formats — before returning it to the caller. No changes needed in the calling application.

```
Client GET → S3 Object Lambda Access Point → Lambda function → S3 standard bucket → transformed bytes → Client
```

### Requester Pays
Enable `Requester Pays` on a bucket to charge the data transfer and request costs to the requester's AWS account rather than the bucket owner. Used for public datasets (e.g., AWS Open Data Registry) where the dataset provider does not want to pay egress costs.

### S3 Batch Operations
Run operations at scale across billions of objects:
- Copy, tag, delete, restore from Glacier, invoke Lambda, replicate
- Input: a manifest (S3 Inventory report or CSV list of object keys)
- Reports success/failure per object
- Integrates with IAM for fine-grained permissions

### S3 Replication

**Cross-Region Replication (CRR)**: Source and destination buckets in different Regions. Use cases: compliance (data residency), latency reduction for global readers, disaster recovery.

**Same-Region Replication (SRR)**: Same Region. Use cases: aggregate logs from multiple buckets, live replication between production and test accounts.

**Key rules:**
- Versioning must be enabled on both source and destination buckets
- Replication is asynchronous (typically seconds to minutes)
- Encrypted objects (SSE-S3 or SSE-KMS) can be replicated; SSE-KMS requires the destination KMS key to be specified
- Existing objects are NOT automatically replicated — use **S3 Batch Replication** for backfill
- Delete markers are NOT replicated by default (configurable)
- Replicated objects retain the same storage class unless a destination storage class override is set

---

## S3 Event Notifications

S3 can publish events on object create, delete, restore, replication, and lifecycle transitions. See [Lambda & Serverless](/aws/lambda-serverless) for how Lambda processes these events at scale.

| Destination | Protocol | Ordering | Use Case |
|---|---|---|---|
| **SQS** | Poll-based | FIFO possible | Decoupled processing queue |
| **SNS** | Push (fan-out) | No | Fan-out to multiple consumers |
| **[Lambda](/aws/lambda-serverless)** | Direct invoke | No | Serverless immediate processing |
| **EventBridge** | Push | No | Advanced filtering, routing, archiving |

**EventBridge** is the most powerful destination — supports content-based filtering on all event fields, dead-letter queues, event replay, and routing to 20+ targets.

```json
{
  "source": ["aws.s3"],
  "detail-type": ["Object Created"],
  "detail": {
    "bucket": { "name": ["my-uploads-bucket"] },
    "object": { "key": [{ "prefix": "uploads/images/" }] }
  }
}
```

**Note**: S3 event notifications have **at-least-once** delivery semantics. For exactly-once processing, use SQS deduplication or idempotent Lambda handlers.

---

## CloudFront

### What It Is
CloudFront is AWS's globally distributed **Content Delivery Network (CDN)** — 400+ edge locations (Points of Presence) plus 13 Regional Edge Caches. It caches content close to users, reducing latency and origin load.

### Distributions and Origins
A **distribution** maps to one or more **origins**:
- **S3 bucket** (with OAC for private content, or as static website endpoint)
- **Application Load Balancer**
- **API Gateway**
- **Custom HTTP origins** (any public HTTP/HTTPS server)
- **Lambda Function URLs**

Multiple origins per distribution enable **origin groups** for failover: CloudFront tries the primary origin; on 5xx or connection failure, it automatically retries the secondary.

### Behaviors
A distribution has one or more **cache behaviors** matched by URL path pattern (`/api/*`, `/images/*`, `*`). Each behavior independently controls:
- Which origin to route to
- Cache policy (TTLs, cache keys)
- Origin request policy (which headers/cookies/query strings to forward to origin)
- Viewer protocol (HTTP, HTTPS, redirect)
- Allowed HTTP methods
- Function associations (Lambda@Edge or CloudFront Functions)

### Cache Policies and Origin Request Policies
**Cache Policy** defines what constitutes a unique cache key and the TTL bounds:
- Cache key components: URL path (always), plus optional headers, cookies, query strings
- Minimize cache key to maximize hit rate (never include session cookies in the cache key unless the response varies per session)
- `min-ttl`, `default-ttl`, `max-ttl` — CloudFront respects `Cache-Control` from origin within these bounds

**Origin Request Policy** controls what CloudFront forwards to the origin without affecting the cache key:
- Forward `Authorization` header to origin but don't include it in cache key (use with caution — means all users share the same cached response)
- Forward `Accept-Language` to origin without caching per language

### OAC — Origin Access Control (Replaces OAI)
Restricts S3 bucket access so only CloudFront can retrieve objects. OAC supersedes the older Origin Access Identity (OAI). OAC is enforced through [IAM resource-based policies](/aws/iam-security) on the S3 bucket:
- OAC uses **SigV4** signing, supporting SSE-KMS encrypted S3 buckets
- S3 bucket policy grants `s3:GetObject` to the CloudFront service principal with a condition on `AWS:SourceArn` matching the specific distribution ARN (see [IAM & Security](/aws/iam-security) for bucket policy syntax and the principal/condition model)
- Block all public S3 access; all requests must flow through CloudFront

### Signed URLs and Signed Cookies

**Signed URL**: one URL with an embedded policy and signature. Use for:
- Single file access (video file, download link)
- Users with non-cookie-capable clients (IoT, mobile apps making direct HTTP calls)

**Signed Cookie**: sets `CloudFront-Policy`, `CloudFront-Signature`, `CloudFront-Key-Pair-Id` cookies. Use for:
- Multiple files (entire premium content library for a subscriber)
- Users who already have an authenticated session

Both require a **CloudFront key pair** (RSA-2048) — the private key signs the policy, CloudFront validates with the stored public key. Managed in **Key Groups** (not IAM).

### Lambda@Edge vs CloudFront Functions

| | CloudFront Functions | Lambda@Edge |
|---|---|---|
| Runtime | JS (ES5.1) | Node.js 14/18, Python 3.x |
| Trigger points | Viewer Request, Viewer Response | Viewer Request, Viewer Response, Origin Request, Origin Response |
| Max exec time | 1 ms | 5 s (viewer), 30 s (origin) |
| Max memory | 2 MB | 128 MB – 10 GB |
| Network access | No | Yes |
| Pricing | ~$0.10/million | ~$0.60/million + compute |
| Use cases | URL rewrites/redirects, simple A/B testing, HTTP header manipulation, cache key normalization | Auth flows, dynamic origin selection, body inspection/modification, API calls during request |

**Rule of thumb**: Use **CloudFront Functions** for anything that takes <1ms and needs no I/O. Use **Lambda@Edge** when you need to call an external service (e.g., JWT validation against Cognito, dynamic personalization).

---

## EBS — Elastic Block Store

EBS provides **persistent block storage** volumes for EC2 instances. Think of it as a network-attached SSD/HDD. Data persists independently of the EC2 instance lifecycle.

### Volume Types

| Type | Category | Max IOPS | Max Throughput | Use Case |
|---|---|---|---|---|
| **gp3** | SSD General Purpose | 16,000 | 1,000 MB/s | Boot volumes, dev/test, general workloads |
| **gp2** | SSD General Purpose (legacy) | 16,000 | 250 MB/s | Legacy; gp3 is better in all dimensions |
| **io2 Block Express** | SSD Provisioned IOPS | 256,000 | 4,000 MB/s | Mission-critical RDBMS, SAP HANA |
| **io1** | SSD Provisioned IOPS (legacy) | 64,000 | 1,000 MB/s | Databases needing >16k IOPS |
| **st1** | HDD Throughput Optimized | 500 | 500 MB/s | Big data, log processing, sequential I/O |
| **sc1** | HDD Cold | 250 | 250 MB/s | Infrequently accessed archival, lowest cost |

**gp2 vs gp3**: gp3 decouples IOPS and throughput from volume size (gp2 is 3 IOPS/GB, maxing at 16k for volumes ≥5.3TB). gp3 provides 3,000 IOPS baseline and 125 MB/s baseline regardless of size, with provisioned scaling to 16,000 IOPS and 1,000 MB/s. gp3 is 20% cheaper than gp2. **Always choose gp3 for new volumes.**

**io1 vs io2**: io2 provides 500 IOPS/GB (vs 50 IOPS/GB for io1), 99.999% durability (vs 99.8–99.9% for io1), same price. **Always choose io2 over io1.**

**HDD volumes (st1/sc1)** cannot be used as boot volumes.

### Snapshots
- Point-in-time backups stored in S3 (managed by EBS, not directly accessible as S3 objects)
- **Incremental**: each snapshot only stores blocks changed since the previous snapshot
- Snapshots can be copied across Regions (for DR) and shared across accounts
- **Fast Snapshot Restore (FSR)**: pre-warms the snapshot so volumes created from it deliver full performance immediately (eliminates first-access latency penalty); costs extra per AZ per snapshot

### Multi-Attach
Available for **io1 and io2** volumes only. Allows attaching a single volume to up to **16 Nitro-based EC2 instances** simultaneously within the same AZ. The application must manage concurrent writes — typically requires a clustered file system (like GFS2) or a database that handles its own locking.

### Encryption
- AES-256, managed by KMS (either AWS-managed key `aws/ebs` or a customer-managed CMK)
- Encryption is at rest and in transit between the volume and the instance
- Snapshots of encrypted volumes are encrypted; volumes created from encrypted snapshots are encrypted
- To encrypt an existing unencrypted volume: create a snapshot → copy the snapshot with encryption enabled → create a new volume from the encrypted snapshot → swap the volume

---

## EFS — Elastic File System

EFS is a fully managed, elastic **NFS file system** that can be mounted concurrently by thousands of EC2 instances, ECS tasks, Lambda functions, and on-premises servers (via Direct Connect or VPN).

### Performance Modes
- **General Purpose** (default): low latency, suitable for most workloads (web serving, CMS, home directories)
- **Max I/O**: scales to higher aggregate throughput and IOPS but with slightly higher latency; use only for highly parallelized big data or media processing workloads (>= hundreds of instances)

You **cannot change** the performance mode after creation.

### Throughput Modes
- **Bursting** (default): throughput scales with file system size (baseline 50 KB/s per GB, burst up to 100 MB/s for small file systems). Works well when size and throughput needs grow together.
- **Provisioned**: set throughput independently of storage size (e.g., 1 GB/s for a small FS). Use when throughput needs exceed what bursting provides for your storage size.
- **Elastic** (recommended for unpredictable workloads): automatically scales up to 3 GB/s reads and 1 GB/s writes; you pay per GB transferred. Best for spiky or hard-to-predict I/O.

### Lifecycle Management
EFS Intelligent-Tiering (similar concept to S3):
- **Standard storage class**: frequently accessed data
- **Infrequent Access (EFS-IA)**: files not accessed for 7, 14, 30, 60, or 90 days are moved automatically; up to 92% cheaper than standard EFS storage
- Files are moved back to Standard on next access
- Enable via a lifecycle policy on the file system

### Mount Targets and Access Points
- **Mount Target**: an NFS endpoint (ENI with IP) in each AZ. Create one mount target per AZ for multi-AZ deployments. Mount using DNS name `fs-xxxx.efs.us-east-1.amazonaws.com`.
- **Access Points**: application-specific entry points that enforce a specific POSIX user identity and root directory. Use to give each microservice or tenant an isolated directory within one shared EFS file system.

### Security
- In-transit encryption: TLS via the EFS mount helper (`amazon-efs-utils`)
- At-rest encryption: KMS (must be configured at creation time)
- [VPC](/aws-vpc-networking) security groups on mount targets control network access; IAM resource policies (EFS file system policies) control API and mount-level access

---

## FSx Family

### FSx for Windows File Server
- Fully managed Windows-native shared file system via **SMB protocol**
- Integrates with **Active Directory** (AWS Managed AD or self-managed AD)
- Supports Windows ACLs, DFS Namespaces, VSS (Volume Shadow Copy for user-facing restores)
- Storage: SSD or HDD; throughput up to 2 GB/s per file system
- Use for: Windows workloads, home directories, SharePoint, SQL Server file shares

### FSx for Lustre (HPC)
- High-performance parallel file system; throughput scales with storage (hundreds of GB/s, millions of IOPS)
- **S3 integration**: lazy-loads data from S3 on first access; write results back to S3
- Deployment types:
  - **Scratch**: temporary, no replication, highest burst throughput per dollar — use for short HPC jobs
  - **Persistent**: replicated within AZ, long-term storage, configurable throughput/IOPS
- Use for: ML training (fast random reads of training data from S3), genomics, financial simulations, rendering

### FSx for NetApp ONTAP
- Full NetApp ONTAP file system on AWS; supports **NFS, SMB, iSCSI**
- Multi-protocol, multi-AZ, auto-tiering to S3
- **SnapMirror** replication for DR (on-premises ONTAP ↔ cloud)
- Use for enterprise migrations lifting-and-shifting NetApp-dependent applications

### FSx for OpenZFS
- Managed **ZFS** file system; NFS v3/v4/v4.1
- Sub-millisecond latency, up to 12.5 GB/s throughput
- Rich data management: snapshots, cloning, compression, deduplication
- Use for workloads migrating from on-premises ZFS/Linux file servers

---

## Storage Gateway

Storage Gateway bridges on-premises environments to AWS storage. Three gateway types:

### File Gateway
- Presents S3 as an **NFS or SMB share** to on-premises servers
- Files written to the share are stored as objects in S3 (one file = one S3 object, full S3 metadata)
- Local cache for low-latency access to recently used data
- Use for: cloud-tiering for on-premises file servers, hybrid backup targets, S3-backed NAS replacement

### Volume Gateway
Two sub-modes:
- **Cached mode**: primary data in S3; frequently accessed data cached on-premises. Presents iSCSI block volumes to applications. Reduces local storage footprint.
- **Stored mode**: primary data on-premises; asynchronously backed up to S3 as EBS snapshots. Provides durable off-site backup with low-latency local access.

### Tape Gateway (Virtual Tape Library)
- Presents a **VTL interface** to existing tape backup software (Veeam, Veritas, Commvault)
- Virtual tapes stored in S3; archived tapes moved to Glacier or Glacier Deep Archive
- Drop-in replacement for physical tape infrastructure — no backup software changes needed
- Use for: compliance-driven tape retention, modernizing tape workflows without re-architecting

---

## AWS Backup

Centralized, policy-driven backup service across AWS services (EBS, RDS, DynamoDB, EFS, FSx, S3, DocumentDB, Neptune, EC2 instance backup via AMI).

### Core Concepts
- **Backup Plan**: defines frequency (daily, weekly), retention period, lifecycle (transition to cold storage after N days, delete after M days), and the vault to store backups
- **Backup Vault**: container for recovery points (encrypted using KMS). A vault can be **locked** (Vault Lock) — once locked (compliance mode), backups cannot be deleted even by the root account until the lock expiry, satisfying WORM compliance requirements
- **Recovery Point**: a snapshot/backup of a specific resource at a point in time
- **Resource Assignment**: tag-based or explicit ARN-based assignment of resources to a backup plan

### Cross-Account and Cross-Region Backup
- **Cross-Region**: copy backups to a secondary Region automatically within the backup plan (for DR)
- **Cross-Account**: copy backups to a separate AWS account (isolated from production, prevents ransomware from reaching backups via compromised credentials)
- Both can be combined: production account backups → backup account in a different Region

```
Production Account (us-east-1)
    ↓ Backup Plan (daily, 30-day retention)
Backup Vault (us-east-1)  →  Copy to → Backup Vault (eu-west-1, backup account)
```

### S3-Specific Backup
AWS Backup for S3 creates continuous (PITR — point-in-time recovery to within 1 hour) and periodic backups. Unlike S3 versioning alone, Backup provides centralized governance, vault lock, and cross-account copies.

---

## Common Interview Questions

**Q: What is the difference between S3 Standard-IA and S3 One Zone-IA? When would you use each?**
**A:** Both classes are designed for infrequently accessed data with a 30-day minimum storage duration and a retrieval fee per GB. The key difference is durability: Standard-IA replicates data across at least 3 AZs (99.999999999% durability), while One Zone-IA stores data in a single AZ (99.5% availability SLA). Use Standard-IA for any data you cannot easily regenerate — DR copies, compliance archives, infrequent reports. Use One Zone-IA only for derived or reproducible data — thumbnail caches, transcoded video previews, reprocessable logs — where the cost savings justify the risk of losing the data if that AZ fails.

**Q: A customer's S3 bucket is being accessed by a CloudFront distribution. How do you ensure the bucket cannot be accessed directly, bypassing CloudFront?**
**A:** Configure **Origin Access Control (OAC)** on the CloudFront distribution (not the legacy OAI). This attaches a SigV4-signed request to all CloudFront→S3 fetches. Then update the S3 bucket policy to grant `s3:GetObject` only to `cloudfront.amazonaws.com` with a `Condition` matching the specific distribution's ARN (`AWS:SourceArn`). Finally, enable all four **Block Public Access** settings on the bucket. This ensures all traffic must come through CloudFront; any direct S3 URL request is denied.

**Q: You need to allow a third-party application to upload files directly to your S3 bucket from a browser without exposing your AWS credentials. What are your options and how do they differ?**
**A:** Two options: **Presigned PUT URL** and **Presigned POST**. A presigned PUT URL is simpler — your server generates a signed URL for a specific key with a specific content type; the browser PUTs the file directly. It offers less control over what the browser can upload. A presigned POST is more powerful — your server generates a policy document that can constrain the key prefix, maximum file size, allowed content types, and metadata. The browser submits an HTML form (or XHR) with the policy, signature, and file. Presigned POST is the correct choice when you need server-enforced upload constraints without processing the upload through your own server.

**Q: What is MFA Delete, and when must you use it?**
**A:** MFA Delete requires a valid MFA token (in addition to standard credentials) to either change the versioning state of a bucket or permanently delete a versioned object. It can only be enabled by the root account user (not IAM users). Use it for your most sensitive, compliance-critical buckets — financial records, audit logs — where you need a second factor to prevent accidental or malicious deletion even by a compromised administrator account. Combined with Vault Lock in AWS Backup, this forms a WORM-compliant architecture.

**Q: Explain S3 multipart upload. What happens if a multipart upload is never completed?**
**A:** Multipart upload splits a large object into parts (min 5 MB each, max 10,000 parts) uploaded in parallel, then atomically assembled. It provides better resilience (retry individual parts), faster aggregate throughput, and is required for objects >5 GB. If an upload is initiated but never completed or aborted, the uploaded parts remain in S3 and **accumulate storage charges indefinitely** — they are invisible in the bucket listing but visible in S3 Inventory. The fix is an S3 lifecycle rule with `AbortIncompleteMultipartUpload` (e.g., 7 days), which automatically deletes orphaned parts.

**Q: What is the difference between gp2 and gp3 EBS volumes? Should you ever use gp2 today?**
**A:** gp2 delivers 3 IOPS per GB of provisioned size, meaning you must over-provision storage to get higher IOPS, up to a maximum of 16,000 IOPS at 5,333+ GB. gp3 provides a flat baseline of 3,000 IOPS and 125 MB/s regardless of size, which can be independently scaled to 16,000 IOPS and 1,000 MB/s at additional cost. gp3 is approximately 20% cheaper per GB than gp2 and offers 4x the max throughput. There is no valid reason to provision new gp2 volumes; migrate existing gp2 volumes to gp3 using live volume modification (no downtime required).

**Q: When would you choose EFS over EBS? Over S3?**
**A:** Choose **EFS** when multiple EC2 instances, Lambda functions, or containers need to concurrently read and write a shared POSIX file system — web server farms sharing uploaded content, CI/CD runners sharing build caches, home directory mounting for hundreds of users. EBS is single-instance (except io1/io2 Multi-Attach) and block-level; EFS is multi-instance and file-level. Choose **S3** over EFS when the access pattern is object-level (upload/download entire files), when you need lifecycle tiering, versioning, or global replication, or when cost is paramount (S3 is an order of magnitude cheaper than EFS for large-scale storage). EFS is best for applications that use standard POSIX file operations and cannot easily adapt to object store semantics.

**Q: A Lambda function processing S3 events sometimes processes the same object twice. Why, and how do you fix it?**
**A:** S3 event notifications have **at-least-once** delivery semantics — S3 may deliver the same event multiple times. Additionally, Lambda itself retries on errors (up to 2 retries for async invocations by default). The fix is to make the Lambda function **idempotent**: before processing, check a deduplication store (DynamoDB item with a conditional write, or a Redis SET NX) using the S3 object's ETag and key as a unique identifier. Only process the object if the record doesn't already exist. Alternatively, route events through SQS with deduplication enabled (FIFO queue) before Lambda; SQS deduplicates within a 5-minute window.

**Q: What is the difference between CloudFront signed URLs and signed cookies?**
**A:** Both restrict access to CloudFront-served content to authorized users only. A **signed URL** grants access to a single specific URL (one file) and is ideal for distributing individual files, for clients that don't support cookies, or when each URL needs different expiry or IP restrictions. A **signed cookie** grants access to multiple files matching a wildcard pattern (e.g., all `/premium/*` content) without modifying each URL — ideal for authenticated streaming (HLS/DASH manifests + segments), premium content libraries, or software download portals where many files constitute a single entitlement.

**Q: Describe how you would design a globally distributed media asset delivery pipeline for a video streaming platform using AWS storage services.**
**A:** Upload path: Mobile/web clients upload video files using **presigned PUT URLs** (or **presigned POST** for browser form uploads) directly to an S3 bucket in the primary Region. S3 triggers an **EventBridge** event → a Step Functions workflow → AWS Elemental MediaConvert for transcoding → output segments written to a second S3 bucket. **S3 Lifecycle** transitions raw uploads to **Standard-IA** after 30 days and Glacier after 1 year. Delivery path: CloudFront distribution with the transcoded output bucket as origin, protected by **OAC**. HLS/DASH manifests and segments are served from CloudFront edge caches with appropriate TTLs (`Cache-Control: max-age=86400` for segments, short TTLs for manifests). Subscribers access content via **CloudFront signed cookies** set after authentication. **Lambda@Edge** at the viewer-request stage validates the JWT and denies unauthorized requests before they reach the origin.

**Q: How does S3 Cross-Region Replication differ from S3 Same-Region Replication? What are the prerequisites and limitations?**
**A:** CRR replicates objects to a bucket in a different AWS Region; SRR replicates within the same Region. Both require versioning enabled on both source and destination buckets. Both are asynchronous (seconds to minutes). Both require an IAM role with permissions to read from the source and write to the destination. Key limitations: existing objects at the time replication is configured are not replicated (use S3 Batch Replication for backfill); delete markers are not replicated by default; replica objects cannot be replicated again (no chaining); lifecycle actions on the source are not replicated. CRR incurs inter-region data transfer costs; SRR does not. Use CRR for DR across Regions, data sovereignty compliance, and global latency reduction; use SRR for log aggregation, cross-account data sharing within a Region, and live test/prod environment sync.

**Q: What is S3 Transfer Acceleration and when should you use it (or not)?**
**A:** Transfer Acceleration routes S3 uploads and downloads through the nearest **CloudFront edge location** over AWS's private backbone, bypassing the public internet for most of the journey. It adds $0.04–$0.08/GB over standard S3 transfer pricing. It is beneficial when users are far from the bucket's Region and upload/download large files (the longer the public internet path, the greater the benefit from private backbone routing). It is NOT beneficial when users are geographically close to the bucket's Region (the overhead of routing through an edge location may actually increase latency), for small objects (per-request latency of the edge hand-off outweighs the throughput benefit), or for intra-AWS transfers (already on the private network). AWS provides a speed comparison tool at `s3-accelerate-speedtest.s3-accelerate.amazonaws.com` to measure actual benefit before enabling.

---

## Architecture Patterns

### Data Lake Foundation on S3
S3 is the standard foundation for AWS data lakes, and feeds directly into AI/ML workloads — see [Bedrock, SageMaker & AI/ML Services](/aws/ai-ml-services) for how SageMaker training jobs, Feature Store, and Bedrock Knowledge Bases consume S3-backed datasets.

```
Raw Ingestion → s3://data-lake/raw/ (Standard, versioned)
    ↓ Glue ETL / Lambda
Cleaned Data  → s3://data-lake/processed/ (Standard or Intelligent-Tiering)
    ↓ Athena / Redshift Spectrum / EMR
Analytics     → Query in place, pay per scan
    ↓ SageMaker / Bedrock Knowledge Bases (see /aws-ai-ml-services)
AI/ML         → Training datasets, vector embeddings, model artifacts
    ↓ Lifecycle
Archive       → s3://data-lake/archive/ → Glacier Deep Archive after 2 years
```

### Serverless File Processing Pipeline
```
User Upload (presigned PUT)
    → S3 bucket (Standard, versioning on, BPA on)
    → EventBridge rule (object created, prefix = uploads/)
    → Step Functions workflow
        ├─ Lambda: validate file type / virus scan
        ├─ Lambda: process / transform
        ├─ S3 PutObject: write result to s3://processed/
        └─ DynamoDB: record job status
    → CloudFront: serve processed output via OAC
```

### Hybrid Storage for Enterprise Migration
```
On-Premises NAS
    → Storage Gateway (File Gateway, NFS/SMB mount)
    → S3 (primary copy, Standard class)
    → S3 Lifecycle → Standard-IA (30 days) → Glacier (365 days)
    → AWS Backup (Vault Lock, cross-account copy to backup account)
```

## S3 Object Lambda — Transform Data On Retrieval

S3 Object Lambda lets you intercept `GetObject` calls and transform the response using a Lambda function, without storing multiple copies of the data.

### How It Works
```
App requests object → S3 Object Lambda Access Point → Lambda transforms → App receives modified data
                              ↓ (fetches original from S3)
                        Original S3 Bucket
```

### Use Cases
- **PII masking**: redact SSN/email before returning to non-privileged callers
- **Format conversion**: return CSV as JSON, convert image formats, compress/decompress
- **Watermarking**: dynamically add watermark to images on retrieval
- **Enrichment**: merge data from multiple S3 objects or databases before returning
- **Access-tier caching**: return cached aggregation result, only re-compute when source changes

```python
import boto3
import json
import urllib3

def lambda_handler(event, context):
    # Get the original object from S3
    s3 = boto3.client('s3')
    object_context = event['getObjectContext']

    # Fetch the original object from S3
    http = urllib3.PoolManager()
    original_object = http.request('GET', object_context['inputS3Url'])

    # Transform: mask SSNs using regex
    import re
    content = original_object.data.decode('utf-8')
    masked = re.sub(r'\b\d{3}-\d{2}-\d{4}\b', '***-**-****', content)

    # Return transformed object
    s3.write_get_object_response(
        Body=masked,
        RequestRoute=object_context['outputRoute'],
        RequestToken=object_context['outputToken'],
        ContentType='text/plain',
        StatusCode=200,
    )
```

---

## S3 Batch Operations

S3 Batch Operations performs large-scale batch actions across billions of objects in a single managed job.

### Supported Operations
- **Invoke Lambda**: pass each object as an event to a Lambda function (most flexible)
- **Copy objects**: copy between buckets (cross-region, cross-account)
- **Replace object tags**: bulk tag update
- **Delete objects**: bulk delete (including versioned objects)
- **Restore objects**: bulk restore from Glacier
- **Replicate objects**: retroactively add older objects to replication rules
- **Apply ACL**: bulk ACL changes

### Job Lifecycle
```
1. Create manifest (CSV or S3 Inventory report listing target objects)
2. Create S3 Batch Operations job with operation + manifest
3. Review estimated job scope (count, size)
4. Confirm + run
5. Job processes objects in parallel (scales automatically)
6. Job completion report written to S3 (success/failure per object)
```

```python
# Create a Batch Operations job to invoke Lambda on all objects
s3control = boto3.client('s3control')

response = s3control.create_job(
    AccountId='123456789012',
    Operation={
        'LambdaInvoke': {
            'FunctionArn': 'arn:aws:lambda:us-east-1:123456789012:function:ProcessObject',
            'InvocationSchemaVersion': '2.0',
        }
    },
    Manifest={
        'Spec': {'Format': 'S3BatchOperations_CSV_20180820', 'Fields': ['Bucket', 'Key']},
        'Location': {'ObjectArn': 'arn:aws:s3:::my-manifests/objects.csv', 'ETag': 'abc123'},
    },
    Report={
        'Bucket': 'arn:aws:s3:::my-reports',
        'Format': 'Report_CSV_20180820',
        'Enabled': True,
        'Prefix': 'batch-reports/',
        'ReportScope': 'AllTasks',
    },
    Priority=10,
    RoleArn='arn:aws:iam::123456789012:role/BatchOperationsRole',
    ConfirmationRequired=False,
)
```

---

## S3 Access Points — Multi-Tenant Access Control

S3 Access Points simplify access management for shared datasets with many applications or teams.

### Problem Without Access Points
- One bucket, 20 teams, each needing different access rules → complex, fragile bucket policy
- Policy size limit: 20 KB — can hit this with many team rules

### Solution: Named Endpoints with Policies
```json
// Access point for "data-science" team — read-only to /analytics/ prefix
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {"AWS": "arn:aws:iam::123456789012:role/DataScienceRole"},
    "Action": ["s3:GetObject", "s3:ListBucket"],
    "Resource": [
      "arn:aws:s3:us-east-1:123456789012:accesspoint/data-science",
      "arn:aws:s3:us-east-1:123456789012:accesspoint/data-science/object/analytics/*"
    ]
  }]
}
```
- Each team gets their own access point ARN to use as the endpoint
- Object Lambda Access Points: access point → Object Lambda (transform) → S3
- VPC-restricted access points: `VpcConfiguration` restricts access to specific [VPC](/aws-vpc-networking)

---

## S3 Express One Zone — Ultra-Low Latency Storage

S3 Express One Zone is a new storage class (2023) optimized for performance-sensitive workloads:

- **Latency**: single-digit millisecond (10× faster than S3 Standard)
- **Throughput**: higher request rate (better for ML training data loading)
- **Availability**: single AZ (vs multi-AZ for Standard) — lower durability
- **Cost**: higher storage cost ($0.16/GB vs $0.023/GB), lower request cost ($0.0004/1K GET vs $0.0004) — see [Cost Optimization](/aws-cost-optimization) for storage class cost trade-offs
- **Use cases**: ML training (reduce data loading bottleneck), analytics (Athena query acceleration), real-time media processing
- **Not for**: durable storage, compliance data, backup/archive

---

## S3 Select & Glacier Select

Query data within S3 objects without downloading the entire object.

```python
# Retrieve only specific columns from a CSV/JSON/Parquet in S3
response = s3.select_object_content(
    Bucket='my-data-lake',
    Key='orders/2024/january.parquet',
    ExpressionType='SQL',
    Expression="SELECT customerId, total FROM S3Object WHERE status = 'completed' AND total > 1000",
    InputSerialization={'Parquet': {}},
    OutputSerialization={'JSON': {'RecordDelimiter': '\n'}},
)

# Process streaming response
for event in response['Payload']:
    if 'Records' in event:
        data = event['Records']['Payload'].decode('utf-8')
        print(data)
```

- Saves bandwidth: only download matching rows/columns
- S3 Select supports: CSV, JSON, Parquet, GZIP/BZIP2 for CSV/JSON
- Glacier Select: same capability for archived objects (minutes retrieval vs hours for full restore)
- Compare vs Athena: S3 Select is per-object query; Athena is cross-object SQL with partitioning — see [Data Analytics](/aws-data-analytics) for Athena, Glue, and Redshift Spectrum patterns

---

## FSx Family — Specialized File Systems

| Service | Protocol | Optimized For | Typical Use Case |
|---|---|---|---|
| **FSx for Lustre** | POSIX | High-throughput parallel I/O | ML training, HPC, media rendering |
| **FSx for Windows** | SMB/NTFS | Windows workloads | Active Directory, SQL Server backups |
| **FSx for NetApp ONTAP** | NFS/SMB/iSCSI | Enterprise storage features | Lift-and-shift enterprise apps |
| **FSx for OpenZFS** | NFS/ZFS | Low-latency NAS | Workloads requiring ZFS features |

### FSx for Lustre — ML Training Pattern
```
S3 Data Lake → [lazy loading] → FSx for Lustre (linked to S3)
                                       ↓
                           ML Training Job (ECS/SageMaker)
                                       ↓
                              Results → S3 (export)
```
- S3 Linked File System: mount Lustre filesystem; access S3 objects as files; lazy-loaded on first access
- 2 deployment types: Scratch (temporary, no replication, max throughput) vs Persistent (replicated within AZ, for longer jobs)
- Throughput: 200 MB/s to 2+ GB/s depending on storage size
- Integration: SageMaker Training Jobs support Lustre as a native data source

---

## Transfer Acceleration & S3 Performance

### Transfer Acceleration
- Uploads route through nearest [CloudFront](/aws-cloudfront-route53) edge PoP → AWS private network → S3
- 50–500% faster for cross-region uploads from end users
- Enable per bucket: `s3.us-east-1.accelerate.amazonaws.com` endpoint
- Cost: $0.04–$0.08/GB transferred (on top of standard S3 PUT cost) — see [Cost Optimization](/aws-cost-optimization) before enabling for high-volume workloads
- Use when: users globally upload large files to a centralized bucket; latency matters

### S3 Request Rate Limits
- > 5,500 GET/HEAD and 3,500 PUT/COPY/POST/DELETE per second per prefix (partition)
- Spread objects across prefixes for high-throughput workloads
- Do NOT use date-based prefixes for high-volume ingestion (all objects hash to same partition)
- Use random prefixes: `a3f2/`, `d9b1/`, etc.

---

## Red Flags to Avoid
- **"S3 is eventually consistent."** As of December 2020, S3 provides strong read-after-write consistency for all operations. Saying otherwise signals outdated knowledge.
- **"I'll just make the S3 bucket public."** Always default to private buckets with BPA enabled. Serve public content through CloudFront with OAC, not via S3 public access.
- **"I'll store the access key and secret in the Lambda environment variables."** Use IAM execution roles. Lambda, EC2, and ECS tasks get temporary credentials automatically via the instance metadata service — no static keys needed.
- **"Lifecycle rules take effect immediately."** Lifecycle rule evaluation runs daily; actual transitions typically happen within 24–48 hours of the configured day threshold.
- **"I can use EBS across multiple instances."** Standard EBS volumes (gp2, gp3, st1, sc1) are exclusive to one instance at a time. Only io1/io2 support Multi-Attach, and even then it requires a cluster-aware file system.
- **"EFS is just NFS-mounted EBS."** EFS is an independent managed service with its own scaling, throughput modes, and pricing model. It is not EBS in disguise.
- **"CloudFront OAI is the current best practice."** OAI is legacy. OAC is the current recommendation — it supports SSE-KMS buckets, POST/PUT/DELETE method signing, and is more secure.
- **"Presigned URLs last forever."** They expire. Max 7 days for IAM user credentials, 12 hours for role-based (STS) credentials. Design workflows to regenerate them before expiry.
- **"S3 Select replaces Athena."** S3 Select queries a single object with simple SQL; Athena spans entire data lake partitions with full SQL, joins, and aggregations. They solve different problems at different scales.
