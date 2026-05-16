/**
 * Client-safe article metadata and matching engine.
 *
 * lib/articles.ts imports `fs` at the top level, so it cannot be used in
 * "use client" components. This module duplicates the pure data (slugs,
 * categories, icons) and provides a keyword-based matcher to connect
 * study plan headings → knowledge-base articles.
 *
 * Source of truth: lib/articles.ts (LESSON_SLUGS, CATEGORIES, CATEGORY_META)
 */

/* ── Types ──────────────────────────────────────────────────────── */

export interface LessonStub {
  slug: string;
  title: string;
  category: string;
  icon: string;
  url: string;
  number: number;
}

/* ── Raw data (mirrors lib/articles.ts) ─────────────────────────── */

const LESSON_SLUGS = [
  "transformer-architecture", "scaling-laws", "tokenization",
  "model-architectures", "inference-optimization", "pretraining-data", "embeddings",
  "prompt-engineering-fundamentals", "few-shot-chain-of-thought", "system-prompts",
  "structured-output", "prompt-optimization", "adversarial-prompting",
  "rag", "embedding-models", "vector-databases", "chunking-strategies",
  "retrieval-strategies", "advanced-rag", "rag-evaluation",
  "fine-tuning-fundamentals", "lora-adapters", "rlhf-preference",
  "dataset-curation", "continual-learning", "distillation-compression",
  "memory", "context-engineering", "context-window-management", "memory-architectures",
  "prompt-caching", "dynamic-context-assembly", "context-compression",
  "tool-use", "function-calling", "agent-architectures", "multi-agent-systems",
  "agent-memory", "code-agents", "agent-evaluation",
  "agent-harnesses", "agent-orchestration", "agent-sdks", "agent-debugging",
  "eval-fundamentals", "benchmark-design", "llm-as-judge",
  "human-evaluation", "red-teaming", "eval-frameworks-comparison", "deepeval-synthesizer",
  "online-evaluation",
  "llm-serving", "scaling-load-balancing", "cost-optimization",
  "observability", "edge-deployment", "ai-gateway",
  "constitutional-ai", "guardrails-filtering", "hallucination-mitigation",
  "bias-fairness", "ai-governance", "interpretability", "ci-cd-ai",
  "vision-language-models", "audio-speech-ai", "ai-for-code", "conversational-ai",
  "search-recommendations", "production-patterns", "langgraph",
  "langgraph-red-teaming", "llamaindex", "ai-engineer-roadmap",
  "gcp", "docker", "kubernetes",
  "microservices", "ci-cd", "nodejs", "solid-principles", "acid-properties",
];

const CATEGORIES: [number, number, string, string][] = [
  [1, 7, "Foundations & Architecture", "🧱"],
  [8, 13, "Prompting & In-Context Learning", "💡"],
  [14, 20, "RAG & Retrieval", "🔍"],
  [21, 26, "Fine-tuning & Training", "🔧"],
  [27, 33, "Context Engineering", "🧩"],
  [34, 44, "Agents & Harnesses", "🤖"],
  [45, 52, "Evals & Testing", "📊"],
  [53, 58, "Infrastructure & Deployment", "⚡"],
  [59, 65, "Safety & Alignment", "🛡"],
  [66, 69, "Multimodal AI", "👁"],
  [70, 75, "Applied AI & Production", "🚀"],
  [76, 78, "Cloud Platforms", "☁"],
  [79, 83, "Software Engineering", "🏗"],
];

const AWS_DEEP_DIVE_SLUGS = new Set<string>([]);

/** Slug-derived titles are sometimes poor — override those here */
const TITLE_OVERRIDES: Record<string, string> = {
  "rlhf-preference": "RLHF & Preference Optimization",
  "ci-cd-ai": "CI/CD for AI Systems",
  "ci-cd": "CI/CD Pipelines",
  "few-shot-chain-of-thought": "Few-Shot & Chain-of-Thought",
  "llm-as-judge": "LLM-as-Judge Evaluation",
  "online-evaluation": "Online & Production Evaluation",
  "llm-serving": "LLM Serving & Inference",
  "ai-for-code": "AI for Code Generation",
  "ai-gateway": "AI Gateway & Routing",
  "ai-engineer-roadmap": "AI Engineer Roadmap",
  "ai-governance": "AI Governance & Policy",
  "deepeval-synthesizer": "DeepEval Synthesizer",
  "lora-adapters": "LoRA & QLoRA Adapters",
  "solid-principles": "SOLID Principles",
  "acid-properties": "ACID Properties",
  "nodejs": "Node.js",
  "gcp": "Google Cloud Platform",
  "langgraph-red-teaming": "LangGraph Red Teaming",
};

/* ── Build stubs ────────────────────────────────────────────────── */

function getUrl(slug: string): string {
  if (AWS_DEEP_DIVE_SLUGS.has(slug)) {
    const sub = slug.startsWith("aws-") ? slug.slice(4) : slug;
    return `/aws/${sub}`;
  }
  return `/${slug}`;
}

