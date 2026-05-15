import { MarkerType, type Node, type Edge } from "@xyflow/react";
import type { SequenceDiagramAST } from "./parser";

/* ── Constants ─────────────────────────────────────────────── */

const COL_GAP = 200;
const ROW_H = 50;
const HEADER_H = 40;
const PARTICIPANT_W = 140;
const LIFELINE_TOP = HEADER_H + 10;

/* ── Layout ────────────────────────────────────────────────── */

export function layoutSequence(
  ast: SequenceDiagramAST,
): { nodes: Node[]; edges: Edge[]; height: number } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  const colOf = new Map<string, number>();
  ast.participants.forEach((p, i) => colOf.set(p.id, i));

  const msgCount = ast.messages.length;
  const lifelineH = msgCount * ROW_H + 30;
  const totalH = LIFELINE_TOP + lifelineH + 20;

  // ── Participant header nodes ──

  for (const p of ast.participants) {
    const col = colOf.get(p.id)!;
    nodes.push({
      id: `p-${p.id}`,
      type: "seqParticipant",
      position: { x: col * COL_GAP, y: 0 },
      data: { alias: p.alias },
      draggable: false,
      style: { width: PARTICIPANT_W },
    });
  }

  // ── Lifeline nodes (visual only — vertical dashed lines) ──

  for (const p of ast.participants) {
    const col = colOf.get(p.id)!;
    nodes.push({
      id: `ll-${p.id}`,
      type: "seqLifeline",
      position: {
        x: col * COL_GAP + PARTICIPANT_W / 2,
        y: LIFELINE_TOP,
      },
      data: { height: lifelineH },
      draggable: false,
      selectable: false,
      connectable: false,
    });
  }

  // ── Waypoint nodes + message edges ──

  for (let i = 0; i < msgCount; i++) {
    const msg = ast.messages[i];
    const fromCol = colOf.get(msg.from) ?? 0;
    const toCol = colOf.get(msg.to) ?? 0;
    const y = LIFELINE_TOP + 15 + i * ROW_H;

    // Source waypoint
    const srcId = `wp-${i}-src`;
    nodes.push({
      id: srcId,
      type: "seqWaypoint",
      position: { x: fromCol * COL_GAP + PARTICIPANT_W / 2, y },
      data: {},
      draggable: false,
      selectable: false,
      connectable: false,
    });

    // Target waypoint
    const tgtId = `wp-${i}-tgt`;
    nodes.push({
      id: tgtId,
      type: "seqWaypoint",
      position: { x: toCol * COL_GAP + PARTICIPANT_W / 2, y },
      data: {},
      draggable: false,
      selectable: false,
      connectable: false,
    });

    // Edge between waypoints
    const goesRight = toCol > fromCol;
    edges.push({
      id: `msg-${i}`,
      source: srcId,
      target: tgtId,
      sourceHandle: goesRight ? "src-right" : "src-left",
      targetHandle: goesRight ? "left" : "right",
      type: "straight",
      label: msg.text,
      labelStyle: {
        fontSize: 11,
        fontWeight: 500,
        fill: "var(--gray-12)",
      },
      labelBgStyle: { fill: "var(--gray-1)", fillOpacity: 0.9 },
      labelBgPadding: [6, 3] as [number, number],
      labelBgBorderRadius: 3,
      style: {
        stroke: "var(--cyan-8)",
        strokeWidth: 2,
        ...(msg.lineStyle === "dashed" && { strokeDasharray: "6 3" }),
      },
      markerEnd: { type: MarkerType.ArrowClosed, color: "var(--cyan-8)" },
    });
  }

  const height = Math.min(Math.max(totalH + 40, 250), 600);
  return { nodes, edges, height };
}
