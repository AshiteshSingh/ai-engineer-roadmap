/**
 * One-time migration: pull all content data from Neon PostgreSQL → SQLite.
 *
 * Usage: tsx --env-file=.env.local scripts/migrate-from-neon.ts
 *
 * Prerequisites: run `tsx --env-file=.env.local scripts/seed-sqlite.ts` first
 * to create the SQLite DB with tables + seed lessons/categories/sections.
 * This script migrates the remaining tables (courses, reviews, embeddings, etc).
 */
import { neon } from "@neondatabase/serverless";
import Database from "better-sqlite3";
import { serializeEmbedding } from "../src/db/content-schema";
import fs from "fs";
import path from "path";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("Missing DATABASE_URL");
  process.exit(1);
}

const DB_PATH =
  process.env.CONTENT_DB_PATH ||
  path.join(process.cwd(), "data", "knowledge.db");

if (!fs.existsSync(DB_PATH)) {
  console.error(`SQLite DB not found at ${DB_PATH}. Run seed-sqlite.ts first.`);
  process.exit(1);
}

const pg = neon(databaseUrl);
const sqlite = new Database(DB_PATH);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = OFF"); // Temporarily disable for bulk insert order

async function migrateTable(
  tableName: string,
  query: string,
  insertSql: string,
  transform?: (row: Record<string, unknown>) => unknown[],
) {
  let rows: Record<string, unknown>[];
  try {
    rows = (await pg(query)) as Record<string, unknown>[];
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code === "42P01") {
      console.log(`  ${tableName}: skipped (not in Neon)`);
      return;
    }
    throw err;
  }
  if (rows.length === 0) {
    console.log(`  ${tableName}: 0 rows (empty)`);
    return;
  }

  const stmt = sqlite.prepare(insertSql);
  const insertMany = sqlite.transaction((data: unknown[][]) => {
    for (const row of data) {
      stmt.run(...row);
    }
  });

  const transformed = transform
    ? rows.map((r) => transform(r as Record<string, unknown>))
    : rows.map((r) => Object.values(r));

  insertMany(transformed);
  console.log(`  ${tableName}: ${rows.length} rows`);
}

function epochOrNull(v: unknown): number | null {
  if (!v) return null;
  return Math.floor(new Date(v as string).getTime() / 1000);
}

function epoch(v: unknown): number {
  return Math.floor(new Date(v as string).getTime() / 1000);
}

