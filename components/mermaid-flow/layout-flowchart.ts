import type { Node, Edge } from "@xyflow/react";
import type { FlowchartAST, FlowEdgeDef } from "./parser";

/* ── Constants ─────────────────────────────────────────────── */

const NODE_W = 180;
const NODE_H = 44;
const LAYER_GAP = 80;
const SIBLING_GAP = 28;
const SG_PAD_X = 30;
const SG_PAD_Y = 50; // extra top padding for label
const SG_PAD_BOTTOM = 20;

/* ── Mermaid hex → Radix accent ──────────────────────────── */

const HEX_TO_ACCENT: Record<string, string> = {
  "#f9f": "pink",
  "#bbf": "indigo",
  "#fbb": "red",
  "#bfb": "green",
  "#9cf": "cyan",
  "#ff9": "amber",
};

function resolveAccent(
  nodeId: string,
  styles: Map<string, Record<string, string>>,
): string {
  const fill = styles.get(nodeId)?.fill;
  if (!fill) return "violet";
  return HEX_TO_ACCENT[fill.toLowerCase()] ?? "violet";
}

/* ── Back-edge detection (DFS) ────────────────────────────── */

function splitEdges(
  nodeIds: string[],
  edges: FlowEdgeDef[],
): { forward: FlowEdgeDef[]; back: FlowEdgeDef[] } {
  const adj = new Map<string, string[]>();
  for (const id of nodeIds) adj.set(id, []);
  for (const e of edges) adj.get(e.source)?.push(e.target);

  const visited = new Set<string>();
  const inStack = new Set<string>();
  const backPairs = new Set<string>();

  function dfs(node: string) {
    visited.add(node);
    inStack.add(node);
    for (const next of adj.get(node) ?? []) {
      if (inStack.has(next)) {
        backPairs.add(`${node}\0${next}`);
      } else if (!visited.has(next)) {
        dfs(next);
      }
    }
    inStack.delete(node);
  }

  for (const id of nodeIds) {
    if (!visited.has(id)) dfs(id);
  }

  const forward: FlowEdgeDef[] = [];
  const back: FlowEdgeDef[] = [];
  for (const e of edges) {
    (backPairs.has(`${e.source}\0${e.target}`) ? back : forward).push(e);
  }
  return { forward, back };
}

/* ── Layer assignment (longest path from source) ──────────── */

function assignLayers(
  nodeIds: string[],
  edges: FlowEdgeDef[],
): Map<string, number> {
  const incoming = new Map<string, string[]>();
  for (const id of nodeIds) incoming.set(id, []);
  for (const e of edges) incoming.get(e.target)?.push(e.source);

  const layers = new Map<string, number>();
  const computing = new Set<string>();

  function getLayer(id: string): number {
    if (layers.has(id)) return layers.get(id)!;
    if (computing.has(id)) return 0; // cycle guard
    computing.add(id);

    const preds = incoming.get(id) ?? [];
    const layer = preds.length === 0 ? 0 : Math.max(...preds.map(getLayer)) + 1;
    layers.set(id, layer);
    computing.delete(id);
    return layer;
  }

  for (const id of nodeIds) getLayer(id);
  return layers;
}

/* ── Barycenter ordering (one pass) ───────────────────────── */

function orderWithinLayers(
  layerMap: Map<string, number>,
  edges: FlowEdgeDef[],
  maxLayer: number,
): string[][] {
  // Group nodes by layer
  const layers: string[][] = Array.from({ length: maxLayer + 1 }, () => []);
  for (const [id, layer] of layerMap) layers[layer].push(id);

  // Build adjacency for ordering
  const adj = new Map<string, string[]>();
  for (const [id] of layerMap) adj.set(id, []);
  for (const e of edges) {
    adj.get(e.source)?.push(e.target);
    adj.get(e.target)?.push(e.source);
  }

  // For each layer after the first, order by average position of neighbors in previous layer
  for (let l = 1; l <= maxLayer; l++) {
    const prevOrder = new Map<string, number>();
    layers[l - 1].forEach((id, i) => prevOrder.set(id, i));

    layers[l].sort((a, b) => {
      const aNeighbors = (adj.get(a) ?? []).filter((n) => prevOrder.has(n));
      const bNeighbors = (adj.get(b) ?? []).filter((n) => prevOrder.has(n));
      const aAvg =
        aNeighbors.length > 0
          ? aNeighbors.reduce((s, n) => s + prevOrder.get(n)!, 0) /
            aNeighbors.length
          : 0;
      const bAvg =
        bNeighbors.length > 0
          ? bNeighbors.reduce((s, n) => s + prevOrder.get(n)!, 0) /
            bNeighbors.length
          : 0;
      return aAvg - bAvg;
    });
  }

  return layers;
}

/* ── Main layout function ────────────────────────────────── */

