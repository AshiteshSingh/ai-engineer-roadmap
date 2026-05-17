"use client";

// Owns the phase hub's continuous Web-Speech playthrough. There is no MP3
// (every lesson is voice:"pending-tts", audio_url:""), so the hub reads each
// chapter's `script` aloud via SpeechSynthesis, auto-advancing sentence →
// chapter → lesson across the WHOLE phase. A single docked HubSpeechPlayer is
// mounted while something is playing. `play(meta)` enters the queue at that
// lesson; `playPhase()` plays/resumes the whole phase from the top.
import * as React from "react";
import type { AudioMeta } from "@/lib/audio";
import { useSpeechQueue, type SavedPos } from "./useSpeechQueue";
import { HubSpeechPlayer } from "./HubSpeechPlayer";

interface HubAudioContextValue {
  /** Slug of the lesson currently being read, or null. */
  activeSlug: string | null;
  /** Enter the continuous queue at this lesson (ListenButton compat). */
  play: (meta: AudioMeta) => void;
  /** Play / resume the whole phase from the top (or saved position). */
  playPhase: () => void;
  status: "idle" | "playing" | "paused";
  /** True when SpeechSynthesis exists (else: read-along transcript only). */
  supported: boolean;
  /** True when the phase has at least one lesson with narration script. */
  hasAudio: boolean;
  /** Estimated total seconds across the queued lessons (at 1×). */
  totalSecs: number;
  savedPos: SavedPos | null;
}

const FALLBACK: HubAudioContextValue = {
  activeSlug: null,
  play: () => {},
  playPhase: () => {},
  status: "idle",
  supported: false,
  hasAudio: false,
  totalSecs: 0,
  savedPos: null,
};

const HubAudioContext = React.createContext<HubAudioContextValue | null>(null);

/** Degrades gracefully (no throw) when used outside a provider, so a
 *  server-rendered card island can never crash the route. */
export function useHubAudio(): HubAudioContextValue {
  return React.useContext(HubAudioContext) ?? FALLBACK;
}

export interface HubAudioProviderProps {
  children: React.ReactNode;
  /** Ordered (roadmap order) AudioMeta for every lesson in the phase. */
  metas?: AudioMeta[];
  gradient?: [string, string];
  icon?: string;
  category?: string;
}

export function HubAudioProvider({
  children,
  metas,
  icon,
}: HubAudioProviderProps) {
  const queue = useSpeechQueue(metas ?? []);
  const { state, lessons, controls, savedPos, totalSecs } = queue;

  const activeSlug =
    state.lessonIdx >= 0 ? lessons[state.lessonIdx]?.slug ?? null : null;

  const value = React.useMemo<HubAudioContextValue>(
    () => ({
      activeSlug,
      play: (m: AudioMeta) => controls.playFrom(m.slug),
      playPhase: controls.playPhase,
      status: state.status,
      supported: state.supported,
      hasAudio: lessons.length > 0,
      totalSecs,
      savedPos,
    }),
    [
      activeSlug,
      controls,
      state.status,
      state.supported,
      lessons.length,
      totalSecs,
      savedPos,
    ],
  );

  return (
    <HubAudioContext.Provider value={value}>
      {children}
      {state.status !== "idle" ? (
        <HubSpeechPlayer queue={queue} icon={icon} />
      ) : null}
    </HubAudioContext.Provider>
  );
}

HubAudioProvider.displayName = "HubAudioProvider";
