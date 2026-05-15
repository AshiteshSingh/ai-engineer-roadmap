/**
 * Scrape a Udemy search/topic listing URL and emit JSON to stdout.
 *
 * Used as a subprocess by the Python orchestrator at
 * `backend/scripts/seed_topic_courses.py` — Python handles LangGraph
 * orchestration and DB writes; this script only does Playwright scraping
 * because Udemy is heavily Cloudflare-protected and Python httpx is blocked.
 *
 * Usage:
 *   pnpm tsx scripts/fetch-udemy-search.ts \
 *     "https://www.udemy.com/courses/search/?q=public+speaking&sort=most-reviewed" \
 *     --max 25
 *
 * Output: a single JSON line on stdout — { courses: ScrapedCourse[] }.
 * All progress logs go to stderr so stdout stays parseable.
 */
import { webkit, type BrowserContext } from "playwright";

const BROWSER_OPTS = {
  userAgent:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
  viewport: { width: 1440 as const, height: 900 as const },
  locale: "en-US" as const,
};

const DELAY_MS = 2500;

const PROMO_SLUGS = new Set([
  "google-ai-fundamentals",
  "google-ai-for-brainstorming-and-planning",
  "google-ai-for-research-and-insights",
  "google-ai-for-writing-and-communicating",
  "google-ai-for-content-creation",
  "google-ai-for-data-analysis",
  "google-ai-for-workflow-automation",
]);

interface CourseMetadata {
  instructors: string[];
  subtitle: string | null;
  price: string | null;
  whatYoullLearn: string[];
  curriculum: { section: string; lectures: number; duration: string }[];
  lastUpdated: string | null;
  totalLectures: number | null;
  totalDuration: string | null;
}

interface ScrapedCourse {
  title: string;
  url: string;
  description: string | null;
  level: string | null;
  rating: number | null;
  reviewCount: number | null;
  durationHours: number | null;
  isFree: boolean;
  enrolled: number | null;
  imageUrl: string | null;
  language: string;
  metadata: CourseMetadata;
}

async function freshContext(): Promise<{ context: BrowserContext; close: () => Promise<void> }> {
  const browser = await webkit.launch({ headless: true });
  const context = await browser.newContext(BROWSER_OPTS);
  return { context, close: () => browser.close() };
}

function isJunkSlug(slug: string): boolean {
  // Pixel dimensions baked into CDN thumbnail URLs (e.g. /course/240x135/)
  if (/^\d+x\d+$/.test(slug)) return true;
  // Pure numeric IDs (e.g. /course/5296538/) — Udemy redirects these to the
  // canonical slug, so we'd scrape the same course twice.
  if (/^\d+$/.test(slug)) return true;
  // Real course slugs always contain at least one hyphen.
  if (!slug.includes("-")) return true;
  return false;
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
      const slug = u.replace("https://www.udemy.com/course/", "").replace("/", "");
      if (PROMO_SLUGS.has(slug)) return false;
      if (isJunkSlug(slug)) return false;
      return true;
    });
}

