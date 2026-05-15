// Pure, dependency-free filter/sort/derive helpers for the evals browser.
// No React, no DOM — safe to unit-test and to call from client or server.
import type {
  Lesson,
  Difficulty,
  EvalsFilterState,
  EvalsFacets,
} from "@/components/evals/types";

const DIFFICULTY_RANK: Record<Difficulty, number> = {
  beginner: 0,
  intermediate: 1,
  advanced: 2,
};

/** Unfiltered facets: per-difficulty counts + total reading minutes. */
export function computeFacets(lessons: Lesson[]): EvalsFacets {
  const countsByDifficulty: Record<Difficulty, number> = {
    beginner: 0,
    intermediate: 0,
    advanced: 0,
  };
  let totalMinutes = 0;
  for (const l of lessons) {
    countsByDifficulty[l.difficulty] += 1;
    totalMinutes += l.readingTimeMin;
  }
  return { total: lessons.length, countsByDifficulty, totalMinutes };
}

/** Apply the query + difficulty filters, then the chosen sort. Pure. */
export function filterAndSortLessons(
  lessons: Lesson[],
  state: EvalsFilterState,
): Lesson[] {
  const q = state.query.trim().toLowerCase();
  const filtered = lessons.filter((l) => {
    if (
      state.difficulties.length > 0 &&
      !state.difficulties.includes(l.difficulty)
    ) {
      return false;
    }
    if (q) {
      const haystack = `${l.title} ${l.excerpt}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  const sorted = [...filtered];
  switch (state.sort) {
    case "number-asc":
      sorted.sort((a, b) => a.number - b.number);
      break;
    case "number-desc":
      sorted.sort((a, b) => b.number - a.number);
      break;
    case "title-asc":
      sorted.sort((a, b) => a.title.localeCompare(b.title));
      break;
    case "reading-asc":
      sorted.sort(
        (a, b) => a.readingTimeMin - b.readingTimeMin || a.number - b.number,
      );
      break;
    case "reading-desc":
      sorted.sort(
        (a, b) => b.readingTimeMin - a.readingTimeMin || a.number - b.number,
      );
      break;
    case "difficulty-asc":
      sorted.sort(
        (a, b) =>
          DIFFICULTY_RANK[a.difficulty] - DIFFICULTY_RANK[b.difficulty] ||
          a.number - b.number,
      );
      break;
  }
  return sorted;
}

/**
 * Deterministic "reading weight" indicator (0-100): each lesson's reading
 * time relative to the longest lesson in the set. Drives the card progress
 * bar — a stable visual cue with no client state, swappable later for real
 * per-user progress without touching the presentational components.
 */
export function computeProgressBySlug(
  lessons: Lesson[],
): Record<string, number> {
  const max = lessons.reduce((m, l) => Math.max(m, l.readingTimeMin), 0) || 1;
  const out: Record<string, number> = {};
  for (const l of lessons) {
    out[l.slug] = Math.round((l.readingTimeMin / max) * 100);
  }
  return out;
}
