import fs from "fs";
import path from "path";

const CONTENT_DIR = path.join(process.cwd(), "content");

export type DifficultyLevel = "beginner" | "intermediate" | "advanced";

export interface Lesson {
  slug: string;
  fileSlug: string;
  number: number;
  title: string;
  category: string;
  excerpt: string;
  difficulty: DifficultyLevel;
  wordCount: number;
  readingTimeMin: number;
  url: string;
}

export interface LessonWithContent extends Lesson {
  content: string;
}

export interface CategoryMeta {
  slug: string;
  icon: string;
  description: string;
  gradient: [string, string]; // [from, to] CSS colors
  outcomes?: string[];
}

export interface GroupedLessons {
  category: string;
  meta: CategoryMeta;
  articles: Lesson[];
}

// Ordered list of slugs — position (1-indexed) defines the lesson number.
// This order IS the audiobook spine: phases 0-6 play continuously; the
// Appendix is reachable but excluded from the continuous-play flow.
// `*` slugs are new Cloudflare-specific pilot chapters.
const LESSON_SLUGS = [
  // Phase 0 · The AI Engineer on the Edge (1-2)
  "ai-on-cloudflare-workers", // *
  "ai-engineer-roadmap",
  // Phase 1 · Models & Inference on Workers AI (3-9)
  "workers-ai-models", // *
  "transformer-architecture",
  "tokenization",
  "model-architectures",
  "scaling-laws",
  "inference-optimization",
  "pretraining-data",
  // Phase 2 · Prompting & Structured Output (10-18)
  "prompt-engineering-fundamentals",
  "few-shot-chain-of-thought",
  "system-prompts",
  "structured-output",
  "function-calling",
  "tool-use",
  "prompt-optimization",
  "prompt-caching",
  "adversarial-prompting",
  // Phase 3 · Embeddings & RAG on Vectorize (19-27)
  "vectorize-rag", // *
  "embeddings",
  "embedding-models",
  "vector-databases",
  "chunking-strategies",
  "retrieval-strategies",
  "rag",
  "advanced-rag",
  "rag-evaluation",
  // Phase 4 · Agents, Memory & Orchestration on Workers (28-44)
  "langgraph-d1-checkpointing", // *
  "langmem-vectorize-memory", // *
  "agent-architectures",
  "multi-agent-systems",
  "agent-memory",
  "agent-orchestration",
  "agent-harnesses",
  "agent-sdks",
  "code-agents",
  "agent-debugging",
  "langgraph",
  "memory",
  "context-engineering",
  "context-window-management",
  "memory-architectures",
  "dynamic-context-assembly",
  "context-compression",
  // Phase 5 · Evals, Safety & Observability (45-62)
  "eval-fundamentals",
  "benchmark-design",
  "llm-as-judge",
  "human-evaluation",
  "eval-frameworks-comparison",
  "deepeval-synthesizer",
  "agent-evaluation",
  "red-teaming",
  "langgraph-red-teaming",
  "guardrails-filtering",
  "hallucination-mitigation",
  "constitutional-ai",
  "bias-fairness",
  "ai-governance",
  "interpretability",
  "observability",
  "online-evaluation",
  "ai-gateway",
  // Phase 6 · Ship on Cloudflare (63-73)
  "edge-deployment",
  "cost-optimization",
  "scaling-load-balancing",
  "llm-serving",
  "production-patterns",
  "ci-cd-ai",
  "search-recommendations",
  "conversational-ai",
  "vision-language-models",
  "audio-speech-ai",
  "ai-for-code",
  // Appendix · Fine-tuning & Training (74-79) — beyond the edge
  "fine-tuning-fundamentals",
  "lora-adapters",
  "rlhf-preference",
  "dataset-curation",
  "continual-learning",
  "distillation-compression",
  // Appendix · Other Clouds & Platforms (80-82)
  "gcp",
  "docker",
  "kubernetes",
  // Appendix · Engineering & Communication (83-91)
  "microservices",
  "ci-cd",
  "nodejs",
  "solid-principles",
  "acid-properties",
  "postgresql-joins",
  "foreign-keys",
  "llamaindex",
  "public-speaking",
];

