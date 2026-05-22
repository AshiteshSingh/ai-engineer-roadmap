import { NextResponse } from "next/server";
import { runD1Backup, verifyCronSecret } from "@ai-apps/db-backup";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  const authError = verifyCronSecret(request);
  if (authError) return authError;

  // The app's data lives in Cloudflare D1 now; back it up as a .sql dump → R2.
  const result = await runD1Backup({
    appName: "knowledge",
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID!,
    databaseId: process.env.CLOUDFLARE_AUDIO_D1_ID!,
    apiToken: process.env.CLOUDFLARE_D1_API_TOKEN!,
    r2: {
      accountId: process.env.R2_ACCOUNT_ID!,
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      bucketName: "db-backups",
    },
    maxDurationMs: 280_000,
    retentionDays: 30,
  });

  return NextResponse.json(result, {
    status: result.status === "complete" ? 200 : 207,
  });
}
