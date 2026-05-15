"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Lesson, GroupedLessons } from "@/lib/articles";

/** Fill incomplete last row: if 1 leftover → full-width, if 2 → last spans 2 */
function cardClass(index: number, total: number): string {
  const remainder = total % 3;
  if (remainder === 1 && index === total - 1) return "cat-card cat-card--full";
  if (remainder === 2 && index === total - 1) return "cat-card cat-card--wide";
  return "cat-card";
}

function LessonCard({ lesson, isFirst }: { lesson: Lesson; isFirst?: boolean }) {
  const ref = useRef<HTMLAnchorElement>(null);

  const onMove = useCallback((e: React.MouseEvent) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5;
    const y = (e.clientY - rect.top) / rect.height - 0.5;
    el.style.transform = `perspective(600px) rotateY(${x * 8}deg) rotateX(${-y * 8}deg) scale(1.02)`;
  }, []);

  const onLeave = useCallback(() => {
    const el = ref.current;
    if (el) el.style.transform = "";
  }, []);

  return (
    <Link
      ref={ref}
      href={lesson.url}
      className="article-card"
      title={lesson.excerpt || undefined}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
    >
      <span className="article-card-num">
        {String(lesson.number).padStart(2, "0")}
      </span>
      {isFirst && <span className="article-card-start">Start here</span>}
      <span className="article-card-title">{lesson.title}</span>
      <span className={`article-card-level article-card-level--${lesson.difficulty}`}>
        {lesson.difficulty === "beginner" ? "Beginner" : lesson.difficulty === "intermediate" ? "Mid" : "Adv"}
      </span>
      <span className="article-card-time">{lesson.readingTimeMin}m</span>
      <span className="article-card-arrow">&rarr;</span>
    </Link>
  );
}

interface Props {
  groups: GroupedLessons[];
}

export function CategoryGrid({ groups }: Props) {
  const [activeSlug, setActiveSlug] = useState<string>("");

  useEffect(() => {
    const ids = groups.map((g) => `cat-${g.meta.slug}`);
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveSlug(entry.target.id);
          }
        }
      },
      { rootMargin: "-20% 0px -60% 0px", threshold: 0 },
    );
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [groups]);

  return (
    <>
      <div className="cat-nav" role="navigation" aria-label="Category navigation">
        {groups.map((g) => {
          const isActive = activeSlug === `cat-${g.meta.slug}`;
          return (
            <button
              key={g.category}
              className={`cat-nav-pill cat-${g.meta.slug}${isActive ? " cat-nav-pill--active" : ""}`}
              aria-pressed={isActive}
              onClick={() => {
                document.getElementById(`cat-${g.meta.slug}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
            >
              <span className="cat-nav-icon">{g.meta.icon}</span>
              {g.category}
              <span className="cat-nav-count">{g.articles.length}</span>
            </button>
          );
        })}
      </div>

      <div className="bento-grid">
        {groups.map((group, i) => (
          <div
            key={group.category}
            id={`cat-${group.meta.slug}`}
            className={`${cardClass(i, groups.length)} cat-${group.meta.slug}`}
          >
            <div className="cat-card-icon">{group.meta.icon}</div>
            <div className="cat-card-header">
              <span className="cat-card-name">{group.category}</span>
              <span className="cat-card-count">
                {group.articles.length} lesson{group.articles.length !== 1 ? "s" : ""}
              </span>
            </div>
            <div className="cat-card-desc">{group.meta.description}</div>
            {group.meta.outcomes && group.meta.outcomes.length > 0 && (
              <ul className="cat-card-outcomes">
                {group.meta.outcomes.map((o, k) => (
                  <li key={k}>{o}</li>
                ))}
              </ul>
            )}
            <div className="cat-card-divider" />
            {group.articles.map((lesson, j) => (
              <LessonCard key={lesson.slug} lesson={lesson} isFirst={j === 0} />
            ))}
            <div className="cat-card-footer">
              {Math.round(group.articles.reduce((sum, a) => sum + a.readingTimeMin, 0))} min total reading
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
