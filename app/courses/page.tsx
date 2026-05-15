import { Topbar } from "@/components/topbar";
import { getAllUdemyCoursesByGroup, TOPIC_GROUP_ORDER } from "@/lib/db/queries";
import type { ExternalCourse } from "@/lib/db/queries";

export const metadata = {
  title: "AI/ML Courses — Udemy",
  description: "Curated Udemy courses on generative AI, RAG, deep learning, MLOps, and more — grouped by topic.",
};

export const dynamic = "force-dynamic";

function StarRating({ rating }: { rating: number }) {
  const full = Math.floor(rating);
  const half = rating - full >= 0.5;
  return (
    <span className="course-stars" aria-label={`${rating} out of 5`}>
      {Array.from({ length: 5 }, (_, i) => {
        const type = i < full ? "full" : i === full && half ? "half" : "empty";
        return <span key={i} className={`course-star course-star--${type}`}>★</span>;
      })}
    </span>
  );
}

function CourseCard({ course }: { course: ExternalCourse }) {
  return (
    <a
      href={course.url}
      target="_blank"
      rel="noopener noreferrer"
      className="course-card"
    >
      <div className="course-card-header">
        <span className="course-provider-icon">📚</span>
        <span className="course-provider-name">Udemy</span>
        {course.isFree && <span className="badge-pill badge-pill--free">Free</span>}
      </div>

      <div className="course-card-title">{course.title}</div>

      {course.description && (
        <p className="course-card-desc">{course.description}</p>
      )}

      <div className="course-card-footer">
        {course.rating != null && (
          <span className="course-rating">
            <StarRating rating={course.rating} />
            <span className="course-rating-num">{course.rating.toFixed(1)}</span>
            {course.reviewCount != null && (
              <span className="course-review-count">
                ({course.reviewCount.toLocaleString()})
              </span>
            )}
          </span>
        )}
        <div className="course-card-badges">
          {course.level && (
            <span className={`badge-pill badge-pill--level badge-pill--${course.level.toLowerCase()}`}>
              {course.level}
            </span>
          )}
          {course.durationHours != null && (
            <span className="badge-pill badge-pill--glass">
              ~{course.durationHours < 10
                ? `${course.durationHours}h`
                : `${Math.round(course.durationHours)}h`}
            </span>
          )}
        </div>
      </div>
    </a>
  );
}

function CourseGroup({ name, courses }: { name: string; courses: ExternalCourse[] }) {
  return (
    <section className="courses-group">
      <div className="courses-group-header">
        <h2 className="courses-group-title">{name}</h2>
        <span className="courses-group-count">{courses.length}</span>
      </div>
      <div className="courses-group-grid">
        {courses.map((c) => (
          <CourseCard key={c.id} course={c} />
        ))}
      </div>
    </section>
  );
}

export default async function CoursesPage() {
  const grouped = await getAllUdemyCoursesByGroup();

  const orderedGroups = [
    ...TOPIC_GROUP_ORDER.filter((g) => grouped[g]?.length),
    ...Object.keys(grouped).filter((g) => !TOPIC_GROUP_ORDER.includes(g as never) && grouped[g]?.length),
  ];

  const total = Object.values(grouped).reduce((sum, arr) => sum + arr.length, 0);

  return (
    <>
      <Topbar />
      <main className="courses-page">
        <div className="courses-page-header">
          <h1 className="courses-page-title">AI/ML Courses on Udemy</h1>
          <p className="courses-page-subtitle">
            {total} courses across {orderedGroups.length} topic groups
          </p>
        </div>

        {orderedGroups.length === 0 ? (
          <p style={{ color: "var(--gray-9)", fontSize: "0.875rem" }}>
            No courses yet — run <code>pnpm scrape:udemy</code> to populate.
          </p>
        ) : (
          orderedGroups.map((group) => (
            <CourseGroup key={group} name={group} courses={grouped[group]} />
          ))
        )}
      </main>
    </>
  );
}
