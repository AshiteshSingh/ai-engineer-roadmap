/**
 * Courses / course-reviews reader, backed by the Rust-exported JSON
 * (data/content/courses.json, course-reviews.json). No SQLite — Rust is the
 * only thing that touches knowledge.db. These are empty until the Udemy
 * pipeline repopulates them; readers degrade to empty/null gracefully.
 *
 * Lesson content lives in lib/content-json.ts; per-user writes live in Neon.
 */

import fs from "fs";
import path from "path";
import { resolveContentDir } from "../content-json";

export interface ExternalCourse {
  id: string;
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
  language: string | null;
  topicGroup: string | null;
  metadata: unknown;
}

export type CourseReviewData = Record<string, unknown> | null;

export const TOPIC_GROUP_ORDER = [
  "Generative AI & LLMs",
  "RAG & Vector Search",
  "AI Agents & Frameworks",
  "Fine-tuning & RLHF",
  "Deep Learning",
  "Computer Vision",
  "NLP & Transformers",
  "MLOps & Deployment",
  "Reinforcement Learning",
  "ML Foundations",
  "Other",
] as const;

function readJson<T>(file: string, fallback: T): T {
  try {
    const p = path.join(resolveContentDir(), file);
    return JSON.parse(fs.readFileSync(p, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

let _courses: ExternalCourse[] | null = null;
function courses(): ExternalCourse[] {
  if (!_courses) _courses = readJson<ExternalCourse[]>("courses.json", []);
  return _courses;
}

let _reviews: Record<string, unknown>[] | null = null;
function reviews(): Record<string, unknown>[] {
  if (!_reviews)
    _reviews = readJson<Record<string, unknown>[]>("course-reviews.json", []);
  return _reviews;
}

/** One row of data/content/lesson-courses.json (Rust-exported). */
interface LessonCourseLink {
  lessonSlug: string;
  courseId: string;
  relevance: number;
}

let _lessonCourses: LessonCourseLink[] | null = null;
function lessonCourses(): LessonCourseLink[] {
  if (!_lessonCourses)
    _lessonCourses = readJson<LessonCourseLink[]>("lesson-courses.json", []);
  return _lessonCourses;
}

export async function getAllCoursesByGroup(): Promise<
  Record<string, ExternalCourse[]>
> {
  const grouped: Record<string, ExternalCourse[]> = {};
  for (const c of courses()) {
    const group = c.topicGroup ?? "Other";
    (grouped[group] ??= []).push(c);
  }
  for (const arr of Object.values(grouped)) {
    // Rated items (Udemy) first by rating; unrated resources (Coursera
    // articles) fall to the end of their group.
    arr.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
  }
  return grouped;
}

/**
 * Courses linked to a lesson, via the Rust-exported lesson↔course mapping
 * (data/content/lesson-courses.json, populated by `udemy rag-seed` →
 * `export-content`). Joined to courses.json by id, ordered by link relevance
 * then rating. Returns [] when nothing is linked (rail renders nothing).
 */
export async function getCoursesForLessonFromDb(
  slug: string,
): Promise<ExternalCourse[]> {
  const links = lessonCourses().filter((l) => l.lessonSlug === slug);
  if (links.length === 0) return [];
  const rel = new Map(links.map((l) => [l.courseId, l.relevance]));
  const byId = new Map(courses().map((c) => [c.id, c]));
  return links
    .map((l) => byId.get(l.courseId))
    .filter((c): c is ExternalCourse => c != null)
    .sort(
      (a, b) =>
        (rel.get(b.id) ?? 0) - (rel.get(a.id) ?? 0) ||
        (b.rating ?? 0) - (a.rating ?? 0),
    );
}

export async function getCourseReview(
  courseId: string,
): Promise<CourseReviewData> {
  return (
    reviews().find(
      (r) => r.course_id === courseId || r.courseId === courseId,
    ) ?? null
  );
}
