# AWS Databases — RDS, Aurora, ElastiCache

## The 30-Second Pitch

Amazon RDS, Aurora, and ElastiCache cover the relational and in-memory database needs for the vast majority of production workloads on AWS. RDS gives you managed MySQL, PostgreSQL, and other engines with automated backups, Multi-AZ failover, and read replicas—without touching the operating system. Aurora is AWS's rewrite of the relational engine for the cloud: same SQL interfaces, but shared distributed storage spanning 3 AZs, sub-30-second failover, and up to 5× MySQL throughput. ElastiCache puts Redis or Memcached in a managed cluster for sub-millisecond caching, session storage, and pub/sub. Together they cover the spectrum from OLTP to microsecond reads, and understanding their trade-offs—especially versus [DynamoDB](/dynamodb-data-services)—is essential for AWS architecture and senior engineering interviews.

---

## How It Actually Works

### RDS Architecture

```
                    ┌──────────────────────────────┐
                    │         RDS Multi-AZ          │
                    │                               │
  App ──────────────▶  Primary DB Instance (AZ-A)  │
                    │         │  sync replication   │
                    │         ▼                     │
                    │  Standby DB Instance (AZ-B)   │
                    │    (NOT readable, HA only)     │
                    │                               │
  Read Traffic ─────▶  Read Replica 1 (AZ-A/B/C)  │
  Read Traffic ─────▶  Read Replica 2 (cross-region)│
                    └──────────────────────────────┘
                    Each instance: its own EBS volume
```

### Aurora Architecture

```
                    ┌─────────────────────────────────────────┐
                    │           Aurora Cluster                 │
                    │                                          │
  Writes ───────────▶  Writer Instance (AZ-A)                │
  Reads  ───────────▶  Reader Instance 1 (AZ-A)              │
  Reads  ───────────▶  Reader Instance 2 (AZ-B)              │
  Reads  ───────────▶  Reader Instance 3 (AZ-C)              │
                    │         │ all share ↓                    │
                    │  ┌─────────────────────────┐            │
                    │  │  Distributed Storage    │            │
                    │  │  6 copies / 3 AZs       │            │
                    │  │  Auto-heals, 128 TB max │            │
                    │  └─────────────────────────┘            │
                    └─────────────────────────────────────────┘
                    Single storage layer — no per-instance volumes
```

### ElastiCache Architecture

```
  Cluster Mode Disabled:            Cluster Mode Enabled:
  ┌──────────────────┐              ┌────────────────────────┐
  │  Primary (AZ-A)  │              │  Shard 0: 0000–3FFF    │
  │  Replica (AZ-B)  │              │  ├─ Primary (AZ-A)     │
  │  Replica (AZ-C)  │              │  └─ Replica (AZ-B)     │
  │  same dataset    │              │  Shard 1: 4000–7FFF    │
  └──────────────────┘              │  ├─ Primary (AZ-B)     │
                                    │  └─ Replica (AZ-C)     │
  Max: 1 primary + 5 replicas       │  ...up to 500 shards   │
  Vertical scale only               └────────────────────────┘
                                    Horizontal + vertical scale
```

---

## 1. Amazon RDS — Managed Relational Databases

### Supported Engines

| Engine | Versions | License | Notes |
|---|---|---|---|
| MySQL | 8.0, 8.4 | GPL | Most popular; good Aurora MySQL compatibility |
| PostgreSQL | 15, 16, 17 | PostgreSQL | Best feature parity; extensions supported |
| MariaDB | 10.6, 10.11 | GPL | MySQL fork; good for MySQL migrations |
| Oracle | 19c, 21c | BYOL or LI | BYOL = bring your own license; LI = license included |
| SQL Server | SE, EE | License Included | SE cheaper; EE for full features |
| Db2 | 11.5 | BYOL | Enterprise workloads migrating from IBM |

### Instance Classes

| Class | Family | Purpose | When to use |
|---|---|---|---|
| db.t4g | Burstable | Dev/test | Low sustained CPU; credit-based bursting |
| db.m7g | General | Production OLTP | Balanced CPU/RAM; Graviton3 |
| db.r7g | Memory-optimized | Large datasets, analytics | 2× RAM per vCPU vs m-class |
| db.x2g | Extreme memory | In-memory workloads | SAP, large Oracle, heavy caching |

**Graviton3 (g suffix) instances** offer ~20–40% better price-performance than equivalent x86 instances for most RDS workloads.

### Storage Options

| Type | Baseline IOPS | Max IOPS | Throughput | Use case |
|---|---|---|---|---|
| gp3 | 3,000 included | 64,000 | Up to 4,000 MB/s | Default for most workloads |
| io1 | Provisioned | 256,000 | Up to 4,000 MB/s | Highest IOPS, consistent latency |
| io2 | Provisioned | 256,000 | Up to 4,000 MB/s | io1 successor; higher durability |
| magnetic | ~100 | ~100 | Low | Legacy only — never use for new workloads |

**gp3 key advantage:** IOPS and throughput are provisioned independently of storage size. You can have a 100 GB volume with 10,000 IOPS without paying for a larger volume (unlike gp2, where IOPS scaled with size at 3 IOPS/GB).

**Storage autoscaling:** Enabled by default. Grows in 10 GB increments when free space falls below a threshold. Never shrinks automatically — plan your initial size knowing the floor is permanent.

### Multi-AZ Deployment

Multi-AZ provides **high availability**, not scale-out. The standby replica in a second AZ receives **synchronous** replication from the primary. On failure, AWS updates the DNS CNAME to point to the standby — typically within 60–120 seconds.

**What Multi-AZ does:**
- Automatic failover on instance failure, OS patching, AZ outage
- No data loss (synchronous replication)
- No application changes needed (same endpoint DNS)

**What Multi-AZ does NOT do:**
- The standby is not readable — zero read scale-out
- Failover takes 60–120 seconds (DNS TTL + reconnect)
- Does not protect against data corruption or human error (use backups)

### Read Replicas

Read Replicas use **asynchronous** replication and are fully readable. Use them to offload read traffic from the primary.

