import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import fs from "fs";
import path from "path";
import { CATEGORIES, CATEGORY_META, LESSON_NUMBER } from "../../lib/articles";
import * as schema from "../db/content-schema";

const DB_PATH =
  process.env.CONTENT_DB_PATH ||
  path.join(process.cwd(), "data", "knowledge.db");

// Ensure data directory exists
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

// Remove existing DB for clean seed
if (fs.existsSync(DB_PATH)) {
  fs.unlinkSync(DB_PATH);
  // Also remove WAL/SHM files if present
  for (const ext of ["-wal", "-shm"]) {
    const f = DB_PATH + ext;
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
}

const sqlite = new Database(DB_PATH);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("synchronous = normal");
sqlite.pragma("foreign_keys = ON");

const db = drizzle(sqlite, { schema });

const CONTENT_DIR = path.join(process.cwd(), "content");

/* ── helpers ────────────────────────────────────────────────────── */

function extractTitle(content: string): string {
  for (const line of content.split("\n")) {
    const match = line.match(/^#\s+(.+)/);
    if (match) return match[1].trim();
  }
  return "Untitled";
}

function getCategory(num: number): string {
  for (const [lo, hi, name] of CATEGORIES) {
    if (num >= lo && num <= hi) return name;
  }
  return "Other";
}

interface Section {
  heading: string;
  headingLevel: number;
  content: string;
  wordCount: number;
}

function splitSections(markdown: string): Section[] {
  const lines = markdown.split("\n");
  const sections: Section[] = [];
  let currentHeading = "Introduction";
  let currentLevel = 2;
  let currentLines: string[] = [];
  let pastTitle = false;

  for (const line of lines) {
    if (!pastTitle && /^#\s+/.test(line)) {
      pastTitle = true;
      continue;
    }

    const match = line.match(/^(#{2,3})\s+(.+)/);
    if (match) {
      const content = currentLines.join("\n").trim();
      if (content) {
        sections.push({
          heading: currentHeading,
          headingLevel: currentLevel,
          content,
          wordCount: content.split(/\s+/).filter(Boolean).length,
        });
      }
      pastTitle = true;
      currentHeading = match[2].trim();
      currentLevel = match[1].length;
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }

  const content = currentLines.join("\n").trim();
  if (content) {
    sections.push({
      heading: currentHeading,
      headingLevel: currentLevel,
      content,
      wordCount: content.split(/\s+/).filter(Boolean).length,
    });
  }

  return sections;
}

/* ── main ───────────────────────────────────────────────────────── */

function seed() {
  console.log(`Seeding SQLite database at ${DB_PATH}\n`);

  // ── 0. Create tables via Drizzle Kit push (inline) ───────────
  console.log("Creating tables...");

  // Use drizzle-kit push equivalent: run the migration folder if it exists,
  // otherwise create tables directly via raw SQL from the schema.
  const migrationsPath = path.join(process.cwd(), "drizzle-content");
  if (fs.existsSync(migrationsPath)) {
    migrate(db, { migrationsFolder: migrationsPath });
  } else {
    // Create tables directly
    createTables();
  }

  // ── 1. Seed categories ───────────────────────────────────────
  console.log("Seeding categories...");
  const categoryRows = CATEGORIES.map(([lo, hi, name], i) => {
    const meta = CATEGORY_META[name];
    return {
      name,
      slug: meta.slug,
      icon: meta.icon,
      description: meta.description,
      gradientFrom: meta.gradient[0],
      gradientTo: meta.gradient[1],
      lessonRangeLo: lo,
      lessonRangeHi: hi,
      sortOrder: i,
    };
  });

  const cats = db
    .insert(schema.categories)
    .values(categoryRows)
    .returning()
    .all();
  const catIdByName = new Map(cats.map((c) => [c.name, c.id]));
  console.log(`  ${cats.length} categories`);

  // ── 2. Read markdown files + seed lessons ─────────────────────
  console.log("Seeding lessons...");
  const files = fs
    .readdirSync(CONTENT_DIR)
    .filter((f) => f.endsWith(".md") && f.replace(/\.md$/, "") in LESSON_NUMBER)
    .sort();

  const fileContents = new Map<string, string>();
  const lessonRows = files.map((file) => {
    const slug = file.replace(/\.md$/, "");
    const number = LESSON_NUMBER[slug] ?? 0;
    const raw = fs.readFileSync(path.join(CONTENT_DIR, file), "utf-8");
    fileContents.set(slug, raw);

    const title = extractTitle(raw);
    const categoryName = getCategory(number);
    const wordCount = raw.split(/\s+/).filter(Boolean).length;
    const readingTimeMin = Math.max(1, Math.round(wordCount / 200));

    return {
      slug,
      number,
      title,
      categoryId: catIdByName.get(categoryName)!,
      wordCount,
      readingTimeMin,
      content: raw,
    };
  });

  const insertedLessons = db
    .insert(schema.lessons)
    .values(lessonRows)
    .returning({ id: schema.lessons.id, slug: schema.lessons.slug })
    .all();
  const lessonIdBySlug = new Map(insertedLessons.map((p) => [p.slug, p.id]));
  console.log(`  ${insertedLessons.length} lessons`);

  // ── 3. Seed lesson_sections ───────────────────────────────────
  console.log("Seeding lesson sections...");
  const allSections: (typeof schema.lessonSections.$inferInsert)[] = [];

  for (const [slug, raw] of fileContents) {
    const lessonId = lessonIdBySlug.get(slug)!;
    const sections = splitSections(raw);
    for (let i = 0; i < sections.length; i++) {
      allSections.push({
        lessonId,
        heading: sections[i].heading,
        headingLevel: sections[i].headingLevel,
        content: sections[i].content,
        sectionOrder: i,
        wordCount: sections[i].wordCount,
      });
    }
  }

  // Insert in batches of 100
  for (let i = 0; i < allSections.length; i += 100) {
    db.insert(schema.lessonSections)
      .values(allSections.slice(i, i + 100))
      .run();
  }
  console.log(`  ${allSections.length} sections`);

  // ── 4. Create and populate FTS5 virtual tables ────────────────
  console.log("Creating FTS5 indexes...");

  sqlite.exec(`
    DROP TABLE IF EXISTS lessons_fts;
    CREATE VIRTUAL TABLE lessons_fts USING fts5(
      title, summary, content,
      content='lessons',
      content_rowid='rowid',
      tokenize='porter unicode61'
    );
    INSERT INTO lessons_fts(rowid, title, summary, content)
      SELECT rowid, title, COALESCE(summary, ''), content FROM lessons;

    DROP TABLE IF EXISTS lesson_sections_fts;
    CREATE VIRTUAL TABLE lesson_sections_fts USING fts5(
      heading, content,
      content='lesson_sections',
      content_rowid='rowid',
      tokenize='porter unicode61'
    );
    INSERT INTO lesson_sections_fts(rowid, heading, content)
      SELECT rowid, heading, content FROM lesson_sections;

    DROP TABLE IF EXISTS concepts_fts;
    CREATE VIRTUAL TABLE concepts_fts USING fts5(
      name, description,
      content='concepts',
      content_rowid='rowid',
      tokenize='porter unicode61'
    );
    INSERT INTO concepts_fts(rowid, name, description)
      SELECT rowid, name, COALESCE(description, '') FROM concepts;
  `);
  console.log("  FTS5 indexes created");

  // ── 5. Seed public jobs from JSON files ───────────────────────
  console.log("Seeding public jobs...");
  const JOBS_DIR = path.join(process.cwd(), "data", "jobs");
  let jobCount = 0;
  if (fs.existsSync(JOBS_DIR)) {
    const jobFiles = fs.readdirSync(JOBS_DIR).filter((f) => f.endsWith(".json"));
    for (const file of jobFiles) {
      const job = JSON.parse(fs.readFileSync(path.join(JOBS_DIR, file), "utf-8"));
      sqlite.prepare(
        `INSERT OR REPLACE INTO public_jobs (id, slug, company, position, location, url, description, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        crypto.randomUUID(),
        job.slug,
        job.company,
        job.position,
        job.location ?? null,
        job.url ?? null,
        job.description,
        Math.floor(Date.now() / 1000),
      );
      jobCount++;
    }
  }
  console.log(`  ${jobCount} jobs`);

  // ── Summary ──────────────────────────────────────────────────
  console.log("\n┌──────────────────────┬───────┐");
  console.log("│ Table                │ Count │");
  console.log("├──────────────────────┼───────┤");
  console.log(`│ categories           │ ${String(cats.length).padStart(5)} │`);
  console.log(`│ lessons              │ ${String(insertedLessons.length).padStart(5)} │`);
  console.log(`│ lesson_sections      │ ${String(allSections.length).padStart(5)} │`);
  console.log("└──────────────────────┴───────┘");
  // Convert from WAL to DELETE mode so the .db file is self-contained
  // (Vercel's read-only filesystem can't create WAL/SHM files)
  sqlite.pragma("wal_checkpoint(TRUNCATE)");
  sqlite.pragma("journal_mode = DELETE");
  sqlite.close();

  console.log(`\nDatabase: ${DB_PATH}`);
  console.log("Done!");
}

function createTables() {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      slug TEXT NOT NULL UNIQUE,
      icon TEXT NOT NULL,
      description TEXT NOT NULL,
      gradient_from TEXT NOT NULL,
      gradient_to TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      lesson_range_lo INTEGER NOT NULL,
      lesson_range_hi INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS lessons (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      number INTEGER NOT NULL UNIQUE,
      title TEXT NOT NULL,
      category_id INTEGER NOT NULL REFERENCES categories(id),
      word_count INTEGER NOT NULL DEFAULT 0,
      reading_time_min INTEGER NOT NULL DEFAULT 1,
      content TEXT NOT NULL,
      summary TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS lessons_category_idx ON lessons(category_id);
    CREATE INDEX IF NOT EXISTS lessons_number_idx ON lessons(number);

    CREATE TABLE IF NOT EXISTS lesson_sections (
      id TEXT PRIMARY KEY,
      lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
      heading TEXT NOT NULL,
      heading_level INTEGER NOT NULL DEFAULT 2,
      content TEXT NOT NULL,
      section_order INTEGER NOT NULL,
      word_count INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS lesson_sections_lesson_idx ON lesson_sections(lesson_id);

    CREATE TABLE IF NOT EXISTS concepts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      concept_type TEXT NOT NULL DEFAULT 'topic',
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS concepts_type_idx ON concepts(concept_type);

    CREATE TABLE IF NOT EXISTS concept_edges (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
      target_id TEXT NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
      edge_type TEXT NOT NULL,
      weight REAL NOT NULL DEFAULT 1.0,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS concept_edges_source_target_type_idx ON concept_edges(source_id, target_id, edge_type);
    CREATE INDEX IF NOT EXISTS concept_edges_source_idx ON concept_edges(source_id);
    CREATE INDEX IF NOT EXISTS concept_edges_target_idx ON concept_edges(target_id);
    CREATE INDEX IF NOT EXISTS concept_edges_type_idx ON concept_edges(edge_type);

    CREATE TABLE IF NOT EXISTS lesson_concepts (
      lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
      concept_id TEXT NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
      relevance REAL NOT NULL DEFAULT 1.0,
      PRIMARY KEY (lesson_id, concept_id)
    );

    CREATE TABLE IF NOT EXISTS user_profiles (
      id TEXT PRIMARY KEY,
      display_name TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS knowledge_states (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
      concept_id TEXT NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
      p_mastery REAL NOT NULL DEFAULT 0.0,
      p_transit REAL NOT NULL DEFAULT 0.1,
      p_slip REAL NOT NULL DEFAULT 0.1,
      p_guess REAL NOT NULL DEFAULT 0.2,
      total_interactions INTEGER NOT NULL DEFAULT 0,
      correct_interactions INTEGER NOT NULL DEFAULT 0,
      mastery_level TEXT NOT NULL DEFAULT 'novice',
      last_interaction_at INTEGER,
      updated_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS knowledge_states_user_concept_idx ON knowledge_states(user_id, concept_id);
    CREATE INDEX IF NOT EXISTS knowledge_states_user_idx ON knowledge_states(user_id);
    CREATE INDEX IF NOT EXISTS knowledge_states_concept_idx ON knowledge_states(concept_id);
    CREATE INDEX IF NOT EXISTS knowledge_states_mastery_idx ON knowledge_states(user_id, mastery_level);

    CREATE TABLE IF NOT EXISTS interaction_events (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
      concept_id TEXT REFERENCES concepts(id) ON DELETE SET NULL,
      lesson_id TEXT REFERENCES lessons(id) ON DELETE SET NULL,
      section_id TEXT REFERENCES lesson_sections(id) ON DELETE SET NULL,
      interaction_type TEXT NOT NULL,
      is_correct INTEGER,
      response_time_ms INTEGER,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS interaction_events_user_time_idx ON interaction_events(user_id, created_at);
    CREATE INDEX IF NOT EXISTS interaction_events_user_concept_idx ON interaction_events(user_id, concept_id, created_at);
    CREATE INDEX IF NOT EXISTS interaction_events_lesson_idx ON interaction_events(lesson_id);
    CREATE INDEX IF NOT EXISTS interaction_events_type_idx ON interaction_events(interaction_type);

    CREATE TABLE IF NOT EXISTS lesson_embeddings (
      id TEXT PRIMARY KEY,
      lesson_id TEXT NOT NULL UNIQUE REFERENCES lessons(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      embedding BLOB NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS section_embeddings (
      id TEXT PRIMARY KEY,
      section_id TEXT NOT NULL UNIQUE REFERENCES lesson_sections(id) ON DELETE CASCADE,
      lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      embedding BLOB NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS section_embeddings_lesson_idx ON section_embeddings(lesson_id);

    CREATE TABLE IF NOT EXISTS concept_embeddings (
      id TEXT PRIMARY KEY,
      concept_id TEXT NOT NULL UNIQUE REFERENCES concepts(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      embedding BLOB NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_lesson_interactions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
      lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
      read_progress REAL NOT NULL DEFAULT 0,
      rating INTEGER,
      bookmarked INTEGER NOT NULL DEFAULT 0,
      time_spent_sec INTEGER NOT NULL DEFAULT 0,
      first_viewed_at INTEGER NOT NULL,
      last_viewed_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS user_lesson_interactions_user_lesson_idx ON user_lesson_interactions(user_id, lesson_id);
    CREATE INDEX IF NOT EXISTS user_lesson_interactions_user_idx ON user_lesson_interactions(user_id);
    CREATE INDEX IF NOT EXISTS user_lesson_interactions_lesson_idx ON user_lesson_interactions(lesson_id);

    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS chat_messages_thread_time_idx ON chat_messages(thread_id, created_at);

    CREATE TABLE IF NOT EXISTS analytics_events (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      session_id TEXT,
      event_name TEXT NOT NULL,
      event_category TEXT NOT NULL,
      lesson_id TEXT REFERENCES lessons(id) ON DELETE SET NULL,
      properties TEXT NOT NULL DEFAULT '{}',
      duration_ms INTEGER,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS analytics_events_user_time_idx ON analytics_events(user_id, created_at);
    CREATE INDEX IF NOT EXISTS analytics_events_name_time_idx ON analytics_events(event_name, created_at);
    CREATE INDEX IF NOT EXISTS analytics_events_lesson_time_idx ON analytics_events(lesson_id, created_at);
    CREATE INDEX IF NOT EXISTS analytics_events_session_idx ON analytics_events(session_id, created_at);

    CREATE TABLE IF NOT EXISTS applications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      company TEXT NOT NULL,
      position TEXT NOT NULL,
      url TEXT,
      status TEXT NOT NULL DEFAULT 'saved',
      notes TEXT,
      job_description TEXT,
      ai_interview_questions TEXT,
      ai_tech_stack TEXT,
      tech_dismissed_tags TEXT,
      applied_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS applications_user_idx ON applications(user_id);
    CREATE INDEX IF NOT EXISTS applications_status_idx ON applications(user_id, status);

    CREATE TABLE IF NOT EXISTS resumes (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      filename TEXT,
      raw_text TEXT,
      extracted_skills TEXT,
      taxonomy_version TEXT,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS resumes_user_id_unique ON resumes(user_id);
    CREATE INDEX IF NOT EXISTS resumes_user_id_idx ON resumes(user_id);

    CREATE TABLE IF NOT EXISTS external_courses (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      url TEXT NOT NULL UNIQUE,
      provider TEXT NOT NULL,
      description TEXT,
      level TEXT,
      rating REAL,
      review_count INTEGER,
      duration_hours REAL,
      is_free INTEGER NOT NULL DEFAULT 1,
      enrolled INTEGER,
      image_url TEXT,
      language TEXT NOT NULL DEFAULT 'English',
      topic_group TEXT,
      metadata TEXT DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS external_courses_provider_idx ON external_courses(provider);

    CREATE TABLE IF NOT EXISTS lesson_courses (
      lesson_slug TEXT NOT NULL,
      course_id TEXT NOT NULL REFERENCES external_courses(id) ON DELETE CASCADE,
      relevance REAL NOT NULL DEFAULT 1.0,
      PRIMARY KEY (lesson_slug, course_id)
    );
    CREATE INDEX IF NOT EXISTS lesson_courses_slug_idx ON lesson_courses(lesson_slug);

    CREATE TABLE IF NOT EXISTS course_reviews (
      id TEXT PRIMARY KEY,
      course_id TEXT NOT NULL REFERENCES external_courses(id) ON DELETE CASCADE,
      pedagogy_score INTEGER,
      technical_accuracy_score INTEGER,
      content_depth_score INTEGER,
      practical_application_score INTEGER,
      instructor_clarity_score INTEGER,
      curriculum_fit_score INTEGER,
      prerequisites_score INTEGER,
      ai_domain_relevance_score INTEGER,
      community_health_score INTEGER,
      value_proposition_score INTEGER,
      aggregate_score REAL,
      verdict TEXT,
      summary TEXT,
      expert_details TEXT,
      model_version TEXT NOT NULL DEFAULT 'deepseek-chat',
      reviewed_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS course_reviews_course_idx ON course_reviews(course_id);
    CREATE UNIQUE INDEX IF NOT EXISTS course_reviews_course_unique ON course_reviews(course_id);

    CREATE TABLE IF NOT EXISTS public_jobs (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      company TEXT NOT NULL,
      position TEXT NOT NULL,
      location TEXT,
      url TEXT,
      description TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS public_jobs_slug_idx ON public_jobs(slug);
  `);
}

try {
  seed();
} catch (err) {
  console.error("Seed failed:", err);
  process.exit(1);
}
