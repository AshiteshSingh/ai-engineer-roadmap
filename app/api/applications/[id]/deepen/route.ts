import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isOwner } from "@/lib/owner";
import { db } from "@/src/db";
import { applications } from "@/src/db/schema";
import { eq, and } from "drizzle-orm";
import { getAppPrepSeed } from "@/lib/app-prep-seed";

// The DeepSeek call inside the Cloudflare worker is slow — give the function
// headroom. The client also polls GET (below) so a timed-out POST self-heals.
export const maxDuration = 60;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function whereApp(id: string, userId: string) {
  const col = UUID_RE.test(id) ? applications.id : applications.slug;
  return and(eq(col, id), eq(applications.userId, userId));
}

async function getSession() {
  return auth.api.getSession({ headers: await headers() });
}

/**
 * GET /api/applications/[id]/deepen
 * Lightweight poll target: lets the client detect when a deepen run has
 * landed (updatedAt advances) even if the POST request itself was aborted
 * or timed out at the edge.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const [session, { id }] = await Promise.all([getSession(), params]);
  if (!session || !isOwner(session))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const [row] = await db
    .select({
      interviewQuestions: applications.interviewQuestions,
      updatedAt: applications.updatedAt,
    })
    .from(applications)
    .where(whereApp(id, session.user.id));

  return NextResponse.json({
    ok: true,
    hasPrep: !!row?.interviewQuestions,
    updatedAt: row?.updatedAt ?? null,
  });
}

/**
 * POST /api/applications/[id]/deepen
 * Owner-only. Sends the app's JD + current prep to the Cloudflare Python
 * worker (DEEPEN_WORKER_URL), which expands it via DeepSeek, then persists
 * the deeper prep + tech to the owner's DB row (Vercel FS is read-only, so
 * the seed file can't be rewritten — the GET overlay already prefers a real
 * DB value over the static seed).
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const [session, { id }] = await Promise.all([getSession(), params]);
  if (!session || !isOwner(session))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const workerUrl = process.env.DEEPEN_WORKER_URL;
  if (!workerUrl) {
    return NextResponse.json(
      { error: "Deepen is not configured (DEEPEN_WORKER_URL unset)" },
      { status: 503 },
    );
  }

  // Current content: prefer the owner's DB row, fall back to the committed
  // seed artifact (the ECB slug ships seed-only with no row yet).
  const [row] = await db
    .select()
    .from(applications)
    .where(whereApp(id, session.user.id));

  const seed = getAppPrepSeed(id);
  const source = row ?? seed;
  if (!source)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  const jobDescription = source.jobDescription;
  if (!jobDescription)
    return NextResponse.json(
      { error: "Add a job description first" },
      { status: 400 },
    );

  let worker: { prepMarkdown?: string; techStack?: unknown[] };
  try {
    const res = await fetch(workerUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.DEEPEN_SHARED_SECRET
          ? { "x-deepen-secret": process.env.DEEPEN_SHARED_SECRET }
          : {}),
      },
      body: JSON.stringify({
        jobDescription,
        interviewQuestions: source.interviewQuestions ?? "",
        techStack: source.techStack ?? "",
      }),
    });
    if (!res.ok) {
      const detail = await res.text();
      return NextResponse.json(
        { error: `Deepen worker failed (${res.status}): ${detail.slice(0, 300)}` },
        { status: 502 },
      );
    }
    worker = (await res.json()) as {
      prepMarkdown?: string;
      techStack?: unknown[];
    };
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Deepen worker unreachable" },
      { status: 502 },
    );
  }

  const prepMarkdown = (worker.prepMarkdown ?? "").trim();
  if (!prepMarkdown) {
    // Never persist garbage — the worker already falls back to raw content,
    // so an empty prepMarkdown means a genuine upstream failure.
    return NextResponse.json(
      { error: "Deepen worker returned no content" },
      { status: 502 },
    );
  }
  const techStack =
    Array.isArray(worker.techStack) && worker.techStack.length
      ? JSON.stringify(worker.techStack)
      : null;

  if (row) {
    await db
      .update(applications)
      .set({
        interviewQuestions: prepMarkdown,
        techStack: techStack ?? row.techStack,
        updatedAt: new Date(),
      })
      .where(whereApp(id, session.user.id));
  } else {
    await db.insert(applications).values({
      userId: session.user.id,
      slug: seed!.slug,
      company: seed!.company,
      position: seed!.position,
      url: seed!.url,
      status: "saved",
      jobDescription,
      interviewQuestions: prepMarkdown,
      techStack: techStack ?? seed!.techStack,
    });
  }

  return NextResponse.json({ ok: true });
}
