"use client";

import { Handle, Position, type NodeProps, type NodeTypes, type Node } from "@xyflow/react";
import type { RoadmapPhaseNode } from "@/lib/roadmap-flow";
import { navigateToHref } from "./navigate";

// ── Difficulty → short label + modifier ──────────────────────────────────────

const DIFFICULTY_LABEL: Record<RoadmapPhaseNode["difficultyHint"], string> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
  mixed: "Mixed",
};

function useNav(href: string) {
  function handleClick() {
    navigateToHref(href);
  }
  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      navigateToHref(href);
    }
  }
  return { handleClick, handleKeyDown };
}

// ── Phase / Appendix / Ship node ─────────────────────────────────────────────

export function PhaseNode({ data }: NodeProps<Node<RoadmapPhaseNode>>) {
  const {
    kind,
    title,
    phaseLabel,
    icon,
    href,
    lessonCount,
    totalMinutes,
    difficultyHint,
  } = data;

  const hasMeta = lessonCount > 0;
  const isAppendix = kind === "appendix";
  const isShip = kind === "ship";

  const ariaLabel = hasMeta
    ? `${phaseLabel ? phaseLabel + " — " : ""}${title}: ${lessonCount} lesson${lessonCount !== 1 ? "s" : ""}, ${totalMinutes} minutes, ${difficultyHint}. Open section.`
    : `${title}. ${isShip ? "You have reached the end of the core path." : "Navigate."}`;

  const { handleClick, handleKeyDown } = useNav(href);

  // Derive a station index from the phase label ("Phase 3 · …" → "3")
  const stationMark =
    phaseLabel?.match(/\d+/)?.[0] ??
    (isAppendix ? "+" : isShip ? "★" : "•");

  return (
    <div
      className={`rg-node rg-node--${kind}`}
      role="link"
      tabIndex={0}
      aria-label={ariaLabel}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    >
      {/* Handles */}
      <Handle type="target" position={Position.Top} id="top" className="rg-handle" />
      <Handle type="target" position={Position.Left} id="left" className="rg-handle" />
      <Handle type="source" position={Position.Bottom} id="bottom" className="rg-handle" />
      <Handle type="source" position={Position.Right} id="right" className="rg-handle" />

      {/* Accent rail */}
      <span className="rg-node__rail" aria-hidden="true" />

      {/* Station marker + icon */}
      <span className="rg-node__marker" aria-hidden="true">
        <span className="rg-node__mark">{stationMark}</span>
        <span className="rg-node__icon">{icon}</span>
      </span>

      {/* Body */}
      <div className="rg-node__body">
        {phaseLabel && <span className="rg-node__eyebrow">{phaseLabel}</span>}
        <span className="rg-node__title">{title}</span>
        {hasMeta && (
          <span className="rg-node__meta">
            <span className="rg-node__stat">
              {lessonCount} lesson{lessonCount !== 1 ? "s" : ""}
            </span>
            <span className="rg-node__dot" aria-hidden="true" />
            <span className="rg-node__stat">{totalMinutes}m</span>
            <span
              className={`rg-chip rg-chip--${difficultyHint}`}
              data-difficulty={difficultyHint}
            >
              {DIFFICULTY_LABEL[difficultyHint]}
            </span>
          </span>
        )}
      </div>

      {/* Chevron */}
      <span className="rg-node__chevron" aria-hidden="true">
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
          <path
            d="M6 3.5 10.5 8 6 12.5"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    </div>
  );
}

// ── Entry node (bold launch pill) ────────────────────────────────────────────

export function EntryNode({ data }: NodeProps<Node<RoadmapPhaseNode>>) {
  const { title, icon, href } = data;
  const { handleClick, handleKeyDown } = useNav(href);

  return (
    <div
      className="rg-node rg-node--entry"
      role="link"
      tabIndex={0}
      aria-label={`${title} — begin the roadmap`}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    >
      <Handle type="source" position={Position.Bottom} id="bottom" className="rg-handle" />
      <Handle type="source" position={Position.Right} id="right" className="rg-handle" />

      <span className="rg-node__icon" aria-hidden="true">{icon}</span>
      <div className="rg-node__body">
        <span className="rg-node__title">{title}</span>
      </div>
      <span className="rg-node__pulse" aria-hidden="true" />
    </div>
  );
}

// ── NodeTypes registry ───────────────────────────────────────────────────────

export const roadmapNodeTypes: NodeTypes = {
  phaseNode: PhaseNode,
  entryNode: EntryNode,
};
