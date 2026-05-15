import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/content-schema.ts",
  out: "./drizzle-content",
  dialect: "sqlite",
  dbCredentials: {
    url: process.env.CONTENT_DB_PATH || "./data/knowledge.db",
  },
});