- Up to 15 replicas per primary
- Cross-region replicas supported (useful for DR and geo-local reads)
- Can be promoted to a standalone DB instance (breaks replication permanently)
- Replica lag is typically < 1 second for low-write workloads; can grow under heavy writes

**Key interview point:** Multi-AZ standby cannot be promoted to standalone and is never readable. A Read Replica can be promoted but is not a failover target for Multi-AZ.

### Parameter Groups and Option Groups

**Parameter groups** configure the DB engine itself. Every RDS instance is associated with a parameter group.

```
# PostgreSQL parameter group examples
max_connections       = LEAST({DBInstanceClassMemory/9531392}, 5000)
work_mem              = 65536          # 64 MB per sort operation
shared_buffers        = {DBInstanceClassMemory/32768}
log_min_duration_statement = 1000      # log queries > 1s
```

**Option groups** add optional features on top of the engine, primarily for Oracle and SQL Server:
- Oracle: Transparent Data Encryption (TDE), native audit, Oracle Application Express
- SQL Server: SQL Server Reporting Services (SSRS), native backup/restore to S3

### RDS Proxy

RDS Proxy solves the Lambda-at-scale connection problem. Lambda functions don't maintain persistent connections — each invocation may open a new DB connection, and at 1,000 concurrent Lambda invocations you get 1,000 simultaneous connections to your DB.

**Without proxy:** 1,000 Lambda invocations → 1,000 DB connections → OOM or connection refused.

**With proxy:** 1,000 Lambda invocations → Proxy → 20–50 pooled DB connections.

RDS Proxy maintains a warm connection pool and multiplexes Lambda connections onto a small number of backend connections. It also provides:
- IAM authentication + Secrets Manager credential rotation without app restarts
- Automatic failover redirect in < 10 seconds (vs 60–120s for DNS propagation)
- TLS enforcement

**Cost:** ~$0.015/vCPU/hr of the RDS instance behind the proxy. Roughly $10–20/month for a db.r7g.2xlarge.

### Backup and Recovery

**Automated backups:**
- Retention: 1–35 days (0 = disabled, deletes all automated backups)
- Point-in-time restore to any second within the retention window
- Stored in S3 (managed by AWS, not visible in your bucket)
- Slight I/O pause during backup on Single-AZ; no impact on Multi-AZ (backup from standby)

**Manual snapshots:**
- Retained until you delete them (outlive the DB instance)
- Can be copied to another region for DR
- Restoring creates a new DB instance — not in-place

**Cross-region snapshot copy:**
- Automate via Lambda + EventBridge scheduled rule, or AWS Backup policies
- Target region must have RDS available and KMS key for encryption

### Maintenance Windows

RDS applies OS patches and minor version upgrades during a configurable weekly maintenance window (30-minute window, e.g., `sun:05:00-sun:05:30`). For Multi-AZ: failover to standby → patch primary → failover back. Typical downtime < 5 minutes.

### CDK Example: RDS PostgreSQL with Multi-AZ + Read Replica

```typescript
import * as rds from 'aws-cdk-lib/aws-rds';
import * as ec2 from 'aws-cdk-lib/aws-ec2';

// Parameter group for PostgreSQL 16
const paramGroup = new rds.ParameterGroup(this, 'PgParams', {
  engine: rds.DatabaseInstanceEngine.postgres({
    version: rds.PostgresEngineVersion.VER_16,
  }),
  parameters: {
    max_connections: '500',
    work_mem: '65536',
    log_min_duration_statement: '1000',
    shared_preload_libraries: 'pg_stat_statements',
  },
});

// Security group — only accept traffic from app tier
const dbSg = new ec2.SecurityGroup(this, 'DbSg', { vpc });
dbSg.addIngressRule(appSg, ec2.Port.tcp(5432));

// Primary instance with Multi-AZ
const primary = new rds.DatabaseInstance(this, 'Primary', {
  engine: rds.DatabaseInstanceEngine.postgres({
    version: rds.PostgresEngineVersion.VER_16,
  }),
  instanceType: ec2.InstanceType.of(
    ec2.InstanceClass.R7G,
    ec2.InstanceSize.XLARGE2,
  ),
  vpc,
  vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
  securityGroups: [dbSg],
  multiAz: true,
  storageType: rds.StorageType.GP3,
  allocatedStorage: 100,
  maxAllocatedStorage: 500,      // autoscaling up to 500 GB
  iops: 6000,                    // gp3: provision independently
  parameterGroup: paramGroup,
  backupRetention: Duration.days(14),
  deletionProtection: true,
  storageEncrypted: true,
});

// Read replica in a different AZ
const readReplica = new rds.DatabaseInstanceReadReplica(this, 'ReadReplica', {
  sourceDatabaseInstance: primary,
  instanceType: ec2.InstanceType.of(
    ec2.InstanceClass.R7G,
    ec2.InstanceSize.XLARGE,    // smaller — reads only
  ),
  vpc,
  availabilityZone: 'us-east-1c',
});
```

---

## 2. Amazon Aurora — High-Performance Cloud-Native DB

Aurora is not a hosted version of MySQL or PostgreSQL — it's a purpose-built cloud database that speaks those protocols. The core innovation is the **shared distributed storage layer**, which is physically separate from the compute instances.

### Cluster Architecture

An Aurora **cluster** consists of:
- 1 **writer instance** (the primary): handles all writes and can also serve reads
- Up to 15 **reader instances**: serve read traffic from the same shared storage
- 1 **cluster endpoint** (DNS): always points to the current writer
- 1 **reader endpoint** (DNS): load-balances across all readers
- Per-instance **endpoints**: for pinning specific readers

### Storage Architecture

Aurora storage is **not per-instance EBS**. It is a distributed storage system that:
- Stores **6 copies** of every data page across **3 AZs** (2 copies per AZ)
- Requires **4/6 copies** for a write quorum (can survive 2 AZ failures for writes)
- Requires **3/6 copies** for a read quorum (can survive 3 AZ failures for reads)
- Auto-heals: if a storage node fails, Aurora rebuilds it from peer nodes in the background
- **Auto-grows** in 10 GB increments up to 128 TB — you never provision storage
- **No data movement** when reader instances are added or removed

