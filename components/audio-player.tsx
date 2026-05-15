"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import type { AudioMeta, AudioChapter } from "@/lib/audio";

function formatTime(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const SPEEDS = [0.75, 1, 1.25, 1.5, 2];

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

export function AudioPlayer({ meta }: { meta: AudioMeta }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [showChapters, setShowChapters] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);

  // Find current chapter via binary search
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
  }, [meta.slug]);

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
    audio.currentTime = Math.max(0, Math.min(audio.duration, audio.currentTime + delta));
  }, []);

  const cycleSpeed = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const idx = SPEEDS.indexOf(playbackRate);
    const next = SPEEDS[(idx + 1) % SPEEDS.length];
    audio.playbackRate = next;
    setPlaybackRate(next);
    persistState({
      slug: meta.slug,
      currentTime: audio.currentTime,
      playbackRate: next,
      updatedAt: Date.now(),
    });
  }, [playbackRate, meta.slug]);

  const seekToChapter = useCallback((chapter: AudioChapter) => {
    seek(chapter.start_secs);
    setShowChapters(false);
    const audio = audioRef.current;
    if (audio && !isPlaying) audio.play();
  }, [seek, isPlaying]);

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <>
      <audio ref={audioRef} src={meta.audio_url} preload="metadata" />

      {/* Chapter list overlay */}
      {showChapters && (
        <div className="audio-chapters-backdrop" onClick={() => setShowChapters(false)}>
          <div className="audio-chapters-panel" onClick={(e) => e.stopPropagation()}>
            <div className="audio-chapters-handle" />
            <div className="audio-chapters-title">Chapters</div>
            {meta.chapters.map((ch) => (
              <button
                key={ch.index}
                className={`audio-chapter-item ${ch.index === currentChapterIndex ? "audio-chapter-item--active" : ""}`}
                onClick={() => seekToChapter(ch)}
              >
                <span className="audio-chapter-idx">{ch.index + 1}</span>
                <span className="audio-chapter-name">{ch.title}</span>
                <span className="audio-chapter-time">{formatTime(ch.start_secs)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Player bar */}
      <div className="audio-player">
        <div className="audio-player-inner">
          {/* Play/Pause */}
          <button className="audio-btn audio-btn--play" onClick={togglePlay} aria-label={isPlaying ? "Pause" : "Play"} aria-pressed={isPlaying}>
            {isPlaying ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="4" width="4" height="16" rx="1" />
                <rect x="14" y="4" width="4" height="16" rx="1" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5.14v14.72a1 1 0 001.5.86l11-7.36a1 1 0 000-1.72l-11-7.36A1 1 0 008 5.14z" />
              </svg>
            )}
          </button>

          {/* Skip back 15s */}
          <button className="audio-btn" onClick={() => skip(-15)} aria-label="Back 15 seconds">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M1 4v6h6" />
              <path d="M3.51 15a9 9 0 102.13-9.36L1 10" />
            </svg>
          </button>

          {/* Skip forward 15s */}
          <button className="audio-btn" onClick={() => skip(15)} aria-label="Forward 15 seconds">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M23 4v6h-6" />
              <path d="M20.49 15a9 9 0 11-2.13-9.36L23 10" />
            </svg>
          </button>

          {/* Info */}
          <div className="audio-info">
            <div className="audio-info-chapter">{currentChapter?.title}</div>
            <div className="audio-info-time">
              {formatTime(currentTime)} / {formatTime(duration || meta.duration_secs)}
            </div>
          </div>

          {/* Seek bar */}
          <div className="audio-seek-wrap">
            <input
              type="range"
              className="audio-seek"
              min={0}
              max={duration || meta.duration_secs}
              step={0.1}
              value={currentTime}
              onChange={(e) => seek(Number(e.target.value))}
              style={{ "--progress": `${progress}%` } as React.CSSProperties}
              aria-label="Seek"
              role="slider"
            />
          </div>

          {/* Speed */}
          <button className="audio-btn audio-btn--speed" onClick={cycleSpeed} aria-label={`Playback speed: ${playbackRate}x`}>
            {playbackRate}x
          </button>

          {/* Chapters toggle */}
          <button
            className="audio-btn"
            onClick={() => setShowChapters(!showChapters)}
            aria-label="Show chapters"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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
