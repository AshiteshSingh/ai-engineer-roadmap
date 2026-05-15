"use client";

import { useMemo } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  MarkerType,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
// xyflow overrides extracted from globals.css (Phase 1); after the lib's
// default CSS so .roadmap-graph/.rg-* overrides still win.
import "@/app/styles/third-party.css";
import type { RoadmapModel, RoadmapPhaseNode } from "@/lib/roadmap-flow";
import { roadmapNodeTypes } from "./nodes";
import { navigateToHref } from "./navigate";

const NODE_W = 288;
const NODE_H = 76;
const V_GAP = 64;
const APPENDIX_X = 440;
const APPENDIX_GAP = 18;

export function RoadmapGraph({ model }: { model: RoadmapModel }) {
  const { nodes: rfNodes, edges: rfEdges, graphH } = useMemo(() => {
    if (!model || model.nodes.length === 0) {
      return { nodes: [], edges: [], graphH: 400 };
    }

    // Separate spine nodes (entry, phase, ship) from appendix
    const spineNodes = model.nodes.filter(
      (n) => n.kind === "entry" || n.kind === "phase" || n.kind === "ship",
    );
    const appendixNodes = model.nodes.filter((n) => n.kind === "appendix");

    // Find ship position
    const shipIndex = spineNodes.findIndex((n) => n.kind === "ship");
    const shipY = shipIndex * (NODE_H + V_GAP);

    // Compute appendix start y (centered around ship)
    const totalAppendixH =
      appendixNodes.length * NODE_H + Math.max(0, appendixNodes.length - 1) * APPENDIX_GAP;
    const appendixStartY = shipY - totalAppendixH / 2 + NODE_H / 2;

    // Build ReactFlow nodes
    const flowNodes: Node<RoadmapPhaseNode>[] = [];

    for (let i = 0; i < spineNodes.length; i++) {
      const sn = spineNodes[i];
      flowNodes.push({
        id: sn.id,
        type: sn.kind === "entry" ? "entryNode" : "phaseNode",
        position: { x: 0, y: i * (NODE_H + V_GAP) },
        data: sn,
        draggable: false,
        style: { width: NODE_W },
      });
    }

    for (let i = 0; i < appendixNodes.length; i++) {
      const an = appendixNodes[i];
      flowNodes.push({
        id: an.id,
        type: "phaseNode",
        position: {
          x: APPENDIX_X,
          y: appendixStartY + i * (NODE_H + APPENDIX_GAP),
        },
        data: an,
        draggable: false,
        style: { width: NODE_W },
      });
    }

    // Build ReactFlow edges
    const flowEdges: Edge[] = [];

    for (const re of model.edges) {
      if (re.variant === "spine") {
        flowEdges.push({
          id: `spine-${re.source}-${re.target}`,
          source: re.source,
          target: re.target,
          sourceHandle: "bottom",
          targetHandle: "top",
          type: "smoothstep",
          className: "rg-edge rg-edge--spine",
          animated: true,
          style: { stroke: "var(--ds-accent-border)", strokeWidth: 2.5 },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 16,
            height: 16,
            color: "var(--ds-accent)",
          },
        });
      } else {
        // branch
        flowEdges.push({
          id: `branch-${re.source}-${re.target}`,
          source: re.source,
          target: re.target,
          sourceHandle: "right",
          targetHandle: "left",
          type: "smoothstep",
          className: "rg-edge rg-edge--branch",
          style: {
            stroke: "var(--ds-border-strong)",
            strokeWidth: 1.75,
            strokeDasharray: "2 5",
          },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 11,
            height: 11,
            color: "var(--ds-border-strong)",
          },
        });
      }
    }

    const lastSpineIndex = spineNodes.length - 1;
    const computedH = lastSpineIndex * (NODE_H + V_GAP) + NODE_H + 80;

    return { nodes: flowNodes, edges: flowEdges, graphH: computedH };
  }, [model]);

  if (!model || rfNodes.length === 0) return null;

  return (
    <>
      <div
        className="mermaid-flow-container"
        style={{ ["--graph-h" as string]: `${graphH}px` }}
      >
        <ReactFlowProvider>
          <ReactFlow
            className="roadmap-graph"
            nodes={rfNodes}
            edges={rfEdges}
            nodeTypes={roadmapNodeTypes}
            onNodeClick={(_, n) => navigateToHref((n.data as RoadmapPhaseNode).href)}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            minZoom={0.4}
            maxZoom={1.4}
            proOptions={{ hideAttribution: true }}
            panOnScroll={false}
            panOnDrag
            zoomOnScroll={false}
            zoomOnPinch
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
          Side track
        </span>
        <span className="rg-legend__item rg-legend__item--hint">
          Tap a node to jump in
        </span>
      </div>
    </>
  );
}
