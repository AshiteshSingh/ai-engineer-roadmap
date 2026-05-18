// Client-safe: PURE CONSTANTS ONLY. Static, curated external "further
// reading" links rendered by <ReferencesSection>. These are page chrome,
// NOT lesson content — they deliberately bypass the Rust→SQLite→JSON
// content pipeline. Mirrors the keyed-map style of lib/phase-hubs.ts.
//
// Why static & committed (not runtime-scraped): some publishers (Cloudflare,
// IBM) 403 automated fetchers, so runtime scraping would be unreliable; and
// we intentionally surface only title + source + a one-line summary + an
// outbound link, never republished body text. Update a reference by editing
// this file.

export interface PhaseReference {
  /** Link text — the page/article title. */
  title: string;
  /** Absolute external URL (opens in a new tab). */
  url: string;
  /** Publisher label, e.g. "Cloudflare", "OpenAI". */
  source: string;
  /** One-line summary of what the reference covers. */
  description: string;
}

// Single source of truth — referenced by BOTH lookups below.
const EMBEDDINGS_REFERENCES: PhaseReference[] = [
  {
    title: "What are embeddings?",
    url: "https://www.cloudflare.com/learning/ai/what-are-embeddings/",
    source: "Cloudflare",
    description:
      "Plain-English primer: how embeddings turn text into vectors that capture semantic meaning.",
  },
  {
    title: "Embeddings",
    url: "https://ai-sdk.dev/docs/ai-sdk-core/embeddings",
    source: "AI SDK (Vercel)",
    description:
      "Generate embeddings with embed / embedMany and compare them via cosine similarity in TypeScript.",
  },
  {
    title: "Vector embeddings",
    url: "https://developers.openai.com/api/docs/guides/embeddings",
    source: "OpenAI",
    description:
      "Use embeddings for semantic search, clustering, recommendations, and classification.",
  },
  {
    title: "Embeddings",
    url: "https://developers.google.com/machine-learning/crash-course/embeddings",
    source: "Google ML Crash Course",
    description:
      "Why lower-dimensional learned representations beat sparse one-hot encodings.",
  },
  {
    title: "What is embedding?",
    url: "https://www.ibm.com/think/topics/embedding",
    source: "IBM",
    description:
      "Conceptual overview of embeddings and their role across modern ML workloads.",
  },
  {
    title: "Embeddings",
    url: "https://ai.google.dev/gemini-api/docs/embeddings",
    source: "Google Gemini API",
    description:
      "Generate text and multimodal embeddings through the Gemini API.",
  },
];

/**
 * Keyed by CATEGORY slug — consumed by the /rag phase hub. A phase renders a
 * references section the moment it has an entry here; phases without one
 * (e.g. phase-5-evals) stay byte-identical.
 */
export const PHASE_HUB_REFERENCES: Record<string, PhaseReference[]> = {
  "phase-3-rag": EMBEDDINGS_REFERENCES,
};

/**
 * Keyed by LESSON slug — consumed by the lesson page. Precise on purpose:
 * only the Embeddings lesson shows these, not every phase-3-rag lesson.
 */
export const LESSON_REFERENCES: Record<string, PhaseReference[]> = {
  embeddings: EMBEDDINGS_REFERENCES,
};
