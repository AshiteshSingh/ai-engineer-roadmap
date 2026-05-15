"use server";

import { search } from "@/lib/search-index";
import type { SearchResult } from "../data";

export interface DeepSearchResult extends SearchResult {
  similarity: number;
  ftsRank: number;
  combinedScore: number;
}

/**
 * Deep search over the Rust-exported JSON. Vector/embedding search was
 * removed (those tables were never populated); this is the lexical ranking
 * normalized to a 0..1 `combinedScore`, keeping the prior API shape.
 */
export async function deepSearch(query: string): Promise<DeepSearchResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  try {
    const scored = search(trimmed, 15);
    const max = Math.max(1, ...scored.map((r) => r.score));
    return scored.map((r) => {
      const combined = r.score / max;
      return {
        resultType: r.resultType,
        title: r.title,
        snippet: r.snippet,
        rank: combined,
        lessonSlug: r.lessonSlug,
        lessonTitle: r.lessonTitle,
        similarity: 0,
        ftsRank: combined,
        combinedScore: combined,
      };
    });
  } catch (error) {
    console.error("Deep search error:", error);
    return [];
  }
}
