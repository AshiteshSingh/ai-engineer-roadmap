import type { Lesson, LessonWithContent, GroupedLessons, CategoryMeta } from "./articles";
// Re-export types for single-source imports
export type { Lesson, LessonWithContent, GroupedLessons, CategoryMeta };

// Re-export static constants for FS mode consumers
export {
  CATEGORIES,
  CATEGORY_META,
  AWS_DEEP_DIVE_SLUGS,
  APPENDIX_SLUGS,
  FLOW_MAX_NUMBER,
  isAppendixSlug,
  getUrlPath,
} from "./articles";

export interface SearchResult {
  resultType: "lesson" | "section";
  title: string;
  snippet: string;
  rank: number;
  lessonSlug: string | null;
  lessonTitle: string | null;
}

// Static lesson content is served from JSON exported by the Rust
// `export-content` binary (SQLite is the single source of truth; only Rust
// reads it). The markdown parser in ./articles is the resilience fallback
// when the JSON export is missing (e.g. before `npm run content:build`).

export async function getCategoryMeta(category: string): Promise<CategoryMeta> {
  try {
    const { getCategoryMetaFromJson } = await import("./content-json");
    const meta = getCategoryMetaFromJson(category);
    if (meta) return meta;
  } catch {
    // JSON export unavailable — fall through to static lookup
  }
  const { getCategoryMeta: staticMeta } = await import("./articles");
  return staticMeta(category);
}

export async function getCategoryCount(): Promise<number> {
  try {
    const { getCategoryCountFromJson } = await import("./content-json");
    return getCategoryCountFromJson();
  } catch {
    // JSON export unavailable — fall through
  }
  const { CATEGORIES } = await import("./articles");
  return CATEGORIES.length;
}

export async function getAllLessons(): Promise<Lesson[]> {
  try {
    const { getAllLessonsFromJson } = await import("./content-json");
    return getAllLessonsFromJson();
  } catch {
    // JSON export unavailable — fall through
  }
  const { getAllLessons: fs } = await import("./articles");
  return fs();
}

export async function getLessonBySlug(
  slug: string,
): Promise<LessonWithContent | null> {
  try {
    const { getLessonBySlugFromJson } = await import("./content-json");
    const lesson = getLessonBySlugFromJson(slug);
    if (lesson) return lesson;
  } catch {
    // JSON export unavailable — fall through
  }
  const { getLessonBySlug: fs } = await import("./articles");
  return fs(slug);
}

export async function getGroupedLessons(): Promise<GroupedLessons[]> {
  try {
    const { getGroupedLessonsFromJson } = await import("./content-json");
    const grouped = getGroupedLessonsFromJson();
    if (grouped.length > 0) return grouped;
  } catch {
    // JSON export unavailable — fall through
  }
  const { getGroupedLessons: fs } = await import("./articles");
  return fs();
}

export async function getTotalWordCount(): Promise<number> {
  try {
    const { getTotalWordCountFromJson } = await import("./content-json");
    return getTotalWordCountFromJson();
  } catch {
    // JSON export unavailable — fall through
  }
  const { getTotalWordCount: fs } = await import("./articles");
  return fs();
}

export async function getRelatedLessons(slug: string): Promise<Lesson[]> {
  const all = await getAllLessons();
  // Vector similarity from the Rust artifact crates/ml/data/similarity-matrix.json.
  try {
    const { getSimilarLessons } = await import("./ml-client");
    const similar = getSimilarLessons(slug, 4);
    if (similar.length > 0) {
      const bySlug = new Map(all.map((l) => [l.slug, l]));
      const related = similar
        .map((s) => bySlug.get(s.slug))
        .filter((l): l is Lesson => Boolean(l));
      if (related.length > 0) return related;
    }
  } catch {
    // No similarity matrix — fall through to same-category
  }
  const current = all.find((p) => p.slug === slug);
  if (!current) return [];
  return all
    .filter((p) => p.category === current.category && p.slug !== slug)
    .slice(0, 4);
}

export async function getCoursesForLesson(
  slug: string,
): Promise<import("./db/queries").ExternalCourse[]> {
  try {
    const { getCoursesForLessonFromDb } = await import("./db/queries");
    return await getCoursesForLessonFromDb(slug);
  } catch {
    return [];
  }
}

// The audiobook spine: all lessons in roadmap order minus the Appendix.
// Works in both DB and FS modes (derives from the abstracted getAllLessons).
export async function getFlowOrder(): Promise<Lesson[]> {
  const { APPENDIX_SLUGS } = await import("./articles");
  const all = await getAllLessons();
  return all.filter((l) => !APPENDIX_SLUGS.has(l.slug));
}

// Audio metadata
export { getAudioMeta } from "./audio";
export type { AudioMeta, AudioChapter } from "./audio";
