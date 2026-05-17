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
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}
const PLAY = "M8 5.14v13.72a1 1 0 001.5.86l11-6.86a1 1 0 000-1.72l-11-6.86A1 1 0 008 5.14z";
const PAUSE = "M6 5h4v14H6zM14 5h4v14h-4z";
const PREV = "M7 6h2v12H7zm3.5 6l8.5 6V6z";
const NEXT = "M15 6h2v12h-2zM5 6l8.5 6L5 18z";
const PREVLESSON = "M6 6h2v12H6zm3 6l9 6V6z";
const NEXTLESSON = "M16 6h2v12h-2zM4 6l9 6-9 6z";
const CLOSE = "M18.3 5.71L12 12l6.3 6.29-1.41 1.42L10.59 13.4 4.3 19.7 2.88 18.3 9.17 12 2.88 5.71 4.3 4.29l6.29 6.3 6.3-6.3z";

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
