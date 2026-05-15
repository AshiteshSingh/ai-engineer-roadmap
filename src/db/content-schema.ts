import {
  sqliteTable,
  text,
  integer,
  real,
  blob,
  primaryKey,
  uniqueIndex,
  index,
} from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";

// ── Embedding serialization helpers ─────────────────────────────────

export function serializeEmbedding(vec: number[]): Buffer {
  return Buffer.from(new Float32Array(vec).buffer);
}

export function deserializeEmbedding(buf: Buffer): number[] {
  return Array.from(
    new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4),
  );
}

// ── Core Content ────────────────────────────────────────────────────

export const categories = sqliteTable("categories", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").unique().notNull(),
  slug: text("slug").unique().notNull(),
  icon: text("icon").notNull(),
  description: text("description").notNull(),
  gradientFrom: text("gradient_from").notNull(),
  gradientTo: text("gradient_to").notNull(),
  sortOrder: integer("sort_order").notNull(),
  lessonRangeLo: integer("lesson_range_lo").notNull(),
  lessonRangeHi: integer("lesson_range_hi").notNull(),
});

export const lessons = sqliteTable(
  "lessons",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    slug: text("slug").unique().notNull(),
    number: integer("number").unique().notNull(),
    title: text("title").notNull(),
    categoryId: integer("category_id")
      .references(() => categories.id)
      .notNull(),
    wordCount: integer("word_count").notNull().default(0),
    readingTimeMin: integer("reading_time_min").notNull().default(1),
    content: text("content").notNull(),
    summary: text("summary"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("lessons_category_idx").on(table.categoryId),
    index("lessons_number_idx").on(table.number),
  ],
);

export const lessonSections = sqliteTable(
  "lesson_sections",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    lessonId: text("lesson_id")
      .references(() => lessons.id, { onDelete: "cascade" })
      .notNull(),
    heading: text("heading").notNull(),
    headingLevel: integer("heading_level").notNull().default(2),
    content: text("content").notNull(),
    sectionOrder: integer("section_order").notNull(),
    wordCount: integer("word_count").notNull().default(0),
  },
  (table) => [index("lesson_sections_lesson_idx").on(table.lessonId)],
);

// ── Knowledge Graph ─────────────────────────────────────────────────

export const concepts = sqliteTable(
  "concepts",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    name: text("name").unique().notNull(),
    description: text("description"),
    conceptType: text("concept_type").notNull().default("topic"),
    metadata: text("metadata", { mode: "json" }).notNull().$type<Record<string, unknown>>().default({}),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [index("concepts_type_idx").on(table.conceptType)],
);

export const conceptEdges = sqliteTable(
  "concept_edges",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    sourceId: text("source_id")
      .references(() => concepts.id, { onDelete: "cascade" })
      .notNull(),
    targetId: text("target_id")
      .references(() => concepts.id, { onDelete: "cascade" })
      .notNull(),
    edgeType: text("edge_type").notNull(),
    weight: real("weight").notNull().default(1.0),
    metadata: text("metadata", { mode: "json" }).notNull().$type<Record<string, unknown>>().default({}),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("concept_edges_source_target_type_idx").on(
      table.sourceId,
      table.targetId,
      table.edgeType,
    ),
    index("concept_edges_source_idx").on(table.sourceId),
    index("concept_edges_target_idx").on(table.targetId),
    index("concept_edges_type_idx").on(table.edgeType),
  ],
);

export const lessonConcepts = sqliteTable(
  "lesson_concepts",
  {
    lessonId: text("lesson_id")
      .references(() => lessons.id, { onDelete: "cascade" })
      .notNull(),
    conceptId: text("concept_id")
      .references(() => concepts.id, { onDelete: "cascade" })
      .notNull(),
    relevance: real("relevance").notNull().default(1.0),
  },
  (table) => [primaryKey({ columns: [table.lessonId, table.conceptId] })],
);

// ── Knowledge Tracing ───────────────────────────────────────────────

