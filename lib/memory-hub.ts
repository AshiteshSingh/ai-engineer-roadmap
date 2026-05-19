/**
 * Single source of truth for the curated "Memory" hub.
 *
 * Memory is a cross-phase theme (no Rust taxonomy category), so both the
 * dedicated /memory route (app/memory/page.tsx) AND the synthetic homepage
 * "Memory" phase card derive from these constants — keeping the card and the
 * hub from drifting. Pure module (types + consts + a pure helper over an
 * already-loaded lesson list); safe to import server- or client-side.
 */
import type { CategoryMeta, Lesson, GroupedLessons } from "./data";

/** Card slug — registered in PHASE_HUB_ROUTES so the homepage card deep-links. */
export const MEMORY_HUB_SLUG = "memory";

/** Display title for the card / hero. */
export const MEMORY_HUB_CATEGORY = "Long-Term Memory";

/**
 * Curated, roadmap-ordered slug set. Cross-phase (Phase 4 agents/context +
 * Phase 5 LangChain memory). Unknown slugs are silently dropped by
 * `getMemoryArticles`, so this never produces dead cards.
 */
export const MEMORY_SLUGS = [
  "agent-memory",
  "memory",
  "memory-architectures",
  "context-engineering",
  "context-window-management",
  "dynamic-context-assembly",
  "context-compression",
  "langmem-vectorize-memory",
] as const;

export const MEMORY_HUB_META: CategoryMeta = {
  slug: MEMORY_HUB_SLUG,
  icon: "🧠",
  description:
    "Give agents durable recall — semantic, episodic and procedural memory, context-window engineering, and long-term memory stores that survive across sessions.",
  gradient: ["var(--amber-9)", "var(--amber-11)"],
  outcomes: [
    "Distinguish semantic vs episodic vs procedural memory and when each applies",
    "Engineer the context window: compression, dynamic assembly, windowing",
    "Persist long-term memory with vector + metadata stores (e.g. LangMem)",
  ],
};

/** Memory lessons filtered out of `all` and put in curated order. */
export function getMemoryArticles(all: Lesson[]): Lesson[] {
  const order = new Map<string, number>(MEMORY_SLUGS.map((s, i) => [s, i]));
  return all
    .filter((l) => order.has(l.slug))
    .sort((a, b) => order.get(a.slug)! - order.get(b.slug)!);
}

/**
 * Synthetic `GroupedLessons` for the homepage grid. Returns null when no
 * memory lessons resolve (so the card is simply omitted rather than empty).
 * NOTE: these `articles` are the SAME lesson objects that already appear in
 * their real Phase 4/5 groups — callers computing corpus totals must derive
 * those from the real groups, not from a list that includes this one, to
 * avoid double-counting.
 */
export function memoryGroup(all: Lesson[]): GroupedLessons | null {
  const articles = getMemoryArticles(all);
  if (articles.length === 0) return null;
  return { category: MEMORY_HUB_CATEGORY, meta: MEMORY_HUB_META, articles };
}
