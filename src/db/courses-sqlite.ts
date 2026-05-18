/**
 * Dedicated SQLite course store — the write side of the Udemy course pipeline.
 *
 * Replaces the old Neon Postgres `external_courses` / `lesson_courses` /
 * `course_reviews` tables. Uses Node's built-in `node:sqlite` (Node ≥ 22.5,
 * zero npm deps). Writers (scrape-udemy-courses.ts, review-courses.ts, the
 * course-review API route) write here; the Rust `export-content` bin reads
 * `data/courses.db` and emits `data/content/courses.json` +
 * `course-reviews.json`, which the frontend reads via `lib/db/queries.ts`.
 *
 * Schema is kept byte-for-byte in sync with
 * `crates/ml/server/src/courses.rs::COURSE_SCHEMA` — both run
 * `CREATE TABLE IF NOT EXISTS`, so whichever process touches the file first
 * wins and the other is a no-op.
 */

import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import crypto from "node:crypto";

const COURSE_SCHEMA = `
CREATE TABLE IF NOT EXISTS external_courses (
  id             TEXT PRIMARY KEY,
  title          TEXT NOT NULL,
  url            TEXT NOT NULL UNIQUE,
  provider       TEXT NOT NULL,
  description    TEXT,
  level          TEXT,
  rating         REAL,
  review_count   INTEGER,
  duration_hours REAL,
  is_free        INTEGER NOT NULL DEFAULT 1,
  enrolled       INTEGER,
  image_url      TEXT,
  language       TEXT NOT NULL DEFAULT 'English',
  topic_group    TEXT,
  metadata       TEXT NOT NULL DEFAULT '{}',
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS external_courses_provider_idx ON external_courses(provider);

CREATE TABLE IF NOT EXISTS lesson_courses (
  lesson_slug TEXT NOT NULL,
  course_id   TEXT NOT NULL REFERENCES external_courses(id) ON DELETE CASCADE,
  relevance   REAL NOT NULL DEFAULT 1.0,
  PRIMARY KEY (lesson_slug, course_id)
);
CREATE INDEX IF NOT EXISTS lesson_courses_slug_idx ON lesson_courses(lesson_slug);

CREATE TABLE IF NOT EXISTS course_reviews (
  id                          TEXT PRIMARY KEY,
  course_id                   TEXT NOT NULL UNIQUE REFERENCES external_courses(id) ON DELETE CASCADE,
  pedagogy_score              INTEGER,
  technical_accuracy_score    INTEGER,
  content_depth_score         INTEGER,
  practical_application_score INTEGER,
  instructor_clarity_score    INTEGER,
  curriculum_fit_score        INTEGER,
  prerequisites_score         INTEGER,
  domain_relevance_score   INTEGER,
  community_health_score      INTEGER,
  value_proposition_score     INTEGER,
  aggregate_score             REAL,
  verdict                     TEXT,
  summary                     TEXT,
  expert_details              TEXT,
  model_version               TEXT NOT NULL DEFAULT 'deepseek-chat',
  reviewed_at                 TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS course_reviews_course_idx ON course_reviews(course_id);
`;

export function coursesDbPath(): string {
  return (
    process.env.COURSES_DB ?? path.join(process.cwd(), "data", "courses.db")
  );
}

let _db: DatabaseSync | null = null;

/** Open (creating if needed) the course DB with the schema applied. */
export function coursesDb(): DatabaseSync {
  if (!_db) {
    const db = new DatabaseSync(coursesDbPath());
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA foreign_keys = ON;");
    db.exec(COURSE_SCHEMA);
    _db = db;
  }
  return _db;
}

// ── external_courses ────────────────────────────────────────────────

export interface UpsertCourseInput {
  title: string;
  url: string;
  provider: string;
  description: string | null;
  level: string | null;
  rating: number | null;
  reviewCount: number | null;
  durationHours: number | null;
  isFree: boolean;
  enrolled: number | null;
  imageUrl: string | null;
  language: string;
  topicGroup: string;
  metadata: unknown;
}

/** Upsert a scraped course (conflict on `url`); returns its row id. */
export function upsertCourse(values: UpsertCourseInput): string {
  const db = coursesDb();
  const id = crypto.randomUUID();
  const row = db
    .prepare(
      `INSERT INTO external_courses (
         id, title, url, provider, description, level, rating, review_count,
         duration_hours, is_free, enrolled, image_url, language, topic_group,
         metadata, created_at, updated_at
       ) VALUES (
         ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now')
       )
       ON CONFLICT(url) DO UPDATE SET
         title = excluded.title,
         provider = excluded.provider,
         description = excluded.description,
         level = excluded.level,
         rating = excluded.rating,
         review_count = excluded.review_count,
         duration_hours = excluded.duration_hours,
         is_free = excluded.is_free,
         enrolled = excluded.enrolled,
         image_url = excluded.image_url,
         language = excluded.language,
         topic_group = excluded.topic_group,
         metadata = excluded.metadata,
         updated_at = datetime('now')
       RETURNING id`,
    )
    .get(
      id,
      values.title,
      values.url,
      values.provider,
      values.description,
      values.level,
      values.rating,
      values.reviewCount,
      values.durationHours,
      values.isFree ? 1 : 0,
      values.enrolled,
      values.imageUrl,
      values.language,
      values.topicGroup,
      JSON.stringify(values.metadata ?? {}),
    ) as { id: string };
  return row.id;
}

