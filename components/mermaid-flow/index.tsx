"use client";

import { useMemo } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { parseMermaid } from "./parser";
import { layoutFlowchart } from "./layout-flowchart";
import { layoutSequence } from "./layout-sequence";
import { layoutER } from "./layout-er";
import { mermaidNodeTypes } from "./nodes";

interface MermaidFlowProps {
  chart: string;
}

export function MermaidFlow({ chart }: MermaidFlowProps) {
  const result = useMemo(() => {
    const ast = parseMermaid(chart);
    if (!ast) return null;

    let layout: { nodes: Node[]; edges: Edge[]; height: number };

    switch (ast.type) {
      case "flowchart":
        layout = layoutFlowchart(ast);
        break;
      case "sequence":
        layout = layoutSequence(ast);
        break;
      case "er":
        layout = layoutER(ast);
        break;
    }

    return layout;
  }, [chart]);

  if (!result || result.nodes.length === 0) return null;

  return (
    <div className="mermaid-flow-container" style={{ height: result.height }}>
      <ReactFlowProvider>
        <ReactFlow
          nodes={result.nodes}
          edges={result.edges}
          nodeTypes={mermaidNodeTypes}
          fitView
          fitViewOptions={{ padding: 0.15 }}
          minZoom={0.3}
          maxZoom={1.5}
          proOptions={{ hideAttribution: true }}
          panOnScroll
          zoomOnScroll={false}
          zoomOnPinch
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
        />
      </ReactFlowProvider>
    </div>
  );
}
