# Foreign Keys: Referential Integrity, Cascades & Migration Patterns

A foreign key is the constraint that turns a pile of independent tables into a relational graph: it tells the database that a column in one table must always point at a real row in another. Without foreign keys you can write `orders.user_id = 999` even when no user `999` exists, and nothing stops you — until a JOIN returns ghost rows, a billing job crashes on a NULL, or an analytics query silently undercounts. With foreign keys the database refuses the bad write at the boundary, so every other layer can trust that relationships are intact. This article covers what FKs actually guarantee, every `ON DELETE` / `ON UPDATE` action and when each is correct, why FK columns need their own indexes, deferrable constraints for circular references, and the safe migration pattern for adding FKs to a populated production table.

For foundational transaction guarantees, see [ACID Properties](/acid-properties); for combining tables across foreign keys, see [PostgreSQL JOINs](/postgresql-joins).

## Mental Model

### What problem does it solve?

Without foreign keys, "Alice's orders" is a convention enforced only by application code. Every insert, update, and delete that touches a relationship is an opportunity for a bug to leave the database inconsistent: an order whose `user_id` points at a deleted user, a comment whose `post_id` typo doesn't match anything, a `team_id` left over after the team itself was dropped. These **orphan rows** are silent — they sit in the table looking valid until something joins through them and returns wrong answers, or worse, until a CASCADE you forgot to write deletes far more than intended. A foreign key moves enforcement from "every code path that mutates this table" to "the database itself, on every write, forever."

### The whiteboard analogy

Imagine two filing cabinets: "Users" and "Orders." Every order folder has a slip with a user-ID written on it. A foreign key is the rule that the front-desk clerk enforces: whenever someone tries to file a new order, the clerk walks to the Users cabinet and checks that the referenced user folder actually exists. If it doesn't, the order is refused. When someone tries to throw out a user folder, the clerk checks the Orders cabinet first — depending on the rule, the clerk either refuses the deletion (RESTRICT), throws out every order belonging to that user too (CASCADE), or replaces the user-ID slips with blanks (SET NULL).

```xyflow
{
  "direction": "TD",
  "nodes": [
    {"id": "users", "label": "users (parent)\nid ∈ {1, 2, 3}", "shape": "rect"},
    {"id": "orders", "label": "orders (child)\nuser_id REFERENCES users(id)", "shape": "rect"},
    {"id": "ok", "label": "INSERT user_id = 1\n→ accepted", "shape": "circle"},
    {"id": "bad", "label": "INSERT user_id = 999\n→ ERROR 23503", "shape": "circle"}
  ],
  "edges": [
    {"source": "users", "target": "orders", "label": "REFERENCES users(id)"},
    {"source": "orders", "target": "ok", "label": "parent exists", "style": "thick"},
    {"source": "orders", "target": "bad", "label": "parent missing", "style": "dotted"}
  ]
}
```

### Hello-world in ~10 lines

```sql
CREATE TABLE users (
  id   INT PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE orders (
  id      INT PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id),  -- the foreign key
  amount  NUMERIC(10,2) NOT NULL
);

INSERT INTO users  VALUES (1, 'Alice');
INSERT INTO orders VALUES (101, 1, 50.00);    -- OK: user 1 exists
INSERT INTO orders VALUES (102, 999, 25.00);  -- ERROR 23503: insert violates FK
```

The second insert fails with PostgreSQL error code `23503` (`foreign_key_violation`). The constraint is checked synchronously, inside the transaction, before any row is written.

```xyflow
{
  "direction": "TD",
  "nodes": [
    {"id": "insert", "label": "INSERT INTO orders\n(id, user_id, amount)", "shape": "stadium"},
    {"id": "lock", "label": "row-level lock on\nusers WHERE id = user_id", "shape": "rect"},
    {"id": "check", "label": "users.id\nexists?", "shape": "diamond"},
    {"id": "ok", "label": "row written\n(user_id = 1)", "shape": "circle"},
    {"id": "fail", "label": "ERROR 23503\nforeign_key_violation\n(user_id = 999)", "shape": "circle"}
  ],
  "edges": [
    {"source": "insert", "target": "lock"},
    {"source": "lock", "target": "check"},
    {"source": "check", "target": "ok", "label": "yes", "style": "thick"},
    {"source": "check", "target": "fail", "label": "no", "style": "dotted"}
  ]
}
```

