"use client";

// Primary CTA above the lesson grid: start the continuous Web-Speech
// playthrough of the WHOLE phase (all chapters of all lessons, in order).
// Resumes from the saved position if there is one. Renders nothing when the
// phase has no narration scripts.
import * as React from "react";
import { useHubAudio } from "./HubAudioProvider";
import styles from "./PhasePlayAll.module.css";

function fmt(secs: number): string {
  const m = Math.round(secs / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function PhasePlayAll() {
  const { hasAudio, status, playPhase, totalSecs, savedPos, supported } =
    useHubAudio();

  if (!hasAudio) return null;

  const playing = status !== "idle";
  const resuming = !!savedPos;
  const label = playing
    ? "Playing the RAG phase…"
    : resuming
      ? "Resume the RAG phase"
      : "Play the whole RAG phase";

  return (
    <div className={styles.wrap}>
      <button
        type="button"
        className={styles.cta}
        onClick={playPhase}
        disabled={playing}
        aria-label={label}
      >
        <span className={styles.icon} aria-hidden="true">
          {playing ? "🎧" : "▶"}
        </span>
        <span className={styles.text}>
          <span className={styles.title}>{label}</span>
          <span className={styles.meta}>
            {supported
              ? `${totalSecs ? `≈ ${fmt(totalSecs)} · ` : ""}narrated end to end · auto-advances every chapter`
              : "read-along transcript · your browser has no speech voice"}
          </span>
        </span>
      </button>
    </div>
  );
}

PhasePlayAll.displayName = "PhasePlayAll";
