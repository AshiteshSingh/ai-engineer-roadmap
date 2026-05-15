import { NextResponse } from "next/server";
import { runBackup, verifyCronSecret } from "@ai-apps/db-backup";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  const authError = verifyCronSecret(request);
  if (authError) return authError;

  const result = await runBackup({
    appName: "knowledge",
    databaseUrl: process.env.DATABASE_URL!,
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
