/**
 * Unit tests for the static interview-prep seed loader (lib/app-prep-seed.ts).
 *
 * Pure: reads only the committed data/app-prep/*.json artifact — no DB, no
 * network, no env. This is the decision logic behind the public /prep render
 * (the API GET fallback and the prep layout guard both just delegate to
 * `getAppPrepSeed`), so covering it here covers both wirings.
 *
 *   pnpm test:app-prep
 *
 * Exits 0 on success, 1 on any failure. Bespoke runner, matching
 * scripts/test-backend-e2e.ts — deliberately no vitest/jest dep.
 */

import { getAppPrepSeed } from "../lib/app-prep-seed";
import type { AppData } from "../components/app-detail/types";

const ECB_SLUG = "european-central-bank-ssm-cockpit-developer";
const VALID_CATEGORIES = new Set([
  "Databases & Storage",
  "Backend Frameworks",
  "Frontend Frameworks",
  "Cloud & DevOps",
  "Languages",
  "Testing & Quality",
  "API & Communication",
]);
const APP_DATA_KEYS = [
  "id",
  "slug",
  "company",
  "position",
  "url",
  "status",
  "notes",
  "jobDescription",
  "interviewQuestions",
  "ownerPrep",
  "techStack",
  "interviewers",
  "techDismissedTags",
  "appliedAt",
  "createdAt",
  "updatedAt",
].sort();

let passed = 0;
let failed = 0;
const failures: Array<{ name: string; err: string }> = [];

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function assertEq<T>(actual: T, expected: T, msg: string): void {
  if (actual !== expected) {
    throw new Error(
      `${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

function check(name: string, fn: () => void): void {
  process.stdout.write(`  ${name} ... `);
  try {
    fn();
    console.log("OK");
    passed++;
  } catch (err) {
    console.log("FAIL");
    failed++;
    failures.push({
      name,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

check("ecb slug resolves to an AppData-shaped object", () => {
  const app = getAppPrepSeed(ECB_SLUG);
  assert(app, "expected a seed for the ECB slug");
  assertEq(Object.keys(app).sort().join(","), APP_DATA_KEYS.join(","), "keys");
  assertEq(app.id, app.slug, "id should mirror slug");
  assertEq(app.slug, ECB_SLUG, "slug");
  assertEq(app.company, "European Central Bank", "company");
  assertEq(app.status, "saved", "status");
});

check("interview questions + tech stack are usable", () => {
  const app = getAppPrepSeed(ECB_SLUG) as AppData;
  assert(
    typeof app.interviewQuestions === "string" &&
      app.interviewQuestions.length > 500,
    "interviewQuestions should be substantial markdown",
  );
  assert(
    typeof app.techStack === "string",
    "techStack must be a JSON string (matches the DB column)",
  );
  const techs = JSON.parse(app.techStack as string) as Array<{
    tag: string;
    label: string;
    category: string;
    relevance: string;
  }>;
  assert(Array.isArray(techs) && techs.length > 0, "tech stack non-empty");
  for (const t of techs) {
    assert(t.tag && t.label, `tech missing tag/label: ${JSON.stringify(t)}`);
    assert(
      VALID_CATEGORIES.has(t.category),
      `invalid category: ${t.category}`,
    );
    assert(
      t.relevance === "primary" || t.relevance === "secondary",
      `invalid relevance: ${t.relevance}`,
    );
  }
});

check("reshape fills DB-absent fields as null + timestamps from generatedAt", () => {
  const app = getAppPrepSeed(ECB_SLUG) as AppData;
  assertEq(app.notes, null, "notes");
  assertEq(app.interviewers, null, "interviewers");
  assertEq(app.techDismissedTags, null, "techDismissedTags");
  assertEq(app.appliedAt, null, "appliedAt");
  assertEq(app.createdAt, app.updatedAt, "createdAt === updatedAt");
  assert(
    !Number.isNaN(Date.parse(app.createdAt)),
    `createdAt not a valid date: ${app.createdAt}`,
  );
});

check("UUIDs return null (owner DB / detail-page path is untouched)", () => {
  assertEq(
    getAppPrepSeed("0f9b1c2d-3e4f-5a6b-7c8d-9e0f1a2b3c4d"),
    null,
    "uuid",
  );
});

check("unknown but well-formed slug returns null (stays owner-gated)", () => {
  assertEq(getAppPrepSeed("acme-widget-engineer"), null, "unknown slug");
});

check("path-traversal / malformed inputs return null", () => {
  for (const bad of [
    "../../etc/passwd",
    "..%2f..",
    "a/b",
    "Foo", // uppercase fails the kebab guard
    "-leading",
    "",
    " ",
    "slug.with.dots",
  ]) {
    assertEq(getAppPrepSeed(bad), null, `must reject ${JSON.stringify(bad)}`);
  }
});

check("repeated lookups are cached (stable object identity)", () => {
  const a = getAppPrepSeed(ECB_SLUG);
  const b = getAppPrepSeed(ECB_SLUG);
  assert(a === b, "expected the same cached reference across calls");
});

console.log();
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log();
  for (const { name, err } of failures) {
    console.log(`  ✘ ${name}`);
    console.log(`    ${err}`);
  }
  process.exit(1);
}
