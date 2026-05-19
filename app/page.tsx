import type { GroupedLessons } from "@/lib/data";
import { getGroupedLessons } from "@/lib/data";
import { memoryGroup } from "@/lib/memory-hub";
import { Topbar } from "@/components/topbar";
import { LearningPath } from "@/components/learning-path";
import { Footer } from "@/components/footer";
import { ScrollReveal } from "@/components/scroll-reveal";
import { CategoryModalProvider } from "@/components/category-modal";

/** Place the synthetic Memory card after the last core "Phase N" group and
 *  before the first "Appendix ·" group; append if there are no appendices.
 *  Core phase 1–7 station numbers are unaffected. */
function insertBeforeAppendix(
  groups: GroupedLessons[],
  group: GroupedLessons,
): GroupedLessons[] {
  const at = groups.findIndex((g) => g.category.startsWith("Appendix"));
  if (at === -1) return [...groups, group];
  return [...groups.slice(0, at), group, ...groups.slice(at)];
}

export default async function HomePage() {
  const groups = await getGroupedLessons();
  // Totals come from the REAL groups: the Memory card reuses lessons that
  // already live in Phase 4/5, so counting `gridGroups` would double-count.
  const allLessons = groups.flatMap((g) => g.articles);
  const total = allLessons.length;
  const wordCount = allLessons.reduce((sum, l) => sum + l.wordCount, 0);

  const mg = memoryGroup(allLessons);
  const gridGroups = mg ? insertBeforeAppendix(groups, mg) : groups;
  return (
    <div>
      <a href="#content" className="skip-link">Skip to content</a>
      <Topbar lessonCount={total} />

      <CategoryModalProvider groups={gridGroups}>
      <main id="content">
      <ScrollReveal>
        <LearningPath groups={gridGroups} />
      </ScrollReveal>
      </main>

      <Footer wordCount={wordCount} />
      </CategoryModalProvider>
    </div>
  );
}
