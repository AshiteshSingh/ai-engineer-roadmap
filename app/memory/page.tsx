import type { CSSProperties } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getGroupedLessons } from "@/lib/data";
import { phaseHubMetadata } from "@/lib/phase-hub-metadata";
import { getAllCoursesByGroup } from "@/lib/db/queries";
import type { ExternalCourse } from "@/lib/db/queries";
import { Topbar } from "@/components/topbar";
import { Footer } from "@/components/footer";
import { PhaseHero } from "@/components/phase-hub/PhaseHero";
import { PhaseBrowser } from "@/components/phase-hub/PhaseBrowser";
import { ExternalCourses } from "@/components/external-courses";

// Dedicated hub for the real "Phase 5 · Long-Term Memory" taxonomy category
// (slug phase-5-memory; lessons assigned per-slug via
// LESSON_CATEGORY_OVERRIDES). It is NOT the thin <PhaseHub> wrapper because it
// additionally renders the DeepLearning.AI course rail (which <PhaseHub> does
// not). The scraped transcripts are NOT shown here — they remain private
// chat-retrieval grounding; this page only links out to the courses.

const SLUG = "phase-5-memory";

export async function generateMetadata(): Promise<Metadata> {
  return phaseHubMetadata(SLUG);
}

export default async function MemoryHubPage() {
  const groups = await getGroupedLessons();
  const group = groups.find((g) => g.meta.slug === SLUG);
  if (!group) notFound();

  const { meta, category, articles } = group;
  const totalMinutes = Math.round(
    articles.reduce((sum, a) => sum + a.readingTimeMin, 0),
  );
  const corpusWords = groups
    .flatMap((g) => g.articles)
    .reduce((sum, l) => sum + l.wordCount, 0);

  // DeepLearning.AI courses, memory course surfaced first. Links only.
  const byGroup = await getAllCoursesByGroup();
  const dlCourses: ExternalCourse[] = Object.values(byGroup)
    .flat()
    .filter((c) => c.provider.toLowerCase().includes("deeplearning"))
    .sort((a, b) => {
      const am = a.url.includes("long-term-agentic-memory") ? 0 : 1;
      const bm = b.url.includes("long-term-agentic-memory") ? 0 : 1;
      return am - bm || (b.rating ?? 0) - (a.rating ?? 0);
    });

  const gradientVars = {
    "--cat-from": meta.gradient[0],
    "--cat-to": meta.gradient[1],
  } as CSSProperties;

  return (
    <div style={gradientVars}>
      <Topbar lessonCount={groups.flatMap((g) => g.articles).length} />

      <PhaseHero
        category={category}
        meta={meta}
        lessonCount={articles.length}
        totalMinutes={totalMinutes}
        categoryHref={`/#cat-${meta.slug}`}
      />

      <PhaseBrowser
        lessons={articles}
        heading="Memory lessons"
        gradient={meta.gradient}
        icon={meta.icon}
        category={category}
      />

      <ExternalCourses courses={dlCourses} />

      <Footer wordCount={corpusWords} />
    </div>
  );
}