export const LESSON_NUMBER: Record<string, number> = Object.fromEntries(
  LESSON_SLUGS.map((slug, i) => [slug, i + 1]),
);

export const CATEGORIES: [number, number, string][] = [
  // Phases 0-6 form the continuous-play roadmap spine
  [1, 2, "Phase 0 · The AI Engineer on the Edge"],
  [3, 9, "Phase 1 · Models & Inference on Workers AI"],
  [10, 18, "Phase 2 · Prompting & Structured Output"],
  [19, 27, "Phase 3 · Embeddings & RAG on Vectorize"],
  [28, 44, "Phase 4 · Agents, Memory & Orchestration"],
  [45, 62, "Phase 5 · Evals, Safety & Observability"],
  [63, 73, "Phase 6 · Ship on Cloudflare"],
  // Appendix · Beyond the Edge — reachable, excluded from the flow spine
  [74, 79, "Appendix · Fine-tuning & Training"],
  [80, 82, "Appendix · Other Clouds & Platforms"],
  [83, 91, "Appendix · Engineering & Communication"],
];

// The cut-off lesson number for the continuous-play spine. Lessons numbered
// above this belong to the Appendix and are excluded from getFlowOrder().
export const FLOW_MAX_NUMBER = 73;

export const CATEGORY_META: Record<string, CategoryMeta> = {
  "Phase 0 · The AI Engineer on the Edge": {
    slug: "phase-0-orientation",
    icon: "🧭",
    description: "What an AI engineer ships — and why the Cloudflare Workers runtime is the substrate for the whole roadmap",
    gradient: ["var(--orange-9)", "var(--amber-11)"],
    outcomes: ["Understand the AI-engineer role on the edge", "Map the Workers/Workers AI/Vectorize/D1 stack", "Orient yourself in the roadmap spine"],
  },
  "Phase 1 · Models & Inference on Workers AI": {
    slug: "phase-1-models",
    icon: "🧠",
    description: "Pre-trained models and how inference actually runs — served from the edge via the Workers AI binding",
    gradient: ["var(--violet-9)", "var(--violet-11)"],
    outcomes: ["Use the Workers AI model catalog and bindings", "Understand transformers, tokenization & scaling laws", "Reason about edge inference cost and latency"],
  },
  "Phase 2 · Prompting & Structured Output": {
    slug: "phase-2-prompting",
    icon: "💬",
    description: "Talk to Workers AI models reliably — prompts, tool/function calling, and JSON-shaped output",
    gradient: ["var(--blue-9)", "var(--blue-11)"],
    outcomes: ["Write system prompts and few-shot examples", "Drive function/tool calling from a Worker", "Enforce structured output and defend against injection"],
  },
  "Phase 3 · Embeddings & RAG on Vectorize": {
    slug: "phase-3-rag",
    icon: "🔍",
    description: "Connect models to your data with langchain-cloudflare embeddings and the Vectorize vector store",
    gradient: ["var(--cyan-9)", "var(--cyan-11)"],
    outcomes: ["Embed and index with CloudflareWorkersAIEmbeddings", "Build RAG on Vectorize + D1 metadata", "Choose chunking/retrieval strategies and evaluate them"],
  },
  "Phase 4 · Agents, Memory & Orchestration": {
    slug: "phase-4-agents",
    icon: "🤖",
    description: "Agents that reason and act — LangGraph checkpointed on D1, long-term memory on Vectorize, durable on Workers",
    gradient: ["var(--amber-9)", "var(--amber-11)"],
    outcomes: ["Checkpoint LangGraph with langgraph-checkpoint-cloudflare-d1", "Give agents memory via langmem-cloudflare-vectorize", "Orchestrate with Durable Objects, Queues & Workflows"],
  },
  "Phase 5 · Evals, Safety & Observability": {
    slug: "phase-5-evals",
    icon: "🛡",
    description: "Measure what matters and ship safely — evals, red-teaming, guardrails, and AI Gateway observability",
    gradient: ["var(--crimson-9)", "var(--crimson-11)"],
    outcomes: ["Design benchmarks and LLM-as-judge evals", "Add guardrails and mitigate hallucination/bias", "Observe and cap traffic through AI Gateway"],
  },
  "Phase 6 · Ship on Cloudflare": {
    slug: "phase-6-ship",
    icon: "🚀",
    description: "Take it to production on the edge — deploy, scale, cost-control, CI/CD, and applied multimodal patterns",
    gradient: ["var(--jade-9)", "var(--jade-11)"],
    outcomes: ["Deploy and scale on Workers with Wrangler", "Control inference cost and observability", "Apply production, search and multimodal patterns"],
  },
  "Appendix · Fine-tuning & Training": {
    slug: "appendix-fine-tuning",
    icon: "🔧",
    description: "Beyond the edge — customizing models with LoRA, RLHF and dataset curation (off the continuous-play spine)",
    gradient: ["var(--slate-9)", "var(--slate-11)"],
    outcomes: ["Fine-tune with LoRA/QLoRA adapters", "Curate high-quality training datasets", "Apply RLHF and preference optimization"],
  },
  "Appendix · Other Clouds & Platforms": {
    slug: "appendix-clouds",
    icon: "☁",
    description: "Beyond the edge — GCP, containers and Kubernetes for comparison and context",
    gradient: ["var(--sky-9)", "var(--sky-11)"],
    outcomes: ["Work with Google Cloud Platform", "Containerize with Docker", "Orchestrate with Kubernetes"],
  },
  "Appendix · Engineering & Communication": {
    slug: "appendix-engineering",
    icon: "🏗",
    description: "Beyond the edge — timeless engineering principles, LlamaIndex, and communication skills",
    gradient: ["var(--slate-9)", "var(--slate-11)"],
    outcomes: ["Apply SOLID and ACID guarantees", "Design microservices and CI/CD", "Communicate with structure and presence"],
  },
};

