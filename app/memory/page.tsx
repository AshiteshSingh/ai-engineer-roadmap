import type { CSSProperties } from "react";
import type { Metadata } from "next";
import { getAllLessons } from "@/lib/data";
import type { CategoryMeta, Lesson } from "@/lib/data";
import { getAllCoursesByGroup } from "@/lib/db/queries";
import type { ExternalCourse } from "@/lib/db/queries";
import { Topbar } from "@/components/topbar";
import { Footer } from "@/components/footer";
import { PhaseHero } from "@/components/phase-hub/PhaseHero";
import { PhaseBrowser } from "@/components/phase-hub/PhaseBrowser";
import { ExternalCourses } from "@/components/external-courses";

// Dedicated /memory hub. Memory is a cross-phase theme (no single taxonomy
// category), so this is a curated standalone hub — it reuses the phase-hub
// presentational suite (hero + interactive lesson browser) over a hand-picked
// lesson set, then features the relevant DeepLearning.AI courses as external
// resources. The scraped transcripts are NOT shown here — they remain private
// chat-retrieval grounding; this page only links out to the courses.

const CATEGORY = "Long-Term Memory";

// Curated, roadmap-ordered. Cross-phase (Phase 4 agents/context + Phase 5
// LangChain memory). Filtered against real lessons, so unknown slugs are
// silently dropped rather than 404-ing.
const MEMORY_SLUGS = [
  "agent-memory",
  "memory",
  "memory-architectures",
  "context-engineering",
  "context-window-management",
  "dynamic-context-assembly",
  "context-compression",
  "langmem-vectorize-memory",
];

const META: CategoryMeta = {
  slug: "memory",
  icon: "🧠",
  description:
    "Give agents durable recall — semantic, episodic and procedural memory, context-window engineering, and long-term memory stores that survive across sessions.",
  gradient: ["var(--amber-9)", "var(--amber-11)"],
  outcomes: [
    "Distinguish semantic vs episodic vs procedural memory and when each applies",
    "Engineer the context window: compression, dynamic assembly, windowing",
    "Persist long-term memory with vector + metadata stores (e.g. LangMem)",
  ],
};

export const metadata: Metadata = {
  title: "Long-Term Memory for AI Agents — AI Engineering",
  description:
    "A focused track on agent memory: semantic/episodic/procedural memory, context engineering, and long-term memory stores — plus the best DeepLearning.AI courses on the topic.",
};

export default async function MemoryHubPage() {
  const all = await getAllLessons();
  const order = new Map(MEMORY_SLUGS.map((s, i) => [s, i]));
  const articles: Lesson[] = all
    .filter((l) => order.has(l.slug))
    .sort((a, b) => order.get(a.slug)! - order.get(b.slug)!);

  const totalMinutes = Math.round(
    articles.reduce((sum, a) => sum + a.readingTimeMin, 0),
  );
  const corpusWords = all.reduce((sum, l) => sum + l.wordCount, 0);

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
    "--cat-from": META.gradient[0],
    "--cat-to": META.gradient[1],
  } as CSSProperties;

  return (
    <div style={gradientVars}>
      <Topbar lessonCount={all.length} />

      <PhaseHero
        category={CATEGORY}
        meta={META}
        lessonCount={articles.length}
        totalMinutes={totalMinutes}
        categoryHref="/#cat-phase-4-agents"
      />

      <PhaseBrowser
        lessons={articles}
        heading="Memory lessons across the roadmap"
        gradient={META.gradient}
        icon={META.icon}
        category={CATEGORY}
      />

      <ExternalCourses courses={dlCourses} />

      <Footer wordCount={corpusWords} />
    </div>
  );
}
