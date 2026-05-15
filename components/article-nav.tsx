import Link from "next/link";
import type { Lesson, CategoryMeta } from "@/lib/articles";

interface Props {
  prev: Lesson | null;
  next: Lesson | null;
  currentCategory?: string;
  prevMeta?: CategoryMeta | null;
  nextMeta?: CategoryMeta | null;
}

const FALLBACK_META: CategoryMeta = { slug: "other", icon: "\u{1F4C4}", description: "", gradient: ["var(--indigo-9)", "var(--indigo-11)"] };

export function ArticleNav({ prev, next, currentCategory, prevMeta, nextMeta }: Props) {
  if (!prev && !next) return null;

  const pm = prevMeta ?? FALLBACK_META;
  const nm = nextMeta ?? FALLBACK_META;

  return (
    <div className="article-nav">
      {prev ? (
        <Link
          href={prev.url}
          className={`article-nav-card cat-${pm.slug}`}
          aria-label={prev ? `Previous lesson: ${prev.title}` : undefined}
        >
          <span className="article-nav-label">&larr; Previous</span>
          <span className="article-nav-title">{prev.title}</span>
          {currentCategory && prev.category !== currentCategory && (
            <span className="article-nav-transition">
              From: {pm.icon} {prev.category}
            </span>
          )}
        </Link>
      ) : (
        <div />
      )}
      {next ? (
        <Link
          href={next.url}
          className={`article-nav-card article-nav-card--next cat-${nm.slug}`}
          aria-label={next ? `Next lesson: ${next.title}` : undefined}
        >
          <span className="article-nav-label">Next &rarr;</span>
          <span className="article-nav-title">{next.title}</span>
          {currentCategory && next.category !== currentCategory && (
            <span className="article-nav-transition">
              Up next: {nm.icon} {next.category}
            </span>
          )}
        </Link>
      ) : (
        <div />
      )}
    </div>
  );
}
