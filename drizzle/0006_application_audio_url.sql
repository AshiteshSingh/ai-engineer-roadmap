-- Add `audio_url` column to applications for per-application recordings.
-- Consumed by lib/typeform.ts → passed as the `audio_url` hidden field on the
-- private Typeform link surfaced from /applications/{id}.
--
-- Apply directly via Neon MCP (same pattern as 0003/0004/0005 — see those
-- files for the rationale: drizzle journal is out of sync, so hand-written +
-- guarded is the project convention).

ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "audio_url" text;
