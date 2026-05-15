# ACID Properties

ACID — Atomicity, Consistency, Isolation, Durability — is the set of guarantees that make database transactions reliable. Every time you transfer money between accounts, place an order, or update a user profile, ACID ensures the operation either completes fully and correctly or has no effect at all. Understanding these properties is essential whether you are working with traditional relational databases, building [microservices](/microservices) with distributed state, or designing storage layers for [vector databases](/vector-databases).

## The 30-Second Pitch

A **transaction** is a sequence of database operations treated as a single logical unit. ACID defines what "treated as a single unit" actually means: the operations either all succeed or all fail (**Atomicity**), they move the database from one valid state to another (**Consistency**), concurrent transactions do not interfere with each other (**Isolation**), and once committed, the results survive crashes (**Durability**). Without these guarantees, applications must handle partial failures, corrupted state, and lost data at the application layer — complexity that grows exponentially with system scale.

## Atomicity

> All operations in a transaction succeed, or none of them take effect.

Atomicity means there is no such thing as a "half-finished" transaction. If any step fails, every preceding step is rolled back as if nothing happened.

### Example: transferring funds

```sql
BEGIN;

UPDATE accounts SET balance = balance - 500.00
  WHERE id = 'alice'
  AND balance >= 500.00;  -- guard against overdraft

UPDATE accounts SET balance = balance + 500.00
  WHERE id = 'bob';

-- If either UPDATE fails, both are rolled back
COMMIT;
```

Without atomicity, a crash between the two UPDATEs would debit Alice without crediting Bob — money disappears. The database engine writes all changes to a **write-ahead log (WAL)** before applying them to data pages. If the process crashes mid-transaction, recovery replays the WAL and rolls back incomplete transactions.

### Atomicity in application code

```typescript
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql);

async function transferFunds(fromId: string, toId: string, amount: number) {
  // Drizzle transaction — all-or-nothing
  await db.transaction(async (tx) => {
    const [sender] = await tx
      .select()
      .from(accounts)
      .where(eq(accounts.id, fromId));

    if (sender.balance < amount) {
      throw new Error("Insufficient funds"); // triggers rollback
    }

    await tx
      .update(accounts)
      .set({ balance: sql`balance - ${amount}` })
      .where(eq(accounts.id, fromId));

    await tx
      .update(accounts)
      .set({ balance: sql`balance + ${amount}` })
      .where(eq(accounts.id, toId));
  });
}
```

Throwing inside the transaction callback automatically rolls back all changes — the ORM handles the `ROLLBACK` statement.

## Consistency

> A transaction brings the database from one valid state to another valid state.

Consistency means that every transaction respects the database's rules: constraints (NOT NULL, UNIQUE, CHECK, [FOREIGN KEY](/foreign-keys)), triggers, and any application-level invariants. If a transaction would violate a constraint, it is rejected entirely.

### Enforced by the database

```sql
CREATE TABLE orders (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id),     -- FK constraint
  total      NUMERIC(10,2) NOT NULL CHECK (total > 0), -- domain constraint
  status     TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','confirmed','shipped','cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

A transaction that tries to insert an order with `total = -5` or a non-existent `user_id` will fail, and atomicity ensures any related writes are rolled back.

### Application-level consistency

Some invariants cannot be expressed as SQL constraints. For example: "the total number of reserved seats must not exceed venue capacity." These require application logic, but the transaction boundary ensures the check-and-update happens atomically:

```typescript
await db.transaction(async (tx) => {
  const [venue] = await tx
    .select()
    .from(venues)
    .where(eq(venues.id, venueId));

  const [{ count }] = await tx
    .select({ count: sql<number>`count(*)` })
    .from(reservations)
    .where(eq(reservations.venueId, venueId));

  if (count >= venue.capacity) {
    throw new Error("Venue is full");
  }

  await tx.insert(reservations).values({ venueId, userId });
});
```

The transaction guarantees that no other reservation sneaks in between the count check and the insert — provided the isolation level is sufficient (see below).

## Isolation

> Concurrent transactions execute as if they were running sequentially.

Isolation prevents phenomena like dirty reads (seeing uncommitted data), non-repeatable reads (re-reading a row and getting different values), and phantom reads (a query returning different rows on re-execution). In practice, full serialization is expensive, so databases offer **isolation levels** that trade correctness for performance.

### The four isolation levels

| Level | Dirty Read | Non-Repeatable Read | Phantom Read | Performance |
|---|---|---|---|---|
| Read Uncommitted | Possible | Possible | Possible | Fastest |
| Read Committed | Prevented | Possible | Possible | Good |
| Repeatable Read | Prevented | Prevented | Possible | Moderate |
| Serializable | Prevented | Prevented | Prevented | Slowest |

**PostgreSQL defaults to Read Committed.** Most OLTP workloads use Read Committed or Repeatable Read. Serializable is used for financial transactions or when correctness trumps throughput.

### Setting isolation level

```sql
-- Per-transaction isolation
BEGIN ISOLATION LEVEL SERIALIZABLE;

