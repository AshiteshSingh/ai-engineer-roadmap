"use client";

// Audible-style row: a rounded gradient "cover" tile + a "Listen · N min"
// label. Clicking docks the lesson in the shared bottom player (no nav).
// When this lesson is the active one the tile shows a Now-playing equalizer
// (read-only — transport lives in the player bar). `audio === null` ⇒ a
// dimmed, disabled "Narration coming soon" tile.
import * as React from "react";
import { useHubAudio } from "@/components/phase-hub/HubAudio";
import { cx } from "@/components/ui";
import type { AudioMeta } from "@/components/phase-hub/types";
import styles from "./LessonCard.module.css";

function PlayGlyph() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M8 5.14v14.72a1 1 0 001.5.86l11-7.36a1 1 0 000-1.72l-11-7.36A1 1 0 008 5.14z" />
    </svg>
  );
}

export function ListenButton({
  audio,
  title,
}: {
  audio: AudioMeta | null;
  title: string;
}) {
  const { activeSlug, play } = useHubAudio();

  if (!audio) {
    return (
      <div className={styles.listenRow}>
        <button
          type="button"
          className={cx(styles.coverTile, styles.coverTileDisabled)}
          disabled
          aria-label={`Narration coming soon for ${title}`}
          title="Narration coming soon"
        >
          <PlayGlyph />
        </button>
        <span className={styles.listenLabel}>Narration coming soon</span>
      </div>
    );
  }

  const minutes = Math.max(1, Math.round(audio.duration_secs / 60));
  const isActive = activeSlug === audio.slug;

  return (
    <div className={styles.listenRow}>
      <button
        type="button"
        className={cx(styles.coverTile, isActive && styles.coverTileActive)}
        onClick={(e) => {
          // Don't let the stretched card link fire.
          e.preventDefault();
          e.stopPropagation();
          play(audio);
        }}
        aria-label={
          isActive ? `Now playing: ${title}` : `Listen to ${title}`
        }
        aria-pressed={isActive}
      >
        {isActive ? (
          <span className={styles.eq} aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        ) : (
          <PlayGlyph />
        )}
      </button>
      <span className={styles.listenLabel}>
        {isActive ? "Now playing" : `Listen · ${minutes} min`}
      </span>
    </div>
  );
}

ListenButton.displayName = "ListenButton";
