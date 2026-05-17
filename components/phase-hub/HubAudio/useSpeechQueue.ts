"use client";

// Web-Speech engine for the phase hub. There is no MP3 (every lesson is
// voice:"pending-tts", audio_url:""), so the hub "audio experience" is the
// browser's SpeechSynthesis reading each chapter's `script` text. The whole
// phase is one continuous queue: sentence → chapter → lesson → next lesson,
// auto-advancing to the end. SSR-safe: every speechSynthesis touch is in a
// handler/effect and feature-detected.
import * as React from "react";
import type { AudioMeta } from "@/lib/audio";

export const SPEECH_RATES = [0.75, 1, 1.25, 1.5, 2] as const;
export type SpeechRate = (typeof SPEECH_RATES)[number];

const POS_KEY = "rag:listen:pos";

export interface QueueChapter {
  title: string;
  sentences: string[];
}
export interface QueueLesson {
  slug: string;
  title: string;
  durationSecs: number;
  chapters: QueueChapter[];
}

export interface SpeechState {
  supported: boolean;
  status: "idle" | "playing" | "paused";
  lessonIdx: number; // -1 when idle
  chapterIdx: number;
  sentenceIdx: number;
  rate: SpeechRate;
}

export interface SavedPos {
  slug: string;
  chapterIdx: number;
}

/** Split clean narration prose into short utterance-sized chunks. The
 *  content gate guarantees no markdown, so sentence punctuation is reliable. */
function splitSentences(text: string): string[] {
  const t = (text || "").replace(/\s+/g, " ").trim();
  if (!t) return [];
  const parts = t.match(/[^.!?]+[.!?]+(?=\s|$)|[^.!?]+$/g) ?? [t];
  const out: string[] = [];
  for (const raw of parts) {
    const s = raw.trim();
    if (!s) continue;
    if (s.length <= 240) {
      out.push(s);
      continue;
    }
    let buf = "";
    for (const seg of s.split(/(?<=[;,])\s+/)) {
      if (buf && (buf + " " + seg).length > 240) {
        out.push(buf.trim());
        buf = seg;
      } else {
        buf = buf ? `${buf} ${seg}` : seg;
      }
    }
    if (buf.trim()) out.push(buf.trim());
  }
  return out;
}

function buildQueue(metas: AudioMeta[]): QueueLesson[] {
  const lessons: QueueLesson[] = [];
  for (const m of metas) {
    const chapters: QueueChapter[] = [];
    for (const ch of m.chapters ?? []) {
      const sentences = splitSentences(ch.script ?? "");
      if (sentences.length) chapters.push({ title: ch.title, sentences });
    }
    if (chapters.length) {
      lessons.push({
        slug: m.slug,
        title: m.title.replace(/\s*—\s*Audio Guide\s*$/i, ""),
        durationSecs: (m.chapters ?? []).reduce(
          (s, c) => s + (c.duration_secs || 0),
          0,
        ),
        chapters,
      });
    }
  }
  return lessons;
}

