CREATE TYPE "public"."application_status" AS ENUM('saved', 'applied', 'interviewing', 'offer', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."concept_type" AS ENUM('topic', 'skill', 'competency', 'technique', 'theory', 'tool');--> statement-breakpoint
CREATE TYPE "public"."edge_type" AS ENUM('prerequisite', 'related', 'part_of', 'builds_on', 'contrasts_with', 'applies_to');--> statement-breakpoint
CREATE TYPE "public"."interaction_type" AS ENUM('view', 'read_start', 'read_complete', 'bookmark', 'highlight', 'search', 'concept_click', 'nav_next', 'nav_prev');--> statement-breakpoint
CREATE TYPE "public"."mastery_level" AS ENUM('novice', 'beginner', 'intermediate', 'proficient', 'expert');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytics_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"session_id" text,
	"event_name" text NOT NULL,
	"event_category" text NOT NULL,
	"lesson_id" uuid,
	"properties" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "application_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"slug" text NOT NULL,
	"company" text NOT NULL,
	"position" text NOT NULL,
	"url" text,
	"status" "application_status" DEFAULT 'saved' NOT NULL,
	"notes" text,
	"job_description" text,
	"ai_interview_questions" text,
	"ai_tech_stack" text,
	"tech_dismissed_tags" text,
	"public" boolean DEFAULT false NOT NULL,
	"applied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"icon" text NOT NULL,
	"description" text NOT NULL,
	"gradient_from" text NOT NULL,
	"gradient_to" text NOT NULL,
	"sort_order" integer NOT NULL,
	"lesson_range_lo" integer NOT NULL,
	"lesson_range_hi" integer NOT NULL,
	CONSTRAINT "categories_name_unique" UNIQUE("name"),
	CONSTRAINT "categories_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" text NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "concept_edges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"target_id" uuid NOT NULL,
	"edge_type" "edge_type" NOT NULL,
	"weight" real DEFAULT 1 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "concept_embeddings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"concept_id" uuid NOT NULL,
	"content" text NOT NULL,
	"embedding" vector(1024) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "concept_embeddings_concept_id_unique" UNIQUE("concept_id")
);
--> statement-breakpoint
CREATE TABLE "concepts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"concept_type" "concept_type" DEFAULT 'topic' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "concepts_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "course_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_id" uuid NOT NULL,
	"pedagogy_score" integer,
	"technical_accuracy_score" integer,
	"content_depth_score" integer,
	"practical_application_score" integer,
	"instructor_clarity_score" integer,
	"curriculum_fit_score" integer,
	"prerequisites_score" integer,
	"ai_domain_relevance_score" integer,
	"community_health_score" integer,
	"value_proposition_score" integer,
	"aggregate_score" real,
	"verdict" text,
	"summary" text,
	"expert_details" jsonb,
	"model_version" text DEFAULT 'deepseek-chat' NOT NULL,
	"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "external_courses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"classcentral_id" integer,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"provider" text NOT NULL,
	"description" text,
	"level" text,
	"rating" real,
	"review_count" integer,
	"duration_hours" real,
	"is_free" boolean DEFAULT true NOT NULL,
	"enrolled" integer,
	"image_url" text,
	"language" text DEFAULT 'English' NOT NULL,
	"topic_group" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "external_courses_classcentral_id_unique" UNIQUE("classcentral_id"),
	CONSTRAINT "external_courses_url_unique" UNIQUE("url")
);
--> statement-breakpoint
CREATE TABLE "interaction_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"concept_id" uuid,
	"lesson_id" uuid,
	"section_id" uuid,
	"interaction_type" "interaction_type" NOT NULL,
	"is_correct" boolean,
	"response_time_ms" integer,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"concept_id" uuid NOT NULL,
	"p_mastery" real DEFAULT 0 NOT NULL,
	"p_transit" real DEFAULT 0.1 NOT NULL,
	"p_slip" real DEFAULT 0.1 NOT NULL,
	"p_guess" real DEFAULT 0.2 NOT NULL,
	"total_interactions" integer DEFAULT 0 NOT NULL,
	"correct_interactions" integer DEFAULT 0 NOT NULL,
	"mastery_level" "mastery_level" DEFAULT 'novice' NOT NULL,
	"last_interaction_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lesson_concepts" (
	"lesson_id" uuid NOT NULL,
	"concept_id" uuid NOT NULL,
	"relevance" real DEFAULT 1 NOT NULL,
	CONSTRAINT "lesson_concepts_lesson_id_concept_id_pk" PRIMARY KEY("lesson_id","concept_id")
);
--> statement-breakpoint
CREATE TABLE "lesson_courses" (
	"lesson_slug" text NOT NULL,
	"course_id" uuid NOT NULL,
	"relevance" real DEFAULT 1 NOT NULL,
	CONSTRAINT "lesson_courses_lesson_slug_course_id_pk" PRIMARY KEY("lesson_slug","course_id")
);
--> statement-breakpoint
CREATE TABLE "lesson_embeddings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lesson_id" uuid NOT NULL,
	"content" text NOT NULL,
	"embedding" vector(1024) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lesson_embeddings_lesson_id_unique" UNIQUE("lesson_id")
);
--> statement-breakpoint
CREATE TABLE "lesson_sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lesson_id" uuid NOT NULL,
	"heading" text NOT NULL,
	"heading_level" integer DEFAULT 2 NOT NULL,
	"content" text NOT NULL,
	"section_order" integer NOT NULL,
	"word_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lessons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"category_id" integer NOT NULL,
	"word_count" integer DEFAULT 0 NOT NULL,
	"reading_time_min" integer DEFAULT 1 NOT NULL,
	"content" text NOT NULL,
	"summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lessons_slug_unique" UNIQUE("slug"),
	CONSTRAINT "lessons_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "resumes" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"filename" text,
	"raw_text" text,
	"extracted_skills" text,
	"taxonomy_version" text,
	"created_at" text,
	"updated_at" text
);
--> statement-breakpoint
CREATE TABLE "section_embeddings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"section_id" uuid NOT NULL,
	"lesson_id" uuid NOT NULL,
	"content" text NOT NULL,
	"embedding" vector(1024) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "section_embeddings_section_id_unique" UNIQUE("section_id")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "user_lesson_interactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"lesson_id" uuid NOT NULL,
	"read_progress" real DEFAULT 0 NOT NULL,
	"rating" integer,
	"bookmarked" boolean DEFAULT false NOT NULL,
	"time_spent_sec" integer DEFAULT 0 NOT NULL,
	"first_viewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_viewed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"display_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_notes" ADD CONSTRAINT "application_notes_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept_edges" ADD CONSTRAINT "concept_edges_source_id_concepts_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."concepts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept_edges" ADD CONSTRAINT "concept_edges_target_id_concepts_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."concepts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept_embeddings" ADD CONSTRAINT "concept_embeddings_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concepts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_reviews" ADD CONSTRAINT "course_reviews_course_id_external_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."external_courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interaction_events" ADD CONSTRAINT "interaction_events_user_id_user_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interaction_events" ADD CONSTRAINT "interaction_events_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concepts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interaction_events" ADD CONSTRAINT "interaction_events_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interaction_events" ADD CONSTRAINT "interaction_events_section_id_lesson_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."lesson_sections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_states" ADD CONSTRAINT "knowledge_states_user_id_user_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_states" ADD CONSTRAINT "knowledge_states_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concepts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_concepts" ADD CONSTRAINT "lesson_concepts_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_concepts" ADD CONSTRAINT "lesson_concepts_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concepts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_courses" ADD CONSTRAINT "lesson_courses_course_id_external_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."external_courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_embeddings" ADD CONSTRAINT "lesson_embeddings_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_sections" ADD CONSTRAINT "lesson_sections_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "section_embeddings" ADD CONSTRAINT "section_embeddings_section_id_lesson_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."lesson_sections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "section_embeddings" ADD CONSTRAINT "section_embeddings_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_lesson_interactions" ADD CONSTRAINT "user_lesson_interactions_user_id_user_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_lesson_interactions" ADD CONSTRAINT "user_lesson_interactions_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "analytics_events_user_time_idx" ON "analytics_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "analytics_events_name_time_idx" ON "analytics_events" USING btree ("event_name","created_at");--> statement-breakpoint
