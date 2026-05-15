import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/src/db";
import { applications, concepts, knowledgeStates } from "@/src/db/schema";
import { eq, and, like } from "drizzle-orm";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function whereApp(id: string, userId: string) {
  const col = UUID_RE.test(id) ? applications.id : applications.slug;
  return and(eq(col, id), eq(applications.userId, userId));
}

async function getSession() {
  return auth.api.getSession({ headers: await headers() });
}

/**
 * GET /api/applications/[id]/memorize
 * Returns the user's mastery states for all app-scoped concepts,
 * plus the generated category catalog.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const [session, { id: appId }] = await Promise.all([getSession(), params]);

  // Try authenticated lookup first, then public fallback
  const col = UUID_RE.test(appId) ? applications.id : applications.slug;
  let app: { id: string; aiMemorizeCategories: string | null } | undefined;

  if (session) {
    [app] = await db
      .select({ id: applications.id, aiMemorizeCategories: applications.aiMemorizeCategories })
      .from(applications)
      .where(whereApp(appId, session.user.id));
  }

  if (!app) {
    // Public fallback
    [app] = await db
      .select({ id: applications.id, aiMemorizeCategories: applications.aiMemorizeCategories })
      .from(applications)
      .where(and(eq(col, appId), eq(applications.public, true)));
  }

  if (!app) {
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const generated = !!app.aiMemorizeCategories;
  const categories = generated ? JSON.parse(app.aiMemorizeCategories!) : [];

  // Query mastery for app-scoped concepts (only for authenticated users)
  const mastery: Record<
    string,
    {
      pMastery: number;
      masteryLevel: string;
      totalInteractions: number;
      correctInteractions: number;
      lastInteractionAt: Date | null;
    }
  > = {};

  if (session) {
    const prefix = `app:${app.id}:%`;
    const rows = await db
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

    const stripPrefix = `app:${app.id}:`;
    for (const row of rows) {
      const key = row.conceptName.replace(stripPrefix, "");
      mastery[key] = {
        pMastery: row.pMastery,
        masteryLevel: row.masteryLevel,
        totalInteractions: row.totalInteractions,
        correctInteractions: row.correctInteractions,
        lastInteractionAt: row.lastInteractionAt,
      };
    }
  }

  return NextResponse.json({ mastery, categories, generated });
}

/**
 * POST /api/applications/[id]/memorize
 * Record an interaction for an app-scoped concept.
 * Body: { propertyId: string, isCorrect: boolean }
 * propertyId format: "{categoryId}:{itemId}"
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const [session, { id: appId }] = await Promise.all([getSession(), params]);
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { propertyId, isCorrect } = body as {
    propertyId: string;
    isCorrect: boolean;
  };

  if (!propertyId || typeof isCorrect !== "boolean") {
    return NextResponse.json(
      { error: "propertyId and isCorrect required" },
      { status: 400 },
    );
  }

  // Resolve real app ID from slug or UUID
  const [app] = await db
    .select({ id: applications.id })
    .from(applications)
    .where(whereApp(appId, session.user.id));

  if (!app)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  const conceptName = `app:${app.id}:${propertyId}`;

  // Find or create the concept
  let [concept] = await db
    .select({ id: concepts.id })
    .from(concepts)
    .where(eq(concepts.name, conceptName));

  if (!concept) {
    // Auto-create if missing (generation saved the catalog but concept row may not exist)
    const [inserted] = await db
      .insert(concepts)
      .values({
        name: conceptName,
        description: propertyId,
        conceptType: "skill",
        metadata: {},
      })
      .onConflictDoUpdate({
        target: concepts.name,
        set: { description: propertyId },
      })
      .returning({ id: concepts.id });
    concept = inserted;
  }

  // Read current state
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
  const correct =
    (existing?.correctInteractions ?? 0) + (isCorrect ? 1 : 0);
  const currentMastery = existing?.pMastery ?? 0.1;

  // BKT update
  const pTransit = 0.1;
  const pSlip = 0.1;
  const pGuess = 0.2;

  let pMastery: number;
  if (isCorrect) {
    const pCorrectGivenMastered = 1 - pSlip;
    const pCorrectGivenUnmastered = pGuess;
    const posterior =
      (currentMastery * pCorrectGivenMastered) /
      (currentMastery * pCorrectGivenMastered +
        (1 - currentMastery) * pCorrectGivenUnmastered);
    pMastery = posterior + (1 - posterior) * pTransit;
  } else {
    const pIncorrectGivenMastered = pSlip;
    const pIncorrectGivenUnmastered = 1 - pGuess;
    const posterior =
      (currentMastery * pIncorrectGivenMastered) /
      (currentMastery * pIncorrectGivenMastered +
        (1 - currentMastery) * pIncorrectGivenUnmastered);
    pMastery = posterior + (1 - posterior) * pTransit;
  }

  const masteryLevel =
    pMastery >= 0.8
      ? "expert"
      : pMastery >= 0.6
        ? "proficient"
        : pMastery >= 0.4
          ? "intermediate"
          : pMastery >= 0.2
            ? "beginner"
            : "novice";

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
      pTransit,
      pSlip,
      pGuess,
      totalInteractions: total,
      correctInteractions: correct,
      masteryLevel,
      lastInteractionAt: now,
    });
  }

  return NextResponse.json({ pMastery, masteryLevel, total, correct });
}
