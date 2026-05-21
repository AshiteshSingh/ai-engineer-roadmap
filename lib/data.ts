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

// Lesson content resolves D1 first (dynamic, written by the Rust `sync-d1`
// pipeline → new/edited content shows on refresh, no redeploy), then the
// build-bundled JSON exported by `export-content`, then the markdown parser in
// ./articles as the last-resort fallback. Each layer is independent, so an
// unconfigured/empty D1 silently falls through.

export async function getCategoryMeta(category: string): Promise<CategoryMeta> {
  try {
    const { getIndexFromD1 } = await import("./content-d1");
    const { categoryMetaFromIndex } = await import("./content-json");
    const idx = await getIndexFromD1();
    const meta = idx && categoryMetaFromIndex(idx, category);
    if (meta) return meta;
  } catch {
    // D1 unavailable — fall through
  }
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
    const { getIndexFromD1 } = await import("./content-d1");
    const { categoryCountFromIndex } = await import("./content-json");
    const idx = await getIndexFromD1();
    if (idx) return categoryCountFromIndex(idx);
  } catch {
    // D1 unavailable — fall through
  }
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
    const { getIndexFromD1 } = await import("./content-d1");
    const { lessonsFromIndex } = await import("./content-json");
    const idx = await getIndexFromD1();
    if (idx) return lessonsFromIndex(idx);
  } catch {
    // D1 unavailable — fall through
  }
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
    const { getLessonBySlugFromD1 } = await import("./content-d1");
    const fromD1 = await getLessonBySlugFromD1(slug);
    if (fromD1) return fromD1;
  } catch {
    // D1 unavailable — fall through
  }
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
    const { getIndexFromD1 } = await import("./content-d1");
    const { groupedFromIndex } = await import("./content-json");
    const idx = await getIndexFromD1();
    const grouped = idx ? groupedFromIndex(idx) : [];
    if (grouped.length > 0) return grouped;
  } catch {
    // D1 unavailable — fall through
  }
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
    const { getIndexFromD1 } = await import("./content-d1");
    const { totalWordCountFromIndex } = await import("./content-json");
    const idx = await getIndexFromD1();
    if (idx) return totalWordCountFromIndex(idx);
  } catch {
    // D1 unavailable — fall through
  }
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
