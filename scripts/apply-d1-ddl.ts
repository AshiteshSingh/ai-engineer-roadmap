/**
 * Apply a drizzle-kit-generated SQLite migration to the live Cloudflare D1
 * (over the HTTP API, via lib/d1.ts) one statement at a time. Idempotent:
 * "already exists" errors are skipped so re-runs are safe.
 *
 * Usage:
 *   pnpm tsx --env-file=.env.local scripts/apply-d1-ddl.ts [path/to/migration.sql]
 */
import fs from "fs";
import path from "path";
import { d1Query } from "../lib/d1";

async function main() {
  const file = process.argv[2] || "drizzle-d1/0000_long_psynapse.sql";
  const raw = fs.readFileSync(path.join(process.cwd(), file), "utf8");
  const statements = raw
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);

  let ok = 0;
  let skipped = 0;
  let failed = 0;
  for (const stmt of statements) {
    try {
      await d1Query(stmt, []);
      ok++;
    } catch (e) {
      const msg = String(e);
      if (/already exists/i.test(msg)) {
        skipped++;
      } else {
        failed++;
        console.error("FAIL:", stmt.slice(0, 90).replace(/\s+/g, " "), "\n  ", msg);
      }
    }
  }
  console.log(JSON.stringify({ file, total: statements.length, ok, skipped, failed }));
  if (failed > 0) process.exit(1);
}

main();
