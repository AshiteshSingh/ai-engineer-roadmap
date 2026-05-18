"use client";

// Stateful client container: owns the filter state, derives facets /
// filtered+sorted lessons / progress, and wires the controlled PhaseControls
// to the presentational LessonGrid. The only stateful piece of a phase hub.
import * as React from "react";
import { PhaseControls } from "@/components/phase-hub/PhaseControls";
import { LessonGrid } from "@/components/phase-hub/LessonGrid";
import {
  HubAudioProvider,
  PhasePlayAll,
  useHubAudio,
} from "@/components/phase-hub/HubAudio";
import { RagPodcasts } from "@/components/rag-podcasts";
import type { RagPodcast } from "@/lib/db/podcasts";
import { cx } from "@/components/ui";
import { DEFAULT_PHASE_FILTER_STATE } from "@/components/phase-hub/types";
import type {
  Lesson,
  PhaseFilterState,
  AudioMeta,
} from "@/components/phase-hub/types";
import {
  computeFacets,
  computeProgressBySlug,
  filterAndSortLessons,
} from "@/components/phase-hub/filter";
import styles from "./PhaseBrowser.module.css";

export interface PhaseBrowserProps {
  lessons: Lesson[];
  heading?: string;
  /** Defined ⇒ audio feature on (wrap in player provider, render tiles). */
  audioBySlug?: Record<string, AudioMeta>;
  /** Ordered (roadmap order) playable metas — the whole-phase listen queue. */
  audioMetas?: AudioMeta[];
  gradient?: [string, string];
  icon?: string;
  category?: string;
}

// Layout shell that reserves bottom space while the docked speech player
// is mounted. Renders inside HubAudioProvider so it can read play status;
// when audio is off there's no provider and useHubAudio() degrades to the
// idle FALLBACK → no docked class → audio-off hubs stay byte-identical.
function HubLayoutShell({ children }: { children: React.ReactNode }) {
  const { status } = useHubAudio();
  return (
    <div className={cx(styles.layout, status !== "idle" && styles.layoutDocked)}>
      {children}
    </div>
  );
}

export function PhaseBrowser({
  lessons,
  heading = "Lessons in this phase",
  audioBySlug,
  audioMetas,
  gradient,
  icon,
  category,
}: PhaseBrowserProps) {
  const [state, setState] = React.useState<PhaseFilterState>(
    DEFAULT_PHASE_FILTER_STATE,
  );

  const facets = React.useMemo(() => computeFacets(lessons), [lessons]);
  const progressBySlug = React.useMemo(
    () => computeProgressBySlug(lessons),
    [lessons],
  );
  const filtered = React.useMemo(
    () => filterAndSortLessons(lessons, state),
    [lessons, state],
  );

  const inner = (
    <HubLayoutShell>
      <PhaseControls
        state={state}
        facets={facets}
        matchCount={filtered.length}
        onChange={setState}
        onReset={() => setState(DEFAULT_PHASE_FILTER_STATE)}
      />
      {audioBySlug ? <PhasePlayAll phaseName={category} icon={icon} /> : null}
      <LessonGrid
        lessons={filtered}
        progressBySlug={progressBySlug}
        heading={heading}
        audioBySlug={audioBySlug}
      />
    </HubLayoutShell>
  );

  // No provider element when audio is off → other hubs stay byte-identical.
  if (!audioBySlug) return inner;

  return (
    <HubAudioProvider
      metas={audioMetas}
      gradient={gradient}
      icon={icon}
      category={category}
    >
      {inner}
    </HubAudioProvider>
  );
}

PhaseBrowser.displayName = "PhaseBrowser";
