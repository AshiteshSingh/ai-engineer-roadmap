import type { CSSProperties } from "react";
import { notFound } from "next/navigation";
import { getGroupedLessons } from "@/lib/data";
import { Topbar } from "@/components/topbar";
import { Footer } from "@/components/footer";
import { EvalsHero } from "@/components/evals/EvalsHero";
import { EvalsBrowser } from "@/components/evals/EvalsBrowser";

export const metadata = {
  title: "Evals, Safety & Observability — AI Engineering",
  description:
    "Measure what matters and ship safely: evaluation fundamentals, LLM-as-judge, benchmarks, red-teaming, guardrails, online evaluation and observability.",
};

const PHASE_5_SLUG = "phase-5-evals";

// Redesigned evals hub (formerly staged at /evals/v2): design-system
// components, zero global CSS, interactive search / filter / sort.
export default async function EvalsHubPage() {
  const groups = await getGroupedLessons();
  const allLessons = groups.flatMap((g) => g.articles);
  const total = allLessons.length;
  const wordCount = allLessons.reduce((sum, l) => sum + l.wordCount, 0);

  const group = groups.find((g) => g.meta.slug === PHASE_5_SLUG);
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

      <EvalsHero
        category={category}
        meta={meta}
        lessonCount={articles.length}
        totalMinutes={minutes}
        categoryHref={`/#cat-${meta.slug}`}
      />

      <EvalsBrowser lessons={articles} />

      <Footer wordCount={wordCount} />
    </div>
  );
}
