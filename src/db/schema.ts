import {
  pgTable,
  pgEnum,
  uuid,
  text,
  serial,
  integer,
  real,
  timestamp,
  boolean,
  jsonb,
  primaryKey,
  uniqueIndex,
  index,
  customType,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { user as authUser } from "@ai-apps/auth/schema";

// ── Better Auth tables ──────────────────────────────────────────────

export { user, session, account, verification } from "@ai-apps/auth/schema";

// ── Custom type: pgvector ──────────────────────────────────────────

const vector = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return "vector(1024)";
  },
  toDriver(value: number[]): string {
    return `[${value.join(",")}]`;
  },
  fromDriver(value: string): number[] {
    return value
      .slice(1, -1)
      .split(",")
      .map(Number);
  },
});

// ── Enums ──────────────────────────────────────────────────────────

export const conceptTypeEnum = pgEnum("concept_type", [
  "topic",
  "skill",
  "competency",
  "technique",
  "theory",
  "tool",
]);

export const edgeTypeEnum = pgEnum("edge_type", [
  "prerequisite",
  "related",
  "part_of",
  "builds_on",
  "contrasts_with",
  "applies_to",
]);

export const interactionTypeEnum = pgEnum("interaction_type", [
  "view",
  "read_start",
  "read_complete",
  "bookmark",
  "highlight",
  "search",
  "concept_click",
  "nav_next",
  "nav_prev",
]);

export const masteryLevelEnum = pgEnum("mastery_level", [
  "novice",
  "beginner",
  "intermediate",
  "proficient",
  "expert",
]);

// ── Core Content ───────────────────────────────────────────────────