CREATE INDEX "analytics_events_lesson_time_idx" ON "analytics_events" USING btree ("lesson_id","created_at");--> statement-breakpoint
CREATE INDEX "analytics_events_session_idx" ON "analytics_events" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX "application_notes_app_idx" ON "application_notes" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "applications_user_idx" ON "applications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "applications_status_idx" ON "applications" USING btree ("user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "applications_slug_idx" ON "applications" USING btree ("user_id","slug");--> statement-breakpoint
CREATE INDEX "chat_messages_thread_time_idx" ON "chat_messages" USING btree ("thread_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "concept_edges_source_target_type_idx" ON "concept_edges" USING btree ("source_id","target_id","edge_type");--> statement-breakpoint
CREATE INDEX "concept_edges_source_idx" ON "concept_edges" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "concept_edges_target_idx" ON "concept_edges" USING btree ("target_id");--> statement-breakpoint
CREATE INDEX "concept_edges_type_idx" ON "concept_edges" USING btree ("edge_type");--> statement-breakpoint
CREATE INDEX "concepts_type_idx" ON "concepts" USING btree ("concept_type");--> statement-breakpoint
CREATE INDEX "course_reviews_course_idx" ON "course_reviews" USING btree ("course_id");--> statement-breakpoint
CREATE UNIQUE INDEX "course_reviews_course_unique" ON "course_reviews" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "external_courses_provider_idx" ON "external_courses" USING btree ("provider");--> statement-breakpoint
CREATE INDEX "interaction_events_user_time_idx" ON "interaction_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "interaction_events_user_concept_idx" ON "interaction_events" USING btree ("user_id","concept_id","created_at");--> statement-breakpoint
CREATE INDEX "interaction_events_lesson_idx" ON "interaction_events" USING btree ("lesson_id");--> statement-breakpoint
CREATE INDEX "interaction_events_type_idx" ON "interaction_events" USING btree ("interaction_type");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_states_user_concept_idx" ON "knowledge_states" USING btree ("user_id","concept_id");--> statement-breakpoint
CREATE INDEX "knowledge_states_user_idx" ON "knowledge_states" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "knowledge_states_concept_idx" ON "knowledge_states" USING btree ("concept_id");--> statement-breakpoint
CREATE INDEX "knowledge_states_mastery_idx" ON "knowledge_states" USING btree ("user_id","mastery_level");--> statement-breakpoint
CREATE INDEX "lesson_courses_slug_idx" ON "lesson_courses" USING btree ("lesson_slug");--> statement-breakpoint
CREATE INDEX "lesson_sections_lesson_idx" ON "lesson_sections" USING btree ("lesson_id");--> statement-breakpoint
CREATE INDEX "lessons_category_idx" ON "lessons" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "lessons_number_idx" ON "lessons" USING btree ("number");--> statement-breakpoint
CREATE UNIQUE INDEX "resumes_user_id_unique" ON "resumes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "resumes_user_id_idx" ON "resumes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "section_embeddings_lesson_idx" ON "section_embeddings" USING btree ("lesson_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_lesson_interactions_user_lesson_idx" ON "user_lesson_interactions" USING btree ("user_id","lesson_id");--> statement-breakpoint
CREATE INDEX "user_lesson_interactions_user_idx" ON "user_lesson_interactions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_lesson_interactions_lesson_idx" ON "user_lesson_interactions" USING btree ("lesson_id");