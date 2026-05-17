import type { Metadata } from "next";
import { PHASE_HUB_METADATA_OVERRIDES } from "@/lib/phase-hubs";

/**
 * Build <head> metadata for a phase hub route (server-only — reaches the
 * content data layer). Returns the per-slug override when one exists;
 * otherwise derives `{ title, description }` from the phase's category name
 * + description in the content data.
 */
export async function phaseHubMetadata(slug: string): Promise<Metadata> {
  const override = PHASE_HUB_METADATA_OVERRIDES[slug];
  if (override) return override;

  const { getGroupedLessons } = await import("@/lib/data");
  const groups = await getGroupedLessons();
  const group = groups.find((g) => g.meta.slug === slug);
  if (!group) return {};

  return {
    title: `${group.category} — AI Engineering`,
    description: group.meta.description,
  };
}
