"use client";

import {
  Handle,
  Position,
  type Node,
  type NodeProps,
  type NodeTypes,
} from "@xyflow/react";

/* ── Flowchart Node ────────────────────────────────────────── */

type FCNodeData = {
  label: string;
  shape: string;
  accent: string;
  direction: string;
};

function FCNode({ data }: NodeProps<Node<FCNodeData>>) {
  const { label, shape, accent } = data;

  const shapeClass =
    shape === "stadium"
      ? "mermaid-fc-node--stadium"
      : shape === "diamond"
        ? "mermaid-fc-node--diamond"
        : "mermaid-fc-node--rect";

  return (
    <div
      className={`mermaid-fc-node ${shapeClass}`}
      style={{
        border: `1px solid var(--${accent}-7)`,
        backgroundColor: `var(--${accent}-3)`,
        color: `var(--${accent}-12)`,
      }}
    >
      <Handle type="target" position={Position.Top} id="top" className="mermaid-handle" />
      <Handle type="target" position={Position.Left} id="left" className="mermaid-handle" />
      <Handle type="source" position={Position.Bottom} id="bottom" className="mermaid-handle" />
      <Handle type="source" position={Position.Right} id="right" className="mermaid-handle" />
      {shape === "diamond" ? (
        <span className="mermaid-fc-node__diamond-label">{label}</span>
      ) : (
        <span>{label}</span>
      )}
    </div>
  );
}

/* ── Flowchart Circle (START / END) ──────────────────────── */

type FCCircleData = { label: string };

function FCCircle({ data }: NodeProps<Node<FCCircleData>>) {
  return (
    <div className="mermaid-fc-circle">
      <Handle type="target" position={Position.Top} id="top" className="mermaid-handle" />
      <Handle type="target" position={Position.Left} id="left" className="mermaid-handle" />
      <Handle type="source" position={Position.Bottom} id="bottom" className="mermaid-handle" />
      <Handle type="source" position={Position.Right} id="right" className="mermaid-handle" />
      <span>{data.label}</span>
    </div>
  );
}

/* ── Subgraph label ──────────────────────────────────────── */

type LabelData = { label: string };

function MermaidLabel({ data }: NodeProps<Node<LabelData>>) {
  return (
    <div className="mermaid-sg-label">{data.label}</div>
  );
}

/* ── Sequence Participant ────────────────────────────────── */

type SeqParticipantData = { alias: string };

function SeqParticipant({ data }: NodeProps<Node<SeqParticipantData>>) {
  return (
    <div className="mermaid-seq-participant">
      <Handle type="source" position={Position.Bottom} id="bottom" className="mermaid-handle" />
      <span>{data.alias}</span>
    </div>
  );
}

/* ── Sequence Waypoint (invisible anchor for message edges) ─ */

function SeqWaypoint() {
  return (
    <div style={{ width: 1, height: 1 }}>
      <Handle type="target" position={Position.Left} id="left" className="mermaid-handle" />
      <Handle type="target" position={Position.Right} id="right" className="mermaid-handle" />
      <Handle type="source" position={Position.Left} id="src-left" className="mermaid-handle" />
      <Handle type="source" position={Position.Right} id="src-right" className="mermaid-handle" />
    </div>
  );
}

/* ── Sequence Lifeline (vertical dashed line) ──────────── */

type LifelineData = { height: number };

function SeqLifeline({ data }: NodeProps<Node<LifelineData>>) {
  return (
    <div className="mermaid-seq-lifeline" style={{ height: data.height }} />
  );
}

/* ── ER Entity ──────────────────────────────────────────── */

type EREntityData = {
  name: string;
  attributes: { type: string; name: string; constraint?: string }[];
};

function EREntity({ data }: NodeProps<Node<EREntityData>>) {
  return (
    <div className="mermaid-er-entity">
      <Handle type="target" position={Position.Left} id="left" className="mermaid-handle" />
      <Handle type="target" position={Position.Top} id="top" className="mermaid-handle" />
      <Handle type="source" position={Position.Right} id="right" className="mermaid-handle" />
      <Handle type="source" position={Position.Bottom} id="bottom" className="mermaid-handle" />
      <div className="mermaid-er-entity__header">{data.name}</div>
      {data.attributes.map((attr, i) => (
        <div key={i} className="mermaid-er-entity__row">
          <span className="mermaid-er-entity__type">{attr.type}</span>
          <span className="mermaid-er-entity__name">{attr.name}</span>
          {attr.constraint && (
            <span className="mermaid-er-entity__badge">{attr.constraint}</span>
          )}
        </div>
      ))}
    </div>
  );
}

/* ── Export all types ────────────────────────────────────── */

export const mermaidNodeTypes: NodeTypes = {
  fcNode: FCNode,
  fcCircle: FCCircle,
  mermaidLabel: MermaidLabel,
  seqParticipant: SeqParticipant,
  seqWaypoint: SeqWaypoint,
  seqLifeline: SeqLifeline,
  erEntity: EREntity,
};
