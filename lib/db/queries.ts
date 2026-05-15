import { eq, sql, desc, asc } from "drizzle-orm";
import { contentDb as db } from "@/src/db/content";
import { lessons, categories, applications, externalCourses, lessonCourses, courseReviews, lessonEmbeddings, deserializeEmbedding } from "@/src/db/content-schema";
import type { InferSelectModel } from "drizzle-orm";
import { cosineSimilarity } from "@/lib/vector-math";

export type ExternalCourse = InferSelectModel<typeof externalCourses>;

export type JobApplication = InferSelectModel<typeof applications>;
import type { Lesson, LessonWithContent, GroupedLessons } from "../articles";
import { getUrlPath } from "../articles";

export async function getAllLessonsFromDb(): Promise<Lesson[]> {
  const rows = db
    .select({
      slug: lessons.slug,
      number: lessons.number,
      title: lessons.title,
      categoryName: categories.name,
      wordCount: lessons.wordCount,
      readingTimeMin: lessons.readingTimeMin,
    })
    .from(lessons)
    .innerJoin(categories, eq(lessons.categoryId, categories.id))
    .orderBy(lessons.number)
    .all();

  return rows.map((p) => ({
    slug: p.slug,
    fileSlug: p.slug,
    number: p.number,
    title: p.title,
    category: p.categoryName,
    wordCount: p.wordCount,
    readingTimeMin: p.readingTimeMin,
    excerpt: "",
    difficulty: "intermediate" as const,
    url: getUrlPath(p.slug),
  }));
}

export async function getLessonBySlugFromDb(
  slug: string,
): Promise<LessonWithContent | null> {
  const row = db.query.lessons.findFirst({
    where: eq(lessons.slug, slug),
    with: { category: true },
  }).sync();

  if (!row) return null;

  return {
    slug: row.slug,
    fileSlug: row.slug,
    number: row.number,
    title: row.title,
    category: row.category.name,
    excerpt: "",
    difficulty: "intermediate" as const,
    wordCount: row.wordCount,
    readingTimeMin: row.readingTimeMin,
    url: getUrlPath(row.slug),
    content: row.content,
  };
}

export async function getGroupedLessonsFromDb(): Promise<GroupedLessons[]> {
  const rows = db.query.categories.findMany({
    with: {
      lessons: {
        orderBy: lessons.number,
      },
    },
    orderBy: categories.sortOrder,
  }).sync();

  return rows
    .map((cat) => ({
      category: cat.name,
      meta: {
        slug: cat.slug,
        icon: cat.icon,
        description: cat.description,
        gradient: [cat.gradientFrom, cat.gradientTo] as [string, string],
      },
      articles: cat.lessons.map((p) => ({
        slug: p.slug,
        fileSlug: p.slug,
        number: p.number,
        title: p.title,
        category: cat.name,
        excerpt: "",
        difficulty: "intermediate" as const,
        wordCount: p.wordCount,
        readingTimeMin: p.readingTimeMin,
        url: getUrlPath(p.slug),
      })),
    }))
    .filter((g) => g.articles.length > 0);
}

export async function getTotalWordCountFromDb(): Promise<number> {
  const [result] = db
    .select({ total: sql<number>`coalesce(sum(${lessons.wordCount}), 0)` })
    .from(lessons)
    .all();

  return result.total;
}

export async function getCategoryMetaFromDb(
  categoryName: string,
): Promise<{ slug: string; icon: string; description: string; gradient: [string, string] } | null> {
  const row = db.query.categories.findFirst({
    where: eq(categories.name, categoryName),
    columns: {
      slug: true,
      icon: true,
      description: true,
      gradientFrom: true,
      gradientTo: true,
    },
  }).sync();

  if (!row) return null;

  return {
    slug: row.slug,
    icon: row.icon,
    description: row.description,
    gradient: [row.gradientFrom, row.gradientTo],
  };
}

export async function getCategoryCountFromDb(): Promise<number> {
  const [result] = db
    .select({ count: sql<number>`count(*)` })
    .from(categories)
    .all();
  return result.count;
}

export async function getJobApplicationsFromDb(userId: string): Promise<JobApplication[]> {
  return db
    .select()
    .from(applications)
    .where(eq(applications.userId, userId))
    .orderBy(applications.createdAt)
    .all();
}

