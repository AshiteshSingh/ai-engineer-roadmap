import type { RagPodcast } from "@/lib/db/podcasts";

interface Props {
  episodes: RagPodcast[];
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** "2025-05-21" → "May 2025" (no Date parsing — releaseDate is already ISO). */
function formatDate(iso: string): string {
  const [y, m] = iso.split("-");
  const mi = Number(m) - 1;
  return mi >= 0 && mi < 12 ? `${MONTHS[mi]} ${y}` : y;
}

/**
 * RagPodcasts — phase-level "RAG Podcasts" rail for /rag. Link-out cards that
 * open the episode on Spotify in a new tab. Reuses the External-Courses CSS
 * (.courses-section / .course-card …) so it stays visually consistent and
 * adds no global CSS. Renders nothing when empty ⇒ hubs without seeded
 * podcasts stay byte-identical.
 */
export function RagPodcasts({ episodes }: Props) {
  if (episodes.length === 0) return null;

  return (
    <div className="courses-section">
      <div className="related-heading">RAG Podcasts</div>
      <div className="courses-grid">
        {episodes.map((ep) => (
          <a
            key={ep.id}
            href={ep.url}
            target="_blank"
            rel="noopener noreferrer"
            className="course-card"
          >
            <div className="course-card-header">
              <span className="course-provider-icon">🎙</span>
              <span className="course-provider-name">{ep.show}</span>
            </div>

            <div className="course-card-title">{ep.title}</div>

            {ep.description && (
              <p className="course-card-desc">{ep.description}</p>
            )}

            <div className="course-card-footer">
              <div className="course-card-badges">
                <span className="badge-pill badge-pill--glass">
                  ~{ep.durationMin} min
                </span>
                <span className="course-review-count">
                  {formatDate(ep.releaseDate)}
                </span>
                <span className="course-review-count">Spotify ↗</span>
              </div>
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}
