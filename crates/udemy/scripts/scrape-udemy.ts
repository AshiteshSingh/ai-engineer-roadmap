/**
 * Udemy course scraper — outputs Course[] JSON for the `scrape-udemy` Rust binary.
 *
 * Strategy:
 *  1. Crawl seed topic pages to discover course URLs
 *  2. Follow related topics found on those pages
 *  3. Deep-scrape every discovered course in a fresh browser (bypasses Cloudflare)
 *  4. Filter to courses that match relevance keywords
 *  5. Write Course[] JSON compatible with crates/udemy/src/types.rs
 *
 * Usage:
 *   pnpm install && tsx scrape-udemy.ts [--output ../data/courses.json]
 *
 * Then run the Rust binary:
 *   cargo run --bin scrape-udemy -- --json ./data/courses.json
 */

import { webkit, type BrowserContext } from "playwright";
import { writeFile, mkdir } from "fs/promises";
import { dirname } from "path";
import { parseArgs } from "util";

// ── Config ────────────────────────────────────────────────────────────────────

const DELAY_MS = 3_000;

const BROWSER_OPTS = {
  userAgent:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
  viewport: { width: 1440 as const, height: 900 as const },
  locale: "en-US" as const,
};

// All seed topics from crates/udemy/src/keywords.rs
const SEED_TOPICS = [
  "vector-databases",
  "langchain",
  "openai-api",
  "retrieval-augmented-generation",
  "ai-agents",
  "generative-ai",
  "machine-learning",
  "deep-learning",
  "pytorch",
  "tensorflow",
  "natural-language-processing",
  "transformers",
  "hugging-face",
  "computer-vision",
  "mlops",
  "stable-diffusion",
  "prompt-engineering",
  "chatgpt",
  "large-language-models",
];

const PROMO_SLUGS = new Set([
  "google-ai-fundamentals",
  "google-ai-for-brainstorming-and-planning",
  "google-ai-for-research-and-insights",
  "google-ai-for-writing-and-communicating",
  "google-ai-for-content-creation",
  "google-ai-for-data-analysis",
  "google-ai-for-workflow-automation",
]);

// Mirrors RELEVANCE_KEYWORDS in crates/udemy/src/keywords.rs
const RELEVANCE_KEYWORDS = [
  "vector database", "vector db", "vectorstore", "vector store",
  "pinecone", "weaviate", "qdrant", "milvus", "chroma", "chromadb",
  "pgvector", "faiss", "similarity search", "embedding", "vector search",
  "nearest neighbor", "rag", "retrieval augmented", "retrieval-augmented",
  "langchain", "llamaindex", "langgraph",
  "machine learning", "deep learning", "neural network", "pytorch", "tensorflow",
  "transformer model", "large language model", "llm", "fine-tuning", "fine tuning",
  "hugging face", "huggingface", "openai", "gpt", "stable diffusion",
  "diffusion model", "computer vision", "natural language processing", "nlp",
  "mlops", "prompt engineering", "attention mechanism", "convolutional",
  "generative ai",
];

const RELEVANT_TOPIC_KEYWORDS = [
  "vector", "embed", "rag", "retriev", "langchain", "llama",
  "pinecone", "chroma", "weaviate", "qdrant", "faiss", "search",
  "database", "ai-agent", "generative", "llm", "openai",
  "deep-learning", "nlp", "machine-learning",
];

// ── Types ─────────────────────────────────────────────────────────────────────

/** Matches crates/udemy/src/types.rs `Course` struct (serde snake_case). */
interface Course {
  course_id: string;
  title: string;
  url: string;
  description: string;
  instructor: string;
  level: string;
  rating: number;
  review_count: number;
  num_students: number;
  duration_hours: number;
  price: string;
  language: string;
  category: string;
  image_url: string;
  /** JSON-encoded string: `string[]` of "what you'll learn" bullet points */
  topics_json: string;
}

// ── Browser helpers ───────────────────────────────────────────────────────────

async function freshContext(): Promise<{ context: BrowserContext; close: () => Promise<void> }> {
  const browser = await webkit.launch({ headless: true });
  const context = await browser.newContext(BROWSER_OPTS);
  return { context, close: () => browser.close() };
}

function slugFromUrl(url: string): string {
  return url.replace(/\/$/, "").split("/").pop() ?? "unknown";
}

