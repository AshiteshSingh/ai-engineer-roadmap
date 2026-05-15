/**
 * SM-2 spaced repetition scheduler — TypeScript port of crates/ml/bkt/src/scheduler.rs.
 *
 * Pure functions, no server dependency. Uses BKT mastery to modulate SM-2 ease factor.
 */

export interface ReviewItem {
  id: string;
  pMastery: number;
  totalInteractions: number;
  lastInteractionAt: Date | null;
}

export interface ReviewScheduleResult {
  id: string;
  nextReviewAt: Date;
  intervalDays: number;
  easeFactor: number;
}

/**
 * Compute the next review date using SM-2 modulated by BKT mastery.
 *
 * Algorithm (mirrors scheduler.rs):
 *   - Base ease = 2.5
 *   - Mastery modulation: ease *= 0.8 + 0.4 * pMastery
 *   - Incorrect: interval = 1d, ease -= 0.2
 *   - Correct SM-2 progression: 1d -> 6d -> prev * ease
 *   - Ease clamped to [1.3, 3.0]
 */
export function computeNextReview(item: ReviewItem): ReviewScheduleResult | null {
  if (!item.lastInteractionAt) return null;

  const { pMastery, totalInteractions } = item;

  let easeFactor = 2.5;
  easeFactor *= 0.8 + 0.4 * pMastery;

  // SM-2 progression based on total interactions
  let intervalDays: number;
  switch (totalInteractions) {
    case 0:
    case 1:
      intervalDays = 1;
      break;
    case 2:
      intervalDays = 6;
      break;
    default: {
      let prev = 6;
      for (let i = 2; i < totalInteractions; i++) {
        prev *= easeFactor;
      }
      intervalDays = prev * easeFactor;
      break;
    }
  }

  // Clamp ease factor
  easeFactor = Math.max(1.3, Math.min(3.0, easeFactor));

  const lastReview = new Date(item.lastInteractionAt);
  const nextReviewAt = new Date(lastReview.getTime() + intervalDays * 86400 * 1000);

  return {
    id: item.id,
    nextReviewAt,
    intervalDays,
    easeFactor,
  };
}

/**
 * Return items that are due for review (nextReviewAt <= now), sorted most overdue first.
 */
export function getDueItems(items: ReviewItem[], now: Date = new Date()): ReviewScheduleResult[] {
  const scheduled: ReviewScheduleResult[] = [];

  for (const item of items) {
    const result = computeNextReview(item);
    if (result && result.nextReviewAt <= now) {
      scheduled.push(result);
    }
  }

  // Most overdue first
  scheduled.sort((a, b) => a.nextReviewAt.getTime() - b.nextReviewAt.getTime());
  return scheduled;
}

/**
 * Get all scheduled reviews (due and upcoming), sorted by next review date.
 */
export function getAllSchedules(items: ReviewItem[]): ReviewScheduleResult[] {
  const scheduled: ReviewScheduleResult[] = [];

  for (const item of items) {
    const result = computeNextReview(item);
    if (result) scheduled.push(result);
  }

  scheduled.sort((a, b) => a.nextReviewAt.getTime() - b.nextReviewAt.getTime());
  return scheduled;
}

/** Format a relative time string (e.g. "2 days ago", "in 3 hours") */
export function formatRelativeTime(date: Date, now: Date = new Date()): string {
  const diffMs = date.getTime() - now.getTime();
  const absDiffMs = Math.abs(diffMs);
  const isPast = diffMs < 0;

  if (absDiffMs < 60 * 1000) return "just now";

  const minutes = Math.floor(absDiffMs / (60 * 1000));
  if (minutes < 60) {
    const label = minutes === 1 ? "minute" : "minutes";
    return isPast ? `${minutes} ${label} ago` : `in ${minutes} ${label}`;
  }

  const hours = Math.floor(absDiffMs / (3600 * 1000));
  if (hours < 24) {
    const label = hours === 1 ? "hour" : "hours";
    return isPast ? `${hours} ${label} ago` : `in ${hours} ${label}`;
  }

  const days = Math.floor(absDiffMs / (86400 * 1000));
  const label = days === 1 ? "day" : "days";
  return isPast ? `${days} ${label} ago` : `in ${days} ${label}`;
}
