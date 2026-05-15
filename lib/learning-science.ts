/**
 * Learning science data access — loads curated papers from JSON,
 * provides mode-specific tips for the memorize dashboard.
 *
 * Follows the same pattern as lib/research-papers.ts.
 */

import data from "../data/learning-science-papers.json";

export interface LearningSciencePaper {
  title: string;
  authors: string[];
  year: number;
  evidenceLevel: string;
  relevanceScore: number;
  keyFindings: string[];
}

export interface TechniqueGroup {
  id: string;
  name: string;
  icon: string;
  description: string;
  practiceTip: string;
  papers: LearningSciencePaper[];
}

export interface LearningScienceData {
  totalPapers: number;
  techniqueGroups: TechniqueGroup[];
}

export function getLearningScience(): LearningScienceData {
  return data as LearningScienceData;
}

// ── Mode-specific tips ────────────────────────────────────────────

type Mode = "flashcards" | "fill" | "matcher" | "drill" | "explorer" | "dashboard";

interface ModeTip {
  technique: string;
  tip: string;
  citation: string;
}

const MODE_TIPS: Record<Mode, ModeTip[]> = {
  flashcards: [
    {
      technique: "Active Recall",
      tip: "Testing is a powerful learning event — retrieval strengthens memory more than re-reading.",
      citation: "Roediger & Karpicke, 2006",
    },
    {
      technique: "Desirable Difficulties",
      tip: "Struggling to recall feels harder but produces stronger, more durable memories.",
      citation: "Bjork & Bjork, 2011",
    },
  ],
  fill: [
    {
      technique: "Generation Effect",
      tip: "Self-generating answers produces better retention than passively reading them.",
      citation: "Bertsch et al., 2007",
    },
    {
      technique: "Testing Effect",
      tip: "Repeated retrieval is more effective than repeated study for long-term retention.",
      citation: "Karpicke & Roediger, 2007",
    },
  ],
  matcher: [
    {
      technique: "Interleaving",
      tip: "Mixing different topics improves your ability to discriminate and transfer knowledge.",
      citation: "Rohrer, 2012",
    },
    {
      technique: "Dual Coding",
      tip: "Combining visual and verbal information creates complementary memory traces.",
      citation: "Paivio, 2006",
    },
  ],
  drill: [
    {
      technique: "Desirable Difficulties",
      tip: "Time pressure creates beneficial stress that enhances memory consolidation.",
      citation: "Roozendaal, 2002",
    },
    {
      technique: "Working Memory",
      tip: "Speed drills exercise working memory under load — the cognitive strain is the training.",
      citation: "Jaeggi et al., 2008",
    },
  ],
  explorer: [
    {
      technique: "Depth of Processing",
      tip: "Deeper semantic processing leads to more durable memory traces.",
      citation: "Craik & Lockhart, 1972",
    },
    {
      technique: "Elaborative Interrogation",
      tip: "Asking 'why does this work?' enhances fact learning more than just reading.",
      citation: "Pressley et al., 1987",
    },
  ],
  dashboard: [
    {
      technique: "Spaced Repetition",
      tip: "Distributing practice over time significantly improves long-term retention.",
      citation: "Cepeda et al., 2006",
    },
    {
      technique: "Sleep & Memory",
      tip: "Sleep actively consolidates memories — study before bed for best results.",
      citation: "Rasch & Born, 2013",
    },
  ],
};

export function getTipsForMode(mode: Mode): ModeTip[] {
  return MODE_TIPS[mode] ?? MODE_TIPS.dashboard;
}

export const EVIDENCE_COLORS: Record<string, "violet" | "blue" | "green" | "orange" | "amber" | "gray"> = {
  meta_analysis: "violet",
  systematic_review: "blue",
  rct: "green",
  review: "orange",
  cohort: "amber",
  foundational_theory: "gray",
  case_study: "gray",
  expert_opinion: "gray",
};

export function formatAuthors(authors: string[]): string {
  if (!authors || authors.length === 0) return "";
  if (authors.length <= 2) return authors.join(", ");
  return `${authors[0]}, ${authors[1]} et al.`;
}
