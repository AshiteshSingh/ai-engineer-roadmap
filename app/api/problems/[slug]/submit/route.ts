import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/src/db";
import { problems, problemSubmissions } from "@/src/db/schema";

const BodySchema = z.object({
  language: z.enum(["js", "ts"]),
  code: z.string().min(1).max(64_000),
  status: z.enum(["passed", "failed", "error", "timeout"]),
  passedCount: z.number().int().min(0),
  totalCount: z.number().int().min(0),
  runtimeMs: z.number().nullable().optional(),
  errorMessage: z.string().nullable().optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { slug } = await params;
  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  }

  const [problem] = await db
    .select({ id: problems.id })
    .from(problems)
    .where(eq(problems.slug, slug))
    .limit(1);

  if (!problem) {
    return NextResponse.json({ error: "Problem not found" }, { status: 404 });
  }

  const [row] = await db
    .insert(problemSubmissions)
    .values({
      problemId: problem.id,
      userId: session.user.id,
      language: parsed.data.language,
      code: parsed.data.code,
      status: parsed.data.status,
      passedCount: parsed.data.passedCount,
      totalCount: parsed.data.totalCount,
      runtimeMs: parsed.data.runtimeMs ?? null,
      errorMessage: parsed.data.errorMessage ?? null,
    })
    .returning({ id: problemSubmissions.id, createdAt: problemSubmissions.createdAt });

  return NextResponse.json({ ok: true, submission: row });
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { slug } = await params;
  const [problem] = await db
    .select({ id: problems.id })
    .from(problems)
    .where(eq(problems.slug, slug))
    .limit(1);
  if (!problem) {
    return NextResponse.json({ error: "Problem not found" }, { status: 404 });
  }

  const rows = await db
    .select({
      id: problemSubmissions.id,
      language: problemSubmissions.language,
      status: problemSubmissions.status,
      passedCount: problemSubmissions.passedCount,
      totalCount: problemSubmissions.totalCount,
      runtimeMs: problemSubmissions.runtimeMs,
      createdAt: problemSubmissions.createdAt,
    })
    .from(problemSubmissions)
    .where(and(
      eq(problemSubmissions.problemId, problem.id),
      eq(problemSubmissions.userId, session.user.id),
    ))
    .orderBy(desc(problemSubmissions.createdAt))
    .limit(50);

  return NextResponse.json({ submissions: rows });
}
