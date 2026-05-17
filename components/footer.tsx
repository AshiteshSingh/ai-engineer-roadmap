import Link from "next/link";
import { CATEGORIES, CATEGORY_META } from "@/lib/articles";
import { cx } from "@/components/ui";
import styles from "./footer.module.css";

export function Footer({ wordCount }: { wordCount?: number }) {
  const year = new Date().getFullYear();
  const lessonCount = CATEGORIES.reduce((sum, [lo, hi]) => sum + (hi - lo + 1), 0);
  const categoryCount = CATEGORIES.length;
  const wordLabel = wordCount && wordCount >= 1000
    ? `${Math.round(wordCount / 1000)}K+`
    : wordCount ? String(wordCount) : "451K+";

  const stats: { value: string; label: string }[] = [
    { value: String(lessonCount), label: "Lessons" },
    { value: String(categoryCount), label: "Skill areas" },
    { value: wordLabel, label: "Words written" },
  ];

  return (
    <footer className="ftr">
      <div className="ftr-rule" aria-hidden="true" />

      {/* ── Marquee call-to-action ───────────────────────────── */}
      <div className="ftr-cta">
        <div className="ftr-cta-text">
          <span className="ftr-eyebrow">The roadmap</span>
          <h2 className="ftr-headline">
            Become an AI engineer,
            <br />
            <span className="ftr-headline-accent">one lesson at a time.</span>
          </h2>
        </div>
        <Link
          href="/#cat-phase-1-models"
          className={cx("ftr-cta-btn", styles.cta)}
        >
          <span>Start the path</span>
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path
              d="M3 8h9M8.5 4l4 4-4 4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </Link>
      </div>

      {/* ── Stat strip ───────────────────────────────────────── */}
      <div className="ftr-stats" role="list">
        {stats.map((s) => (
          <div className="ftr-stat" role="listitem" key={s.label}>
            <span className="ftr-stat-value">{s.value}</span>
            <span className="ftr-stat-label">{s.label}</span>
          </div>
        ))}
      </div>

      {/* ── Main grid ────────────────────────────────────────── */}
      <div className="ftr-grid">
        <div className="ftr-brand-col">
          <div className="ftr-brand">
            <span className="ftr-brand-mark" aria-hidden="true" />
            <span className="ftr-brand-name">AI Engineering</span>
          </div>
          <p className="ftr-tagline">
            A deep-dive learning path for junior AI engineers — crafted by Vadim
            Nicolai.
          </p>
          <p className="ftr-built">Built with Next.js &amp; Radix UI</p>
        </div>

        <nav className="ftr-nav" aria-label="Skill areas">
          <h3 className="ftr-nav-heading">Skill areas</h3>
          <ul className="ftr-nav-list">
            {CATEGORIES.map(([, , name]) => {
              const meta = CATEGORY_META[name];
              if (!meta) return null;
              return (
                <li key={name}>
                  <Link
                    href={`/#cat-${meta.slug}`}
                    className={cx(`ftr-nav-link cat-${meta.slug}`, styles.navLink)}
                  >
                    <span className="ftr-nav-dot" aria-hidden="true" />
                    <span className="ftr-nav-icon" aria-hidden="true">
                      {meta.icon}
                    </span>
                    <span className="ftr-nav-label">{name}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>

      {/* ── Bottom bar ───────────────────────────────────────── */}
      <div className="ftr-bottom">
        <span className="ftr-copy">
          &copy; {year} AI Engineering. All rights reserved.
        </span>
        <span className="ftr-sig">
          <span className="ftr-sig-pulse" aria-hidden="true" />
          Always learning
        </span>
      </div>
    </footer>
  );
}
