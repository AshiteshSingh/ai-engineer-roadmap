import Link from "next/link";
import type { Lesson, CategoryMeta } from "@/lib/articles";
import { cx } from "@/components/ui";
import styles from "./related-lessons.module.css";

interface Props {
  lessons: Lesson[];
  meta: CategoryMeta;
}

export function RelatedLessons({ lessons, meta }: Props) {
  if (lessons.length === 0) return null;

  return (
    <div className={styles.relatedSection}>
      <div className={styles.heading}>Continue Learning</div>
      <div className={styles.grid}>
        {lessons.map((l) => (
          <Link
            key={l.slug}
            href={l.url}
            className={cx(styles.card, `cat-${meta.slug}`)}
          >
            <span className={styles.cardNum}>
              #{String(l.number).padStart(2, "0")}
            </span>
            <span className={styles.cardTitle}>{l.title}</span>
            <div className={styles.cardMeta}>
              <span className="badge-pill badge-pill--glass">
                ~{l.readingTimeMin} min
              </span>
              <span className="badge-pill badge-pill--category">
                {meta.icon} {l.category}
              </span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
