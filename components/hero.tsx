import { AnimatedStats } from "./animated-stats";

export function Hero({
  lessonCount,
  domainCount,
  wordCount,
  readingHours,
}: {
  lessonCount: number;
  domainCount: number;
  wordCount: number;
  readingHours: number;
}) {
  const wordLabel =
    wordCount >= 1000 ? `${Math.round(wordCount / 1000)}K+` : String(wordCount);

  const topics = [
    "Evals",
    "RAG",
    "Agents",
    "Fine-tuning",
    "Prompting",
    "Production",
  ];

  return (
    <section className="hx" aria-label="Course overview">
      <div className="hx-aura" aria-hidden="true" />
      <div className="hx-grid">
        <div className="hx-lede">
          <p className="hx-kicker">
            <span className="hx-kicker-dot" aria-hidden="true" />
            From Zero to AI Engineer
          </p>

          <h1 className="hx-title">
            Your deep-dive into
            <span className="hx-title-accent"> AI&nbsp;Engineering</span>
          </h1>

          <p className="hx-subtitle">
            {lessonCount} hands-on lessons across {domainCount} skill areas —{" "}
            {wordLabel} words of practical knowledge, built for junior engineers
            ready to go deep.
          </p>

          <ul className="hx-topics" aria-label="Topics covered">
            {topics.map((t) => (
              <li key={t} className="hx-topic">
                {t}
              </li>
            ))}
          </ul>

          <div className="hx-actions">
            <a href="#lessons" className="hx-cta">
              Start Learning
              <span className="hx-cta-arrow" aria-hidden="true">
                ↓
              </span>
            </a>
            <a href="#lessons" className="hx-cta-ghost">
              Browse the curriculum
            </a>
          </div>
        </div>

        <div className="hx-panel" aria-hidden={false}>
          <div className="hx-panel-head">
            <span className="hx-panel-tag">The Roadmap</span>
            <span className="hx-panel-sub">at a glance</span>
          </div>
          <AnimatedStats
            lessonCount={lessonCount}
            domainCount={domainCount}
            readingHours={readingHours}
            wordLabel={wordLabel}
            wordCount={wordCount}
          />
        </div>
      </div>
    </section>
  );
}
