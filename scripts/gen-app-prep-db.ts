/**
 * Generate interview prep for an application via the LOCAL Rust knowledge-server
 * and persist it into Neon — the scriptable equivalent of clicking "Generate
 * Prep" on the application detail page (no browser/owner login needed).
 *
 * Why this exists: the DB-backed prep path
 * (POST /api/applications/[id]/prep -> runAppPrep -> Rust app_prep graph) is
 * dead in prod (the LANGGRAPH_*->BACKEND_* env rename was never migrated and no
 * Rust backend is deployed). Locally it works: backend-client defaults
 * BACKEND_URL to http://127.0.0.1:7860 and DATABASE_URL points at the shared
 * Neon — so generating here also fixes the live owner view.
 *
 *   pnpm backend:rust:local            # terminal 1: Rust server on :7860
 *   pnpm prep:db [--slug <slug>] [--user-id <id>]   # terminal 2
 *
 * Default slug: european-central-bank-ssm-cockpit-developer.
 * Exits 0 on success, 1 on any error.
 */

import fs from "fs";
import path from "path";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { applications } from "../src/db/schema";
import { runAppPrep } from "../src/lib/backend-client";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const SLUG = arg("slug") ?? "european-central-bank-ssm-cockpit-developer";
const USER_ID = arg("user-id");

function die(msg: string): never {
  console.error(`✘ ${msg}`);
  process.exit(1);
}

/** Committed Rust artifact's synthesized JD, used when the DB row has none. */
function artifactJobDescription(slug: string): string | null {
  const file = path.join(process.cwd(), "data", "app-prep", `${slug}.json`);
  if (!fs.existsSync(file)) return null;
  try {
    const a = JSON.parse(fs.readFileSync(file, "utf-8")) as {
      jobDescription?: string | null;
    };
    return a.jobDescription?.trim() ? a.jobDescription : null;
  } catch {
    return null;
  }
}

async function main() {
  if (!process.env.DATABASE_URL) die("DATABASE_URL not set (run via `pnpm prep:db`, which loads .env.local).");

  console.log(`→ Resolving applications row for slug="${SLUG}"${USER_ID ? ` user-id=${USER_ID}` : ""}`);
  let rows = await db.select().from(applications).where(eq(applications.slug, SLUG));

  if (rows.length === 0) {
    die(`No applications row for slug "${SLUG}". Create it in the /applications pipeline first.`);
  }
  if (rows.length > 1) {
    if (!USER_ID) {
      console.error(`Multiple rows match slug "${SLUG}" — re-run with --user-id <id>:`);
      for (const r of rows) console.error(`  user-id=${r.userId}  ${r.company} — ${r.position}  (id=${r.id})`);
      process.exit(1);
    }
    rows = rows.filter((r) => r.userId === USER_ID);
    if (rows.length === 0) die(`No row for slug "${SLUG}" with user-id "${USER_ID}".`);
  }
  const row = rows[0];

  const jobDescription =
    (row.jobDescription?.trim() ? row.jobDescription : null) ?? artifactJobDescription(SLUG);
  if (!jobDescription) {
    die(
      `Application has no jobDescription and no data/app-prep/${SLUG}.json fallback. ` +
        `app_prep returns empty on a blank JD — add one first.`,
    );
  }
  const backfillJd = !row.jobDescription?.trim();

  console.log(`  row: id=${row.id} company="${row.company}" position="${row.position}"`);
  console.log(`  jobDescription: ${jobDescription.length} chars${backfillJd ? " (from artifact — will backfill)" : " (from DB row)"}`);
  console.log(`  before: aiInterviewQuestions=${row.aiInterviewQuestions?.length ?? 0} chars, aiTechStack=${row.aiTechStack ? "set" : "null"}`);

  console.log(`→ runAppPrep against local Rust server (BACKEND_URL=${process.env.BACKEND_URL ?? "http://127.0.0.1:7860 (default)"}) …`);
  const result = await runAppPrep({
    appId: row.id,
    jobDescription,
    company: row.company,
    position: row.position,
  });

  const iq = result.interview_questions ?? "";
  const tech = Array.isArray(result.tech_stack) ? result.tech_stack : [];
  if (!iq.trim()) die("Rust app_prep returned empty interview_questions (is the JD substantive? is the server up?).");

  await db
    .update(applications)
    .set({
      aiInterviewQuestions: iq,
      aiTechStack: JSON.stringify(tech),
      ...(backfillJd ? { jobDescription } : {}),
      updatedAt: new Date(),
    })
    .where(eq(applications.id, row.id));

  const [after] = await db
    .select({
      slug: applications.slug,
      id: applications.id,
      iq: applications.aiInterviewQuestions,
      ts: applications.aiTechStack,
    })
    .from(applications)
    .where(eq(applications.id, row.id));

  console.log(`✓ Neon updated: id=${after.id} slug=${after.slug}`);
  console.log(`  after: aiInterviewQuestions=${after.iq?.length ?? 0} chars, aiTechStack=${after.ts ? JSON.parse(after.ts).length + " badges" : "null"}`);
  console.log(`  The owner's live /applications/${after.slug}/prep now renders this generated prep (real DB value wins over the static seed overlay).`);
}

main().catch((e) => {
  console.error("✘ failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
