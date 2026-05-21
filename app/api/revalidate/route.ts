/**
 * On-demand cache revalidation, triggered by the offline publish pipeline
 * (the Rust `sync-d1` bin) so freshly published content shows on the live site
 * in seconds instead of waiting out the `revalidate: 3600` TTL on the R2 fetch.
 *
 * Auth: `Authorization: Bearer <WORKER_AUTH_SECRET>` (same shared secret the
 * other worker→app calls use). Body: { tags?: string[] } — e.g. ["audio:typeform"].
 */
import { revalidateTag } from "next/cache";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const secret = req.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!process.env.WORKER_AUTH_SECRET || secret !== process.env.WORKER_AUTH_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { tags?: unknown };
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const tags = Array.isArray(body.tags) ? (body.tags as string[]) : [];

  // Next 16: route handlers pass the "max" cache-life profile (updateTag's
  // immediate-expiry form is Server-Action-only).
  for (const t of tags) revalidateTag(t, "max");

  return NextResponse.json({ revalidated: { tags }, now: Date.now() });
}
