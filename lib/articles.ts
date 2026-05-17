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
// This order IS the audiobook spine: phases 1-7 play continuously; the
// Appendix is reachable but excluded from the continuous-play flow.
// `*` slugs are new Cloudflare-specific pilot chapters.
const LESSON_SLUGS = [
  // Phase 1 · Foundations & Model Inference (1-9)
  "ai-on-cloudflare-workers", // *
  "ai-engineer-roadmap",
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
  // Phase 3 · Embeddings & RAG (19-27)
  "vectorize-rag", // *
  "embeddings",
  "embedding-models",
  "vector-databases",
  "chunking-strategies",
  "retrieval-strategies",
  "rag",
  "advanced-rag",
  "rag-evaluation",
  // Phase 4 · Agents, Memory & Orchestration (28-41)
  "agent-architectures",
  "multi-agent-systems",
  "agent-memory",
  "agent-orchestration",
  "agent-harnesses",
  "agent-sdks",
  "code-agents",
  "agent-debugging",
  "memory",
  "context-engineering",
  "context-window-management",
  "memory-architectures",
  "dynamic-context-assembly",
  "context-compression",
  // Phase 5 · LangChain & LangGraph (42-51)
  "langchain-fundamentals",
  "langchain-tools-retrievers",
  "langgraph",
  "langgraph-human-in-the-loop",
  "langgraph-multi-agent",
  "langgraph-d1-checkpointing",
  "langmem-vectorize-memory",
  "langgraph-streaming-observability",
  "langgraph-deployment",
  "langgraph-red-teaming",
  // Phase 6 · Evals, Safety & Observability (52-68)
  "eval-fundamentals",
  "benchmark-design",
  "llm-as-judge",
  "human-evaluation",
  "eval-frameworks-comparison",
  "deepeval-synthesizer",
  "agent-evaluation",
  "red-teaming",
  "guardrails-filtering",
  "hallucination-mitigation",
  "constitutional-ai",
  "bias-fairness",
  "ai-governance",
  "interpretability",
  "observability",
  "online-evaluation",
  "ai-gateway",
  // Phase 7 · Ship to Production (69-79)
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
  // Appendix · Fine-tuning & Training (80-85) — optional track
  "fine-tuning-fundamentals",
  "lora-adapters",
  "rlhf-preference",
  "dataset-curation",
  "continual-learning",
  "distillation-compression",
  // Appendix · Other Clouds & Platforms (86-88)
  "gcp",
  "docker",
  "kubernetes",
  // Appendix · Engineering & Communication (89-97)
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
  // Phases 1-7 form the continuous-play roadmap spine
  [1, 9, "Phase 1 · Foundations & Model Inference"],
  [10, 18, "Phase 2 · Prompting & Structured Output"],
  [19, 27, "Phase 3 · Embeddings & RAG"],
  [28, 41, "Phase 4 · Agents, Memory & Orchestration"],
  [42, 51, "Phase 5 · LangChain & LangGraph"],
  [52, 68, "Phase 6 · Evals, Safety & Observability"],
  [69, 79, "Phase 7 · Ship to Production"],
  // Appendix · reachable, excluded from the flow spine
  [80, 85, "Appendix · Fine-tuning & Training"],
  [86, 88, "Appendix · Other Clouds & Platforms"],
  [89, 97, "Appendix · Engineering & Communication"],
];

// The cut-off lesson number for the continuous-play spine. Lessons numbered
// above this belong to the Appendix and are excluded from getFlowOrder().
export const FLOW_MAX_NUMBER = 79;

