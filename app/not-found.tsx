import Link from "next/link";
import { Topbar } from "@/components/topbar";
import { getAllLessons, getGroupedLessons } from "@/lib/data";
import { Footer } from "@/components/footer";

export default async function NotFound() {
  const [allLessons, groups] = await Promise.all([
    getAllLessons(),
    getGroupedLessons(),
  ]);
  const suggested = allLessons.slice(0, 6);

  return (
    <div>
      <Topbar lessonCount={allLessons.length} />

      <div className="not-found-page">
        <div className="not-found-code">404</div>
        <h1 className="not-found-title">Topic not available yet</h1>
        <p className="not-found-desc">
          This topic hasn&apos;t been added to the curriculum yet.
          Explore the existing lessons or browse by category below.
        </p>

        <Link href="/#lessons" className="hero-cta" style={{ marginBottom: 32 }}>
          Browse all lessons
        </Link>

        <div className="not-found-section-title">Suggested Lessons</div>
        <div className="not-found-suggestions">
          {suggested.map((l) => (
            <Link key={l.slug} href={`/${l.slug}`} className="not-found-suggestion">
              <span className="not-found-suggestion-num">
                #{String(l.number).padStart(2, "0")}
              </span>
              <span className="not-found-suggestion-title">{l.title}</span>
              <span className="not-found-suggestion-time">{l.readingTimeMin}m</span>
            </Link>
          ))}
        </div>

        <div className="not-found-section-title">Categories</div>
        <div className="not-found-cats">
          {groups.map((g) => (
            <Link
              key={g.category}
              href={`/#cat-${g.meta.slug}`}
              className={`not-found-cat cat-${g.meta.slug}`}
            >
              <span>{g.meta.icon}</span>
              <span>{g.category}</span>
              <span className="not-found-cat-count">{g.articles.length}</span>
            </Link>
          ))}
        </div>
      </div>

      <Footer />
    </div>
  );
}
