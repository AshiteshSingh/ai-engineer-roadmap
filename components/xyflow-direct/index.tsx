"use client";

import { useMemo } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { layoutFlowchart } from "@/components/mermaid-flow/layout-flowchart";
import { mermaidNodeTypes } from "@/components/mermaid-flow/nodes";
import type {
  FlowchartAST,
  FlowNodeDef,
  FlowEdgeDef,
  NodeShape,
} from "@/components/mermaid-flow/parser";

interface XyflowJSON {
  direction?: "TD" | "LR";
  nodes: Array<{ id: string; label: string; shape?: NodeShape }>;
  edges: Array<{
    source: string;
    target: string;
    label?: string;
    style?: "solid" | "dotted" | "thick";
  }>;
}

function buildAST(json: XyflowJSON): FlowchartAST {
  const nodes = new Map<string, FlowNodeDef>();
  for (const n of json.nodes) {
    if (!nodes.has(n.id)) {
      nodes.set(n.id, {
        id: n.id,
        label: n.label,
        shape: n.shape ?? "rect",
      });
    }
  }
  // Auto-create endpoint nodes if edges reference unknown ids
  for (const e of json.edges) {
    if (!nodes.has(e.source)) {
      nodes.set(e.source, { id: e.source, label: e.source, shape: "rect" });
    }
    if (!nodes.has(e.target)) {
      nodes.set(e.target, { id: e.target, label: e.target, shape: "rect" });
    }
  }
  const edges: FlowEdgeDef[] = json.edges.map((e) => ({
    source: e.source,
    target: e.target,
    label: e.label,
    lineStyle: e.style ?? "solid",
  }));
  return {
    type: "flowchart",
    direction: json.direction ?? "TD",
    nodes,
    edges,
    subgraphs: [],
    styles: new Map(),
  };
}

export function XyflowDirect({ json }: { json: string }) {
  const result = useMemo<{ nodes: Node[]; edges: Edge[]; height: number } | null>(() => {
    try {
      const parsed = JSON.parse(json) as XyflowJSON;
      if (!parsed?.nodes || !parsed?.edges) return null;
      return layoutFlowchart(buildAST(parsed));
    } catch {
      return null;
    }
  }, [json]);

  if (!result || result.nodes.length === 0) {
    return (
      <div className="code-block-wrapper">
        <div className="code-block-bar">
          <span className="code-block-lang">xyflow (parse error)</span>
        </div>
        <pre>{json}</pre>
      </div>
    );
  }

  return (
    <div
      className="mermaid-flow-container"
      style={{ ["--graph-h" as string]: `${result.height}px` }}
    >
      <ReactFlowProvider>
        <ReactFlow
          nodes={result.nodes}
          edges={result.edges}
          nodeTypes={mermaidNodeTypes}
          fitView
          fitViewOptions={{ padding: 0.18 }}
          minZoom={0.2}
          maxZoom={1.5}
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
  );
}
