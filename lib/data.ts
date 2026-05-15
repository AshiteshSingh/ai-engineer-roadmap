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

const dataSource = process.env.NEXT_PUBLIC_DATA_SOURCE;
const USE_DB = dataSource === "neon" || dataSource === "sqlite";

export async function getCategoryMeta(category: string): Promise<CategoryMeta> {
  if (USE_DB) {
    try {
      const { getCategoryMetaFromDb } = await import("./db/queries");
      const meta = await getCategoryMetaFromDb(category);
      if (meta) return meta;
    } catch {
      // DB unavailable — fall through to static lookup
    }
  }
  // Fallback to static lookup
  const { getCategoryMeta: staticMeta } = await import("./articles");
  return staticMeta(category);
}

export async function getCategoryCount(): Promise<number> {
  if (USE_DB) {
    try {
      const { getCategoryCountFromDb } = await import("./db/queries");
      return await getCategoryCountFromDb();
    } catch {
      // DB unavailable — fall through
    }
  }
  const { CATEGORIES } = await import("./articles");
  return CATEGORIES.length;
}

export async function getAllLessons(): Promise<Lesson[]> {
  if (USE_DB) {
    try {
      const { getAllLessonsFromDb } = await import("./db/queries");
      return await getAllLessonsFromDb();
    } catch {
      // DB unavailable — fall through
    }
  }
  const { getAllLessons: fs } = await import("./articles");
  return fs();
}

export async function getLessonBySlug(
  slug: string,
): Promise<LessonWithContent | null> {
  if (USE_DB) {
    try {
      const { getLessonBySlugFromDb } = await import("./db/queries");
      return await getLessonBySlugFromDb(slug);
    } catch {
      // DB unavailable — fall through
    }
  }
  const { getLessonBySlug: fs } = await import("./articles");
  return fs(slug);
}

export async function getGroupedLessons(): Promise<GroupedLessons[]> {
  if (USE_DB) {
    try {
      const { getGroupedLessonsFromDb } = await import("./db/queries");
      return await getGroupedLessonsFromDb();
    } catch {
      // DB unavailable — fall through
    }
  }
  const { getGroupedLessons: fs } = await import("./articles");
  return fs();
}

export async function getTotalWordCount(): Promise<number> {
  if (USE_DB) {
    try {
      const { getTotalWordCountFromDb } = await import("./db/queries");
      return await getTotalWordCountFromDb();
    } catch {
      // DB unavailable — fall through
    }
  }
  const { getTotalWordCount: fs } = await import("./articles");
  return fs();
}

export async function getRelatedLessons(
  slug: string,
): Promise<Lesson[]> {
  if (USE_DB) {
    try {
      const { getRelatedLessonsFromDb } = await import("./db/queries");
      return await getRelatedLessonsFromDb(slug);
    } catch {
      // DB unavailable — fall through
    }
  }
  // FS fallback: filter by same category
  const all = await getAllLessons();
  const current = all.find((p) => p.slug === slug);
  if (!current) return [];
  return all
    .filter((p) => p.category === current.category && p.slug !== slug)
    .slice(0, 4);
}

export async function getCoursesForLesson(
  slug: string,
): Promise<import("./db/queries").ExternalCourse[]> {
  if (USE_DB) {
    try {
      const { getCoursesForLessonFromDb } = await import("./db/queries");
      return await getCoursesForLessonFromDb(slug);
    } catch {
      // DB unavailable — fall through
    }
  }
  return [];
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
