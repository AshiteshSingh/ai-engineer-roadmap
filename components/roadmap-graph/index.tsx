"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  MarkerType,
  type Node,
  type Edge,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
// xyflow overrides extracted from globals.css (Phase 1); after the lib's
// default CSS so .roadmap-graph/.rg-* overrides still win.
import "@/app/styles/third-party.css";
import type { RoadmapModel, RoadmapNode } from "@/lib/roadmap-flow";
import { roadmapNodeTypes, type RfNodeData } from "./nodes";
import type { LessonLookup } from "./lesson-lookup";
import { useRoadmapProgress, type NodeStatus } from "@/lib/roadmap-progress";
import { RoadmapProgressBar } from "./progress-bar";
import { RoadmapDrawer } from "./drawer";

// ── Layout constants (deterministic; roadmap.sh-style fixed coords) ───────────
const SPINE_X = 0;
const PHASE_W = 300;
const PHASE_MIN_H = 84;
const ENTRY_W = 170;
const ENTRY_H = 52;
const LESSON_W = 240;
const LESSON_H = 60;
const LESSON_V_GAP = 26;
const COL_GAP = 96;
const TOP_PAD = 40;
const BOTTOM_PAD = 80;
const PHASE_LEAD_GAP = 56;

const SPINE_CX = SPINE_X + PHASE_W / 2;
// Columns hang off the header BOX edges (not the spine centre), so lessons
// never overlap the phase header.
const LEFT_X = SPINE_X - COL_GAP - LESSON_W;
const RIGHT_X = SPINE_X + PHASE_W + COL_GAP;
// Total horizontal extent of the tree (leftmost lesson edge → rightmost).
const GRAPH_W = RIGHT_X + LESSON_W - LEFT_X;

type RFInstance = ReactFlowInstance<Node<RfNodeData>, Edge>;

type Block =
  | { type: "marker"; node: RoadmapNode }
  | { type: "block"; header: RoadmapNode; lessons: RoadmapNode[] };

interface BaseNode {
  id: string;
  rfType: "phaseNode" | "lessonNode";
  x: number;
  y: number;
  w: number;
  h?: number;
  data: RoadmapNode;
}

interface LessonEdgeDef {
  source: string;
  target: string;
  side: "left" | "right";
}