export function getCategoryMeta(category: string): CategoryMeta {
  return CATEGORY_META[category] ?? {
    slug: "other",
    icon: "📄",
    description: "",
    gradient: ["var(--indigo-9)", "var(--indigo-11)"],
  };
}

function getCategory(num: number): string {
  for (const [lo, hi, name] of CATEGORIES) {
    if (num >= lo && num <= hi) return name;
  }
  return "Other";
}

export function resolveContentFile(slug: string): string | null {
  const filePath = path.join(CONTENT_DIR, `${slug}.md`);
  return fs.existsSync(filePath) ? filePath : null;
}

function extractTitle(content: string): string {
  for (const line of content.split("\n")) {
    const match = line.match(/^#\s+(.+)/);
    if (match) return match[1].trim();
  }
  return "Untitled";
}

function extractExcerpt(content: string, maxLen = 120): string {
  const lines = content.split("\n");
  let pastTitle = false;
  for (const line of lines) {
    if (!pastTitle) {
      if (line.match(/^#\s+/)) pastTitle = true;
      continue;
    }
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("```") || trimmed.startsWith("|") || trimmed.startsWith("-")) continue;
    // Strip markdown bold/italic/links
    const plain = trimmed
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/\*(.+?)\*/g, "$1")
      .replace(/\[(.+?)\]\(.+?\)/g, "$1")
      .replace(/`(.+?)`/g, "$1");
    if (plain.length < 30) continue;
    return plain.length > maxLen ? plain.slice(0, maxLen - 1).replace(/\s\S*$/, "") + "..." : plain;
  }
  return "";
}

// AWS deep-dive lessons were removed from the roadmap; kept as an empty
// export so existing imports (lib/data.ts, app/[slug]) keep compiling.
export const AWS_DEEP_DIVE_SLUGS = new Set<string>([]);

// Slugs that live in the Appendix ("Beyond the Edge") — reachable as normal
// chapters but excluded from the continuous-play roadmap spine. Derived from
// LESSON_NUMBER so it stays in sync with the ordered manifest above.
export const APPENDIX_SLUGS = new Set(
  LESSON_SLUGS.filter((s) => (LESSON_NUMBER[s] ?? 0) > FLOW_MAX_NUMBER),
);

export function isAppendixSlug(slug: string): boolean {
  return APPENDIX_SLUGS.has(slug);
}

// The audiobook spine: phases 0-6 in order, Appendix excluded. This is the
// sequence the persistent player auto-advances through.
export function getFlowOrder(): Lesson[] {
  return getAllLessons().filter((l) => !APPENDIX_SLUGS.has(l.slug));
}

export function getUrlPath(slug: string): string {
  if (AWS_DEEP_DIVE_SLUGS.has(slug)) {
    const sub = slug.startsWith("aws-") ? slug.slice(4) : slug;
    return `/aws/${sub}`;
  }
  return `/${slug}`;
}

function getDifficulty(number: number): DifficultyLevel {
  const cat = CATEGORIES.find(([lo, hi]) => number >= lo && number <= hi);
  if (!cat) return "intermediate";
  const [lo, hi] = cat;
  const range = hi - lo;
  const pos = (number - lo) / (range || 1);
  if (pos <= 0.4) return "beginner";
  if (pos <= 0.7) return "intermediate";
  return "advanced";
}

let _lessons: Lesson[] | null = null;

export function getAllLessons(): Lesson[] {
  if (_lessons) return _lessons;
  const files = fs.readdirSync(CONTENT_DIR).filter((f) => f.endsWith(".md"));

  _lessons = files
    .filter((file) => file.replace(/\.md$/, "") in LESSON_NUMBER)
    .map((file) => {
      const slug = file.replace(/\.md$/, "");
      const number = LESSON_NUMBER[slug] ?? 0;
      const raw = fs.readFileSync(path.join(CONTENT_DIR, file), "utf-8");
      const title = extractTitle(raw);
      const category = getCategory(number);
      const wordCount = raw.split(/\s+/).filter(Boolean).length;
      const readingTimeMin = Math.max(1, Math.round(wordCount / 200));
      const excerpt = extractExcerpt(raw);
      const difficulty = getDifficulty(number);
      return { slug, fileSlug: slug, number, title, category, excerpt, difficulty, wordCount, readingTimeMin, url: getUrlPath(slug) };
    })
    .sort((a, b) => a.number - b.number);
  return _lessons;
}

export function getLessonBySlug(slug: string): LessonWithContent | null {
  const file = resolveContentFile(slug);
  if (!file) return null;
  const raw = fs.readFileSync(file, "utf-8");
  const number = LESSON_NUMBER[slug] ?? 0;
  const title = extractTitle(raw);
  const category = getCategory(number);
  const wordCount = raw.split(/\s+/).filter(Boolean).length;
  const readingTimeMin = Math.max(1, Math.round(wordCount / 200));
  const excerpt = extractExcerpt(raw);
  const difficulty = getDifficulty(number);
  return { slug, fileSlug: slug, number, title, category, excerpt, difficulty, wordCount, readingTimeMin, url: getUrlPath(slug), content: raw };
}

export function getTotalWordCount(): number {
  const files = fs.readdirSync(CONTENT_DIR).filter((f) => f.endsWith(".md"));
  let total = 0;
  for (const file of files) {
    const raw = fs.readFileSync(path.join(CONTENT_DIR, file), "utf-8");
    total += raw.split(/\s+/).filter(Boolean).length;
  }
  return total;
}

export function getGroupedLessons(): GroupedLessons[] {
  const lessons = getAllLessons();
  const groups = new Map<string, Lesson[]>();

  for (const a of lessons) {
    const list = groups.get(a.category) || [];
    list.push(a);
    groups.set(a.category, list);
  }

  // Return in category order (based on CATEGORIES array)
  const ordered: GroupedLessons[] = [];
  for (const [, , name] of CATEGORIES) {
    const list = groups.get(name);
    if (list && list.length > 0) {
      ordered.push({ category: name, meta: getCategoryMeta(name), articles: list });
    }
  }
  return ordered;
}
