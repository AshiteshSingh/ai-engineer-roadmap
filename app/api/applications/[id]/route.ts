import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isOwner, stripOwnerOnlyMarkdownLines } from "@/lib/owner";
import { db } from "@/src/db";
import { applications } from "@/src/db/schema";
import { eq, and, or } from "drizzle-orm";
import { getAppPrepSeed, getOwnerPrepSeed } from "@/lib/app-prep-seed";
import { fetchWorkerPrep } from "@/lib/prep-worker";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function whereApp(id: string, userId: string) {
  const col = UUID_RE.test(id) ? applications.id : applications.slug;
  return and(eq(col, id), eq(applications.userId, userId));
}

async function getSession() {
  return auth.api.getSession({ headers: await headers() });
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const [session, { id }] = await Promise.all([getSession(), params]);
  const owner = !!session && isOwner(session);

  // Owner-only tailored prep (data/app-prep/<slug>.owner.json). Resolved ONLY
  // for the owner and stamped onto every returned payload; null for every
  // non-owner response so the field never leaks. Same server-side gate as
  // conceal()/stripOwnerOnlyMarkdownLines — no new auth surface.
  const ownerPrep = owner ? getOwnerPrepSeed(id)?.ownerPrep ?? null : null;
  const attach = <T extends object>(o: T): T & { ownerPrep: string | null } => ({
    ...o,
    ownerPrep,
  });

  // Committed Rust prep artifact (gen-app-prep → data/app-prep/<slug>.json) is
  // the source of truth for seeded slugs: overlaid onto a DB row that has no
  // generated prep yet, and used standalone when no row exists. A real
  // generated value in the DB still wins (the `||` short-circuits).
  // Prep source: the prep-worker (services/prep-worker — LangGraph + Workers
  // AI + D1, on-demand + cached) generates the public prep. The committed
  // data/app-prep/<slug>.json remains the fallback (and supplies
  // company/position/JD to seed the worker). Worker output, when available,
  // overlays the seed's interviewQuestions/techStack/jobDescription so the
  // rest of the merge/conceal/gating logic below is byte-for-byte unchanged.
  // Owner prep stays on getOwnerPrepSeed (committed, regen-proof) — the
  // worker's owner endpoint is built+verified but wiring it needs a
  // slug→evidence registry (separate follow-up); gating is unaffected.
  const baseSeed = getAppPrepSeed(id);
  let seed = baseSeed;
  if (baseSeed) {
    const w = await fetchWorkerPrep(id, {
      company: baseSeed.company,
      position: baseSeed.position,
      jobDescription: baseSeed.jobDescription,
    });
    if (w && w.interviewQuestions) {
      seed = {
        ...baseSeed,
        jobDescription: w.jobDescription ?? baseSeed.jobDescription,
        interviewQuestions: w.interviewQuestions,
        techStack: w.techStack ?? baseSeed.techStack,
      };
    }
  }
  const withSeedPrep = <
    T extends { interviewQuestions: string | null; techStack: string | null },
  >(
    row: T,
  ): T =>
    seed
      ? {
          ...row,
          interviewQuestions:
            row.interviewQuestions || seed.interviewQuestions,
          techStack: row.techStack || seed.techStack,
        }
      : row;

  // Concealment: non-owners must not even see links to owner-only routes
  // (e.g. /module-federation) in publicly-served prep markdown. The owner
  // branch below returns full content untouched.
  const conceal = <T extends { interviewQuestions: string | null }>(
    row: T,
  ): T =>
    owner
      ? row
      : {
          ...row,
          interviewQuestions: stripOwnerOnlyMarkdownLines(
            row.interviewQuestions,
          ),
        };

  if (owner) {
    const [row] = await db
      .select()
      .from(applications)
      .where(whereApp(id, session.user.id));
    if (row) return NextResponse.json(attach(withSeedPrep(row)));
  }

  // Allow public access for apps marked as public
  const col = UUID_RE.test(id) ? applications.id : applications.slug;
  const [publicRow] = await db
    .select()
    .from(applications)
    .where(and(eq(col, id), eq(applications.public, true)));

  if (publicRow) return NextResponse.json(attach(conceal(withSeedPrep(publicRow))));

  if (seed) return NextResponse.json(attach(conceal(seed)));

  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const [session, { id }] = await Promise.all([getSession(), params]);
  if (!session || !isOwner(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await req.json();
  const { company, position, url, status, slug, notes, appliedAt, jobDescription, interviewQuestions, techStack, interviewers, techDismissedTags, audioUrl } = body;

  const [row] = await db
    .update(applications)
    .set({
      ...(company !== undefined && { company }),
      ...(position !== undefined && { position }),
      ...(url !== undefined && { url }),
      ...(status !== undefined && { status }),
      ...(slug !== undefined && { slug }),
      ...(notes !== undefined && { notes }),
      ...(jobDescription !== undefined && { jobDescription }),
      ...(interviewQuestions !== undefined && { interviewQuestions }),
      ...(techStack !== undefined && { techStack }),
      ...(interviewers !== undefined && { interviewers }),
      ...(techDismissedTags !== undefined && { techDismissedTags }),
      ...(audioUrl !== undefined && { audioUrl }),
      ...(appliedAt !== undefined && { appliedAt: appliedAt ? new Date(appliedAt) : null }),
      updatedAt: new Date(),
    })
    .where(whereApp(id, session.user.id))
    .returning();

  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(row);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const [session, { id }] = await Promise.all([getSession(), params]);
  if (!session || !isOwner(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const [row] = await db
    .delete(applications)
    .where(whereApp(id, session.user.id))
    .returning();

  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
