-- Drop the redundant `ai_` prefix from generated/derived columns.
--
-- Applied DIRECTLY to the Neon `applications` DB via the Neon MCP
-- (`run_sql`), NOT through drizzle-kit: this repo's drizzle journal is
-- inconsistent (orphaned 0003/0004, `course_reviews` in snapshots but not
-- in schema.ts) and `drizzle-kit generate/push` would prompt interactively
-- for the renames and risk dropping `course_reviews`. RENAME COLUMN is a
-- metadata-only operation in Postgres — instant, preserves all row data.
--
-- Guarded so it is safe to re-run (no-op if already renamed).

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'applications' AND column_name = 'ai_interview_questions') THEN
    ALTER TABLE "applications" RENAME COLUMN "ai_interview_questions" TO "interview_questions";
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'applications' AND column_name = 'ai_tech_stack') THEN
    ALTER TABLE "applications" RENAME COLUMN "ai_tech_stack" TO "tech_stack";
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'applications' AND column_name = 'ai_interviewers') THEN
    ALTER TABLE "applications" RENAME COLUMN "ai_interviewers" TO "interviewers";
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'applications' AND column_name = 'ai_memorize_categories') THEN
    ALTER TABLE "applications" RENAME COLUMN "ai_memorize_categories" TO "memorize_categories";
  END IF;
  -- Legacy Postgres course_reviews table (live path is SQLite; renamed for
  -- codebase consistency — same Neon DB).
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'course_reviews' AND column_name = 'ai_domain_relevance_score') THEN
    ALTER TABLE "course_reviews" RENAME COLUMN "ai_domain_relevance_score" TO "domain_relevance_score";
  END IF;
END $$;
