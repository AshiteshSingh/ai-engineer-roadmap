import Link from "next/link";
import { CATEGORIES, CATEGORY_META } from "@/lib/articles";

export function Footer({ wordCount }: { wordCount?: number }) {
  const year = new Date().getFullYear();
  const lessonCount = CATEGORIES.reduce((sum, [lo, hi]) => sum + (hi - lo + 1), 0);
  const categoryCount = CATEGORIES.length;
  const wordLabel = wordCount && wordCount >= 1000
    ? `${Math.round(wordCount / 1000)}K+`
    : wordCount ? String(wordCount) : "451K+";

  return (
    <footer className="site-footer">
      <div className="footer-gradient-border" />

      <div className="footer-columns">
        {/* Left: Brand */}
        <div className="footer-brand-col">
          <div className="footer-brand">
            <span className="footer-brand-dot" />
            <span className="footer-brand-title">AI Engineering</span>
          </div>
          <p className="footer-tagline">
            A deep-dive learning path for junior AI engineers — by Vadim Nicolai
          </p>
          <p className="footer-built-with">Built with Next.js &amp; Radix UI</p>
        </div>

        {/* Center: Skill Areas */}
        <div className="footer-links-col">
          <h3 className="footer-col-heading">Skill Areas</h3>
          <div className="footer-cats">
            {CATEGORIES.map(([, , name]) => {
              const meta = CATEGORY_META[name];
              if (!meta) return null;
              return (
                <Link
                  key={name}
                  href={`/#cat-${meta.slug}`}
                  className="footer-cat-link"
                >
                  <span>{meta.icon}</span> {name}
                </Link>
              );
            })}
          </div>
        </div>

        {/* Right: Stats */}
        <div className="footer-stats-col">
          <h3 className="footer-col-heading">By the Numbers</h3>
          <ul className="footer-stats-list">
            <li className="footer-stat">
              <span className="footer-stat-value">{lessonCount}</span>
              <span className="footer-stat-label">Lessons</span>
            </li>
            <li className="footer-stat">
              <span className="footer-stat-value">{categoryCount}</span>
              <span className="footer-stat-label">Skill Areas</span>
            </li>
            <li className="footer-stat">
              <span className="footer-stat-value">{wordLabel}</span>
              <span className="footer-stat-label">Words</span>
            </li>
          </ul>
        </div>
      </div>

      <div className="footer-bottom">
        <span>&copy; {year} All rights reserved.</span>
      </div>
    </footer>
  );
}
