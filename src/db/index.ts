import {
  drizzle,
  type SqliteRemoteDatabase,
} from "drizzle-orm/sqlite-proxy";
import { d1Query } from "@/lib/d1";
import * as schema from "./schema";

// The app's relational data lives in Cloudflare D1 (SQLite), reached over the
// D1 HTTP REST API via `d1Query` (see lib/d1.ts). Drizzle's sqlite-proxy driver
// lets us keep the full Drizzle query builder + schema while delegating raw SQL
// execution to that HTTP helper — so every existing call site is unchanged.

type ProxyMethod = "run" | "all" | "values" | "get";

// D1 returns row objects keyed by column name; sqlite-proxy expects positional
// value arrays in SELECT order. D1/SQLite preserve column order in the result
// object, so Object.values() yields the correct positional row.
async function runProxy(
  sql: string,
  params: unknown[],
  method: ProxyMethod,
): Promise<{ rows: unknown[] }> {
  const rows = await d1Query(sql, params as (string | number | null)[]);
  if (method === "get") {
    const first = rows[0] as Record<string, unknown> | undefined;
    return { rows: first ? Object.values(first) : [] };
  }
  return { rows: rows.map((r) => Object.values(r as Record<string, unknown>)) };
}

// Best-effort batch (D1 HTTP has no interactive transaction): run sequentially.
// Used by Better Auth's transactional flows; statements are independent enough
// that sequential execution is acceptable for this app.
async function runBatch(
  queries: { sql: string; params: unknown[]; method: ProxyMethod }[],
): Promise<{ rows: unknown[] }[]> {
  const out: { rows: unknown[] }[] = [];
  for (const q of queries) {
    out.push(await runProxy(q.sql, q.params, q.method));
  }
  return out;
}

let _db: SqliteRemoteDatabase<typeof schema> | null = null;

export function getDb() {
  if (!_db) {
    _db = drizzle(runProxy, runBatch, { schema });
  }
  return _db;
}

// Convenience export — lazily resolves the client on first property access so
// the D1 env vars only need to be present at request time, not import time.
export const db = new Proxy({} as SqliteRemoteDatabase<typeof schema>, {
  get(_target, prop) {
    return (getDb() as unknown as Record<string | symbol, unknown>)[prop];
  },
});
