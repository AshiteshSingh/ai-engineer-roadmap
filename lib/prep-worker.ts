/**
 * Server-only client for the prep-worker Cloudflare service
 * (services/prep-worker — LangGraph + Workers AI + D1, on-demand + cached).
 *
 * The Vercel app keeps ALL BetterAuth owner-gating; this client only ever runs
 * server-side in app/api/applications/[id]/route.ts. Owner prep is requested
 * exclusively when the route already verified `isOwner(session)`, and is
 * authenticated to the worker with a shared secret (X-Prep-Secret) so the
 * owner endpoint is unreachable without it.
 *
 * Every call is best-effort: on missing config / timeout / non-200 it returns
 * null so the caller transparently falls back to the committed
 * data/app-prep/<slug>.json seed (route never 500s on worker trouble).
 *
 * Env (Next runtime — Vercel Production + .env.local):
 *   PREP_WORKER_URL     e.g. https://prep-worker.eeeew.workers.dev
 *   PREP_SHARED_SECRET  raw secret; worker stores only its sha256
 */

const TIMEOUT_MS = 12_000;

export interface WorkerPublicPrep {
  jobDescription: string | null;
  interviewQuestions: string | null;
  techStack: string | null; // JSON string (parity with PrepArtifact)
}

interface PrepInput {
  company?: string | null;
  position?: string | null;
  jobDescription?: string | null;
}

function base(): string | null {
  return (process.env.PREP_WORKER_URL || "").replace(/\/$/, "") || null;
}

async function post(
  path: string,
  body: unknown,
  extraHeaders?: Record<string, string>,
): Promise<Record<string, unknown> | null> {
  const root = base();
  if (!root) return null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(`${root}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...extraHeaders },
      body: JSON.stringify(body ?? {}),
      signal: ctrl.signal,
      cache: "no-store",
    });
    if (!r.ok) return null;
    return (await r.json()) as Record<string, unknown>;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** Public prep for a slug (worker generates on-demand, caches in D1). */
export async function fetchWorkerPrep(
  slug: string,
  input: PrepInput,
): Promise<WorkerPublicPrep | null> {
  const d = await post(`/prep/${slug}`, {
    company: input.company ?? "",
    position: input.position ?? "",
    jd: input.jobDescription ?? "",
  });
  if (!d) return null;
  return {
    jobDescription: (d.jobDescription as string) ?? null,
    interviewQuestions: (d.interviewQuestions as string) ?? null,
    techStack: (d.techStack as string) ?? null,
  };
}

/** Owner-only prep. Caller MUST have verified isOwner(session) first. */
export async function fetchWorkerOwnerPrep(
  slug: string,
  input: PrepInput & { evidence: string },
): Promise<string | null> {
  const secret = process.env.PREP_SHARED_SECRET || "";
  if (!secret || !input.evidence?.trim()) return null;
  const d = await post(
    `/prep/${slug}/owner`,
    {
      company: input.company ?? "",
      position: input.position ?? "",
      jd: input.jobDescription ?? "",
      evidence: input.evidence,
    },
    { "X-Prep-Secret": secret },
  );
  const v = d?.ownerPrep;
  return typeof v === "string" && v.trim() ? v : null;
}