## Core Concepts

### Referential integrity

Referential integrity is the invariant that every foreign-key value either matches an existing primary-key (or unique) value in the referenced table, or is `NULL` (when the column is nullable). The database enforces this on every `INSERT`, `UPDATE`, and `DELETE` that could violate it — there is no race condition where a window of inconsistency exists, even under concurrent transactions, because FK checks acquire row-level locks on the referenced parent row.

The guarantee is symmetric. Two things can break referential integrity:

1. **A child row referencing a non-existent parent.** Caught at INSERT or UPDATE on the child.
2. **A parent row being deleted while children still reference it.** Caught at DELETE on the parent — and what happens then is governed by `ON DELETE`, covered below.

```xyflow
{
  "direction": "LR",
  "nodes": [
    {"id": "valid", "label": "consistent\nstate", "shape": "circle"},
    {"id": "attempt", "label": "INSERT / UPDATE\n/ DELETE", "shape": "stadium"},
    {"id": "check", "label": "would orphan\nany row?", "shape": "diamond"},
    {"id": "rollback", "label": "ROLLBACK\nERROR 23503", "shape": "rect"},
    {"id": "commit", "label": "COMMIT", "shape": "rect"},
    {"id": "back", "label": "still\nconsistent", "shape": "circle"}
  ],
  "edges": [
    {"source": "valid", "target": "attempt"},
    {"source": "attempt", "target": "check"},
    {"source": "check", "target": "rollback", "label": "yes", "style": "dotted"},
    {"source": "check", "target": "commit", "label": "no", "style": "thick"},
    {"source": "rollback", "target": "back"},
    {"source": "commit", "target": "back"}
  ]
}
```

### Composite and natural keys

A foreign key can span multiple columns when the referenced primary key is composite. This shows up in multi-tenant schemas where a child row must point at a parent within the same tenant.

```sql
CREATE TABLE projects (
  tenant_id  UUID,
  project_id UUID,
  name       TEXT NOT NULL,
  PRIMARY KEY (tenant_id, project_id)
);

CREATE TABLE tasks (
  id         UUID PRIMARY KEY,
  tenant_id  UUID NOT NULL,
  project_id UUID NOT NULL,
  title      TEXT NOT NULL,
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects (tenant_id, project_id)
);
```

The composite FK guarantees not only that the project exists but that it belongs to the same tenant — preventing cross-tenant data leaks at the schema level.

```xyflow
{
  "direction": "TD",
  "nodes": [
    {"id": "insert", "label": "INSERT INTO tasks\n(tenant=A, project=X)", "shape": "stadium"},
    {"id": "match", "label": "projects has row\nWHERE tenant=A\nAND project=X?", "shape": "diamond"},
    {"id": "ok", "label": "accepted\n(same-tenant link)", "shape": "circle"},
    {"id": "leak", "label": "rejected\n(cross-tenant\nleak prevented)", "shape": "circle"}
  ],
  "edges": [
    {"source": "insert", "target": "match"},
    {"source": "match", "target": "ok", "label": "both columns match", "style": "thick"},
    {"source": "match", "target": "leak", "label": "any mismatch\n(e.g. tenant=B)", "style": "dotted"}
  ]
}
```

### Self-referential foreign keys

A foreign key can reference its own table — the canonical example is an org chart where every employee has a `manager_id` that points at another employee.

```sql
CREATE TABLE employees (
  id         INT PRIMARY KEY,
  name       TEXT NOT NULL,
  manager_id INT REFERENCES employees(id)  -- nullable: the CEO has no manager
);
```

Self-references force two design decisions: the column must be **nullable** (someone has to be the root), and you must decide whether cycles are allowed. Postgres does not enforce acyclicity — preventing `manager_id` cycles requires a `CHECK` based on a recursive CTE or a trigger.

