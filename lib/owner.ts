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
export const OWNER_ONLY_PATHS = ["/module-federation"] as const;

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
