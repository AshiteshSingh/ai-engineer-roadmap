// Single source of truth for the sole owner of the Applications & Coursework
// sections. Kept free of server-only imports so it is safe to import from
// client components (e.g. the topbar).
export const OWNER_EMAIL = "nicolai.vadim@gmail.com";

export function isOwner(
  session: { user?: { email?: string | null } } | null | undefined,
): boolean {
  return session?.user?.email?.toLowerCase() === OWNER_EMAIL;
}