**Key interview point:** Because all instances share the same storage, adding a reader to Aurora is fast (minutes, no data copy). Adding a Read Replica to standard RDS requires copying the full dataset to a new EBS volume.

### Failover

Aurora writer failover is < 30 seconds (vs 60–120 seconds for RDS Multi-AZ) because:
1. Readers already have the storage pages in their buffer caches
2. No block-level sync needed — the promoted reader and old writer shared the same storage
3. Aurora tracks the **highest log sequence number (LSN)** each reader has applied; the reader with the highest LSN and lowest tier number is promoted

**Reader tiers (0–15):** Lower tier = promoted first. Assign your best-provisioned reader to tier 0 for fastest failover.

### Performance

| Metric | Aurora MySQL | Aurora PostgreSQL |
|---|---|---|
| vs RDS MySQL same hardware | Up to 5× throughput | — |
| vs RDS PostgreSQL same hardware | — | Up to 3× throughput |
| Reason | Log-structured writes bypass binlog, distributed redo | Shared storage + write quorum |

### Aurora Global Database

| Attribute | Value |
|---|---|
| Secondary regions | Up to 5 |
| Replication lag | Typically < 1 second |
| Replication mechanism | Storage-level (not binlog/WAL shipping) |
| Secondary regions | Read-only by default |
| Failover type | Manual (with automation via scripts/Lambda) |
| RTO on failover | < 1 minute (manual promotion) |
| RPO on failover | < 1 second (typical replication lag) |

**Use cases:** DR with near-zero RPO, low-latency reads near users in multiple continents, compliance (data in specific region, readable globally).

**Failover process:** Detach the secondary cluster → promote it to standalone → update application connection strings. AWS does not do this automatically (as of 2025) — you orchestrate it via Lambda or Terraform.

### Aurora Serverless v2

Aurora Serverless v2 scales the compute layer automatically in **0.5 ACU increments**.

**ACU (Aurora Capacity Unit):** ~2 GB RAM + proportional CPU + network. A 4 ACU instance has ~8 GB RAM.

| Attribute | Aurora Serverless v2 | Aurora Serverless v1 (legacy) |
|---|---|---|
| Scale increment | 0.5 ACU | Doubling steps |
| Scale speed | < 1 second | Minutes |
| Minimum capacity | 0.5 ACU | 1 ACU |
| Maximum capacity | 256 ACU | 256 ACU |
| Cold start | No (stays warm) | Yes (scales to zero) |
| Scales to zero | No (0.5 ACU min) | Yes |
| Can mix with provisioned | Yes (same cluster) | No |
| Connections | Normal Aurora behavior | Limited |

**When to use Serverless v2:**
- Dev/test environments where the DB is mostly idle (~$0.06/hr at 0.5 ACU)
- APIs with highly unpredictable or spiky traffic patterns
- Multi-tenant SaaS where per-tenant DB cost needs to flex with usage
- Applications that need to go from 0.5 ACU to 128 ACU in seconds during a traffic spike

**Limitation:** Serverless v2 does not scale to zero. For true zero-cost idle, you need v1 (deprecated, limited) or schedule start/stop via Lambda.

### Aurora Backtrack (MySQL Only)

Backtrack rewinds the cluster to a prior point in time **in-place**, without creating a new cluster. Up to 72-hour window. Much faster than snapshot restore for recovering from `DROP TABLE` or bad migrations.

**Cost:** $0.012/million change records stored.

**Limitation:** Not available for Aurora PostgreSQL. For PostgreSQL, use snapshot restore or point-in-time recovery.

### Aurora ML

Aurora can call **SageMaker** and **Amazon Comprehend** directly from SQL using native functions. You write standard SQL; Aurora calls the ML endpoint and returns results as columns.

```sql
-- Sentiment analysis using Comprehend from PostgreSQL
SELECT review_text,
       aws_comprehend_detect_sentiment(review_text, 'en') AS sentiment
FROM product_reviews
WHERE created_at > NOW() - INTERVAL '7 days';
```

### Aurora I/O-Optimized

Standard Aurora charges per I/O request (~$0.20/million reads, $0.20/million writes). For I/O-heavy workloads:

- **Standard:** Pay per I/O + lower instance/storage cost
- **I/O-Optimized:** Zero I/O charges + ~25% higher instance cost + ~25% higher storage cost

**Break-even:** If I/O cost exceeds ~25% of your total cluster bill, I/O-Optimized is cheaper. Good fit for OLAP, heavy analytics, or write-heavy workloads.

### HA Comparison Table

| Feature | RDS Multi-AZ | Aurora HA | Aurora Global |
|---|---|---|---|
| Replicas | 1 standby (not readable) | Up to 15 readers (readable) | Up to 5 secondary regions |
| Failover time | 60–120s | < 30s | < 1 min (manual) |
| Replication | Synchronous (block-level) | Storage-level (shared) | Storage-level async |
| Read scale-out | No | Yes | Read-only secondary regions |
| RPO | ~0 | ~0 | < 1s typical |
| Cross-region | Only via snapshots | Via Global DB feature | Native |
| Data loss on failover | None | None | < 1s |

---

## 3. RDS Proxy — Deep Dive

### The Problem

Traditional DB connections are expensive: each connection holds ~5–10 MB of RAM on the DB server, has a TCP handshake cost, and takes time to authenticate. An RDS PostgreSQL db.r7g.large instance (32 GB RAM) can handle roughly 3,400 max connections before running out of memory.

Lambda at scale is the worst pattern for this:
- Each Lambda execution environment opens 1+ connections on init
- Connections aren't shared across Lambda containers
- At 1,000 concurrent invocations: 1,000–5,000 DB connections
- Bursts to 3,000+ concurrent Lambdas will crash a medium RDS instance

### How Proxy Solves It

```
Lambda containers (1000s)        RDS Proxy           Aurora PostgreSQL
┌──────────────────────┐        ┌─────────┐         ┌───────────────┐
│ Lambda container 1   │──────▶ │         │ ──────▶ │               │
│ Lambda container 2   │──────▶ │  Pool:  │ ──────▶ │  ~50 backend  │
│ Lambda container 3   │──────▶ │  1000   │ ──────▶ │  connections  │
│ ...                  │──────▶ │  front  │         │               │
│ Lambda container N   │──────▶ │  end    │         └───────────────┘
└──────────────────────┘        └─────────┘
       1000+ connections         multiplexed to ~50
```

