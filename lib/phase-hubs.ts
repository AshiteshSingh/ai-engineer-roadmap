// Client-safe: PURE CONSTANTS ONLY. This module is imported by the client
// CategoryModalTrigger, so it must NOT import anything that reaches
// lib/data / server-only modules (fs, etc.). The data-deriving metadata
// helper lives in lib/phase-hub-metadata.ts (server-only).

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

export interface PhaseHubMeta {
  title: string;
  description: string;
}

/**
 * Per-slug metadata overrides. Preserves bespoke SEO copy for pages that
 * shipped with hand-written titles/descriptions (e.g. /evals) so the
 * generic, data-derived default does not regress them.
 */
export const PHASE_HUB_METADATA_OVERRIDES: Record<string, PhaseHubMeta> = {
  "phase-5-evals": {
    title: "Evals, Safety & Observability — AI Engineering",
    description:
      "Measure what matters and ship safely: evaluation fundamentals, LLM-as-judge, benchmarks, red-teaming, guardrails, online evaluation and observability.",
  },
};
