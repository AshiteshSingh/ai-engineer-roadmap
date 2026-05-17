"use client";

// Stateful client container: owns the filter state, derives facets /
// filtered+sorted lessons / progress, and wires the controlled PhaseControls
// to the presentational LessonGrid. The only stateful piece of a phase hub.
import * as React from "react";
import { PhaseControls } from "@/components/phase-hub/PhaseControls";
import { LessonGrid } from "@/components/phase-hub/LessonGrid";
import { DEFAULT_PHASE_FILTER_STATE } from "@/components/phase-hub/types";
import type { Lesson, PhaseFilterState } from "@/components/phase-hub/types";
import {
  computeFacets,
  computeProgressBySlug,
  filterAndSortLessons,
} from "@/components/phase-hub/filter";
import styles from "./PhaseBrowser.module.css";

export interface PhaseBrowserProps {
  lessons: Lesson[];
  heading?: string;
}

export function PhaseBrowser({
  lessons,
  heading = "Lessons in this phase",
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

  return (
    <div className={styles.layout}>
      <PhaseControls
        state={state}
        facets={facets}
        matchCount={filtered.length}
        onChange={setState}
        onReset={() => setState(DEFAULT_PHASE_FILTER_STATE)}
      />
      <LessonGrid
        lessons={filtered}
        progressBySlug={progressBySlug}
        heading={heading}
      />
    </div>
  );
}

PhaseBrowser.displayName = "PhaseBrowser";
