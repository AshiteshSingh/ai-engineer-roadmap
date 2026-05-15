import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/src/db";
import { coursework } from "@/src/db/schema";
import { uploadToR2, courseworkKey } from "@/lib/r2";

const ALLOWED_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/webp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

const MAX_SIZE = 10 * 1024 * 1024; // 10 MB

async function getSession() {
  return auth.api.getSession({ headers: await headers() });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const title = (formData.get("title") as string) || "";
  const subject = (formData.get("subject") as string) || null;
  const learnerId = formData.get("learnerId") as string;

  if (!file || !learnerId) {
    return NextResponse.json({ error: "file and learnerId are required" }, { status: 400 });
  }

  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json({ error: "File type not allowed" }, { status: 400 });
  }

  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: "File too large (max 10 MB)" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const key = courseworkKey(session.user.id, file.name);
  const fileUrl = await uploadToR2(key, buffer, file.type);

  const [row] = await db
    .insert(coursework)
    .values({
      learnerId,
      userId: session.user.id,
      title: title || file.name,
      fileName: file.name,
      fileUrl,
      fileSize: file.size,
      mimeType: file.type,
      subject,
    })
    .returning();

  return NextResponse.json(row, { status: 201 });
}
