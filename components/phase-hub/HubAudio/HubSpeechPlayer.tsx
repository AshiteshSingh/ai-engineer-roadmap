"use client";

// Docked bottom bar for the hub's continuous Web-Speech playthrough. Reads
// the live SpeechQueue and renders: now-playing (lesson · chapter), transport
// (prev/next lesson + chapter, play/pause), rate, close, and a synced
// transcript panel that highlights and auto-scrolls the spoken sentence.
import * as React from "react";
import { cx } from "@/components/ui";
import type { SpeechQueue } from "./useSpeechQueue";
import { SPEECH_RATES } from "./useSpeechQueue";
import styles from "./HubSpeechPlayer.module.css";

function Glyph({ d }: { d: string }) {
  // Single canonical size; CSS adds `display:block` so the SVG has no inline
  // baseline gap and centres identically in every button.
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}
// One consistent, optically-centred icon family (mirror-paired so the row
// reads evenly). Chapter skip = bar + single triangle; lesson skip = double
// triangle (visually distinct from a chapter jump).
const PLAY = "M8 5v14l11-7z";
const PAUSE = "M6 5h4v14H6zm8 0h4v14h-4z";
const PREV = "M7 6h2v12H7zM16 6v12l-8-6z";
const NEXT = "M8 6l8 6-8 6V6zM15 6h2v12h-2z";
const PREVLESSON = "M11 6 3 12l8 6V6zM20 6l-8 6 8 6V6z";
const NEXTLESSON = "M4 6l8 6-8 6V6zM13 6l8 6-8 6V6z";
const CLOSE =
  "M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z";

export function HubSpeechPlayer({
  queue,
  icon,
}: {
  queue: SpeechQueue;
  icon?: string;
}) {
  const { state, lessons, controls } = queue;
  const [showText, setShowText] = React.useState(true);
  const activeRef = React.useRef<HTMLLIElement | null>(null);

  const lesson = lessons[state.lessonIdx];
  const chapter = lesson?.chapters[state.chapterIdx];

  // Auto-scroll the spoken sentence into view as it advances.
  React.useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [state.sentenceIdx, state.chapterIdx, state.lessonIdx, showText]);

  if (!lesson || !chapter) return null;

  const playing = state.status === "playing";

  return (
    <div className={styles.dock} role="region" aria-label="RAG phase narration">
      {showText ? (
        <div className={styles.transcript}>
          <div className={styles.transcriptHead}>
            <span className={styles.transcriptChapter}>{chapter.title}</span>
            {!state.supported ? (
              <span className={styles.note}>
                Your browser can&apos;t read this aloud — read along:
              </span>
            ) : null}
          </div>
          <ol className={styles.sentences}>
            {chapter.sentences.map((s, i) => {
              const active = i === state.sentenceIdx;
              return (
                <li
                  key={i}
                  ref={active ? activeRef : null}
                  className={cx(styles.sentence, active && styles.sentenceActive)}
                >
                  {s}
                </li>
              );
            })}
          </ol>
        </div>
      ) : null}

      <div className={styles.bar}>
        <div className={styles.cover} aria-hidden="true">
          {icon ?? "🎧"}
        </div>

        <div className={styles.info}>
          <div className={styles.lesson} title={lesson.title}>
            {lesson.title}
          </div>
          <div className={styles.sub}>
            Lesson {state.lessonIdx + 1}/{lessons.length} · Chapter{" "}
            {state.chapterIdx + 1}/{lesson.chapters.length} · {chapter.title}
          </div>
        </div>

        <div className={styles.transport}>
          <button
            type="button"
            className={styles.btn}
            onClick={controls.prevLesson}
            aria-label="Previous lesson"
            title="Previous lesson"
          >
            <Glyph d={PREVLESSON} />
          </button>
          <button
            type="button"
            className={styles.btn}
            onClick={controls.prevChapter}
            aria-label="Previous chapter"
            title="Previous chapter"
          >
            <Glyph d={PREV} />
          </button>
          {state.supported ? (
            <button
              type="button"
              className={cx(styles.btn, styles.btnPlay)}
              onClick={controls.toggle}
              aria-label={playing ? "Pause" : "Play"}
              title={playing ? "Pause" : "Play"}
            >
              <Glyph d={playing ? PAUSE : PLAY} />
            </button>
          ) : null}
          <button
            type="button"
            className={styles.btn}
            onClick={controls.nextChapter}
            aria-label="Next chapter"
            title="Next chapter"
          >
            <Glyph d={NEXT} />
          </button>
          <button
            type="button"
            className={styles.btn}
            onClick={controls.nextLesson}
            aria-label="Next lesson"
            title="Next lesson"
          >
            <Glyph d={NEXTLESSON} />
          </button>
        </div>

        <div className={styles.right}>
          {state.supported ? (
            <button
              type="button"
              className={cx(styles.btn, styles.btnText)}
              onClick={() => {
                const i = SPEECH_RATES.indexOf(state.rate);
                controls.setRate(
                  SPEECH_RATES[(i + 1) % SPEECH_RATES.length],
                );
              }}
              aria-label={`Playback speed ${state.rate}×`}
              title="Playback speed"
            >
              {state.rate}×
            </button>
          ) : null}
          <button
            type="button"
            className={cx(styles.btn, styles.btnText)}
            onClick={() => setShowText((v) => !v)}
            aria-label={showText ? "Hide transcript" : "Show transcript"}
            aria-pressed={showText}
            title="Transcript"
          >
            Aa
          </button>
          <button
            type="button"
            className={styles.btn}
            onClick={controls.stop}
            aria-label="Close player"
            title="Close"
          >
            <Glyph d={CLOSE} />
          </button>
        </div>
      </div>
    </div>
  );
}

HubSpeechPlayer.displayName = "HubSpeechPlayer";
