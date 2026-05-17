import * as React from "react";
import Link from "next/link";
import type { PhaseHeroProps } from "@/components/phase-hub/types";
import styles from "./PhaseHero.module.css";

/** Local, dependency-free class joiner (mirrors components/ui/cx). */
function cx(...a: (string | false | null | undefined)[]): string {
  return a.filter(Boolean).join(" ");
}

/**
 * PhaseHero — presentational, server-safe hero/banner for a phase hub page.
 *
 * Renders a breadcrumb, title, optional excerpt, optional learning outcomes,
 * and a row of metadata badges. No client interactivity.
 */
export const PhaseHero = React.forwardRef<HTMLElement, PhaseHeroProps>(
  function PhaseHero(
    {
      category,
      meta,
      lessonCount,
      totalMinutes,
      categoryHref,
      className,
    },
    ref,
  ) {
    const [from, to] = meta.gradient;
    const lessonLabel = `${lessonCount} ${lessonCount === 1 ? "lesson" : "lessons"}`;
    const outcomes = meta.outcomes ?? [];

    // Bind the category gradient endpoints to the local token aliases the
    // module CSS reads (with safe Radix-scale fallbacks).
    const gradientStyle = {
      "--cat-from": from,
      "--cat-to": to,
    } as React.CSSProperties;

    return (
      <header
        ref={ref}
        className={cx(styles.hero, className)}
        style={gradientStyle}
      >
        <div className={styles.inner}>
          <nav className={styles.crumb} aria-label="Breadcrumb">
            <Link className={styles.crumbLink} href="/">
              ← all lessons
            </Link>
            <span className={styles.sep} aria-hidden="true">
              /
            </span>
            <Link className={styles.crumbLink} href={categoryHref}>
              {meta.icon} {category}
            </Link>
          </nav>

          <h1 className={styles.title}>{category}</h1>

          {meta.description ? (
            <p className={styles.excerpt}>{meta.description}</p>
          ) : null}

          {outcomes.length > 0 ? (
            <ul className={styles.outcomes}>
              {outcomes.map((outcome) => (
                <li key={outcome} className={styles.outcome}>
                  {outcome}
                </li>
              ))}
            </ul>
          ) : null}

          <div className={styles.badges}>
            <span className={cx(styles.pill, styles.pillCategory)}>
              {meta.icon} {category}
            </span>
            <span className={cx(styles.pill, styles.pillGlass)}>
              {lessonLabel}
            </span>
            <span className={cx(styles.pill, styles.pillGlass)}>
              ~{totalMinutes} min total reading
            </span>
          </div>
        </div>
      </header>
    );
  },
);

PhaseHero.displayName = "PhaseHero";