export const categories = pgTable("categories", {
  id: serial("id").primaryKey(),
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

export const lessons = pgTable(
  "lessons",
  {
    id: uuid("id").primaryKey().defaultRandom(),
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
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("lessons_category_idx").on(table.categoryId),
    index("lessons_number_idx").on(table.number),
  ],
);

export const lessonSections = pgTable(
  "lesson_sections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    lessonId: uuid("lesson_id")
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

// ── Knowledge Graph ────────────────────────────────────────────────

export const concepts = pgTable(
  "concepts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").unique().notNull(),
    description: text("description"),
    conceptType: conceptTypeEnum("concept_type").notNull().default("topic"),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("concepts_type_idx").on(table.conceptType)],
);

export const conceptEdges = pgTable(
  "concept_edges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceId: uuid("source_id")
      .references(() => concepts.id, { onDelete: "cascade" })
      .notNull(),
    targetId: uuid("target_id")
      .references(() => concepts.id, { onDelete: "cascade" })
      .notNull(),
    edgeType: edgeTypeEnum("edge_type").notNull(),
    weight: real("weight").notNull().default(1.0),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
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

export const lessonConcepts = pgTable(
  "lesson_concepts",
  {
    lessonId: uuid("lesson_id")
      .references(() => lessons.id, { onDelete: "cascade" })
      .notNull(),
    conceptId: uuid("concept_id")
      .references(() => concepts.id, { onDelete: "cascade" })
      .notNull(),
    relevance: real("relevance").notNull().default(1.0),
  },
  (table) => [primaryKey({ columns: [table.lessonId, table.conceptId] })],
);

// ── Knowledge Tracing ──────────────────────────────────────────────

export const userProfiles = pgTable("user_profiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  displayName: text("display_name"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const knowledgeStates = pgTable(
  "knowledge_states",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .references(() => userProfiles.id, { onDelete: "cascade" })
      .notNull(),
    conceptId: uuid("concept_id")
      .references(() => concepts.id, { onDelete: "cascade" })
      .notNull(),
    pMastery: real("p_mastery").notNull().default(0.0),
    pTransit: real("p_transit").notNull().default(0.1),
    pSlip: real("p_slip").notNull().default(0.1),
    pGuess: real("p_guess").notNull().default(0.2),
    totalInteractions: integer("total_interactions").notNull().default(0),
    correctInteractions: integer("correct_interactions").notNull().default(0),
    masteryLevel: masteryLevelEnum("mastery_level")
      .notNull()
      .default("novice"),
    lastInteractionAt: timestamp("last_interaction_at", {
      withTimezone: true,
    }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
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

export const interactionEvents = pgTable(
  "interaction_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .references(() => userProfiles.id, { onDelete: "cascade" })
      .notNull(),
    conceptId: uuid("concept_id").references(() => concepts.id, {
      onDelete: "set null",
    }),
    lessonId: uuid("lesson_id").references(() => lessons.id, {
      onDelete: "set null",
    }),
    sectionId: uuid("section_id").references(() => lessonSections.id, {
      onDelete: "set null",
    }),
    interactionType: interactionTypeEnum("interaction_type").notNull(),
    isCorrect: boolean("is_correct"),
    responseTimeMs: integer("response_time_ms"),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
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

// ── Embeddings ─────────────────────────────────────────────────────

export const lessonEmbeddings = pgTable("lesson_embeddings", {
  id: uuid("id").primaryKey().defaultRandom(),
  lessonId: uuid("lesson_id")
    .references(() => lessons.id, { onDelete: "cascade" })
    .notNull()
    .unique(),
  content: text("content").notNull(),
  embedding: vector("embedding").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const sectionEmbeddings = pgTable(
  "section_embeddings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sectionId: uuid("section_id")
      .references(() => lessonSections.id, { onDelete: "cascade" })
      .notNull()
      .unique(),
    lessonId: uuid("lesson_id")
      .references(() => lessons.id, { onDelete: "cascade" })
      .notNull(),
    content: text("content").notNull(),
    embedding: vector("embedding").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("section_embeddings_lesson_idx").on(table.lessonId)],
);

export const conceptEmbeddings = pgTable("concept_embeddings", {
  id: uuid("id").primaryKey().defaultRandom(),
  conceptId: uuid("concept_id")
    .references(() => concepts.id, { onDelete: "cascade" })
    .notNull()
    .unique(),
  content: text("content").notNull(),
  embedding: vector("embedding").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const userLessonInteractions = pgTable(
  "user_lesson_interactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .references(() => userProfiles.id, { onDelete: "cascade" })
      .notNull(),
    lessonId: uuid("lesson_id")
      .references(() => lessons.id, { onDelete: "cascade" })
      .notNull(),
    readProgress: real("read_progress").notNull().default(0),
    rating: integer("rating"),
    bookmarked: boolean("bookmarked").notNull().default(false),
    timeSpentSec: integer("time_spent_sec").notNull().default(0),
    firstViewedAt: timestamp("first_viewed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastViewedAt: timestamp("last_viewed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
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

// ── Chat Messages ─────────────────────────────────────────────────

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    threadId: text("thread_id").notNull(),
    role: text("role").notNull(), // "user" | "assistant"
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("chat_messages_thread_time_idx").on(table.threadId, table.createdAt),
  ],
);

// ── Analytics ──────────────────────────────────────────────────────

export const analyticsEvents = pgTable(
  "analytics_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id"),
    sessionId: text("session_id"),
    eventName: text("event_name").notNull(),
    eventCategory: text("event_category").notNull(),
    lessonId: uuid("lesson_id").references(() => lessons.id, {
      onDelete: "set null",
    }),
    properties: jsonb("properties").notNull().default({}),
    durationMs: integer("duration_ms"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
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

// ── Job Applications ───────────────────────────────────────────────

export const applicationStatusEnum = pgEnum("application_status", [
  "saved",
  "applied",
  "interviewing",
  "offer",
  "rejected",
]);

export const applications = pgTable(
  "applications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    slug: text("slug").notNull(),
    company: text("company").notNull(),
    position: text("position").notNull(),
    url: text("url"),
    status: applicationStatusEnum("status").notNull().default("saved"),
    notes: text("notes"),
    jobDescription: text("job_description"),
    aiInterviewQuestions: text("ai_interview_questions"),
    aiTechStack: text("ai_tech_stack"),
    techDismissedTags: text("tech_dismissed_tags"),
    aiInterviewers: text("ai_interviewers"),
    aiMemorizeCategories: text("ai_memorize_categories"),
    // Soft FK into lead-gen's companies.key (see @ai-apps/company-intel).
    // Populated by resolveCompanyKey() on create/update; null when no match.
    leadgenCompanyKey: text("leadgen_company_key"),
    public: boolean("public").notNull().default(false),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("applications_user_idx").on(table.userId),
    index("applications_status_idx").on(table.userId, table.status),
    uniqueIndex("applications_slug_idx").on(table.userId, table.slug),
  ],
);

// ── Resumes ──────────────────────────────────────────────────────

export const resumes = pgTable("resumes", {
  id: text("id").primaryKey(), // UUID
  userId: text("user_id").notNull(),
  filename: text("filename"),
  rawText: text("raw_text"),
  extractedSkills: text("extracted_skills"), // JSON
  taxonomyVersion: text("taxonomy_version"),
  createdAt: text("created_at"),
  updatedAt: text("updated_at"),
}, (table) => [
  uniqueIndex("resumes_user_id_unique").on(table.userId),
  index("resumes_user_id_idx").on(table.userId),
]);

export type Resume = typeof resumes.$inferSelect;
export type NewResume = typeof resumes.$inferInsert;

// ── External Courses ─────────────────────────────────────────────

export const externalCourses = pgTable(
  "external_courses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    url: text("url").notNull().unique(),
    provider: text("provider").notNull(),
    description: text("description"),
    level: text("level"), // "Beginner" | "Intermediate" | "Advanced"
    rating: real("rating"),
    reviewCount: integer("review_count"),
    durationHours: real("duration_hours"),
    isFree: boolean("is_free").notNull().default(true),
    enrolled: integer("enrolled"),
    imageUrl: text("image_url"),
    language: text("language").notNull().default("English"),
    topicGroup: text("topic_group"),
    metadata: jsonb("metadata").default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("external_courses_provider_idx").on(table.provider),
  ],
);

export const lessonCourses = pgTable(
  "lesson_courses",
  {
    lessonSlug: text("lesson_slug").notNull(),
    courseId: uuid("course_id")
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

export const courseReviews = pgTable(
  "course_reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    courseId: uuid("course_id")
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
    expertDetails: jsonb("expert_details"),
    modelVersion: text("model_version").notNull().default("deepseek-chat"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("course_reviews_course_idx").on(table.courseId),
    uniqueIndex("course_reviews_course_unique").on(table.courseId),
  ],
);

export type CourseReview = typeof courseReviews.$inferSelect;
export type NewCourseReview = typeof courseReviews.$inferInsert;

// ── Application Notes ─────────────────────────────────────────────

export const applicationNotes = pgTable(
  "application_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    applicationId: uuid("application_id")
      .references(() => applications.id, { onDelete: "cascade" })
      .notNull(),
    title: text("title").notNull(),
    content: text("content").notNull(),
    // "note" = general application note, "debrief" = post-interview feedback.
    kind: text("kind").notNull().default("note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("application_notes_app_idx").on(table.applicationId),
    index("application_notes_kind_idx").on(table.applicationId, table.kind),
  ],
);

export type ApplicationNote = typeof applicationNotes.$inferSelect;
export type NewApplicationNote = typeof applicationNotes.$inferInsert;

// ── Coursework ───────────────────────────────────────────────────

export const learners = pgTable(
  "learners",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    age: integer("age").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("learners_user_idx").on(table.userId)],
);

export type Learner = typeof learners.$inferSelect;
export type NewLearner = typeof learners.$inferInsert;

export const coursework = pgTable(
  "coursework",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    learnerId: uuid("learner_id")
      .references(() => learners.id, { onDelete: "cascade" })
      .notNull(),
    userId: text("user_id").notNull(),
    title: text("title").notNull(),
    fileName: text("file_name").notNull(),
    fileUrl: text("file_url").notNull(),
    fileSize: integer("file_size").notNull(),
    mimeType: text("mime_type").notNull(),
    subject: text("subject"),
    submittedAt: timestamp("submitted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("coursework_learner_idx").on(table.learnerId),
    index("coursework_user_idx").on(table.userId),
  ],
);

export type Coursework = typeof coursework.$inferSelect;
export type NewCoursework = typeof coursework.$inferInsert;

// ── Relations ──────────────────────────────────────────────────────

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

export const externalCoursesRelations = relations(externalCourses, ({ many }) => ({
  lessonCourses: many(lessonCourses),
  reviews: many(courseReviews),
}));

export const courseReviewsRelations = relations(courseReviews, ({ one }) => ({
  course: one(externalCourses, {
    fields: [courseReviews.courseId],
    references: [externalCourses.id],
  }),
}));

export const applicationsRelations = relations(applications, ({ many }) => ({
  applicationNotes: many(applicationNotes),
}));

export const applicationNotesRelations = relations(applicationNotes, ({ one }) => ({
  application: one(applications, {
    fields: [applicationNotes.applicationId],
    references: [applications.id],
  }),
}));

export const learnersRelations = relations(learners, ({ many }) => ({
  coursework: many(coursework),
}));

export const courseworkRelations = relations(coursework, ({ one }) => ({
  learner: one(learners, {
    fields: [coursework.learnerId],
    references: [learners.id],
  }),
}));

// ── Coding Problems (LeetCode-style) ───────────────────────────────

export const problemDifficultyEnum = pgEnum("problem_difficulty", [
  "easy",
  "medium",
  "hard",
]);

export const submissionStatusEnum = pgEnum("submission_status", [
  "passed",
  "failed",
  "error",
  "timeout",
]);

export const problems = pgTable(
  "problems",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").unique().notNull(),
    title: text("title").notNull(),
    difficulty: problemDifficultyEnum("difficulty").notNull().default("easy"),
    prompt: text("prompt").notNull(), // markdown
    starterJs: text("starter_js").notNull(),
    starterTs: text("starter_ts").notNull(),
    // Each test: { name, args: any[], expected: any }
    testCases: jsonb("test_cases").notNull().default([]),
    // Function name the runner should invoke (e.g. "twoSum")
    entrypoint: text("entrypoint").notNull(),
    tags: jsonb("tags").notNull().default([]),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("problems_difficulty_idx").on(table.difficulty),
    index("problems_sort_idx").on(table.sortOrder),
  ],
);

export const problemSubmissions = pgTable(
  "problem_submissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    problemId: uuid("problem_id")
      .references(() => problems.id, { onDelete: "cascade" })
      .notNull(),
    userId: text("user_id").notNull(),
    language: text("language").notNull(), // "js" | "ts"
    code: text("code").notNull(),
    status: submissionStatusEnum("status").notNull(),
    passedCount: integer("passed_count").notNull().default(0),
    totalCount: integer("total_count").notNull().default(0),
    runtimeMs: real("runtime_ms"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("problem_submissions_user_idx").on(table.userId, table.createdAt),
    index("problem_submissions_problem_idx").on(table.problemId, table.createdAt),
    index("problem_submissions_user_problem_idx").on(
      table.userId,
      table.problemId,
      table.status,
    ),
  ],
);

export const problemsRelations = relations(problems, ({ many }) => ({
  submissions: many(problemSubmissions),
}));

export const problemSubmissionsRelations = relations(
  problemSubmissions,
  ({ one }) => ({
    problem: one(problems, {
      fields: [problemSubmissions.problemId],
      references: [problems.id],
    }),
  }),
);
