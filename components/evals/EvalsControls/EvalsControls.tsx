"use client";

import * as React from "react";
import { Pill, Button } from "@/components/ui";
import { DIFFICULTY_LABEL, SORT_OPTIONS } from "@/components/evals/types";
import type {
  EvalsControlsProps,
  Difficulty,
  SortKey,
} from "@/components/evals/types";
import styles from "./EvalsControls.module.css";

/** Tiny inline class joiner (cannot import components/ui/cx here). */
function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

const DIFFICULTIES: readonly Difficulty[] = [
  "beginner",
  "intermediate",
  "advanced",
];

const SEARCH_INPUT_ID = "evals-controls-search";

export const EvalsControls = React.forwardRef<
  HTMLDivElement,
  EvalsControlsProps
>(function EvalsControls(
  { state, facets, matchCount, onChange, onReset, className },
  ref,
) {
  const toggleDifficulty = (d: Difficulty) => {
    const has = state.difficulties.includes(d);
    const next = has
      ? state.difficulties.filter((x) => x !== d)
      : [...state.difficulties, d];
    onChange({ ...state, difficulties: next });
  };

  const isDefault =
    state.query === "" &&
    state.difficulties.length === 0 &&
    state.sort === "number-asc";

  return (
    <div
      ref={ref}
      role="search"
      className={cx(styles.controls, className)}
    >
      <div className={styles.group}>
        <label htmlFor={SEARCH_INPUT_ID} className={styles.visuallyHidden}>
          Search lessons
        </label>
        <input
          id={SEARCH_INPUT_ID}
          type="search"
          className={styles.search}
          placeholder="Search lessons"
          value={state.query}
          onChange={(e) =>
            onChange({ ...state, query: e.target.value })
          }
        />
      </div>

      <div
        className={styles.group}
        role="group"
        aria-label="Filter by difficulty"
      >
        {DIFFICULTIES.map((d) => (
          <Pill
            key={d}
            active={state.difficulties.includes(d)}
            onClick={() => toggleDifficulty(d)}
          >
            {`${DIFFICULTY_LABEL[d]} (${facets.countsByDifficulty[d]})`}
          </Pill>
        ))}
      </div>

      <div className={styles.group}>
        <select
          className={styles.select}
          aria-label="Sort lessons"
          value={state.sort}
          onChange={(e) =>
            onChange({ ...state, sort: e.target.value as SortKey })
          }
        >
          {SORT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {!isDefault && (
        <Button variant="ghost" onClick={onReset}>
          Reset
        </Button>
      )}

      <p className={styles.count} aria-live="polite">
        Showing {matchCount} of {facets.total}
      </p>
    </div>
  );
});

EvalsControls.displayName = "EvalsControls";
