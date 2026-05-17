import React from "react";
import type { LessonGridProps } from "@/components/phase-hub/types";
import { LessonCard } from "../LessonCard";
import styles from "./LessonGrid.module.css";

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export const LessonGrid = React.forwardRef<HTMLElement, LessonGridProps>(
  function LessonGrid(
    { lessons, progressBySlug, audioBySlug, heading, className },
    ref
  ) {
    return (
      <section ref={ref} className={cx(styles.section, className)}>
        {heading ? <div className={styles.heading}>{heading}</div> : null}

        {lessons.length === 0 ? (
          <div className={styles.empty}>No lessons match your filters.</div>
        ) : (
          <div className={styles.grid}>
            {lessons.map((lesson) => (
              <LessonCard
                key={lesson.slug}
                lesson={lesson}
                progressPercent={progressBySlug?.[lesson.slug]}
                audio={
                  audioBySlug
                    ? audioBySlug[lesson.slug] ?? null
                    : undefined
                }
              />
            ))}
          </div>
        )}
      </section>
    );
  }
);

LessonGrid.displayName = "LessonGrid";
