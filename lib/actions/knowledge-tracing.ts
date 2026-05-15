"use server";

import { and, eq, desc } from "drizzle-orm";
import { db } from "@/src/db";
import { knowledgeStates } from "@/src/db/schema";
import { updateState, type KnowledgeState } from "@/lib/bkt";

type MasteryLevel =
  | "novice"
  | "beginner"
  | "intermediate"
  | "proficient"
  | "expert";

/**
 * Update knowledge state for a user-concept pair after an interaction.
 * Per-user state is stored in Neon (not the static JSON).
 */
export async function trackKnowledgeMastery(
  userId: string,
  conceptId: string,
  isCorrect: boolean,
): Promise<{ pMastery: number; masteryLevel: string } | null> {
  try {
    const [row] = await db
      .select({
        pMastery: knowledgeStates.pMastery,
        pTransit: knowledgeStates.pTransit,
        pSlip: knowledgeStates.pSlip,
        pGuess: knowledgeStates.pGuess,
        totalInteractions: knowledgeStates.totalInteractions,
        correctInteractions: knowledgeStates.correctInteractions,
      })
      .from(knowledgeStates)
      .where(
        and(
          eq(knowledgeStates.userId, userId),
          eq(knowledgeStates.conceptId, conceptId),
        ),
      )
      .limit(1);

    const current: KnowledgeState = row
      ? {
          p_mastery: row.pMastery || 0.1,
          p_transit: row.pTransit || 0.1,
          p_slip: row.pSlip || 0.1,
          p_guess: row.pGuess || 0.2,
          total_interactions: row.totalInteractions || 0,
          correct_interactions: row.correctInteractions || 0,
        }
      : {
          p_mastery: 0.1,
          p_transit: 0.1,
          p_slip: 0.1,
          p_guess: 0.2,
          total_interactions: 0,
          correct_interactions: 0,
        };

    const updated = await updateState(current, isCorrect);

    const level: MasteryLevel =
      updated.p_mastery >= 0.8
        ? "expert"
        : updated.p_mastery >= 0.6
          ? "proficient"
          : updated.p_mastery >= 0.4
            ? "intermediate"
            : updated.p_mastery >= 0.2
              ? "beginner"
              : "novice";

    const now = new Date();

    await db
      .insert(knowledgeStates)
      .values({
        userId,
        conceptId,
        pMastery: updated.p_mastery,
        pTransit: updated.p_transit,
        pSlip: updated.p_slip,
        pGuess: updated.p_guess,
        totalInteractions: updated.total_interactions,
        correctInteractions: updated.correct_interactions,
        masteryLevel: level,
        lastInteractionAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [knowledgeStates.userId, knowledgeStates.conceptId],
        set: {
          pMastery: updated.p_mastery,
          totalInteractions: updated.total_interactions,
          correctInteractions: updated.correct_interactions,
          masteryLevel: level,
          lastInteractionAt: now,
          updatedAt: now,
        },
      });

    return { pMastery: updated.p_mastery, masteryLevel: level };
  } catch (error) {
    console.error("Knowledge tracing error:", error);
    return null;
  }
}

/**
 * Get a user's knowledge map — mastery across all concepts they've touched.
 */
export async function getUserKnowledgeMap(
  userId: string,
): Promise<{ conceptId: string; pMastery: number; masteryLevel: string }[]> {
  try {
    const rows = await db
      .select({
        conceptId: knowledgeStates.conceptId,
        pMastery: knowledgeStates.pMastery,
        masteryLevel: knowledgeStates.masteryLevel,
      })
      .from(knowledgeStates)
      .where(eq(knowledgeStates.userId, userId))
      .orderBy(desc(knowledgeStates.pMastery));

    return rows.map((r) => ({
      conceptId: r.conceptId,
      pMastery: r.pMastery,
      masteryLevel: r.masteryLevel,
    }));
  } catch (error) {
    console.error("Knowledge map error:", error);
    return [];
  }
}
