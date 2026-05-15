"use server";

import { sql } from "drizzle-orm";
import { contentDb } from "@/src/db/content";
import type { SearchResult } from "../data";

export async function searchContent(
  query: string,
): Promise<SearchResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  try {
    // FTS5 query across lessons, sections, and concepts
    const results = contentDb.all<{
      result_type: string;
      title: string;
      snippet: string;
      rank: number;
      lesson_slug: string | null;
      lesson_title: string | null;
    }>(sql`
      SELECT * FROM (
        SELECT
          'lesson' AS result_type,
          l.title,
          snippet(lessons_fts, 2, '**', '**', '...', 40) AS snippet,
          lessons_fts.rank AS rank,
          l.slug AS lesson_slug,
          l.title AS lesson_title
        FROM lessons_fts
        JOIN lessons l ON l.rowid = lessons_fts.rowid
        WHERE lessons_fts MATCH ${trimmed}

        UNION ALL

        SELECT
          'section' AS result_type,
          ls.heading AS title,
          snippet(lesson_sections_fts, 1, '**', '**', '...', 40) AS snippet,
          lesson_sections_fts.rank AS rank,
          l.slug AS lesson_slug,
          l.title AS lesson_title
        FROM lesson_sections_fts
        JOIN lesson_sections ls ON ls.rowid = lesson_sections_fts.rowid
        JOIN lessons l ON l.id = ls.lesson_id
        WHERE lesson_sections_fts MATCH ${trimmed}

        UNION ALL

        SELECT
          'concept' AS result_type,
          c.name AS title,
          snippet(concepts_fts, 1, '**', '**', '...', 40) AS snippet,
          concepts_fts.rank AS rank,
          NULL AS lesson_slug,
          NULL AS lesson_title
        FROM concepts_fts
        JOIN concepts c ON c.rowid = concepts_fts.rowid
        WHERE concepts_fts MATCH ${trimmed}
      )
      ORDER BY rank
      LIMIT 20
    `);

    return results.map((r) => ({
      resultType: r.result_type as SearchResult["resultType"],
      title: r.title,
      snippet: r.snippet,
      rank: Math.abs(r.rank),
      lessonSlug: r.lesson_slug ?? null,
      lessonTitle: r.lesson_title ?? null,
    }));
  } catch (error) {
    console.error("Search error:", error);
    return [];
  }
}
