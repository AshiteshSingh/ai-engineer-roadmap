import Link from "next/link";
import type { Lesson, CategoryMeta } from "@/lib/articles";

interface Props {
  lessons: Lesson[];
  meta: CategoryMeta;
}

export function RelatedLessons({ lessons, meta }: Props) {
  if (lessons.length === 0) return null;

  return (
    <div className="related-section">
      <div className="related-heading">Continue Learning</div>
      <div className="related-grid">
        {lessons.map((l) => (
          <Link
            key={l.slug}
            href={l.url}
            className={`related-card cat-${meta.slug}`}
          >
            <span className="related-card-num">
              #{String(l.number).padStart(2, "0")}
            </span>
            <span className="related-card-title">{l.title}</span>
            <div className="related-card-meta">
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