function extractCourseUrls(rawUrls: string[]): string[] {
  const seen = new Set<string>();
  return rawUrls
    .map((u) => {
      const m = u.match(/(https:\/\/www\.udemy\.com\/course\/[^/?#]+)/);
      return m ? m[1] + "/" : null;
    })
    .filter((u): u is string => {
      if (!u || seen.has(u)) return false;
      seen.add(u);
      return !PROMO_SLUGS.has(slugFromUrl(u));
    });
}

function isRelevant(text: string): boolean {
  const lower = text.toLowerCase();
  return RELEVANCE_KEYWORDS.some((kw) => lower.includes(kw));
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Phase 1: Topic page crawler ───────────────────────────────────────────────

async function crawlTopicPage(
  topic: string,
): Promise<{ courses: string[]; relatedTopics: string[] }> {
  const { context, close } = await freshContext();
  try {
    const page = await context.newPage();
    await page.goto(`https://www.udemy.com/topic/${topic}/`, {
      waitUntil: "domcontentloaded",
      timeout: 20_000,
    });
    await page.waitForTimeout(6_000);

    const title = await page.title();
    if (title.includes("moment") || title.includes("404")) {
      return { courses: [], relatedTopics: [] };
    }

    // Dismiss cookie banner if present
    await page.click('[id*="onetrust-accept"], button:has-text("Accept")').catch(() => {});

    // Scroll to trigger lazy loading
    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(1_500);
    }

    const [courseHrefs, topicHrefs] = await page.evaluate(() => [
      [...document.querySelectorAll("a")]
        .map((a) => (a as HTMLAnchorElement).href)
        .filter((h) => h.includes("/course/")),
      [...document.querySelectorAll("a")]
        .map((a) => (a as HTMLAnchorElement).href)
        .filter((h) => /^https:\/\/www\.udemy\.com\/topic\/[a-z0-9-]+\/?$/.test(h))
        .filter((v, i, arr) => arr.indexOf(v) === i),
    ]);

    const relatedTopics = topicHrefs
      .map((h) => h.match(/\/topic\/([a-z0-9-]+)/)?.[1])
      .filter((t): t is string => !!t);

    return { courses: extractCourseUrls(courseHrefs), relatedTopics };
  } finally {
    await close();
  }
}

// ── Phase 2: Course page scraper ──────────────────────────────────────────────

async function scrapeCourse(
  url: string,
  discoveredFrom: string,
): Promise<{ course: Course | null; relatedTopics: string[] }> {
  const { context, close } = await freshContext();
  try {
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForSelector("h1", { timeout: 15_000 });
    await page.waitForTimeout(5_000);

    // Scroll fully to load lazy content
    for (let i = 0; i < 8; i++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(1_000);
    }

    // Expand curriculum / "Show more" sections
    const expandBtns = page.locator(
      'button:has-text("Show more"), button:has-text("Expand all sections")',
    );
    const btnCount = await expandBtns.count();
    for (let i = 0; i < Math.min(btnCount, 10); i++) {
      await expandBtns.nth(i).click().catch(() => {});
      await page.waitForTimeout(500);
    }

    const result = await page.evaluate((courseUrl: string) => {
      const lines = document.body.innerText
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0);

      // Title
      const h1 = document.querySelector("h1");
      const title = h1?.textContent?.trim() ?? "Unknown";

      // Rating
      let rating = 0;
      const ratingLine = lines.find((l) => /^Rating:\s*[\d.]+\s*out\s*of/.test(l));
      if (ratingLine) {
        const m = ratingLine.match(/([\d.]+)\s*out/);
        if (m) rating = parseFloat(m[1]);
      } else {
        const ri = lines.findIndex((l) => /^\d\.\d$/.test(l));
        if (ri >= 0) rating = parseFloat(lines[ri]);
      }

      // Review count
      let reviewCount = 0;
      const rl = lines.find((l) => /\([\d,]+\s*rating/.test(l));
      if (rl) {
        const m = rl.match(/([\d,]+)\s*rating/);
        if (m) reviewCount = parseInt(m[1].replace(/,/g, ""), 10);
      }

      // Students enrolled
      let numStudents = 0;
      const el = lines.find((l) => /^[\d,]+\s*student/i.test(l));
      if (el) {
        const m = el.match(/([\d,]+)\s*student/i);
        if (m) numStudents = parseInt(m[1].replace(/,/g, ""), 10);
      }

      // Instructor ("Created by ...")
      const ci = lines.findIndex((l) => l === "Created by");
      const instructor =
        ci >= 0 && lines[ci + 1]
          ? lines[ci + 1]
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
              .join(", ")
          : "";

      // Language (line after "Last updated ...")
      const updatedLine = lines.find((l) => /^Last updated/.test(l));
      let language = "English";
      if (updatedLine) {
        const ui = lines.indexOf(updatedLine);
        const ll = lines[ui + 1];
        if (ll && /^[A-Z][a-z]+$/.test(ll)) language = ll;
      }

      // Price
      const pl = lines.find((l) => /^(Free|(\$|€|£|₹|lei\s*)[\d,.]+)$/i.test(l));
      const price = pl ?? "";

      // Level
      const lvl = lines.find((l) => /^(Beginner|Intermediate|Advanced|All Levels)/i.test(l));
      const level = lvl ?? "All Levels";

      // Duration hours
      let durationHours = 0;
      const dur = lines.find((l) => /[\d.]+\s*total\s*hour/i.test(l));
      if (dur) {
        const m = dur.match(/([\d.]+)\s*total\s*hour/i);
        if (m) durationHours = parseFloat(m[1]);
      }

      // "What you'll learn" topics
      const learnIdx = lines.findIndex((l) => l === "What you'll learn");
      const whatYoullLearn: string[] = [];
      if (learnIdx >= 0) {
        for (let i = learnIdx + 1; i < lines.length; i++) {
          const line = lines[i];
          if (
            /^(Explore related|Show more|Show less|Course content|Coding Exercises)/.test(line)
          )
            break;
          if (line.length > 10 && line.length < 300) whatYoullLearn.push(line);
        }
      }

      // Description (section after "Course content" and "Description" heading)
      const coi = lines.findIndex((l) => l === "Course content");
      const di = lines.findIndex((l, idx) => l === "Description" && idx > (coi || 0));
      let description = "";
      if (di >= 0) {
        const dl: string[] = [];
        for (let i = di + 1; i < lines.length; i++) {
          const line = lines[i];
          if (
            line === "Who this course is for:" ||
            line === "Show more" ||
            line === "Show less"
          )
            break;
          dl.push(line);
        }
        description = dl.join("\n").slice(0, 5_000);
      }
      if (!description) {
        const ogDesc = document.querySelector(
          'meta[property="og:description"]',
        ) as HTMLMetaElement | null;
        description = ogDesc?.content ?? "";
      }

      // Image
      const ogImg = document.querySelector(
        'meta[property="og:image"]',
      ) as HTMLMetaElement | null;
      const imageUrl = ogImg?.content ?? "";

      // Category from breadcrumb
      const breadcrumbs = [
        ...document.querySelectorAll(
          "nav[aria-label='Breadcrumb'] a, [data-purpose='breadcrumb'] a",
        ),
      ]
        .map((a) => a.textContent?.trim() ?? "")
        .filter((t) => t && t !== "Udemy");
      const category = breadcrumbs[breadcrumbs.length - 1] ?? "";

      // Related topics for further crawling
      const relatedTopicSlugs = [...document.querySelectorAll("a")]
        .map(
          (a) =>
            (a as HTMLAnchorElement).href.match(
              /^https:\/\/www\.udemy\.com\/topic\/([a-z0-9-]+)/,
            )?.[1],
        )
        .filter((t): t is string => !!t)
        .filter((v, i, a) => a.indexOf(v) === i);

      return {
        title,
        description,
        instructor,
        level,
        rating,
        reviewCount,
        numStudents,
        durationHours,
        price,
        language,
        category,
        imageUrl,
        whatYoullLearn,
        relatedTopicSlugs,
      };
    }, url);

    if (!result?.title || result.title === "Unknown" || result.title === "www.udemy.com") {
      return { course: null, relatedTopics: [] };
    }

    const course: Course = {
      course_id: slugFromUrl(url),
      title: result.title,
      url,
      description: result.description,
      instructor: result.instructor,
      level: result.level,
      rating: result.rating,
      review_count: result.reviewCount,
      num_students: result.numStudents,
      duration_hours: result.durationHours,
      price: result.price,
      language: result.language,
      category: result.category || discoveredFrom,
      image_url: result.imageUrl,
      topics_json: JSON.stringify(result.whatYoullLearn),
    };

    return { course, relatedTopics: result.relatedTopicSlugs };
  } catch {
    return { course: null, relatedTopics: [] };
  } finally {
    await close();
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      output: { type: "string", default: "../data/courses.json" },
    },
    strict: false,
  });
  const outPath = values.output as string;

  const discoveredUrls = new Map<string, string>(); // url → discovered-from topic
  const crawledTopics = new Set<string>();
  const topicQueue = [...SEED_TOPICS];

  // ── Phase 1: Discover course URLs from topic pages ───────────────────────
  console.log("Phase 1: Crawling topic pages...\n");

  while (topicQueue.length > 0) {
    const topic = topicQueue.shift()!;
    if (crawledTopics.has(topic)) continue;
    crawledTopics.add(topic);

    process.stdout.write(`  /topic/${topic}/ ... `);
    const { courses, relatedTopics } = await crawlTopicPage(topic);
    console.log(`${courses.length} courses, ${relatedTopics.length} related topics`);

    for (const url of courses) {
      if (!discoveredUrls.has(url)) discoveredUrls.set(url, topic);
    }

    for (const rt of relatedTopics) {
      if (!crawledTopics.has(rt) && RELEVANT_TOPIC_KEYWORDS.some((kw) => rt.includes(kw))) {
        topicQueue.push(rt);
      }
    }

    await delay(DELAY_MS);
  }

  console.log(
    `\nDiscovered ${discoveredUrls.size} courses from ${crawledTopics.size} topics\n`,
  );

  if (discoveredUrls.size === 0) {
    console.error("No courses discovered — Cloudflare may be blocking topic pages.");
    process.exit(1);
  }

  // ── Phase 2: Scrape each course page ────────────────────────────────────
  console.log("Phase 2: Scraping course pages...\n");

  const courses: Course[] = [];
  const newTopicsFromCourses: string[] = [];
  let skipped = 0;
  let blocked = 0;
  const entries = [...discoveredUrls.entries()];

  for (const [i, [url, fromTopic]] of entries.entries()) {
    const shortUrl = url.replace("https://www.udemy.com/course/", "").replace(/\/$/, "");
    process.stdout.write(`  [${i + 1}/${entries.length}] ${shortUrl} ... `);

    const { course, relatedTopics } = await scrapeCourse(url, fromTopic);

    for (const rt of relatedTopics) {
      const isNew = !crawledTopics.has(rt);
      const isRelevantTopic = RELEVANT_TOPIC_KEYWORDS.some((kw) => rt.includes(kw));
      if (isNew && isRelevantTopic) {
        crawledTopics.add(rt);
        newTopicsFromCourses.push(rt);
      }
    }

    if (!course) {
      console.log("blocked");
      blocked++;
    } else if (!isRelevant(`${course.title} ${course.description} ${course.topics_json}`)) {
      console.log("not relevant");
      skipped++;
    } else {
      console.log(`✓  ${course.rating}★  (${course.review_count} reviews)`);
      courses.push(course);
    }

    await delay(DELAY_MS);
  }

  // ── Phase 3: Crawl topics discovered from course pages ───────────────────
  if (newTopicsFromCourses.length > 0) {
    console.log(`\nPhase 3: Crawling ${newTopicsFromCourses.length} newly discovered topics...\n`);

    for (const topic of newTopicsFromCourses) {
      process.stdout.write(`  /topic/${topic}/ ... `);
      const { courses: newCourses } = await crawlTopicPage(topic);
      console.log(`${newCourses.length} courses`);
      for (const url of newCourses) {
        if (!discoveredUrls.has(url)) discoveredUrls.set(url, topic);
      }
      await delay(DELAY_MS);
    }

    const phase3Entries = [...discoveredUrls.entries()].slice(entries.length);
    if (phase3Entries.length > 0) {
      console.log(`\n  Scraping ${phase3Entries.length} new courses...\n`);
      for (const [j, [url, fromTopic]] of phase3Entries.entries()) {
        const shortUrl = url.replace("https://www.udemy.com/course/", "").replace(/\/$/, "");
        process.stdout.write(`  [${j + 1}/${phase3Entries.length}] ${shortUrl} ... `);
        const { course } = await scrapeCourse(url, fromTopic);
        if (!course) {
          console.log("blocked");
          blocked++;
        } else if (!isRelevant(`${course.title} ${course.description} ${course.topics_json}`)) {
          console.log("not relevant");
          skipped++;
        } else {
          console.log(`✓  ${course.rating}★`);
          courses.push(course);
        }
        await delay(DELAY_MS);
      }
    }
  }

  // ── Write output ─────────────────────────────────────────────────────────
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(courses, null, 2));

  console.log("\n" + "=".repeat(60));
  console.log(`Topics crawled:       ${crawledTopics.size}`);
  console.log(`Courses discovered:   ${discoveredUrls.size}`);
  console.log(`Saved:                ${courses.length}`);
  console.log(`Skipped (irrelevant): ${skipped}`);
  console.log(`Blocked:              ${blocked}`);
  console.log(`Output:               ${outPath}`);
  console.log("=".repeat(60));

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
