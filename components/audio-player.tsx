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
// Playback rate is a global user preference — stored separately so it
// survives navigation between lessons (the per-lesson STORAGE_KEY record
// is slug-gated and gets cleared at end-of-audio).
const RATE_KEY = "knowledge_playback_rate";

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

function saveGlobalRate(rate: number) {
  try {
    localStorage.setItem(RATE_KEY, String(rate));
  } catch {}
}

function loadGlobalRate(): number | null {
  try {
    const raw = localStorage.getItem(RATE_KEY);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
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
  logoSrc,
  logoAlt,
  category,
  autoPlay = false,
  desktopRail = false,
}: {
  meta: AudioMeta;
  gradient?: [string, string];
  icon?: string;
  /** Optional brand logo image. When set, the cover tile renders this image
   *  (as a contained wide brand plate) instead of the emoji/gradient. */
  logoSrc?: string;
  logoAlt?: string;
  category?: string;
  /** Start playing as soon as metadata loads (resumes from saved position).
   *  Default false — the lesson detail page must NOT autoplay. */
  autoPlay?: boolean;
  /** Desktop only: render a persistent full-height "now playing" rail pinned
   *  to the left instead of the bottom bar (the bar is hidden ≥ 769px). Mobile
   *  is unchanged — bottom bar + tap-to-expand sheet. Opt-in per page. */
  desktopRail?: boolean;
}) {
  // Two <audio> elements (A/B double-buffer) for gapless per-chapter playback:
  // the active element plays chapter N while the idle element stays fully
  // buffered with chapter N+1, so the boundary swap needs no load() and there
  // is no audible pause. `audioRef` always points at the ACTIVE element, so the
  // rest of the component is unchanged. Single-file guides use element A only.
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const idleRef = useRef<HTMLAudioElement | null>(null);
  const elsRef = useRef<(HTMLAudioElement | null)[]>([null, null]);
  const activeABRef = useRef(0);
  const didUnlockRef = useRef(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  // Mirrored into a ref so the per-chapter swap effect can re-apply the rate
  // on `loadedmetadata` without putting `playbackRate` in its deps array
  // (which would re-fire load() on every rate change and reset the playhead).
  const playbackRateRef = useRef(1);
  const [showChapters, setShowChapters] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  // Audible-style mobile full-screen "now playing" view.
  const [expanded, setExpanded] = useState(false);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const expandHitRef = useRef<HTMLButtonElement>(null);

  // ── Per-chapter (no-stitch) mode ────────────────────────────────────
  // Every chapter has its own small MP3; the player streams one piece at a
  // time and background-prefetches the next. `currentTime`/`duration` stay
  // GLOBAL seconds so all UI (progress, chapter scan, transcript seek) is
  // unchanged. When `perChapter` is false (legacy single-file guides) every
  // path below stays byte-identical to before.
  const perChapter =
    meta.chapters.length > 0 && meta.chapters.every((c) => !!c.audio_url);
  const [activeIdx, setActiveIdx] = useState(0);
  const pendingLocalRef = useRef<number | null>(null);
  const resumePlayRef = useRef(false);
  const didRestoreRef = useRef(false);
  const chOffset = perChapter
    ? meta.chapters[activeIdx]?.start_secs ?? 0
    : 0;
  const chOffsetRef = useRef(0);
  chOffsetRef.current = chOffset;
  const perChapterRef = useRef(false);
  perChapterRef.current = perChapter;
  const activeIdxRef = useRef(0);
  activeIdxRef.current = activeIdx;
  const isPlayingRef = useRef(false);
  isPlayingRef.current = isPlaying;
  const globalTimeRef = useRef(0);

  // Keep audioRef/idleRef pointing at the active/idle elements as A/B flip.
  const syncActive = useCallback(() => {
    audioRef.current = elsRef.current[activeABRef.current] ?? null;
    idleRef.current = elsRef.current[1 - activeABRef.current] ?? null;
  }, []);
  const setElA = useCallback(
    (el: HTMLAudioElement | null) => {
      elsRef.current[0] = el;
      syncActive();
    },
    [syncActive],
  );
  const setElB = useCallback(
    (el: HTMLAudioElement | null) => {
      elsRef.current[1] = el;
      syncActive();
    },
    [syncActive],
  );

  // Single seek primitive in GLOBAL seconds. Single-file ⇒ identical to the
  // old `seek`. Per-chapter ⇒ map to (piece, local offset), switching the
  // <audio> src when the target chapter differs from the loaded one.
  const applyGlobalSeek = useCallback(
    (g: number, opts?: { play?: boolean }) => {
      const audio = audioRef.current;
      if (!audio) return;
      const total = meta.duration_secs || 0;
      const gg = Math.max(0, total ? Math.min(total, g) : Math.max(0, g));
      globalTimeRef.current = gg;
      if (!perChapterRef.current) {
        audio.currentTime = gg;
        setCurrentTime(gg);
        if (opts?.play) audio.play().catch(() => {});
        return;
      }
      let idx = 0;
      for (let i = meta.chapters.length - 1; i >= 0; i--) {
        if (gg >= meta.chapters[i].start_secs) {
          idx = i;
          break;
        }
      }
      const local = Math.max(0, gg - meta.chapters[idx].start_secs);
      setCurrentTime(gg);
      if (idx === activeIdxRef.current) {
        audio.currentTime = local;
        if (opts?.play) audio.play().catch(() => {});
      } else {
        pendingLocalRef.current = local;
        resumePlayRef.current = opts?.play ?? isPlayingRef.current;
        setActiveIdx(idx);
      }
    },
    [meta.chapters, meta.duration_secs],
  );

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
  // Remaining is wall-clock at the user's chosen rate (Spotify/Audible
  // convention), so a 30-min audio at 2× shows -15:00 rather than -30:00.
  // Elapsed + progress + chapter labels stay in audio-seconds — see plan.
  const remaining = Math.max(
    0,
    (totalSecs - currentTime) / Math.max(0.1, playbackRate),
  );
  const hasPrevChapter = currentChapterIndex > 0;
  const hasNextChapter = currentChapterIndex < meta.chapters.length - 1;

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    let lastSaveTime = 0;

    const makeSaveState = (): LastPlayedState => ({
      slug: meta.slug,
      currentTime: chOffsetRef.current + audio.currentTime,
      playbackRate: audio.playbackRate,
      updatedAt: Date.now(),
    });

    const onTimeUpdate = () => {
      const g = chOffsetRef.current + audio.currentTime;
      globalTimeRef.current = g;
      setCurrentTime(g);
      const now = Date.now();
      if (now - lastSaveTime >= 5000) {
        lastSaveTime = now;
        persistState(makeSaveState());
      }
    };
    const onLoadedMetadata = () => {
      if (perChapterRef.current) {
        // Per-chapter: `duration` stays 0 so totalSecs = meta.duration_secs
        // (the GLOBAL total). audio.duration here is just this piece.
        setIsLoaded(true);
        // A queued chapter switch (auto-advance / seek across pieces).
        if (pendingLocalRef.current != null) {
          const lp = pendingLocalRef.current;
          pendingLocalRef.current = null;
          try {
            audio.currentTime = lp;
          } catch {}
          if (resumePlayRef.current) {
            resumePlayRef.current = false;
            audio.play().catch(() => {});
          }
          return;
        }
        // First load only: restore saved GLOBAL position (mapped to a piece).
        if (didRestoreRef.current) return;
        didRestoreRef.current = true;
        // Rate is a global preference — apply slug-independently.
        const globalRate = loadGlobalRate();
        if (globalRate && SPEEDS.includes(globalRate)) {
          audio.playbackRate = globalRate;
          setPlaybackRate(globalRate);
        }
        const saved = loadPlaybackState();
        if (saved && saved.slug === meta.slug) {
          // Legacy migration: per-lesson record carried the rate before the
          // global key existed; promote it so subsequent lessons inherit it.
          if (
            !globalRate &&
            saved.playbackRate &&
            SPEEDS.includes(saved.playbackRate)
          ) {
            audio.playbackRate = saved.playbackRate;
            setPlaybackRate(saved.playbackRate);
            saveGlobalRate(saved.playbackRate);
          }
          if (saved.currentTime > 0) {
            applyGlobalSeek(saved.currentTime, { play: autoPlay });
            return;
          }
        }
        if (autoPlay) audio.play().catch(() => {});
        return;
      }
      setDuration(audio.duration);
      setIsLoaded(true);
      // Restore from localStorage immediately (no network wait)
      // Rate is a global preference — apply slug-independently.
      const globalRate = loadGlobalRate();
      if (globalRate && SPEEDS.includes(globalRate)) {
        audio.playbackRate = globalRate;
        setPlaybackRate(globalRate);
      }
      const saved = loadPlaybackState();
      let localUpdatedAt = 0;
      if (saved && saved.slug === meta.slug) {
        if (saved.currentTime > 0 && saved.currentTime < audio.duration) {
          audio.currentTime = saved.currentTime;
        }
        // Legacy migration: promote per-lesson rate to the global key.
        if (
          !globalRate &&
          saved.playbackRate &&
          SPEEDS.includes(saved.playbackRate)
        ) {
          audio.playbackRate = saved.playbackRate;
          setPlaybackRate(saved.playbackRate);
          saveGlobalRate(saved.playbackRate);
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
            saveGlobalRate(remote.playbackRate);
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
      if (
        perChapterRef.current &&
        activeIdxRef.current < meta.chapters.length - 1
      ) {
        const nextIdx = activeIdxRef.current + 1;
        const nextUrl = meta.chapters[nextIdx]?.audio_url;
        const idle = idleRef.current;
        // Gapless: the idle element is already buffered with the next chapter,
        // so start it immediately and flip A/B — no load() on the hot path.
        if (
          idle &&
          nextUrl &&
          idle.dataset.url === nextUrl &&
          idle.readyState >= 3 /* HAVE_FUTURE_DATA */
        ) {
          idle.currentTime = 0;
          idle.playbackRate = playbackRateRef.current;
          // Update GLOBAL refs synchronously so the one frame before the
          // setActiveIdx re-render doesn't show a backward progress jump.
          chOffsetRef.current = meta.chapters[nextIdx].start_secs;
          globalTimeRef.current = meta.chapters[nextIdx].start_secs;
          idle.play().catch(() => {});
          // The new active element's `play` event is bound late (listeners
          // rebind after the re-render), so set the state explicitly here.
          setIsPlaying(true);
          activeABRef.current = 1 - activeABRef.current;
          syncActive();
          setActiveIdx(nextIdx);
          return;
        }
        // Fallback (idle not ready / stall): load on the active element.
        pendingLocalRef.current = 0;
        resumePlayRef.current = true;
        setActiveIdx(nextIdx);
        return;
      }
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
    // Only the ACTIVE element drives the play/pause UI. During a gapless
    // chapter handoff the just-ended element briefly fires a `pause` while it is
    // still bound; ignoring non-active targets stops that stray event from
    // knocking `isPlaying` to false (button would show the play icon mid-play).
    const onPlay = (e: Event) => {
      if (e.currentTarget !== audioRef.current) return;
      setIsPlaying(true);
    };
    const onPause = (e: Event) => {
      if (e.currentTarget !== audioRef.current) return;
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
  }, [meta.slug, autoPlay, activeIdx]);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
    } else {
      // iOS Safari only lets a media element start from a user gesture. The
      // gapless handoff starts the IDLE element programmatically (no gesture),
      // so prime it once here (muted play->pause) to unlock later boundary plays.
      if (perChapterRef.current && !didUnlockRef.current) {
        didUnlockRef.current = true;
        const idle = idleRef.current;
        if (idle) {
          const wasMuted = idle.muted;
          idle.muted = true;
          idle
            .play()
            .then(() => {
              idle.pause();
              idle.muted = wasMuted;
            })
            .catch(() => {
              idle.muted = wasMuted;
            });
        }
      }
      audio.play();
    }
  }, [isPlaying]);

  const seek = useCallback(
    (time: number) => {
      applyGlobalSeek(time);
    },
    [applyGlobalSeek],
  );

  // Bridge: a question heading in the article was clicked.
  useEffect(() => {
    const onSeekRequest = (e: Event) => {
      const seconds = (e as CustomEvent<{ seconds: number }>).detail?.seconds;
      if (typeof seconds !== "number") return;
      applyGlobalSeek(seconds, { play: true });
    };
    window.addEventListener("knowledge:seek-audio", onSeekRequest);
    return () =>
      window.removeEventListener("knowledge:seek-audio", onSeekRequest);
  }, [applyGlobalSeek]);

  const skip = useCallback(
    (delta: number) => {
      applyGlobalSeek(globalTimeRef.current + delta);
    },
    [applyGlobalSeek],
  );

  const goToChapter = useCallback(
    (dir: -1 | 1) => {
      let idx = 0;
      for (let i = meta.chapters.length - 1; i >= 0; i--) {
        if (globalTimeRef.current >= meta.chapters[i].start_secs) {
          idx = i;
          break;
        }
      }
      const ch = meta.chapters[idx + dir];
      if (!ch) return;
      applyGlobalSeek(ch.start_secs, { play: true });
    },
    [meta.chapters, applyGlobalSeek],
  );

  const setSpeed = useCallback((rate: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.playbackRate = rate;
    setPlaybackRate(rate);
    saveGlobalRate(rate);
    persistState({
      slug: meta.slug,
      currentTime: audio.currentTime,
      playbackRate: rate,
      updatedAt: Date.now(),
    });
  }, [meta.slug]);

  const seekToChapter = useCallback(
    (chapter: AudioChapter) => {
      applyGlobalSeek(chapter.start_secs, { play: true });
      setShowChapters(false);
    },
    [applyGlobalSeek],
  );

  // Tapping the bar opens the full-screen view — mobile only. Desktop keeps
  // the inline bar (matchMedia guard + CSS pointer-events both enforce this).
  const openExpanded = useCallback(() => {
    if (
      typeof window !== "undefined" &&
      window.matchMedia("(max-width: 768px)").matches
    ) {
      setExpanded(true);
    }
  }, []);

  // Body-scroll-lock + Escape + focus management while the sheet is open.
  useEffect(() => {
    if (!expanded) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    closeBtnRef.current?.focus();
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
      expandHitRef.current?.focus();
    };
  }, [expanded]);

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
    const chapterAt = () => {
      let idx = 0;
      for (let i = meta.chapters.length - 1; i >= 0; i--) {
        if (globalTimeRef.current >= meta.chapters[i].start_secs) {
          idx = i;
          break;
        }
      }
      return idx;
    };
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ["play", () => at()?.play().catch(() => {})],
      ["pause", () => at()?.pause()],
      ["seekbackward", () => applyGlobalSeek(globalTimeRef.current - SKIP)],
      ["seekforward", () => applyGlobalSeek(globalTimeRef.current + SKIP)],
      [
        "seekto",
        (d) => {
          if (typeof d.seekTime === "number") applyGlobalSeek(d.seekTime);
        },
      ],
      [
        "previoustrack",
        () => {
          const ch = meta.chapters[chapterAt() - 1];
          if (ch) applyGlobalSeek(ch.start_secs, { play: true });
        },
      ],
      [
        "nexttrack",
        () => {
          const ch = meta.chapters[chapterAt() + 1];
          if (ch) applyGlobalSeek(ch.start_secs, { play: true });
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
  }, [meta.slug, meta.title, meta.chapters, meta.duration_secs, category, applyGlobalSeek]);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";
  }, [isPlaying]);

  // Mirror `playbackRate` into a ref so the chapter-swap effect can read the
  // latest value without re-running on rate change.
  useEffect(() => {
    playbackRateRef.current = playbackRate;
  }, [playbackRate]);

  // Dual-buffer manager (no-stitch only). Keeps the ACTIVE element loaded with
  // the current chapter and the IDLE element fully buffered with the NEXT one,
  // so the boundary swap in `onEnded` is gapless. `dataset.url` tracks what each
  // element holds so an already-buffered piece is never reloaded (which is what
  // would reintroduce the pause). Browsers reset playbackRate on load(), so the
  // active element re-applies the chosen rate once its metadata is ready.
  useEffect(() => {
    if (!perChapter) return;
    const active = audioRef.current;
    const idle = idleRef.current;
    if (active) {
      const wantActive = meta.chapters[activeIdx]?.audio_url;
      if (wantActive && active.dataset.url !== wantActive) {
        active.dataset.url = wantActive;
        const restoreRate = () => {
          active.playbackRate = playbackRateRef.current;
        };
        active.addEventListener("loadedmetadata", restoreRate, { once: true });
        active.src = wantActive;
        active.load();
      }
    }
    if (idle) {
      const wantIdle = meta.chapters[activeIdx + 1]?.audio_url;
      if (wantIdle && idle.dataset.url !== wantIdle) {
        idle.dataset.url = wantIdle;
        idle.preload = "auto";
        idle.src = wantIdle;
        idle.load();
      }
    }
  }, [perChapter, activeIdx, meta.chapters]);

  const progress = totalSecs > 0 ? (currentTime / totalSecs) * 100 : 0;

  // Transport cluster — reused verbatim in the bar and the full-screen sheet
  // (same handlers, same audio element; size differs purely via parent CSS).
  const transportButtons = (
    <>
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

      <button
        className={cx(styles.audioBtn, styles.audioBtnPlay)}
        onClick={togglePlay}
        aria-label={isPlaying ? "Pause" : "Play"}
        aria-pressed={isPlaying}
      >
        {isPlaying ? (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="4" width="4" height="16" rx="1" />
            <rect x="14" y="4" width="4" height="16" rx="1" />
          </svg>
        ) : (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5.14v14.72a1 1 0 001.5.86l11-7.36a1 1 0 000-1.72l-11-7.36A1 1 0 008 5.14z" />
          </svg>
        )}
      </button>

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
    </>
  );

  const speedButtons = SPEEDS.map((s) => (
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
  ));

  const chapterRows = meta.chapters.map((ch) => (
    <button
      key={ch.index}
      className={cx(
        styles.audioChapterItem,
        ch.index === currentChapterIndex && styles.audioChapterItemActive,
      )}
      onClick={() => seekToChapter(ch)}
    >
      <span className={styles.audioChapterIdx}>{ch.index + 1}</span>
      <span className={styles.audioChapterName}>{ch.title}</span>
      <span className={styles.audioChapterTime}>
        {formatTime(ch.start_secs)}
      </span>
    </button>
  ));

  return (
    <>
      <audio
        ref={setElA}
        src={perChapter ? undefined : meta.audio_url || undefined}
        preload={perChapter ? "auto" : "metadata"}
      />
      {perChapter && <audio ref={setElB} preload="auto" />}

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
            {chapterRows}
          </div>
        </div>
      )}

      {/* Mobile full-screen "now playing" view (Audible-style). Same audio
          element / handlers — only the UI is restructured, never remounted. */}
      {expanded && (
        <div
          className={styles.audioFsBackdrop}
          onClick={() => setExpanded(false)}
        >
          <div
            className={styles.audioFsSheet}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={`Now playing: ${meta.title}`}
            style={
              {
                ["--cat-from" as string]:
                  gradient?.[0] ?? "var(--ds-accent)",
                ["--cat-to" as string]: gradient?.[1] ?? "var(--cyan-9)",
              } as React.CSSProperties
            }
          >
            <div className={styles.audioFsTop}>
              <button
                ref={closeBtnRef}
                className={styles.audioFsClose}
                onClick={() => setExpanded(false)}
                aria-label="Collapse player"
              >
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </button>
            </div>

            <div
              className={cx(
                styles.audioFsCover,
                logoSrc && styles.audioFsCoverLogo,
              )}
              aria-hidden="true"
            >
              {logoSrc ? (
                <img
                  src={logoSrc}
                  alt=""
                  className={styles.audioFsCoverImg}
                />
              ) : (
                (icon ?? "♪")
              )}
            </div>

            <div className={styles.audioFsMeta}>
              <div className={styles.audioFsTitle}>{meta.title}</div>
              <div className={styles.audioFsChapter}>
                {currentChapter?.title ?? ""}
              </div>
            </div>

            <div className={styles.audioFsSeekRow}>
              <input
                type="range"
                className={styles.audioFsSeek}
                min={0}
                max={totalSecs}
                step={0.1}
                value={currentTime}
                onChange={(e) => seek(Number(e.target.value))}
                style={
                  { "--progress": `${progress}%` } as React.CSSProperties
                }
                aria-label="Seek"
              />
              <div className={styles.audioFsTimes}>
                <span>{formatTime(currentTime)}</span>
                <span>-{formatTime(remaining)}</span>
              </div>
            </div>

            <div className={styles.audioFsTransport}>{transportButtons}</div>

            <div
              className={styles.audioFsSpeeds}
              role="group"
              aria-label="Playback speed"
            >
              {speedButtons}
            </div>

            <div className={styles.audioFsList}>{chapterRows}</div>
          </div>
        </div>
      )}

      {/* Desktop left rail — full-height "now playing" (opt-in via desktopRail).
          CSS hides it < 769px; the bottom bar is hidden ≥ 769px in this mode.
          Reuses the same audio element + transport/speed/chapter controls. */}
      {desktopRail && (
        <aside
          className={styles.audioRail}
          aria-label={`Audio player: ${meta.title}`}
          style={
            {
              ["--cat-from" as string]: gradient?.[0] ?? "var(--ds-accent)",
              ["--cat-to" as string]: gradient?.[1] ?? "var(--cyan-9)",
            } as React.CSSProperties
          }
        >
          <div className={styles.audioRailMeta}>
            <div className={styles.audioRailTitle}>{meta.title}</div>
            <div className={styles.audioRailChapter}>
              {currentChapter?.title ?? ""}
            </div>
          </div>

          <div className={styles.audioRailSeekRow}>
            <input
              type="range"
              className={styles.audioFsSeek}
              min={0}
              max={totalSecs}
              step={0.1}
              value={currentTime}
              onChange={(e) => seek(Number(e.target.value))}
              style={{ "--progress": `${progress}%` } as React.CSSProperties}
              aria-label="Seek"
            />
            <div className={styles.audioRailTimes}>
              <span>{formatTime(currentTime)}</span>
              <span>-{formatTime(remaining)}</span>
            </div>
          </div>

          <div className={styles.audioRailTransport}>{transportButtons}</div>

          <div
            className={styles.audioRailSpeeds}
            role="group"
            aria-label="Playback speed"
          >
            {speedButtons}
          </div>

          <div className={styles.audioRailList}>{chapterRows}</div>
        </aside>
      )}

      {/* Player bar */}
      <div
        className={cx(
          styles.audioPlayer,
          desktopRail && styles.audioPlayerRailHiddenDesktop,
        )}
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
          <button
            type="button"
            ref={expandHitRef}
            className={styles.audioExpandHit}
            onClick={openExpanded}
            aria-label="Open full screen player"
          >
            <span
              className={cx(
                styles.audioCover,
                logoSrc && styles.audioCoverLogo,
              )}
              aria-hidden="true"
            >
              {logoSrc ? (
                <img src={logoSrc} alt="" className={styles.audioCoverImg} />
              ) : (
                (icon ?? "♪")
              )}
            </span>
            <span className={styles.audioInfo}>
              <span className={styles.audioInfoChapter}>
                {currentChapter?.title ?? meta.title}
              </span>
              <span className={styles.audioInfoTime}>
                {formatTime(currentTime)} &middot; -{formatTime(remaining)}
              </span>
            </span>
          </button>

          <div className={styles.audioTransport}>{transportButtons}</div>

          <div
            className={styles.audioSpeedGroup}
            role="group"
            aria-label="Playback speed"
          >
            {speedButtons}
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
