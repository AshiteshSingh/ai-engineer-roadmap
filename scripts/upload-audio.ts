/**
 * Upload an MP3 + AudioMeta JSON to R2 for a given slug.
 * Usage: tsx --env-file=.env.local scripts/upload-audio.ts <slug>
 */
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";

const slug = process.argv[2];
if (!slug) {
  console.error("Usage: tsx scripts/upload-audio.ts <slug>");
  process.exit(1);
}

const accountId = process.env.R2_ACCOUNT_ID!;
const accessKeyId = process.env.R2_ACCESS_KEY_ID!;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY!;
const bucket = process.env.R2_BUCKET_NAME || "knowledge";
const domain = process.env.R2_PUBLIC_DOMAIN;

if (!accountId || !accessKeyId || !secretAccessKey) {
  console.error("Missing R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY");
  process.exit(1);
}

const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId, secretAccessKey },
});

async function upload(key: string, body: Buffer, contentType: string) {
  await r2.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
  const url = domain ? `https://${domain}/${key}` : `https://${accountId}.r2.cloudflarestorage.com/${bucket}/${key}`;
  console.log(`✓ ${key} (${(body.length / 1_000_000).toFixed(1)} MB)\n  → ${url}`);
}

const dataDir = join(__dirname, "..", "data");
// Repo root → crates/tts/knowledge-output/<slug>/ holds the per-chapter pieces.
const piecesDir = join(
  __dirname,
  "..",
  "..",
  "..",
  "crates",
  "tts",
  "knowledge-output",
  slug,
);

const mp3Path = join(dataDir, `${slug}.mp3`);
const jsonPath = join(dataDir, `${slug}.json`);

async function main() {
  const json = readFileSync(jsonPath);

  console.log(`Uploading ${slug} to R2 bucket "${bucket}"...`);
  // Per-chapter (no-stitch) guides: push every piece from
  // crates/tts/knowledge-output/<slug>/NN.mp3 → knowledge/<slug>/NN.mp3.
  // (This is also the recovery path when `knowledge_tts --upload` could not
  // reach R2 — re-uses these working creds, no re-synthesis.)
  if (existsSync(piecesDir)) {
    const pieces = readdirSync(piecesDir)
      .filter((f) => f.endsWith(".mp3"))
      .sort();
    for (const f of pieces) {
      await upload(`knowledge/${slug}/${f}`, readFileSync(join(piecesDir, f)), "audio/mpeg");
    }
    console.log(`  ${pieces.length} per-chapter pieces uploaded`);
  } else if (existsSync(mp3Path)) {
    // Legacy stitched guide — single MP3.
    await upload(`knowledge/${slug}.mp3`, readFileSync(mp3Path), "audio/mpeg");
  } else {
    console.log(`  (no pieces dir and no ${slug}.mp3 — JSON only)`);
  }
  await upload(`knowledge/${slug}.json`, json, "application/json");
  console.log("Done.");
}

main().catch((e) => { console.error(e); process.exit(1); });