### IAM Authentication Flow

```
Lambda function
  │  1. Assume IAM role (via execution role)
  │  2. Call rds:connect to generate auth token (15-min expiry)
  ▼
RDS Proxy
  │  3. Proxy validates IAM token
  │  4. Proxy fetches master credentials from Secrets Manager
  ▼
Aurora PostgreSQL
  5. Proxy connects with master credentials
  6. Lambda never knows the DB password
```

### Lambda → RDS Proxy → Aurora PostgreSQL (Node.js)

```typescript
import { RDSDataClient } from '@aws-sdk/client-rds-data';
import { Signer } from '@aws-sdk/rds-signer';
import { Client } from 'pg';

// Initialized ONCE outside handler (warm start reuse)
const signer = new Signer({
  region: process.env.AWS_REGION!,
  hostname: process.env.PROXY_ENDPOINT!,  // RDS Proxy endpoint
  port: 5432,
  username: 'lambda_user',
});

let pgClient: Client | null = null;

async function getConnection(): Promise<Client> {
  if (pgClient && pgClient['_connected']) return pgClient;

  // IAM token — rotates automatically every 15 min
  const token = await signer.getAuthToken();

  pgClient = new Client({
    host: process.env.PROXY_ENDPOINT,
    port: 5432,
    database: process.env.DB_NAME,
    user: 'lambda_user',
    password: token,          // IAM token as password
    ssl: { rejectUnauthorized: true },
    connectionTimeoutMillis: 5000,
  });

  await pgClient.connect();
  return pgClient;
}

export const handler = async (event: AWSLambda.APIGatewayEvent) => {
  const client = await getConnection();

  const result = await client.query(
    'SELECT id, name FROM users WHERE tenant_id = $1 LIMIT 100',
    [event.pathParameters?.tenantId],
  );

  return {
    statusCode: 200,
    body: JSON.stringify(result.rows),
  };
};
```

**Supported backends:** RDS MySQL 5.7/8.0, RDS PostgreSQL 13+, Aurora MySQL 5.7/8.0, Aurora PostgreSQL 13+.

**Failover improvement:** Proxy caches the new writer endpoint and redirects connections in < 10 seconds, compared to 60–120 seconds waiting for DNS TTL to expire on direct connections.

---

## 4. Amazon ElastiCache — In-Memory Caching

### ElastiCache for Redis (Valkey)

As of 2024, AWS ElastiCache for Redis is built on **Valkey** (the Redis fork maintained by AWS and the Linux Foundation after the Redis license change). The API is fully compatible with Redis 7.x.

#### Cluster Mode Disabled

- 1 primary + up to 5 read replicas
- All nodes hold the **same full dataset**
- Failover: replica promoted to primary in ~1–2 minutes
- Vertical scaling only (instance type change = rolling restart)
- Maximum dataset size = single node memory limit

```
Primary (us-east-1a)   ← writes
  ├── Replica 1 (us-east-1b)  ← reads
  └── Replica 2 (us-east-1c)  ← reads, also failover target
```

#### Cluster Mode Enabled

- Up to 500 shards × 5 replicas per shard = 2,500 nodes maximum
- Keyspace is **hash-slotted** (0–16383 slots, divided across shards)
- Horizontal + vertical scaling
- Resharding (rebalancing) happens online with minimal impact

**When to switch from Disabled to Enabled:** Dataset > single node limit, or throughput > ~200K ops/sec on a single shard.

#### Data Types and Use Cases

| Data Type | Redis Command | Use Case |
|---|---|---|
| String | SET/GET | Simple cache, counters, flags |
| Hash | HSET/HGET | User sessions, objects |
| List | LPUSH/RPOP | Job queues, activity feeds |
| Set | SADD/SMEMBERS | Tags, unique visitors |
| Sorted Set | ZADD/ZRANGE | Leaderboards, priority queues |
| HyperLogLog | PFADD/PFCOUNT | Cardinality estimation (~0.81% error) |
| Stream | XADD/XREAD | Event streams, logs |
| Geospatial | GEOADD/GEODIST | Location-based queries |

#### ElastiCache Serverless (Redis)

- No cluster provisioning — auto-scales compute and memory
- Pricing: $0.00034/ECPU + $0.20/GB-hr storage
- Multi-AZ by default; instant failover
- Good for: unpredictable traffic, infrequent access patterns, low operational overhead
- Limitation: higher latency than provisioned (~1–2ms vs ~0.2ms) due to proxy layer

#### Persistence Modes

| Mode | Mechanism | Durability | Performance Impact |
|---|---|---|---|
| None | No persistence | Data lost on restart | Fastest |
| RDB | Snapshot at intervals | Up to interval of data loss | Low (background fork) |
| AOF | Log every write | Near-zero data loss | Medium (fsync options) |
| RDB + AOF | Both | Near-zero data loss | Slightly higher |

**For pure cache:** No persistence — restart quickly from source DB.
**For session store:** AOF with `appendfsync everysec` — tolerate 1-second loss.

#### Caching Patterns

**Cache-aside (lazy loading) — most common:**

```
Read:
  1. Check cache
  2a. Cache hit → return data
  2b. Cache miss → query DB → store in cache with TTL → return data

Write:
  1. Write to DB
  2. Invalidate cache key (or update cache)
```

**Write-through:**
```
Write:
  1. Write to cache
  2. Write to DB (synchronously)
Read:
  1. Always hits cache (populated on write)
```

**Write-behind (risky):**
```
Write:
  1. Write to cache
  2. Asynchronously flush to DB (batched)
Risk: cache node fails before flush → data loss
```

**Read-through:** App talks only to cache; cache fetches from DB on miss. Requires cache-aware library.

#### Cache-Aside Pattern in Node.js (ioredis)

