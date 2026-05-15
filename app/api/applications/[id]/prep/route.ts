import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/src/db";
import { applications } from "@/src/db/schema";
import { eq, and } from "drizzle-orm";
import { runAppPrep } from "@/src/lib/langgraph-client";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function whereApp(id: string, userId: string) {
  const col = UUID_RE.test(id) ? applications.id : applications.slug;
  return and(eq(col, id), eq(applications.userId, userId));
}

async function getSession() {
  return auth.api.getSession({ headers: await headers() });
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const [session, { id }] = await Promise.all([getSession(), params]);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [app] = await db
    .select({
      id: applications.id,
      company: applications.company,
      position: applications.position,
      jobDescription: applications.jobDescription,
    })
    .from(applications)
    .where(whereApp(id, session.user.id));

  if (!app) {
    return NextResponse.json({ error: "Application not found" }, { status: 404 });
  }
  if (!app.jobDescription) {
    return NextResponse.json(
      { error: "Application has no job description — add one first" },
      { status: 400 },
    );
  }

  // Fire-and-forget: the UI polls GET until aiInterviewQuestions + aiTechStack
  // are set. The graph call can take 30-60s so we don't block the POST.
  void runAppPrep({
    appId: app.id,
    jobDescription: app.jobDescription,
    company: app.company,
    position: app.position,
  })
    .then(async (result) => {
      await db
        .update(applications)
        .set({
          aiInterviewQuestions: result.interview_questions,
          aiTechStack: JSON.stringify(result.tech_stack),
        })
        .where(eq(applications.id, app.id));
    })
    .catch((err) => {
      console.error(`[app-prep ${app.id}] failed:`, err);
    });

  return NextResponse.json({ status: "started", appId: id });
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const [session, { id }] = await Promise.all([getSession(), params]);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [app] = await db
    .select({
      aiInterviewQuestions: applications.aiInterviewQuestions,
      aiTechStack: applications.aiTechStack,
    })
    .from(applications)
    .where(whereApp(id, session.user.id));

  if (!app) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({
    ready: !!(app.aiInterviewQuestions && app.aiTechStack),
    hasInterview: !!app.aiInterviewQuestions,
    hasTech: !!app.aiTechStack,
  });
}
