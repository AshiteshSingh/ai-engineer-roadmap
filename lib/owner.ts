// Single source of truth for the sole owner of the Applications & Coursework
// sections. Kept free of server-only imports so it is safe to import from
// client components (e.g. the topbar).
export const OWNER_EMAIL = "nicolai.vadim@gmail.com";

export function isOwner(
  session: { user?: { email?: string | null } } | null | undefined,
): boolean {
  return session?.user?.email?.toLowerCase() === OWNER_EMAIL;
}

// Internal route prefixes that only the owner may see. References to these
// (e.g. the Module Federation deep-dive) are stripped from publicly-served
// markdown so non-owners don't even see the link text.
export const OWNER_ONLY_PATHS = [
  "/module-federation",
  "/cortex-portal",
] as const;

/**
 * Drop any markdown line that links to an owner-only path. Concealment for
 * non-owners in public prep content: each owner-only reference must live on
 * its own markdown line so the whole line drops cleanly (no orphaned bullet).
 */
export function stripOwnerOnlyMarkdownLines(
  md: string | null | undefined,
): string | null {
  if (!md) return md ?? null;
  const needles = OWNER_ONLY_PATHS.map((p) => `](${p})`);
  return md
    .split("\n")
    .filter((line) => !needles.some((n) => line.includes(n)))
    .join("\n");
}

// Owner-only "deep dive" topics associated with a job-application slug. These
// are rendered as a card on the prep page (owner-gated client-side) and link
// to the owner-gated /<slug> topic route. Kept OUT of the regenerated
// interviewQuestions markdown on purpose: that field is overwritten wholesale
// by gen-app-prep / gen-app-prep-loop, so the relationship lives here in code —
// regeneration can never wipe it.
export interface OwnerDeepDive {
  /** Topic route slug, e.g. "module-federation" → /module-federation. */
  slug: string;
  label: string;
  blurb: string;
}

export const OWNER_DEEP_DIVES: Record<string, OwnerDeepDive[]> = {
  "european-central-bank-ssm-cockpit-developer": [
    {
      slug: "module-federation",
      label: "Module Federation",
      blurb:
        "Micro-frontend split: host/remote wiring, shared singletons, runtime version skew",
    },
  ],
};

export function ownerDeepDives(
  appSlug: string | null | undefined,
): OwnerDeepDive[] {
  return (appSlug && OWNER_DEEP_DIVES[appSlug]) || [];
}

// Owner-only deep-dives surfaced in the LangGraph area (e.g. the lead-gen
// page). Same code-owned, regen-proof pattern as OWNER_DEEP_DIVES. Blurbs are
// deliberately generic and contain NO contact details or git statistics — the
// route + card are owner-gated, this is defense-in-depth.
export const LANGGRAPH_OWNER_DIVES: OwnerDeepDive[] = [
  {
    slug: "cortex-portal",
    label: "Vitrifi · Cortex Portal",
    blurb:
      "Regulated UK-fibre telecom ops platform — Go microservices, Temporal, GraphQL, RBAC/multi-tenancy: the production analogue behind these LangGraph patterns.",
  },
];
