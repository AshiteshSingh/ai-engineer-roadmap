import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/src/db";
import { applications, concepts } from "@/src/db/schema";
import { eq, and } from "drizzle-orm";
import { runMemorizeGenerate, type TechBadge } from "@/src/lib/langgraph-client";
import type { MemorizeCategory } from "@/lib/memorize-types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function getSession() {
  return auth.api.getSession({ headers: await headers() });
}

function parseTechStack(aiTechStack: string | null): TechBadge[] {
  if (!aiTechStack) return [];
  try {
    const parsed = JSON.parse(aiTechStack);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function filterDismissed(techs: TechBadge[], dismissed: string | null): TechBadge[] {
  if (!dismissed) return techs;
  try {
    const tags = JSON.parse(dismissed) as string[];
    const set = new Set(tags.map((t) => t.toLowerCase()));
    return techs.filter((t) => !set.has(t.tag.toLowerCase()));
  } catch {
    return techs;
  }
}

/**
 * POST /api/applications/[id]/memorize/generate
 * Generate memorize categories from the app's tech stack via LangGraph.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const [session, { id: appId }] = await Promise.all([getSession(), params]);
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const col = UUID_RE.test(appId) ? applications.id : applications.slug;
  const [app] = await db
    .select({
      id: applications.id,
      company: applications.company,
      position: applications.position,
      aiTechStack: applications.aiTechStack,
      techDismissedTags: applications.techDismissedTags,
      aiMemorizeCategories: applications.aiMemorizeCategories,
      userId: applications.userId,
    })
    .from(applications)
    .where(
      and(eq(col, appId), eq(applications.userId, session.user.id)),
    );

  if (!app)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (app.aiMemorizeCategories) {
    const categories: MemorizeCategory[] = JSON.parse(app.aiMemorizeCategories);
    return NextResponse.json({ status: "already_generated", categories });
  }

  if (!app.aiTechStack) {
    return NextResponse.json(
      { error: "No tech stack available. Generate a study plan first." },
      { status: 400 },
    );
  }

  const techs = filterDismissed(
    parseTechStack(app.aiTechStack),
    app.techDismissedTags,
  );

  if (techs.length === 0) {
    return NextResponse.json({ status: "generated", categories: [] });
  }

  let categories: MemorizeCategory[];
  try {
    const result = await runMemorizeGenerate({
      company: app.company,
      position: app.position,
      techs,
    });
    categories = result.categories as MemorizeCategory[];
  } catch (err) {
    return NextResponse.json(
      {
        error: "LangGraph memorize_generate failed",
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 502 },
    );
  }

  for (const cat of categories) {
    for (const item of cat.items) {
      const conceptName = `app:${app.id}:${item.id}`;
      await db
        .insert(concepts)
        .values({
          name: conceptName,
          description: item.description,
          conceptType: "skill",
          metadata: {
            term: item.term,
            details: item.details,
            context: item.context,
            relatedItems: item.relatedItems,
            mnemonicHint: item.mnemonicHint,
          },
        })
        .onConflictDoUpdate({
          target: concepts.name,
          set: {
            description: item.description,
            metadata: {
              term: item.term,
              details: item.details,
              context: item.context,
              relatedItems: item.relatedItems,
              mnemonicHint: item.mnemonicHint,
            },
          },
        });
    }
  }

  await db
    .update(applications)
    .set({ aiMemorizeCategories: JSON.stringify(categories) })
    .where(eq(applications.id, app.id));

  return NextResponse.json({ status: "generated", categories });
}