function readSavedPos(): SavedPos | null {
  try {
    const raw = localStorage.getItem(POS_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as SavedPos;
    if (typeof p?.slug === "string" && typeof p?.chapterIdx === "number")
      return p;
  } catch {
    /* ignore */
  }
  return null;
}

function pickVoice(): SpeechSynthesisVoice | null {
  const vs = window.speechSynthesis.getVoices().filter((v) =>
    v.lang?.toLowerCase().startsWith("en"),
  );
  if (!vs.length) return null;
  const PREF = [
    "Samantha",
    "Google US English",
    "Microsoft Aria",
    "Microsoft Jenny",
    "Daniel",
    "Alex",
  ];
  for (const name of PREF) {
    const hit = vs.find((v) => v.name.includes(name));
    if (hit) return hit;
  }
  return vs.find((v) => v.localService) ?? vs[0];
}

export interface SpeechQueue {
  state: SpeechState;
  lessons: QueueLesson[];
  savedPos: SavedPos | null;
  /** Total estimated seconds across the queued lessons (at 1×). */
  totalSecs: number;
  controls: {
    playPhase: () => void; // resume from saved pos, else from the top
    playFrom: (slug: string) => void;
    toggle: () => void;
    nextChapter: () => void;
    prevChapter: () => void;
    nextLesson: () => void;
    prevLesson: () => void;
    setRate: (r: SpeechRate) => void;
    stop: () => void;
  };
}

export function useSpeechQueue(metas: AudioMeta[]): SpeechQueue {
  const lessons = React.useMemo(() => buildQueue(metas), [metas]);
  const totalSecs = React.useMemo(
    () => lessons.reduce((s, l) => s + l.durationSecs, 0),
    [lessons],
  );

  const supported =
    typeof window !== "undefined" && "speechSynthesis" in window;

  const [state, setState] = React.useState<SpeechState>({
    supported,
    status: "idle",
    lessonIdx: -1,
    chapterIdx: 0,
    sentenceIdx: 0,
    rate: 1,
  });
  const [savedPos, setSavedPos] = React.useState<SavedPos | null>(null);

  // Refs drive the speech callbacks (no stale closures); state mirrors for UI.
  const lessonsRef = React.useRef(lessons);
  lessonsRef.current = lessons;
  const posRef = React.useRef({ li: -1, ci: 0, si: 0 });
  const rateRef = React.useRef<SpeechRate>(1);
  const voiceRef = React.useRef<SpeechSynthesisVoice | null>(null);
  const genRef = React.useRef(0); // bumped on every intentional interruption
  const statusRef = React.useRef<SpeechState["status"]>("idle");

  React.useEffect(() => {
    if (!supported) return;
    setSavedPos(readSavedPos());
    const load = () => {
      voiceRef.current = pickVoice();
    };
    load();
    window.speechSynthesis.addEventListener("voiceschanged", load);
    return () => {
      genRef.current++;
      try {
        window.speechSynthesis.cancel();
      } catch {
        /* ignore */
      }
      window.speechSynthesis.removeEventListener("voiceschanged", load);
    };
  }, [supported]);

  const sync = React.useCallback(() => {
    const { li, ci, si } = posRef.current;
    setState((s) => ({
      ...s,
      status: statusRef.current,
      lessonIdx: li,
      chapterIdx: ci,
      sentenceIdx: si,
      rate: rateRef.current,
    }));
  }, []);

  const persist = React.useCallback(() => {
    const { li, ci } = posRef.current;
    const lesson = lessonsRef.current[li];
    if (!lesson) return;
    const p: SavedPos = { slug: lesson.slug, chapterIdx: ci };
    try {
      localStorage.setItem(POS_KEY, JSON.stringify(p));
    } catch {
      /* ignore */
    }
    setSavedPos(p);
  }, []);

  const setStatus = (s: SpeechState["status"]) => {
    statusRef.current = s;
  };

  const speakCurrent = React.useCallback(() => {
    if (!supported) return;
    const L = lessonsRef.current;
    const { li, ci, si } = posRef.current;
    const lesson = L[li];
    if (!lesson) {
      // End of the whole phase.
      setStatus("idle");
      posRef.current = { li: -1, ci: 0, si: 0 };
      sync();
      return;
    }
    const ch = lesson.chapters[ci];
    if (!ch) {
      // Past this lesson → next lesson, chapter 0.
      posRef.current = { li: li + 1, ci: 0, si: 0 };
      persist();
      speakCurrent();
      return;
    }
    if (si >= ch.sentences.length) {
      // Past this chapter → next chapter (may roll into next lesson).
      posRef.current = { li, ci: ci + 1, si: 0 };
      persist();
      speakCurrent();
      return;
    }
    const myGen = genRef.current;
    const u = new SpeechSynthesisUtterance(ch.sentences[si]);
    u.rate = rateRef.current;
    if (voiceRef.current) u.voice = voiceRef.current;
    const advance = () => {
      if (myGen !== genRef.current) return; // superseded by an intentional jump
      posRef.current = { li, ci, si: si + 1 };
      sync();
      speakCurrent();
    };
    u.onend = advance;
    u.onerror = (e) => {
      if (myGen !== genRef.current) return;
      // Intentional cancels surface as interrupted/canceled — ignore them.
      const err = (e as SpeechSynthesisErrorEvent).error;
      if (err === "interrupted" || err === "canceled") return;
      advance();
    };
    try {
      window.speechSynthesis.speak(u);
    } catch {
      advance();
    }
    sync();
  }, [supported, sync, persist]);

  const jump = React.useCallback(
    (li: number, ci: number) => {
      const L = lessonsRef.current;
      if (!L.length) return;
      genRef.current++;
      if (supported) {
        try {
          window.speechSynthesis.cancel();
        } catch {
          /* ignore */
        }
      }
      const clampedLi = Math.max(0, Math.min(li, L.length - 1));
      const maxCi = Math.max(0, (L[clampedLi]?.chapters.length ?? 1) - 1);
      posRef.current = {
        li: clampedLi,
        ci: Math.max(0, Math.min(ci, maxCi)),
        si: 0,
      };
      persist();
      if (supported) {
        setStatus("playing");
        speakCurrent();
      } else {
        // No SpeechSynthesis → mount a manual, read-along transcript.
        setStatus("paused");
        sync();
      }
    },
    [supported, persist, speakCurrent, sync],
  );

  const controls = React.useMemo<SpeechQueue["controls"]>(
    () => ({
      playPhase: () => {
        const L = lessonsRef.current;
        if (!L.length) return;
        const sp = readSavedPos();
        let li = 0;
        let ci = 0;
        if (sp) {
          const idx = L.findIndex((l) => l.slug === sp.slug);
          if (idx >= 0) {
            li = idx;
            ci = Math.min(
              Math.max(0, sp.chapterIdx),
              L[idx].chapters.length - 1,
            );
          }
        }
        jump(li, ci);
      },
      playFrom: (slug: string) => {
        const idx = lessonsRef.current.findIndex((l) => l.slug === slug);
        if (idx >= 0) jump(idx, 0);
      },
      toggle: () => {
        if (!supported) return;
        const ss = window.speechSynthesis;
        if (statusRef.current === "playing") {
          ss.pause();
          setStatus("paused");
          sync();
        } else if (statusRef.current === "paused") {
          ss.resume();
          setStatus("playing");
          sync();
        } else {
          controls.playPhase();
        }
      },
      nextChapter: () => {
        const { li, ci } = posRef.current;
        if (li < 0) return;
        jump(li, ci + 1);
      },
      prevChapter: () => {
        const { li, ci } = posRef.current;
        if (li < 0) return;
        if (ci > 0) jump(li, ci - 1);
        else if (li > 0)
          jump(
            li - 1,
            Math.max(0, lessonsRef.current[li - 1].chapters.length - 1),
          );
      },
      nextLesson: () => {
        const { li } = posRef.current;
        if (li < 0) return;
        jump(li + 1, 0);
      },
      prevLesson: () => {
        const { li } = posRef.current;
        if (li > 0) jump(li - 1, 0);
        else if (li === 0) jump(0, 0);
      },
      setRate: (r: SpeechRate) => {
        rateRef.current = r;
        try {
          localStorage.setItem("rag:listen:rate", String(r));
        } catch {
          /* ignore */
        }
        if (statusRef.current === "playing") {
          const { li, ci } = posRef.current;
          jump(li, ci); // restart current chapter at the new rate
        } else {
          sync();
        }
      },
      stop: () => {
        genRef.current++;
        try {
          window.speechSynthesis.cancel();
        } catch {
          /* ignore */
        }
        setStatus("idle");
        posRef.current = { li: -1, ci: 0, si: 0 };
        sync();
      },
    }),
    [supported, jump, sync, speakCurrent],
  );

  // Restore saved rate once.
  React.useEffect(() => {
    try {
      const r = Number(localStorage.getItem("rag:listen:rate"));
      if (SPEECH_RATES.includes(r as SpeechRate)) {
        rateRef.current = r as SpeechRate;
        setState((s) => ({ ...s, rate: r as SpeechRate }));
      }
    } catch {
      /* ignore */
    }
  }, []);

  return { state, lessons, savedPos, totalSecs, controls };
}