export const userProfiles = sqliteTable("user_profiles", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  displayName: text("display_name"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const knowledgeStates = sqliteTable(
  "knowledge_states",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .references(() => userProfiles.id, { onDelete: "cascade" })
      .notNull(),
    conceptId: text("concept_id")
      .references(() => concepts.id, { onDelete: "cascade" })
      .notNull(),
    pMastery: real("p_mastery").notNull().default(0.0),
    pTransit: real("p_transit").notNull().default(0.1),
    pSlip: real("p_slip").notNull().default(0.1),
    pGuess: real("p_guess").notNull().default(0.2),
    totalInteractions: integer("total_interactions").notNull().default(0),
    correctInteractions: integer("correct_interactions").notNull().default(0),
    masteryLevel: text("mastery_level").notNull().default("novice"),
    lastInteractionAt: integer("last_interaction_at", { mode: "timestamp" }),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("knowledge_states_user_concept_idx").on(
      table.userId,
      table.conceptId,
    ),
    index("knowledge_states_user_idx").on(table.userId),
    index("knowledge_states_concept_idx").on(table.conceptId),
    index("knowledge_states_mastery_idx").on(table.userId, table.masteryLevel),
  ],
);

export const interactionEvents = sqliteTable(
  "interaction_events",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .references(() => userProfiles.id, { onDelete: "cascade" })
      .notNull(),
    conceptId: text("concept_id").references(() => concepts.id, {
      onDelete: "set null",
    }),
    lessonId: text("lesson_id").references(() => lessons.id, {
      onDelete: "set null",
    }),
    sectionId: text("section_id").references(() => lessonSections.id, {
      onDelete: "set null",
    }),
    interactionType: text("interaction_type").notNull(),
    isCorrect: integer("is_correct", { mode: "boolean" }),
    responseTimeMs: integer("response_time_ms"),
    metadata: text("metadata", { mode: "json" }).notNull().$type<Record<string, unknown>>().default({}),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("interaction_events_user_time_idx").on(table.userId, table.createdAt),
    index("interaction_events_user_concept_idx").on(
      table.userId,
      table.conceptId,
      table.createdAt,
    ),
    index("interaction_events_lesson_idx").on(table.lessonId),
    index("interaction_events_type_idx").on(table.interactionType),
  ],
);

// ── Embeddings ──────────────────────────────────────────────────────

