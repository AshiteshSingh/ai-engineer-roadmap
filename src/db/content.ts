import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as contentSchema from "./content-schema";
import path from "path";
import fs from "fs";

function resolveDbPath(): string {
  if (process.env.CONTENT_DB_PATH) return process.env.CONTENT_DB_PATH;

  // Local dev: data/knowledge.db relative to cwd (cwd = apps/knowledge)
  const cwdPath = path.join(process.cwd(), "data", "knowledge.db");
  if (fs.existsSync(cwdPath)) return cwdPath;

  // Vercel monorepo: outputFileTracingRoot is monorepo root, so cwd = monorepo root
  const monoPath = path.join(process.cwd(), "apps", "knowledge", "data", "knowledge.db");
  if (fs.existsSync(monoPath)) return monoPath;

  // Vercel serverless: next to compiled output
  const dirPath = path.join(__dirname, "data", "knowledge.db");
  if (fs.existsSync(dirPath)) return dirPath;

  // Fallback
  return cwdPath;
}

let _db: BetterSQLite3Database<typeof contentSchema> | null = null;

export function getContentDb() {
  if (!_db) {
    const dbPath = resolveDbPath();
    const isVercel = !!process.env.VERCEL;
    const sqlite = new Database(dbPath, isVercel ? { readonly: true } : undefined);
    if (!isVercel) {
      sqlite.pragma("journal_mode = WAL");
      sqlite.pragma("synchronous = normal");
    }
    sqlite.pragma("foreign_keys = ON");
    _db = drizzle(sqlite, { schema: contentSchema });
  }
  return _db;
}

export const contentDb = new Proxy(
  {} as BetterSQLite3Database<typeof contentSchema>,
  {
    get(_target, prop) {
      return (getContentDb() as unknown as Record<string | symbol, unknown>)[
        prop
      ];
    },
  },
);
