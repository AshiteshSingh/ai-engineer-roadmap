/**
 * Read static lesson content from JSON exported by the Rust `export-content`
 * binary (SQLite is the single source of truth; only Rust reads it).
 *
 * Pipeline: content/*.md → roadmap:meta → seed:content → data/knowledge.db →
 * Rust export → data/content/{index.json,<slug>.json} → here.
 *
 * Routing (`getUrlPath`) and the `excerpt`/`difficulty` defaults live in
 * lib/articles.ts and are applied here, so the Rust side stays a raw dump.
 */

import fs from "fs";
import path from "path";
import type {
  Lesson,
  LessonWithContent,
  GroupedLessons,
  CategoryMeta,
} from "./articles";
import { getUrlPath } from "./articles";

interface CategoryRecord {
  name: string;
  slug: string;
  icon: string;
  description: string;
  gradientFrom: string;
  gradientTo: string;
  sortOrder: number;
}

interface LessonMeta {
  slug: string;
  number: number;
  title: string;
  category: string;
  wordCount: number;
  readingTimeMin: number;
}

interface ContentIndex {
  categories: CategoryRecord[];
  lessons: LessonMeta[];
  totalWordCount: number;
}

interface LessonFull extends LessonMeta {
  content: string;
}

export function resolveContentDir(): string {
  if (process.env.CONTENT_JSON_DIR) return process.env.CONTENT_JSON_DIR;

  // process.cwd()-scoped, /*turbopackIgnore*/-annotated: keeps Turbopack's
  // NFT tracer from walking the whole project. The JSON ships explicitly via
  // next.config.ts `outputFileTracingIncludes` ("./data/content/**"). No
  // __dirname candidate — opaque to the tracer, never resolved in prod.
  const candidates = [
    path.join(/*turbopackIgnore: true*/ process.cwd(), "data", "content"),
    path.join(/*turbopackIgnore: true*/ process.cwd(), "apps", "knowledge", "data", "content"),
    path.join(/*turbopackIgnore: true*/ process.cwd(), "apps", "ai-engineer-roadmap", "data", "content"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(/*turbopackIgnore: true*/ path.join(c, "index.json")))
      return c;
  }
  return candidates[0];
}

let _index: ContentIndex | null = null;
const _lessonCache = new Map<string, LessonFull | null>();

function loadIndex(): ContentIndex {
  if (_index) return _index;
  const file = path.join(resolveContentDir(), "index.json");
  _index = JSON.parse(
    fs.readFileSync(/*turbopackIgnore: true*/ file, "utf-8"),
  ) as ContentIndex;
  return _index;
}

function loadLessonFile(slug: string): LessonFull | null {
  if (_lessonCache.has(slug)) return _lessonCache.get(slug)!;
  const file = path.join(resolveContentDir(), `${slug}.json`);
  let lesson: LessonFull | null = null;
  if (fs.existsSync(/*turbopackIgnore: true*/ file)) {
    lesson = JSON.parse(
      fs.readFileSync(/*turbopackIgnore: true*/ file, "utf-8"),
    ) as LessonFull;
  }
  _lessonCache.set(slug, lesson);
  return lesson;
}

/** Shape a raw record into the public `Lesson` (mirrors the old DB queries). */
function toLesson(m: LessonMeta): Lesson {
  return {
    slug: m.slug,
    fileSlug: m.slug,
    number: m.number,
    title: m.title,
    category: m.category,
    excerpt: "",
    difficulty: "intermediate",
    wordCount: m.wordCount,
    readingTimeMin: m.readingTimeMin,
    url: getUrlPath(m.slug),
  };
}

export function getAllLessonsFromJson(): Lesson[] {
  return loadIndex().lessons.map(toLesson);
}

export function getLessonBySlugFromJson(slug: string): LessonWithContent | null {
  const l = loadLessonFile(slug);
  if (!l) return null;
  return { ...toLesson(l), content: l.content };
}

export function getGroupedLessonsFromJson(): GroupedLessons[] {
  const { categories, lessons } = loadIndex();
  const byCategory = new Map<string, Lesson[]>();
  for (const m of lessons) {
    const arr = byCategory.get(m.category);
    if (arr) arr.push(toLesson(m));
    else byCategory.set(m.category, [toLesson(m)]);
  }
  return categories
    .map((c) => ({
      category: c.name,
      meta: {
        slug: c.slug,
        icon: c.icon,
        description: c.description,
        gradient: [c.gradientFrom, c.gradientTo] as [string, string],
      },
      articles: (byCategory.get(c.name) ?? []).sort(
        (a, b) => a.number - b.number,
      ),
    }))
    .filter((g) => g.articles.length > 0);
}

export function getTotalWordCountFromJson(): number {
  return loadIndex().totalWordCount;
}

export function getCategoryMetaFromJson(
  categoryName: string,
): CategoryMeta | null {
  const c = loadIndex().categories.find((x) => x.name === categoryName);
  if (!c) return null;
  return {
    slug: c.slug,
    icon: c.icon,
    description: c.description,
    gradient: [c.gradientFrom, c.gradientTo],
  };
}

export function getCategoryCountFromJson(): number {
  return loadIndex().categories.length;
}