```xyflow
{
  "direction": "TD",
  "nodes": [
    {"id": "ceo", "label": "id=1 CEO\nmanager_id = NULL\n(root)", "shape": "stadium"},
    {"id": "vp1", "label": "id=2 VP Eng", "shape": "rect"},
    {"id": "vp2", "label": "id=3 VP Sales", "shape": "rect"},
    {"id": "ic1", "label": "id=4 Engineer", "shape": "circle"},
    {"id": "ic2", "label": "id=5 Engineer", "shape": "circle"},
    {"id": "ic3", "label": "id=6 AE", "shape": "circle"}
  ],
  "edges": [
    {"source": "vp1", "target": "ceo", "label": "manager_id=1"},
    {"source": "vp2", "target": "ceo", "label": "manager_id=1"},
    {"source": "ic1", "target": "vp1", "label": "manager_id=2"},
    {"source": "ic2", "target": "vp1", "label": "manager_id=2"},
    {"source": "ic3", "target": "vp2", "label": "manager_id=3"}
  ]
}
```

## ON DELETE / ON UPDATE actions

The most consequential part of a foreign-key declaration is what happens when the referenced parent row is deleted or its key is updated. Postgres offers five actions; pick the wrong one and you get either crashes (orphans, RESTRICT panics) or silent data loss (runaway CASCADE).

### NO ACTION (default)

The default if you write nothing. Postgres checks at the **end of the statement** (or at COMMIT, if the constraint is `DEFERRABLE`) that no children reference the about-to-be-deleted parent. Functionally identical to `RESTRICT` in non-deferrable mode — most teams treat them as synonyms.

```sql
user_id INT REFERENCES users(id)  -- NO ACTION (implicit)
```

### RESTRICT

Same outcome as `NO ACTION`, but the check is **immediate** — it cannot be deferred. Use this when you want to forbid deferral even within a transaction that marks other constraints as deferred.

```sql
user_id INT REFERENCES users(id) ON DELETE RESTRICT
```

```xyflow
{
  "direction": "TD",
  "nodes": [
    {"id": "delete", "label": "DELETE FROM users\nWHERE id = 1", "shape": "stadium"},
    {"id": "check", "label": "any orders with\nuser_id = 1?", "shape": "diamond"},
    {"id": "block", "label": "ERROR 23503\nparent delete blocked\n(children remain)", "shape": "circle"},
    {"id": "ok", "label": "user 1 deleted\n(no children to worry about)", "shape": "circle"}
  ],
  "edges": [
    {"source": "delete", "target": "check"},
    {"source": "check", "target": "block", "label": "yes — children exist", "style": "dotted"},
    {"source": "check", "target": "ok", "label": "no", "style": "thick"}
  ]
}
```

### CASCADE

When the parent row is deleted, every child row that references it is deleted too — and if those children themselves have CASCADE-children, the cascade continues. This is the right default for **owned** relationships: a `comments` table owned by `posts`, `order_items` owned by `orders`, `sessions` owned by `users`. It is the wrong choice when the child rows have independent meaning that should outlive the parent (audit logs, financial records, soft-deletable entities).

```sql
post_id INT REFERENCES posts(id) ON DELETE CASCADE
```

```xyflow
{
  "direction": "TD",
  "nodes": [
    {"id": "post", "label": "DELETE post #42\n1 row", "shape": "stadium"},
    {"id": "comments", "label": "comments\n147 rows → DELETED", "shape": "rect"},
    {"id": "reactions", "label": "reactions\n2,891 rows → DELETED", "shape": "circle"},
    {"id": "mentions", "label": "mentions\n312 rows → DELETED", "shape": "circle"},
    {"id": "edits", "label": "comment_edits\n1,204 rows → DELETED", "shape": "circle"}
  ],
  "edges": [
    {"source": "post", "target": "comments", "label": "ON DELETE CASCADE", "style": "thick"},
    {"source": "comments", "target": "reactions", "label": "CASCADE", "style": "thick"},
    {"source": "comments", "target": "mentions", "label": "CASCADE", "style": "thick"},
    {"source": "comments", "target": "edits", "label": "CASCADE", "style": "thick"}
  ]
}
```

