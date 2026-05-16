"use client";

import { memo } from "react";
import {
  Handle,
  Position,
  type NodeProps,
  type NodeTypes,
  type Node,
} from "@xyflow/react";
import type {
  RoadmapNode,
  RoadmapPhaseNode,
  RoadmapLessonNode,
} from "@/lib/roadmap-flow";
import type { NodeStatus } from "@/lib/roadmap-progress";
import { statusClass } from "@/lib/roadmap-progress";

// Per-node runtime extras injected by the renderer (kept off the pure model).
export interface NodeExtras {
  status: NodeStatus;
  onSelect: (id: string) => void;
}

export type RfNodeData = RoadmapNode & NodeExtras;

const DIFFICULTY_LABEL: Record<string, string> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
  mixed: "Mixed",
};

const STATUS_LABEL: Record<NodeStatus, string> = {
  todo: "Not started",
  "in-progress": "In progress",
  done: "Done",
  skipped: "Skipped",
};

// Pointer activation is handled by ReactFlow's onNodeClick (which also keeps
// .react-flow__node pointer-events enabled); here we only add keyboard
// activation for the focusable inner element.
function useActivate(id: string, onSelect: (id: string) => void) {
  return {
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onSelect(id);
      }
    },
  };
}

// ── Phase / Appendix / Entry / Ship header node ───────────────────────────────

function PhaseNodeImpl({ data }: NodeProps<Node<RfNodeData>>) {
  const d = data as RoadmapPhaseNode & NodeExtras;
  const {
    id,
    kind,
    title,
    phaseLabel,
    icon,
    lessonCount,
    totalMinutes,
    difficultyHint,
  } = d;
  const isMarker = kind === "entry" || kind === "ship";
  const hasMeta = lessonCount > 0;
  const act = useActivate(id, d.onSelect);

  const ariaLabel = isMarker
    ? `${title}. Open details.`
    : `${phaseLabel ? phaseLabel + " — " : ""}${title}: ${lessonCount} lesson${
        lessonCount !== 1 ? "s" : ""
      }, ${totalMinutes} minutes, ${difficultyHint}. Open details.`;

  return (
    <div
      className={`rg-node rg-node--${kind} ${statusClass[d.status] ?? ""}`}
      role="button"
      tabIndex={0}
      aria-label={ariaLabel}
      {...act}
    >
      <Handle type="target" position={Position.Top} id="top" className="rg-handle" />
      <Handle
        type="source"
        position={Position.Bottom}
        id="bottom"
        className="rg-handle"
      />
      <Handle type="source" position={Position.Left} id="left" className="rg-handle" />
      <Handle
        type="source"
        position={Position.Right}
        id="right"
        className="rg-handle"
      />

      <span className="rg-node__icon" aria-hidden="true">
        {icon}
      </span>
      <div className="rg-node__body">
        {phaseLabel && !isMarker && (
          <span className="rg-node__eyebrow">{phaseLabel}</span>
        )}
        <span className="rg-node__title">{title}</span>
        {hasMeta && !isMarker && (
          <span className="rg-node__meta">
            {lessonCount} lesson{lessonCount !== 1 ? "s" : ""} · {totalMinutes}m ·{" "}
            {DIFFICULTY_LABEL[difficultyHint] ?? difficultyHint}
          </span>
        )}
      </div>
      {!isMarker && (
        <span className="rg-node__chevron" aria-hidden="true">
          →
        </span>
      )}
    </div>
  );
}

// ── Lesson node (compact, branches off a phase header) ────────────────────────

function LessonNodeImpl({ data }: NodeProps<Node<RfNodeData>>) {
  const d = data as RoadmapLessonNode & NodeExtras;
  const { id, title, number, difficulty } = d;
  const act = useActivate(id, d.onSelect);

  return (
    <div
      className={`rg-node rg-node--lesson rg-node--diff-${difficulty} ${
        statusClass[d.status] ?? ""
      }`}
      role="button"
      tabIndex={0}
      aria-label={`Lesson ${number}: ${title}. ${STATUS_LABEL[d.status]}. Open details.`}
      {...act}
    >
      <Handle type="target" position={Position.Left} id="left" className="rg-handle" />
      <Handle
        type="target"
        position={Position.Right}
        id="right"
        className="rg-handle"
      />

      <span className="rg-lesson__dot" aria-hidden="true">
        {d.status === "done" ? (
          <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
            <path
              d="M3.5 8.5 6.5 11.5 12.5 4.5"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          </svg>
        ) : (
          <span className="rg-lesson__num">{number}</span>
        )}
      </span>
      <span className="rg-lesson__title">{title}</span>
    </div>
  );
}

export const PhaseNode = memo(PhaseNodeImpl);
export const LessonNode = memo(LessonNodeImpl);

export const roadmapNodeTypes: NodeTypes = {
  phaseNode: PhaseNode,
  entryNode: PhaseNode,
  lessonNode: LessonNode,
};
