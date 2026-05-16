"use client";

/**
 * Roadmap progress — localStorage only, no backend.
 *
 * Tracks per-lesson status (keyed by the lesson node id `lesson-${slug}`).
 * SSR-safe: state starts empty so the server render shows every node neutral;
 * the stored map is read in an effect after mount, so there is no hydration
 * mismatch. Components gate status-dependent visuals on `mounted`.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

export type NodeStatus = "todo" | "in-progress" | "done" | "skipped";

export type ProgressMap = Record<string, NodeStatus>;

const STORAGE_KEY = "ai-roadmap-progress:v1";

const CYCLE: NodeStatus[] = ["todo", "in-progress", "done", "skipped"];

/** Maps a status to a node CSS modifier class (empty for the neutral todo). */
export const statusClass: Record<NodeStatus, string> = {
  todo: "",
  done: "rg-node--done",
  "in-progress": "rg-node--in-progress",
  skipped: "rg-node--skipped",
};

const VALID = new Set<NodeStatus>(CYCLE);

function readStore(): ProgressMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const out: ProgressMap = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "string" && VALID.has(v as NodeStatus)) {
        out[k] = v as NodeStatus;
      }
    }
    return out;
  } catch {
    return {};
  }
}

function writeStore(map: ProgressMap): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* quota / private mode — non-fatal */
  }
}

export interface ProgressStats {
  done: number;
  inProgress: number;
  skipped: number;
  total: number;
  /** Done as a percentage of total. Skipped does NOT count as done. */
  pct: number;
}

export interface UseRoadmapProgress {
  progress: ProgressMap;
  mounted: boolean;
  statusOf: (id: string) => NodeStatus;
  setStatus: (id: string, status: NodeStatus) => void;
  cycleStatus: (id: string) => void;
  reset: () => void;
  stats: ProgressStats;
}

export function useRoadmapProgress(totalLessons: number): UseRoadmapProgress {
  const [progress, setProgress] = useState<ProgressMap>({});
  const [mounted, setMounted] = useState(false);

  // Read persisted state after mount (avoids hydration mismatch).
  useEffect(() => {
    setProgress(readStore());
    setMounted(true);
  }, []);

  // Cross-tab sync.
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === STORAGE_KEY) setProgress(readStore());
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const commit = useCallback((next: ProgressMap) => {
    setProgress(next);
    writeStore(next);
  }, []);

  const setStatus = useCallback(
    (id: string, status: NodeStatus) => {
      setProgress((prev) => {
        const next = { ...prev };
        if (status === "todo") delete next[id];
        else next[id] = status;
        writeStore(next);
        return next;
      });
    },
    [],
  );

  const cycleStatus = useCallback((id: string) => {
    setProgress((prev) => {
      const cur = prev[id] ?? "todo";
      const nextStatus = CYCLE[(CYCLE.indexOf(cur) + 1) % CYCLE.length];
      const next = { ...prev };
      if (nextStatus === "todo") delete next[id];
      else next[id] = nextStatus;
      writeStore(next);
      return next;
    });
  }, []);

  const reset = useCallback(() => commit({}), [commit]);

  const statusOf = useCallback(
    (id: string): NodeStatus => progress[id] ?? "todo",
    [progress],
  );

  const stats = useMemo<ProgressStats>(() => {
    let done = 0;
    let inProgress = 0;
    let skipped = 0;
    for (const v of Object.values(progress)) {
      if (v === "done") done++;
      else if (v === "in-progress") inProgress++;
      else if (v === "skipped") skipped++;
    }
    const total = Math.max(0, totalLessons);
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    return { done, inProgress, skipped, total, pct };
  }, [progress, totalLessons]);

  return {
    progress,
    mounted,
    statusOf,
    setStatus,
    cycleStatus,
    reset,
    stats,
  };
}
