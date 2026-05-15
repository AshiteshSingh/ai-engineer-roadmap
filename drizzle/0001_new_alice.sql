CREATE TABLE "coursework" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"learner_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"file_name" text NOT NULL,
	"file_url" text NOT NULL,
	"file_size" integer NOT NULL,
	"mime_type" text NOT NULL,
	"subject" text,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"age" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "ai_interviewers" text;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "ai_memorize_categories" text;--> statement-breakpoint
ALTER TABLE "coursework" ADD CONSTRAINT "coursework_learner_id_learners_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."learners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "coursework_learner_idx" ON "coursework" USING btree ("learner_id");--> statement-breakpoint
CREATE INDEX "coursework_user_idx" ON "coursework" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "learners_user_idx" ON "learners" USING btree ("user_id");