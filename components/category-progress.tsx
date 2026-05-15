import Link from "next/link";
import type { Lesson } from "@/lib/articles";

interface Props {
  categoryLessons: Lesson[];
  currentSlug: string;
  categoryName: string;
}

export function CategoryProgress({ categoryLessons, currentSlug, categoryName }: Props) {
  const currentIndex = categoryLessons.findIndex((l) => l.slug === currentSlug);
  if (currentIndex === -1) return null;

  return (
    <div className="category-progress">
      <span className="category-progress-label">
        Lesson {currentIndex + 1} of {categoryLessons.length} in {categoryName}
      </span>
      <div className="category-progress-dots">
        {categoryLessons.map((l) => (
          <Link
            key={l.slug}
            href={l.url}
            className={`category-progress-dot${l.slug === currentSlug ? " category-progress-dot--current" : ""}`}
            title={l.title}
          />
        ))}
      </div>
    </div>
  );
}
