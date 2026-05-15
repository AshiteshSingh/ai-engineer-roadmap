import type { GroupedLessons } from "@/lib/articles";

// ── Typed model for the interactive RoadmapGraph ──────────────────────────────

export type RoadmapAccent = "indigo" | "blue" | "slate";

export type RoadmapNodeKind = "entry" | "phase" | "appendix" | "ship" | "lesson";

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

export interface RoadmapLessonNode extends Record<string, unknown> {
  id: string; // `lesson-${slug}`
  kind: "lesson";
  slug: string;
  title: string;
  url: string; // lesson.url — already encodes /aws/<sub> deep dives
  excerpt: string;
  difficulty: "beginner" | "intermediate" | "advanced";
  readingTimeMin: number;
  number: number;
  groupSlug: string; // parent phase/appendix meta.slug
  accent: RoadmapAccent;
}

export type RoadmapNode = RoadmapPhaseNode | RoadmapLessonNode;

export interface RoadmapEdge {
  source: string;
  target: string;
  // "branch" retained for type back-compat; no longer emitted.
  variant: "spine" | "branch" | "lesson";
}

export interface RoadmapModel {
  nodes: RoadmapNode[];
  edges: RoadmapEdge[];
}

export function isLessonNode(n: RoadmapNode): n is RoadmapLessonNode {
  return n.kind === "lesson";
}

function computeDifficultyHint(
  difficulties: Array<"beginner" | "intermediate" | "advanced">,
): "beginner" | "intermediate" | "advanced" | "mixed" {
  if (difficulties.length === 0) return "beginner";
  const unique = new Set(difficulties);
  if (unique.size === 1) return difficulties[0];
  return "mixed";
}

function lessonNodeId(slug: string): string {
  return `lesson-${slug}`;
}

/**
 * Build a structured RoadmapModel from grouped lessons.
 * Server-safe (pure, no DOM). Emits a central spine
 * (entry → phases → ship → appendix groups) plus a lesson node per
 * article hanging off its phase/appendix header.
 */
export function buildRoadmapModel(groups: GroupedLessons[]): RoadmapModel {
  const nodes: RoadmapNode[] = [];
  const edges: RoadmapEdge[] = [];

  // Entry node
  nodes.push({
    id: "start",
    kind: "entry",
    title: "Start Here",
    icon: "▸",
    href: "#lessons",
    lessonCount: 0,
    totalMinutes: 0,
    difficultyHint: "beginner",
    accent: "slate",
  });

  const phaseGroups = groups.filter((g) => !g.meta.slug.startsWith("appendix-"));
  const appendixGroups = groups.filter((g) => g.meta.slug.startsWith("appendix-"));

  function emitGroup(g: GroupedLessons, kind: "phase" | "appendix") {
    const parts = g.category.split(" · ");
    const phaseLabel = parts.length > 1 ? parts[0] : undefined;
    const title = parts.length > 1 ? parts.slice(1).join(" · ") : g.category;
    const lessonCount = g.articles.length;
    const totalMinutes = g.articles.reduce((s, a) => s + a.readingTimeMin, 0);
    const difficultyHint = computeDifficultyHint(
      g.articles.map((a) => a.difficulty),
    );

    nodes.push({
      id: g.meta.slug,
      kind,
      title,
      phaseLabel,
      icon: g.meta.icon,
      href: `#cat-${g.meta.slug}`,
      lessonCount,
      totalMinutes,
      difficultyHint,
      accent: kind === "appendix" ? "blue" : "indigo",
    });

    for (const a of g.articles) {
      nodes.push({
        id: lessonNodeId(a.slug),
        kind: "lesson",
        slug: a.slug,
        title: a.title,
        url: a.url,
        excerpt: a.excerpt,
        difficulty: a.difficulty,
        readingTimeMin: a.readingTimeMin,
        number: a.number,
        groupSlug: g.meta.slug,
        accent: kind === "appendix" ? "blue" : "indigo",
      });
      edges.push({
        source: g.meta.slug,
        target: lessonNodeId(a.slug),
        variant: "lesson",
      });
    }
  }

  for (const g of phaseGroups) emitGroup(g, "phase");

  // Ship node
  nodes.push({
    id: "ship",
    kind: "ship",
    title: "Ship to Production",
    icon: "🚀",
    href: "#lessons",
    lessonCount: 0,
    totalMinutes: 0,
    difficultyHint: "advanced",
    accent: "indigo",
  });

  for (const g of appendixGroups) emitGroup(g, "appendix");

  // Spine edges chain the headers: start → phases → ship → appendix groups.
  const spineIds = [
    "start",
    ...phaseGroups.map((g) => g.meta.slug),
    "ship",
    ...appendixGroups.map((g) => g.meta.slug),
  ];
  for (let i = 0; i < spineIds.length - 1; i++) {
    edges.push({ source: spineIds[i], target: spineIds[i + 1], variant: "spine" });
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