```typescript
import Redis from 'ioredis';
import { Pool } from 'pg';

const redis = new Redis({
  host: process.env.REDIS_ENDPOINT,
  port: 6379,
  tls: {},    // ElastiCache in-transit encryption
  lazyConnect: true,
});

const pg = new Pool({ connectionString: process.env.DATABASE_URL });

const CACHE_TTL = 300; // 5 minutes

async function getUserById(userId: string) {
  const cacheKey = `user:${userId}`;

  // 1. Try cache first
  const cached = await redis.get(cacheKey);
  if (cached) {
    return JSON.parse(cached);
  }

  // 2. Cache miss — query DB
  const result = await pg.query(
    'SELECT id, name, email, tier FROM users WHERE id = $1',
    [userId],
  );
  const user = result.rows[0] ?? null;

  // 3. Populate cache with TTL
  if (user) {
    await redis.setex(cacheKey, CACHE_TTL, JSON.stringify(user));
  }

  return user;
}

async function updateUser(userId: string, data: Partial<User>) {
  // 1. Write to DB first (source of truth)
  await pg.query(
    'UPDATE users SET name = $1, tier = $2 WHERE id = $3',
    [data.name, data.tier, userId],
  );

  // 2. Invalidate cache — next read will repopulate
  await redis.del(`user:${userId}`);

  // Alternative: update cache directly
  // await redis.setex(`user:${userId}`, CACHE_TTL, JSON.stringify({...user, ...data}));
}

// Rate limiting with sorted sets
async function checkRateLimit(
  clientId: string,
  maxRequests: number,
  windowSecs: number,
): Promise<boolean> {
  const key = `ratelimit:${clientId}`;
  const now = Date.now();
  const windowStart = now - windowSecs * 1000;

  const pipeline = redis.pipeline();
  pipeline.zremrangebyscore(key, '-inf', windowStart); // remove old entries
  pipeline.zadd(key, now, `${now}`);                   // add current request
  pipeline.zcard(key);                                  // count in window
  pipeline.expire(key, windowSecs);                    // reset TTL

  const results = await pipeline.exec();
  const count = results?.[2]?.[1] as number;

  return count <= maxRequests;
}
```

### ElastiCache for Memcached

Memcached is the simpler option: pure key-value, no persistence, no replication, multi-threaded.

| Feature | Redis (Valkey) | Memcached |
|---|---|---|
| Data types | Rich (8+ types) | String/Binary only |
| Persistence | Yes (RDB/AOF) | No |
| Replication | Yes | No |
| Pub/Sub | Yes | No |
| Lua scripting | Yes | No |
| Multi-threading | Single-threaded (Redis 6+ I/O threads) | Native multi-thread |
| Cluster sharding | Yes (hash slots) | Client-side (ketama) |
| Failover | Automatic (Multi-AZ) | None (client rerouths) |

**Choose Memcached when:** You only need simple string caching, want multi-threaded performance for CPU-bound cache operations, and don't need persistence or complex data structures.

**Choose Redis for everything else:** persistence, sessions, leaderboards, pub/sub, Lua scripts, replication.

---

## 5. ElastiCache vs DynamoDB DAX

Both sit in front of a database to accelerate reads, but they serve different purposes.

| Attribute | ElastiCache Redis | DynamoDB DAX |
|---|---|---|
| Primary DB | Any (RDS, Aurora, external) | DynamoDB only |
| Data types | Rich Redis types | DynamoDB items only |
| API | Redis protocol (custom client) | DynamoDB API (drop-in) |
| Consistency | Application-managed | Eventual consistency |
| Read latency | ~200 µs–1 ms | Single-digit microseconds |
| Cache invalidation | Manual (app deletes keys) | Automatic on DAX write-through |
| Write caching | Optional (write-through) | Write-through to DynamoDB |
| Hot partition relief | App must route to Redis | Automatic (DAX absorbs hot reads) |
| Session store | Yes (natural fit) | Awkward (DynamoDB data model) |
| Rate limiting | Yes (sorted sets) | No |
| Cost model | Per node-hour | Per node-hour (DAX cluster) |
| Cluster scale | Up to 500 shards | Up to 10 nodes |

**When to use DAX:** You're already on DynamoDB, you have hot partition issues, you need sub-millisecond reads, and you want zero application changes (DAX is API-compatible).

**When to use ElastiCache:** Your data lives in RDS/Aurora/any DB, you need complex caching patterns, session store, rate limiting, pub/sub, or you want full control over invalidation.

See [DynamoDB](/dynamodb-data-services) for DynamoDB access patterns and DAX deep-dive.

---

## 6. Database Selection Decision Framework

### Comparison Table

| Criterion | RDS PostgreSQL | Aurora Serverless v2 | Aurora PostgreSQL (provisioned) | DynamoDB | ElastiCache Redis |
|---|---|---|---|---|---|
| Schema | Fixed, relational | Fixed, relational | Fixed, relational | Flexible (schemaless) | Key-value / typed |
| Scale pattern | Vertical + replicas | Auto (0.5–256 ACU) | Vertical + 15 readers | Horizontal (unlimited) | Vertical + sharding |
| ACID | Full | Full | Full | Per-item only | No (single command atomic) |
| Join support | Yes | Yes | Yes | No (single table only) | No |
| Max throughput | ~50K TPS (r7g.8xl) | ~256 ACU worth | ~500K TPS (32xl) | Unlimited (provisioned) | ~1M ops/sec (cluster) |
| Cost model | Per instance-hr | Per ACU-hr | Per instance-hr | Per RCU/WCU or on-demand | Per node-hr |
| Operational complexity | Medium | Low | Medium | Low | Medium |
| Ideal use case | OLTP, migrations | Unpredictable traffic | High-throughput OLTP | Key-value, event stores | Cache, sessions |

### Decision Matrix

```
Need complex joins + ACID + < 10K TPS?
  → Aurora PostgreSQL (provisioned) or RDS PostgreSQL

Need > 10K TPS + simple access patterns + global scale?
  → DynamoDB (with provisioned capacity)

Traffic is unpredictable and may spike 10× in seconds?
  → Aurora Serverless v2

Sub-millisecond reads + cache + session store + rate limiting?
  → ElastiCache Redis

Migrating on-prem Oracle/SQL Server?
  → RDS (matching engine, minimize migration risk)

Multi-tenant SaaS, < 500 tenants, different schemas per tenant?
  → Aurora PostgreSQL, one schema per tenant (search_path)

Multi-tenant SaaS, > 10K tenants, same schema?
  → DynamoDB (tenant_id as partition key) or Aurora Serverless v2
```

