import type { GroupedLessons } from "@/lib/articles";

/**
 * Build an xyflow JSON graph for the homepage roadmap.
 * A single "Start Here" entry node feeds into the phase chain (top-down),
 * mirroring the roadmap.sh/ai-engineer flow. Consumed by <XyflowDirect/>.
 */
export function buildRoadmapFlowJSON(groups: GroupedLessons[]): string {
  const nodes: Array<{ id: string; label: string; shape?: string }> = [
    { id: "start", label: "Start Here", shape: "stadium" },
  ];
  const edges: Array<{ source: string; target: string }> = [];

  let prev = "start";
  for (const g of groups) {
    const id = g.meta.slug;
    nodes.push({
      id,
      label: `${g.meta.icon} ${g.category}`,
      shape: "rect",
    });
    edges.push({ source: prev, target: id });
    prev = id;
  }

  return JSON.stringify({ direction: "TD", nodes, edges });
}
