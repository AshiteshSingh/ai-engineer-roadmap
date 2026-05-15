"use client";

import { Handle, Position, type NodeProps, type NodeTypes, type Node } from "@xyflow/react";
import type { RoadmapPhaseNode } from "@/lib/roadmap-flow";
import { navigateToHref } from "./navigate";

// ── Phase / Appendix / Ship node ────────────────────────────────────────────

export function PhaseNode({ data }: NodeProps<Node<RoadmapPhaseNode>>) {
  const { kind, title, phaseLabel, icon, href, lessonCount, totalMinutes, difficultyHint } = data;

  const hasMeta = lessonCount > 0;

  const ariaLabel = hasMeta
    ? `${phaseLabel ? phaseLabel + " — " : ""}${title}: ${lessonCount} lesson${lessonCount !== 1 ? "s" : ""}, ${totalMinutes} minutes, ${difficultyHint}. Open section.`
    : `${title}. ${kind === "ship" ? "You have reached the end of the core path." : "Navigate."}`;

  function handleClick() {
    navigateToHref(href);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      navigateToHref(href);
    }
  }

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

      {/* Icon */}
      <span className="rg-node__icon" aria-hidden="true">{icon}</span>

      {/* Body */}
      <div className="rg-node__body">
        {phaseLabel && (
          <span className="rg-node__eyebrow">{phaseLabel}</span>
        )}
        <span className="rg-node__title">{title}</span>
        {hasMeta && (
          <span className="rg-node__meta">
            {lessonCount} lesson{lessonCount !== 1 ? "s" : ""} · {totalMinutes}m · {difficultyHint}
          </span>
        )}
      </div>

      {/* Chevron */}
      <span className="rg-node__chevron" aria-hidden="true">→</span>
    </div>
  );
}

// ── Entry node (compact pill) ────────────────────────────────────────────────

export function EntryNode({ data }: NodeProps<Node<RoadmapPhaseNode>>) {
  const { title, icon, href } = data;

  function handleClick() {
    navigateToHref(href);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      navigateToHref(href);
    }
  }

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
    </div>
  );
}

// ── NodeTypes registry ───────────────────────────────────────────────────────

export const roadmapNodeTypes: NodeTypes = {
  phaseNode: PhaseNode,
  entryNode: EntryNode,
};
