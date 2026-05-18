/**
 * Course-review read/write API — backed by the dedicated SQLite course store
 * (`data/courses.db`) instead of Neon Postgres. The public site reads reviews
 * from the Rust-exported `course-reviews.json` (lib/db/queries.ts); this
 * endpoint is the legacy direct read/write path.
 */
import {
  getCourseById,
  getCourseReviewRow,
  upsertCourseReview,
  type CourseReviewWrite,
} from "@/src/db/courses-sqlite";

// node:sqlite needs the Node.js runtime + filesystem; not the edge runtime.
export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return Response.json({ review: getCourseReviewRow(id) });
}

/** Accept either camelCase (legacy drizzle shape) or snake_case body keys. */
function pick(body: Record<string, unknown>, snake: string): unknown {
  if (snake in body) return body[snake];
  const camel = snake.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
  return body[camel];
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await req.json()) as Record<string, unknown>;

  if (!getCourseById(id)) {
    return Response.json({ error: "Course not found" }, { status: 404 });
  }

  const num = (k: string) => Number(pick(body, k) ?? 0);
  const review: CourseReviewWrite = {
    pedagogy_score: num("pedagogy_score"),
    technical_accuracy_score: num("technical_accuracy_score"),
    content_depth_score: num("content_depth_score"),
    practical_application_score: num("practical_application_score"),
    instructor_clarity_score: num("instructor_clarity_score"),
    curriculum_fit_score: num("curriculum_fit_score"),
    prerequisites_score: num("prerequisites_score"),
    domain_relevance_score: num("domain_relevance_score"),
    community_health_score: num("community_health_score"),
    value_proposition_score: num("value_proposition_score"),
    aggregate_score: num("aggregate_score"),
    verdict: String(pick(body, "verdict") ?? ""),
    summary: String(pick(body, "summary") ?? ""),
    expert_details: pick(body, "expert_details") ?? {},
    model_version: String(pick(body, "model_version") ?? "deepseek-chat"),
  };

  upsertCourseReview(id, review);
  return Response.json({ success: true });
}
