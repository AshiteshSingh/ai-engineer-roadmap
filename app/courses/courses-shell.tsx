"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import type { ExternalCourse } from "@/lib/db/queries";

/* ── Star rating (partial-fill) ──────────────────────────────── */
function StarRating({ rating }: { rating: number }) {
  const full = Math.floor(rating);
  const frac = rating - full;
  return (
    <span className="course-stars" aria-label={`${rating} out of 5`}>
      {Array.from({ length: 5 }, (_, i) => {
        if (i < full) return <span key={i} className="course-star course-star--full">&#9733;</span>;
        if (i === full && frac >= 0.25) {
          const pct = Math.round(frac * 100);
          return (
            <span key={i} className="course-star course-star--partial" style={{ "--fill": `${pct}%` } as React.CSSProperties}>
              &#9733;
            </span>
          );
        }
        return <span key={i} className="course-star course-star--empty">&#9733;</span>;
      })}
    </span>
  );
}

/* ── Course card (Udemy-style with thumbnail) ────────────────── */
function CourseCard({ course }: { course: ExternalCourse }) {
  const meta = (course.metadata ?? {}) as Record<string, unknown>;
  const instructors = Array.isArray(meta.instructors) ? meta.instructors as string[] : [];
  const instructor = instructors[0] ?? null;
  const isBestseller = (course.rating ?? 0) >= 4.5 && (course.reviewCount ?? 0) >= 1000;

  return (
    <a
      href={course.url}
      target="_blank"
      rel="noopener noreferrer"
      className="course-card"
    >
      {/* Thumbnail */}
      <div className="course-card-thumb">
        {course.imageUrl ? (
          <img src={course.imageUrl} alt="" loading="lazy" />
        ) : (
          <div className="course-card-thumb-fallback" />
        )}
      </div>

      {/* Body */}
      <div className="course-card-body">
        <h3 className="course-card-title">{course.title}</h3>

        {instructor && (
          <p className="course-card-instructor">{instructor}</p>
        )}

        {course.rating != null && (
          <div className="course-rating">
            <span className="course-rating-num">{course.rating.toFixed(1)}</span>
            <StarRating rating={course.rating} />
            {course.reviewCount != null && (
              <span className="course-review-count">
                ({course.reviewCount.toLocaleString()})
              </span>
            )}
          </div>
        )}

        <div className="course-card-price-row">
          {course.isFree ? (
            <span className="course-price course-price--free">Free</span>
          ) : (
            <span className="course-price">Paid</span>
          )}
          {course.durationHours != null && (
            <span className="course-card-duration">
              {course.durationHours < 10
                ? `${course.durationHours}h total`
                : `${Math.round(course.durationHours)}h total`}
            </span>
          )}
        </div>

        <div className="course-card-meta-row">
          {isBestseller && (
            <span className="course-badge-bestseller">Bestseller</span>
          )}
          {course.enrolled != null && course.enrolled > 0 && (
            <span className="course-card-enrolled">
              {course.enrolled.toLocaleString()} students
            </span>
          )}
          {course.level && (
            <span className={`course-badge-level course-badge-level--${course.level.toLowerCase()}`}>
              {course.level}
            </span>
          )}
        </div>
      </div>
    </a>
  );
}

/* ── Course group section ────────────────────────────────────── */
function CourseGroup({
  name,
  courses,
}: {
  name: string;
  courses: ExternalCourse[];
}) {
  return (
    <section className="courses-group">
      <div className="courses-group-header">
        <h2 className="courses-group-title">{name}</h2>
        <span className="courses-group-count">{courses.length} courses</span>
      </div>
      <div className="courses-group-grid">
        {courses.map((c) => (
          <CourseCard key={c.id} course={c} />
        ))}
      </div>
    </section>
  );
}

/* ── Slug helper ─────────────────────────────────────────────── */
function slugify(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

/* ── Main shell (client) ─────────────────────────────────────── */
export function CoursesShell({
  groups,
  total,
}: {
  groups: { name: string; courses: ExternalCourse[] }[];
  total: number;
}) {
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const sectionRefs = useRef<Map<string, HTMLElement>>(new Map());
  const tabsRef = useRef<HTMLElement>(null);
  const isScrolling = useRef(false);

  /* Set first tab active on mount */
  useEffect(() => {
    if (groups.length > 0 && !activeTab) {
      setActiveTab(slugify(groups[0].name));
    }
  }, [groups, activeTab]);

  /* Observe which section is in view */
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (isScrolling.current) return;
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveTab(entry.target.id);
            break;
          }
        }
      },
      { rootMargin: "-120px 0px -60% 0px", threshold: 0 },
    );

    for (const el of sectionRefs.current.values()) {
      observer.observe(el);
    }
    return () => observer.disconnect();
  }, [groups]);

  /* Scroll active tab pill into view within the nav */
  useEffect(() => {
    if (!activeTab || !tabsRef.current) return;
    const btn = tabsRef.current.querySelector<HTMLButtonElement>(
      `[data-tab="${activeTab}"]`,
    );
    if (btn) {
      btn.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    }
  }, [activeTab]);

  const handleTabClick = useCallback((slug: string) => {
    setActiveTab(slug);
    const el = sectionRefs.current.get(slug);
    if (!el) return;
    isScrolling.current = true;
    const top = el.getBoundingClientRect().top + window.scrollY - 110;
    window.scrollTo({ top, behavior: "smooth" });
    setTimeout(() => {
      isScrolling.current = false;
    }, 800);
  }, []);

  const refCallback = useCallback(
    (slug: string) => (el: HTMLElement | null) => {
      if (el) sectionRefs.current.set(slug, el);
      else sectionRefs.current.delete(slug);
    },
    [],
  );

  return (
    <>
      {/* ── Sticky tab bar ─────────────────────────────────────── */}
      <nav ref={tabsRef} className="courses-tabs" aria-label="Topic groups">
        <div className="courses-tabs-inner">
          {groups.map((g) => {
            const slug = slugify(g.name);
            return (
              <button
                key={slug}
                data-tab={slug}
                className={`courses-tab${activeTab === slug ? " courses-tab--active" : ""}`}
                onClick={() => handleTabClick(slug)}
                type="button"
              >
                {g.name}
                <span className="courses-tab-count">{g.courses.length}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* ── Page body ──────────────────────────────────────────── */}
      <div className="courses-body">
        <div className="courses-page-header">
          <h1 className="courses-page-title">Courses</h1>
          <p className="courses-page-subtitle">
            {total} courses across {groups.length} topics — curated from Udemy
          </p>
        </div>

        {groups.map((g) => {
          const slug = slugify(g.name);
          return (
            <div key={slug} ref={refCallback(slug)} id={slug}>
              <CourseGroup name={g.name} courses={g.courses} />
            </div>
          );
        })}
      </div>
    </>
  );
}
