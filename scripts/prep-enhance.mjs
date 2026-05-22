import { readFileSync } from "node:fs";

// Load D1 creds from the app .env.local if not already in the environment.
for (const line of readFileSync(
  "/Users/vadimnicolai/Public/ai-apps/apps/ai-engineer-roadmap/.env.local",
  "utf8",
).split("\n")) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const CF_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const D1_ID = process.env.CLOUDFLARE_AUDIO_D1_ID;
const D1_TOKEN = process.env.CLOUDFLARE_D1_API_TOKEN;

async function d1(sql, params = []) {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/d1/database/${D1_ID}/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${D1_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sql, params }),
    },
  );
  const json = await res.json();
  if (!res.ok || !json.success) {
    throw new Error(`D1 error: ${JSON.stringify(json.errors ?? res.status)}`);
  }
  return json.result?.[0]?.results ?? [];
}

const slug = "whiteshield-senior-full-stack-product-engineer";
const enhancement = readFileSync("/tmp/prep-enhance/enhancement.md", "utf8");

const [current] = await d1(
  "SELECT interview_questions FROM applications WHERE slug = ?",
  [slug],
);
if (!current) {
  console.error("row not found");
  process.exit(1);
}

const before = current.interview_questions ?? "";
const tag = "<!-- PROJECT_DEEP_DIVES -->";

let next;
if (before.includes(tag)) {
  next = before.slice(0, before.indexOf(tag)) + tag + "\n" + enhancement;
} else {
  next = before.trimEnd() + "\n\n" + tag + "\n" + enhancement;
}

await d1(
  "UPDATE applications SET interview_questions = ?, updated_at = unixepoch() WHERE slug = ?",
  [next, slug],
);

const [after] = await d1(
  "SELECT length(interview_questions) AS len FROM applications WHERE slug = ?",
  [slug],
);
console.log(`before=${before.length} after=${after.len}`);
