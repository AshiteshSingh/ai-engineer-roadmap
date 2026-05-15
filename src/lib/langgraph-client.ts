/**
 * Typed HTTP client for the knowledge LangGraph backend.
 *
 * Calls the FastAPI harness at apps/knowledge/backend/app.py via POST /runs/wait.
 * Local dev: start the container or run `uvicorn app:app --port 7860` from
 * `apps/knowledge/backend/`. Point LANGGRAPH_URL at the deployed worker in prod.
 */

const LANGGRAPH_URL =
  process.env.LANGGRAPH_URL || "http://127.0.0.1:7860";

const LANGGRAPH_AUTH_TOKEN = process.env.LANGGRAPH_AUTH_TOKEN;

async function runGraph<T>(
  assistantId: string,
  input: Record<string, unknown>,
  options: { timeoutMs?: number } = {},
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (LANGGRAPH_AUTH_TOKEN) {
    headers.Authorization = `Bearer ${LANGGRAPH_AUTH_TOKEN}`;
  }
  const res = await fetch(`${LANGGRAPH_URL}/runs/wait`, {
    method: "POST",
    headers,
    body: JSON.stringify({ assistant_id: assistantId, input }),
    signal: AbortSignal.timeout(options.timeoutMs ?? 60_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `LangGraph ${assistantId} failed (${res.status}): ${text}`,
    );
  }
  return res.json() as Promise<T>;
}

// ── Types ──────────────────────────────────────────────────

export interface ChatResult {
  response: string;
}

export interface TechBadge {
  tag: string;
  label: string;
  category: string;
  relevance: "primary" | "secondary";
}

export interface AppPrepResult {
  tech_stack: TechBadge[];
  interview_questions: string;
}

export interface MemorizeItemDetail {
  label: string;
  description: string;
}

export interface MemorizeItem {
  id: string;
  term: string;
  description: string;
  details: MemorizeItemDetail[];
  context?: string;
  relatedItems: string[];
  mnemonicHint?: string;
}

export interface MemorizeCategory {
  id: string;
  name: string;
  icon: string;
  color: string;
  items: MemorizeItem[];
}

export interface MemorizeGenerateResult {
  categories: MemorizeCategory[];
}

export interface ExpertScore {
  score: number;
  reasoning: string;
  strengths: string[];
  weaknesses: string[];
}

export interface CourseReviewResult {
  course_id: string;
  title: string;
  url: string;
  provider: string;
  description: string;
  level: string;
  rating: number;
  review_count: number;
  duration_hours: number;
  is_free: boolean;
  pedagogy_score: ExpertScore;
  technical_accuracy_score: ExpertScore;
  content_depth_score: ExpertScore;
  practical_application_score: ExpertScore;
  instructor_clarity_score: ExpertScore;
  curriculum_fit_score: ExpertScore;
  prerequisites_score: ExpertScore;
  ai_domain_relevance_score: ExpertScore;
  community_health_score: ExpertScore;
  value_proposition_score: ExpertScore;
  aggregate_score: number;
  verdict: "excellent" | "recommended" | "average" | "skip";
  summary: string;
  top_strengths: string[];
  key_weaknesses: string[];
}

// ── Typed wrappers ─────────────────────────────────────────

export function chat(input: {
  message: string;
  history?: Array<{ role: string; content: string }>;
  contextSnippets?: string[];
}): Promise<ChatResult> {
  return runGraph<ChatResult>("chat", {
    message: input.message,
    history: input.history ?? [],
    context_snippets: input.contextSnippets ?? [],
  });
}

export function runAppPrep(input: {
  appId: string;
  jobDescription: string;
  company?: string;
  position?: string;
}): Promise<AppPrepResult> {
  return runGraph<AppPrepResult>(
    "app_prep",
    {
      app_id: input.appId,
      job_description: input.jobDescription,
      company: input.company ?? "",
      position: input.position ?? "",
    },
    { timeoutMs: 120_000 },
  );
}

export function runMemorizeGenerate(input: {
  company: string;
  position: string;
  techs: TechBadge[];
}): Promise<MemorizeGenerateResult> {
  return runGraph<MemorizeGenerateResult>(
    "memorize_generate",
    {
      company: input.company,
      position: input.position,
      techs: input.techs,
    },
    { timeoutMs: 180_000 },
  );
}

// Article generation does NOT go through this TS client.
// It runs the Python LangGraph StateGraph directly via
// `backend/scripts/generate_article.py` — see that file's docstring.

/**
 * 10-expert course review: parallel fan-out + weighted aggregator. Input and
 * output shapes are stable so storage/UI don't change.
 */
export function runCourseReview(input: {
  courseId: string;
  title: string;
  url: string;
  provider: string;
  description?: string;
  level?: string;
  rating?: number;
  reviewCount?: number;
  durationHours?: number;
  isFree?: boolean;
}): Promise<CourseReviewResult> {
  return runGraph<CourseReviewResult>(
    "course_review",
    {
      course_id: input.courseId,
      title: input.title,
      url: input.url,
      provider: input.provider,
      description: input.description ?? "",
      level: input.level ?? "Beginner",
      rating: input.rating ?? 0,
      review_count: input.reviewCount ?? 0,
      duration_hours: input.durationHours ?? 0,
      is_free: input.isFree ?? false,
    },
    { timeoutMs: 180_000 },
  );
}
