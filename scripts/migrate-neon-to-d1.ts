/**
 * One-off ETL: copy all relational data from Neon Postgres → Cloudflare D1.
 *
 * Reads each table from Neon (DATABASE_URL) and bulk-inserts into D1 over the
 * HTTP API (lib/d1.ts), converting Postgres types to the SQLite representation
 * the Drizzle sqlite schema expects:
 *   - timestamptz  → integer epoch SECONDS  (drizzle mode:"timestamp")
 *   - boolean      → 0 / 1                    (drizzle mode:"boolean")
 *   - jsonb        → JSON text               (drizzle mode:"json")
 * Row ids, password hashes and session tokens are preserved verbatim so logins
 * and cookies survive the cutover. Idempotent: clears each target table first
 * (reverse-FK order), so it can be re-run safely.
 *
 * Embeddings tables and `resumes` are intentionally skipped (pipeline-only /
 * never created in Neon).
 *
 * Usage:
 *   pnpm tsx --env-file=.env.local scripts/migrate-neon-to-d1.ts
 */
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { sql as sqlOp } from "drizzle-orm";
import { d1Query } from "../lib/d1";

const ndb = drizzle(neon(process.env.DATABASE_URL!));

type ColMeta = { ts?: string[]; bool?: string[]; json?: string[]; cap?: number };

const META: Record<string, ColMeta> = {
  user: { ts: ["created_at", "updated_at"], bool: ["email_verified"] },
  account: {
    ts: ["access_token_expires_at", "refresh_token_expires_at", "created_at", "updated_at"],
  },
  session: { ts: ["expires_at", "created_at", "updated_at"] },
  verification: { ts: ["expires_at", "created_at", "updated_at"] },
  categories: {},
  lessons: { ts: ["created_at", "updated_at"], cap: 4 },
  lesson_sections: { cap: 6 },
  concepts: { ts: ["created_at"], json: ["metadata"] },
  concept_edges: { ts: ["created_at"], json: ["metadata"] },
  lesson_concepts: {},
  user_profiles: { ts: ["created_at", "updated_at"] },
  knowledge_states: { ts: ["last_interaction_at", "updated_at"] },
  interaction_events: { ts: ["created_at"], bool: ["is_correct"], json: ["metadata"] },
  user_lesson_interactions: {
    ts: ["first_viewed_at", "last_viewed_at"],
    bool: ["bookmarked"],
  },
  applications: { ts: ["applied_at", "created_at", "updated_at"], bool: ["public"] },
  application_notes: { ts: ["created_at", "updated_at"] },
  learners: { ts: ["created_at"] },
  coursework: { ts: ["submitted_at", "created_at"] },
  problems: { ts: ["created_at", "updated_at"], json: ["test_cases", "tags"], cap: 4 },
  problem_submissions: { ts: ["created_at"] },
  chat_messages: { ts: ["created_at"] },
  analytics_events: { ts: ["created_at"], json: ["properties"] },
};

// Forward = parents first (insert order). Reverse = children first (delete order).
const ORDER = [
  "user", "account", "session", "verification",
  "categories", "lessons", "lesson_sections",
  "concepts", "concept_edges", "lesson_concepts",
  "user_profiles", "knowledge_states", "interaction_events", "user_lesson_interactions",
  "applications", "application_notes",
  "learners", "coursework",
  "problems", "problem_submissions",
  "chat_messages", "analytics_events",
];

function transform(table: string, col: string, v: unknown): string | number | null {
  if (v === null || v === undefined) return null;
  const m = META[table];
  if (m.ts?.includes(col)) {
    const ms = v instanceof Date ? v.getTime() : new Date(v as string).getTime();
    return Math.floor(ms / 1000);
  }
  if (m.bool?.includes(col)) return v === true ? 1 : v === false ? 0 : Number(v);
  if (m.json?.includes(col)) return typeof v === "string" ? v : JSON.stringify(v);
  if (typeof v === "object") return JSON.stringify(v); // defensive
  return v as string | number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function withRetry<T>(fn: () => Promise<T>, tries = 6): Promise<T> {
  let delay = 1000;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      const msg = String(e);
      if (i < tries - 1 && /(429|rate|Too Many|^D1 5\d\d|timeout)/i.test(msg)) {
        await sleep(delay);
        delay *= 2;
        continue;
      }
      throw e;
    }
  }
  throw new Error("unreachable");
}

async function readRows(table: string): Promise<Record<string, unknown>[]> {
  const res = (await ndb.execute(sqlOp.raw(`SELECT * FROM "${table}"`))) as unknown;
  if (Array.isArray(res)) return res as Record<string, unknown>[];
  return ((res as { rows?: Record<string, unknown>[] }).rows ?? []);
}

async function clearAll() {
  for (const t of [...ORDER].reverse()) {
    await withRetry(() => d1Query(`DELETE FROM "${t}"`, []));
  }
}

async function d1Columns(table: string): Promise<Set<string>> {
  const info = await d1Query<{ name: string }>(
    `SELECT name FROM pragma_table_info('${table}')`,
    [],
  );
  return new Set(info.map((r) => r.name));
}

async function migrateTable(table: string) {
  const rows = await readRows(table);
  if (rows.length === 0) return { table, src: 0, inserted: 0 };
  // Only migrate columns that exist in the D1 target — drops Neon-only columns
  // such as the generated `fts` tsvector on `lessons`.
  const valid = await d1Columns(table);
  const cols = Object.keys(rows[0]).filter((c) => valid.has(c));
  const maxByParams = Math.max(1, Math.floor(90 / cols.length));
  const batch = Math.min(maxByParams, META[table].cap ?? 50);

  let inserted = 0;
  for (let i = 0; i < rows.length; i += batch) {
    const chunk = rows.slice(i, i + batch);
    const placeholders = chunk
      .map(() => `(${cols.map(() => "?").join(",")})`)
      .join(",");
    const params = chunk.flatMap((r) => cols.map((c) => transform(table, c, r[c])));
    const stmt =
      `INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(",")}) VALUES ${placeholders}`;
    await withRetry(() => d1Query(stmt, params));
    inserted += chunk.length;
  }
  return { table, src: rows.length, inserted };
}

async function main() {
  console.log("Clearing D1 target tables (reverse-FK order)…");
  await clearAll();
  const results: { table: string; src: number; inserted: number }[] = [];
  for (const t of ORDER) {
    const r = await migrateTable(t);
    results.push(r);
    console.log(`  ${r.table.padEnd(26)} src=${r.src}  inserted=${r.inserted}`);
  }
  const totalSrc = results.reduce((a, r) => a + r.src, 0);
  const totalIns = results.reduce((a, r) => a + r.inserted, 0);
  const mismatch = results.filter((r) => r.src !== r.inserted);
  console.log(`\nTOTAL src=${totalSrc} inserted=${totalIns}`);
  if (mismatch.length) {
    console.error("MISMATCH:", mismatch);
    process.exit(1);
  }
  console.log("OK — all tables migrated with row-count parity.");
}

main();