---

## 7. Performance Tuning

### RDS and Aurora PostgreSQL

**max_connections formula:**

RDS sets `max_connections` dynamically based on RAM:
```
max_connections = LEAST({DBInstanceClassMemory / 9531392}, 5000)
```

A db.r7g.2xlarge (64 GB RAM) gets ~6,700 max connections. But each connection uses ~5–10 MB of RAM for its working memory — at full capacity you'd use 33–67 GB just for connections. Use RDS Proxy or PgBouncer to avoid hitting this limit.

**PgBouncer (self-managed connection pooler for PostgreSQL):**

```ini
[pgbouncer]
pool_mode = transaction        # best for web apps (share conn per transaction)
max_client_conn = 10000        # clients PgBouncer accepts
default_pool_size = 50         # backend connections to Aurora
server_idle_timeout = 600
```

Transaction mode: a backend connection is held only for the duration of one transaction, then returned to pool. Incompatible with `SET` commands, advisory locks, and prepared statements that span transactions.

**Performance Insights:** Aurora and RDS surfaces top SQL by average active sessions (AAS) and wait states. Key wait states:

| Wait State | Meaning | Fix |
|---|---|---|
| `io/file/sql/binlog` | Writing binlog | Disable binlog (Aurora has none) or tune sync |
| `lock/table/sql_lock` | Table lock contention | Use row-level locking, shorter transactions |
| `wait/io/aurora_redo_log_flush` | Redo log write | Use io2 or Aurora I/O-Optimized |
| `CPU` | CPU bound | Add index, optimize query, scale instance |

**pg_stat_statements (PostgreSQL):**

```sql
-- Enable in parameter group: shared_preload_libraries = pg_stat_statements
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- Find slowest queries by total time
SELECT
  query,
  calls,
  round(total_exec_time::numeric, 2) AS total_ms,
  round(mean_exec_time::numeric, 2)  AS mean_ms,
  round(rows::numeric / calls, 1)    AS avg_rows
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 20;
```

**Index strategies for PostgreSQL:**

```sql
-- Partial index: only index rows that matter
CREATE INDEX idx_orders_pending
ON orders (created_at)
WHERE status = 'pending';

-- Covering index: include extra columns to avoid heap fetch
CREATE INDEX idx_users_email_covering
ON users (email)
INCLUDE (name, tier);

-- Expression index: index on derived value
CREATE INDEX idx_users_lower_email
ON users (LOWER(email));

-- Analyze a specific query
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT * FROM orders
WHERE user_id = 'abc' AND status = 'pending'
ORDER BY created_at DESC LIMIT 10;
```

**Aurora reader endpoint routing:** The reader endpoint load-balances across all reader instances. For analytics vs OLTP routing:

```typescript
// Application-level routing
const writePool = new Pool({ host: process.env.AURORA_WRITER_ENDPOINT });
const readPool  = new Pool({ host: process.env.AURORA_READER_ENDPOINT });

async function getUser(id: string) {
  return readPool.query('SELECT * FROM users WHERE id = $1', [id]);
}

async function createOrder(data: Order) {
  return writePool.query('INSERT INTO orders ...', [...]);
}
```

### ElastiCache Tuning

**Eviction policies:**

| Policy | Behavior | Use when |
|---|---|---|
| `noeviction` | Return error when memory full | Session store — never lose data |
| `allkeys-lru` | Evict least-recently-used from all keys | General cache |
| `volatile-lru` | Evict LRU from keys with TTL set | Mixed cache + session store |
| `allkeys-lfu` | Evict least-frequently-used | Frequency-based caching (Redis 4+) |
| `volatile-ttl` | Evict shortest-TTL keys first | When you want predictable expiry |

**Memory fragmentation:** When Redis reallocates memory frequently, fragmentation ratio rises.

```
# Check via redis-cli INFO memory
mem_fragmentation_ratio: 1.8  # > 1.5 = significant fragmentation
```

Fix: `MEMORY PURGE` (Redis 4+) or schedule a rolling node restart. Fragmentation above 1.5 wastes significant RAM.

**Pipelining commands to reduce round trips:**

```typescript
// Instead of 5 separate await redis.get() calls:
const pipeline = redis.pipeline();
pipeline.get('user:1');
pipeline.get('user:2');
pipeline.get('user:3');
pipeline.get('user:4');
pipeline.get('user:5');
const results = await pipeline.exec();
// 1 round trip instead of 5
```

**Cluster mode sizing:** Switch to cluster mode when:
- Dataset exceeds single node memory (e.g., r7g.2xlarge = 64 GB)
- Sustained throughput > 100K ops/sec on a single shard

---

## 8. Backup, DR, and Compliance

### Backup Strategy

| Method | Scope | Retention | Cross-Region | Cost |
|---|---|---|---|---|
| RDS automated backup | RDS/Aurora | 1–35 days | Manual copy | Included up to DB size |
| Manual snapshot | RDS/Aurora | Until deleted | Copy supported | $0.095/GB-month |
| Aurora Backtrack | Aurora MySQL | Up to 72 hr | No | $0.012/million change records |
| AWS Backup | RDS, Aurora, DynamoDB, EFS | Policy-based | Yes | Backup storage + copy |

**Cross-region snapshot automation (EventBridge + Lambda):**

```typescript
// EventBridge rule: cron(0 2 * * ? *) — daily at 2am UTC
export const handler = async () => {
  const rds = new RDSClient({ region: 'us-east-1' });

  // Copy latest automated snapshot to DR region
  const snapshots = await rds.send(new DescribeDBSnapshotsCommand({
    DBInstanceIdentifier: 'prod-postgres',
    SnapshotType: 'automated',
  }));

  const latest = snapshots.DBSnapshots
    ?.sort((a, b) =>
      (b.SnapshotCreateTime?.getTime() ?? 0) - (a.SnapshotCreateTime?.getTime() ?? 0)
    )[0];

  if (!latest?.DBSnapshotArn) return;

  await new RDSClient({ region: 'eu-west-1' }).send(
    new CopyDBSnapshotCommand({
      SourceDBSnapshotIdentifier: latest.DBSnapshotArn,
      TargetDBSnapshotIdentifier: `dr-${latest.DBSnapshotIdentifier}`,
      SourceRegion: 'us-east-1',
      KmsKeyId: process.env.DR_KMS_KEY_ARN,
      CopyTags: true,
    }),
  );
};
```

