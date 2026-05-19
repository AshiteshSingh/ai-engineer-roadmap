/**
 * Authenticated scrape of a DeepLearning.AI short course (personal archival of
 * a course the running user is enrolled in).
 *
 *   pnpm scrape:dlai:login          # Phase A — headed login, caches session
 *   pnpm scrape:dlai -- --recon     # Phase B recon — headed, dumps selectors
 *   pnpm scrape:dlai                # Phase B — headless scrape → JSON
 *
 * Credentials are read from .env.local (DLAI_EMAIL / DLAI_PASSWORD) and are
 * never written into this committed script or the output JSON. The cached
 * session lives in data/deeplearning/.auth/ (gitignored).
 *
 * Subtitle strategy: a network listener captures any WebVTT track the player
 * fetches; the on-page transcript panel is scraped as a second source / fallback
 * so nothing is lost if the player changes.
 */
import { chromium, type BrowserContext, type Page } from "playwright";
import {
  mkdirSync,
  writeFileSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";

// ── Config ───────────────────────────────────────────────────────────

const COURSE_SLUG =
  process.env.DLAI_COURSE_SLUG ?? "long-term-agentic-memory-with-langgraph";
const COURSE_URL = `https://learn.deeplearning.ai/courses/${COURSE_SLUG}`;
// Unauthenticated course hits redirect to the DeepLearning.AI identity
// provider, which hosts the real email/password form.
const AUTH_LOGIN_RE = /auth\.deeplearning\.ai\/login/i;

const DATA_DIR = join(process.cwd(), "data", "deeplearning");
const AUTH_DIR = join(DATA_DIR, ".auth");
const AUTH_STATE = join(AUTH_DIR, "deeplearning-state.json");
const RECON_DIR = join(DATA_DIR, "_recon");
const OUTPUT = join(DATA_DIR, `${COURSE_SLUG}.json`);

const BROWSER_OPTS = {
  userAgent:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  viewport: { width: 1440, height: 900 },
  locale: "en-US",
} as const;

const LESSON_DELAY_MS = 1500;

// ── WebVTT parsing ───────────────────────────────────────────────────

interface Cue {
  start: number;
  end: number;
  text: string;
}

function tsToSecs(ts: string): number {
  // hh:mm:ss.mmm | mm:ss.mmm
  const parts = ts.trim().replace(",", ".").split(":").map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return Number(parts[0]) || 0;
}

function parseVtt(raw: string): { cues: Cue[]; text: string } {
  const cues: Cue[] = [];
  const blocks = raw.replace(/\r/g, "").split(/\n\n+/);
  for (const block of blocks) {
    const lines = block.split("\n").filter(Boolean);
    const tl = lines.find((l) => l.includes("-->"));
    if (!tl) continue;
    const m = tl.match(/([\d:.,]+)\s*-->\s*([\d:.,]+)/);
    if (!m) continue;
    const idx = lines.indexOf(tl);
    const text = lines
      .slice(idx + 1)
      .join(" ")
      .replace(/<[^>]+>/g, "") // strip <c>/<v> styling tags
      .trim();
    if (!text) continue;
    cues.push({ start: tsToSecs(m[1]), end: tsToSecs(m[2]), text });
  }
  // De-duplicate consecutive identical lines (rolling captions repeat them).
  const seen: string[] = [];
  for (const c of cues) if (seen[seen.length - 1] !== c.text) seen.push(c.text);
  return { cues, text: seen.join("\n") };
}

// ── Browser helpers ──────────────────────────────────────────────────

function looksLikeLogin(url: string): boolean {
  return /\/login|\/auth|auth0\.com|accounts\.|sign[_-]?in/i.test(url);
}

/** Attach a response listener that buffers every WebVTT body the page fetches. */
function attachVttCapture(context: BrowserContext): {
  drain: () => string[];
  reset: () => void;
} {
  let buf: string[] = [];
  context.on("response", async (res) => {
    try {
      const url = res.url();
      const ct = (res.headers()["content-type"] ?? "").toLowerCase();
      const isVtt =
        url.includes(".vtt") ||
        ct.includes("text/vtt") ||
        (url.includes("subtitle") && ct.includes("text"));
      if (!isVtt || !res.ok()) return;
      const body = await res.text();
      if (body.includes("-->") || body.startsWith("WEBVTT")) buf.push(body);
    } catch {
      /* response body may be gone — ignore */
    }
  });
  return {
    drain: () => buf,
    reset: () => {
      buf = [];
    },
  };
}

// ── Phase A: login (auto-fills credentials; headed for challenge assist) ──

async function runLogin(): Promise<void> {
  const email = process.env.DLAI_EMAIL;
  const password = process.env.DLAI_PASSWORD;
  if (!email || !password) {
    throw new Error(
      "Set DLAI_EMAIL and DLAI_PASSWORD in .env.local before running --login.",
    );
  }

  mkdirSync(AUTH_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext(BROWSER_OPTS);
  const page = await context.newPage();

  // Hitting the gated course while unauthenticated 302s to the identity
  // provider (auth.deeplearning.ai) that hosts the real email/password form,
  // with the correct OIDC/PKCE params already attached.
  console.log("→ Opening DeepLearning.AI sign-in…");
  await page.goto(COURSE_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });

  try {
    await page.waitForURL(AUTH_LOGIN_RE, { timeout: 45_000 });
  } catch {
    if (!looksLikeLogin(page.url())) {
      // Browser profile already carried a valid session — just persist it.
      await context.storageState({ path: AUTH_STATE });
      console.log(`✓ Already signed in. Session saved → ${AUTH_STATE}`);
      await browser.close();
      return;
    }
  }
  await page.waitForTimeout(2500);

  // Dismiss a cookie-consent banner if it overlays the form.
  await page
    .locator(
      '#onetrust-accept-btn-handler, button:has-text("Accept all"), button:has-text("Accept All")',
    )
    .first()
    .click({ timeout: 3000 })
    .catch(() => {});

  // Fill the email + password form (NOT the Google/LinkedIn/Apple SSO buttons)
  // and submit it via the exact "Sign in" button.
  const emailInput = page
    .locator(
      'input#email, input[type="email"], input[name="email"], input[autocomplete="username"], input[type="text"]:visible',
    )
    .first();
  await emailInput.waitFor({ state: "visible", timeout: 30_000 });
  await emailInput.fill(email);

  const pwInput = page
    .locator('input#password, input[type="password"]')
    .first();
  await pwInput.waitFor({ state: "visible", timeout: 15_000 });
  await pwInput.fill(password);

  await page
    .getByRole("button", { name: /^\s*sign in\s*$/i })
    .first()
    .click({ timeout: 8000 })
    .catch(async () => {
      await pwInput.press("Enter").catch(() => {});
    });

  console.log(
    "\n  Credentials submitted. If a captcha / 2FA appears, complete it in the\n" +
      "  browser window — waiting up to 6 minutes for sign-in to finish…\n",
  );

  // Success = we land back on learn.deeplearning.ai, off the login/auth screens.
  try {
    await page.waitForURL(
      (u) => {
        const s = u.toString();
        return s.includes("learn.deeplearning.ai") && !looksLikeLogin(s);
      },
      { timeout: 360_000 },
    );
  } catch {
    throw new Error(
      "Sign-in did not complete within 6 minutes. Check DLAI_EMAIL/DLAI_PASSWORD in .env.local, then re-run `pnpm scrape:dlai:login`.",
    );
  }
  await page.waitForTimeout(4000);

  // Verify the session actually reaches the course (not bounced to login).
  await page.goto(COURSE_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(3000);
  if (looksLikeLogin(page.url())) {
    throw new Error("Still redirected to login after sign-in — session not valid.");
  }

  await context.storageState({ path: AUTH_STATE });
  console.log(`✓ Session saved → ${AUTH_STATE}`);
  await browser.close();
}

// ── Lesson discovery ─────────────────────────────────────────────────

interface LessonRef {
  title: string;
  url: string;
}

async function discoverLessons(page: Page): Promise<LessonRef[]> {
  // The course shell renders a left-hand lesson nav; lesson links contain the
  // course slug + a lesson segment. Collect them in DOM order, de-duped.
  const refs = await page.evaluate((slug: string) => {
    const out: { title: string; url: string }[] = [];
    const seen = new Set<string>();
    const anchors = [
      ...document.querySelectorAll<HTMLAnchorElement>("a[href]"),
    ];
    for (const a of anchors) {
      const href = a.href;
      if (!href.includes(`/courses/${slug}`)) continue;
      if (!/\/lesson|\/scl\/|\/m\//i.test(href) && href.replace(/\/$/, "") === `https://learn.deeplearning.ai/courses/${slug}`) {
        continue;
      }
      if (!/\/lesson|\/scl|\/m\/|\/\d+/i.test(new URL(href).pathname.replace(`/courses/${slug}`, "")))
        continue;
      const clean = href.split("#")[0];
      if (seen.has(clean)) continue;
      seen.add(clean);
      out.push({
        title: (a.textContent ?? "").replace(/\s+/g, " ").trim(),
        url: clean,
      });
    }
    return out;
  }, COURSE_SLUG);

  return refs;
}

// ── Per-lesson extraction ────────────────────────────────────────────

interface Lesson {
  index: number;
  title: string;
  url: string;
  durationSecs: number | null;
  videoSrc: string | null;
  subtitles: { source: "vtt" | "dom" | "none"; cues: Cue[]; text: string };
  transcriptDom: string;
  notebook: { present: boolean; cells: string[] };
  resources: { label: string; href: string }[];
}

async function scrapeLesson(
  page: Page,
  ref: LessonRef,
  index: number,
  vtt: { drain: () => string[]; reset: () => void },
): Promise<Lesson> {
  vtt.reset();
  await page.goto(ref.url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  // Let the SPA hydrate the player + transcript panel.
  await page.waitForTimeout(6000);
  for (let i = 0; i < 4; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(800);
  }

  // Click a "Transcript" tab/disclosure if the panel is collapsed.
  for (const name of [/transcript/i, /show transcript/i]) {
    await page
      .getByRole("button", { name })
      .first()
      .click({ timeout: 2500 })
      .catch(() => {});
    await page
      .getByRole("tab", { name })
      .first()
      .click({ timeout: 2500 })
      .catch(() => {});
  }
  await page.waitForTimeout(1500);

  const dom = await page.evaluate(() => {
    const txt = (el: Element | null) =>
      (el?.textContent ?? "").replace(/\s+\n/g, "\n").replace(/[ \t]+/g, " ").trim();

    const h1 =
      document.querySelector("h1") ??
      document.querySelector('[class*="title" i]');
    const title = (h1?.textContent ?? "").replace(/\s+/g, " ").trim();

    // Video source: <video src>, <source>, or a player iframe.
    let videoSrc: string | null = null;
    const v = document.querySelector("video");
    if (v) videoSrc = v.currentSrc || v.getAttribute("src") || null;
    if (!videoSrc) {
      const s = document.querySelector("video source");
      videoSrc = s?.getAttribute("src") ?? null;
    }
    let durationSecs: number | null =
      v && Number.isFinite(v.duration) && v.duration > 0
        ? Math.round(v.duration)
        : null;
    const iframes = [
      ...document.querySelectorAll<HTMLIFrameElement>("iframe"),
    ].map((f) => f.src);
    if (!videoSrc) {
      videoSrc =
        iframes.find((s) => /mux|vimeo|youtube|player|video/i.test(s)) ?? null;
    }

    // Transcript panel: prefer an explicit transcript container, else the
    // main lesson content column.
    const tEl =
      document.querySelector(
        '[class*="transcript" i],[data-testid*="transcript" i],[id*="transcript" i]',
      ) ??
      document.querySelector("main article, main [class*='content' i], main");
    const transcriptDom = txt(tEl);

    // Embedded notebook: a coding/Jupyter iframe. Cross-origin bodies can't be
    // read from here — capture same-origin code cells if reachable, plus the
    // iframe URL as a resource.
    const nbFrames = iframes.filter((s) =>
      /notebook|jupyter|lab|colab|code|dlai|s172|deeplearning/i.test(s),
    );
    let cells: string[] = [];
    try {
      for (const f of document.querySelectorAll("iframe")) {
        const d = (f as HTMLIFrameElement).contentDocument;
        if (!d) continue;
        const cs = [
          ...d.querySelectorAll(".CodeMirror-code, .cm-content, pre code, .input_area"),
        ]
          .map((c) => (c.textContent ?? "").trim())
          .filter(Boolean);
        cells = cells.concat(cs);
      }
    } catch {
      /* cross-origin — expected */
    }

    // Resource links: downloads / external references in the lesson body.
    const resources = [
      ...document.querySelectorAll<HTMLAnchorElement>("a[href]"),
    ]
      .filter((a) => {
        const h = a.href;
        return (
          /\.(ipynb|pdf|zip|csv|py|json|txt)(\?|$)/i.test(h) ||
          /drive\.google|github\.com|gist\.|colab\.research|dropbox|raw\.github/i.test(
            h,
          ) ||
          /download|resource|notebook/i.test(a.textContent ?? "")
        );
      })
      .map((a) => ({
        label: (a.textContent ?? "").replace(/\s+/g, " ").trim() || a.href,
        href: a.href,
      }))
      .filter(
        (r, i, arr) => arr.findIndex((x) => x.href === r.href) === i,
      );

    return {
      title,
      videoSrc,
      durationSecs,
      transcriptDom,
      notebookFrames: nbFrames,
      cells,
      resources,
    };
  });

  // Resolve subtitles: network VTT first, DOM transcript fallback.
  const vttBodies = vtt.drain();
  let subtitles: Lesson["subtitles"] = {
    source: "none",
    cues: [],
    text: "",
  };
  if (vttBodies.length) {
    const best = vttBodies
      .map(parseVtt)
      .sort((a, b) => b.text.length - a.text.length)[0];
    if (best && best.text.trim())
      subtitles = { source: "vtt", cues: best.cues, text: best.text };
  }
  if (subtitles.source === "none" && dom.transcriptDom.length > 80) {
    subtitles = { source: "dom", cues: [], text: dom.transcriptDom };
  }

  const resources = [...dom.resources];
  for (const f of dom.notebookFrames)
    if (!resources.some((r) => r.href === f))
      resources.push({ label: "notebook (iframe)", href: f });

  return {
    index,
    title: dom.title || ref.title || `Lesson ${index + 1}`,
    url: ref.url,
    durationSecs: dom.durationSecs,
    videoSrc: dom.videoSrc,
    subtitles,
    transcriptDom: dom.transcriptDom,
    notebook: { present: dom.notebookFrames.length > 0, cells: dom.cells },
    resources,
  };
}

// ── Phase B: scrape ──────────────────────────────────────────────────

async function runScrape(recon: boolean): Promise<void> {
  if (!existsSync(AUTH_STATE)) {
    throw new Error(
      `No cached session at ${AUTH_STATE}.\n` +
        "Run `pnpm scrape:dlai:login` first (headed; solve any challenge).",
    );
  }

  mkdirSync(DATA_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: !recon });
  const context = await browser.newContext({
    ...BROWSER_OPTS,
    storageState: AUTH_STATE,
  });
  const vtt = attachVttCapture(context);
  const page = await context.newPage();

  console.log(`→ Loading course: ${COURSE_URL}`);
  await page.goto(COURSE_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(6000);

  if (looksLikeLogin(page.url())) {
    await browser.close();
    throw new Error(
      "Session expired (redirected to login). Re-run `pnpm scrape:dlai:login`.",
    );
  }

  const courseTitle =
    (await page.locator("h1").first().textContent().catch(() => null))
      ?.trim() || COURSE_SLUG;

  let lessons = await discoverLessons(page);
  console.log(`  Found ${lessons.length} lesson links`);

  if (recon) {
    mkdirSync(RECON_DIR, { recursive: true });
    await page.screenshot({
      path: join(RECON_DIR, "course.png"),
      fullPage: true,
    });
    const probe = await page.evaluate(() => ({
      title: document.querySelector("h1")?.textContent?.trim() ?? null,
      anchorCount: document.querySelectorAll("a[href]").length,
      iframes: [...document.querySelectorAll("iframe")].map((f) => f.src),
      videoEls: document.querySelectorAll("video").length,
      transcriptCandidates: [
        ...document.querySelectorAll(
          '[class*="transcript" i],[id*="transcript" i],[data-testid*="transcript" i]',
        ),
      ].map((e) => e.className || e.id),
      navLinks: [...document.querySelectorAll<HTMLAnchorElement>("a[href]")]
        .map((a) => ({
          t: (a.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 60),
          h: a.href,
        }))
        .slice(0, 120),
    }));
    writeFileSync(
      join(RECON_DIR, "course-probe.json"),
      JSON.stringify({ discovered: lessons, probe }, null, 2),
    );
    if (lessons[0]) {
      const first = await scrapeLesson(page, lessons[0], 0, vtt);
      await page.screenshot({
        path: join(RECON_DIR, "lesson-0.png"),
        fullPage: true,
      });
      writeFileSync(
        join(RECON_DIR, "lesson-0.json"),
        JSON.stringify(first, null, 2),
      );
    }
    console.log(`✓ Recon written → ${RECON_DIR}`);
    await browser.close();
    return;
  }

  if (!lessons.length) {
    await browser.close();
    throw new Error(
      "No lesson links discovered — run `pnpm scrape:dlai -- --recon` and tune selectors in discoverLessons().",
    );
  }

  const out: Lesson[] = [];
  for (let i = 0; i < lessons.length; i++) {
    const ref = lessons[i];
    process.stdout.write(
      `  [${i + 1}/${lessons.length}] ${ref.title || ref.url} … `,
    );
    try {
      const lesson = await scrapeLesson(page, ref, i, vtt);
      out.push(lesson);
      console.log(
        `${lesson.subtitles.source}=${lesson.subtitles.text.length}c` +
          `${lesson.notebook.present ? " +nb" : ""}` +
          `${lesson.resources.length ? ` +${lesson.resources.length}res` : ""}`,
      );
    } catch (e) {
      console.log(`✗ ${(e as Error).message}`);
      out.push({
        index: i,
        title: ref.title || `Lesson ${i + 1}`,
        url: ref.url,
        durationSecs: null,
        videoSrc: null,
        subtitles: { source: "none", cues: [], text: "" },
        transcriptDom: "",
        notebook: { present: false, cells: [] },
        resources: [],
      });
    }
    await page.waitForTimeout(LESSON_DELAY_MS);
  }

  const doc = {
    slug: COURSE_SLUG,
    provider: "DeepLearning.AI",
    url: COURSE_URL,
    title: courseTitle,
    scrapedAt: new Date().toISOString(),
    lessonCount: out.length,
    lessons: out,
  };
  writeFileSync(OUTPUT, JSON.stringify(doc, null, 2));

  const withText = out.filter((l) => l.subtitles.text.length > 0).length;
  console.log(`\n${"─".repeat(50)}`);
  console.log(`✓ ${OUTPUT}`);
  console.log(
    `  ${out.length} lessons · ${withText} with subtitles/transcript · ` +
      `title: "${courseTitle}"`,
  );
  await browser.close();
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--login")) {
    await runLogin();
    return;
  }
  await runScrape(args.includes("--recon"));
}

main().catch((e) => {
  console.error(`\n✗ ${e.message ?? e}`);
  process.exit(1);
});
