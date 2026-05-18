/**
 * Push a committed prep artifact (data/app-prep/<slug>.json) into the Neon
 * `applications` row — the scriptable equivalent of clicking "Generate Prep",
 * but generation-agnostic: it just reads the artifact and writes the DB. The
 * artifact is produced beforehand by either `pnpm prep:loop` (deepseek-loop
 * CLI agent) or `pnpm prep:rust` (gen-app-prep bin).
 *
 * DATABASE_URL points at the shared Neon, so updating the row here also fixes
 * the live owner view (GET /api/applications/[id] returns the owner row first;
 * a non-empty aiInterviewQuestions wins over the static seed overlay).
 *
 *   pnpm prep:loop                                  # 1. generate artifact
 *   pnpm test:app-prep                              # 2. validate (gate)
 *   pnpm prep:db [--slug <slug>] [--user-id <id>]   # 3. artifact -> Neon
 *
 * Default slug: european-central-bank-ssm-cockpit-developer.
 * Exits 0 on success, 1 on any error. Neon is left untouched on validation
 * failure.
 */

import fs from "fs";
import path from "path";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { applications } from "../src/db/schema";

const VALID_CATEGORIES = new Set([
  "Databases & Storage",
  "Backend Frameworks",
  "Frontend Frameworks",
  "Cloud & DevOps",
  "Languages",
  "Testing & Quality",
  "API & Communication",
]);

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

interface PrepArtifact {
  jobDescription?: string | null;
  aiInterviewQuestions?: string | null;
  aiTechStack?: string | null;
}

/** Read + validate the committed artifact. Throws (via die) on bad shape so
 *  Neon is never written from a malformed/LLM-broken file. */
function loadArtifact(slug: string): Required<PrepArtifact> {
  const file = path.join(process.cwd(), "data", "app-prep", `${slug}.json`);
  if (!fs.existsSync(file)) {
    die(`No artifact at data/app-prep/${slug}.json — run \`pnpm prep:loop ${slug}\` first.`);
  }
  let a: PrepArtifact;
  try {
    a = JSON.parse(fs.readFileSync(file, "utf-8")) as PrepArtifact;
  } catch (e) {
    die(`Artifact is not valid JSON: ${e instanceof Error ? e.message : e}`);
  }

  const iq = (a.aiInterviewQuestions ?? "").trim();
  if (iq.length < 200) die(`aiInterviewQuestions too short/empty (${iq.length} chars).`);

  const tsRaw = a.aiTechStack;
  if (typeof tsRaw !== "string" || !tsRaw.trim()) {
    die("aiTechStack must be a non-empty JSON string.");
  }
  let techs: Array<{ category?: string; relevance?: string; tag?: string; label?: string }>;
  try {
    techs = JSON.parse(tsRaw);
  } catch {
    die("aiTechStack is not parseable JSON.");
  }
  if (!Array.isArray(techs) || techs.length === 0) die("aiTechStack must parse to a non-empty array.");
  for (const t of techs) {
    if (!t || !t.tag || !t.label) die(`tech entry missing tag/label: ${JSON.stringify(t)}`);
    if (!VALID_CATEGORIES.has(t.category ?? "")) die(`invalid tech category: ${JSON.stringify(t.category)}`);
    if (t.relevance !== "primary" && t.relevance !== "secondary") {
      die(`invalid relevance: ${JSON.stringify(t.relevance)}`);
    }
  }

  return {
    jobDescription: a.jobDescription?.trim() ? a.jobDescription : "",
    aiInterviewQuestions: a.aiInterviewQuestions as string,
    aiTechStack: tsRaw,
  };
}

async function main() {
  if (!process.env.DATABASE_URL) die("DATABASE_URL not set (run via `pnpm prep:db`, which loads .env.local).");

  const art = loadArtifact(SLUG);
  console.log(`→ Artifact OK: aiInterviewQuestions=${art.aiInterviewQuestions.length} chars, aiTechStack=${JSON.parse(art.aiTechStack).length} badges`);

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

  const backfillJd = !row.jobDescription?.trim() && !!art.jobDescription;

  console.log(`  row: id=${row.id} company="${row.company}" position="${row.position}"`);
  console.log(`  before: aiInterviewQuestions=${row.aiInterviewQuestions?.length ?? 0} chars, aiTechStack=${row.aiTechStack ? "set" : "null"}, jobDescription=${row.jobDescription?.trim() ? "set" : "null"}${backfillJd ? " (will backfill from artifact)" : ""}`);

  await db
    .update(applications)
    .set({
      aiInterviewQuestions: art.aiInterviewQuestions,
      aiTechStack: art.aiTechStack,
      ...(backfillJd ? { jobDescription: art.jobDescription } : {}),
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
