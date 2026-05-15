import type { GroupedLessons } from "@/lib/articles";

// ── New typed model for the interactive RoadmapGraph ──────────────────────────

export type RoadmapAccent = "indigo" | "blue" | "slate";

export interface RoadmapPhaseNode extends Record<string, unknown> {
  id: string;
  kind: "entry" | "phase" | "appendix" | "ship";
  title: string;
  phaseLabel?: string;
  icon: string;
  href: string;
  lessonCount: number;
  totalMinutes: number;
  difficultyHint: "beginner" | "intermediate" | "advanced" | "mixed";
  accent: RoadmapAccent;
}

export interface RoadmapEdge {
  source: string;
  target: string;
  variant: "spine" | "branch";
}

export interface RoadmapModel {
  nodes: RoadmapPhaseNode[];
  edges: RoadmapEdge[];
}

function computeDifficultyHint(
  difficulties: Array<"beginner" | "intermediate" | "advanced">,
): "beginner" | "intermediate" | "advanced" | "mixed" {
  if (difficulties.length === 0) return "beginner";
  const unique = new Set(difficulties);
  if (unique.size === 1) return difficulties[0];
  return "mixed";
}

/**
 * Build a structured RoadmapModel from grouped lessons.
 * Server-safe (pure, no DOM).
 */
export function buildRoadmapModel(groups: GroupedLessons[]): RoadmapModel {
  const nodes: RoadmapPhaseNode[] = [];
  const edges: RoadmapEdge[] = [];

  // Entry node
  const startNode: RoadmapPhaseNode = {
    id: "start",
    kind: "entry",
    title: "Start Here",
    icon: "▸",
    href: "#lessons",
    lessonCount: 0,
    totalMinutes: 0,
    difficultyHint: "beginner",
    accent: "slate",
  };
  nodes.push(startNode);

  const phaseGroups = groups.filter((g) => !g.meta.slug.startsWith("appendix-"));
  const appendixGroups = groups.filter((g) => g.meta.slug.startsWith("appendix-"));

  // Phase nodes
  for (const g of phaseGroups) {
    const parts = g.category.split(" · ");
    const phaseLabel = parts.length > 1 ? parts[0] : undefined;
    const title = parts.length > 1 ? parts.slice(1).join(" · ") : g.category;
    const lessonCount = g.articles.length;
    const totalMinutes = g.articles.reduce((s, a) => s + a.readingTimeMin, 0);
    const difficultyHint = computeDifficultyHint(g.articles.map((a) => a.difficulty));

    nodes.push({
      id: g.meta.slug,
      kind: "phase",
      title,
      phaseLabel,
      icon: g.meta.icon,
      href: `#cat-${g.meta.slug}`,
      lessonCount,
      totalMinutes,
      difficultyHint,
      accent: "indigo",
    });
  }

  // Ship node
  const shipNode: RoadmapPhaseNode = {
    id: "ship",
    kind: "ship",
    title: "Ship to Production",
    icon: "🚀",
    href: "#lessons",
    lessonCount: 0,
    totalMinutes: 0,
    difficultyHint: "advanced",
    accent: "indigo",
  };
  nodes.push(shipNode);

  // Spine edges: start → phase[0] → … → phase[n] → ship
  const spineIds = ["start", ...phaseGroups.map((g) => g.meta.slug), "ship"];
  for (let i = 0; i < spineIds.length - 1; i++) {
    edges.push({ source: spineIds[i], target: spineIds[i + 1], variant: "spine" });
  }

  // Appendix nodes + branch edges from ship
  for (const g of appendixGroups) {
    const parts = g.category.split(" · ");
    const phaseLabel = parts.length > 1 ? parts[0] : undefined;
    const title = parts.length > 1 ? parts.slice(1).join(" · ") : g.category;
    const lessonCount = g.articles.length;
    const totalMinutes = g.articles.reduce((s, a) => s + a.readingTimeMin, 0);
    const difficultyHint = computeDifficultyHint(g.articles.map((a) => a.difficulty));

    nodes.push({
      id: g.meta.slug,
      kind: "appendix",
      title,
      phaseLabel,
      icon: g.meta.icon,
      href: `#cat-${g.meta.slug}`,
      lessonCount,
      totalMinutes,
      difficultyHint,
      accent: "blue",
    });

    edges.push({ source: "ship", target: g.meta.slug, variant: "branch" });
  }

  return { nodes, edges };
}

// ── Legacy JSON builder (kept for back-compat) ────────────────────────────────

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
