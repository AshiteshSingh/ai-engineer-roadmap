/**
 * Scrape AI/ML courses from Udemy topic pages.
 * Run: pnpm scrape:udemy
 *
 * Strategy:
 *  1. Crawl 20+ AI/ML seed topic pages + discovered related topics
 *  2. Deep-scrape each course page (bypasses Cloudflare with fresh contexts)
 *  3. Classify each course into one of 10 topic groups
 *  4. Upsert into external_courses with topic_group; map to lesson slugs
 */
import { webkit, type BrowserContext } from "playwright";
import { db } from "@/src/db";
import { externalCourses, lessonCourses } from "@/src/db/schema";

const DELAY_MS = 3000;

const BROWSER_OPTS = {
  userAgent:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
  viewport: { width: 1440 as const, height: 900 as const },
  locale: "en-US" as const,
};

const SEED_TOPICS = [
  // Generative AI & LLMs
  "generative-ai",
  "chatgpt",
  "large-language-models",
  "prompt-engineering",
  "openai-api",
  // RAG & Vector Search
  "vector-databases",
  "retrieval-augmented-generation",
  // Agents & Frameworks
  "langchain",
  "ai-agents",
  // Deep Learning
  "deep-learning",
  "neural-networks",
  "pytorch",
  "tensorflow",
  "keras",
  // NLP & Transformers
  "natural-language-processing",
  "transformers",
  // Computer Vision
  "computer-vision",
  "object-detection",
  // ML Foundations
  "machine-learning",
  // MLOps
  "mlops",
  // Fine-tuning
  "fine-tuning",
  // Reinforcement Learning
  "reinforcement-learning",
  // Frontend / CSS / React / TypeScript
  "css",
  "react-js",
  "typescript",
  "javascript",
  "flexbox",
  "css-grid",
  "frontend-web-development",
  "web-design",
  "responsive-design",
  "web-accessibility",
];

// Promotional courses Udemy shows on every topic page — skip these.
const PROMO_SLUGS = new Set([
  "google-ai-fundamentals",
  "google-ai-for-brainstorming-and-planning",
  "google-ai-for-research-and-insights",
  "google-ai-for-writing-and-communicating",
  "google-ai-for-content-creation",
  "google-ai-for-data-analysis",
  "google-ai-for-workflow-automation",
]);

// Any course matching at least one of these is relevant.
const RELEVANCE_KEYWORDS = [
  // Generative AI
  "generative ai", "chatgpt", "gpt-4", "gpt-3", "llm", "large language model",
  "prompt engineering", "openai", "anthropic", "claude", "gemini",
  // RAG & embeddings
  "rag", "retrieval augmented", "retrieval-augmented",
  "vector database", "vector db", "vectorstore", "vector store",
  "pinecone", "weaviate", "qdrant", "milvus", "chroma", "chromadb",
  "pgvector", "faiss", "similarity search", "embedding",
  // Agents & frameworks
  "langchain", "langgraph", "llamaindex", "llama-index", "ai agent",
  "autogen", "crewai", "function calling", "tool calling",
  // Deep learning
  "deep learning", "neural network", "pytorch", "tensorflow", "keras",
  // NLP
  "natural language processing", "nlp", "transformers", "bert", "hugging face",
  "text classification", "named entity", "sentiment analysis",
  // Computer vision
  "computer vision", "image recognition", "object detection", "yolo",
  "image segmentation", "convolutional",
  // ML
  "machine learning", "scikit-learn", "sklearn", "xgboost", "gradient boosting",
  // MLOps
  "mlops", "model deployment", "mlflow", "kubeflow", "model serving",
  // Fine-tuning
  "fine-tun", "lora", "peft", "rlhf", "instruction tuning",
  // RL
  "reinforcement learning",
  // CSS & Layout
  "css", "flexbox", "grid layout", "css grid", "responsive design",
  "css animation", "css layout", "box model", "css specificity",
  "css positioning", "media queries", "sass", "scss",
  // React & Frontend
  "react", "react hooks", "usestate", "useeffect", "react component",
  "react patterns", "jsx", "virtual dom", "react performance", "next.js", "nextjs",
  // TypeScript & JavaScript
  "typescript", "type system", "generics", "type inference", "javascript", "es6",
  // General Frontend
  "frontend", "front-end", "design system", "component library",
  "web accessibility", "a11y", "aria", "storybook",
];

