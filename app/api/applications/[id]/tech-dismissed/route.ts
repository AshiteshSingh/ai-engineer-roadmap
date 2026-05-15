import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/src/db";
import { applications } from "@/src/db/schema";
import { eq, and } from "drizzle-orm";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function whereApp(id: string, userId: string) {
  const col = UUID_RE.test(id) ? applications.id : applications.slug;
  return and(eq(col, id), eq(applications.userId, userId));
}

async function getSession() {
  return auth.api.getSession({ headers: await headers() });
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const [session, { id }] = await Promise.all([getSession(), params]);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [row] = await db
    .select({ techDismissedTags: applications.techDismissedTags })
    .from(applications)
    .where(whereApp(id, session.user.id));

  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const dismissed: string[] = row.techDismissedTags
    ? JSON.parse(row.techDismissedTags)
    : [];

  return NextResponse.json({ dismissed });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const [session, { id }] = await Promise.all([getSession(), params]);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const dismissed: string[] = Array.isArray(body.dismissed) ? body.dismissed : [];

  await db
    .update(applications)
    .set({
      techDismissedTags: JSON.stringify(dismissed),
      updatedAt: new Date(),
    })
    .where(whereApp(id, session.user.id));

  return NextResponse.json({ dismissed });
}
