import type { Node, Edge } from "@xyflow/react";
import type { ERDiagramAST } from "./parser";

/* ── Constants ─────────────────────────────────────────────── */

const ENTITY_W = 220;
const HEADER_H = 34;
const ROW_H = 24;
const PAD_BOTTOM = 8;
const GRID_GAP_X = 100;
const GRID_GAP_Y = 80;
const GRID_COLS = 3;

/* ── Cardinality label mapping ────────────────────────────── */

function cardLabel(cardinality: string): [string, string] {
  // Translate mermaid ER cardinality to human-readable
  if (cardinality.includes("||") && cardinality.includes("o{"))
    return ["1", "0..*"];
  if (cardinality.includes("||") && cardinality.includes("{"))
    return ["1", "*"];
  if (cardinality.includes("|o") && cardinality.includes("o{"))
    return ["0..1", "0..*"];
  if (cardinality.includes("||") && cardinality.includes("|"))
    return ["1", "1"];
  return ["", ""];
}

/* ── Layout ────────────────────────────────────────────────── */

export function layoutER(
  ast: ERDiagramAST,
): { nodes: Node[]; edges: Edge[]; height: number } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  // ── Entity positions (grid layout) ──

  const entityH = (attrCount: number) =>
    HEADER_H + attrCount * ROW_H + PAD_BOTTOM;

  const entityPos = new Map<string, { x: number; y: number; h: number }>();

  // Place entities that appear in relations first (for better layout)
  const ordered: string[] = [];
  const seen = new Set<string>();
  for (const r of ast.relations) {
    if (!seen.has(r.from)) { seen.add(r.from); ordered.push(r.from); }
    if (!seen.has(r.to)) { seen.add(r.to); ordered.push(r.to); }
  }
  for (const e of ast.entities) {
    if (!seen.has(e.name)) { seen.add(e.name); ordered.push(e.name); }
  }

  const entityMap = new Map(ast.entities.map((e) => [e.name, e]));

  // Track max height per row for vertical alignment
  const rowMaxH: number[] = [];

  for (let i = 0; i < ordered.length; i++) {
    const name = ordered[i];
    const entity = entityMap.get(name);
    const h = entityH(entity?.attributes.length ?? 0);
    const row = Math.floor(i / GRID_COLS);
    const col = i % GRID_COLS;

    if (!rowMaxH[row] || h > rowMaxH[row]) rowMaxH[row] = h;

    entityPos.set(name, { x: col * (ENTITY_W + GRID_GAP_X), y: -1, h });
  }

  // Second pass: compute y from accumulated row heights
  let yAccum = 0;
  for (let row = 0; row < rowMaxH.length; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      const idx = row * GRID_COLS + col;
      if (idx >= ordered.length) break;
      const pos = entityPos.get(ordered[idx])!;
      pos.y = yAccum;
    }
    yAccum += (rowMaxH[row] || 60) + GRID_GAP_Y;
  }

  // ── Entity nodes ──

  for (const name of ordered) {
    const entity = entityMap.get(name);
    const pos = entityPos.get(name)!;
    nodes.push({
      id: `er-${name}`,
      type: "erEntity",
      position: { x: pos.x, y: pos.y },
      data: {
        name,
        attributes: entity?.attributes ?? [],
      },
      draggable: false,
      style: { width: ENTITY_W },
    });
  }

  // ── Relation edges ──

  for (let i = 0; i < ast.relations.length; i++) {
    const rel = ast.relations[i];
    const fromPos = entityPos.get(rel.from);
    const toPos = entityPos.get(rel.to);
    if (!fromPos || !toPos) continue;

    // Pick handles based on relative position
    const goesRight = toPos.x > fromPos.x;
    const goesDown = toPos.y > fromPos.y;
    const sameRow = Math.abs(toPos.y - fromPos.y) < GRID_GAP_Y;

    let sourceHandle: string;
    let targetHandle: string;
    if (sameRow) {
      sourceHandle = goesRight ? "right" : "left";
      targetHandle = goesRight ? "left" : "right";
    } else {
      sourceHandle = goesDown ? "bottom" : "top";
      targetHandle = goesDown ? "top" : "bottom";
    }

    const [, toCard] = cardLabel(rel.cardinality);

    edges.push({
      id: `er-e-${i}`,
      source: `er-${rel.from}`,
      target: `er-${rel.to}`,
      sourceHandle,
      targetHandle,
      type: "smoothstep",
      label: `${rel.label} ${toCard}`.trim(),
      labelStyle: { fontSize: 10, fontWeight: 500, fill: "var(--gray-10)" },
      labelBgStyle: { fill: "var(--gray-1)", fillOpacity: 0.9 },
      labelBgPadding: [4, 3] as [number, number],
      labelBgBorderRadius: 3,
      style: { stroke: "var(--gray-7)", strokeWidth: 1.5 },
    });
  }

  // ── Auto-height ──

  const maxY = Math.max(
    ...nodes.map((n) => (n.position?.y ?? 0) + (entityPos.get(n.id.replace("er-", ""))?.h ?? 60)),
    200,
  );
  const height = Math.min(maxY + 80, 600);

  return { nodes, edges, height };
}