// Keywords used when following related topics from course/topic pages.
const FOLLOW_TOPIC_KEYWORDS = [
  "ai", "ml", "machine-learning", "deep-learning", "neural",
  "llm", "gpt", "openai", "generative", "langchain", "llama",
  "vector", "embed", "rag", "retriev",
  "nlp", "natural-language", "transformers", "bert",
  "computer-vision", "image", "object-detect",
  "pytorch", "tensorflow", "keras",
  "mlops", "deploy", "model-serv",
  "fine-tun", "reinforcement", "agent",
  // Frontend
  "css", "react", "frontend", "front-end", "typescript", "javascript",
  "component", "responsive", "accessibility", "design-system", "web-dev",
  "layout", "flexbox", "grid", "sass", "tailwind", "next-js",
];

// ── Topic group classifier ───────────────────────────────────────────

const TOPIC_GROUPS: Array<{ name: string; signals: string[] }> = [
  {
    name: "Generative AI & LLMs",
    signals: [
      "generative ai", "chatgpt", "gpt-4", "gpt-3", "gpt4", "gpt3",
      "large language model", "llm", "prompt engineering", "openai api",
      "anthropic", "claude", "gemini", "mistral", "llama 2", "llama2",
    ],
  },
  {
    name: "RAG & Vector Search",
    signals: [
      "rag", "retrieval augmented", "retrieval-augmented",
      "vector database", "vector db", "vectorstore", "vector store",
      "pinecone", "weaviate", "qdrant", "milvus", "chroma", "chromadb",
      "pgvector", "faiss", "similarity search", "embedding model",
      "semantic search", "vector search",
    ],
  },
  {
    name: "AI Agents & Frameworks",
    signals: [
      "ai agent", "langchain", "langgraph", "llamaindex", "llama-index",
      "autogen", "crewai", "function calling", "tool calling", "tool use",
      "agentic", "multi-agent",
    ],
  },
  {
    name: "Fine-tuning & RLHF",
    signals: [
      "fine-tun", "fine tune", "lora", "qlora", "peft",
      "rlhf", "instruction tuning", "dpo", "sft", "adapter",
    ],
  },
  {
    name: "Deep Learning",
    signals: [
      "deep learning", "neural network", "pytorch", "tensorflow", "keras",
      "backpropagation", "cnn", "rnn", "lstm", "gru", "attention mechanism",
    ],
  },
  {
    name: "Computer Vision",
    signals: [
      "computer vision", "image recognition", "object detection",
      "yolo", "image segmentation", "convolutional neural", "cv2", "opencv",
    ],
  },
  {
    name: "NLP & Transformers",
    signals: [
      "natural language processing", "nlp", "transformers", "hugging face",
      "bert", "text classification", "named entity", "sentiment analysis",
      "text generation", "tokenization",
    ],
  },
  {
    name: "MLOps & Deployment",
    signals: [
      "mlops", "model deployment", "model serving", "mlflow", "kubeflow",
      "bentoml", "triton", "docker for ml", "kubernetes for ml",
      "ci/cd for ml", "model monitoring",
    ],
  },
  {
    name: "Reinforcement Learning",
    signals: [
      "reinforcement learning", "rl agent", "openai gym", "ppo", "dqn",
      "policy gradient", "q-learning", "actor-critic",
    ],
  },
  {
    name: "ML Foundations",
    signals: [
      "machine learning", "scikit-learn", "sklearn", "xgboost",
      "gradient boosting", "random forest", "decision tree",
      "logistic regression", "linear regression", "statistics for data",
      "data science",
    ],
  },
  // Frontend
  {
    name: "CSS & Layout",
    signals: [
      "css", "flexbox", "css grid", "grid layout", "responsive design",
      "css animation", "css layout", "box model", "css specificity",
      "css positioning", "media queries", "sass", "scss", "tailwind",
      "css architecture", "css modules", "styled-components",
    ],
  },
  {
    name: "React & Frontend Frameworks",
    signals: [
      "react hooks", "usestate", "useeffect", "react component",
      "react pattern", "jsx", "virtual dom", "react performance",
      "react router", "next.js", "nextjs", "remix", "gatsby",
      "react native", "react context", "react redux", "zustand",
      "react query", "tanstack",
    ],
  },
  {
    name: "TypeScript & JavaScript",
    signals: [
      "typescript", "type system", "type inference", "generics",
      "javascript", "es6", "es2015", "ecmascript", "promises",
      "async await", "closure", "prototype", "dom manipulation",
    ],
  },
  {
    name: "Design Systems & Accessibility",
    signals: [
      "design system", "component library", "design tokens",
      "storybook", "accessibility", "a11y", "aria", "screen reader",
      "keyboard navigation", "wcag", "inclusive design",
    ],
  },
  {
    name: "Frontend Interview Prep",
    signals: [
      "frontend interview", "front-end interview", "css interview",
      "react interview", "javascript interview", "coding challenge",
      "css challenge", "react challenge", "frontend assessment",
      "take-home", "whiteboard",
    ],
  },
];

