import type { GroupedLessons } from "@/lib/articles";

/**
 * Serializable detail map for the roadmap drawer. Built server-side from
 * GroupedLessons and passed to the client component as a plain prop so the
 * filesystem-derived `groups` shape never ships to the browser.
 *
 * Keyed by node id:
 *   - lesson nodes:  `lesson-${slug}`
 *   - phase/appendix headers: the group meta.slug (== header node id)
 *   - `start` / `ship`
 */

export interface LessonDetail {
  kind: "lesson";
  title: string;
  excerpt: string;
  difficulty: "beginner" | "intermediate" | "advanced";
  readingTimeMin: number;
  number: number;
  url: string;
  groupTitle: string;
}

export interface PhaseDetail {
  kind: "phase" | "appendix";
  title: string;
  phaseLabel?: string;
  icon: string;
  description: string;
  outcomes: string[];
  lessonCount: number;
  totalMinutes: number;
  difficultyHint: "beginner" | "intermediate" | "advanced" | "mixed";
  href: string;
  /** Child lesson node ids, in order — drives "x / y done" + quick links. */
  lessonIds: string[];
  lessonTitles: string[];
}

export interface MarkerDetail {
  kind: "entry" | "ship";
  title: string;
  blurb: string;
  href: string;
}

export type RoadmapDetail = LessonDetail | PhaseDetail | MarkerDetail;

export type LessonLookup = Record<string, RoadmapDetail>;

function difficultyHint(
  diffs: Array<"beginner" | "intermediate" | "advanced">,
): "beginner" | "intermediate" | "advanced" | "mixed" {
  if (diffs.length === 0) return "beginner";
  const unique = new Set(diffs);
  return unique.size === 1 ? diffs[0] : "mixed";
}

export function buildLessonLookup(groups: GroupedLessons[]): LessonLookup {
  const lookup: LessonLookup = {};

  lookup["start"] = {
    kind: "entry",
    title: "Start Here",
    blurb:
      "Begin the AI Engineer roadmap. Work down the spine phase by phase — each lesson hangs off its phase. Mark lessons done to track progress.",
    href: "#lessons",
  };
  lookup["ship"] = {
    kind: "ship",
    title: "Ship to Production",
    blurb:
      "You've reached the end of the core path. The appendix groups below cover deep dives and adjacent skills beyond the edge.",
    href: "#lessons",
  };

  for (const g of groups) {
    const parts = g.category.split(" · ");
    const phaseLabel = parts.length > 1 ? parts[0] : undefined;
    const title = parts.length > 1 ? parts.slice(1).join(" · ") : g.category;
    const isAppendix = g.meta.slug.startsWith("appendix-");
    const lessonIds = g.articles.map((a) => `lesson-${a.slug}`);
    const lessonTitles = g.articles.map((a) => a.title);

    lookup[g.meta.slug] = {
      kind: isAppendix ? "appendix" : "phase",
      title,
      phaseLabel,
      icon: g.meta.icon,
      description: g.meta.description,
      outcomes: g.meta.outcomes ?? [],
      lessonCount: g.articles.length,
      totalMinutes: g.articles.reduce((s, a) => s + a.readingTimeMin, 0),
      difficultyHint: difficultyHint(g.articles.map((a) => a.difficulty)),
      href: `#cat-${g.meta.slug}`,
      lessonIds,
      lessonTitles,
    };

    for (const a of g.articles) {
      lookup[`lesson-${a.slug}`] = {
        kind: "lesson",
        title: a.title,
        excerpt: a.excerpt,
        difficulty: a.difficulty,
        readingTimeMin: a.readingTimeMin,
        number: a.number,
        url: a.url,
        groupTitle: title,
      };
    }
  }

  return lookup;
}