export function getCourseById(id: string): { id: string } | null {
  const row = coursesDb()
    .prepare("SELECT id FROM external_courses WHERE id = ?")
    .get(id) as { id: string } | undefined;
  return row ?? null;
}

// ── lesson_courses ──────────────────────────────────────────────────

export function linkLessonCourse(
  lessonSlug: string,
  courseId: string,
  relevance: number,
): void {
  coursesDb()
    .prepare(
      `INSERT INTO lesson_courses (lesson_slug, course_id, relevance)
       VALUES (?, ?, ?)
       ON CONFLICT(lesson_slug, course_id) DO UPDATE SET relevance = excluded.relevance`,
    )
    .run(lessonSlug, courseId, relevance);
}

// ── course_reviews ──────────────────────────────────────────────────

export interface UnreviewedCourse {
  id: string;
  title: string;
  url: string;
  provider: string;
  description: string;
  level: string;
  rating: number;
  review_count: number;
  duration_hours: number;
  is_free: number;
}

/** Courses with no row in `course_reviews`, oldest first. */
export function fetchUnreviewedCourses(
  limit: number,
  provider?: string,
): UnreviewedCourse[] {
  const db = coursesDb();
  const base = `
    SELECT
      ec.id                                AS id,
      ec.title                             AS title,
      ec.url                               AS url,
      ec.provider                          AS provider,
      COALESCE(ec.description, '')         AS description,
      COALESCE(ec.level, 'Beginner')       AS level,
      COALESCE(ec.rating, 0.0)             AS rating,
      COALESCE(ec.review_count, 0)         AS review_count,
      COALESCE(ec.duration_hours, 0.0)     AS duration_hours,
      ec.is_free                           AS is_free
    FROM external_courses ec
    WHERE NOT EXISTS (SELECT 1 FROM course_reviews cr WHERE cr.course_id = ec.id)`;
  if (provider) {
    return db
      .prepare(
        `${base} AND lower(ec.provider) LIKE ? ORDER BY ec.created_at LIMIT ?`,
      )
      .all(`%${provider.toLowerCase()}%`, limit) as unknown as UnreviewedCourse[];
  }
  return db
    .prepare(`${base} ORDER BY ec.created_at LIMIT ?`)
    .all(limit) as unknown as UnreviewedCourse[];
}

export interface CourseReviewWrite {
  pedagogy_score: number;
  technical_accuracy_score: number;
  content_depth_score: number;
  practical_application_score: number;
  instructor_clarity_score: number;
  curriculum_fit_score: number;
  prerequisites_score: number;
  domain_relevance_score: number;
  community_health_score: number;
  value_proposition_score: number;
  aggregate_score: number;
  verdict: string;
  summary: string;
  expert_details: unknown;
  model_version: string;
}

/** Upsert a review keyed on course_id. Mirrors the old Postgres upsert. */
export function upsertCourseReview(
  courseId: string,
  r: CourseReviewWrite,
): void {
  coursesDb()
    .prepare(
      `INSERT INTO course_reviews (
         id, course_id, pedagogy_score, technical_accuracy_score,
         content_depth_score, practical_application_score,
         instructor_clarity_score, curriculum_fit_score, prerequisites_score,
         domain_relevance_score, community_health_score,
         value_proposition_score, aggregate_score, verdict, summary,
         expert_details, model_version, reviewed_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(course_id) DO UPDATE SET
         pedagogy_score              = excluded.pedagogy_score,
         technical_accuracy_score    = excluded.technical_accuracy_score,
         content_depth_score         = excluded.content_depth_score,
         practical_application_score = excluded.practical_application_score,
         instructor_clarity_score    = excluded.instructor_clarity_score,
         curriculum_fit_score        = excluded.curriculum_fit_score,
         prerequisites_score         = excluded.prerequisites_score,
         domain_relevance_score   = excluded.domain_relevance_score,
         community_health_score      = excluded.community_health_score,
         value_proposition_score     = excluded.value_proposition_score,
         aggregate_score             = excluded.aggregate_score,
         verdict                     = excluded.verdict,
         summary                     = excluded.summary,
         expert_details              = excluded.expert_details,
         model_version               = excluded.model_version,
         reviewed_at                 = datetime('now')`,
    )
    .run(
      crypto.randomUUID(),
      courseId,
      r.pedagogy_score,
      r.technical_accuracy_score,
      r.content_depth_score,
      r.practical_application_score,
      r.instructor_clarity_score,
      r.curriculum_fit_score,
      r.prerequisites_score,
      r.domain_relevance_score,
      r.community_health_score,
      r.value_proposition_score,
      r.aggregate_score,
      r.verdict,
      r.summary,
      JSON.stringify(r.expert_details ?? {}),
      r.model_version,
    );
}

export function getCourseReviewRow(
  courseId: string,
): Record<string, unknown> | null {
  const row = coursesDb()
    .prepare("SELECT * FROM course_reviews WHERE course_id = ? LIMIT 1")
    .get(courseId) as Record<string, unknown> | undefined;
  return row ?? null;
}
