-- Coding Problems (LeetCode-style)

DO $$ BEGIN
  CREATE TYPE "problem_difficulty" AS ENUM ('easy', 'medium', 'hard');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "submission_status" AS ENUM ('passed', 'failed', 'error', 'timeout');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "problems" (
  "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "slug"        text UNIQUE NOT NULL,
  "title"       text NOT NULL,
  "difficulty"  "problem_difficulty" NOT NULL DEFAULT 'easy',
  "prompt"      text NOT NULL,
  "starter_js"  text NOT NULL,
  "starter_ts"  text NOT NULL,
  "test_cases"  jsonb NOT NULL DEFAULT '[]'::jsonb,
  "entrypoint"  text NOT NULL,
  "tags"        jsonb NOT NULL DEFAULT '[]'::jsonb,
  "sort_order"  integer NOT NULL DEFAULT 0,
  "created_at"  timestamptz NOT NULL DEFAULT now(),
  "updated_at"  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "problems_difficulty_idx" ON "problems" ("difficulty");
CREATE INDEX IF NOT EXISTS "problems_sort_idx"       ON "problems" ("sort_order");

CREATE TABLE IF NOT EXISTS "problem_submissions" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "problem_id"    uuid NOT NULL REFERENCES "problems"("id") ON DELETE CASCADE,
  "user_id"       text NOT NULL,
  "language"      text NOT NULL,
  "code"          text NOT NULL,
  "status"        "submission_status" NOT NULL,
  "passed_count"  integer NOT NULL DEFAULT 0,
  "total_count"   integer NOT NULL DEFAULT 0,
  "runtime_ms"    real,
  "error_message" text,
  "created_at"    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "problem_submissions_user_idx"
  ON "problem_submissions" ("user_id", "created_at");
CREATE INDEX IF NOT EXISTS "problem_submissions_problem_idx"
  ON "problem_submissions" ("problem_id", "created_at");
CREATE INDEX IF NOT EXISTS "problem_submissions_user_problem_idx"
  ON "problem_submissions" ("user_id", "problem_id", "status");