### SET NULL

When the parent is deleted, the FK column in every child becomes `NULL`. The column must be nullable for this to be legal. Use this when the relationship is informational rather than structural — e.g. `tickets.assigned_to` referencing `users.id`: deleting the user shouldn't delete the ticket, just unassign it.

```sql
assigned_to INT REFERENCES users(id) ON DELETE SET NULL
```

```xyflow
{
  "direction": "TD",
  "nodes": [
    {"id": "before", "label": "BEFORE\n#101 assigned_to=7\n#102 assigned_to=7\n#103 assigned_to=NULL", "shape": "rect"},
    {"id": "delete", "label": "DELETE user #7", "shape": "stadium"},
    {"id": "after", "label": "AFTER\n#101 assigned_to=NULL\n#102 assigned_to=NULL\n#103 assigned_to=NULL", "shape": "rect"},
    {"id": "kept", "label": "ticket rows\npreserved", "shape": "circle"}
  ],
  "edges": [
    {"source": "before", "target": "delete"},
    {"source": "delete", "target": "after", "label": "ON DELETE SET NULL", "style": "thick"},
    {"source": "after", "target": "kept"}
  ]
}
```

### SET DEFAULT

Sets the FK column to its column default — which itself must point at a row that exists, or the action fails. Common pattern: a `category_id` whose default points at an "Uncategorized" sentinel row that you guarantee never gets deleted.

```sql
category_id INT NOT NULL DEFAULT 0
  REFERENCES categories(id) ON DELETE SET DEFAULT
```

This is the rarest action in production schemas — most teams reach for `SET NULL` or `CASCADE` instead. It exists for cases where `NULL` would be awkward in queries and a sentinel row is preferable.

```xyflow
{
  "direction": "TD",
  "nodes": [
    {"id": "delete", "label": "DELETE category #5", "shape": "stadium"},
    {"id": "products", "label": "products WHERE\ncategory_id = 5", "shape": "rect"},
    {"id": "default", "label": "category_id ← 0\n(\"Uncategorized\" sentinel)", "shape": "circle"},
    {"id": "fail", "label": "ERROR if sentinel\nrow itself missing", "shape": "circle"}
  ],
  "edges": [
    {"source": "delete", "target": "products"},
    {"source": "products", "target": "default", "label": "default exists", "style": "thick"},
    {"source": "products", "target": "fail", "label": "default missing", "style": "dotted"}
  ]
}
```

### Action comparison

| Action        | Parent delete blocked? | Child row deleted? | FK column changed? | Typical use                               |
|---------------|------------------------|--------------------|--------------------|-------------------------------------------|
| `NO ACTION`   | yes (deferrable)       | no                 | no                 | default; most strict relationships        |
| `RESTRICT`    | yes (immediate)        | no                 | no                 | when deferral must be forbidden           |
| `CASCADE`     | no                     | yes                | n/a                | owned relationships (post→comments)       |
| `SET NULL`    | no                     | no                 | → NULL             | optional links (ticket→assignee)          |
| `SET DEFAULT` | no                     | no                 | → DEFAULT          | sentinel-row patterns (category fallback) |

The same five actions are available for `ON UPDATE`, triggered when the parent's primary-key value is updated. In practice, `ON UPDATE CASCADE` is uncommon because most production schemas use immutable surrogate keys (UUIDs, serial IDs) that never change.

## Indexing foreign-key columns

