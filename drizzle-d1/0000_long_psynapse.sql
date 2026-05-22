CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `analytics_events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`session_id` text,
	`event_name` text NOT NULL,
	`event_category` text NOT NULL,
	`lesson_id` text,
	`properties` text NOT NULL,
	`duration_ms` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`lesson_id`) REFERENCES `lessons`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `analytics_events_user_time_idx` ON `analytics_events` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `analytics_events_name_time_idx` ON `analytics_events` (`event_name`,`created_at`);--> statement-breakpoint
CREATE INDEX `analytics_events_lesson_time_idx` ON `analytics_events` (`lesson_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `analytics_events_session_idx` ON `analytics_events` (`session_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `application_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`application_id` text NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`kind` text DEFAULT 'note' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `application_notes_app_idx` ON `application_notes` (`application_id`);--> statement-breakpoint
CREATE INDEX `application_notes_kind_idx` ON `application_notes` (`application_id`,`kind`);--> statement-breakpoint
CREATE TABLE `applications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`slug` text NOT NULL,
	`company` text NOT NULL,
	`position` text NOT NULL,
	`url` text,
	`status` text DEFAULT 'saved' NOT NULL,
	`notes` text,
	`job_description` text,
	`interview_questions` text,
	`tech_stack` text,
	`tech_dismissed_tags` text,
	`interviewers` text,
	`memorize_categories` text,
	`leadgen_company_key` text,
	`audio_url` text,
	`public` integer DEFAULT false NOT NULL,
	`applied_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `applications_user_idx` ON `applications` (`user_id`);--> statement-breakpoint
CREATE INDEX `applications_status_idx` ON `applications` (`user_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `applications_slug_idx` ON `applications` (`user_id`,`slug`);--> statement-breakpoint
CREATE TABLE `categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`icon` text NOT NULL,
	`description` text NOT NULL,
	`gradient_from` text NOT NULL,
	`gradient_to` text NOT NULL,
	`sort_order` integer NOT NULL,
	`lesson_range_lo` integer NOT NULL,
	`lesson_range_hi` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_name_unique` ON `categories` (`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `categories_slug_unique` ON `categories` (`slug`);--> statement-breakpoint
CREATE TABLE `chat_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `chat_messages_thread_time_idx` ON `chat_messages` (`thread_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `concept_edges` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`target_id` text NOT NULL,
	`edge_type` text NOT NULL,
	`weight` real DEFAULT 1 NOT NULL,
	`metadata` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `concepts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_id`) REFERENCES `concepts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `concept_edges_source_target_type_idx` ON `concept_edges` (`source_id`,`target_id`,`edge_type`);--> statement-breakpoint
CREATE INDEX `concept_edges_source_idx` ON `concept_edges` (`source_id`);--> statement-breakpoint
CREATE INDEX `concept_edges_target_idx` ON `concept_edges` (`target_id`);--> statement-breakpoint
CREATE INDEX `concept_edges_type_idx` ON `concept_edges` (`edge_type`);--> statement-breakpoint
CREATE TABLE `concept_embeddings` (
	`id` text PRIMARY KEY NOT NULL,
	`concept_id` text NOT NULL,
	`content` text NOT NULL,
	`embedding` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`concept_id`) REFERENCES `concepts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `concept_embeddings_concept_id_unique` ON `concept_embeddings` (`concept_id`);--> statement-breakpoint
CREATE TABLE `concepts` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`concept_type` text DEFAULT 'topic' NOT NULL,
	`metadata` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `concepts_name_unique` ON `concepts` (`name`);--> statement-breakpoint
CREATE INDEX `concepts_type_idx` ON `concepts` (`concept_type`);--> statement-breakpoint
CREATE TABLE `coursework` (
	`id` text PRIMARY KEY NOT NULL,
	`learner_id` text NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`file_name` text NOT NULL,
	`file_url` text NOT NULL,
	`file_size` integer NOT NULL,
	`mime_type` text NOT NULL,
	`subject` text,
	`submitted_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`learner_id`) REFERENCES `learners`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `coursework_learner_idx` ON `coursework` (`learner_id`);--> statement-breakpoint
CREATE INDEX `coursework_user_idx` ON `coursework` (`user_id`);--> statement-breakpoint
CREATE TABLE `interaction_events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`concept_id` text,
	`lesson_id` text,
	`section_id` text,
	`interaction_type` text NOT NULL,
	`is_correct` integer,
	`response_time_ms` integer,
	`metadata` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user_profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`concept_id`) REFERENCES `concepts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`lesson_id`) REFERENCES `lessons`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`section_id`) REFERENCES `lesson_sections`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `interaction_events_user_time_idx` ON `interaction_events` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `interaction_events_user_concept_idx` ON `interaction_events` (`user_id`,`concept_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `interaction_events_lesson_idx` ON `interaction_events` (`lesson_id`);--> statement-breakpoint
CREATE INDEX `interaction_events_type_idx` ON `interaction_events` (`interaction_type`);--> statement-breakpoint
CREATE TABLE `knowledge_states` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`concept_id` text NOT NULL,
	`p_mastery` real DEFAULT 0 NOT NULL,
	`p_transit` real DEFAULT 0.1 NOT NULL,
	`p_slip` real DEFAULT 0.1 NOT NULL,
	`p_guess` real DEFAULT 0.2 NOT NULL,
	`total_interactions` integer DEFAULT 0 NOT NULL,
	`correct_interactions` integer DEFAULT 0 NOT NULL,
	`mastery_level` text DEFAULT 'novice' NOT NULL,
	`last_interaction_at` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user_profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`concept_id`) REFERENCES `concepts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `knowledge_states_user_concept_idx` ON `knowledge_states` (`user_id`,`concept_id`);--> statement-breakpoint
CREATE INDEX `knowledge_states_user_idx` ON `knowledge_states` (`user_id`);--> statement-breakpoint
CREATE INDEX `knowledge_states_concept_idx` ON `knowledge_states` (`concept_id`);--> statement-breakpoint
CREATE INDEX `knowledge_states_mastery_idx` ON `knowledge_states` (`user_id`,`mastery_level`);--> statement-breakpoint
CREATE TABLE `learners` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`age` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `learners_user_idx` ON `learners` (`user_id`);--> statement-breakpoint
CREATE TABLE `lesson_concepts` (
	`lesson_id` text NOT NULL,
	`concept_id` text NOT NULL,
	`relevance` real DEFAULT 1 NOT NULL,
	PRIMARY KEY(`lesson_id`, `concept_id`),
	FOREIGN KEY (`lesson_id`) REFERENCES `lessons`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`concept_id`) REFERENCES `concepts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `lesson_embeddings` (
	`id` text PRIMARY KEY NOT NULL,
	`lesson_id` text NOT NULL,
	`content` text NOT NULL,
	`embedding` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`lesson_id`) REFERENCES `lessons`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lesson_embeddings_lesson_id_unique` ON `lesson_embeddings` (`lesson_id`);--> statement-breakpoint
CREATE TABLE `lesson_sections` (
	`id` text PRIMARY KEY NOT NULL,
	`lesson_id` text NOT NULL,
	`heading` text NOT NULL,
	`heading_level` integer DEFAULT 2 NOT NULL,
	`content` text NOT NULL,
	`section_order` integer NOT NULL,
	`word_count` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`lesson_id`) REFERENCES `lessons`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `lesson_sections_lesson_idx` ON `lesson_sections` (`lesson_id`);--> statement-breakpoint
CREATE TABLE `lessons` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`number` integer NOT NULL,
	`title` text NOT NULL,
	`category_id` integer NOT NULL,
	`word_count` integer DEFAULT 0 NOT NULL,
	`reading_time_min` integer DEFAULT 1 NOT NULL,
	`content` text NOT NULL,
	`summary` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lessons_slug_unique` ON `lessons` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `lessons_number_unique` ON `lessons` (`number`);--> statement-breakpoint