function humanize(slug: string): string {
  if (TITLE_OVERRIDES[slug]) return TITLE_OVERRIDES[slug];
  return slug
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\bAi\b/g, "AI")
    .replace(/\bRag\b/g, "RAG")
    .replace(/\bLlm\b/g, "LLM")
    .replace(/\bSdk(s?)\b/g, "SDK$1")
    .replace(/\bApi\b/g, "API")
    .replace(/\bCi\b/g, "CI")
    .replace(/\bCd\b/g, "CD")
    .replace(/\bIam\b/g, "IAM")
    .replace(/\bS3\b/gi, "S3")
    .replace(/\bAws\b/g, "AWS")
    .replace(/\bMl\b/g, "ML");
}

function getCategoryInfo(num: number): { name: string; icon: string } {
  for (const [lo, hi, name, icon] of CATEGORIES) {
    if (num >= lo && num <= hi) return { name, icon };
  }
  return { name: "Other", icon: "📄" };
}

export const ARTICLE_STUBS: LessonStub[] = LESSON_SLUGS.map((slug, i) => {
  const number = i + 1;
  const { name, icon } = getCategoryInfo(number);
  return { slug, title: humanize(slug), category: name, icon, url: getUrl(slug), number };
});

/* ── Keyword index & matcher ────────────────────────────────────── */

/** Words that appear in headings or categories but carry no matching signal */
const STOPWORDS = new Set([
  "deep", "dive", "dives", "advanced", "introduction", "overview",
  "question", "reference", "cheat", "sheet", "quick", "live",
  "exercise", "behavioral", "leadership", "strategy", "pattern",
  "mastery", "coding", "topic",
  "and", "the", "for", "with", "from", "into", "how", "what", "why",
  "an", "to", "of", "in", "on", "is", "it", "js",
]);

/** Crude stemming: normalize common suffixes so "database"≈"databases" */
function stem(word: string): string {
  if (word.length > 5 && word.endsWith("ies")) return word.slice(0, -3) + "y";
  // Only strip "es" after sibilants (matches→match, caches→cach) not "databases"→"databas"
  if (word.length > 4 && /(?:sh|ch|ss|x|z)es$/.test(word)) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  if (word.length > 5 && word.endsWith("ing")) return word.slice(0, -3);
  return word;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .map(stem)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

/** Compound tokens: merge adjacent tokens to catch multi-word slugs like "nodejs", "nextjs" */
function compoundTokens(text: string): string[] {
  const raw = text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/);
  const compounds: string[] = [];
  for (let i = 0; i < raw.length - 1; i++) {
    compounds.push(raw[i] + raw[i + 1]); // "node" + "js" → "nodejs"
  }
  return compounds.filter((t) => t.length >= 4);
}

// Inverted index: token → set of article indices (slug tokens weighted higher)
const SLUG_INDEX = new Map<string, Set<number>>();
const TITLE_INDEX = new Map<string, Set<number>>();

function addToIndex(index: Map<string, Set<number>>, token: string, i: number) {
  let set = index.get(token);
  if (!set) { set = new Set(); index.set(token, set); }
  set.add(i);
}

for (let i = 0; i < ARTICLE_STUBS.length; i++) {
  const stub = ARTICLE_STUBS[i];
  // Slug tokens get the highest weight — they're the most descriptive
  const slugTokens = tokenize(stub.slug.replace(/-/g, " "));
  for (const t of slugTokens) addToIndex(SLUG_INDEX, t, i);
  // Also index the full slug as a compound (e.g., "nodejs", "langgraph")
  const rawSlug = stub.slug.replace(/-/g, "");
  if (rawSlug.length >= 4) addToIndex(SLUG_INDEX, rawSlug, i);

  // Title tokens get lower weight
  for (const t of tokenize(stub.title)) addToIndex(TITLE_INDEX, t, i);
}

export function matchArticles(
  heading: string,
  techTags?: string[],
  maxResults = 4,
): LessonStub[] {
  const headingTokens = tokenize(heading);
  const compounds = compoundTokens(heading);
  const scores = new Float32Array(ARTICLE_STUBS.length);

  // Exact slug-word match → strong signal
  for (const token of headingTokens) {
    const slugHits = SLUG_INDEX.get(token);
    if (slugHits) for (const idx of slugHits) scores[idx] += 4;
    const titleHits = TITLE_INDEX.get(token);
    if (titleHits) for (const idx of titleHits) scores[idx] += 2;
  }

  // Compound tokens catch "react" + "js" → "reactjs", "node" + "js" → "nodejs"
  for (const compound of compounds) {
    const slugHits = SLUG_INDEX.get(compound);
    if (slugHits) for (const idx of slugHits) scores[idx] += 5;
  }

  // Boost articles whose slug contains a tech tag from the job description
  if (techTags) {
    for (const tag of techTags) {
      const tagToken = tag.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (tagToken.length < 3) continue;
      for (let i = 0; i < ARTICLE_STUBS.length; i++) {
        if (ARTICLE_STUBS[i].slug === tagToken || ARTICLE_STUBS[i].slug.startsWith(tagToken + "-")) {
          scores[i] += 2;
        }
      }
    }
  }

  // Collect, filter, sort, return top N (threshold = 3)
  const results: { stub: LessonStub; score: number }[] = [];
  for (let i = 0; i < scores.length; i++) {
    if (scores[i] >= 3) results.push({ stub: ARTICLE_STUBS[i], score: scores[i] });
  }
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, maxResults).map((r) => r.stub);
}