Postgres automatically creates an index on the **referenced** column (the parent's primary key — already indexed by definition) but it does **not** create one on the **referencing** column. This is the single most common foreign-key footgun in production: every `DELETE` or `UPDATE` on the parent has to scan every child table whose FK points at it, looking for matching rows. Without an index on the FK column, that scan is a sequential scan over the entire child table.

```sql
-- Without this, deletes from users will seq-scan orders every time:
CREATE INDEX orders_user_id_idx ON orders (user_id);
```

```xyflow
{
  "direction": "TD",
  "nodes": [
    {"id": "delete", "label": "DELETE FROM users\nWHERE id = 1", "shape": "stadium"},
    {"id": "check", "label": "find orders\nWHERE user_id = 1", "shape": "diamond"},
    {"id": "noidx", "label": "Seq Scan on orders\nO(N) — 50M rows\n~12 s", "shape": "circle"},
    {"id": "idx", "label": "Index Scan\nO(log N) — 23 levels\n~2 ms", "shape": "circle"}
  ],
  "edges": [
    {"source": "delete", "target": "check"},
    {"source": "check", "target": "noidx", "label": "no FK index\n(default!)", "style": "dotted"},
    {"source": "check", "target": "idx", "label": "FK index added", "style": "thick"}
  ]
}
```

A good audit query: list every FK column without a covering index.

```sql
SELECT c.conrelid::regclass AS table_name,
       a.attname            AS column_name,
       c.conname             AS fk_name
FROM   pg_constraint c
JOIN   pg_attribute a
       ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
WHERE  c.contype = 'f'
  AND NOT EXISTS (
    SELECT 1 FROM pg_index i
    WHERE i.indrelid = c.conrelid
      AND a.attnum = ANY(i.indkey)
      AND i.indkey[0] = a.attnum  -- index leads with this column
  );
```

## Deferrable constraints

By default, FK checks fire at the end of every statement. For most cases that is what you want. But two scenarios genuinely need deferral:

1. **Circular foreign keys** between two tables — neither side can be inserted first because each requires the other to exist.
2. **Bulk reorder operations** that briefly violate the constraint mid-transaction (e.g. swapping two rows' positions when position is part of a unique key).

Mark the constraint `DEFERRABLE INITIALLY DEFERRED` and the check is postponed until `COMMIT`:

```sql
ALTER TABLE orders
  ADD CONSTRAINT orders_user_fk
  FOREIGN KEY (user_id) REFERENCES users(id)
  DEFERRABLE INITIALLY DEFERRED;
```

Now within a transaction the constraint can be transiently violated, as long as the database is consistent again by the time you commit.

```xyflow
{
  "direction": "LR",
  "nodes": [
    {"id": "begin", "label": "BEGIN", "shape": "stadium"},
    {"id": "stmt1", "label": "INSERT child\n(parent missing)", "shape": "rect"},
    {"id": "transient", "label": "FK violated\nbut DEFERRED\n(no error yet)", "shape": "rect"},
    {"id": "stmt2", "label": "INSERT parent\n(restores integrity)", "shape": "rect"},
    {"id": "commit", "label": "COMMIT →\ndeferred FK\nchecks fire", "shape": "diamond"},
    {"id": "ok", "label": "transaction\nsucceeds", "shape": "circle"},
    {"id": "fail", "label": "ROLLBACK if still\nviolated at commit", "shape": "circle"}
  ],
  "edges": [
    {"source": "begin", "target": "stmt1"},
    {"source": "stmt1", "target": "transient", "style": "dotted"},
    {"source": "transient", "target": "stmt2"},
    {"source": "stmt2", "target": "commit"},
    {"source": "commit", "target": "ok", "label": "consistent", "style": "thick"},
    {"source": "commit", "target": "fail", "label": "still violated", "style": "dotted"}
  ]
}
```

## Migration patterns: adding an FK without long locks

`ALTER TABLE ... ADD FOREIGN KEY` takes a `SHARE ROW EXCLUSIVE` lock on **both** tables and validates every existing row before it returns — on a 100M-row table that can mean minutes of downtime. The safe pattern is two-phase: add the constraint as `NOT VALID` (skip the validation step, lock briefly), then validate it later in a separate, lock-light command.

```sql
-- Phase 1: add the constraint immediately, no row scan, brief lock.
ALTER TABLE orders
  ADD CONSTRAINT orders_user_fk
  FOREIGN KEY (user_id) REFERENCES users(id)
  NOT VALID;

-- Phase 2: validate existing rows. Only takes a SHARE UPDATE EXCLUSIVE lock
-- on the child table — concurrent reads and writes continue.
ALTER TABLE orders VALIDATE CONSTRAINT orders_user_fk;
```

After Phase 1 the constraint is **enforced for all new writes** but the historical data has not been verified. Phase 2 verifies everything; once it succeeds, the constraint is fully valid and indistinguishable from one created with both steps fused.

```xyflow
{
  "direction": "TD",
  "nodes": [
    {"id": "p1", "label": "Phase 1\nADD ... NOT VALID\n(brief AccessExclusive lock)", "shape": "stadium"},
    {"id": "writes", "label": "new writes enforced\nimmediately", "shape": "rect"},
    {"id": "audit", "label": "any orphans in\nhistorical rows?", "shape": "diamond"},
    {"id": "fix", "label": "clean up orphans\n(batched UPDATE/DELETE)", "shape": "rect"},
    {"id": "p2", "label": "Phase 2\nVALIDATE CONSTRAINT\n(ShareUpdateExclusive only —\nreads & writes continue)", "shape": "rect"},
    {"id": "done", "label": "fully enforced FK", "shape": "circle"}
  ],
  "edges": [
    {"source": "p1", "target": "writes", "label": "from now on", "style": "thick"},
    {"source": "p1", "target": "audit"},
    {"source": "audit", "target": "fix", "label": "yes", "style": "dotted"},
    {"source": "fix", "target": "audit", "label": "re-check"},
    {"source": "audit", "target": "p2", "label": "no", "style": "thick"},
    {"source": "p2", "target": "done", "style": "thick"}
  ]
}
```

If Phase 2 reports a violation, the constraint stays `NOT VALID`; clean up the offending rows and retry. This pattern is standard in zero-downtime migration playbooks (gh-ost, pg-osc, Drizzle's manual migrations, etc.).

## Drizzle ORM example

Foreign keys translate cleanly into Drizzle's TypeScript schema DSL. The cascade behavior is explicit and visible at the call site, which is where you want it.

```typescript
import { pgTable, uuid, text, numeric, timestamp } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id:    uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
});

export const orders = pgTable("orders", {
  id:        uuid("id").primaryKey().defaultRandom(),
  userId:    uuid("user_id")
              .notNull()
              .references(() => users.id, { onDelete: "cascade" }),
  total:     numeric("total", { precision: 10, scale: 2 }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
```

A transaction that exercises the constraint:

```typescript
import { eq } from "drizzle-orm";
import { db } from "./db";
import { users, orders } from "./schema";

await db.transaction(async (tx) => {
  // Inserting an order for a non-existent user throws here — FK violation.
  await tx.insert(orders).values({
    userId: "00000000-0000-0000-0000-000000000000",
    total:  "9.99",
  });
});

// Deleting a user cascades to all of their orders in one statement.
await db.delete(users).where(eq(users.id, someUserId));
```

The `onDelete: "cascade"` lives in the schema file, version-controlled with the rest of the data model — review-time scrutiny is built in.

## Pitfalls

### Missing FK index

Already covered above, but it bears repeating because the symptom is invisible until production: parent deletes get progressively slower as child tables grow. Any new FK should land in the same migration as `CREATE INDEX ... ON child_table (fk_col)`.

### Cascade on high-fanout tables

`ON DELETE CASCADE` on a table that has millions of children turns a "delete one user" operation into a bulk delete that rewrites huge swaths of your database, holds locks for minutes, and can blow up replication lag. For high-fanout relationships, prefer `ON DELETE RESTRICT` plus an explicit, batched application-level cleanup job — or a soft-delete pattern where the parent is marked deleted and a background process tombstones children.

### Cross-database / cross-service FKs

You cannot declare a foreign key across separate databases. In a [microservices](/microservices) architecture where each service owns its own database, FK enforcement is impossible at the schema layer — the relationship lives only in your application code or in eventual-consistency reconciliation jobs. Recognize that this is a real loss of integrity, not a non-issue. Mitigations include outbox patterns, periodic referential-integrity audits, and very careful API design around delete semantics.

### ORM defaults without an explicit ON DELETE

Many ORMs default to `NO ACTION` if you don't specify a cascade behavior. That's safe for inserts but means parent deletes throw at runtime, which surprises code that assumed a delete would "just work." Make `onDelete` an explicit decision in every reference — never a default.

```xyflow
{
  "direction": "TD",
  "nodes": [
    {"id": "owned", "label": "is the child\nowned by parent?", "shape": "diamond"},
    {"id": "cascade", "label": "CASCADE\ncomments, sessions,\norder_items", "shape": "circle"},
    {"id": "optional", "label": "is the link\noptional?", "shape": "diamond"},
    {"id": "sentinel", "label": "is there a\nsentinel default row?", "shape": "diamond"},
    {"id": "setnull", "label": "SET NULL\nticket assignee,\nsoft references", "shape": "circle"},
    {"id": "setdefault", "label": "SET DEFAULT\ncategory fallback,\n\"Uncategorized\"", "shape": "circle"},
    {"id": "restrict", "label": "RESTRICT\nfinancial records,\naudit logs", "shape": "circle"}
  ],
  "edges": [
    {"source": "owned", "target": "cascade", "label": "yes", "style": "thick"},
    {"source": "owned", "target": "optional", "label": "no"},
    {"source": "optional", "target": "sentinel", "label": "yes"},
    {"source": "optional", "target": "restrict", "label": "no", "style": "thick"},
    {"source": "sentinel", "target": "setdefault", "label": "yes"},
    {"source": "sentinel", "target": "setnull", "label": "no", "style": "thick"}
  ]
}
```

## When NOT to use foreign keys

Foreign keys are not free — they cost a lookup on every relevant write, and they constrain how you can shard or replicate data. There are legitimate cases for skipping them:

- **Sharded tables.** If a parent and child can live on different shards, the FK becomes a distributed transaction problem. Most sharded systems (Citus, Vitess) either disable FKs entirely or restrict them to within-shard relationships only.
- **Append-only event logs.** A `clicks` or `events` table written at extreme volume usually doesn't benefit from referential checks — you index on the join key for query speed and tolerate the occasional dangling reference.
- **Eventual-consistency systems.** When the parent and child are owned by separate services and synced by event streams, an FK check at write time would create coupling the architecture explicitly avoids.
- **Bulk-load pipelines.** ETL into staging tables typically drops FKs, loads, then validates and re-adds — checking constraints per row during a 10M-row COPY destroys throughput.

Each of these is a real tradeoff, not a free pass: skipping FKs means the integrity invariant moves into application code or batch jobs, which is strictly more failure-prone than a `REFERENCES` clause. Default to FKs and justify their absence, not the other way around.

```xyflow
{
  "direction": "TD",
  "nodes": [
    {"id": "skip", "label": "skipping FK\nbecause...", "shape": "diamond"},
    {"id": "shard", "label": "sharded across nodes\n(Citus, Vitess)", "shape": "rect"},
    {"id": "events", "label": "high-volume event log\n(clicks, telemetry)", "shape": "rect"},
    {"id": "services", "label": "cross-service boundary\n(separate DBs)", "shape": "rect"},
    {"id": "etl", "label": "bulk-load staging\n(drop → COPY → re-add)", "shape": "rect"},
    {"id": "reconcile", "label": "integrity moves to:\n• app-level checks\n• reconciliation jobs\n• outbox patterns", "shape": "circle"}
  ],
  "edges": [
    {"source": "skip", "target": "shard"},
    {"source": "skip", "target": "events"},
    {"source": "skip", "target": "services"},
    {"source": "skip", "target": "etl"},
    {"source": "shard", "target": "reconcile", "style": "dotted"},
    {"source": "events", "target": "reconcile", "style": "dotted"},
    {"source": "services", "target": "reconcile", "style": "dotted"},
    {"source": "etl", "target": "reconcile", "style": "dotted"}
  ]
}
```

## Further reading

- [ACID Properties](/acid-properties) — how FK checks compose with transactions and isolation.
- [PostgreSQL JOINs](/postgresql-joins) — querying across the relationships FKs guarantee.
- [Microservices](/microservices) — the architectural reasons cross-service FKs disappear.