interface CourseMetadata {
  instructors: string[];
  subtitle: string | null;
  price: string | null;
  whatYoullLearn: string[];
  requirements: string[];
  targetAudience: string[];
  curriculum: { section: string; lectures: number; duration: string }[];
  lastUpdated: string | null;
  totalLectures: number | null;
  totalDuration: string | null;
  discoveredFrom: string;
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

function classifyTopicGroup(course: ScrapedCourse): string {
  const fullText = [
    course.title,
    course.description ?? "",
    course.metadata.subtitle ?? "",
    ...course.metadata.whatYoullLearn,
    ...course.metadata.curriculum.map((s) => s.section),
  ]
    .join(" ")
    .toLowerCase();

  for (const { name, signals } of TOPIC_GROUPS) {
    if (signals.some((s) => fullText.includes(s))) return name;
  }
  return "Other";
}

// ── Slug keyword mapping ─────────────────────────────────────────────

const SLUG_KEYWORDS: Record<string, string[]> = {
  "vector-databases": [
    "vector database", "pinecone", "weaviate", "qdrant", "milvus", "chroma",
    "pgvector", "faiss", "similarity search", "nearest neighbor", "vector store",
    "vector index", "vector search", "ann index", "hnsw",
  ],
  "embedding-models": [
    "embedding model", "sentence transformer", "text-embedding", "word2vec",
    "sbert", "embed model", "vector representation", "openai embedding",
  ],
  "retrieval-strategies": [
    "retrieval", "semantic search", "hybrid search", "reranking", "bm25",
    "dense retrieval", "sparse retrieval", "rag retrieval", "search engine",
  ],
  "advanced-rag": [
    "advanced rag", "agentic rag", "multi-step retrieval", "query decomposition",
    "self-rag", "corrective rag", "graph rag", "rag pipeline",
  ],
  "chunking-strategies": [
    "chunking", "text splitting", "document splitting", "chunk size",
    "recursive split", "semantic chunking",
  ],
  "rag-evaluation": [
    "rag eval", "faithfulness", "context relevance", "answer relevance",
    "groundedness", "ragas", "trulens",
  ],
  "embeddings": [
    "embedding", "dense vector", "embedding space", "cosine similarity",
    "semantic similarity", "vector embedding",
  ],
  "langgraph": [
    "langgraph", "langchain graph", "state graph", "agentic rag",
  ],
  "function-calling": [
    "function calling", "tool calling", "tool use",
  ],
  "agent-architectures": [
    "ai agent", "agent architecture", "react agent", "react loop",
    "multi-agent", "agentic",
  ],
  // Frontend
  "css-layout-fundamentals": [
    "flexbox", "css grid", "grid layout", "css layout", "responsive design",
    "responsive layout", "centering", "css centering", "media queries",
    "mobile first", "css display", "css float", "css position",
  ],
  "css-theory": [
    "box model", "css specificity", "cascade", "css positioning",
    "stacking context", "z-index", "block formatting", "bfc",
    "css animation", "css transition", "css debugging", "css inheritance",
    "css variables", "custom properties",
  ],
  "react-patterns": [
    "react hooks", "usestate", "useeffect", "usememo", "usecallback",
    "useref", "custom hook", "component composition", "render prop",
    "higher order component", "hoc", "react context", "react performance",
    "react memo", "react suspense", "error boundary",
  ],
  "typescript-for-react": [
    "typescript react", "react typescript", "type inference", "generics",
    "discriminated union", "type guard", "utility type", "mapped type",
    "conditional type", "typescript generic", "typescript interface",
    "typescript enum",
  ],
  "design-systems": [
    "design system", "component library", "design tokens", "style guide",
    "atomic design", "storybook", "design pattern", "theming",
    "design consistency", "ui kit",
  ],
  "frontend-accessibility": [
    "accessibility", "a11y", "aria", "screen reader", "keyboard navigation",
    "wcag", "accessible component", "semantic html", "focus management",
    "color contrast", "assistive technology",
  ],
  "frontend-interview": [
    "frontend interview", "front-end interview", "css interview",
    "react interview", "javascript interview", "coding challenge",
    "css challenge", "react challenge", "frontend assessment",
    "web developer interview", "technical interview frontend",
  ],
};

function matchSlugs(course: ScrapedCourse): { slug: string; relevance: number }[] {
  const fullText = [
    course.title,
    course.description ?? "",
    ...course.metadata.whatYoullLearn,
    ...course.metadata.curriculum.map((s) => s.section),
  ]
    .join(" ")
    .toLowerCase();

  const matches: { slug: string; relevance: number }[] = [];

  for (const [slug, keywords] of Object.entries(SLUG_KEYWORDS)) {
    const hitCount = keywords.filter((kw) => fullText.includes(kw.toLowerCase())).length;
    if (hitCount > 0) {
      const relevance = Math.min(1.0, Math.max(0.3, (hitCount / keywords.length) * 1.5));
      matches.push({ slug, relevance: Math.round(relevance * 100) / 100 });
    }
  }

  return matches;
}

function isRelevant(course: ScrapedCourse): boolean {
  const fullText = [
    course.title,
    course.metadata.subtitle ?? "",
    course.description ?? "",
    ...course.metadata.whatYoullLearn,
    ...course.metadata.curriculum.map((s) => s.section),
  ]
    .join(" ")
    .toLowerCase();

  return RELEVANCE_KEYWORDS.some((kw) => fullText.includes(kw));
}

// ── Browser helpers ──────────────────────────────────────────────────

async function freshContext(): Promise<{ context: BrowserContext; close: () => Promise<void> }> {
  const browser = await webkit.launch({ headless: true });
  const context = await browser.newContext(BROWSER_OPTS);
  return { context, close: () => browser.close() };
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
      return !PROMO_SLUGS.has(slug);
    });
}