### Encryption

**At-rest:** KMS-managed keys. Encryption is set at creation time and **cannot be changed** on a live instance. To re-encrypt with a different key:
1. Take a manual snapshot of the unencrypted (or differently encrypted) instance
2. Copy snapshot and specify the new KMS key during copy
3. Restore from the encrypted snapshot into a new DB instance
4. Update application connection strings; delete old instance

**In-transit:** Enable `require_ssl` in parameter group for PostgreSQL. RDS certificates are managed by AWS and auto-rotate.

**IAM DB Auth (passwordless):**

```sql
-- PostgreSQL: create the IAM-authenticated user
CREATE USER lambda_user;
GRANT rds_iam TO lambda_user;
GRANT SELECT, INSERT, UPDATE ON TABLE orders TO lambda_user;
```

```typescript
// Lambda: generate token and connect
const signer = new Signer({ region, hostname, port: 5432, username: 'lambda_user' });
const token = await signer.getAuthToken(); // 15-min expiry, signed with IAM credentials
```

IAM tokens expire every 15 minutes. Generate a fresh token for each new connection. With RDS Proxy, the proxy handles token validation and manages long-lived backend connections.

### AWS Backup

AWS Backup provides a **unified, policy-based backup service** across RDS, Aurora, DynamoDB, EFS, EBS, and FSx. Key features:
- **Backup plans:** Define schedules, retention, and lifecycle rules in one place
- **Cross-account backup:** Copy backups to a separate AWS account for blast radius isolation
- **Compliance reports:** Built-in reports for backup coverage, job status, and compliance posture
- **Vault lock:** WORM (write-once, read-many) policy for backups — prevents deletion for audit compliance

See [IAM & Security](/aws-iam-security) for KMS key management and [Observability](/aws-observability) for backup monitoring with CloudWatch.

### Audit Logging

| Engine | Audit Method | Destination |
|---|---|---|
| PostgreSQL | `pgaudit` extension + `log_statement` | CloudWatch Logs |
| MySQL | General log + Audit Log plugin | CloudWatch Logs |
| Oracle | Native Audit (option group) | CloudWatch Logs |
| SQL Server | SQL Server Audit (option group) | CloudWatch Logs |

Enable `log_connections`, `log_disconnections`, and `log_statement = 'ddl'` at minimum for compliance workloads.

---

## Interview Q&A

**Q: When would you choose Aurora over standard RDS? What are the trade-offs?**

A: Aurora when you need faster failover (< 30s vs 60–120s), more read replicas (15 vs 5), higher throughput (3–5× on same hardware), or point-in-time recovery without restore (Backtrack on MySQL). Trade-offs: Aurora costs more per instance (roughly 20% premium), slightly higher latency for single-row reads due to shared storage layer network calls, and you lose some engine-specific features (e.g., Aurora PostgreSQL lags behind community PostgreSQL by 1–2 minor versions). For a standard 2-AZ OLTP app with < 5K TPS and no read scaling needs, standard RDS is simpler and cheaper.

---

**Q: Explain Aurora's storage architecture. How is it different from RDS Multi-AZ?**

A: RDS Multi-AZ uses two separate EBS volumes — the primary and standby each have their own block storage, synchronized at the block level. Aurora uses a single shared distributed storage layer: 6 copies across 3 AZs, requiring only 4/6 writes to acknowledge a write (tolerates 2 simultaneous AZ failures). All Aurora instances (writer + all readers) read from the same storage pages. No data copy needed when adding readers; failover is fast because the promoted reader already has the storage state.

---

**Q: How does Aurora Serverless v2 scale? What are its limitations?**

A: Serverless v2 scales in 0.5 ACU increments (each ACU is ~2 GB RAM + proportional CPU). Scaling happens in < 1 second — it monitors CPU and memory pressure and adjusts capacity near-continuously. Minimum is 0.5 ACU (never scales to zero; you always pay at least ~$0.06/hr at minimum capacity). Maximum is 256 ACU. Limitations: doesn't scale to zero (unlike v1), no support for Aurora parallel query, and Backtrack is not available on Serverless v2 clusters.

---

**Q: A Lambda function is timing out connecting to RDS. Walk me through your diagnosis.**

A: First, check if Lambda is in the same VPC and subnet as RDS — Lambda must be in the same VPC and the security group on RDS must allow inbound on port 5432/3306 from Lambda's security group. Second, check `max_connections` — if the DB is at limit, new connections queue or fail. Third, check if RDS Proxy is configured — if not, 1,000 concurrent Lambdas will try to open 1,000+ connections. Fourth, confirm the Lambda execution role has `rds-db:connect` permission if using IAM auth. Fifth, check CloudWatch Logs for RDS connection errors and Enhanced Monitoring for CPU/memory spike on the DB. Fix: add RDS Proxy between Lambda and RDS, add the `rds:connect` IAM permission, and verify security group rules. See [Lambda](/aws-lambda-serverless) for Lambda VPC networking details.

---

**Q: When would you use ElastiCache Redis vs DynamoDB for a session store?**

A: ElastiCache Redis is the natural fit for session storage. Sessions are small JSON blobs accessed by session ID — exactly the Redis `SET key value EX ttl` pattern. Redis gives sub-millisecond reads, TTL-based expiry, and `SCAN` for session enumeration. DynamoDB can work but you're paying RCU/WCU for what amounts to simple key-value lookups, and TTL-based expiry in DynamoDB (via `ttl` attribute) takes up to 48 hours to actually delete expired items. Redis is cheaper and faster for this pattern. Use DynamoDB sessions only if you're already on DynamoDB and want to avoid adding another service.

---

**Q: How do you handle read replicas with a cache layer — what's the cache invalidation strategy?**

