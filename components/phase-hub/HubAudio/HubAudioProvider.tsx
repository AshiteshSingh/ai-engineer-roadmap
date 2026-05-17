"use client";

// Owns "which lesson is currently docked in the player" for a phase hub.
// A single <AudioPlayer> is mounted (keyed by slug) so picking another card
// swaps the track: the previous <audio> unmounts/stops and the new one
// autoplays, resuming its own per-slug position via the player's existing
// localStorage + D1 logic. The player itself is a fixed bottom bar.
import * as React from "react";
import type { AudioMeta } from "@/lib/audio";
import { AudioPlayer } from "@/components/audio-player";

interface HubAudioContextValue {
  /** Slug of the lesson currently docked in the player, or null. */
  activeSlug: string | null;
  /** Dock + autoplay a lesson. No-op if it's already the active one. */
  play: (meta: AudioMeta) => void;
}

const FALLBACK: HubAudioContextValue = { activeSlug: null, play: () => {} };

const HubAudioContext = React.createContext<HubAudioContextValue | null>(null);

/** Degrades gracefully (no throw) when used outside a provider, so a
 *  server-rendered card island can never crash the route. */
export function useHubAudio(): HubAudioContextValue {
  return React.useContext(HubAudioContext) ?? FALLBACK;
}

export interface HubAudioProviderProps {
  children: React.ReactNode;
  gradient?: [string, string];
  icon?: string;
  category?: string;
}

export function HubAudioProvider({
  children,
  gradient,
  icon,
  category,
}: HubAudioProviderProps) {
  const [active, setActive] = React.useState<AudioMeta | null>(null);

  const play = React.useCallback((meta: AudioMeta) => {
    setActive((prev) => (prev?.slug === meta.slug ? prev : meta));
  }, []);

  const value = React.useMemo<HubAudioContextValue>(
    () => ({ activeSlug: active?.slug ?? null, play }),
    [active, play],
  );

  return (
    <HubAudioContext.Provider value={value}>
      {children}
      {active ? (
        <AudioPlayer
          key={active.slug}
          meta={active}
          autoPlay
          gradient={gradient}
          icon={icon}
          category={category}
        />
      ) : null}
    </HubAudioContext.Provider>
  );
}

HubAudioProvider.displayName = "HubAudioProvider";
