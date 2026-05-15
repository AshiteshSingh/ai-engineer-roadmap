import { contentDb as db } from "@/src/db/content";
import { courseReviews, externalCourses } from "@/src/db/content-schema";
import { eq } from "drizzle-orm";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const review = await db
    .select()
    .from(courseReviews)
    .where(eq(courseReviews.courseId, id))
    .limit(1);

  if (!review[0]) return Response.json({ review: null });
  return Response.json({ review: review[0] });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();

  const course = await db
    .select({ id: externalCourses.id })
    .from(externalCourses)
    .where(eq(externalCourses.id, id))
    .limit(1);

  if (!course[0]) {
    return Response.json({ error: "Course not found" }, { status: 404 });
  }

  await db
    .insert(courseReviews)
    .values({ courseId: id, ...body })
    .onConflictDoUpdate({
      target: courseReviews.courseId,
      set: { ...body, reviewedAt: new Date() },
    });

  return Response.json({ success: true });
}
