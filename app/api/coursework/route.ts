import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isOwner } from "@/lib/owner";
import { db } from "@/src/db";
import { coursework } from "@/src/db/schema";
import { eq, desc } from "drizzle-orm";

async function getSession() {
  return auth.api.getSession({ headers: await headers() });
}

export async function GET() {
  const session = await getSession();
  if (!session || !isOwner(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const rows = await db
    .select()
    .from(coursework)
    .where(eq(coursework.userId, session.user.id))
    .orderBy(desc(coursework.submittedAt));

  return NextResponse.json(rows);
}
