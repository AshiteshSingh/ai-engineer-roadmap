import { concepts, steps, courses, getCourseStats } from "@/lib/langgraph-data";
import type { LangGraphCourse } from "@/lib/langgraph-data";

function StarRating({ rating }: { rating: number }) {
  const full = Math.floor(rating);
  const half = rating - full >= 0.5;
  return (
    <span className="course-stars" aria-label={`${rating} out of 5`}>
      {Array.from({ length: 5 }, (_, i) => {
        const type = i < full ? "full" : i === full && half ? "half" : "empty";
        return (
          <span key={i} className={`course-star course-star--${type}`}>
            ★
          </span>
        );
      })}
    </span>
  );
}

function CourseCard({ course }: { course: LangGraphCourse }) {
  return (
    <a
      href={course.url}
      target="_blank"
      rel="noopener noreferrer"
      className="lg-course-card"
    >
      <div className="lg-course-top">
        <div className="course-card-header">
          <span className="course-provider-icon">📚</span>
          <span className="course-provider-name">Udemy</span>
          {course.tags.map((t) => (
            <span key={t} className="lg-tag">
              {t}
            </span>
          ))}
        </div>
        <div className="course-card-title">{course.title}</div>
        <p className="course-card-desc">{course.headline}</p>
        <div className="lg-course-instructor">
          {course.instructor}
          <span className="lg-course-instructor-title">
            {course.instructorTitle}
          </span>
        </div>
      </div>

      <div className="lg-course-learn">
        <span className="lg-course-learn-heading">What you'll learn</span>
        <ul className="lg-course-learn-list">
          {course.whatYouLearn.slice(0, 4).map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      </div>

      <div className="lg-course-bottom">
        <div className="lg-course-metrics">
          <span className="course-rating">
            <StarRating rating={course.rating} />
            <span className="course-rating-num">
              {course.rating.toFixed(1)}
            </span>
            <span className="course-review-count">
              ({course.reviewCount.toLocaleString()})
            </span>
          </span>
          <span className="lg-course-students">
            {course.numStudents.toLocaleString()} students
          </span>
        </div>
        <div className="course-card-badges">
          <span
            className={`badge-pill badge-pill--level badge-pill--${course.level.toLowerCase().replace(/\s+/g, "-")}`}
          >
            {course.level}
          </span>
          <span className="badge-pill badge-pill--glass">
            {course.numLectures} lectures
          </span>
          <span className="badge-pill badge-pill--glass">
            ~
            {course.durationHours < 10
              ? `${course.durationHours}h`
              : `${Math.round(course.durationHours)}h`}
          </span>
          <span className="badge-pill badge-pill--glass">
            Updated {course.lastUpdated}
          </span>
        </div>
      </div>
    </a>
  );
}

export function LangGraphExtra() {
  const stats = getCourseStats();

  return (
    <>
      {/* Core Concepts */}
      <section className="lg-section">
        <div className="lg-section-header">
          <h2 className="lg-section-title">Core Concepts</h2>
          <span className="se-topic-count">{concepts.length}</span>
        </div>
        <div className="lg-concepts-grid">
          {concepts.map((c) => (
            <div key={c.id} className="lg-concept-card">
              <span className="lg-concept-icon">{c.icon}</span>
              <h3 className="lg-concept-name">{c.name}</h3>
              <p className="lg-concept-desc">{c.description}</p>
              <ul className="lg-concept-details">
                {c.details.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* How It Works */}
      <section className="lg-section">
        <h2 className="lg-section-title">How It Works</h2>
        <div className="lg-flow">
          {steps.map((s) => (
            <div key={s.num} className="lg-flow-step">
              <span className="lg-flow-num">{s.num}</span>
              <div className="lg-flow-body">
                <h3 className="lg-flow-title">{s.title}</h3>
                <p className="lg-flow-desc">{s.description}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Recommended Courses */}
      <section className="lg-section">
        <div className="lg-section-header">
          <h2 className="lg-section-title">Recommended Udemy Courses</h2>
          <span className="se-topic-count">{stats.courseCount} courses</span>
        </div>
        <p className="lg-prose" style={{ marginBottom: 20 }}>
          {(stats.totalStudents / 1000).toFixed(0)}K+ students enrolled across{" "}
          {stats.courseCount} courses, averaging {stats.avgRating} stars from{" "}
          {(stats.totalReviews / 1000).toFixed(0)}K+ reviews.
        </p>
        <div className="lg-courses-grid">
          {courses.map((c) => (
            <CourseCard key={c.id} course={c} />
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="lg-cta-section">
        <div className="lg-cta-card">
          <h2>See LangGraph in Action</h2>
          <p>
            Explore a production healthcare agent built with LangGraph — 9
            pipeline stages, ReactFlow architecture diagrams, research papers,
            code snippets, and deep dives into retrieval, safety guardrails, and
            evaluation.
          </p>
          <a
            href="https://agentic-healthcare.vercel.app/how-it-works"
            target="_blank"
            rel="noopener noreferrer"
            className="lg-cta-btn"
          >
            Explore the Healthcare Agent Architecture
            <span className="lg-cta-arrow">→</span>
          </a>
        </div>
      </section>
    </>
  );
}
