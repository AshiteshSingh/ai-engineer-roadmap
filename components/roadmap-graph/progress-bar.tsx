"use client";

import type { ProgressStats } from "@/lib/roadmap-progress";

interface Props {
  stats: ProgressStats;
  mounted: boolean;
  onReset: () => void;
}

/**
 * Sticky progress summary above the roadmap. Renders neutral (0%) until the
 * store is mounted so the server HTML carries no progress state.
 */
export function RoadmapProgressBar({ stats, mounted, onReset }: Props) {
  const { done, inProgress, skipped, total, pct } = stats;
  const shownPct = mounted ? pct : 0;
  const skippedPct = mounted && total > 0 ? Math.round((skipped / total) * 100) : 0;

  return (
    <div className="rg-progress" data-mounted={mounted ? "true" : "false"}>
      <div className="rg-progress__head">
        <span className="rg-progress__pct">{shownPct}%</span>
        <span className="rg-progress__label">complete</span>
        <span className="rg-progress__counts">
          {mounted ? (
            <>
              <span className="rg-progress__count rg-progress__count--done">
                {done} done
              </span>
              <span aria-hidden="true">·</span>
              <span className="rg-progress__count rg-progress__count--doing">
                {inProgress} in progress
              </span>
              <span aria-hidden="true">·</span>
              <span className="rg-progress__count rg-progress__count--skip">
                {skipped} skipped
              </span>
              <span aria-hidden="true">·</span>
              <span className="rg-progress__count">{total} total</span>
            </>
          ) : (
            <span className="rg-progress__count">{total} lessons</span>
          )}
        </span>
        {mounted && (done > 0 || inProgress > 0 || skipped > 0) && (
          <button
            type="button"
            className="rg-progress__reset"
            onClick={onReset}
          >
            Reset progress
          </button>
        )}
      </div>
      <div
        className="rg-progress__track"
        role="progressbar"
        aria-valuenow={shownPct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Roadmap progress: ${shownPct}% complete`}
      >
        <div
          className="rg-progress__fill"
          style={{ width: `${shownPct}%` }}
        />
        <div
          className="rg-progress__fill rg-progress__fill--skip"
          style={{ left: `${shownPct}%`, width: `${skippedPct}%` }}
        />
      </div>
    </div>
  );
}