A: Cache invalidation with replicas requires awareness of replica lag. On write: invalidate the cache key immediately after writing to the primary. On the next read, route to the cache — if a cache miss occurs, read from the primary (not the replica) to avoid serving stale data from a lagged replica. For reads that tolerate eventual consistency, read from replica → populate cache. The safest pattern: invalidate on write, repopulate from primary on first miss, then serve from cache for all subsequent reads within the TTL window. Monitor replica lag via `ReplicaLag` CloudWatch metric and adjust TTL accordingly.

---

**Q: What's the difference between RDS Multi-AZ and a Read Replica? Can you promote a Multi-AZ standby?**

A: Multi-AZ standby: synchronous replication, same AZ, not readable, purely for HA failover. You cannot promote it to a standalone instance — it exists only as the failover target. Read Replica: asynchronous replication, can be in any AZ or region, fully readable, and can be promoted to standalone (cutting replication permanently, making it an independent DB). The standby in Multi-AZ is opaque to you — you can't connect to it, query it, or promote it. If you need both HA and read scale-out, deploy Multi-AZ (for failover) plus Read Replicas (for read scale).

---

**Q: How would you design a database architecture for a multi-tenant SaaS with 500 tenants?**

A: With 500 tenants, the main options are: (1) **Shared DB, schema-per-tenant** — one Aurora PostgreSQL cluster, each tenant gets a PostgreSQL schema; application sets `search_path = tenant_123` at connection time. Simplest to operate, data isolation via schema, one migration per tenant at deploy. Downside: noisy neighbor risk, max ~1,000 schemas per DB before performance degrades. (2) **Shared DB, table-per-tenant** — similar but noisier. (3) **Dedicated cluster per tenant** — higher isolation, higher cost (500 Aurora clusters). For 500 tenants, schema-per-tenant on Aurora Serverless v2 is the sweet spot: low idle cost per schema, instant scale on tenant spikes, strong isolation, and operational simplicity. RDS Proxy handles connection pooling across schemas. For compliance-heavy tenants, offer a dedicated cluster option at premium pricing. See [AWS Architecture](/aws-architecture) for multi-tenancy patterns.

---

**Q: Explain Aurora Global Database — what's the RTO/RPO and how does failover work?**

A: Aurora Global Database replicates at the storage layer (not binlog/WAL) with < 1 second lag to secondary regions. RPO is typically < 1 second. RTO is < 1 minute for manual promotion. Failover is manual: detach the secondary cluster from global, promote it to standalone writer, update application DNS/connection strings to point to the new region. There's no automatic global failover built-in — you need Lambda + Route 53 health checks + EventBridge to automate it. Read traffic in secondary regions gets local latency. Secondaries are read-only — you cannot write to them while attached to the global cluster.

---

**Q: How do you secure RDS — encryption, network, auth, audit logging?**

A: Four layers: (1) **Network** — RDS in private subnets (no public IP), security group restricts port 5432/3306 to application security group only; VPC endpoints or NAT for outbound. See [VPC & Networking](/aws-vpc-networking). (2) **Authentication** — prefer IAM DB Auth (passwordless, tokens expire in 15 min) for Lambda/EC2; Secrets Manager for rotation of master password; principle of least privilege on DB users (separate user per service, no app connecting as root). See [IAM & Security](/aws-iam-security). (3) **Encryption** — KMS at-rest (set at creation); TLS in-transit via `require_ssl` in parameter group; cross-region snapshot copies encrypted with regional KMS key. (4) **Audit** — `pgaudit` for PostgreSQL (log DDL, DML, role changes); CloudWatch Logs for centralized log storage; set retention policy on log groups.

---

**Q: What is RDS Proxy and when is it essential?**

A: RDS Proxy is a fully managed connection pooler that sits between your application and RDS/Aurora. It maintains a pool of long-lived backend connections and multiplexes thousands of application connections onto them. Essential when: Lambda functions connect to RDS (Lambda at scale creates thousands of connections), application has frequent connection churn (connection/disconnect per request), you want passwordless IAM auth with Secrets Manager rotation, or you need sub-10-second failover redirection. Not needed when: you have a small number of long-lived application servers with their own connection pools (PgBouncer, application pool), or when using Aurora Data API. See [Lambda](/aws-lambda-serverless) for the Lambda connection pattern.

---

## Red Flags to Avoid

- Deploying RDS without Multi-AZ in production — a single-AZ instance going down means full outage until you manually restore
- Using Multi-AZ as a read scale-out solution — the standby is not readable; use Read Replicas for that
- Connecting Lambda directly to RDS without RDS Proxy — connection storm at scale will crash the DB
- Setting max storage autoscaling too high — it never shrinks; a bug causing table bloat will permanently expand your storage bill
- Using gp2 storage for new workloads — gp3 provides 3,000 baseline IOPS free and lets you provision IOPS independently; gp2 ties IOPS to volume size
- Storing the DB master password in environment variables — use Secrets Manager with automatic rotation
- Forgetting to set `require_ssl = 1` in the parameter group — connections may fall back to unencrypted without it
- Using Aurora Backtrack as your only DR strategy — it's single-region, in-place, and only works for Aurora MySQL
- Not enabling `pg_stat_statements` — you'll be flying blind on query performance until a production incident
- Treating Read Replica lag as negligible — under heavy write loads, replica lag can grow to seconds or minutes; reads from the replica will return stale data
- Using write-behind caching with ElastiCache without considering node failure — if the node fails before the async flush, data is silently lost
- Setting `noeviction` on a general cache — ElastiCache will return errors on writes instead of evicting old data; use `allkeys-lru` for caches
- Not encrypting RDS at creation time — you cannot enable encryption on a live unencrypted instance; you must snapshot + restore
- Creating RDS in a public subnet "temporarily" — public accessibility is a configuration item that's easy to forget to revert

---

*Related topics: [DynamoDB](/dynamodb-data-services) · [Lambda](/aws-lambda-serverless) · [IAM & Security](/aws-iam-security) · [VPC & Networking](/aws-vpc-networking) · [AWS Architecture](/aws-architecture) · [Cost Optimization](/aws-cost-optimization) · [Compute & Containers](/aws-compute-containers) · [Observability](/aws-observability)*
