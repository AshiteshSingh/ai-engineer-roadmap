import Link from "next/link";
import type { Lesson } from "@/lib/articles";
import { cx } from "@/components/ui";
import styles from "./category-progress.module.css";

interface Props {
  categoryLessons: Lesson[];
  currentSlug: string;
  categoryName: string;
}

export function CategoryProgress({ categoryLessons, currentSlug, categoryName }: Props) {
  const currentIndex = categoryLessons.findIndex((l) => l.slug === currentSlug);
  if (currentIndex === -1) return null;

  return (
    <div className={styles.categoryProgress}>
      <span className={styles.label}>
        Lesson {currentIndex + 1} of {categoryLessons.length} in {categoryName}
      </span>
      <div className={styles.dots}>
        {categoryLessons.map((l) => (
          <Link
            key={l.slug}
            href={l.url}
            className={cx(styles.dot, l.slug === currentSlug && styles.dotCurrent)}
            title={l.title}
          />
        ))}
      </div>
    </div>
  );
}
