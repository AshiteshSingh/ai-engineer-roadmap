# AWS DynamoDB & Data Services

## The 30-Second Pitch

DynamoDB is AWS's fully managed, [serverless](/aws/lambda-serverless) NoSQL database delivering single-digit millisecond latency at any scale. It solves the problem of database operations bottlenecks by decoupling storage from compute entirely—there are no instances to size, no cluster topology to manage, and no schema migrations to run. Teams choose DynamoDB when access patterns are known upfront, write throughput is unpredictable or bursty, and consistent sub-10ms latency is non-negotiable. This knowledge base also covers the broader AWS data services ecosystem: Aurora Serverless v2, RDS, ElastiCache, and [S3](/aws/storage-s3)-as-data-lake—all with the depth required to navigate senior engineering interviews.

---

## 1. DynamoDB Fundamentals

### Core Data Model

DynamoDB stores items (analogous to rows) in tables. Every item is a collection of attributes (key-value pairs) and can have a different shape—there is no enforced schema beyond the primary key.

**Primary Key Types:**

| Type | Partition Key | Sort Key | Use Case |
|---|---|---|---|
| Simple | Required | None | Single lookup by one attribute |
| Composite | Required | Required | Range queries within a partition |

- **Partition key (PK):** Hashed to determine which storage node holds the item. Must be unique for simple PKs.
- **Sort key (SK):** Optional second dimension. Items with the same PK are stored together, sorted by SK. Enables range queries (`begins_with`, `between`, `<`, `>`).

**Item size limit:** 400 KB per item (all attribute names + values). Binary, String, and Number types supported. Nested maps/lists up to 32 levels deep.

**Attribute types:** S (String), N (Number), B (Binary), BOOL, NULL, L (List), M (Map), SS (String Set), NS (Number Set), BS (Binary Set).

### Storage Internals