function buildGeometry(model: RoadmapModel) {
  // Group the ordered model into markers + (header + its lessons) blocks.
  const blocks: Block[] = [];
  for (const n of model.nodes) {
    if (n.kind === "entry" || n.kind === "ship") {
      blocks.push({ type: "marker", node: n });
    } else if (n.kind === "phase" || n.kind === "appendix") {
      blocks.push({ type: "block", header: n, lessons: [] });
    } else {
      const last = blocks[blocks.length - 1];
      if (last && last.type === "block") last.lessons.push(n);
    }
  }

  const baseNodes: BaseNode[] = [];
  const lessonEdges: LessonEdgeDef[] = [];
  const headerLessonIds: Record<string, string[]> = {};
  let y = TOP_PAD;

  for (const b of blocks) {
    if (b.type === "marker") {
      baseNodes.push({
        id: b.node.id,
        rfType: "phaseNode",
        x: SPINE_CX - ENTRY_W / 2,
        y,
        w: ENTRY_W,
        h: ENTRY_H,
        data: b.node,
      });
      y += ENTRY_H + PHASE_LEAD_GAP;
      continue;
    }

    const lessons = b.lessons;
    const n = lessons.length;
    const leftCount = Math.ceil(n / 2);
    const rightCount = n - leftCount;
    const sideMax = Math.max(leftCount, rightCount);
    const fanH =
      sideMax > 0 ? sideMax * LESSON_H + (sideMax - 1) * LESSON_V_GAP : 0;
    const phaseH = Math.max(PHASE_MIN_H, fanH);
    const blockTop = y;
    const blockCenterY = y + phaseH / 2;

    baseNodes.push({
      id: b.header.id,
      rfType: "phaseNode",
      x: SPINE_X,
      y: blockTop,
      w: PHASE_W,
      h: phaseH,
      data: b.header,
    });
    headerLessonIds[b.header.id] = lessons.map((l) => l.id);

    const leftSlotH =
      leftCount > 0 ? leftCount * LESSON_H + (leftCount - 1) * LESSON_V_GAP : 0;
    const rightSlotH =
      rightCount > 0
        ? rightCount * LESSON_H + (rightCount - 1) * LESSON_V_GAP
        : 0;
    const leftStartY = blockCenterY - leftSlotH / 2;
    const rightStartY = blockCenterY - rightSlotH / 2;
    let li = 0;
    let ri = 0;

    lessons.forEach((lesson, idx) => {
      if (idx % 2 === 0) {
        const ly = leftStartY + li * (LESSON_H + LESSON_V_GAP);
        baseNodes.push({
          id: lesson.id,
          rfType: "lessonNode",
          x: LEFT_X,
          y: ly,
          w: LESSON_W,
          data: lesson,
        });
        lessonEdges.push({
          source: b.header.id,
          target: lesson.id,
          side: "left",
        });
        li++;
      } else {
        const ly = rightStartY + ri * (LESSON_H + LESSON_V_GAP);
        baseNodes.push({
          id: lesson.id,
          rfType: "lessonNode",
          x: RIGHT_X,
          y: ly,
          w: LESSON_W,
          data: lesson,
        });
        lessonEdges.push({
          source: b.header.id,
          target: lesson.id,
          side: "right",
        });
        ri++;
      }
    });

    y = blockTop + Math.max(phaseH, fanH) + PHASE_LEAD_GAP;
  }

  const spineEdges = model.edges.filter((e) => e.variant === "spine");
  const graphH = y - PHASE_LEAD_GAP + BOTTOM_PAD;
  const totalLessons = model.nodes.filter((n) => n.kind === "lesson").length;

  return {
    baseNodes,
    lessonEdges,
    spineEdges,
    headerLessonIds,
    graphH,
    totalLessons,
  };
}

