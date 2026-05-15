"use server";

import { search } from "@/lib/search-index";
import type { SearchResult } from "../data";

/**
 * Full-text-ish search over the Rust-exported JSON (replaces SQLite FTS5).
 */
export async function searchContent(query: string): Promise<SearchResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  try {
    return search(trimmed, 20).map((r) => ({
      resultType: r.resultType,
      title: r.title,
      snippet: r.snippet,
      rank: r.score,
      lessonSlug: r.lessonSlug,
      lessonTitle: r.lessonTitle,
    }));
  } catch (error) {
    console.error("Search error:", error);
    return [];
  }
}