async function listCoursesFromSearch(url: string): Promise<string[]> {
  const { context, close } = await freshContext();
  try {
    const page = await context.newPage();
    process.stderr.write(`Loading ${url}\n`);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(7000);

    await page
      .click('[id*="onetrust-accept"], button:has-text("Accept")')
      .catch(() => {});

    for (let i = 0; i < 8; i++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(1500);
    }

    const courseHrefs = await page.evaluate(() => {
      const anchorCourses = [...document.querySelectorAll("a")]
        .map((a) => (a as HTMLAnchorElement).href)
        .filter((h) => h.includes("/course/"));
      const nextDataEl = document.getElementById("__NEXT_DATA__");
      const nextDataCourses: string[] = [];
      if (nextDataEl?.textContent) {
        const matches = nextDataEl.textContent.match(/\/course\/([a-z0-9][a-z0-9-]{2,80})/g) ?? [];
        for (const m of matches) nextDataCourses.push(`https://www.udemy.com${m}/`);
      }
      const htmlMatches = document.documentElement.innerHTML
        .match(/\/course\/([a-z0-9][a-z0-9-]{2,80})(?:\/|")/g) ?? [];
      const htmlCourses = htmlMatches.map(
        (m) => `https://www.udemy.com${m.replace(/["\/]$/, "")}/`,
      );
      return [...anchorCourses, ...nextDataCourses, ...htmlCourses];
    });

    return extractCourseUrls(courseHrefs);
  } finally {
    await close();
  }
}

async function deepScrapeCourse(url: string): Promise<ScrapedCourse | null> {
  const { context, close } = await freshContext();
  try {
    const page = await context.newPage();

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForSelector("h1", { timeout: 15000 });
    await page.waitForTimeout(5000);

    for (let i = 0; i < 6; i++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(1000);
    }

    const expandBtns = page.locator(
      'button:has-text("Show more"), button:has-text("Expand all sections")',
    );
    const btnCount = await expandBtns.count();
    for (let i = 0; i < Math.min(btnCount, 8); i++) {
      await expandBtns.nth(i).click().catch(() => {});
      await page.waitForTimeout(400);
    }

    const result = await page.evaluate((courseUrl: string) => {
      const lines = document.body.innerText
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
      const h1 = document.querySelector("h1");
      const title = h1?.textContent?.trim() ?? "Unknown";

      let subtitle: string | null = null;
      const titleIdx = lines.findIndex((l) => l === title);
      if (titleIdx >= 0) {
        const secondIdx = lines.indexOf(title, titleIdx + 1);
        const searchStart = secondIdx >= 0 ? secondIdx + 1 : titleIdx + 1;
        const nextLine = lines[searchStart];
        if (nextLine && !/^(Rating|Highest|Bestseller|Role Play|Hot & New|New)/.test(nextLine)) {
          subtitle = nextLine;
        }
      }

      let rating: number | null = null;
      const ratingLine = lines.find((l) => /^Rating:\s*[\d.]+\s*out\s*of/.test(l));
      if (ratingLine) {
        const m = ratingLine.match(/([\d.]+)\s*out/);
        if (m) rating = parseFloat(m[1]);
      } else {
        const ri = lines.findIndex((l) => /^\d\.\d$/.test(l));
        if (ri >= 0) rating = parseFloat(lines[ri]);
      }

      let reviewCount: number | null = null;
      const rl = lines.find((l) => /\([\d,]+\s*rating/.test(l));
      if (rl) {
        const m = rl.match(/([\d,]+)\s*rating/);
        if (m) reviewCount = parseInt(m[1].replace(/,/g, ""), 10);
      }

      let enrolled: number | null = null;
      const el = lines.find((l) => /^[\d,]+\s*student/i.test(l));
      if (el) {
        const m = el.match(/([\d,]+)\s*student/i);
        if (m) enrolled = parseInt(m[1].replace(/,/g, ""), 10);
      }

      const ci = lines.findIndex((l) => l === "Created by");
      const instructors: string[] =
        ci >= 0 && lines[ci + 1]
          ? lines[ci + 1].split(",").map((s) => s.trim()).filter(Boolean)
          : [];

      const updatedLine = lines.find((l) => /^Last updated/.test(l));
      let language = "English";
      if (updatedLine) {
        const ui = lines.indexOf(updatedLine);
        const ll = lines[ui + 1];
        if (ll && /^[A-Z][a-z]+$/.test(ll)) language = ll;
      }

      const pl = lines.find((l) => /^(Free|(\$|€|£|₹|lei\s*)[\d,.]+)$/i.test(l));
      const isFree = pl ? /free/i.test(pl) : false;

      const li = lines.findIndex((l) => l === "What you'll learn");
      const whatYoullLearn: string[] = [];
      if (li >= 0) {
        for (let i = li + 1; i < lines.length; i++) {
          const line = lines[i];
          if (/^(Explore related|Show more|Show less|Course content|Coding Exercises)/.test(line))
            break;
          if (line.length > 10 && line.length < 300) whatYoullLearn.push(line);
        }
      }

      const coi = lines.findIndex((l) => l === "Course content");
      const curriculum: { section: string; lectures: number; duration: string }[] = [];
      let totalLectures: number | null = null;
      let totalDuration: string | null = null;
      if (coi >= 0) {
        const sl = lines[coi + 1];
        if (sl) {
          const lm = sl.match(/(\d+)\s*lecture/);
          if (lm) totalLectures = parseInt(lm[1], 10);
          const dm = sl.match(/([\dh\s]+\d+m)\s*total/);
          if (dm) totalDuration = dm[1].trim();
        }
        for (let i = coi + 2; i < lines.length; i++) {
          const line = lines[i];
          if (line === "Requirements" || line === "Description" || line === "Who this course is for:")
            break;
          if (line === "Expand all sections" || /^\d+ more section/.test(line)) continue;
          const st = lines[i + 1];
          if (st && /^\d+\s*lecture/.test(st)) {
            const lm = st.match(/(\d+)\s*lecture/);
            const dm = st.match(/•\s*(.+)/);
            curriculum.push({
              section: line,
              lectures: lm ? parseInt(lm[1], 10) : 0,
              duration: dm ? dm[1].trim() : "",
            });
            i++;
          }
        }
      }

      const di = lines.findIndex((l, idx) => l === "Description" && idx > (coi || 0));
      let description: string | null = null;
      if (di >= 0) {
        const dl: string[] = [];
        for (let i = di + 1; i < lines.length; i++) {
          const line = lines[i];
          if (line === "Who this course is for:" || line === "Show more" || line === "Show less")
            break;
          dl.push(line);
        }
        description = dl.join("\n").slice(0, 5000) || null;
      }
      if (!description) description = subtitle;

      let level: string | null = null;
      const lvl = lines.find((l) => /^(Beginner|Intermediate|Advanced|All Levels)/i.test(l));
      if (lvl) level = lvl;

      let durationHours: number | null = null;
      const dur = lines.find((l) => /[\d.]+\s*total\s*hour/i.test(l));
      if (dur) {
        const m = dur.match(/([\d.]+)\s*total\s*hour/i);
        if (m) durationHours = parseFloat(m[1]);
      } else if (totalDuration) {
        const hm = totalDuration.match(/(\d+)h\s*(\d+)?m?/);
        if (hm) durationHours = parseInt(hm[1], 10) + parseInt(hm[2] || "0", 10) / 60;
      }

      const ogImg = document.querySelector('meta[property="og:image"]') as HTMLMetaElement | null;
      const imageUrl = ogImg?.content ?? null;

      return {
        title,
        url: courseUrl,
        description,
        level,
        rating,
        reviewCount,
        durationHours,
        isFree,
        enrolled,
        imageUrl,
        language,
        metadata: {
          instructors,
          subtitle,
          price: pl ?? null,
          whatYoullLearn,
          curriculum,
          lastUpdated: updatedLine ?? null,
          totalLectures,
          totalDuration,
        },
      };
    }, url);

    if (!result || result.title === "Unknown" || result.title === "www.udemy.com") {
      return null;
    }

    return result as ScrapedCourse;
  } catch (err) {
    process.stderr.write(`  scrape failed: ${err}\n`);
    return null;
  } finally {
    await close();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const url = args[0];
  if (!url) {
    process.stderr.write(
      "usage: pnpm tsx scripts/fetch-udemy-search.ts <search-url> [--max N]\n",
    );
    process.exit(2);
  }
  const maxIdx = args.indexOf("--max");
  const max = maxIdx >= 0 ? parseInt(args[maxIdx + 1] ?? "25", 10) : 25;

  process.stderr.write(`Phase 1: list courses from ${url}\n`);
  const courseUrls = (await listCoursesFromSearch(url)).slice(0, max);
  process.stderr.write(`  found ${courseUrls.length} candidate courses\n`);

  if (courseUrls.length === 0) {
    process.stdout.write(JSON.stringify({ courses: [] }) + "\n");
    return;
  }

  process.stderr.write(`Phase 2: deep-scrape each candidate\n`);
  const courses: ScrapedCourse[] = [];
  for (const [i, courseUrl] of courseUrls.entries()) {
    const slug = courseUrl.replace("https://www.udemy.com/course/", "").replace(/\/$/, "");
    process.stderr.write(`  [${i + 1}/${courseUrls.length}] ${slug}\n`);
    const c = await deepScrapeCourse(courseUrl);
    if (c) {
      courses.push(c);
      process.stderr.write(
        `    ok: ${c.rating ?? "?"}★ (${c.reviewCount ?? "?"} reviews)\n`,
      );
    }
    await new Promise((r) => setTimeout(r, DELAY_MS));
  }

  process.stdout.write(JSON.stringify({ courses }) + "\n");
}

main().catch((err) => {
  process.stderr.write(`fatal: ${err?.stack || err}\n`);
  process.exit(1);
});
