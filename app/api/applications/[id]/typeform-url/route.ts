import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isOwner } from "@/lib/owner";
import { db } from "@/src/db";
import { applications } from "@/src/db/schema";
import { eq, and } from "drizzle-orm";
import { getApplicationTypeformUrl } from "@/lib/typeform";

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
  if (!session || !isOwner(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const [row] = await db
    .select({ id: applications.id, audioUrl: applications.audioUrl })
    .from(applications)
    .where(whereApp(id, session.user.id));

  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const url = getApplicationTypeformUrl({
    applicationId: row.id,
    audioUrl: row.audioUrl,
  });

  return NextResponse.json({ url });
}
