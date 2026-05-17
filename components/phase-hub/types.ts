// SHARED CONTRACTS for the reusable phase-hub suite (powers /evals, /rag, …).
// Single-writer: integrator only. Read-only for the presentational teams
// (PhaseHero / LessonCard / LessonGrid / PhaseControls). Every team imports
// from "@/components/phase-hub/types" + "@/components/ui" only.
import type { Lesson, CategoryMeta } from "@/lib/data";

export type { Lesson, CategoryMeta } from "@/lib/data";

/** Difficulty union, re-stated locally so teams don't reach into lib internals. */
export type Difficulty = "beginner" | "intermediate" | "advanced";

/** Sort options exposed by the controls. */
export type SortKey =
  | "number-asc"
  | "number-desc"
  | "title-asc"
  | "reading-asc"
  | "reading-desc"
  | "difficulty-asc";

/** The full client filter/sort state. Owned by PhaseBrowser (integrator). */
export interface PhaseFilterState {
  /** Free-text query matched against title + excerpt (case-insensitive). */
  query: string;
  /** Empty array = "all difficulties". */
  difficulties: Difficulty[];
  /** Active sort. */
  sort: SortKey;
}

/** Derived facet data for rendering control affordances (counts, etc.). */
export interface PhaseFacets {
  total: number;
  /** Count of lessons per difficulty across the UNFILTERED set. */
  countsByDifficulty: Record<Difficulty, number>;
  /** Sum of readingTimeMin across the UNFILTERED set. */
  totalMinutes: number;
}

/** Default initial state (re-used by PhaseBrowser; safe for teams to read). */
export const DEFAULT_PHASE_FILTER_STATE: PhaseFilterState = {
  query: "",
  difficulties: [],
  sort: "number-asc",
};

/** Human labels for difficulty (single source of truth for all teams). */
export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
};

/** Ordered sort options with labels (for the sort control). */
export const SORT_OPTIONS: ReadonlyArray<{ value: SortKey; label: string }> = [
  { value: "number-asc", label: "Lesson order" },
  { value: "number-desc", label: "Lesson order (reverse)" },
  { value: "title-asc", label: "Title A→Z" },
  { value: "reading-asc", label: "Shortest first" },
  { value: "reading-desc", label: "Longest first" },
  { value: "difficulty-asc", label: "Easiest first" },
];

/* ---------- Component prop contracts (one per team) ---------- */

/** TEAM 1 — PhaseHero (presentational, server-safe; NO "use client"). */
export interface PhaseHeroProps {
  /** Display title (the human category name). */
  category: string;
  meta: CategoryMeta;
  lessonCount: number;
  totalMinutes: number;
  /** Breadcrumb href back to the category section on home. */
  categoryHref: string;
  className?: string;
}

/** TEAM 2 — LessonCard (presentational, server-safe). Renders ONE lesson.
 *  `progressPercent` is the reading/progress indicator (0-100);
 *  pass undefined to render no progress bar. */
export interface LessonCardProps {
  lesson: Lesson;
  progressPercent?: number;
  className?: string;
}

/** TEAM 2 — LessonGrid (presentational, server-safe). Pure: receives
 *  already-filtered, already-sorted lessons. Renders an empty state
 *  when lessons is empty. */
export interface LessonGridProps {
  lessons: Lesson[];
  /** Map slug -> progress percent (0-100). Optional. */
  progressBySlug?: Record<string, number>;
  /** Section label above the grid (e.g. "Lessons in this phase"). */
  heading?: string;
  className?: string;
}

/** TEAM 3 — PhaseControls ("use client", CONTROLLED, owns NO state).
 *  Renders search box, difficulty toggles, sort select, result count.
 *  Emits the FULL next state via onChange. */
export interface PhaseControlsProps {
  /** Current state (owned by parent PhaseBrowser). */
  state: PhaseFilterState;
  /** Facets for counts/affordances (unfiltered totals). */
  facets: PhaseFacets;
  /** Number of lessons currently matching (filtered count) — for the
   *  "Showing N of M" line. Parent computes this. */
  matchCount: number;
  /** Emits the complete next PhaseFilterState. */
  onChange: (next: PhaseFilterState) => void;
  /** Resets to DEFAULT_PHASE_FILTER_STATE. Parent supplies handler. */
  onReset: () => void;
  className?: string;
}