export const lessonEmbeddings = sqliteTable("lesson_embeddings", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  lessonId: text("lesson_id")
    .references(() => lessons.id, { onDelete: "cascade" })
    .notNull()
    .unique(),
  content: text("content").notNull(),
  embedding: blob("embedding", { mode: "buffer" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const sectionEmbeddings = sqliteTable(
  "section_embeddings",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    sectionId: text("section_id")
      .references(() => lessonSections.id, { onDelete: "cascade" })
      .notNull()
      .unique(),
    lessonId: text("lesson_id")
      .references(() => lessons.id, { onDelete: "cascade" })
      .notNull(),
    content: text("content").notNull(),
    embedding: blob("embedding", { mode: "buffer" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [index("section_embeddings_lesson_idx").on(table.lessonId)],
);

export const conceptEmbeddings = sqliteTable("concept_embeddings", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  conceptId: text("concept_id")
    .references(() => concepts.id, { onDelete: "cascade" })
    .notNull()
    .unique(),
  content: text("content").notNull(),
  embedding: blob("embedding", { mode: "buffer" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const userLessonInteractions = sqliteTable(
  "user_lesson_interactions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .references(() => userProfiles.id, { onDelete: "cascade" })
      .notNull(),
    lessonId: text("lesson_id")
      .references(() => lessons.id, { onDelete: "cascade" })
      .notNull(),
    readProgress: real("read_progress").notNull().default(0),
    rating: integer("rating"),
    bookmarked: integer("bookmarked", { mode: "boolean" }).notNull().default(false),
    timeSpentSec: integer("time_spent_sec").notNull().default(0),
    firstViewedAt: integer("first_viewed_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    lastViewedAt: integer("last_viewed_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("user_lesson_interactions_user_lesson_idx").on(
      table.userId,
      table.lessonId,
    ),
    index("user_lesson_interactions_user_idx").on(table.userId),
    index("user_lesson_interactions_lesson_idx").on(table.lessonId),
  ],
);

// ── Chat Messages ───────────────────────────────────────────────────

export const chatMessages = sqliteTable(
  "chat_messages",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    threadId: text("thread_id").notNull(),
    role: text("role").notNull(),
    content: text("content").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("chat_messages_thread_time_idx").on(table.threadId, table.createdAt),
  ],
);

// ── Analytics ───────────────────────────────────────────────────────

export const analyticsEvents = sqliteTable(
  "analytics_events",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id"),
    sessionId: text("session_id"),
    eventName: text("event_name").notNull(),
    eventCategory: text("event_category").notNull(),
    lessonId: text("lesson_id").references(() => lessons.id, {
      onDelete: "set null",
    }),
    properties: text("properties", { mode: "json" }).notNull().$type<Record<string, unknown>>().default({}),
    durationMs: integer("duration_ms"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("analytics_events_user_time_idx").on(table.userId, table.createdAt),
    index("analytics_events_name_time_idx").on(
      table.eventName,
      table.createdAt,
    ),
    index("analytics_events_lesson_time_idx").on(table.lessonId, table.createdAt),
    index("analytics_events_session_idx").on(table.sessionId, table.createdAt),
  ],
);

// ── Job Applications ────────────────────────────────────────────────

export const applications = sqliteTable(
  "applications",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id").notNull(),
    slug: text("slug").notNull(),
    company: text("company").notNull(),
    position: text("position").notNull(),
    url: text("url"),
    status: text("status").notNull().default("saved"),
    notes: text("notes"),
    jobDescription: text("job_description"),
    aiInterviewQuestions: text("ai_interview_questions"),
    aiTechStack: text("ai_tech_stack"),
    techDismissedTags: text("tech_dismissed_tags"),
    appliedAt: integer("applied_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("applications_user_idx").on(table.userId),
    index("applications_status_idx").on(table.userId, table.status),
  ],
);

// ── Resumes ─────────────────────────────────────────────────────────

export const resumes = sqliteTable(
  "resumes",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    filename: text("filename"),
    rawText: text("raw_text"),
    extractedSkills: text("extracted_skills"),
    taxonomyVersion: text("taxonomy_version"),
    createdAt: text("created_at"),
    updatedAt: text("updated_at"),
  },
  (table) => [
    uniqueIndex("resumes_user_id_unique").on(table.userId),
    index("resumes_user_id_idx").on(table.userId),
  ],
);

export type Resume = typeof resumes.$inferSelect;
export type NewResume = typeof resumes.$inferInsert;

// ── External Courses ────────────────────────────────────────────────

export const externalCourses = sqliteTable(
  "external_courses",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    title: text("title").notNull(),
    url: text("url").notNull().unique(),
    provider: text("provider").notNull(),
    description: text("description"),
    level: text("level"),
    rating: real("rating"),
    reviewCount: integer("review_count"),
    durationHours: real("duration_hours"),
    isFree: integer("is_free", { mode: "boolean" }).notNull().default(true),
    enrolled: integer("enrolled"),
    imageUrl: text("image_url"),
    language: text("language").notNull().default("English"),
    topicGroup: text("topic_group"),
    metadata: text("metadata", { mode: "json" }).$type<Record<string, unknown>>().default({}),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [index("external_courses_provider_idx").on(table.provider)],
);

export const lessonCourses = sqliteTable(
  "lesson_courses",
  {
    lessonSlug: text("lesson_slug").notNull(),
    courseId: text("course_id")
      .references(() => externalCourses.id, { onDelete: "cascade" })
      .notNull(),
    relevance: real("relevance").notNull().default(1.0),
  },
  (table) => [
    primaryKey({ columns: [table.lessonSlug, table.courseId] }),
    index("lesson_courses_slug_idx").on(table.lessonSlug),
  ],
);

export type ExternalCourse = typeof externalCourses.$inferSelect;

export const courseReviews = sqliteTable(
  "course_reviews",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    courseId: text("course_id")
      .references(() => externalCourses.id, { onDelete: "cascade" })
      .notNull(),
    pedagogyScore: integer("pedagogy_score"),
    technicalAccuracyScore: integer("technical_accuracy_score"),
    contentDepthScore: integer("content_depth_score"),
    practicalApplicationScore: integer("practical_application_score"),
    instructorClarityScore: integer("instructor_clarity_score"),
    curriculumFitScore: integer("curriculum_fit_score"),
    prerequisitesScore: integer("prerequisites_score"),
    aiDomainRelevanceScore: integer("ai_domain_relevance_score"),
    communityHealthScore: integer("community_health_score"),
    valuePropositionScore: integer("value_proposition_score"),
    aggregateScore: real("aggregate_score"),
    verdict: text("verdict"),
    summary: text("summary"),
    expertDetails: text("expert_details", { mode: "json" }).$type<Record<string, unknown>>(),
    modelVersion: text("model_version").notNull().default("deepseek-chat"),
    reviewedAt: integer("reviewed_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("course_reviews_course_idx").on(table.courseId),
    uniqueIndex("course_reviews_course_unique").on(table.courseId),
  ],
);

export type CourseReview = typeof courseReviews.$inferSelect;
export type NewCourseReview = typeof courseReviews.$inferInsert;

// ── Public Job Listings ─────────────────────────────────────────────

export const publicJobs = sqliteTable(
  "public_jobs",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    slug: text("slug").unique().notNull(),
    company: text("company").notNull(),
    position: text("position").notNull(),
    location: text("location"),
    url: text("url"),
    description: text("description").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [index("public_jobs_slug_idx").on(table.slug)],
);

export type PublicJob = typeof publicJobs.$inferSelect;

// ── Relations ───────────────────────────────────────────────────────

export const categoriesRelations = relations(categories, ({ many }) => ({
  lessons: many(lessons),
}));

export const lessonsRelations = relations(lessons, ({ one, many }) => ({
  category: one(categories, {
    fields: [lessons.categoryId],
    references: [categories.id],
  }),
  sections: many(lessonSections),
  lessonConcepts: many(lessonConcepts),
}));

export const lessonSectionsRelations = relations(lessonSections, ({ one }) => ({
  lesson: one(lessons, {
    fields: [lessonSections.lessonId],
    references: [lessons.id],
  }),
}));

export const conceptsRelations = relations(concepts, ({ many }) => ({
  outgoingEdges: many(conceptEdges, { relationName: "source" }),
  incomingEdges: many(conceptEdges, { relationName: "target" }),
  lessonConcepts: many(lessonConcepts),
}));

export const conceptEdgesRelations = relations(conceptEdges, ({ one }) => ({
  source: one(concepts, {
    fields: [conceptEdges.sourceId],
    references: [concepts.id],
    relationName: "source",
  }),
  target: one(concepts, {
    fields: [conceptEdges.targetId],
    references: [concepts.id],
    relationName: "target",
  }),
}));

export const lessonConceptsRelations = relations(lessonConcepts, ({ one }) => ({
  lesson: one(lessons, {
    fields: [lessonConcepts.lessonId],
    references: [lessons.id],
  }),
  concept: one(concepts, {
    fields: [lessonConcepts.conceptId],
    references: [concepts.id],
  }),
}));

export const externalCoursesRelations = relations(
  externalCourses,
  ({ many }) => ({
    lessonCourses: many(lessonCourses),
    reviews: many(courseReviews),
  }),
);

export const courseReviewsRelations = relations(courseReviews, ({ one }) => ({
  course: one(externalCourses, {
    fields: [courseReviews.courseId],
    references: [externalCourses.id],
  }),
}));
