"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import type { AudioMeta, AudioChapter } from "@/lib/audio";
import { cx } from "@/components/ui";
import styles from "./audio-player.module.css";

function formatTime(secs: number): string {
  const s0 = Math.max(0, Math.floor(secs));
  const m = Math.floor(s0 / 60);
  const s = s0 % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const SPEEDS = [0.75, 1, 1.25, 1.5, 2];
const SKIP = 30;

const STORAGE_KEY = "knowledge_last_played";

interface LastPlayedState {
  slug: string;
  currentTime: number;
  playbackRate: number;
  updatedAt: number;
}

function savePlaybackState(state: LastPlayedState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {}
}

function loadPlaybackState(): LastPlayedState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function clearPlaybackState() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
}

function putRemoteState(state: LastPlayedState) {
  // Best-effort cross-device sync to D1. Anonymous users get 204.
  fetch("/api/audio-progress", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(state),
    keepalive: true,
  }).catch(() => {});
}

function persistState(state: LastPlayedState) {
  savePlaybackState(state);
  putRemoteState(state);
}

export function AudioPlayer({
  meta,
  gradient,
  icon,
  category,
  autoPlay = false,
}: {
  meta: AudioMeta;
  gradient?: [string, string];
  icon?: string;
  category?: string;
  /** Start playing as soon as metadata loads (resumes from saved position).
   *  Default false — the lesson detail page must NOT autoplay. */
  autoPlay?: boolean;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [showChapters, setShowChapters] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);

  // Find current chapter via reverse scan
  const currentChapterIndex = (() => {
    const chapters = meta.chapters;
    let idx = 0;
    for (let i = chapters.length - 1; i >= 0; i--) {
      if (currentTime >= chapters[i].start_secs) {
        idx = i;
        break;
      }
    }
    return idx;
  })();

  const currentChapter = meta.chapters[currentChapterIndex];
  const totalSecs = duration || meta.duration_secs;
  const remaining = Math.max(0, totalSecs - currentTime);
  const hasPrevChapter = currentChapterIndex > 0;
  const hasNextChapter = currentChapterIndex < meta.chapters.length - 1;

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    let lastSaveTime = 0;

    const makeSaveState = (): LastPlayedState => ({
      slug: meta.slug,
      currentTime: audio.currentTime,
      playbackRate: audio.playbackRate,
      updatedAt: Date.now(),
    });

    const onTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
      const now = Date.now();
      if (now - lastSaveTime >= 5000) {
        lastSaveTime = now;
        persistState(makeSaveState());
      }
    };
    const onLoadedMetadata = () => {
      setDuration(audio.duration);
      setIsLoaded(true);
      // Restore from localStorage immediately (no network wait)
      const saved = loadPlaybackState();
      let localUpdatedAt = 0;
      if (saved && saved.slug === meta.slug) {
        if (saved.currentTime > 0 && saved.currentTime < audio.duration) {
          audio.currentTime = saved.currentTime;
        }
        if (saved.playbackRate && SPEEDS.includes(saved.playbackRate)) {
          audio.playbackRate = saved.playbackRate;
          setPlaybackRate(saved.playbackRate);
        }
        localUpdatedAt = saved.updatedAt;
      }
      // Reconcile with D1 — newer wins, and only if user hasn't started playing.
      fetch(`/api/audio-progress?slug=${encodeURIComponent(meta.slug)}`, {
        cache: "no-store",
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          const remote = data?.progress as
            | { currentTime: number; playbackRate: number; updatedAt: number }
            | null
            | undefined;
          if (!remote) return;
          if (remote.updatedAt <= localUpdatedAt) return;
          if (audio.played.length > 0) return;
          if (remote.currentTime > 0 && remote.currentTime < audio.duration) {
            audio.currentTime = remote.currentTime;
          }
          if (remote.playbackRate && SPEEDS.includes(remote.playbackRate)) {
            audio.playbackRate = remote.playbackRate;
            setPlaybackRate(remote.playbackRate);
          }
          savePlaybackState({
            slug: meta.slug,
            currentTime: audio.currentTime,
            playbackRate: audio.playbackRate,
            updatedAt: remote.updatedAt,
          });
        })
        .catch(() => {});

      // Hub "Listen" entry point: begin playback immediately. localStorage
      // restore above already set the resume position; the async D1 reconcile
      // self-skips once audio.played is non-empty.
      if (autoPlay) {
        audio.play().catch(() => {});
      }
    };
    const onEnded = () => {
      setIsPlaying(false);
      clearPlaybackState();
      // Reset D1 row so resume from another device starts fresh.
      putRemoteState({
        slug: meta.slug,
        currentTime: 0,
        playbackRate: audio.playbackRate,
        updatedAt: Date.now(),
      });
    };
    const onPlay = () => setIsPlaying(true);
    const onPause = () => {
      setIsPlaying(false);
      persistState(makeSaveState());
    };

    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);

    return () => {
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
    };
  }, [meta.slug, autoPlay]);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
    } else {
      audio.play();
    }
  }, [isPlaying]);

  const seek = useCallback((time: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = time;
    setCurrentTime(time);
  }, []);

  // Bridge: a question heading in the article was clicked.
  useEffect(() => {
    const onSeekRequest = (e: Event) => {
      const seconds = (e as CustomEvent<{ seconds: number }>).detail?.seconds;
      if (typeof seconds !== "number") return;
      seek(seconds);
      audioRef.current?.play().catch(() => {});
    };
    window.addEventListener("knowledge:seek-audio", onSeekRequest);
    return () =>
      window.removeEventListener("knowledge:seek-audio", onSeekRequest);
  }, [seek]);

  const skip = useCallback((delta: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Math.max(
      0,
      Math.min(audio.duration || meta.duration_secs, audio.currentTime + delta),
    );
  }, [meta.duration_secs]);

  const goToChapter = useCallback(
    (dir: -1 | 1) => {
      const audio = audioRef.current;
      if (!audio) return;
      let idx = 0;
      for (let i = meta.chapters.length - 1; i >= 0; i--) {
        if (audio.currentTime >= meta.chapters[i].start_secs) {
          idx = i;
          break;
        }
      }
      const ch = meta.chapters[idx + dir];
      if (!ch) return;
      seek(ch.start_secs);
      if (!isPlaying) audio.play().catch(() => {});
    },
    [meta.chapters, seek, isPlaying],
  );

  const setSpeed = useCallback((rate: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.playbackRate = rate;
    setPlaybackRate(rate);
    persistState({
      slug: meta.slug,
      currentTime: audio.currentTime,
      playbackRate: rate,
      updatedAt: Date.now(),
    });
  }, [meta.slug]);

  const seekToChapter = useCallback(
    (chapter: AudioChapter) => {
      seek(chapter.start_secs);
      setShowChapters(false);
      const audio = audioRef.current;
      if (audio && !isPlaying) audio.play();
    },
    [seek, isPlaying],
  );

  // Media Session — lock-screen / headphone / car controls.
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    try {
      ms.metadata = new MediaMetadata({
        title: meta.title,
        artist: category ?? "AI Engineer Roadmap",
        album: "AI Engineer Roadmap",
      });
    } catch {}

    const at = () => audioRef.current;
    const chapterAt = (t: number) => {
      let idx = 0;
      for (let i = meta.chapters.length - 1; i >= 0; i--) {
        if (t >= meta.chapters[i].start_secs) {
          idx = i;
          break;
        }
      }
      return idx;
    };
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ["play", () => at()?.play().catch(() => {})],
      ["pause", () => at()?.pause()],
      [
        "seekbackward",
        () => {
          const a = at();
          if (a) a.currentTime = Math.max(0, a.currentTime - SKIP);
        },
      ],
      [
        "seekforward",
        () => {
          const a = at();
          if (a)
            a.currentTime = Math.min(
              a.duration || meta.duration_secs,
              a.currentTime + SKIP,
            );
        },
      ],
      [
        "seekto",
        (d) => {
          const a = at();
          if (a && typeof d.seekTime === "number") a.currentTime = d.seekTime;
        },
      ],
      [
        "previoustrack",
        () => {
          const a = at();
          if (!a) return;
          const ch = meta.chapters[chapterAt(a.currentTime) - 1];
          if (ch) a.currentTime = ch.start_secs;
        },
      ],
      [
        "nexttrack",
        () => {
          const a = at();
          if (!a) return;
          const ch = meta.chapters[chapterAt(a.currentTime) + 1];
          if (ch) a.currentTime = ch.start_secs;
        },
      ],
    ];
    for (const [action, fn] of handlers) {
      try {
        ms.setActionHandler(action, fn);
      } catch {}
    }
    return () => {
      for (const [action] of handlers) {
        try {
          ms.setActionHandler(action, null);
        } catch {}
      }
    };
  }, [meta.slug, meta.title, meta.chapters, meta.duration_secs, category]);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";
  }, [isPlaying]);

  const progress = totalSecs > 0 ? (currentTime / totalSecs) * 100 : 0;

  return (
    <>
      <audio ref={audioRef} src={meta.audio_url} preload="metadata" />

      {/* Chapter list overlay */}
      {showChapters && (
        <div
          className={styles.audioChaptersBackdrop}
          onClick={() => setShowChapters(false)}
        >
          <div
            className={styles.audioChaptersPanel}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.audioChaptersHandle} />
            <div className={styles.audioChaptersTitle}>Chapters</div>
            {meta.chapters.map((ch) => (
              <button
                key={ch.index}
                className={cx(
                  styles.audioChapterItem,
                  ch.index === currentChapterIndex &&
                    styles.audioChapterItemActive,
                )}
                onClick={() => seekToChapter(ch)}
              >
                <span className={styles.audioChapterIdx}>{ch.index + 1}</span>
                <span className={styles.audioChapterName}>{ch.title}</span>
                <span className={styles.audioChapterTime}>
                  {formatTime(ch.start_secs)}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Player bar */}
      <div
        className={styles.audioPlayer}
        style={
          {
            ["--cat-from" as string]: gradient?.[0] ?? "var(--ds-accent)",
            ["--cat-to" as string]: gradient?.[1] ?? "var(--cyan-9)",
          } as React.CSSProperties
        }
      >
        {/* Row 1 — full-width progress */}
        <div className={styles.audioSeekWrap}>
          <input
            type="range"
            className={styles.audioSeek}
            min={0}
            max={totalSecs}
            step={0.1}
            value={currentTime}
            onChange={(e) => seek(Number(e.target.value))}
            style={{ "--progress": `${progress}%` } as React.CSSProperties}
            aria-label="Seek"
            role="slider"
          />
        </div>

        {/* Row 2 — cover · info · transport · speed · chapters */}
        <div className={styles.audioPlayerInner}>
          <div className={styles.audioCover} aria-hidden="true">
            {icon ?? "♪"}
          </div>

          <div className={styles.audioInfo}>
            <div className={styles.audioInfoChapter}>
              {currentChapter?.title ?? meta.title}
            </div>
            <div className={styles.audioInfoTime}>
              {formatTime(currentTime)} &middot; -{formatTime(remaining)}
            </div>
          </div>

          <div className={styles.audioTransport}>
            {/* Previous chapter */}
            <button
              className={styles.audioBtn}
              onClick={() => goToChapter(-1)}
              disabled={!hasPrevChapter}
              aria-label="Previous chapter"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="5" width="2.4" height="14" rx="1" />
                <path d="M19 5v14L9 12z" />
              </svg>
            </button>

            {/* Back 30s */}
            <button
              className={styles.audioBtn}
              onClick={() => skip(-SKIP)}
              aria-label="Back 30 seconds"
            >
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M1 4v6h6" />
                <path d="M3.51 15a9 9 0 102.13-9.36L1 10" />
                <text
                  x="12.5"
                  y="16"
                  fill="currentColor"
                  stroke="none"
                  fontSize="8"
                  fontWeight="700"
                  textAnchor="middle"
                >
                  30
                </text>
              </svg>
            </button>

            {/* Play / Pause */}
            <button
              className={cx(styles.audioBtn, styles.audioBtnPlay)}
              onClick={togglePlay}
              aria-label={isPlaying ? "Pause" : "Play"}
              aria-pressed={isPlaying}
            >
              {isPlaying ? (
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <rect x="6" y="4" width="4" height="16" rx="1" />
                  <rect x="14" y="4" width="4" height="16" rx="1" />
                </svg>
              ) : (
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <path d="M8 5.14v14.72a1 1 0 001.5.86l11-7.36a1 1 0 000-1.72l-11-7.36A1 1 0 008 5.14z" />
                </svg>
              )}
            </button>

            {/* Forward 30s */}
            <button
              className={styles.audioBtn}
              onClick={() => skip(SKIP)}
              aria-label="Forward 30 seconds"
            >
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M23 4v6h-6" />
                <path d="M20.49 15a9 9 0 11-2.13-9.36L23 10" />
                <text
                  x="11.5"
                  y="16"
                  fill="currentColor"
                  stroke="none"
                  fontSize="8"
                  fontWeight="700"
                  textAnchor="middle"
                >
                  30
                </text>
              </svg>
            </button>

            {/* Next chapter */}
            <button
              className={styles.audioBtn}
              onClick={() => goToChapter(1)}
              disabled={!hasNextChapter}
              aria-label="Next chapter"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M5 5v14l10-7z" />
                <rect x="15.6" y="5" width="2.4" height="14" rx="1" />
              </svg>
            </button>
          </div>

          {/* Speed */}
          <div
            className={styles.audioSpeedGroup}
            role="group"
            aria-label="Playback speed"
          >
            {SPEEDS.map((s) => (
              <button
                key={s}
                className={cx(
                  styles.audioSpeedPill,
                  playbackRate === s && styles.audioSpeedPillActive,
                )}
                onClick={() => setSpeed(s)}
                aria-pressed={playbackRate === s}
                aria-label={`Playback speed ${s}×`}
              >
                {s}×
              </button>
            ))}
          </div>

          {/* Chapters toggle */}
          <button
            className={styles.audioBtn}
            onClick={() => setShowChapters(!showChapters)}
            aria-label="Show chapters"
            aria-expanded={showChapters}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <line x1="8" y1="6" x2="21" y2="6" />
              <line x1="8" y1="12" x2="21" y2="12" />
              <line x1="8" y1="18" x2="21" y2="18" />
              <line x1="3" y1="6" x2="3.01" y2="6" />
              <line x1="3" y1="12" x2="3.01" y2="12" />
              <line x1="3" y1="18" x2="3.01" y2="18" />
            </svg>
          </button>
        </div>
      </div>
    </>
  );
}
