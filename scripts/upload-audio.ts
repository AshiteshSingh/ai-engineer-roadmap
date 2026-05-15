/**
 * Upload an MP3 + AudioMeta JSON to R2 for a given slug.
 * Usage: tsx --env-file=.env.local scripts/upload-audio.ts <slug>
 */
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { readFileSync } from "fs";
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

const mp3Path = join(dataDir, `${slug}.mp3`);
const jsonPath = join(dataDir, `${slug}.json`);

async function main() {
  const mp3 = readFileSync(mp3Path);
  const json = readFileSync(jsonPath);

  console.log(`Uploading ${slug} to R2 bucket "${bucket}"...`);
  await upload(`knowledge/${slug}.mp3`, mp3, "audio/mpeg");
  await upload(`knowledge/${slug}.json`, json, "application/json");
  console.log("Done.");
}

main().catch((e) => { console.error(e); process.exit(1); });
