import React from "react";
import Link from "next/link";
import { DIFFICULTY_LABEL } from "@/components/phase-hub/types";
import type { LessonCardProps } from "@/components/phase-hub/types";
import styles from "./LessonCard.module.css";

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

const DIFFICULTY_CLASS: Record<
  "beginner" | "intermediate" | "advanced",
  string
> = {
  beginner: styles.beginner,
  intermediate: styles.intermediate,
  advanced: styles.advanced,
};

export const LessonCard = React.forwardRef<HTMLAnchorElement, LessonCardProps>(
  function LessonCard({ lesson, progressPercent, className }, ref) {
    const hasProgress = typeof progressPercent === "number";
    const clamped = hasProgress
      ? Math.max(0, Math.min(100, progressPercent as number))
      : 0;

    return (
      <Link
        ref={ref}
        href={lesson.url}
        className={cx(styles.card, className)}
      >
        <span className={styles.num}>
          #{String(lesson.number).padStart(2, "0")}
        </span>

        <span className={styles.title}>{lesson.title}</span>

        <div className={styles.meta}>
          <span
            className={cx(
              styles.badge,
              styles.badgeDifficulty,
              DIFFICULTY_CLASS[lesson.difficulty]
            )}
          >
            {DIFFICULTY_LABEL[lesson.difficulty]}
          </span>
          <span className={cx(styles.badge, styles.glass)}>
            ~{lesson.readingTimeMin} min
          </span>
        </div>

        {hasProgress ? (
          <div className={styles.progress} aria-hidden="true">
            <div
              className={styles.progressFill}
              style={{ width: `${clamped}%` }}
            />
          </div>
        ) : null}
      </Link>
    );
  }
);

LessonCard.displayName = "LessonCard";
