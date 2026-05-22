import {
  sqliteTable,
  text,
  integer,
  real,
  primaryKey,
  uniqueIndex,
  index,
} from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";

// ── Better Auth tables ──────────────────────────────────────────────
// SQLite/D1 variant (kept dialect-aligned with the rest of this schema).
// Postgres consumers (bricks, lead-gen) keep importing @ai-apps/auth/schema.

export { user, session, account, verification } from "@ai-apps/auth/schema-sqlite";

// ── Helpers ────────────────────────────────────────────────────────
// uuid() in Postgres → text PK with an app-generated UUID on SQLite.
const uuidPk = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

// timestamptz DEFAULT now() → integer epoch (mode:"timestamp") set at insert.
const nowTs = (col: string) =>
  integer(col, { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date());

// ── Core Content ───────────────────────────────────────────────────

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
    id: uuidPk(),
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
    createdAt: nowTs("created_at"),
    updatedAt: nowTs("updated_at"),
  },
  (table) => [
    index("lessons_category_idx").on(table.categoryId),
    index("lessons_number_idx").on(table.number),
  ],
);

export const lessonSections = sqliteTable(
  "lesson_sections",
  {
    id: uuidPk(),
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

// ── Knowledge Graph ────────────────────────────────────────────────

export const concepts = sqliteTable(
  "concepts",
  {
    id: uuidPk(),
    name: text("name").unique().notNull(),
    description: text("description"),
    conceptType: text("concept_type", {
      enum: ["topic", "skill", "competency", "technique", "theory", "tool"],
    })
      .notNull()
      .default("topic"),
    metadata: text("metadata", { mode: "json" })
      .$type<Record<string, unknown>>()
      .notNull()
      .$defaultFn(() => ({})),
    createdAt: nowTs("created_at"),
  },
  (table) => [index("concepts_type_idx").on(table.conceptType)],
);

export const conceptEdges = sqliteTable(
  "concept_edges",
  {
    id: uuidPk(),
    sourceId: text("source_id")
      .references(() => concepts.id, { onDelete: "cascade" })
      .notNull(),
    targetId: text("target_id")
      .references(() => concepts.id, { onDelete: "cascade" })
      .notNull(),
    edgeType: text("edge_type", {
      enum: [
        "prerequisite",
        "related",
        "part_of",
        "builds_on",
        "contrasts_with",
        "applies_to",
      ],
    }).notNull(),
    weight: real("weight").notNull().default(1.0),
    metadata: text("metadata", { mode: "json" })
      .$type<Record<string, unknown>>()
      .notNull()
      .$defaultFn(() => ({})),
    createdAt: nowTs("created_at"),
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

// ── Knowledge Tracing ──────────────────────────────────────────────

export const userProfiles = sqliteTable("user_profiles", {
  id: uuidPk(),
  displayName: text("display_name"),
  createdAt: nowTs("created_at"),
  updatedAt: nowTs("updated_at"),
});

export const knowledgeStates = sqliteTable(
  "knowledge_states",
  {
    id: uuidPk(),
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
    masteryLevel: text("mastery_level", {
      enum: ["novice", "beginner", "intermediate", "proficient", "expert"],
    })
      .notNull()
      .default("novice"),
    lastInteractionAt: integer("last_interaction_at", { mode: "timestamp" }),
    updatedAt: nowTs("updated_at"),
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
    id: uuidPk(),
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
    interactionType: text("interaction_type", {
      enum: [
        "view",
        "read_start",
        "read_complete",
        "bookmark",
        "highlight",
        "search",
        "concept_click",
        "nav_next",
        "nav_prev",
      ],
    }).notNull(),
    isCorrect: integer("is_correct", { mode: "boolean" }),
    responseTimeMs: integer("response_time_ms"),
    metadata: text("metadata", { mode: "json" })
      .$type<Record<string, unknown>>()
      .notNull()
      .$defaultFn(() => ({})),
    createdAt: nowTs("created_at"),
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
// pgvector(1024) → JSON array stored as text. Populated by the offline Rust
// pipeline; not read by the TS app at runtime.

export const lessonEmbeddings = sqliteTable("lesson_embeddings", {
  id: uuidPk(),
  lessonId: text("lesson_id")
    .references(() => lessons.id, { onDelete: "cascade" })
    .notNull()
    .unique(),
  content: text("content").notNull(),
  embedding: text("embedding").notNull(),
  createdAt: nowTs("created_at"),
});

export const sectionEmbeddings = sqliteTable(
  "section_embeddings",
  {
    id: uuidPk(),
    sectionId: text("section_id")
      .references(() => lessonSections.id, { onDelete: "cascade" })
      .notNull()
      .unique(),
    lessonId: text("lesson_id")
      .references(() => lessons.id, { onDelete: "cascade" })
      .notNull(),
    content: text("content").notNull(),
    embedding: text("embedding").notNull(),
    createdAt: nowTs("created_at"),
  },
  (table) => [index("section_embeddings_lesson_idx").on(table.lessonId)],
);

export const conceptEmbeddings = sqliteTable("concept_embeddings", {
  id: uuidPk(),
  conceptId: text("concept_id")
    .references(() => concepts.id, { onDelete: "cascade" })
    .notNull()
    .unique(),
  content: text("content").notNull(),
  embedding: text("embedding").notNull(),
  createdAt: nowTs("created_at"),
});

export const userLessonInteractions = sqliteTable(
  "user_lesson_interactions",
  {
    id: uuidPk(),
    userId: text("user_id")
      .references(() => userProfiles.id, { onDelete: "cascade" })
      .notNull(),
    lessonId: text("lesson_id")
      .references(() => lessons.id, { onDelete: "cascade" })
      .notNull(),
    readProgress: real("read_progress").notNull().default(0),
    rating: integer("rating"),
    bookmarked: integer("bookmarked", { mode: "boolean" })
      .notNull()
      .default(false),
    timeSpentSec: integer("time_spent_sec").notNull().default(0),
    firstViewedAt: nowTs("first_viewed_at"),
    lastViewedAt: nowTs("last_viewed_at"),
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

export const chatMessages = sqliteTable(
  "chat_messages",
  {
    id: uuidPk(),
    threadId: text("thread_id").notNull(),
    role: text("role").notNull(), // "user" | "assistant"
    content: text("content").notNull(),
    createdAt: nowTs("created_at"),
  },
  (table) => [
    index("chat_messages_thread_time_idx").on(table.threadId, table.createdAt),
  ],
);

// ── Analytics ──────────────────────────────────────────────────────

export const analyticsEvents = sqliteTable(
  "analytics_events",
  {
    id: uuidPk(),
    userId: text("user_id"),
    sessionId: text("session_id"),
    eventName: text("event_name").notNull(),
    eventCategory: text("event_category").notNull(),
    lessonId: text("lesson_id").references(() => lessons.id, {
      onDelete: "set null",
    }),
    properties: text("properties", { mode: "json" })
      .$type<Record<string, unknown>>()
      .notNull()
      .$defaultFn(() => ({})),
    durationMs: integer("duration_ms"),
    createdAt: nowTs("created_at"),
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

export const applications = sqliteTable(
  "applications",
  {
    id: uuidPk(),
    userId: text("user_id").notNull(),
    slug: text("slug").notNull(),
    company: text("company").notNull(),
    position: text("position").notNull(),
    url: text("url"),
    status: text("status", {
      enum: ["saved", "applied", "interviewing", "offer", "rejected"],
    })
      .notNull()
      .default("saved"),
    notes: text("notes"),
    jobDescription: text("job_description"),
    interviewQuestions: text("interview_questions"),
    techStack: text("tech_stack"),
    techDismissedTags: text("tech_dismissed_tags"),
    interviewers: text("interviewers"),
    memorizeCategories: text("memorize_categories"),
    // Soft FK into lead-gen's companies.key (see @ai-apps/company-intel).
    // Populated by resolveCompanyKey() on create/update; null when no match.
    leadgenCompanyKey: text("leadgen_company_key"),
    audioUrl: text("audio_url"),
    public: integer("public", { mode: "boolean" }).notNull().default(false),
    appliedAt: integer("applied_at", { mode: "timestamp" }),
    createdAt: nowTs("created_at"),
    updatedAt: nowTs("updated_at"),
  },
  (table) => [
    index("applications_user_idx").on(table.userId),
    index("applications_status_idx").on(table.userId, table.status),
    uniqueIndex("applications_slug_idx").on(table.userId, table.slug),
  ],
);

// ── Resumes ──────────────────────────────────────────────────────

export const resumes = sqliteTable(
  "resumes",
  {
    id: text("id").primaryKey(), // UUID
    userId: text("user_id").notNull(),
    filename: text("filename"),
    rawText: text("raw_text"),
    extractedSkills: text("extracted_skills"), // JSON
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

// ── External Courses ─────────────────────────────────────────────
// Moved off Neon Postgres into a dedicated SQLite store. The write side is
// src/db/courses-sqlite.ts (data/courses.db); the read side is the
// Rust-exported courses.json / course-reviews.json via lib/db/queries.ts.

// ── Application Notes ─────────────────────────────────────────────

export const applicationNotes = sqliteTable(
  "application_notes",
  {
    id: uuidPk(),
    applicationId: text("application_id")
      .references(() => applications.id, { onDelete: "cascade" })
      .notNull(),
    title: text("title").notNull(),
    content: text("content").notNull(),
    // "note" = general application note, "debrief" = post-interview feedback.
    kind: text("kind").notNull().default("note"),
    createdAt: nowTs("created_at"),
    updatedAt: nowTs("updated_at"),
  },
  (table) => [
    index("application_notes_app_idx").on(table.applicationId),
    index("application_notes_kind_idx").on(table.applicationId, table.kind),
  ],
);

export type ApplicationNote = typeof applicationNotes.$inferSelect;
export type NewApplicationNote = typeof applicationNotes.$inferInsert;

// ── Coursework ───────────────────────────────────────────────────

export const learners = sqliteTable(
  "learners",
  {
    id: uuidPk(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    age: integer("age").notNull(),
    createdAt: nowTs("created_at"),
  },
  (table) => [index("learners_user_idx").on(table.userId)],
);

export type Learner = typeof learners.$inferSelect;
export type NewLearner = typeof learners.$inferInsert;

export const coursework = sqliteTable(
  "coursework",
  {
    id: uuidPk(),
    learnerId: text("learner_id")
      .references(() => learners.id, { onDelete: "cascade" })
      .notNull(),
    userId: text("user_id").notNull(),
    title: text("title").notNull(),
    fileName: text("file_name").notNull(),
    fileUrl: text("file_url").notNull(),
    fileSize: integer("file_size").notNull(),
    mimeType: text("mime_type").notNull(),
    subject: text("subject"),
    submittedAt: nowTs("submitted_at"),
    createdAt: nowTs("created_at"),
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

export const problems = sqliteTable(
  "problems",
  {
    id: uuidPk(),
    slug: text("slug").unique().notNull(),
    title: text("title").notNull(),
    difficulty: text("difficulty", { enum: ["easy", "medium", "hard"] })
      .notNull()
      .default("easy"),
    prompt: text("prompt").notNull(), // markdown
    starterJs: text("starter_js").notNull(),
    starterTs: text("starter_ts").notNull(),
    // Each test: { name, args: any[], expected: any }
    testCases: text("test_cases", { mode: "json" })
      .$type<unknown[]>()
      .notNull()
      .$defaultFn(() => []),
    // Function name the runner should invoke (e.g. "twoSum")
    entrypoint: text("entrypoint").notNull(),
    tags: text("tags", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .$defaultFn(() => []),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: nowTs("created_at"),
    updatedAt: nowTs("updated_at"),
  },
  (table) => [
    index("problems_difficulty_idx").on(table.difficulty),
    index("problems_sort_idx").on(table.sortOrder),
  ],
);

export const problemSubmissions = sqliteTable(
  "problem_submissions",
  {
    id: uuidPk(),
    problemId: text("problem_id")
      .references(() => problems.id, { onDelete: "cascade" })
      .notNull(),
    userId: text("user_id").notNull(),
    language: text("language").notNull(), // "js" | "ts"
    code: text("code").notNull(),
    status: text("status", {
      enum: ["passed", "failed", "error", "timeout"],
    }).notNull(),
    passedCount: integer("passed_count").notNull().default(0),
    totalCount: integer("total_count").notNull().default(0),
    runtimeMs: real("runtime_ms"),
    errorMessage: text("error_message"),
    createdAt: nowTs("created_at"),
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
