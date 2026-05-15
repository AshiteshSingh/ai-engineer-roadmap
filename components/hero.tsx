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

  return (
    <section className="hero" aria-label="Course overview">
      <div className="hero-glow" />
      <div className="hero-grid-bg" />
      <div className="hero-content">
        <p className="hero-kicker">From Zero to AI Engineer</p>
        <h1 className="hero-title">
          Your Deep-Dive into{" "}
          <span className="hero-title-accent">AI Engineering</span>
        </h1>
        <p className="hero-subtitle">
          {lessonCount} hands-on lessons across {domainCount} skill areas
          — {wordLabel} words of practical knowledge covering evals, RAG, agents,
          fine-tuning, prompting &amp; production AI systems. Built for junior
          engineers ready to go deep.
        </p>
        <AnimatedStats
          lessonCount={lessonCount}
          domainCount={domainCount}
          readingHours={readingHours}
          wordLabel={wordLabel}
          wordCount={wordCount}
        />
        <a href="#lessons" className="hero-cta">
          Start Learning <span className="hero-cta-arrow">↓</span>
        </a>
      </div>
      <div className="hero-bottom-line" />
    </section>
  );
}
