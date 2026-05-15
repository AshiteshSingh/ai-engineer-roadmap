import { notFound } from "next/navigation";
import Link from "next/link";
import { getGroupedLessons } from "@/lib/data";
import { Topbar } from "@/components/topbar";
import { Footer } from "@/components/footer";

export const metadata = {
  title: "Evals, Safety & Observability — AI Engineering",
  description:
    "Measure what matters and ship safely: evaluation fundamentals, LLM-as-judge, benchmarks, red-teaming, guardrails, online evaluation and observability.",
};

const PHASE_5_SLUG = "phase-5-evals";

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

  return (
    <div className={`cat-${meta.slug}`}>
      <Topbar lessonCount={total} />

      <div className="article-banner">
        <div className="article-banner-inner">
          <div className="article-banner-breadcrumb">
            <Link href="/">&larr; all lessons</Link>
            <span className="sep">/</span>
            <Link href={`/#cat-${meta.slug}`}>
              {meta.icon} {category}
            </Link>
          </div>
          <h1 className="article-banner-title">{category}</h1>
          {meta.description && (
            <p className="article-banner-excerpt">{meta.description}</p>
          )}
          {meta.outcomes && meta.outcomes.length > 0 && (
            <ul className="cat-card-outcomes">
              {meta.outcomes.map((o, k) => (
                <li key={k}>{o}</li>
              ))}
            </ul>
          )}
          <div className="article-banner-badges">
            <span className="badge-pill badge-pill--category">
              {meta.icon} {category}
            </span>
            <span className="badge-pill badge-pill--glass">
              {articles.length} lesson{articles.length !== 1 ? "s" : ""}
            </span>
            <span className="badge-pill badge-pill--glass">
              ~{minutes} min total reading
            </span>
          </div>
        </div>
      </div>

      <div className="article-grid">
        <div>
          <div className="related-section">
            <div className="related-heading">Lessons in this phase</div>
            <div className="related-grid">
              {articles.map((l) => (
                <Link
                  key={l.slug}
                  href={l.url}
                  className={`related-card cat-${meta.slug}`}
                  title={l.excerpt || undefined}
                >
                  <span className="related-card-num">
                    #{String(l.number).padStart(2, "0")}
                  </span>
                  <span className="related-card-title">{l.title}</span>
                  <div className="related-card-meta">
                    <span
                      className={`badge-pill badge-pill--difficulty badge-pill--${l.difficulty}`}
                    >
                      {l.difficulty === "beginner"
                        ? "Beginner"
                        : l.difficulty === "intermediate"
                          ? "Intermediate"
                          : "Advanced"}
                    </span>
                    <span className="badge-pill badge-pill--glass">
                      ~{l.readingTimeMin} min
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>

      <Footer wordCount={wordCount} />
    </div>
  );
}