// Descriptions: parallel "outcome — concrete substrate" form, jargon-free.
// Outcomes: falsifiable "you can now build/ship X" capability statements,
// bound to the master article's Portfolio Levels where they line up.
export const CATEGORY_META: Record<string, CategoryMeta> = {
  "Phase 1 · Foundations & Model Inference": {
    slug: "phase-1-models",
    icon: "🧠",
    description: "Understand what an AI engineer ships, then run real inference on pre-trained models — and reason about their token and cost behavior",
    gradient: ["var(--violet-9)", "var(--violet-11)"],
    outcomes: [
      "Explain how the AI-engineer role differs from ML engineer and data scientist",
      "Call a hosted model and read its token and cost implications",
      "Explain tokenization, attention and scaling laws in applied terms",
      "Pick a model for a task by latency, cost and capability",
    ],
  },
  "Phase 2 · Prompting & Structured Output": {
    slug: "phase-2-prompting",
    icon: "💬",
    description: "Make model output reliable — prompts, tool/function calling, and schema-valid JSON",
    gradient: ["var(--blue-9)", "var(--blue-11)"],
    outcomes: [
      "Write system prompts and few-shot examples that hold under variation",
      "Drive function/tool calls",
      "Ship a Structured Data Extractor: text in, schema-validated JSON out (Portfolio L1)",
    ],
  },
  "Phase 3 · Embeddings & RAG": {
    slug: "phase-3-rag",
    icon: "🔍",
    description: "Ground answers in your own data — embeddings and retrieval with a vector database and a metadata store",
    gradient: ["var(--cyan-9)", "var(--cyan-11)"],
    outcomes: [
      "Embed and index a corpus with an embedding model",
      "Tune chunking and retrieval strategies, then measure them",
      "Ship a Document Q&A System with citations and a faithfulness/relevance eval (Portfolio L1)",
    ],
  },
  "Phase 4 · Agents, Memory & Orchestration": {
    slug: "phase-4-agents",
    icon: "🤖",
    description: "Build agents that reason and act — tool-use loops, multi-agent coordination, and context & memory engineering",
    gradient: ["var(--amber-9)", "var(--amber-11)"],
    outcomes: [
      "Build a tool-using agent loop with short- and long-term memory",
      "Coordinate multiple agents and engineer the context window under token limits",
      "Ship a Multi-Source Research Agent reusing Phase 2 tool calls and Phase 3 retrieval (Portfolio L2)",
    ],
  },
  "Phase 5 · LangChain & LangGraph": {
    slug: "phase-5-langchain",
    icon: "⛓",
    description: "Build production agent graphs with LangChain and LangGraph — LCEL chains, stateful graphs, D1-checkpointed memory, human-in-the-loop, and tracing",
    gradient: ["var(--teal-9)", "var(--teal-11)"],
    outcomes: [
      "Compose LangChain runnables/LCEL chains with tools and retrievers",
      "Model an app as a LangGraph StateGraph with D1 checkpointing and resume",
      "Add human-in-the-loop interrupts and stream/trace a graph end to end",
      "Ship a deployed multi-agent LangGraph service on the edge (Portfolio L2)",
    ],
  },
  "Phase 6 · Evals, Safety & Observability": {
    slug: "phase-5-evals",
    icon: "🛡",
    description: "Prove it works and ships safely — evals, red-teaming, guardrails, and gateway-level observability",
    gradient: ["var(--crimson-9)", "var(--crimson-11)"],
    outcomes: [
      "Build an eval suite (benchmarks + LLM-as-judge) that gates a model change",
      "Add guardrails and mitigate hallucination and bias",
      "Ship an eval + red-team + observability harness over your Phase 4–5 agent (Portfolio L3)",
    ],
  },
  "Phase 7 · Ship to Production": {
    slug: "phase-6-ship",
    icon: "🚀",
    description: "Take it to production — deploy, scale, cost-control, and CI/CD",
    gradient: ["var(--jade-9)", "var(--jade-11)"],
    outcomes: [
      "Deploy and scale a production service",
      "Cap inference cost and wire CI/CD-gated evals",
      "Ship a cost-bounded, observable AI feature to production (e.g. an AI Code Review Bot)",
    ],
  },
  "Appendix · Fine-tuning & Training": {
    slug: "appendix-fine-tuning",
    icon: "🔧",
    description: "Optional track — customize models with LoRA, RLHF and dataset curation when prompting is not enough",
    gradient: ["var(--slate-9)", "var(--slate-11)"],
    outcomes: [
      "Decide when fine-tuning beats prompting, with a measured comparison",
      "Fine-tune with LoRA/QLoRA on a curated dataset",
      "Ship a domain-tuned assistant wrapped in a safety stack (Portfolio L3, senior signal)",
    ],
  },
  "Appendix · Other Clouds & Platforms": {
    slug: "appendix-clouds",
    icon: "☁",
    description: "Optional track — GCP, Docker and Kubernetes for portability and comparison off the primary path",
    gradient: ["var(--sky-9)", "var(--sky-11)"],
    outcomes: [
      "Map serverless concepts onto GCP equivalents",
      "Containerize a service with Docker",
      "Run a workload on Kubernetes",
    ],
  },
  "Appendix · Engineering & Communication": {
    slug: "appendix-engineering",
    icon: "🏗",
    description: "Optional track — software-engineering foundations (SOLID, ACID, SQL, CI/CD) plus LlamaIndex and communication",
    gradient: ["var(--slate-9)", "var(--slate-11)"],
    outcomes: [
      "Apply SOLID design and ACID guarantees",
      "Reason about microservices, SQL joins and CI/CD",
      "Communicate technical work with structure and presence",
    ],
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

// The audiobook spine: phases 1-7 in order, Appendix excluded. This is the
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
