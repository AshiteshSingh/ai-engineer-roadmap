"use client";

// Primary CTA above the lesson grid: an Audible-style "continue listening"
// card that starts (or resumes) the continuous Web-Speech playthrough of the
// WHOLE phase (all chapters of all lessons, in order). Three states off the
// hub-audio context: resume (cover + where-you-left-off + progress bar),
// idle/never-played (start listening), and playing. Renders nothing when the
// phase has no narration scripts. Phase-name agnostic (shared component).
import * as React from "react";
import { useHubAudio } from "./HubAudioProvider";
import styles from "./PhasePlayAll.module.css";

function fmt(secs: number): string {
  const m = Math.round(secs / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export interface PhasePlayAllProps {
  /** Human phase name for the CTA copy — never hardcode (shared component). */
  phaseName?: string;
  /** Phase cover glyph (matches the docked player's cover tile). */
  icon?: string;
}

export function PhasePlayAll({
  phaseName = "this phase",
  icon,
}: PhasePlayAllProps) {
  const { hasAudio, status, playPhase, totalSecs, resumeInfo, supported } =
    useHubAudio();

  if (!hasAudio) return null;

  const playing = status !== "idle";
  const resuming = !playing && !!resumeInfo;

  let eyebrow: string;
  let title: string;
  let sub: string;
  let ariaLabel: string;

  if (playing) {
    eyebrow = `Now playing · ${phaseName}`;
    title = `Playing ${phaseName}…`;
    sub = "narrated end to end · auto-advances every chapter";
    ariaLabel = `Playing ${phaseName}`;
  } else if (resuming && resumeInfo) {
    eyebrow = `Resume · ${phaseName}`;
    title = resumeInfo.lessonTitle;
    sub = `Chapter ${resumeInfo.chapterIdx + 1} of ${resumeInfo.chapterCount}`;
    ariaLabel = `Resume ${phaseName} — ${resumeInfo.lessonTitle}, chapter ${
      resumeInfo.chapterIdx + 1
    } of ${resumeInfo.chapterCount}`;
  } else {
    eyebrow = `Listen · ${phaseName}`;
    title = "Start listening";
    sub = supported
      ? `${totalSecs ? `≈ ${fmt(totalSecs)} · ` : ""}narrated end to end · auto-advances every chapter`
      : "read-along transcript · your browser has no speech voice";
    ariaLabel = `Play all of ${phaseName} from the start`;
  }

  return (
    <div className={styles.wrap}>
      <button
        type="button"
        className={styles.cta}
        onClick={playPhase}
        disabled={playing}
        aria-label={ariaLabel}
      >
        <span className={styles.cover} aria-hidden="true">
          <span className={styles.coverIcon}>{icon ?? "🎧"}</span>
          <span className={styles.coverGlyph}>{playing ? "🎧" : "▶"}</span>
        </span>
        <span className={styles.body}>
          <span className={styles.eyebrow}>{eyebrow}</span>
          <span className={styles.title}>{title}</span>
          <span className={styles.sub}>{sub}</span>
          {resuming && resumeInfo ? (
            <span className={styles.progress}>
              <span
                className={styles.track}
                style={
                  {
                    "--progress": `${resumeInfo.percent}%`,
                  } as React.CSSProperties
                }
              >
                <span className={styles.fill} />
              </span>
              <span className={styles.meta}>
                {resumeInfo.percent}% · {fmt(resumeInfo.remainingSecs)} left
              </span>
            </span>
          ) : null}
        </span>
      </button>
    </div>
  );
}

PhasePlayAll.displayName = "PhasePlayAll";
