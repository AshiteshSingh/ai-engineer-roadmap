import type { ExternalCourse } from "@/lib/db/queries";

type CourseWithReview = ExternalCourse & {
  review?: {
    aggregateScore: number | null;
    verdict: string | null;
  } | null;
};

interface Props {
  courses: CourseWithReview[];
}

function StarRating({ rating }: { rating: number }) {
  const full = Math.floor(rating);
  const half = rating - full >= 0.5;
  const stars = [];
  for (let i = 0; i < 5; i++) {
    if (i < full) stars.push("full");
    else if (i === full && half) stars.push("half");
    else stars.push("empty");
  }
  return (
    <span className="course-stars" aria-label={`${rating} out of 5`}>
      {stars.map((t, i) => (
        <span key={i} className={`course-star course-star--${t}`}>★</span>
      ))}
    </span>
  );
}

function ExpertBadge({ score, verdict }: { score: number; verdict: string }) {
  const color = verdict === 'excellent' ? 'var(--green-9)'
    : verdict === 'recommended' ? 'var(--blue-9)'
    : verdict === 'average' ? 'var(--amber-9)'
    : 'var(--red-9)';
  return (
    <span className="course-expert-badge" style={{ color }}>
      AI {score.toFixed(1)}★
    </span>
  );
}

function ProviderIcon({ provider }: { provider: string }) {
  const p = provider.toLowerCase();
  if (p.includes("coursera")) return <span className="course-provider-icon">🎓</span>;
  if (p.includes("edx") || p.includes("mit") || p.includes("stanford") || p.includes("harvard")) return <span className="course-provider-icon">🏛</span>;
  if (p.includes("deeplearning") || p.includes("deeplearning.ai")) return <span className="course-provider-icon">🧠</span>;
  if (p.includes("udemy")) return <span className="course-provider-icon">📚</span>;
  if (p.includes("google")) return <span className="course-provider-icon">☁</span>;
  if (p.includes("amazon") || p.includes("aws")) return <span className="course-provider-icon">⚡</span>;
  if (p.includes("microsoft") || p.includes("azure")) return <span className="course-provider-icon">🪟</span>;
  if (p.includes("datacamp")) return <span className="course-provider-icon">📊</span>;
  return <span className="course-provider-icon">🎯</span>;
}

export function ExternalCourses({ courses }: Props) {
  if (courses.length === 0) return null;

  return (
    <div className="courses-section">
      <div className="related-heading">Further Learning</div>
      <div className="courses-grid">
        {courses.map((c) => (
          <a
            key={c.id}
            href={c.url}
            target="_blank"
            rel="noopener noreferrer"
            className="course-card"
          >
            <div className="course-card-header">
              <ProviderIcon provider={c.provider} />
              <span className="course-provider-name">{c.provider}</span>
              {c.isFree && <span className="badge-pill badge-pill--free">Free</span>}
              {c.review?.aggregateScore != null && c.review.verdict && (
                <ExpertBadge score={c.review.aggregateScore} verdict={c.review.verdict} />
              )}
            </div>

            <div className="course-card-title">{c.title}</div>

            {c.description && (
              <p className="course-card-desc">{c.description}</p>
            )}

            <div className="course-card-footer">
              {c.rating != null && (
                <span className="course-rating">
                  <StarRating rating={c.rating} />
                  <span className="course-rating-num">{c.rating.toFixed(1)}</span>
                  {c.reviewCount != null && (
                    <span className="course-review-count">
                      ({c.reviewCount.toLocaleString()})
                    </span>
                  )}
                </span>
              )}
              <div className="course-card-badges">
                {c.level && (
                  <span className={`badge-pill badge-pill--level badge-pill--${c.level.toLowerCase()}`}>
                    {c.level}
                  </span>
                )}
                {c.durationHours != null && (
                  <span className="badge-pill badge-pill--glass">
                    ~{c.durationHours < 10
                      ? `${c.durationHours}h`
                      : `${Math.round(c.durationHours)}h`}
                  </span>
                )}
              </div>
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}
