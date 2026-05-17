import { getGroupedLessons } from "@/lib/data";
import { Topbar } from "@/components/topbar";
import { LearningPath } from "@/components/learning-path";
import { Search } from "@/components/search";
import { Footer } from "@/components/footer";
import { ScrollReveal } from "@/components/scroll-reveal";
import { CategoryModalProvider } from "@/components/category-modal";

export default async function HomePage() {
  const groups = await getGroupedLessons();
  const allLessons = groups.flatMap((g) => g.articles);
  const total = allLessons.length;
  const wordCount = allLessons.reduce((sum, l) => sum + l.wordCount, 0);
  return (
    <div>
      <a href="#lessons" className="skip-link">Skip to lessons</a>
      <Topbar lessonCount={total} />

      <CategoryModalProvider groups={groups}>
      <main id="content">
      <ScrollReveal>
        <LearningPath groups={groups} />
      </ScrollReveal>

      {/* Search + Bento Grid */}
      <div id="lessons">
        <Search groups={groups} />
      </div>
      </main>

      <Footer wordCount={wordCount} />
      </CategoryModalProvider>
    </div>
  );
}
