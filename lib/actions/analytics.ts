"use server";

import { sql } from "drizzle-orm";
import { contentDb as db } from "@/src/db/content";
import { analyticsEvents } from "@/src/db/content-schema";

export async function trackAnalyticsEvent(
  eventName: string,
  lessonSlug: string,
  sessionId: string,
  properties?: Record<string, unknown>,
) {
  try {
    // Resolve lesson ID inline to avoid a separate round-trip.
    await db.insert(analyticsEvents).values({
      eventCategory: "reading",
      eventName,
      lessonId: sql`(SELECT id FROM lessons WHERE slug = ${lessonSlug})`,
      sessionId,
      userId: null,
      properties: properties ?? {},
      durationMs: (properties?.duration_ms as number) ?? null,
    });
  } catch {
    // Silent fail — analytics should never break the app
  }
}
