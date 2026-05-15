import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/src/db";
import { concepts, knowledgeStates } from "@/src/db/schema";
import { eq, and, like } from "drizzle-orm";
import { updateBktInline, computeMasteryLevel } from "@/lib/bkt";

async function getSession() {
  return auth.api.getSession({ headers: await headers() });
}

/**
 * GET /api/memorize/[categorySlug]
 * Returns items and mastery for a specific category.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ categorySlug: string }> },
) {
  const [session, { categorySlug }] = await Promise.all([getSession(), params]);
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const prefix = `${categorySlug}:%`;

  // Fetch all concepts for this category
  const conceptRows = await db
    .select({
      id: concepts.id,
      name: concepts.name,
      description: concepts.description,
      metadata: concepts.metadata,
      conceptType: concepts.conceptType,
    })
    .from(concepts)
    .where(like(concepts.name, prefix));

  // Fetch mastery states
  const masteryRows = await db
    .select({
      conceptName: concepts.name,
      pMastery: knowledgeStates.pMastery,
      masteryLevel: knowledgeStates.masteryLevel,
      totalInteractions: knowledgeStates.totalInteractions,
      correctInteractions: knowledgeStates.correctInteractions,
      lastInteractionAt: knowledgeStates.lastInteractionAt,
    })
    .from(knowledgeStates)
    .innerJoin(concepts, eq(knowledgeStates.conceptId, concepts.id))
    .where(
      and(
        eq(knowledgeStates.userId, session.user.id),
        like(concepts.name, prefix),
      ),
    );

  // Build items from concepts
  const items = conceptRows.map((row) => {
    const itemId = row.name.replace(new RegExp(`^${categorySlug}:`), "");
    const meta = row.metadata as Record<string, unknown> | null;
    return {
      id: itemId,
      term: (meta?.term as string) ?? itemId,
      description: row.description ?? "",
      details: (meta?.details as { label: string; description: string }[]) ?? [],
      context: (meta?.context as string) ?? undefined,
      demo: (meta?.demo as { html: string; css: string; highlightProp: string }) ?? undefined,
      relatedItems: (meta?.relatedItems as string[]) ?? [],
      mnemonicHint: (meta?.mnemonicHint as string) ?? undefined,
      sourceLesson: (meta?.sourceLesson as string) ?? undefined,
    };
  });

  // Build mastery map
  const mastery: Record<string, {
    pMastery: number;
    masteryLevel: string;
    totalInteractions: number;
    correctInteractions: number;
    lastInteractionAt: Date | null;
  }> = {};

  for (const row of masteryRows) {
    const itemId = row.conceptName.replace(new RegExp(`^${categorySlug}:`), "");
    mastery[itemId] = {
      pMastery: row.pMastery,
      masteryLevel: row.masteryLevel,
      totalInteractions: row.totalInteractions,
      correctInteractions: row.correctInteractions,
      lastInteractionAt: row.lastInteractionAt,
    };
  }

  return NextResponse.json({ items, mastery });
}

/**
 * POST /api/memorize/[categorySlug]
 * Record an interaction for a concept.
 * Body: { itemId: string, isCorrect: boolean }
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ categorySlug: string }> },
) {
  const [session, { categorySlug }] = await Promise.all([getSession(), params]);
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { itemId, isCorrect } = body as {
    itemId: string;
    isCorrect: boolean;
  };

  if (!itemId || typeof isCorrect !== "boolean") {
    return NextResponse.json(
      { error: "itemId and isCorrect required" },
      { status: 400 },
    );
  }

  const conceptName = `${categorySlug}:${itemId}`;

  const [concept] = await db
    .select({ id: concepts.id })
    .from(concepts)
    .where(eq(concepts.name, conceptName));

  if (!concept) {
    return NextResponse.json(
      { error: `Concept ${conceptName} not found` },
      { status: 404 },
    );
  }

  const [existing] = await db
    .select()
    .from(knowledgeStates)
    .where(
      and(
        eq(knowledgeStates.userId, session.user.id),
        eq(knowledgeStates.conceptId, concept.id),
      ),
    );

  const total = (existing?.totalInteractions ?? 0) + 1;
  const correct = (existing?.correctInteractions ?? 0) + (isCorrect ? 1 : 0);
  const currentMastery = existing?.pMastery ?? 0.1;

  const pMastery = updateBktInline(currentMastery, isCorrect);
  const masteryLevel = computeMasteryLevel(pMastery) as "novice" | "beginner" | "intermediate" | "proficient" | "expert";
  const now = new Date();

  if (existing) {
    await db
      .update(knowledgeStates)
      .set({
        pMastery,
        totalInteractions: total,
        correctInteractions: correct,
        masteryLevel,
        lastInteractionAt: now,
        updatedAt: now,
      })
      .where(eq(knowledgeStates.id, existing.id));
  } else {
    await db.insert(knowledgeStates).values({
      userId: session.user.id,
      conceptId: concept.id,
      pMastery,
      pTransit: 0.1,
      pSlip: 0.1,
      pGuess: 0.2,
      totalInteractions: total,
      correctInteractions: correct,
      masteryLevel,
      lastInteractionAt: now,
    });
  }

  return NextResponse.json({ pMastery, masteryLevel, total, correct });
}
