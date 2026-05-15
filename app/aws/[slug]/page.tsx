import { notFound } from "next/navigation";
import Link from "next/link";
import { getAllLessons, getLessonBySlug, getCategoryMeta, getRelatedLessons, getCoursesForLesson, getAudioMeta, AWS_DEEP_DIVE_SLUGS } from "@/lib/data";
import { Topbar } from "@/components/topbar";
import { MarkdownProse } from "@/components/markdown-prose";
import { TableOfContents } from "@/components/toc";
import { ReadingProgress } from "@/components/reading-progress";
import { ScrollToTop } from "@/components/scroll-to-top";
import { ArticleNav } from "@/components/article-nav";
import { CategoryProgress } from "@/components/category-progress";
import { RelatedLessons } from "@/components/related-lessons";
import { ExternalCourses } from "@/components/external-courses";
import { PageAnalytics } from "@/components/page-analytics";
import { AudioPlayer } from "@/components/audio-player";

// Maps URL sub-slug (e.g. "lambda-serverless") back to file slug (e.g. "aws-lambda-serverless")
function resolveFileSlug(urlSlug: string): string {
  if (AWS_DEEP_DIVE_SLUGS.has(`aws-${urlSlug}`)) return `aws-${urlSlug}`;
  if (AWS_DEEP_DIVE_SLUGS.has(urlSlug)) return urlSlug;
  return `aws-${urlSlug}`;
}

export async function generateStaticParams() {
  return [...AWS_DEEP_DIVE_SLUGS].map((fileSlug) => ({
    slug: fileSlug.startsWith("aws-") ? fileSlug.slice(4) : fileSlug,
  }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const lesson = await getLessonBySlug(resolveFileSlug(slug));
  return { title: lesson ? `${lesson.title} — AI Engineering` : "Not Found" };
}

export default async function AwsDeepDivePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const fileSlug = resolveFileSlug(slug);

  const [lesson, allLessons] = await Promise.all([
    getLessonBySlug(fileSlug),
    getAllLessons(),
  ]);
  if (!lesson) notFound();

  const idx = allLessons.findIndex((l) => l.slug === fileSlug);
  const prev = idx > 0 ? allLessons[idx - 1] : null;
  const next = idx < allLessons.length - 1 ? allLessons[idx + 1] : null;
  const total = allLessons.length;
  const categoryLessons = allLessons.filter((l) => l.category === lesson.category);
  const catIdx = categoryLessons.findIndex((l) => l.slug === fileSlug);
  const prerequisite = catIdx > 0 ? categoryLessons[catIdx - 1] : null;

  const [meta, related, courses, audioMeta, prevMeta, nextMeta] = await Promise.all([
    getCategoryMeta(lesson.category),
    getRelatedLessons(fileSlug),
    getCoursesForLesson(fileSlug),
    getAudioMeta(lesson.fileSlug),
    prev ? getCategoryMeta(prev.category) : Promise.resolve(null),
    next ? getCategoryMeta(next.category) : Promise.resolve(null),
  ]);

  return (
    <div className={`cat-${meta.slug}${audioMeta ? " has-audio-player" : ""}`}>
      <ReadingProgress />
      <Topbar lessonCount={total} />

      <div className="article-banner">
        <div className="article-banner-inner">
          <div className="article-banner-breadcrumb">
            <Link href="/">&larr; all lessons</Link>
            <span className="sep">/</span>
            <Link href="/aws">{meta.icon} AWS Deep Dives</Link>
            <span className="sep">/</span>
            <span>#{String(lesson.number).padStart(2, "0")}</span>
          </div>
          <CategoryProgress categoryLessons={categoryLessons} currentSlug={fileSlug} categoryName={lesson.category} />
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
          {prerequisite && (
            <div className="article-prereq">
              <span className="article-prereq-label">Recommended prerequisite:</span>
              <Link href={prerequisite.url} className="article-prereq-link">
                #{String(prerequisite.number).padStart(2, "0")} {prerequisite.title}
              </Link>
            </div>
          )}
        </div>
      </div>

      <div className="article-grid">
        <div>
          <MarkdownProse content={lesson.content} />
          <RelatedLessons lessons={related} meta={meta} />
          <ExternalCourses courses={courses} />
          <ArticleNav prev={prev} next={next} currentCategory={lesson.category} prevMeta={prevMeta} nextMeta={nextMeta} />
        </div>
        <TableOfContents markdown={lesson.content} />
      </div>

      <PageAnalytics lessonSlug={fileSlug} />
      {audioMeta && <AudioPlayer meta={audioMeta} />}
      <ScrollToTop />
    </div>
  );
}
