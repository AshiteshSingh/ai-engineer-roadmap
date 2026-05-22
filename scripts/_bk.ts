import { runD1Backup } from "@ai-apps/db-backup";
async function main() {
  const r = await runD1Backup({
    appName: "knowledge",
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID!,
    databaseId: process.env.CLOUDFLARE_AUDIO_D1_ID!,
    apiToken: process.env.CLOUDFLARE_D1_API_TOKEN!,
    r2: { accountId: process.env.R2_ACCOUNT_ID!, accessKeyId: process.env.R2_ACCESS_KEY_ID!, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!, bucketName: "db-backups" },
    maxDurationMs: 120000, retentionDays: 30,
  });
  console.log(JSON.stringify(r, null, 2));
}
main();