export function layoutFlowchart(
  ast: FlowchartAST,
): { nodes: Node[]; edges: Edge[]; height: number } {
  const nodeIds = [...ast.nodes.keys()];
  if (nodeIds.length === 0) return { nodes: [], edges: [], height: 200 };

  const { forward, back } = splitEdges(nodeIds, ast.edges);
  const layerMap = assignLayers(nodeIds, forward);
  const maxLayer = Math.max(0, ...layerMap.values());
  const orderedLayers = orderWithinLayers(layerMap, forward, maxLayer);

  const isTD = ast.direction === "TD";

  // ── Compute positions (global coordinates) ──

  const positions = new Map<string, { x: number; y: number }>();

  for (let l = 0; l <= maxLayer; l++) {
    const layer = orderedLayers[l];
    const count = layer.length;
    for (let i = 0; i < count; i++) {
      const offset = (i - (count - 1) / 2) * (isTD ? NODE_W + SIBLING_GAP : NODE_H + SIBLING_GAP);
      if (isTD) {
        positions.set(layer[i], {
          x: offset,
          y: l * (NODE_H + LAYER_GAP),
        });
      } else {
        positions.set(layer[i], {
          x: l * (NODE_W + LAYER_GAP),
          y: offset,
        });
      }
    }
  }

  // ── Normalize to positive coordinates ──

  let minX = Infinity,
    minY = Infinity;
  for (const pos of positions.values()) {
    if (pos.x < minX) minX = pos.x;
    if (pos.y < minY) minY = pos.y;
  }
  for (const pos of positions.values()) {
    pos.x -= minX;
    pos.y -= minY;
  }

  // ── Build subgraph group nodes ──

  const nodeToSubgraph = new Map<string, string>();
  const xyNodes: Node[] = [];

  for (const sg of ast.subgraphs) {
    if (sg.nodeIds.length === 0) continue;

    let sgMinX = Infinity,
      sgMinY = Infinity,
      sgMaxX = -Infinity,
      sgMaxY = -Infinity;

    for (const nid of sg.nodeIds) {
      const pos = positions.get(nid);
      if (!pos) continue;
      if (pos.x < sgMinX) sgMinX = pos.x;
      if (pos.y < sgMinY) sgMinY = pos.y;
      if (pos.x + NODE_W > sgMaxX) sgMaxX = pos.x + NODE_W;
      if (pos.y + NODE_H > sgMaxY) sgMaxY = pos.y + NODE_H;
    }

    const groupX = sgMinX - SG_PAD_X;
    const groupY = sgMinY - SG_PAD_Y;
    const groupW = sgMaxX - sgMinX + 2 * SG_PAD_X;
    const groupH = sgMaxY - sgMinY + SG_PAD_Y + SG_PAD_BOTTOM;

    xyNodes.push({
      id: `sg-${sg.id}`,
      type: "group",
      position: { x: groupX, y: groupY },
      data: {},
      style: {
        width: groupW,
        height: groupH,
        backgroundColor:
          "color-mix(in srgb, var(--gray-3) 50%, transparent)",
        border: "1px solid var(--gray-6)",
        borderRadius: 10,
      },
    });

    // Add label node inside group
    xyNodes.push({
      id: `sg-label-${sg.id}`,
      type: "mermaidLabel",
      position: { x: 12, y: 10 },
      parentId: `sg-${sg.id}`,
      data: { label: sg.label },
      draggable: false,
      selectable: false,
      connectable: false,
    });

    // Convert child positions to group-relative
    for (const nid of sg.nodeIds) {
      nodeToSubgraph.set(nid, sg.id);
      const pos = positions.get(nid);
      if (pos) {
        pos.x -= groupX;
        pos.y -= groupY;
      }
    }
  }

  // ── Build service nodes ──

  for (const [id, def] of ast.nodes) {
    const pos = positions.get(id) ?? { x: 0, y: 0 };
    const accent = resolveAccent(id, ast.styles);
    const sgId = nodeToSubgraph.get(id);

    const isCircle = def.shape === "circle";
    const nodeType = isCircle ? "fcCircle" : "fcNode";

    const node: Node = {
      id,
      type: nodeType,
      position: pos,
      data: {
        label: def.label,
        shape: def.shape,
        accent,
        direction: ast.direction,
      },
      draggable: false,
      style: isCircle ? { width: 48, height: 48 } : { width: NODE_W },
    };

    if (sgId) {
      node.parentId = `sg-${sgId}`;
      node.extent = "parent";
    }

    xyNodes.push(node);
  }

  // ── Build edges ──

  const xyEdges: Edge[] = [];

  const makeEdge = (e: FlowEdgeDef, isBack: boolean): Edge => {
    const edge: Edge = {
      id: `e-${e.source}-${e.target}-${xyEdges.length}`,
      source: e.source,
      target: e.target,
      type: "smoothstep",
      animated: isBack,
      style: {
        stroke: "var(--gray-8)",
        strokeWidth: e.lineStyle === "thick" ? 3 : 2,
        ...(e.lineStyle === "dotted" && { strokeDasharray: "6 3" }),
      },
    };

    if (isBack) {
      // Route back-edges via side handles
      edge.sourceHandle = isTD ? "right" : "bottom";
      edge.targetHandle = isTD ? "right" : "bottom";
    } else {
      edge.sourceHandle = isTD ? "bottom" : "right";
      edge.targetHandle = isTD ? "top" : "left";
    }

    if (e.label) {
      edge.label = e.label;
      edge.labelStyle = {
        fontSize: 11,
        fontWeight: 500,
        fill: "var(--gray-11)",
      };
      edge.labelBgStyle = { fill: "var(--gray-1)", fillOpacity: 0.9 };
      edge.labelBgPadding = [6, 4] as [number, number];
      edge.labelBgBorderRadius = 4;
    }

    return edge;
  };

  for (const e of forward) xyEdges.push(makeEdge(e, false));
  for (const e of back) xyEdges.push(makeEdge(e, true));

  // ── Auto-height ──

  const layerCount = maxLayer + 1;
  const height = Math.min(Math.max(layerCount * 70 + 80, 250), 600);

  return { nodes: xyNodes, edges: xyEdges, height };
}
