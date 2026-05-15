"use client";

// Stateful client container: owns the filter state, derives facets /
// filtered+sorted lessons / progress, and wires the controlled EvalsControls
// to the presentational LessonGrid. The only stateful piece of /evals/v2.
import * as React from "react";
import { EvalsControls } from "@/components/evals/EvalsControls";
import { LessonGrid } from "@/components/evals/LessonGrid";
import { DEFAULT_EVALS_FILTER_STATE } from "@/components/evals/types";
import type { Lesson, EvalsFilterState } from "@/components/evals/types";
import {
  computeFacets,
  computeProgressBySlug,
  filterAndSortLessons,
} from "@/components/evals/filter";
import styles from "./EvalsBrowser.module.css";

export interface EvalsBrowserProps {
  lessons: Lesson[];
  heading?: string;
}

export function EvalsBrowser({
  lessons,
  heading = "Lessons in this phase",
}: EvalsBrowserProps) {
  const [state, setState] = React.useState<EvalsFilterState>(
    DEFAULT_EVALS_FILTER_STATE,
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
      <EvalsControls
        state={state}
        facets={facets}
        matchCount={filtered.length}
        onChange={setState}
        onReset={() => setState(DEFAULT_EVALS_FILTER_STATE)}
      />
      <LessonGrid
        lessons={filtered}
        progressBySlug={progressBySlug}
        heading={heading}
      />
    </div>
  );
}

EvalsBrowser.displayName = "EvalsBrowser";
