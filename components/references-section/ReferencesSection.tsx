import React from "react";
import type { PhaseReference } from "@/lib/references";
import styles from "./ReferencesSection.module.css";

export interface ReferencesSectionProps {
  references: PhaseReference[];
  /** Section label above the list. */
  heading?: string;
  /** When true, applies a centered max-width container — use for standalone
   *  placement (e.g. the /rag phase hub, a sibling of PhaseBrowser). Omit
   *  when rendered inside an already-constrained column (the lesson page),
   *  so it aligns with RelatedLessons / ExternalCourses. */
  contained?: boolean;
  className?: string;
}

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/**
 * ReferencesSection — server-safe, presentational. Renders a divider-headed
 * grid of external "further reading" cards. Each card links out in a new
 * tab. Returns null when there are no references, so callers can render it
 * unconditionally behind a data lookup without leaking empty DOM.
 */
export const ReferencesSection = React.forwardRef<
  HTMLElement,
  ReferencesSectionProps
>(function ReferencesSection(
  {
    references,
    heading = "References & further reading",
    contained,
    className,
  },
  ref,
) {
  if (references.length === 0) return null;

  return (
    <section
      ref={ref}
      className={cx(
        styles.section,
        contained && styles.contained,
        className,
      )}
      aria-label={heading}
    >
      <div className={styles.heading}>{heading}</div>
      <ul className={styles.list}>
        {references.map((r) => (
          <li key={r.url} className={styles.item}>
            <a
              className={styles.link}
              href={r.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              <span className={styles.title}>{r.title}</span>
              <span className={styles.source}>{r.source}</span>
            </a>
            <p className={styles.description}>{r.description}</p>
          </li>
        ))}
      </ul>
    </section>
  );
});

ReferencesSection.displayName = "ReferencesSection";
