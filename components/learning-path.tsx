import type { GroupedLessons } from "@/lib/articles";

interface Props {
  groups: GroupedLessons[];
}

const DIFFICULTY_RANK: Record<string, number> = {
  beginner: 0,
  intermediate: 1,
  advanced: 2,
};
const DIFFICULTY_LABEL: Record<string, string> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
};

export function LearningPath({ groups }: Props) {
  return (
    <nav aria-label="Learning path" className="lp">
      <header className="lp-head">
        <p className="lp-eyebrow">The Expedition</p>
        <h2 className="lp-headline">Climb the AI engineering stack</h2>
        <p className="lp-sub">
          {groups.length} milestones, sequenced from fundamentals to production
          systems. Follow the rail or jump to any station.
        </p>
      </header>

      <ol className="lp-rail">
        {groups.map((g, i) => {
          const mins = g.articles.reduce((a, l) => a + l.readingTimeMin, 0);
          const hardest = g.articles.reduce((max, l) => {
            const r = DIFFICULTY_RANK[l.difficulty] ?? 0;
            return r > max ? r : max;
          }, 0);
          const level =
            (Object.keys(DIFFICULTY_RANK) as string[]).find(
              (k) => DIFFICULTY_RANK[k] === hardest,
            ) ?? "beginner";
          const preview = g.articles.slice(0, 3);
          const rest = g.articles.length - preview.length;

          return (
            <li
              key={g.category}
              className={`lp-station cat-${g.meta.slug}`}
              style={{ ["--lp-i" as string]: i }}
            >
              <div className="lp-node" aria-hidden="true">
                <span className="lp-node-num">
                  {String(i + 1).padStart(2, "0")}
                </span>
              </div>

              <a href={`#cat-${g.meta.slug}`} className="lp-card">
                <div className="lp-card-top">
                  <span className="lp-icon" aria-hidden="true">
                    {g.meta.icon}
                  </span>
                  <span className="lp-phase">Milestone {i + 1}</span>
                  <span
                    className="lp-level"
                    data-level={level}
                    title={`Peak difficulty: ${DIFFICULTY_LABEL[level]}`}
                  >
                    {DIFFICULTY_LABEL[level]}
                  </span>
                </div>

                <h3 className="lp-title">{g.category}</h3>
                <p className="lp-desc">{g.meta.description}</p>

                <ul className="lp-lessons">
                  {preview.map((l) => (
                    <li key={l.slug} className="lp-lesson">
                      <span className="lp-lesson-n">
                        {String(l.number).padStart(2, "0")}
                      </span>
                      <span className="lp-lesson-t">{l.title}</span>
                    </li>
                  ))}
                  {rest > 0 && (
                    <li className="lp-lesson lp-lesson--more">
                      <span className="lp-lesson-n">+</span>
                      <span className="lp-lesson-t">
                        {rest} more {rest === 1 ? "lesson" : "lessons"}
                      </span>
                    </li>
                  )}
                </ul>

                <div className="lp-card-foot">
                  <span className="lp-meta">
                    {g.articles.length} lessons &middot; {mins}m
                  </span>
                  <span className="lp-go">
                    Enter station
                    <span className="lp-go-arrow" aria-hidden="true">
                      &rarr;
                    </span>
                  </span>
                </div>
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
