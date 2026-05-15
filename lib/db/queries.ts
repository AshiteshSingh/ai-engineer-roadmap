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

export async function getAllUdemyCoursesByGroup(): Promise<
  Record<string, ExternalCourse[]>
> {
  const grouped: Record<string, ExternalCourse[]> = {};
  for (const c of courses()) {
    if (c.provider !== "Udemy") continue;
    const group = c.topicGroup ?? "Other";
    (grouped[group] ??= []).push(c);
  }
  for (const arr of Object.values(grouped)) {
    arr.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
  }
  return grouped;
}

// No lesson↔course mapping is exported (it was never populated); the
// related-courses rail simply shows nothing rather than reading SQLite.
export async function getCoursesForLessonFromDb(
  _slug: string,
): Promise<ExternalCourse[]> {
  return [];
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
