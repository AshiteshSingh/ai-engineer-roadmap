import Link from "next/link";
import type { Lesson, CategoryMeta } from "@/lib/articles";
import { cx } from "@/components/ui";
import styles from "./article-nav.module.css";

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
    <div className={styles.articleNav}>
      {prev ? (
        <Link
          href={prev.url}
          className={cx(styles.card, `cat-${pm.slug}`)}
          aria-label={prev ? `Previous lesson: ${prev.title}` : undefined}
        >
          <span className={styles.label}>&larr; Previous</span>
          <span className={styles.title}>{prev.title}</span>
          {currentCategory && prev.category !== currentCategory && (
            <span className={styles.transition}>
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
          className={cx(styles.card, styles.cardNext, `cat-${nm.slug}`)}
          aria-label={next ? `Next lesson: ${next.title}` : undefined}
        >
          <span className={styles.label}>Next &rarr;</span>
          <span className={styles.title}>{next.title}</span>
          {currentCategory && next.category !== currentCategory && (
            <span className={styles.transition}>
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
