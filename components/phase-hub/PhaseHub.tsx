import type { CSSProperties } from "react";
import { notFound } from "next/navigation";
import { getGroupedLessons } from "@/lib/data";
import { Topbar } from "@/components/topbar";
import { Footer } from "@/components/footer";
import { PhaseHero } from "@/components/phase-hub/PhaseHero";
import { PhaseBrowser } from "@/components/phase-hub/PhaseBrowser";

export interface PhaseHubProps {
  /** Category slug to render (e.g. "phase-3-rag", "phase-5-evals"). */
  slug: string;
}

/**
 * PhaseHub — reusable, server-rendered dedicated page for a single roadmap
 * phase: Topbar + hero + interactive (search / filter / sort) lesson browser
 * + Footer. Design-system components, zero global CSS. Each route under app/
 * is a thin wrapper that binds one `slug`.
 */
export async function PhaseHub({ slug }: PhaseHubProps) {
  const groups = await getGroupedLessons();
  const allLessons = groups.flatMap((g) => g.articles);
  const total = allLessons.length;
  const wordCount = allLessons.reduce((sum, l) => sum + l.wordCount, 0);

  const group = groups.find((g) => g.meta.slug === slug);
  if (!group) notFound();

  const { meta, category, articles } = group;
  const minutes = Math.round(
    articles.reduce((sum, a) => sum + a.readingTimeMin, 0),
  );

  // Bind the category gradient from data so the hero AND the lesson cards
  // share the same accent, without depending on any global .cat-* class.
  const gradientVars = {
    "--cat-from": meta.gradient[0],
    "--cat-to": meta.gradient[1],
  } as CSSProperties;

  return (
    <div style={gradientVars}>
      <Topbar lessonCount={total} />

      <PhaseHero
        category={category}
        meta={meta}
        lessonCount={articles.length}
        totalMinutes={minutes}
        categoryHref={`/#cat-${meta.slug}`}
      />

      <PhaseBrowser lessons={articles} />

      <Footer wordCount={wordCount} />
    </div>
  );
}

PhaseHub.displayName = "PhaseHub";
