import { defineConfig } from "drizzle-kit";

// The app's relational data lives in Cloudflare D1 (SQLite). drizzle-kit talks
// to D1 over the HTTP API (driver: "d1-http") using the same credentials the
// runtime d1Query helper uses. Generated migrations go to ./drizzle-d1 (the
// legacy Postgres migrations under ./drizzle are kept for history only).
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle-d1",
  dialect: "sqlite",
  driver: "d1-http",
  dbCredentials: {
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID!,
    databaseId: process.env.CLOUDFLARE_AUDIO_D1_ID!,
    token: process.env.CLOUDFLARE_D1_API_TOKEN!,
  },
});