UPDATE inventory SET quantity = quantity - 1
  WHERE product_id = 'widget-42'
  AND quantity > 0;

INSERT INTO order_items (order_id, product_id, quantity)
  VALUES ('order-99', 'widget-42', 1);

COMMIT;
```

With Serializable isolation, if two transactions try to buy the last widget simultaneously, one will succeed and the other will receive a serialization failure — the application retries or reports "out of stock."

### Isolation in practice

```typescript
// PostgreSQL Serializable with retry logic
async function purchaseWithRetry(orderId: string, productId: string, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      await db.transaction(async (tx) => {
        // Set isolation level
        await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL SERIALIZABLE`);

        const [item] = await tx
          .select()
          .from(inventory)
          .where(eq(inventory.productId, productId));

        if (item.quantity <= 0) throw new Error("Out of stock");

        await tx.update(inventory)
          .set({ quantity: sql`quantity - 1` })
          .where(eq(inventory.productId, productId));

        await tx.insert(orderItems)
          .values({ orderId, productId, quantity: 1 });
      });
      return; // success
    } catch (err: any) {
      // PostgreSQL error code 40001 = serialization_failure
      if (err.code === "40001" && attempt < maxRetries - 1) continue;
      throw err;
    }
  }
}
```

Serialization failures are expected and normal under Serializable isolation — the retry loop is part of the design, not a hack.

## Durability

> Once a transaction is committed, it remains committed even if the system crashes.

Durability means committed data is written to non-volatile storage. PostgreSQL achieves this through the **write-ahead log (WAL)**: transaction changes are flushed to the WAL on disk before the `COMMIT` returns to the client. Even if the server loses power one millisecond later, the WAL contains everything needed to recover.

### Durability in managed databases

With managed services like Neon, durability goes further:

- **WAL is streamed to object storage** (S3) in near-real-time
- **Point-in-time recovery (PITR)** lets you restore to any second in the last 7-30 days
- **Replicas** provide additional redundancy across availability zones

This means durability is not just "survives a crash" but "survives disk failure, datacenter outages, and accidental `DROP TABLE`."

### WAL and fsync

```sql
-- Check current WAL settings
SHOW wal_level;           -- typically 'replica' or 'logical'
SHOW synchronous_commit;  -- 'on' = full durability (default)
SHOW fsync;               -- 'on' = WAL pages flushed to disk
```

Setting `synchronous_commit = off` trades durability for write speed — commits return before WAL is flushed. The last few milliseconds of transactions may be lost on crash. This is acceptable for analytics events or session caches, but never for financial data.

## Isolation Levels Deep Dive

Understanding when to use each isolation level is a practical skill that separates junior from senior database work.

**Read Committed** (PostgreSQL default): Each statement sees only data committed before the statement began. Two consecutive SELECT queries within the same transaction may return different results if another transaction committed between them. Use for: most web application queries, analytics dashboards, read-heavy workloads.

**Repeatable Read**: The transaction sees a snapshot taken at the start of the first query. Subsequent reads within the transaction always return the same data, even if other transactions commit. Use for: reporting queries that must see a consistent snapshot, batch processing.

**Serializable**: Transactions behave as if executed one at a time. PostgreSQL implements this via **Serializable Snapshot Isolation (SSI)**, which detects dangerous patterns and aborts one of the conflicting transactions. Use for: financial transfers, inventory management, any operation where concurrent anomalies could cause data loss.

```sql
-- Practical example: Repeatable Read for consistent reporting
BEGIN ISOLATION LEVEL REPEATABLE READ;

-- These two queries see the same snapshot, even if orders are
-- being inserted concurrently
SELECT count(*) AS total_orders FROM orders WHERE date = CURRENT_DATE;
SELECT sum(total) AS revenue FROM orders WHERE date = CURRENT_DATE;

COMMIT;
```

## ACID vs BASE — The CAP Theorem Trade-off

Not all systems need full ACID. Distributed databases and [microservices](/microservices) architectures often adopt **BASE** (Basically Available, Soft state, Eventually consistent) to achieve higher availability and partition tolerance.

| Property | ACID | BASE |
|---|---|---|
| Focus | Correctness | Availability |
| Consistency | Strong (immediate) | Eventual |
| Transactions | Multi-statement, all-or-nothing | Single-operation, compensating actions |
| Scale pattern | Vertical (single node) | Horizontal (distributed) |
| Use case | Financial, inventory, auth | Social feeds, analytics, caches |

The **CAP theorem** states that a distributed system can provide at most two of three guarantees: Consistency, Availability, and Partition tolerance. Since network partitions are unavoidable, the real choice is between CP (consistent but may reject requests during partitions) and AP (available but may return stale data).

Traditional RDBMS (PostgreSQL, MySQL) are CP systems. Distributed stores like Cassandra and DynamoDB are AP systems. Neon PostgreSQL is CP but achieves high availability through WAL streaming and fast failover.

### The Saga pattern — ACID across services

In a microservices architecture, a single business transaction (e.g., "place an order") may span multiple services, each with its own database. Since distributed transactions (2PC) are slow and fragile, the **Saga pattern** breaks the transaction into a sequence of local ACID transactions with compensating actions for rollback:

```typescript
// Saga: Place Order
// Step 1: Reserve inventory (Inventory Service)
// Step 2: Charge payment (Payment Service)
// Step 3: Confirm order (Order Service)
//
// If Step 2 fails → compensate Step 1 (release inventory)
// If Step 3 fails → compensate Step 2 (refund) + Step 1 (release)

interface SagaStep {
  execute(): Promise<void>;
  compensate(): Promise<void>;
}

async function runSaga(steps: SagaStep[]) {
  const completed: SagaStep[] = [];
  try {
    for (const step of steps) {
      await step.execute();
      completed.push(step);
    }
  } catch (err) {
    // Compensate in reverse order
    for (const step of completed.reverse()) {
      await step.compensate();
    }
    throw err;
  }
}
```

Each step is individually ACID (within its own database), but the overall saga provides only eventual consistency — a fundamental trade-off in distributed systems.

## ACID in Practice

### When to rely on ACID

- **User authentication and authorization**: Session creation, password changes, and role assignments must be atomic and durable.
- **Financial operations**: Any movement of money, credits, or tokens requires serializable isolation.
- **Inventory and booking**: Overbooking a flight or overselling stock is a business-critical failure that ACID prevents.
- **Schema migrations**: DDL operations (ALTER TABLE, CREATE INDEX) within a transaction ensure the schema is never in a half-migrated state.

### When ACID is overkill

- **Analytics event ingestion**: Losing a few page-view events during a crash is acceptable. Use `synchronous_commit = off` or an append-only log.
- **Cache warming**: Caches are rebuilt from source-of-truth databases; durability and strict isolation add latency without benefit.
- **Search index updates**: Search indexes (Elasticsearch, Meilisearch) are eventually consistent by design. Full ACID on the index would bottleneck writes.

### Performance considerations

ACID guarantees have a cost. Each higher isolation level adds overhead:

- **Read Committed**: minimal overhead, snapshot per statement
- **Repeatable Read**: holds a snapshot for the entire transaction — long transactions consume more memory
- **Serializable**: SSI tracking adds CPU overhead and may abort transactions under high contention

The key optimization: **keep transactions short**. A transaction that holds locks for 5ms under Serializable isolation is fine. A transaction that holds locks for 5 seconds will cause cascading aborts and throughput collapse. Move non-transactional work (HTTP calls, file I/O, LLM inference) outside the transaction boundary.
