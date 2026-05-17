import type { Metadata } from "next";

/**
 * Registry of roadmap phases that have a dedicated hub page, mapping the
 * category slug to its route. A phase gets a dedicated page the moment it
 * has BOTH a route file under app/ AND an entry here — its homepage card
 * then auto-links to the route instead of opening the category modal
 * (see CategoryModalTrigger in components/category-modal.tsx).
 */
export const PHASE_HUB_ROUTES: Record<string, string> = {
  "phase-3-rag": "/rag",
  "phase-5-evals": "/evals",
};

/**
 * Per-slug metadata overrides. Used to preserve bespoke SEO copy for pages
 * that shipped with hand-written titles/descriptions (e.g. /evals) so the
 * generic, data-derived default below does not regress them.
 */
const METADATA_OVERRIDES: Record<string, Metadata> = {
  "phase-5-evals": {
    title: "Evals, Safety & Observability — AI Engineering",
    description:
      "Measure what matters and ship safely: evaluation fundamentals, LLM-as-judge, benchmarks, red-teaming, guardrails, online evaluation and observability.",
  },
};

/**
 * Build <head> metadata for a phase hub route. Returns the per-slug override
 * when one exists; otherwise derives `{ title, description }` from the
 * phase's category name + description in the content data.
 */
export async function phaseHubMetadata(slug: string): Promise<Metadata> {
  const override = METADATA_OVERRIDES[slug];
  if (override) return override;

  const { getGroupedLessons } = await import("@/lib/data");
  const groups = await getGroupedLessons();
  const group = groups.find((g) => g.meta.slug === slug);
  if (!group) return {};

  return {
    title: `${group.category} — AI Engineering`,
    description: group.meta.description,
  };
}