async function main() {
  console.log("Migrating content from Neon → SQLite...\n");

  // External courses
  await migrateTable(
    "external_courses",
    `SELECT id, title, url, provider, description, level,
            rating, review_count, duration_hours, is_free, enrolled, image_url,
            language, topic_group, metadata, created_at, updated_at
     FROM external_courses`,
    `INSERT OR IGNORE INTO external_courses
     (id, title, url, provider, description, level,
      rating, review_count, duration_hours, is_free, enrolled, image_url,
      language, topic_group, metadata, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    (r) => [
      r.id, r.title, r.url, r.provider, r.description, r.level,
      r.rating, r.review_count, r.duration_hours, r.is_free ? 1 : 0, r.enrolled,
      r.image_url, r.language, r.topic_group,
      typeof r.metadata === "string" ? r.metadata : JSON.stringify(r.metadata ?? {}),
      epoch(r.created_at), epoch(r.updated_at),
    ],
  );

  // Lesson-course mappings
  await migrateTable(
    "lesson_courses",
    `SELECT lesson_slug, course_id, relevance FROM lesson_courses`,
    `INSERT OR IGNORE INTO lesson_courses (lesson_slug, course_id, relevance) VALUES (?,?,?)`,
  );

  // Course reviews
  await migrateTable(
    "course_reviews",
    `SELECT id, course_id, pedagogy_score, technical_accuracy_score,
            content_depth_score, practical_application_score,
            instructor_clarity_score, curriculum_fit_score,
            prerequisites_score, ai_domain_relevance_score,
            community_health_score, value_proposition_score,
            aggregate_score, verdict, summary, expert_details,
            model_version, reviewed_at
     FROM course_reviews`,
    `INSERT OR IGNORE INTO course_reviews
     (id, course_id, pedagogy_score, technical_accuracy_score,
      content_depth_score, practical_application_score,
      instructor_clarity_score, curriculum_fit_score,
      prerequisites_score, ai_domain_relevance_score,
      community_health_score, value_proposition_score,
      aggregate_score, verdict, summary, expert_details,
      model_version, reviewed_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    (r) => [
      r.id, r.course_id, r.pedagogy_score, r.technical_accuracy_score,
      r.content_depth_score, r.practical_application_score,
      r.instructor_clarity_score, r.curriculum_fit_score,
      r.prerequisites_score, r.ai_domain_relevance_score,
      r.community_health_score, r.value_proposition_score,
      r.aggregate_score, r.verdict, r.summary,
      typeof r.expert_details === "string" ? r.expert_details : JSON.stringify(r.expert_details),
      r.model_version, epoch(r.reviewed_at),
    ],
  );

  // Lesson embeddings (convert pgvector string → Float32Array blob)
  await migrateTable(
    "lesson_embeddings",
    `SELECT id, lesson_id, content, embedding::text, created_at FROM lesson_embeddings`,
    `INSERT OR IGNORE INTO lesson_embeddings (id, lesson_id, content, embedding, created_at) VALUES (?,?,?,?,?)`,
    (r) => {
      const vec = (r.embedding as string).slice(1, -1).split(",").map(Number);
      return [r.id, r.lesson_id, r.content, serializeEmbedding(vec), epoch(r.created_at)];
    },
  );

  // Section embeddings
  await migrateTable(
    "section_embeddings",
    `SELECT id, section_id, lesson_id, content, embedding::text, created_at FROM section_embeddings`,
    `INSERT OR IGNORE INTO section_embeddings (id, section_id, lesson_id, content, embedding, created_at) VALUES (?,?,?,?,?,?)`,
    (r) => {
      const vec = (r.embedding as string).slice(1, -1).split(",").map(Number);
      return [r.id, r.section_id, r.lesson_id, r.content, serializeEmbedding(vec), epoch(r.created_at)];
    },
  );

  // Concept embeddings
  await migrateTable(
    "concept_embeddings",
    `SELECT id, concept_id, content, embedding::text, created_at FROM concept_embeddings`,
    `INSERT OR IGNORE INTO concept_embeddings (id, concept_id, content, embedding, created_at) VALUES (?,?,?,?,?)`,
    (r) => {
      const vec = (r.embedding as string).slice(1, -1).split(",").map(Number);
      return [r.id, r.concept_id, r.content, serializeEmbedding(vec), epoch(r.created_at)];
    },
  );

  // Concepts
  await migrateTable(
    "concepts",
    `SELECT id, name, description, concept_type, metadata, created_at FROM concepts`,
    `INSERT OR IGNORE INTO concepts (id, name, description, concept_type, metadata, created_at) VALUES (?,?,?,?,?,?)`,
    (r) => [
      r.id, r.name, r.description, r.concept_type,
      typeof r.metadata === "string" ? r.metadata : JSON.stringify(r.metadata ?? {}),
      epoch(r.created_at),
    ],
  );

  // Concept edges
  await migrateTable(
    "concept_edges",
    `SELECT id, source_id, target_id, edge_type, weight, metadata, created_at FROM concept_edges`,
    `INSERT OR IGNORE INTO concept_edges (id, source_id, target_id, edge_type, weight, metadata, created_at) VALUES (?,?,?,?,?,?,?)`,
    (r) => [
      r.id, r.source_id, r.target_id, r.edge_type, r.weight,
      typeof r.metadata === "string" ? r.metadata : JSON.stringify(r.metadata ?? {}),
      epoch(r.created_at),
    ],
  );

  // Applications
  await migrateTable(
    "applications",
    `SELECT id, user_id, company, position, url, status, notes, job_description,
            ai_interview_questions, ai_tech_stack, tech_dismissed_tags,
            applied_at, created_at, updated_at
     FROM applications`,
    `INSERT OR IGNORE INTO applications
     (id, user_id, company, position, url, status, notes, job_description,
      ai_interview_questions, ai_tech_stack, tech_dismissed_tags,
      applied_at, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    (r) => [
      r.id, r.user_id, r.company, r.position, r.url, r.status, r.notes,
      r.job_description, r.ai_interview_questions, r.ai_tech_stack,
      r.tech_dismissed_tags, epochOrNull(r.applied_at),
      epoch(r.created_at), epoch(r.updated_at),
    ],
  );

  // Chat messages
  await migrateTable(
    "chat_messages",
    `SELECT id, thread_id, role, content, created_at FROM chat_messages`,
    `INSERT OR IGNORE INTO chat_messages (id, thread_id, role, content, created_at) VALUES (?,?,?,?,?)`,
    (r) => [r.id, r.thread_id, r.role, r.content, epoch(r.created_at)],
  );

  sqlite.pragma("foreign_keys = ON");
  console.log("\nMigration complete!");
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
