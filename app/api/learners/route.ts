import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/src/db";
import { learners } from "@/src/db/schema";
import { eq, desc } from "drizzle-orm";

async function getSession() {
  return auth.api.getSession({ headers: await headers() });
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await db
    .select()
    .from(learners)
    .where(eq(learners.userId, session.user.id))
    .orderBy(desc(learners.createdAt));

  return NextResponse.json(rows);
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { name, age } = body;

  if (!name || age == null) {
    return NextResponse.json({ error: "name and age are required" }, { status: 400 });
  }

  const [row] = await db
    .insert(learners)
    .values({ userId: session.user.id, name, age: Number(age) })
    .returning();

  return NextResponse.json(row, { status: 201 });
}