export function RoadmapGraph({
  model,
  lessonLookup,
}: {
  model: RoadmapModel;
  lessonLookup: LessonLookup;
}) {
  const geom = useMemo(() => buildGeometry(model), [model]);
  const { mounted, statusOf, setStatus, reset, stats } = useRoadmapProgress(
    geom.totalLessons,
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const onSelect = useCallback((id: string) => setSelectedId(id), []);
  const onClose = useCallback(() => setSelectedId(null), []);

  // Static, readable diagram (roadmap.sh-style): fixed zoom, the page scrolls
  // through the full-height tree. Zoom only shrinks to fit narrow screens.
  const wrapRef = useRef<HTMLDivElement>(null);
  const instRef = useRef<RFInstance | null>(null);
  const lastWRef = useRef(0);
  const zoomRef = useRef(0.92);
  const [zoom, setZoom] = useState(0.92);

  const applyViewport = useCallback((inst: RFInstance) => {
    const w = wrapRef.current?.clientWidth ?? 1024;
    lastWRef.current = w;
    const z = Math.min(1, Math.max(0.5, (w - 24) / GRAPH_W));
    if (z !== zoomRef.current) {
      zoomRef.current = z;
      setZoom(z);
    }
    inst.setViewport({ x: w / 2 - SPINE_CX * z, y: 16, zoom: z });
  }, []);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    let raf = 0;
    const ro = new ResizeObserver((entries) => {
      // Width-only: applyViewport changes this element's HEIGHT (via zoom),
      // so reacting to height would feed back into an infinite reflow loop.
      const w = entries[0]?.contentRect.width ?? 0;
      if (Math.abs(w - lastWRef.current) < 1) return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (instRef.current) applyViewport(instRef.current);
      });
    });
    ro.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [applyViewport]);

  // Derived per-node status: lessons are direct; headers aggregate children.
  const statusFor = useCallback(
    (node: RoadmapNode): NodeStatus => {
      if (!mounted) return "todo";
      if (node.kind === "lesson") return statusOf(node.id);
      const childIds = geom.headerLessonIds[node.id];
      if (!childIds || childIds.length === 0) return "todo";
      let done = 0;
      let touched = 0;
      for (const cid of childIds) {
        const s = statusOf(cid);
        if (s === "done") done++;
        if (s !== "todo") touched++;
      }
      if (done === childIds.length) return "done";
      if (touched > 0) return "in-progress";
      return "todo";
    },
    [mounted, statusOf, geom.headerLessonIds],
  );

  const rfNodes = useMemo<Node<RfNodeData>[]>(() => {
    return geom.baseNodes.map((bn) => ({
      id: bn.id,
      type: bn.rfType,
      position: { x: bn.x, y: bn.y },
      draggable: false,
      style: bn.h ? { width: bn.w, height: bn.h } : { width: bn.w },
      data: {
        ...(bn.data as RoadmapNode),
        status: statusFor(bn.data),
        onSelect,
      } as RfNodeData,
    }));
  }, [geom.baseNodes, statusFor, onSelect]);

  const rfEdges = useMemo<Edge[]>(() => {
    const spine: Edge[] = geom.spineEdges.map((e) => ({
      id: `spine-${e.source}-${e.target}`,
      source: e.source,
      target: e.target,
      sourceHandle: "bottom",
      targetHandle: "top",
      type: "smoothstep",
      style: { stroke: "var(--ds-border-strong)", strokeWidth: 2 },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 12,
        height: 12,
        color: "var(--ds-border-strong)",
      },
    }));
    const branch: Edge[] = geom.lessonEdges.map((e) => {
      const done = mounted && statusOf(e.target) === "done";
      return {
        id: `lesson-${e.source}-${e.target}`,
        source: e.source,
        target: e.target,
        sourceHandle: e.side,
        targetHandle: e.side === "left" ? "right" : "left",
        type: "default",
        style: {
          stroke: done ? "var(--ds-accent-border)" : "var(--ds-border)",
          strokeWidth: 1.5,
          strokeDasharray: "5 5",
        },
      };
    });
    return [...spine, ...branch];
  }, [geom.spineEdges, geom.lessonEdges, mounted, statusOf]);

  if (!model || rfNodes.length === 0) return null;

  return (
    <>
      <RoadmapProgressBar stats={stats} mounted={mounted} onReset={reset} />

      <div
        ref={wrapRef}
        className="mermaid-flow-container roadmap-graph-wrap"
        style={{ height: `${Math.ceil(geom.graphH * zoom + 32)}px` }}
      >
        <ReactFlowProvider>
          <ReactFlow
            className="roadmap-graph"
            nodes={rfNodes}
            edges={rfEdges}
            nodeTypes={roadmapNodeTypes}
            onNodeClick={(_, n) => onSelect(n.id)}
            onInit={(inst) => {
              instRef.current = inst;
              applyViewport(inst);
            }}
            minZoom={0.4}
            maxZoom={1}
            proOptions={{ hideAttribution: true }}
            preventScrolling={false}
            panOnScroll={false}
            panOnDrag={false}
            zoomOnScroll={false}
            zoomOnPinch={false}
            zoomOnDoubleClick={false}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
          />
        </ReactFlowProvider>
      </div>

      <div className="rg-legend" aria-hidden="true">
        <span className="rg-legend__item">
          <span className="rg-legend__line" />
          Core path
        </span>
        <span className="rg-legend__item">
          <span className="rg-legend__line rg-legend__line--dashed" />
          Lesson
        </span>
        <span className="rg-legend__item rg-legend__item--hint">
          Tap a node for details &amp; progress
        </span>
      </div>

      <RoadmapDrawer
        selectedId={selectedId}
        lookup={lessonLookup}
        statusOf={statusOf}
        setStatus={setStatus}
        onClose={onClose}
      />
    </>
  );
}
