ALTER TABLE "application_notes" ADD COLUMN IF NOT EXISTS "kind" text DEFAULT 'note' NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "application_notes_kind_idx" ON "application_notes" ("application_id","kind");