export async function getCoursesForLessonFromDb(
  slug: string,
  limit = 4,
): Promise<ExternalCourse[]> {
  const rows = db
    .select({ course: externalCourses })
    .from(lessonCourses)
    .innerJoin(externalCourses, eq(lessonCourses.courseId, externalCourses.id))
    .where(eq(lessonCourses.lessonSlug, slug))
    .orderBy(desc(lessonCourses.relevance), desc(externalCourses.rating))
    .limit(limit)
    .all();

  return rows.map((r) => r.course);
}

export async function getRelatedLessonsFromDb(
  slug: string,
  limit = 4,
): Promise<Lesson[]> {
  // Try vector similarity first — falls back to same-category if no embeddings
  try {
    const allEmbeddings = db
      .select({
        lessonId: lessonEmbeddings.lessonId,
        embedding: lessonEmbeddings.embedding,
      })
      .from(lessonEmbeddings)
      .all();

    if (allEmbeddings.length > 0) {
      // Find the target lesson's embedding
      const targetLesson = db.query.lessons.findFirst({
        where: eq(lessons.slug, slug),
        columns: { id: true },
      }).sync();

      if (targetLesson) {
        const targetEmb = allEmbeddings.find(
          (e) => e.lessonId === targetLesson.id,
        );
        if (targetEmb) {
          const targetVec = deserializeEmbedding(targetEmb.embedding);
          const scored = allEmbeddings
            .filter((e) => e.lessonId !== targetLesson.id)
            .map((e) => ({
              lessonId: e.lessonId,
              similarity: cosineSimilarity(
                targetVec,
                deserializeEmbedding(e.embedding),
              ),
            }))
            .sort((a, b) => b.similarity - a.similarity)
            .slice(0, limit);

          const lessonIds = scored.map((s) => s.lessonId);
          if (lessonIds.length > 0) {
            const rows = db
              .select({
                id: lessons.id,
                slug: lessons.slug,
                number: lessons.number,
                title: lessons.title,
                categoryName: categories.name,
                wordCount: lessons.wordCount,
                readingTimeMin: lessons.readingTimeMin,
              })
              .from(lessons)
              .innerJoin(categories, eq(lessons.categoryId, categories.id))
              .where(sql`${lessons.id} IN (${sql.join(lessonIds.map((id) => sql`${id}`), sql`, `)})`)
              .all();

            // Preserve similarity order
            const byId = new Map(rows.map((r) => [r.id, r]));
            return lessonIds
              .map((id) => byId.get(id))
              .filter(Boolean)
              .map((p) => ({
                slug: p!.slug,
                fileSlug: p!.slug,
                number: p!.number,
                title: p!.title,
                category: p!.categoryName,
                wordCount: p!.wordCount,
                readingTimeMin: p!.readingTimeMin,
                excerpt: "",
                difficulty: "intermediate" as const,
                url: getUrlPath(p!.slug),
              }));
          }
        }
      }
    }
  } catch {
    // No embeddings available — fall through to category-based
  }

  const rows = db
    .select({
      slug: lessons.slug,
      number: lessons.number,
      title: lessons.title,
      categoryName: categories.name,
      wordCount: lessons.wordCount,
      readingTimeMin: lessons.readingTimeMin,
    })
    .from(lessons)
    .innerJoin(categories, eq(lessons.categoryId, categories.id))
    .where(
      sql`${lessons.categoryId} = (SELECT category_id FROM lessons WHERE slug = ${slug})
          AND ${lessons.slug} != ${slug}`,
    )
    .orderBy(lessons.number)
    .limit(limit)
    .all();

  return rows.map((p) => ({
    slug: p.slug,
    fileSlug: p.slug,
    number: p.number,
    title: p.title,
    category: p.categoryName,
    wordCount: p.wordCount,
    readingTimeMin: p.readingTimeMin,
    excerpt: "",
    difficulty: "intermediate" as const,
    url: getUrlPath(p.slug),
  }));
}

export async function getCourseReview(courseId: string) {
  const result = db
    .select()
    .from(courseReviews)
    .where(eq(courseReviews.courseId, courseId))
    .limit(1)
    .all();
  return result[0] ?? null;
}

export type CourseReviewData = Awaited<ReturnType<typeof getCourseReview>>;

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

export async function getAllUdemyCoursesByGroup(): Promise<Record<string, ExternalCourse[]>> {
  const rows = db
    .select()
    .from(externalCourses)
    .where(eq(externalCourses.provider, "Udemy"))
    .orderBy(desc(externalCourses.rating))
    .all();

  const grouped: Record<string, ExternalCourse[]> = {};
  for (const course of rows) {
    const group = course.topicGroup ?? "Other";
    (grouped[group] ??= []).push(course);
  }
  return grouped;
}
