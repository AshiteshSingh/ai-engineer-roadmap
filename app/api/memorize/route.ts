import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/src/db";
import { concepts, knowledgeStates } from "@/src/db/schema";
import { eq, and, like, sql, count } from "drizzle-orm";
import { CATEGORY_META } from "@/lib/articles";

async function getSession() {
  return auth.api.getSession({ headers: await headers() });
}

/**
 * GET /api/memorize
 * Returns all curriculum categories with concept counts and mastery summary.
 */
export async function GET() {
  const session = await getSession();

  // Build category list with concept counts
  const categories = await Promise.all(
    Object.entries(CATEGORY_META).map(async ([name, meta]) => {
      const prefix = `${meta.slug}:%`;

      const [{ total }] = await db
        .select({ total: count() })
        .from(concepts)
        .where(like(concepts.name, prefix));

      let mastered = 0;
      let overallMastery = 0;

      if (session && total > 0) {
        const rows = await db
          .select({ pMastery: knowledgeStates.pMastery })
          .from(knowledgeStates)
          .innerJoin(concepts, eq(knowledgeStates.conceptId, concepts.id))
          .where(
            and(
              eq(knowledgeStates.userId, session.user.id),
              like(concepts.name, prefix),
            ),
          );

        mastered = rows.filter((r) => r.pMastery >= 0.6).length;
        overallMastery =
          rows.length > 0
            ? rows.reduce((sum, r) => sum + r.pMastery, 0) / total
            : 0;
      }

      return {
        slug: meta.slug,
        name,
        icon: meta.icon,
        description: meta.description,
        gradient: meta.gradient,
        totalConcepts: total,
        mastered,
        overallMastery,
      };
    }),
  );

  // Filter out categories with no concepts
  const populated = categories.filter((c) => c.totalConcepts > 0);

  return NextResponse.json({ categories: populated });
}