CREATE INDEX `lessons_category_idx` ON `lessons` (`category_id`);--> statement-breakpoint
CREATE INDEX `lessons_number_idx` ON `lessons` (`number`);--> statement-breakpoint
CREATE TABLE `problem_submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`problem_id` text NOT NULL,
	`user_id` text NOT NULL,
	`language` text NOT NULL,
	`code` text NOT NULL,
	`status` text NOT NULL,
	`passed_count` integer DEFAULT 0 NOT NULL,
	`total_count` integer DEFAULT 0 NOT NULL,
	`runtime_ms` real,
	`error_message` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`problem_id`) REFERENCES `problems`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `problem_submissions_user_idx` ON `problem_submissions` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `problem_submissions_problem_idx` ON `problem_submissions` (`problem_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `problem_submissions_user_problem_idx` ON `problem_submissions` (`user_id`,`problem_id`,`status`);--> statement-breakpoint
CREATE TABLE `problems` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`difficulty` text DEFAULT 'easy' NOT NULL,
	`prompt` text NOT NULL,
	`starter_js` text NOT NULL,
	`starter_ts` text NOT NULL,
	`test_cases` text NOT NULL,
	`entrypoint` text NOT NULL,
	`tags` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `problems_slug_unique` ON `problems` (`slug`);--> statement-breakpoint
CREATE INDEX `problems_difficulty_idx` ON `problems` (`difficulty`);--> statement-breakpoint
CREATE INDEX `problems_sort_idx` ON `problems` (`sort_order`);--> statement-breakpoint
CREATE TABLE `resumes` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`filename` text,
	`raw_text` text,
	`extracted_skills` text,
	`taxonomy_version` text,
	`created_at` text,
	`updated_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `resumes_user_id_unique` ON `resumes` (`user_id`);--> statement-breakpoint
CREATE INDEX `resumes_user_id_idx` ON `resumes` (`user_id`);--> statement-breakpoint
CREATE TABLE `section_embeddings` (
	`id` text PRIMARY KEY NOT NULL,
	`section_id` text NOT NULL,
	`lesson_id` text NOT NULL,
	`content` text NOT NULL,
	`embedding` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`section_id`) REFERENCES `lesson_sections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lesson_id`) REFERENCES `lessons`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `section_embeddings_section_id_unique` ON `section_embeddings` (`section_id`);--> statement-breakpoint
CREATE INDEX `section_embeddings_lesson_idx` ON `section_embeddings` (`lesson_id`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token` text NOT NULL,
	`expires_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `user_lesson_interactions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`lesson_id` text NOT NULL,
	`read_progress` real DEFAULT 0 NOT NULL,
	`rating` integer,
	`bookmarked` integer DEFAULT false NOT NULL,
	`time_spent_sec` integer DEFAULT 0 NOT NULL,
	`first_viewed_at` integer NOT NULL,
	`last_viewed_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user_profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lesson_id`) REFERENCES `lessons`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_lesson_interactions_user_lesson_idx` ON `user_lesson_interactions` (`user_id`,`lesson_id`);--> statement-breakpoint
CREATE INDEX `user_lesson_interactions_user_idx` ON `user_lesson_interactions` (`user_id`);--> statement-breakpoint
CREATE INDEX `user_lesson_interactions_lesson_idx` ON `user_lesson_interactions` (`lesson_id`);--> statement-breakpoint
CREATE TABLE `user_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
