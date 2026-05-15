import { parseArgs } from "node:util";
import { neon } from "@neondatabase/serverless";
import { runCourseReview, type CourseReviewResult } from "../src/lib/langgraph-client";

interface Args {
  limit: number;
  provider?: string;
  dryRun: boolean;
}

interface CourseRow {
  id: string;
  title: string;
  url: string;
  provider: string;
  description: string;
  level: string;
  rating: number;
  review_count: number;
  duration_hours: number;
  is_free: boolean;
}

function parseCliArgs(): Args {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      limit: { type: "string", default: "5" },
      provider: { type: "string" },
      "dry-run": { type: "boolean", default: false },
    },
  });
  return {
    limit: Number(values.limit),
    provider: values.provider,
    dryRun: Boolean(values["dry-run"]),
  };
}

async function fetchUnreviewed(
  limit: number,
  provider: string | undefined,
): Promise<CourseRow[]> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const sql = neon(databaseUrl);

  const rows = provider
    ? await sql`
        SELECT
          ec.id::text AS id,
          ec.title,
          ec.url,
          ec.provider,
          COALESCE(ec.description, '')      AS description,
          COALESCE(ec.level, 'Beginner')    AS level,
          COALESCE(ec.rating, 0.0)          AS rating,
          COALESCE(ec.review_count, 0)      AS review_count,
          COALESCE(ec.duration_hours, 0.0)  AS duration_hours,
          ec.is_free
        FROM external_courses ec
        WHERE NOT EXISTS (
          SELECT 1 FROM course_reviews cr WHERE cr.course_id = ec.id
        )
          AND lower(ec.provider) LIKE ${"%" + provider.toLowerCase() + "%"}
        ORDER BY ec.created_at
        LIMIT ${limit}
      `
    : await sql`
        SELECT
          ec.id::text AS id,
          ec.title,
          ec.url,
          ec.provider,
          COALESCE(ec.description, '')      AS description,
          COALESCE(ec.level, 'Beginner')    AS level,
          COALESCE(ec.rating, 0.0)          AS rating,
          COALESCE(ec.review_count, 0)      AS review_count,
          COALESCE(ec.duration_hours, 0.0)  AS duration_hours,
          ec.is_free
        FROM external_courses ec
        WHERE NOT EXISTS (
          SELECT 1 FROM course_reviews cr WHERE cr.course_id = ec.id
        )
        ORDER BY ec.created_at
        LIMIT ${limit}
      `;
  return rows as unknown as CourseRow[];
}

async function upsertReview(
  row: CourseRow,
  result: CourseReviewResult,
): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL!;
  const sql = neon(databaseUrl);

  const expertDetails = {
    pedagogy_score: result.pedagogy_score,
    technical_accuracy_score: result.technical_accuracy_score,
    content_depth_score: result.content_depth_score,
    practical_application_score: result.practical_application_score,
    instructor_clarity_score: result.instructor_clarity_score,
    curriculum_fit_score: result.curriculum_fit_score,
    prerequisites_score: result.prerequisites_score,
    ai_domain_relevance_score: result.ai_domain_relevance_score,
    community_health_score: result.community_health_score,
    value_proposition_score: result.value_proposition_score,
  };

  await sql`
    INSERT INTO course_reviews (
      course_id,
      pedagogy_score,
      technical_accuracy_score,
      content_depth_score,
      practical_application_score,
      instructor_clarity_score,
      curriculum_fit_score,
      prerequisites_score,
      ai_domain_relevance_score,
      community_health_score,
      value_proposition_score,
      aggregate_score,
      verdict,
      summary,
      expert_details,
      model_version,
      reviewed_at
    ) VALUES (
      ${row.id},
      ${result.pedagogy_score.score},
      ${result.technical_accuracy_score.score},
      ${result.content_depth_score.score},
      ${result.practical_application_score.score},
      ${result.instructor_clarity_score.score},
      ${result.curriculum_fit_score.score},
      ${result.prerequisites_score.score},
      ${result.ai_domain_relevance_score.score},
      ${result.community_health_score.score},
      ${result.value_proposition_score.score},
      ${result.aggregate_score},
      ${result.verdict},
      ${result.summary},
      ${JSON.stringify(expertDetails)}::jsonb,
      ${process.env.LLM_MODEL ?? "deepseek-chat"},
      NOW()
    )
    ON CONFLICT (course_id) DO UPDATE SET
      pedagogy_score               = EXCLUDED.pedagogy_score,
      technical_accuracy_score     = EXCLUDED.technical_accuracy_score,
      content_depth_score          = EXCLUDED.content_depth_score,
      practical_application_score  = EXCLUDED.practical_application_score,
      instructor_clarity_score     = EXCLUDED.instructor_clarity_score,
      curriculum_fit_score         = EXCLUDED.curriculum_fit_score,
      prerequisites_score          = EXCLUDED.prerequisites_score,
      ai_domain_relevance_score    = EXCLUDED.ai_domain_relevance_score,
      community_health_score       = EXCLUDED.community_health_score,
      value_proposition_score      = EXCLUDED.value_proposition_score,
      aggregate_score              = EXCLUDED.aggregate_score,
      verdict                      = EXCLUDED.verdict,
      summary                      = EXCLUDED.summary,
      expert_details               = EXCLUDED.expert_details,
      model_version                = EXCLUDED.model_version,
      reviewed_at                  = NOW()
  `;
}

async function main() {
  const args = parseCliArgs();
  const courses = await fetchUnreviewed(args.limit, args.provider);

  if (courses.length === 0) {
    console.log("No unreviewed courses found.");
    return;
  }

  const providerMsg = args.provider
    ? ` (provider filter: '${args.provider}')`
    : "";
  console.log(`Found ${courses.length} unreviewed course(s)${providerMsg}.`);

  if (args.dryRun) {
    console.log("\n-- DRY RUN — no pipeline will be executed --\n");
    courses.forEach((row, i) => {
      const freeLabel = row.is_free ? "free" : "paid";
      console.log(
        `  [${i + 1}] ${row.title}\n` +
          `       provider : ${row.provider}\n` +
          `       level    : ${row.level}\n` +
          `       rating   : ${row.rating}  (${row.review_count} reviews)\n` +
          `       duration : ${row.duration_hours}h  [${freeLabel}]\n` +
          `       id       : ${row.id}\n`,
      );
    });
    return;
  }

  for (let i = 0; i < courses.length; i++) {
    const row = courses[i];
    console.log(
      `\n[${i + 1}/${courses.length}] Reviewing: ${row.title} (${row.provider}) …`,
    );
    try {
      const result = await runCourseReview({
        courseId: row.id,
        title: row.title,
        url: row.url,
        provider: row.provider,
        description: row.description,
        level: row.level,
        rating: Number(row.rating),
        reviewCount: Number(row.review_count),
        durationHours: Number(row.duration_hours),
        isFree: Boolean(row.is_free),
      });
      await upsertReview(row, result);
      console.log(
        `  verdict=${result.verdict}  ` +
          `score=${result.aggregate_score.toFixed(2)}  ` +
          `saved to course_reviews.`,
      );
    } catch (err) {
      console.log(`  ERROR reviewing course ${row.id}: ${(err as Error).message}`);
    }
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