// ── Phase 1: Crawl topic pages ───────────────────────────────────────

async function crawlTopicPage(topic: string): Promise<{ courses: string[]; relatedTopics: string[] }> {
  const { context, close } = await freshContext();
  try {
    const page = await context.newPage();
    const url = `https://www.udemy.com/topic/${topic}/`;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForTimeout(6000);

    const title = await page.title();
    if (title.includes("moment") || title.includes("404")) {
      return { courses: [], relatedTopics: [] };
    }

    await page.click('[id*="onetrust-accept"], button:has-text("Accept")').catch(() => {});

    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(1500);
    }

    const { courseHrefs, topicHrefs } = await page.evaluate(() => {
      // 1. Anchor tags in the DOM
      const anchorCourses = [...document.querySelectorAll("a")]
        .map((a) => (a as HTMLAnchorElement).href)
        .filter((h) => h.includes("/course/"));

      // 2. Mine __NEXT_DATA__ for every /course/<slug> mention (SSR payload)
      const nextDataEl = document.getElementById("__NEXT_DATA__");
      const nextDataCourses: string[] = [];
      if (nextDataEl?.textContent) {
        const matches = nextDataEl.textContent.match(/\/course\/([a-z0-9][a-z0-9-]{2,80})/g) ?? [];
        for (const m of matches) {
          nextDataCourses.push(`https://www.udemy.com${m}/`);
        }
      }

      // 3. Mine the full raw HTML for any remaining /course/<slug> patterns
      const htmlMatches = document.documentElement.innerHTML
        .match(/\/course\/([a-z0-9][a-z0-9-]{2,80})(?:\/|")/g) ?? [];
      const htmlCourses = htmlMatches.map(
        (m) => `https://www.udemy.com${m.replace(/["\/]$/, "")}/`,
      );

      const topicHrefs = [...document.querySelectorAll("a")]
        .map((a) => (a as HTMLAnchorElement).href)
        .filter((h) => h.match(/^https:\/\/www\.udemy\.com\/topic\/[a-z0-9-]+\/?$/))
        .filter((v, i, arr) => arr.indexOf(v) === i);

      return {
        courseHrefs: [...anchorCourses, ...nextDataCourses, ...htmlCourses],
        topicHrefs,
      };
    });

    const relatedTopics = topicHrefs
      .map((h: string) => h.match(/\/topic\/([a-z0-9-]+)/)?.[1])
      .filter((t): t is string => !!t);

    return { courses: extractCourseUrls(courseHrefs), relatedTopics };
  } finally {
    await close();
  }
}

// ── Phase 2: Deep scrape a course page ───────────────────────────────

/** Scrape a course page and also return related topic slugs. */
async function deepScrapeWithTopics(
  url: string,
  discoveredFrom: string,
): Promise<{ course: ScrapedCourse | null; relatedTopics: string[] }> {
  const { context, close } = await freshContext();
  try {
    const page = await context.newPage();

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForSelector("h1", { timeout: 15000 });
    await page.waitForTimeout(5000);

    for (let i = 0; i < 8; i++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(1000);
    }

    const expandBtns = page.locator('button:has-text("Show more"), button:has-text("Expand all sections")');
    const btnCount = await expandBtns.count();
    for (let i = 0; i < Math.min(btnCount, 10); i++) {
      await expandBtns.nth(i).click().catch(() => {});
      await page.waitForTimeout(500);
    }

    const result = await page.evaluate((courseUrl: string) => {
      const lines = document.body.innerText.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
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
      if (ratingLine) { const m = ratingLine.match(/([\d.]+)\s*out/); if (m) rating = parseFloat(m[1]); }
      else { const ri = lines.findIndex((l) => /^\d\.\d$/.test(l)); if (ri >= 0) rating = parseFloat(lines[ri]); }

      let reviewCount: number | null = null;
      const rl = lines.find((l) => /\([\d,]+\s*rating/.test(l));
      if (rl) { const m = rl.match(/([\d,]+)\s*rating/); if (m) reviewCount = parseInt(m[1].replace(/,/g, ""), 10); }

      let enrolled: number | null = null;
      const el = lines.find((l) => /^[\d,]+\s*student/i.test(l));
      if (el) { const m = el.match(/([\d,]+)\s*student/i); if (m) enrolled = parseInt(m[1].replace(/,/g, ""), 10); }

      const ci = lines.findIndex((l) => l === "Created by");
      const instructors: string[] = ci >= 0 && lines[ci + 1] ? lines[ci + 1].split(",").map(s => s.trim()).filter(Boolean) : [];

      const updatedLine = lines.find((l) => /^Last updated/.test(l));
      let language = "English";
      if (updatedLine) { const ui = lines.indexOf(updatedLine); const ll = lines[ui + 1]; if (ll && /^[A-Z][a-z]+$/.test(ll)) language = ll; }

      const pl = lines.find((l) => /^(Free|(\$|€|£|₹|lei\s*)[\d,.]+)$/i.test(l));
      const isFree = pl ? /free/i.test(pl) : false;

      const li = lines.findIndex((l) => l === "What you'll learn");
      const whatYoullLearn: string[] = [];
      if (li >= 0) { for (let i = li + 1; i < lines.length; i++) { const line = lines[i]; if (/^(Explore related|Show more|Show less|Course content|Coding Exercises)/.test(line)) break; if (line.length > 10 && line.length < 300) whatYoullLearn.push(line); } }

      const coi = lines.findIndex((l) => l === "Course content");
      const curriculum: { section: string; lectures: number; duration: string }[] = [];
      let totalLectures: number | null = null;
      let totalDuration: string | null = null;
      if (coi >= 0) {
        const sl = lines[coi + 1];
        if (sl) { const lm = sl.match(/(\d+)\s*lecture/); if (lm) totalLectures = parseInt(lm[1], 10); const dm = sl.match(/([\dh\s]+\d+m)\s*total/); if (dm) totalDuration = dm[1].trim(); }
        for (let i = coi + 2; i < lines.length; i++) { const line = lines[i]; if (line === "Requirements" || line === "Description" || line === "Who this course is for:") break; if (line === "Expand all sections" || /^\d+ more section/.test(line)) continue; const st = lines[i + 1]; if (st && /^\d+\s*lecture/.test(st)) { const lm = st.match(/(\d+)\s*lecture/); const dm = st.match(/•\s*(.+)/); curriculum.push({ section: line, lectures: lm ? parseInt(lm[1], 10) : 0, duration: dm ? dm[1].trim() : "" }); i++; } }
      }

      const ri = lines.findIndex((l) => l === "Requirements");
      const requirements: string[] = [];
      if (ri >= 0) { for (let i = ri + 1; i < lines.length; i++) { const line = lines[i]; if (line === "Description" || line === "Who this course is for:" || line === "Show more") break; if (line.length > 5 && line.length < 300) requirements.push(line); } }

      const di = lines.findIndex((l, idx) => l === "Description" && idx > (coi || 0));
      let description: string | null = null;
      if (di >= 0) { const dl: string[] = []; for (let i = di + 1; i < lines.length; i++) { const line = lines[i]; if (line === "Who this course is for:" || line === "Show more" || line === "Show less") break; dl.push(line); } description = dl.join("\n").slice(0, 5000) || null; }
      if (!description) description = subtitle;

      const ti = lines.findIndex((l) => l === "Who this course is for:");
      const targetAudience: string[] = [];
      if (ti >= 0) { for (let i = ti + 1; i < lines.length; i++) { const line = lines[i]; if (/^(Show more|Show less|Students also|Report abuse|Privacy|By clicking)/.test(line)) break; if (line.length > 5 && line.length < 300) targetAudience.push(line); } }

      let level: string | null = null;
      const lvl = lines.find((l) => /^(Beginner|Intermediate|Advanced|All Levels)/i.test(l));
      if (lvl) level = lvl;

      let durationHours: number | null = null;
      const dur = lines.find((l) => /[\d.]+\s*total\s*hour/i.test(l));
      if (dur) { const m = dur.match(/([\d.]+)\s*total\s*hour/i); if (m) durationHours = parseFloat(m[1]); }
      else if (totalDuration) { const hm = totalDuration.match(/(\d+)h\s*(\d+)?m?/); if (hm) durationHours = parseInt(hm[1], 10) + (parseInt(hm[2] || "0", 10) / 60); }

      const ogImg = document.querySelector('meta[property="og:image"]') as HTMLMetaElement | null;
      const imageUrl = ogImg?.content ?? null;

      const relatedTopicSlugs = [...document.querySelectorAll("a")]
        .map((a) => a.href.match(/^https:\/\/www\.udemy\.com\/topic\/([a-z0-9-]+)/)?.[1])
        .filter((t): t is string => !!t)
        .filter((v, i, a) => a.indexOf(v) === i);

      return {
        course: { title, url: courseUrl, description, level, rating, reviewCount, durationHours, isFree, enrolled, imageUrl, language, metadata: { instructors, subtitle, price: pl ?? null, whatYoullLearn, requirements, targetAudience, curriculum, lastUpdated: updatedLine ?? null, totalLectures, totalDuration, discoveredFrom: "" } },
        relatedTopicSlugs,
      };
    }, url);

    if (!result || result.course.title === "Unknown" || result.course.title === "www.udemy.com") {
      return { course: null, relatedTopics: [] };
    }

    result.course.metadata.discoveredFrom = discoveredFrom;
    return { course: result.course as ScrapedCourse, relatedTopics: result.relatedTopicSlugs };
  } catch {
    return { course: null, relatedTopics: [] };
  } finally {
    await close();
  }
}

// ── DB upsert ────────────────────────────────────────────────────────

async function upsertCourse(course: ScrapedCourse, topicGroup: string) {
  // Strip large unused arrays to keep row size small (Neon free-tier transfer quota)
  const { requirements: _req, targetAudience: _ta, ...slimMeta } = course.metadata;
  // Truncate description and whatYoullLearn to reduce payload further
  const slimMetaFinal = {
    ...slimMeta,
    whatYoullLearn: slimMeta.whatYoullLearn.slice(0, 8),
    curriculum: slimMeta.curriculum.slice(0, 20),
  };

  const values = {
    title: course.title,
    url: course.url,
    provider: "Udemy" as const,
    description: course.description ? course.description.slice(0, 1500) : null,
    level: course.level,
    rating: course.rating,
    reviewCount: course.reviewCount,
    durationHours: course.durationHours,
    isFree: course.isFree,
    enrolled: course.enrolled,
    imageUrl: course.imageUrl,
    language: course.language,
    topicGroup,
    metadata: slimMetaFinal,
  };

  const [row] = await db
    .insert(externalCourses)
    .values(values)
    .onConflictDoUpdate({
      target: externalCourses.url,
      set: { ...values, updatedAt: new Date() },
    })
    .returning({ id: externalCourses.id });

  return row.id;
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  const discoveredUrls = new Map<string, string>(); // url → discovered-from topic
  const crawledTopics = new Set<string>();
  const topicQueue = [...SEED_TOPICS];

  // Phase 1: Crawl topic pages to discover course URLs
  console.log("Phase 1: Crawling topic pages for course discovery...\n");

  while (topicQueue.length > 0) {
    const topic = topicQueue.shift()!;
    if (crawledTopics.has(topic)) continue;
    crawledTopics.add(topic);

    process.stdout.write(`  /topic/${topic}/ ... `);
    const { courses, relatedTopics } = await crawlTopicPage(topic);
    console.log(`${courses.length} courses, ${relatedTopics.length} related topics`);

    for (const url of courses) {
      if (!discoveredUrls.has(url)) {
        discoveredUrls.set(url, topic);
      }
    }

    for (const rt of relatedTopics) {
      if (!crawledTopics.has(rt) && FOLLOW_TOPIC_KEYWORDS.some((kw) => rt.includes(kw))) {
        topicQueue.push(rt);
      }
    }

    await new Promise((r) => setTimeout(r, DELAY_MS));
  }

  console.log(`\nDiscovered ${discoveredUrls.size} unique courses from ${crawledTopics.size} topics\n`);

  if (discoveredUrls.size === 0) {
    console.log("No courses found — Cloudflare may be blocking topic pages.");
    return;
  }

  // Phase 2: Deep scrape each course
  console.log("Phase 2: Deep scraping courses...\n");
  let saved = 0;
  let skippedIrrelevant = 0;
  let blocked = 0;
  const courseEntries = [...discoveredUrls.entries()];

  for (const [i, [url, fromTopic]] of courseEntries.entries()) {
    const shortUrl = url.replace("https://www.udemy.com/course/", "").replace(/\/$/, "");
    console.log(`  [${i + 1}/${courseEntries.length}] ${shortUrl}`);

    const { course, relatedTopics } = await deepScrapeWithTopics(url, fromTopic);

    // Queue new topics discovered from course pages
    for (const rt of relatedTopics) {
      if (!crawledTopics.has(rt) && FOLLOW_TOPIC_KEYWORDS.some((kw) => rt.includes(kw))) {
        topicQueue.push(rt);
      }
    }

    if (!course || course.title === "www.udemy.com") {
      console.log("    ✗ Cloudflare blocked");
      blocked++;
    } else if (!isRelevant(course)) {
      console.log(`    ✗ Not relevant: "${course.title}"`);
      skippedIrrelevant++;
    } else {
      const topicGroup = classifyTopicGroup(course);
      const courseId = await upsertCourse(course, topicGroup);
      const slugs = matchSlugs(course);
      for (const { slug, relevance } of slugs) {
        await db.insert(lessonCourses).values({ lessonSlug: slug, courseId, relevance }).onConflictDoNothing();
      }

      console.log(`    ✓ [${topicGroup}] "${course.title}"`);
      console.log(`      ${course.rating}★ (${course.reviewCount} reviews) · ${course.enrolled} students · ${course.durationHours}h`);
      if (slugs.length > 0) {
        console.log(`      → ${slugs.map((s) => `${s.slug}(${s.relevance})`).join(", ")}`);
      }
      saved++;
    }

    await new Promise((r) => setTimeout(r, DELAY_MS));
  }

  // Phase 3: Crawl any newly discovered topics (from course pages)
  if (topicQueue.length > 0) {
    console.log(`\nPhase 3: Crawling ${topicQueue.length} newly discovered topics...\n`);
    const newUrls: [string, string][] = [];

    for (const topic of topicQueue) {
      if (crawledTopics.has(topic)) continue;
      crawledTopics.add(topic);

      process.stdout.write(`  /topic/${topic}/ ... `);
      const { courses } = await crawlTopicPage(topic);
      console.log(`${courses.length} courses`);

      for (const url of courses) {
        if (!discoveredUrls.has(url)) {
          discoveredUrls.set(url, topic);
          newUrls.push([url, topic]);
        }
      }
      await new Promise((r) => setTimeout(r, DELAY_MS));
    }

    if (newUrls.length > 0) {
      console.log(`\nPhase 3b: Deep scraping ${newUrls.length} newly discovered courses...\n`);
      for (const [i, [url, fromTopic]] of newUrls.entries()) {
        const shortUrl = url.replace("https://www.udemy.com/course/", "").replace(/\/$/, "");
        console.log(`  [${i + 1}/${newUrls.length}] ${shortUrl}`);

        const { course } = await deepScrapeWithTopics(url, fromTopic);
        if (!course || course.title === "www.udemy.com") {
          blocked++;
        } else if (!isRelevant(course)) {
          skippedIrrelevant++;
        } else {
          const topicGroup = classifyTopicGroup(course);
          const courseId = await upsertCourse(course, topicGroup);
          const slugs = matchSlugs(course);
          for (const { slug, relevance } of slugs) {
            await db.insert(lessonCourses).values({ lessonSlug: slug, courseId, relevance }).onConflictDoNothing();
          }
          console.log(`    ✓ [${topicGroup}] "${course.title}"`);
          saved++;
        }
        await new Promise((r) => setTimeout(r, DELAY_MS));
      }
    }
  }

  console.log(`\n${"─".repeat(50)}`);
  console.log(`Done. Saved: ${saved} | Skipped: ${skippedIrrelevant} | Blocked: ${blocked}`);
  console.log(`Topics crawled: ${crawledTopics.size}`);
}

main().catch(console.error);
