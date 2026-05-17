"use client";

import { useCallback, useRef } from "react";
import Link from "next/link";
import type { Lesson, GroupedLessons } from "@/lib/articles";

/** Fill incomplete last row: if 1 leftover → full-width, if 2 → last spans 2.
 *  The base .cat-card classes are owned by HP-TEAM-6; identity gradient comes
 *  from the .cat-<slug> class applied alongside. */
function cardClass(index: number, total: number): string {
  const remainder = total % 3;
  if (remainder === 1 && index === total - 1) return "cat-card cat-card--full";
  if (remainder === 2 && index === total - 1) return "cat-card cat-card--wide";
  return "cat-card";
}

function diffLabel(d: Lesson["difficulty"]): string {
  return d === "beginner" ? "Beginner" : d === "intermediate" ? "Mid" : "Adv";
}

function LessonCard({ lesson, isFirst, pos }: { lesson: Lesson; isFirst?: boolean; pos: number }) {
  const ref = useRef<HTMLAnchorElement>(null);

  const onMove = useCallback((e: React.MouseEvent) => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const rect = el.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    el.style.setProperty("--cat-mx", `${x * 100}%`);
  }, []);

  return (
    <Link
      ref={ref}
      href={lesson.url}
      className="cat-row"
      title={lesson.excerpt || undefined}
      onMouseMove={onMove}
    >
      <span className="cat-row-num">
        {String(pos).padStart(2, "0")}
      </span>
      <span className="cat-row-body">
        <span className="cat-row-title">{lesson.title}</span>
        <span className="cat-row-meta">
          <span className={`cat-row-level cat-row-level--${lesson.difficulty}`}>
            {diffLabel(lesson.difficulty)}
          </span>
          <span className="cat-row-time">{lesson.readingTimeMin}m read</span>
          {isFirst && <span className="cat-row-start">Start here</span>}
        </span>
      </span>
      <span className="cat-row-arrow" aria-hidden="true">&rarr;</span>
    </Link>
  );
}

interface Props {
  groups: GroupedLessons[];
}

export function CategoryGrid({ groups }: Props) {
  return (
    <>
      <div className="bento-grid">
        {groups.map((group, i) => {
          const totalMin = Math.round(
            group.articles.reduce((sum, a) => sum + a.readingTimeMin, 0),
          );
          const beginnerCount = group.articles.filter(
            (a) => a.difficulty === "beginner",
          ).length;
          return (
            <section
              key={group.category}
              id={`cat-${group.meta.slug}`}
              className={`${cardClass(i, groups.length)} cat-${group.meta.slug}`}
              aria-labelledby={`cat-${group.meta.slug}-title`}
            >
              <span className="cat-card-rail" aria-hidden="true" />
              <span className="cat-card-aura" aria-hidden="true" />

              <header className="cat-card-top">
                <span className="cat-card-icon" aria-hidden="true">
                  {group.meta.icon}
                </span>
                <span className="cat-card-head">
                  <span
                    className="cat-card-name"
                    id={`cat-${group.meta.slug}-title`}
                  >
                    {group.category}
                  </span>
                  <span className="cat-card-stats">
                    <span className="cat-card-count">
                      {group.articles.length} lesson
                      {group.articles.length !== 1 ? "s" : ""}
                    </span>
                    <span className="cat-card-dot" aria-hidden="true">&middot;</span>
                    <span className="cat-card-mins">{totalMin} min</span>
                  </span>
                </span>
              </header>

              <p className="cat-card-desc">{group.meta.description}</p>

              {group.meta.outcomes && group.meta.outcomes.length > 0 && (
                <ul className="cat-card-outcomes">
                  {group.meta.outcomes.map((o, k) => (
                    <li key={k}>{o}</li>
                  ))}
                </ul>
              )}

              <div className="cat-card-divider" role="presentation">
                <span className="cat-card-divider-label">
                  {group.articles.length} lesson
                  {group.articles.length !== 1 ? "s" : ""}
                </span>
              </div>

              <div className="cat-card-list">
                {group.articles.map((lesson, j) => (
                  <LessonCard
                    key={lesson.slug}
                    lesson={lesson}
                    isFirst={j === 0}
                    pos={j + 1}
                  />
                ))}
              </div>

              <footer className="cat-card-footer">
                <span className="cat-card-footer-time">
                  {totalMin} min total reading
                </span>
                {beginnerCount > 0 && (
                  <span className="cat-card-footer-tag">
                    {beginnerCount} beginner-friendly
                  </span>
                )}
              </footer>
            </section>
          );
        })}
      </div>
    </>
  );
}
