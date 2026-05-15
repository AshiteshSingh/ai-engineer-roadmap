import Link from "next/link";
import { getGroupedLessons } from "@/lib/data";
import { Topbar } from "@/components/topbar";
import { Hero } from "@/components/hero";
import { Search } from "@/components/search";
import { Footer } from "@/components/footer";
import { ScrollReveal } from "@/components/scroll-reveal";
import { RoadmapGraph } from "@/components/roadmap-graph";
import { buildRoadmapModel } from "@/lib/roadmap-flow";
import { Section, Eyebrow, Heading } from "@/components/ui";

export default async function HomePage() {
  const groups = await getGroupedLessons();
  const allLessons = groups.flatMap((g) => g.articles);
  const total = allLessons.length;
  const catCount = groups.length;
  const wordCount = allLessons.reduce((sum, l) => sum + l.wordCount, 0);
  const readingHours = Math.round(allLessons.reduce((sum, l) => sum + l.readingTimeMin, 0) / 60);
  const roadmapModel = buildRoadmapModel(groups);
  return (
    <div>
      <a href="#lessons" className="skip-link">Skip to lessons</a>
      <Topbar lessonCount={total} />

      <Hero lessonCount={total} domainCount={catCount} wordCount={wordCount} readingHours={readingHours} />

      <ScrollReveal delay={60}>
        <section className="roadmap-flow" aria-label="AI Engineer roadmap flow">
          <Section style={{ paddingBottom: 0 }}>
            <Eyebrow>The Path</Eyebrow>
            <Heading as="h2">AI Engineer Roadmap</Heading>
          </Section>
          <RoadmapGraph model={roadmapModel} />
        </section>
      </ScrollReveal>

      <main>
        {/* Research Collections */}
        <ScrollReveal delay={100}>
          <section className="research-collections">
            <h2 className="research-collections-title">Research Collections</h2>
            <div className="research-collections-grid">
              <Link href="/kv-quant" className="cat-card">
                <div className="cat-card-header">
                  <span className="cat-card-icon">🗜️</span>
                  <span className="cat-card-name">KV-Cache Quantization</span>
                </div>
                <p className="cat-card-desc">Research papers on quantizing key-value caches for efficient LLM inference — compression, pruning, and long-context methods.</p>
              </Link>
            </div>
          </section>
        </ScrollReveal>

        {/* Search + Bento Grid */}
        <div id="lessons">
          <Search groups={groups} />
        </div>
      </main>

      <Footer wordCount={wordCount} />
    </div>
  );
}
