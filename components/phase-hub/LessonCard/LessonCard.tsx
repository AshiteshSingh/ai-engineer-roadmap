import React from "react";
import Link from "next/link";
import { DIFFICULTY_LABEL } from "@/components/phase-hub/types";
import type { LessonCardProps } from "@/components/phase-hub/types";
import { ListenButton } from "./ListenButton";
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
  function LessonCard({ lesson, progressPercent, audio, className }, ref) {
    const hasProgress = typeof progressPercent === "number";
    const clamped = hasProgress
      ? Math.max(0, Math.min(100, progressPercent as number))
      : 0;
    // tri-state: undefined = audio feature off (no tile at all).
    const showListen = audio !== undefined;

    return (
      <article className={cx(styles.card, className)}>
        {/* Stretched link: the whole card stays clickable (the ::after in
            CSS covers it) without nesting a <button> inside an <a>. */}
        <Link ref={ref} href={lesson.url} className={styles.cardLink}>
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

        {showListen ? (
          <ListenButton audio={audio ?? null} title={lesson.title} />
        ) : null}
      </article>
    );
  }
);

LessonCard.displayName = "LessonCard";
