import { notFound } from "next/navigation";
import Link from "next/link";
import { getAllLessons, getLessonBySlug, getCategoryMeta, getAudioMeta } from "@/lib/data";
import { Topbar } from "@/components/topbar";
import { MarkdownProse } from "@/components/markdown-prose";
import { TableOfContents } from "@/components/toc";
import { ReadingProgress } from "@/components/reading-progress";
import { ScrollToTop } from "@/components/scroll-to-top";
import { ArticleNav } from "@/components/article-nav";
import { CategoryProgress } from "@/components/category-progress";
import { PageAnalytics } from "@/components/page-analytics";
import { AudioPlayer } from "@/components/audio-player";

export const metadata = { title: "AWS — AI Engineering" };

export default async function AwsHubPage() {
  const [lesson, allLessons] = await Promise.all([
    getLessonBySlug("aws"),
    getAllLessons(),
  ]);
  if (!lesson) notFound();

  const idx = allLessons.findIndex((l) => l.slug === "aws");
  const prev = idx > 0 ? allLessons[idx - 1] : null;
  const next = idx < allLessons.length - 1 ? allLessons[idx + 1] : null;
  const total = allLessons.length;
  const categoryLessons = allLessons.filter((l) => l.category === lesson.category);
  const awsDeepDives = allLessons.filter((l) => l.category === "AWS Deep Dives");

  const [meta, prevMeta, nextMeta] = await Promise.all([
    getCategoryMeta(lesson.category),
    prev ? getCategoryMeta(prev.category) : Promise.resolve(null),
    next ? getCategoryMeta(next.category) : Promise.resolve(null),
  ]);
  const audioMeta = await getAudioMeta(lesson.fileSlug);

  return (
    <div className={`cat-${meta.slug}${audioMeta ? " has-audio-player" : ""}`}>
      <ReadingProgress />
      <Topbar lessonCount={total} />

      <div className="article-banner">
        <div className="article-banner-inner">
          <div className="article-banner-breadcrumb">
            <Link href="/">&larr; all lessons</Link>
            <span className="sep">/</span>
            <Link href={`/#cat-${meta.slug}`}>{meta.icon} {lesson.category}</Link>
            <span className="sep">/</span>
            <span>#{String(lesson.number).padStart(2, "0")}</span>
          </div>
          <CategoryProgress categoryLessons={categoryLessons} currentSlug="aws" categoryName={lesson.category} />
          <h1 className="article-banner-title">{lesson.title}</h1>
          {lesson.excerpt && <p className="article-banner-excerpt">{lesson.excerpt}</p>}
          <div className="article-banner-badges">
            <span className="badge-pill badge-pill--category">{meta.icon} {lesson.category}</span>
            <span className={`badge-pill badge-pill--difficulty badge-pill--${lesson.difficulty}`}>
              {lesson.difficulty === "beginner" ? "Beginner" : lesson.difficulty === "intermediate" ? "Intermediate" : "Advanced"}
            </span>
            <span className="badge-pill badge-pill--glass">~{lesson.readingTimeMin} min read</span>
            {audioMeta && (
              <span className="badge-pill badge-pill--glass">
                ~{Math.round(audioMeta.duration_secs / 60)} min listen
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="article-grid">
        <div>
          <MarkdownProse content={lesson.content} />

          {awsDeepDives.length > 0 && (
            <div className="related-section">
              <div className="related-heading">AWS Deep Dives</div>
              <div className="related-grid">
                {awsDeepDives.map((l) => (
                  <Link key={l.slug} href={l.url} className="related-card cat-aws-deep-dives">
                    <span className="related-card-num">#{String(l.number).padStart(2, "0")}</span>
                    <span className="related-card-title">{l.title}</span>
                    <div className="related-card-meta">
                      <span className="badge-pill badge-pill--glass">~{l.readingTimeMin} min</span>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}

          <ArticleNav prev={prev} next={next} currentCategory={lesson.category} prevMeta={prevMeta} nextMeta={nextMeta} />
        </div>
        <TableOfContents markdown={lesson.content} />
      </div>

      <PageAnalytics lessonSlug="aws" />
      {audioMeta && <AudioPlayer meta={audioMeta} />}
      <ScrollToTop />
    </div>
  );
}
