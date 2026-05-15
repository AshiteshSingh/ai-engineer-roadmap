import { neon } from "@neondatabase/serverless";
import { readFileSync } from "node:fs";

for (const line of readFileSync("/Users/vadimnicolai/Public/ai-apps/apps/knowledge/.env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const sql = neon(process.env.DATABASE_URL);
const slug = "whiteshield-senior-full-stack-product-engineer";
const enhancement = readFileSync("/tmp/prep-enhance/enhancement.md", "utf8");

const [current] = await sql`SELECT ai_interview_questions FROM applications WHERE slug = ${slug}`;
if (!current) {
  console.error("row not found");
  process.exit(1);
}

const before = current.ai_interview_questions ?? "";
const tag = "<!-- PROJECT_DEEP_DIVES -->";

let next;
if (before.includes(tag)) {
  next = before.slice(0, before.indexOf(tag)) + tag + "\n" + enhancement;
} else {
  next = before.trimEnd() + "\n\n" + tag + "\n" + enhancement;
}

await sql`UPDATE applications SET ai_interview_questions = ${next}, updated_at = now() WHERE slug = ${slug}`;

const [after] = await sql`SELECT length(ai_interview_questions) as len FROM applications WHERE slug = ${slug}`;
console.log(`before=${before.length} after=${after.len}`);