DynamoDB uses a log-structured storage engine (similar to Cassandra's SSTables). Data is partitioned across a fleet of storage nodes. Each partition holds at most **10 GB** of data and serves up to **3,000 RCUs + 1,000 WCUs**. When a partition exceeds these limits, DynamoDB automatically splits it—transparent to the caller. Three copies of every item are stored across three AZs; a write is acknowledged after two of three copies confirm durability.

```
Table: Orders
PK (partition key)     SK (sort key)       Attributes
-----------------      -------------       ----------
USER#alice             ORDER#2024-001       total=150, status=shipped
USER#alice             ORDER#2024-002       total=89, status=pending
USER#bob               ORDER#2024-003       total=220, status=delivered
USER#alice             PROFILE             email=alice@x.com, tier=gold
```

This is the foundation of **single-table design**: multiple entity types live in one table, distinguished by SK prefix.

---

## 2. Data Modeling: Access Patterns First

### The Golden Rule

Design your DynamoDB table **backward from your queries**, not forward from your entities. Every query must resolve to either a direct `GetItem` (PK + SK exact match) or a `Query` (PK exact match + SK range). Anything requiring a full-table scan is a schema design failure.

### Step-by-Step Design Process

1. **List every access pattern** before writing any schema (e.g., "get user by ID", "list all orders for a user sorted by date", "find all orders with status=pending").
2. **Identify entity types** and their relationships.
3. **Choose PK/SK values** so each access pattern maps to a Query or GetItem.
4. **Add GSIs** only for access patterns that can't be satisfied by the base table.
5. **Overload GSI attributes** when multiple entity types share the same secondary index.

### Single-Table Design

All related entities in one table. The PK and SK are generic (often named `pk` and `sk`) and contain prefixed values like `USER#123` or `ORDER#456`. This collapses multiple round-trips for relational joins into a single Query.

```
Table: AppData
pk                 sk                   gsi1pk           gsi1sk         data
----------------   ------------------   --------------   ------------   ----
USER#alice         METADATA             EMAIL#alice@x    USER#alice     {name, tier}
USER#alice         ORDER#2024-001       STATUS#shipped   2024-10-01     {total:150}
USER#alice         ORDER#2024-002       STATUS#pending   2024-10-05     {total:89}
PRODUCT#iphone15   METADATA             CATEGORY#phone   PRODUCT#ip15   {price:999}
```

Access patterns satisfied:
- Get user profile: `GetItem(pk=USER#alice, sk=METADATA)`
- List user orders sorted by date: `Query(pk=USER#alice, sk begins_with ORDER#)`
- Find all shipped orders: `Query on GSI1(gsi1pk=STATUS#shipped, gsi1sk between dates)`
- Get product: `GetItem(pk=PRODUCT#iphone15, sk=METADATA)`

### GSI vs LSI

**Local Secondary Index (LSI):**
- Same partition key as the base table, different sort key.
- Must be defined at table creation time (cannot add later).
- Shares read/write capacity with the base table.
- Strongly consistent reads possible.
- Up to **5 LSIs** per table.
- Maximum 10 GB per partition key value (same as base table partition limit).

**Global Secondary Index (GSI):**
- Different partition key and/or sort key from the base table.
- Can be added or removed after table creation.
- Has its own provisioned capacity (independent of base table).
- Eventually consistent reads only.
- Up to **20 GSIs** per table.
- Ideal for inverting access patterns.

```
# LSI example: order items queried by price within a user's orders
Table PK:  userId        Table SK: orderId
LSI SK:    totalAmount   (same PK = userId, but sorted by amount instead of orderId)

Query: "Find alice's orders over $100"
Query(pk=alice, lsi_sk > 100) -- uses LSI, no scan needed
```

### GSI Patterns

**Inverted Index:** Swap PK and SK to query relationships in reverse. If base table is `PK=userId, SK=orderId`, a GSI with `PK=orderId, SK=userId` lets you find the user for any order ID.

**Sparse Index:** GSIs only index items that have the indexed attribute. Items without the attribute are silently excluded. Use this to create a cheap "active jobs" index where only items with a `status` attribute appear.

```
# Only items with 'processingStatus' attribute are in this GSI
# When job completes, delete 'processingStatus' -- it disappears from GSI automatically
# Query GSI to get only currently-active jobs, no filter expression needed
```

**GSI Overloading:** Reuse the same GSI PK/SK attribute names for multiple entity types with different semantics. A GSI attribute named `gsi1pk` might contain `USER#alice` for user lookups and `STATUS#shipped` for order status lookups—both served by one GSI.

---

## 3. Capacity Modes

### On-Demand Mode

DynamoDB automatically scales to handle any request rate, charging per request unit consumed.

- **Pricing:** ~$1.25 per million WRUs, ~$0.25 per million RRUs (us-east-1).
- **Scaling:** Instantaneous—no capacity planning, no throttling on sudden spikes (up to previous peak × 2 per 30 minutes, then uncapped).
- **Use when:** Traffic is unpredictable, new tables, dev/test workloads, or you prioritize simplicity over [Cost Optimization](/aws-cost-optimization).

### Provisioned Mode

You pre-specify **Read Capacity Units (RCUs)** and **Write Capacity Units (WCUs)**.

- **1 RCU** = one strongly consistent read per second, or two eventually consistent reads per second, for items up to 4 KB.
- **1 WCU** = one write per second for items up to 1 KB.
- **Transactional operations** consume 2× capacity units.
- **Pricing:** ~$0.00065 per RCU-hour, ~$0.00130 per WCU-hour—substantially cheaper than on-demand at steady load.
- **Throttling:** Requests exceeding provisioned capacity return `ProvisionedThroughputExceededException`.

**Auto Scaling:** DynamoDB tracks consumed capacity as a percentage of provisioned, and adjusts provisioned capacity using Application Auto Scaling policies. Typical target: 70% utilization. Scale-up is fast (<1 minute); scale-down is limited to 4 times per day per table/index.

**Reserved Capacity:** 1-year or 3-year commitments for RCUs/WCUs at up to 77% discount over provisioned on-demand pricing. Applies per Region.

### Capacity Math Example

```
Item size: 2.5 KB
Write: ceil(2.5 / 1) = 3 WCUs per item
Read (strongly consistent): ceil(2.5 / 4) = 1 RCU per item
Read (eventually consistent): ceil(2.5 / 4) / 2 = 0.5 RCU per item
Transactional write: 3 × 2 = 6 WCUs per item
```

---

## 4. Read & Write Operations

### Single-Item Operations

| Operation | Description | Capacity |
|---|---|---|
| `GetItem` | Exact PK+SK lookup | 1 RCU (SC), 0.5 RCU (EC) |
| `PutItem` | Create or fully replace item | 1 WCU per KB |
| `UpdateItem` | Modify specific attributes | 1 WCU per KB (whole item) |
| `DeleteItem` | Remove item by PK+SK | 1 WCU per KB |

```javascript
// GetItem — strongly consistent
const { Item } = await ddb.send(new GetItemCommand({
  TableName: 'AppData',
  Key: { pk: { S: 'USER#alice' }, sk: { S: 'METADATA' } },
  ConsistentRead: true,
}));

// UpdateItem — atomic attribute modification
await ddb.send(new UpdateItemCommand({
  TableName: 'AppData',
  Key: { pk: { S: 'USER#alice' }, sk: { S: 'ORDER#001' } },
  UpdateExpression: 'SET #s = :newStatus, updatedAt = :ts',
  ExpressionAttributeNames: { '#s': 'status' },
  ExpressionAttributeValues: {
    ':newStatus': { S: 'shipped' },
    ':ts': { S: new Date().toISOString() },
  },
}));
```

### Batch Operations

**BatchGetItem:** Up to 100 items / 16 MB per request, across multiple tables. Returns `UnprocessedKeys` for items that weren't returned (retry required). Does not guarantee read order. Each item consumes normal RCU cost.

**BatchWriteItem:** Up to 25 put/delete operations / 16 MB per request. Does **not** support UpdateItem. Returns `UnprocessedItems`. Not atomic—some items may succeed and others fail.

```javascript
const { Responses, UnprocessedKeys } = await ddb.send(new BatchGetItemCommand({
  RequestItems: {
    AppData: {
      Keys: [
        { pk: { S: 'USER#alice' }, sk: { S: 'METADATA' } },
        { pk: { S: 'USER#bob' },   sk: { S: 'METADATA' } },
      ],
    },
  },
}));
// Always handle UnprocessedKeys with exponential backoff retry
```

### Transactional Operations

**TransactGetItems:** Up to 100 items / 4 MB. Atomic read—either all items are returned from the same point in time or the transaction fails. Costs 2× RCUs.

**TransactWriteItems:** Up to 100 items / 4 MB. Atomic, all-or-nothing—either all writes succeed or all fail with `TransactionCanceledException`. Can mix Put, Update, Delete, and ConditionCheck in one transaction. Costs 2× WCUs. Subject to a 10 MB/second throughput limit per partition key.

```javascript
await ddb.send(new TransactWriteItemsCommand({
  TransactItems: [
    {
      Update: {
        TableName: 'AppData',
        Key: { pk: { S: 'ACCOUNT#alice' }, sk: { S: 'BALANCE' } },
        UpdateExpression: 'SET balance = balance - :amt',
        ConditionExpression: 'balance >= :amt',
        ExpressionAttributeValues: { ':amt': { N: '50' } },
      },
    },
    {
      Update: {
        TableName: 'AppData',
        Key: { pk: { S: 'ACCOUNT#bob' }, sk: { S: 'BALANCE' } },
        UpdateExpression: 'SET balance = balance + :amt',
        ExpressionAttributeValues: { ':amt': { N: '50' } },
      },
    },
  ],
}));
```

### Query vs Scan

**Query:** Retrieves all items with a given PK (+ optional SK condition). Efficient—reads only the target partition. Returns items sorted by SK. Supports `FilterExpression` (applied after read, does not reduce RCU cost). Paginated via `LastEvaluatedKey`.

**Scan:** Reads every item in the entire table or index. Always O(n) in table size. Avoid in production for large tables. Use `Limit` + pagination for progressive scans. `Parallel Scan` divides the table into segments (up to 1 million) for faster full-table exports.

```javascript
// Query: efficient
const { Items, LastEvaluatedKey } = await ddb.send(new QueryCommand({
  TableName: 'AppData',
  KeyConditionExpression: 'pk = :user AND sk BETWEEN :start AND :end',
  ExpressionAttributeValues: {
    ':user': { S: 'USER#alice' },
    ':start': { S: 'ORDER#2024-01' },
    ':end': { S: 'ORDER#2024-12' },
  },
  ScanIndexForward: false, // descending sort
  Limit: 20,
}));

// Paginate
let exclusiveStartKey = LastEvaluatedKey;
while (exclusiveStartKey) {
  const page = await ddb.send(new QueryCommand({ ..., ExclusiveStartKey: exclusiveStartKey }));
  exclusiveStartKey = page.LastEvaluatedKey;
}
```

---

## 5. Advanced Features

### DynamoDB Streams

Ordered, 24-hour log of item-level changes. Each stream record contains the item's old image, new image, or both (configurable via `StreamViewType`). Consumed by [Lambda](/aws/lambda-serverless) (event source mapping) or Kinesis Data Streams integration for fan-out.

**Use cases:** Cross-region replication, derived aggregations, search index synchronization (OpenSearch), event sourcing, audit logs.

```
StreamViewType options:
  KEYS_ONLY     -- PK/SK of changed item only
  NEW_IMAGE     -- The item after the change
  OLD_IMAGE     -- The item before the change
  NEW_AND_OLD_IMAGES -- Both (most flexible, highest cost)
```

[Lambda](/aws/lambda-serverless) processes shards in order, guaranteeing at-least-once delivery. To avoid reprocessing, make downstream consumers idempotent.

### TTL (Time To Live)

Specify an attribute (must be a Number type, Unix epoch seconds) as the TTL attribute. DynamoDB automatically deletes items within 48 hours after expiry—no WCU consumed for deletion. Expired-but-not-yet-deleted items can still be returned by reads; filter them in application code if precision is required.

```javascript
// Set TTL to 7 days from now
await ddb.send(new PutItemCommand({
  TableName: 'Sessions',
  Item: {
    sessionId: { S: 'abc123' },
    userId:    { S: 'alice' },
    expiresAt: { N: String(Math.floor(Date.now() / 1000) + 7 * 86400) },
  },
}));
```

TTL deletions appear in DynamoDB Streams (marked with a user identity of `dynamodb.amazonaws.com`) so downstream systems can react to expirations.

### Conditional Writes

All write operations accept a `ConditionExpression`. If the condition fails, the operation throws `ConditionalCheckFailedException` and no write occurs. This is the mechanism for **optimistic locking**.

```javascript
// Only update if version matches (optimistic locking)
await ddb.send(new UpdateItemCommand({
  TableName: 'AppData',
  Key: { pk: { S: 'PRODUCT#iphone15' }, sk: { S: 'METADATA' } },
  UpdateExpression: 'SET price = :p, version = version + :inc',
  ConditionExpression: 'version = :expectedVersion',
  ExpressionAttributeValues: {
    ':p': { N: '899' },
    ':inc': { N: '1' },
    ':expectedVersion': { N: '3' },
  },
}));

// Prevent overwrite of existing item
await ddb.send(new PutItemCommand({
  TableName: 'AppData',
  Item: { pk: { S: 'USER#alice' }, sk: { S: 'METADATA' }, ... },
  ConditionExpression: 'attribute_not_exists(pk)',
}));
```

---

## 6. Best Practices: Hot Partitions, Scans & Write Sharding

### Hot Partitions

The single biggest DynamoDB production issue. A hot partition occurs when a disproportionate share of reads or writes concentrate on one partition key value, exceeding the per-partition limit (3,000 RCU + 1,000 WCU).

**Symptoms:** `ProvisionedThroughputExceededException` on specific keys even when aggregate capacity is available; [Observability](/aws-observability) (CloudWatch) `ConsumedWriteCapacityUnits` shows skewed distribution.

**Causes:** Sequential or auto-increment PKs (all writes go to one partition), a celebrity user in a social network, a trending product page.

**Solutions:**

1. **Write sharding:** Append a random suffix (0–N) to the PK. Distribute writes across N logical partitions. For reads, scatter-gather across all N shards.

```javascript
// Write sharding: distribute hot writes
const SHARD_COUNT = 10;
const shard = Math.floor(Math.random() * SHARD_COUNT);
const pk = `LEADERBOARD#global#${shard}`;

// Read: query all shards, merge client-side
const promises = Array.from({ length: SHARD_COUNT }, (_, i) =>
  ddb.send(new QueryCommand({ ..., Key: { pk: { S: `LEADERBOARD#global#${i}` } } }))
);
const results = (await Promise.all(promises)).flatMap(r => r.Items);
results.sort((a, b) => Number(b.score.N) - Number(a.score.N));
```

2. **Calculated shard suffix:** `shard = hash(userId) % N` for consistent routing (no scatter-gather needed for single-user reads).

3. **Caching layer (DAX or ElastiCache):** Absorb read hotspots upstream.

### Avoiding Scans

- Never use `Scan` in a hot code path. Every scan burns capacity proportional to table size.
- If you find yourself writing a Scan, it's a signal to add a GSI.
- For analytics over large tables, export via `Scan` with parallelism or use DynamoDB Streams + Kinesis + S3 + Athena instead.

### Pagination Best Practices

- Always handle `LastEvaluatedKey`—DynamoDB pages at 1 MB by default.
- Use `Limit` to control page size (limits items before filter expressions; `Count` in response reflects post-filter count).
- For UI pagination, encode `LastEvaluatedKey` as a cursor token (base64-encode the JSON).

---

## 7. PartiQL

PartiQL is an SQL-compatible query language for DynamoDB. It lets you write familiar SQL syntax but executes against DynamoDB's underlying key-based access patterns.

**Important:** PartiQL does not make DynamoDB relational. `SELECT * FROM table WHERE non_key_attr = 'x'` without a WHERE on the PK will perform a full Scan. PartiQL maps SQL operations to the underlying DynamoDB APIs.

```sql
-- Equivalent to GetItem
SELECT * FROM AppData WHERE pk = 'USER#alice' AND sk = 'METADATA'

-- Equivalent to Query
SELECT * FROM AppData WHERE pk = 'USER#alice' AND begins_with(sk, 'ORDER#')

-- Insert (PutItem)
INSERT INTO AppData VALUE {'pk': 'USER#charlie', 'sk': 'METADATA', 'email': 'charlie@x.com'}

-- Update (UpdateItem)
UPDATE AppData SET status = 'archived' WHERE pk = 'USER#alice' AND sk = 'ORDER#001'

-- Delete
DELETE FROM AppData WHERE pk = 'USER#alice' AND sk = 'ORDER#001'
```

**Batch PartiQL:** `ExecuteStatement` for single statements, `BatchExecuteStatement` for up to 25 statements (not atomic), `ExecuteTransaction` for up to 25 statements with ACID guarantees.

**When to use:** Useful for data migrations, ad-hoc queries via console, and teams more comfortable with SQL syntax. For application code, the native SDK API provides more explicit control over capacity and consistency settings.

---

## 8. DynamoDB Accelerator (DAX)

DAX is a fully managed, in-memory cache for DynamoDB, purpose-built for DynamoDB's API. It sits in front of DynamoDB in your VPC and is API-compatible with the DynamoDB SDK (minimal code change required).

### How DAX Works

DAX operates two caches:
1. **Item cache:** Stores GetItem and BatchGetItem results, keyed by PK+SK. Default TTL: 5 minutes.
2. **Query cache:** Stores Query and Scan results, keyed by the full request parameters. Default TTL: 5 minutes.

Write operations (PutItem, UpdateItem, DeleteItem) are **write-through**: DAX writes to DynamoDB first, then updates its item cache.

```
[Application]
     |
[DAX Cluster (VPC)] <-- cache hit: sub-millisecond latency
     |                    cache miss: reads from DynamoDB
[DynamoDB]
```

### DAX vs ElastiCache for DynamoDB

| | DAX | ElastiCache |
|---|---|---|
| API compatibility | Drop-in DynamoDB replacement | Requires separate cache logic |
| Data model | Key-value (mirrors DynamoDB items) | Flexible (Redis structures) |
| Latency | Microseconds | Sub-millisecond |
| Strong consistency | Not supported (always eventual) | Not applicable |
| Invalidation | TTL-based | Manual or TTL |

**Use DAX when:** Read-heavy workloads with repetitive reads of the same items (product catalogs, leaderboards, reference data). The application issues the same Query or GetItem repeatedly and can tolerate eventual consistency.

**Avoid DAX when:** Writes are the bottleneck (DAX doesn't accelerate writes), strongly consistent reads are required, or items change so frequently that cached data is always stale.

### DAX Cluster Sizing

- Minimum: 3 nodes (1 primary + 2 replicas) for HA across AZs.
- Node types: `dax.r4.large` to `dax.r4.16xlarge`.
- Read capacity scales horizontally (add read replicas). Write capacity does not (primary is the bottleneck).

---

## 9. Aurora Serverless v2

Aurora Serverless v2 is AWS's auto-scaling MySQL- and PostgreSQL-compatible relational database. Unlike Aurora Serverless v1 (which scaled to zero and had cold starts), v2 scales in fine-grained increments (0.5 ACU steps) within seconds and does not scale to zero (minimum 0.5 ACU).

### How It Scales

Capacity is measured in **Aurora Capacity Units (ACUs)**, where 1 ACU = ~2 GB RAM + proportional CPU + network. You set a minimum and maximum ACU range. Aurora monitors CPU utilization, memory pressure, and connection count, scaling up in seconds and down more gradually.

```
Minimum: 0.5 ACU  →  ~1 GB RAM (dev/test, cold baseline)
Maximum: 128 ACUs →  ~256 GB RAM (peak production)

Scale-up trigger: CPU > 70% or memory pressure
Scale-down: gradual, based on sustained low utilization
```

### Aurora Serverless v2 vs DynamoDB

| Dimension | Aurora Serverless v2 | DynamoDB |
|---|---|---|
| Data model | Relational (SQL, joins, transactions) | Key-value / document (NoSQL) |
| Schema | Enforced, migrations required | Flexible, per-item |
| Query patterns | Arbitrary SQL, ad-hoc | Access patterns defined at design time |
| Latency | Low milliseconds | Single-digit milliseconds |
| Max table size | Petabytes (Aurora storage auto-grows) | Unlimited |
| Consistency | Strong (ACID) by default | Eventual (configurable per-read) |
| Horizontal write scale | Not native (single primary) | Native (partition-based) |
| Best for | Complex queries, reporting, OLTP | High-scale microservices, gaming, IoT |

**Choose Aurora Serverless v2 when:** You need SQL flexibility, complex aggregations, multi-table joins, stored procedures, or you're migrating a relational application without restructuring its data model.

**Choose DynamoDB when:** You need guaranteed single-digit millisecond latency at millions of requests per second, truly [serverless](/aws/lambda-serverless) scaling with zero capacity planning, or your access patterns are well-defined and key-based.

---

## 10. RDS: Managed Relational Databases

### Core Concepts

RDS manages the undifferentiated heavy lifting of relational databases: provisioning, patching, backups, and Multi-AZ failover. Supported engines: MySQL, PostgreSQL, MariaDB, Oracle, SQL Server. Aurora is a separate, AWS-native engine.

**Instance types:** `db.t4g.*` (burstable, dev/test), `db.m7g.*` (general purpose), `db.r7g.*` (memory optimized for large working sets). Size determines RAM, CPU, and network bandwidth.

### Multi-AZ Deployments

A standby replica in a different AZ receives synchronous writes from the primary. On failure, DNS failover redirects to the standby in 60–120 seconds. The standby cannot serve reads.

```
Primary (AZ-a) --synchronous replication--> Standby (AZ-b)
     |
  DNS: mydb.xxx.us-east-1.rds.amazonaws.com
     |
  On failure: DNS TTL (typically 60s) flips to standby
```

**Multi-AZ Cluster (new):** Two readable standby instances in separate AZs; failover in under 35 seconds; standby instances can serve reads using a separate reader endpoint.

### Read Replicas

Asynchronous replication from the primary to up to 15 read replicas (MySQL/PostgreSQL). Each replica has its own DNS endpoint. Applications must explicitly route reads to replica endpoints.

**Use for:** Read-scaling, reporting, analytics offload, cross-region disaster recovery (cross-region read replicas). Read replicas can be promoted to standalone primaries during disaster recovery.

**Replication lag:** Can be seconds to minutes under heavy write load. Not suitable for reads that require up-to-the-second consistency.

### Parameter Groups

Configuration files for the database engine (e.g., `max_connections`, `innodb_buffer_pool_size`, `shared_buffers` for PostgreSQL). Changes to static parameters require a reboot. Dynamic parameters take effect immediately.

```
Key PostgreSQL parameters to know:
  shared_buffers         = 25-40% of instance RAM
  max_connections        = limited by instance RAM (~75-100 per GB)
  work_mem               = per-sort/hash memory (lower if many connections)
  wal_level              = logical (required for logical replication)
  log_min_duration_statement = 1000 (log queries over 1 second)
```

### RDS Proxy

A managed connection pooler that sits between your application and RDS. It multiplexes thousands of application connections into a smaller pool of long-lived database connections.

**Why it matters for [serverless](/aws/lambda-serverless):** [Lambda](/aws/lambda-serverless) functions create a new database connection per invocation. Without RDS Proxy, a Lambda spike from 10 to 1,000 concurrent executions creates 1,000 simultaneous `pg_connect()` calls, exhausting `max_connections` and causing `too many connections` errors.

```
[1,000 Lambda Invocations]
         |
   [RDS Proxy] -- maintains pool of 10-50 DB connections
         |
   [RDS PostgreSQL] -- sees only proxy connections, not Lambda surge
```

**Additional benefits:** Automatic failover reconnection (hides the 60-120s DNS TTL on Multi-AZ failover), [IAM](/aws/iam-security) authentication support, Secrets Manager integration for credentials.

---

## 11. ElastiCache: In-Memory Data Stores

### Redis vs Memcached

| Feature | Redis | Memcached |
|---|---|---|
| Data structures | Strings, Hashes, Lists, Sets, Sorted Sets, Streams, HyperLogLog, Geospatial | Strings only |
| Persistence | RDB snapshots + AOF logs | None |
| Replication | Primary-replica, cluster mode | None |
| Multi-AZ failover | Automatic (with replica) | None |
| Pub/Sub | Yes | No |
| Lua scripting | Yes | No |
| Multi-threading | Single-threaded (I/O threaded in 6.x) | Multi-threaded |
| Horizontal write scale | Redis Cluster (hash slots) | Native multi-node |
| Use for | Sessions, leaderboards, rate limiting, queues, feature flags, geospatial | Simple object caching, pure horizontal read scale |

**ElastiCache Serverless (2023):** Auto-scaling Redis or Memcached by data volume and request rate, no cluster sizing required.

### Caching Strategies

**Lazy Loading (Cache-Aside):**
Read from cache first. On miss, read from DB, write to cache, return result. Cache only stores data that has been requested.

```javascript
async function getUser(userId) {
  const cacheKey = `user:${userId}`;
  const cached = await redis.get(cacheKey);
  if (cached) return JSON.parse(cached);

  const user = await db.query('SELECT * FROM users WHERE id = $1', [userId]);
  await redis.setex(cacheKey, 3600, JSON.stringify(user)); // TTL: 1 hour
  return user;
}
```

**Pros:** Cache only populated on demand (no waste for cold data). Cache failure doesn't break reads (falls back to DB).
**Cons:** Cache miss penalty (3 round-trips). Risk of stale data (cache not updated on DB writes by default—requires TTL or explicit invalidation).

**Write-Through:**
Write to cache and DB simultaneously on every write. Cache is always current.

```javascript
async function updateUser(userId, data) {
  await db.query('UPDATE users SET ... WHERE id = $1', [userId, ...data]);
  await redis.setex(`user:${userId}`, 3600, JSON.stringify({ ...data }));
}
```

**Pros:** Cache always has fresh data; no stale reads.
**Cons:** Write penalty (extra cache write on every DB write). Cache filled with data that may never be read (cache churn on rarely accessed data).

**Write-Behind (Write-Back):**
Write to cache immediately; asynchronously flush to DB later. Reduces write latency.

**Cons:** Risk of data loss if cache crashes before DB write. More complex to implement correctly. Not natively supported by ElastiCache—requires application-level queue.

**TTL Strategy:**
Choose TTL based on data volatility:
- User sessions: 15-30 minutes (sliding expiry with `EXPIRE` reset on access)
- Product catalog: 1-24 hours
- Rate limit counters: window duration (e.g., 60 seconds)
- Leaderboards: short TTL or real-time updates via Streams

**Cache Eviction Policies (Redis):**
- `allkeys-lru` — evict least recently used across all keys (recommended for general cache)
- `volatile-lru` — evict LRU among keys with TTL set
- `allkeys-lfu` — evict least frequently used (Redis 4.0+)
- `noeviction` — return errors when memory full (never for a cache)

### Common Redis Patterns

```javascript
// Rate limiting with sliding window
async function isRateLimited(userId, limitPerMinute) {
  const key = `ratelimit:${userId}`;
  const now = Date.now();
  const windowStart = now - 60_000;

  await redis.zremrangebyscore(key, 0, windowStart);        // remove old entries
  const count = await redis.zcard(key);
  if (count >= limitPerMinute) return true;

  await redis.zadd(key, now, `${now}`);                      // add current request
  await redis.expire(key, 61);
  return false;
}

// Leaderboard with Sorted Set
await redis.zadd('leaderboard:global', score, userId);
const top10 = await redis.zrevrange('leaderboard:global', 0, 9, 'WITHSCORES');
const userRank = await redis.zrevrank('leaderboard:global', userId);
```

---

## 12. S3 as Data Lake

### S3 Select

Execute simple SQL expressions against the contents of a single S3 object (CSV, JSON, Parquet, or compressed). Filters are pushed down to S3, returning only matching rows. Reduces data transfer and processing cost for selective reads.

```python
import boto3
s3 = boto3.client('s3')

response = s3.select_object_content(
    Bucket='my-data-lake',
    Key='events/2024/10/01/events.parquet',
    ExpressionType='SQL',
    Expression="SELECT * FROM S3Object WHERE event_type = 'purchase' AND amount > 100",
    InputSerialization={'Parquet': {}},
    OutputSerialization={'JSON': {'RecordDelimiter': '\n'}},
)
```

**Limitation:** Single object, single table. For multi-object or multi-partition queries, use Athena.

### Athena Integration

Athena is serverless SQL on [S3](/aws/storage-s3). It uses Presto/Trino under the hood and integrates with the AWS Glue Data Catalog for schema management. Pay per TB scanned (~$5/TB). Parquet + ZSTD compression reduces cost by 10-20×.

**Partition projection:** Define partition schemes in the table DDL so Athena prunes partitions without consulting Glue on every query.

```sql
-- Define external table over S3 data
CREATE EXTERNAL TABLE events (
  event_id   STRING,
  user_id    STRING,
  event_type STRING,
  amount     DOUBLE,
  ts         TIMESTAMP
)
PARTITIONED BY (year STRING, month STRING, day STRING)
STORED AS PARQUET
LOCATION 's3://my-data-lake/events/'
TBLPROPERTIES ('parquet.compress'='SNAPPY');

-- Query with partition pruning (scans only matching folders)
SELECT user_id, SUM(amount)
FROM events
WHERE year = '2024' AND month = '10'
  AND event_type = 'purchase'
GROUP BY user_id
ORDER BY 2 DESC
LIMIT 100;
```

### S3 Partitioning Strategies

Partition keys are prefixes in S3 paths. Choose them based on your most frequent query filters.

```
Hive-style partitioning (Athena auto-discovers):
s3://bucket/events/year=2024/month=10/day=01/hour=14/part-00001.parquet

Date-only partitioning (for daily aggregations):
s3://bucket/events/2024/10/01/

Query pattern drives partition key order:
  If queries always filter by date: year/month/day first
  If queries always filter by region: region/year/month/day
  Avoid high-cardinality first partitions (e.g., user_id) → millions of tiny files
```

**File size matters:** Athena (and Spark) perform best with files of 128 MB – 1 GB. Too many small files (the "small files problem") wastes overhead. Use Glue ETL or EMR to compact small files periodically.

### DynamoDB → S3 Pipeline (Export & Analytics)

```
DynamoDB Streams → Kinesis Data Firehose → S3 (Parquet) → Athena
DynamoDB PITR Export → S3 (DynamoDB JSON or Parquet format)
```

**PITR Export:** Export a DynamoDB table to S3 at any point in time within the retention window (35 days). No impact on table performance. Output is DynamoDB JSON or Parquet. Use for analytics, ML training, or audit purposes.

---

## 13. Common Interview Questions

**Q: What is a hot partition in DynamoDB, how do you detect it, and how do you fix it?**

A hot partition occurs when one or more partition key values receive a disproportionate share of requests, exceeding the per-partition throughput ceiling (3,000 RCU + 1,000 WCU). Detect it via [Observability](/aws-observability) (CloudWatch): look for `ConsumedWriteCapacityUnits` or `ConsumedReadCapacityUnits` spikes on specific time ranges, or enable AWS CloudWatch Contributor Insights for DynamoDB (shows top partitions by traffic). Fix it with write sharding (append random suffix 0–N to PK, scatter-gather on reads), switching frequently-read items to eventually consistent reads, or fronting the table with DAX.

**Q: Explain the difference between a GSI and an LSI. When can't you use an LSI?**

An LSI uses the same partition key as the base table and provides an alternate sort key. It must be created at table creation time, shares the base table's capacity, and supports strongly consistent reads but is bounded by the 10 GB per partition key limit. A GSI can have a completely different PK and SK, can be added after table creation, has independent capacity, and only supports eventual consistency. Use GSI when your alternate access pattern requires a different partition key, or when you're adding indexes to existing tables.

**Q: A DynamoDB query is returning the wrong results because of a filter expression. What's happening?**

A `FilterExpression` is applied **after** DynamoDB fetches items that match the `KeyConditionExpression`. The 1 MB page size limit and the `Limit` parameter apply before filtering. You might get 0 results with `LastEvaluatedKey` present, meaning DynamoDB read a page, filtered all items out, and there are more pages. Always paginate using `LastEvaluatedKey` until it is absent, and never assume an empty result means no matching items exist.

**Q: How do you implement optimistic locking in DynamoDB?**

Add a numeric `version` attribute to each item. On every write, include a `ConditionExpression: version = :expectedVersion` and increment the version in the `UpdateExpression`. If two processes attempt concurrent updates, the second will fail with `ConditionalCheckFailedException`. The application catches this, re-reads the item to get the latest version, and retries. The AWS DynamoDB Enhanced Client (Java) and some SDKs provide built-in `@DynamoDbVersionAttribute` support.

**Q: When should you choose DynamoDB Transactions vs BatchWriteItem?**

Use transactions (`TransactWriteItems`) when you need all-or-nothing atomicity across multiple items—for example, a funds transfer that must debit one account and credit another simultaneously. Transactions cost 2× WCUs and have a 4 MB / 100 item limit. Use `BatchWriteItem` when writes are independent and partial failures are acceptable (you handle `UnprocessedItems` with retry). Batch operations are cheaper and have higher throughput limits.

**Q: How would you model a many-to-many relationship in DynamoDB?**

Use an adjacency list pattern. Store two types of items for each relationship: one in the "forward" direction and one "inverted." For a users-to-groups relationship: `PK=USER#alice, SK=GROUP#eng` (alice is in group eng) and `PK=GROUP#eng, SK=USER#alice` (group eng contains alice). A GSI on inverted access patterns or a separate GSI with `PK=GROUP#eng` lets you query all members of a group or all groups for a user efficiently.

**Q: What is the difference between RDS Multi-AZ and Read Replicas?**

Multi-AZ is for **high availability**: a synchronous standby replica that takes over automatically on primary failure (no data loss, ~60–120s DNS failover). The standby cannot serve reads. Read replicas are for **read scaling**: asynchronous copies that can serve read traffic but can be seconds behind the primary. Read replicas can be promoted to primaries during disaster recovery but are not automatic failover targets. They are different features serving different purposes and can be used simultaneously.

**Q: How does RDS Proxy solve the [Lambda](/aws/lambda-serverless) + RDS connection exhaustion problem?**

Without a proxy, each Lambda invocation opens a dedicated database connection. A spike to 1,000 concurrent Lambda executions creates 1,000 simultaneous connections, exceeding `max_connections` on most RDS instances. RDS Proxy maintains a warm connection pool to the database, multiplexing thousands of application connections through a small number of long-lived DB connections. Lambda connects to the proxy endpoint instead of the DB endpoint. The proxy also pins connections to specific DB connections when a transaction is open, and unpins them when the transaction completes.

**Q: What is write-through caching and when is it a bad idea?**

Write-through caching writes to both the cache and the database synchronously on every write, keeping the cache perpetually fresh. It is a bad idea when: (1) you write data that is rarely or never read (you're polluting the cache with cold data, evicting actually-hot items), (2) the cache TTL is very long and data changes frequently from external systems not going through your application layer, or (3) you need extremely high write throughput—the extra cache write adds latency.

**Q: What is S3 Select and when would you use Athena instead?**

S3 Select pushes down a SQL filter to S3, returning only matching rows from a single object. Use it for selective reads against a known, single file. Athena runs full SQL queries over entire S3 prefixes/partitions using the Glue Data Catalog, supports JOINs, aggregations, and multi-partition pruning, and scales to petabytes. Use Athena when you need to query across many files, join datasets, or build ad-hoc analytics at the data lake level. S3 Select is faster and cheaper for "give me the rows matching this filter from this specific file" scenarios.

**Q: Aurora Serverless v2 vs DynamoDB — you're building a multi-tenant SaaS. Which do you choose?**

It depends on query complexity and tenant isolation requirements. If your tenants need complex SQL queries, reporting, ad-hoc aggregations, or you're lifting-and-shifting a relational app, choose Aurora Serverless v2. If your access patterns are well-defined and key-based (get tenant data by ID, list items for a tenant), choose DynamoDB for its unlimited horizontal scale, predictable single-digit millisecond latency, and zero capacity planning. For a typical SaaS with mixed workloads, a common architecture is DynamoDB for transactional hot data (with `tenantId` as partition key) and Aurora Serverless v2 (or Athena on exported DynamoDB data) for reporting and analytics.

---

## DynamoDB Accelerator (DAX) — Microsecond Reads

DAX is an in-memory caching cluster that is fully API-compatible with DynamoDB, providing microsecond read latency for hot data.

### How DAX Works
```
Client SDK → DAX Cluster (in-memory cache)
                    │ cache HIT: return immediately (~microseconds)
                    │ cache MISS: forward to DynamoDB, cache result, return (~milliseconds)
                    ▼
              DynamoDB Table
```

- DAX is a **write-through** cache: writes go to DynamoDB first, then invalidate the DAX cache
- **Item cache**: caches GetItem and BatchGetItem results by primary key
- **Query cache**: caches Query and Scan results by the full request parameters
- Query cache has shorter TTL (default 5 minutes) because item updates don't automatically invalidate query results
- DAX is **eventually consistent only** — if your app requires strongly consistent reads, they bypass DAX and go directly to DynamoDB

### When to Use DAX
- Hot partitions: single items read thousands of times per second
- Read-heavy workloads: > 10:1 read/write ratio
- Applications with predictable, repeated read patterns (product catalog, configuration, user profiles)
- NOT for: write-heavy workloads, financial ledgers requiring strong consistency, rarely accessed data

### DAX Cluster Setup
```typescript
// CDK: DAX cluster in private subnets
import * as dax from 'aws-cdk-lib/aws-dax';

const daxCluster = new dax.CfnCluster(this, 'DaxCluster', {
  clusterName: 'orders-cache',
  nodeType: 'dax.r5.large',     // r5 family: memory-optimized for cache workloads
  replicationFactor: 3,          // 1 primary + 2 replicas for HA
  iamRoleArn: daxRole.roleArn,
  subnetGroupName: daxSubnetGroup.ref,
  securityGroupIds: [daxSg.securityGroupId],
  parameterGroupName: daxParamGroup.ref,
  sseSpecification: { sseEnabled: true },
});

// Node types and their use cases:
// dax.t3.small: dev/test (not recommended for production)
// dax.r5.large: up to 40K reads/sec per node
// dax.r5.4xlarge: up to 200K reads/sec per node
```

### DAX SDK Migration
```javascript
// Minimal code change: swap DynamoDB client for DAX client
// Before (DynamoDB SDK)
const { DynamoDBClient, GetItemCommand } = require('@aws-sdk/client-dynamodb');
const client = new DynamoDBClient({});

// After (DAX SDK — identical API)
const AmazonDaxClient = require('amazon-dax-client');
const client = new AmazonDaxClient({
  endpoints: ['my-cluster.dax.us-east-1.amazonaws.com:8111'],
  region: 'us-east-1',
});
// All GetItem, BatchGetItem, Query, Scan calls automatically use DAX
```

---

## DynamoDB Global Tables — Multi-Region Active-Active

Global Tables provide fully managed, multi-region, multi-active replication. Any region can accept writes.

### Architecture
```
us-east-1 Table ←────── replication ──────► eu-west-1 Table
      ↑                                            ↑
   Writes                                       Writes
      ↓                                            ↓
   Reads                                        Reads
(Route 53 latency routing directs users to nearest region)
```

### Conflict Resolution
- "Last writer wins" by timestamp: if two regions write the same item concurrently, the write with the later timestamp wins
- **This means you must design for convergent data** — avoid operations that depend on the current state of the item across regions (e.g., counters with `SET #n = #n + 1` across regions can produce wrong results)
- For counters: use Kinesis Data Streams as the source of truth → aggregate in one region → replicate to others

### Global Tables v2 (2019)
- Multi-region write support (v1 was eventually consistent reads only)
- Any region can accept writes; replication latency < 1 second
- Requires: on-demand billing mode OR auto-scaling (provisioned throughput must be configured per table per region)
- Enable: `aws dynamodb create-global-table --global-table-name Orders --replication-group RegionName=us-east-1 RegionName=eu-west-1`

### Practical Pattern: Regional Write Isolation
To avoid conflict resolution complexity, use **regional write isolation**: each user/tenant is assigned a "home region" (stored in their profile). Route all writes for that user to their home region. Other regions serve reads (with slight replication lag acceptable). Write conflicts become impossible.

---

## Advanced Single-Table Design Patterns

### Pattern 1: Adjacency List (One-to-Many Relationships)
Model an order with multiple items in a single table:

```
PK                    SK                     Data
ORDER#1001           METADATA               {status, customerId, total}
ORDER#1001           ITEM#prod-a            {quantity: 2, price: 29.99}
ORDER#1001           ITEM#prod-b            {quantity: 1, price: 49.99}
ORDER#1001           SHIPING#1              {address, carrier, trackingId}
CUSTOMER#cust-42     ORDER#1001             {orderDate, total} ← inverted index
CUSTOMER#cust-42     ORDER#1002             {orderDate, total}
```

Access patterns:
- Get order + all items: `PK = ORDER#1001` (Query returns all SK values)
- Get all orders for customer: GSI or `PK = CUSTOMER#cust-42, SK begins_with ORDER#`

### Pattern 2: Overloaded GSI (Global Secondary Index Reuse)
One GSI handles multiple entity types by overloading the GSI key attributes:

```
PK            SK                GSI1_PK        GSI1_SK
USER#u1       PROFILE           STATUS#active  USER#u1
ORDER#o1      USER#u1           STATUS#pending USER#u1
PRODUCT#p1    CATEGORY#electronics  CATEGORY#electronics  PRODUCT#p1
```

GSI1 query: `GSI1_PK = STATUS#active` → returns all active users. `GSI1_PK = CATEGORY#electronics` → returns all products in category. Single GSI serves multiple query patterns.

### Pattern 3: Composite Sort Key for Range Queries
Encode multiple attributes in the sort key for flexible range queries:

```javascript
// Sort key pattern: REGION#YEAR#MONTH#DAY#ORDER_ID
const sortKey = `${region}#${year}#${month.padStart(2,'0')}#${day.padStart(2,'0')}#${orderId}`;
// Enables queries like:
// - All orders in EU in 2024: SK between 'EU#2024#' and 'EU#2025#'
// - All orders on a specific day: SK between 'EU#2024#01#15#' and 'EU#2024#01#16#'
```

### Pattern 4: Write Sharding for Hot Partitions
If a single partition key receives > 1000 WCU/s (hot partition), append a random suffix:

```javascript
// Instead of PK = 'LEADERBOARD', shard across 10 partitions
const shardCount = 10;
const shard = Math.floor(Math.random() * shardCount);
const pk = `LEADERBOARD#${shard}`;

// Scatter-gather read: query all 10 shards in parallel, merge results
const results = await Promise.all(
  Array.from({ length: shardCount }, (_, i) =>
    ddb.send(new QueryCommand({ TableName, KeyConditionExpression: 'PK = :pk', ExpressionAttributeValues: { ':pk': { S: `LEADERBOARD#${i}` } } }))
  )
);
const allItems = results.flatMap(r => r.Items);
allItems.sort((a, b) => b.score.N - a.score.N);
```

---

## DynamoDB Streams + Lambda Patterns

### CDC (Change Data Capture) for Event Sourcing
```javascript
// Lambda triggered by DynamoDB Streams
exports.handler = async (event) => {
  for (const record of event.Records) {
    const { eventName, dynamodb } = record; // INSERT, MODIFY, REMOVE

    if (eventName === 'INSERT') {
      const newItem = AWS.DynamoDB.Converter.unmarshall(dynamodb.NewImage);
      await publishToEventBridge('order.created', newItem);
    }

    if (eventName === 'MODIFY') {
      const oldItem = AWS.DynamoDB.Converter.unmarshall(dynamodb.OldImage);
      const newItem = AWS.DynamoDB.Converter.unmarshall(dynamodb.NewImage);
      if (oldItem.status !== newItem.status) {
        await publishToEventBridge('order.status.changed', {
          orderId: newItem.orderId,
          from: oldItem.status,
          to: newItem.status
        });
      }
    }
  }
};
```

Publishing change events to [Messaging & Events](/aws-messaging-events) (EventBridge/SNS) from Streams Lambda is the standard pattern for decoupled downstream processing. For multi-step workflows triggered by item changes, consider [Step Functions](/aws-step-functions) as the consumer instead of a single Lambda.

### Materialized View Maintenance
Streams + Lambda to maintain a pre-aggregated view in another table:

```javascript
// Maintain a count of orders per customer in a summary table
if (eventName === 'INSERT') {
  await ddb.send(new UpdateItemCommand({
    TableName: 'CustomerSummary',
    Key: { customerId: { S: newItem.customerId } },
    UpdateExpression: 'ADD orderCount :one',
    ExpressionAttributeValues: { ':one': { N: '1' } },
  }));
}
```

---

## PartiQL — SQL for DynamoDB

PartiQL lets you query DynamoDB using SQL-like syntax. Useful for ad-hoc exploration and migrating SQL-centric teams.

```sql
-- SELECT (equivalent to Query with filter)
SELECT * FROM Orders WHERE customerId = 'cust-42' AND orderDate BETWEEN '2024-01-01' AND '2024-12-31';

-- INSERT
INSERT INTO Orders VALUE {
  'orderId': 'ord-9999',
  'customerId': 'cust-42',
  'status': 'pending',
  'total': 99.99
};

-- UPDATE (conditional)
UPDATE Orders SET status = 'shipped', shippedAt = '2024-01-16T10:00:00Z'
WHERE orderId = 'ord-9999' AND status = 'confirmed';

-- DELETE
DELETE FROM Orders WHERE orderId = 'ord-9999';

-- Batch operations (more efficient)
SELECT * FROM Orders WHERE orderId IN ['ord-1', 'ord-2', 'ord-3'];
```

**PartiQL limitations**: No JOINs (DynamoDB is schemaless), no aggregates (SUM, COUNT) without full scan, no subqueries. PartiQL is syntactic sugar — same read/write capacity consumed as SDK operations.

---

## Red Flags to Avoid

- **"I'll just use Scan with a filter to find items by email address."** Scan is O(n) in table size. Add a GSI with email as the partition key—query, don't scan.
- **"DynamoDB is eventually consistent, so transactions aren't possible."** DynamoDB supports both strongly consistent reads (per item) and full ACID transactions via `TransactWriteItems`.
- **"I'll design the table schema first, then figure out queries later."** The opposite is the rule: access patterns first, schema second. Getting this backward leads to full-table scans.
- **"I'll add an LSI to the table to fix my query performance."** LSIs cannot be added after table creation. This requires a table migration. GSIs can be added at any time.
- **"We'll use read replicas as our failover for RDS."** Read replicas are asynchronous and not automatic failover targets. Multi-AZ provides automatic failover; read replicas provide read scaling.
- **"ElastiCache is a database."** It is a volatile cache. Never store data in ElastiCache that isn't also persisted to a durable store. Cache-aside means the DB is the source of truth.
- **"We'll partition our Athena data by user_id."** High-cardinality partition keys create millions of tiny files and S3 prefixes, degrading Athena list performance. Partition by time dimensions first.
- **"We don't need RDS Proxy because [Lambda](/aws/lambda-serverless) doesn't use many connections normally."** Connection counts scale with Lambda concurrency, which can spike to thousands within seconds on traffic surges. Proxy is essential for any Lambda-to-RDS integration at production scale.
