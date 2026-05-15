"use server";

import { sql } from "drizzle-orm";
import { contentDb } from "@/src/db/content";
import {
  lessonEmbeddings,
  sectionEmbeddings,
  deserializeEmbedding,
} from "@/src/db/content-schema";
import { embed } from "../embeddings";
import { cosineSimilarity } from "../vector-math";
import type { SearchResult } from "../data";

export interface DeepSearchResult extends SearchResult {
  similarity: number;
  ftsRank: number;
  combinedScore: number;
}

// In-memory embedding caches (only ~200 rows, ~3MB total)
let lessonEmbCache: { lessonId: string; vec: number[] }[] | null = null;
let sectionEmbCache: { sectionId: string; lessonId: string; vec: number[] }[] | null = null;

function getLessonEmbeddings() {
  if (!lessonEmbCache) {
    const rows = contentDb
      .select({
        lessonId: lessonEmbeddings.lessonId,
        embedding: lessonEmbeddings.embedding,
      })
      .from(lessonEmbeddings)
      .all();
    lessonEmbCache = rows.map((r) => ({
      lessonId: r.lessonId,
      vec: deserializeEmbedding(r.embedding),
    }));
  }
  return lessonEmbCache;
}

function getSectionEmbeddings() {
  if (!sectionEmbCache) {
    const rows = contentDb
      .select({
        sectionId: sectionEmbeddings.sectionId,
        lessonId: sectionEmbeddings.lessonId,
        embedding: sectionEmbeddings.embedding,
      })
      .from(sectionEmbeddings)
      .all();
    sectionEmbCache = rows.map((r) => ({
      sectionId: r.sectionId,
      lessonId: r.lessonId,
      vec: deserializeEmbedding(r.embedding),
    }));
  }
  return sectionEmbCache;
}

/**
 * Deep search: embeds the query, then runs hybrid FTS5 + JS vector search
 * across lessons and sections. Falls back to FTS-only if embedding fails.
 */
export async function deepSearch(query: string): Promise<DeepSearchResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  let queryEmbedding: number[] | null = null;
  try {
    queryEmbedding = await embed(trimmed);
  } catch (e) {
    console.warn("Embedding failed, falling back to FTS-only:", e);
  }

  if (!queryEmbedding) {
    return ftsOnlySearch(trimmed);
  }

  try {
    // 1. FTS5 lesson search for BM25 ranks
    const ftsResults = contentDb.all<{
      lesson_id: string;
      slug: string;
      title: string;
      category_name: string;
      snippet: string;
      rank: number;
    }>(sql`
      SELECT
        l.id AS lesson_id,
        l.slug,
        l.title,
        c.name AS category_name,
        snippet(lessons_fts, 2, '**', '**', '...', 40) AS snippet,
        lessons_fts.rank AS rank
      FROM lessons_fts
      JOIN lessons l ON l.rowid = lessons_fts.rowid
      JOIN categories c ON c.id = l.category_id
      WHERE lessons_fts MATCH ${trimmed}
      LIMIT 20
    `);

    // 2. Vector similarity for all lesson embeddings
    const lessonEmbs = getLessonEmbeddings();
    const vectorScores = new Map<string, number>();
    for (const emb of lessonEmbs) {
      const sim = cosineSimilarity(queryEmbedding, emb.vec);
      if (sim > 0.2) {
        vectorScores.set(emb.lessonId, sim);
      }
    }

    // 3. Hybrid combine: 0.3 * normalized_fts + 0.7 * vector_similarity
    const maxFtsRank = Math.max(...ftsResults.map((r) => Math.abs(r.rank)), 1);
    const hybridMap = new Map<
      string,
      { slug: string; title: string; categoryName: string; snippet: string; ftsRank: number; vectorSim: number; combined: number }
    >();

    // Add FTS results
    for (const r of ftsResults) {
      const normalizedFts = Math.abs(r.rank) / maxFtsRank;
      const vectorSim = vectorScores.get(r.lesson_id) ?? 0;
      const combined = 0.3 * normalizedFts + 0.7 * vectorSim;
      hybridMap.set(r.lesson_id, {
        slug: r.slug,
        title: r.title,
        categoryName: r.category_name,
        snippet: r.snippet,
        ftsRank: normalizedFts,
        vectorSim,
        combined,
      });
    }

    // Add vector-only results (no FTS match but high vector similarity)
    for (const [lessonId, sim] of vectorScores) {
      if (!hybridMap.has(lessonId)) {
        const lesson = contentDb.all<{
          slug: string;
          title: string;
          category_name: string;
        }>(sql`
          SELECT l.slug, l.title, c.name AS category_name
          FROM lessons l
          JOIN categories c ON c.id = l.category_id
          WHERE l.id = ${lessonId}
        `)[0];
        if (lesson) {
          hybridMap.set(lessonId, {
            slug: lesson.slug,
            title: lesson.title,
            categoryName: lesson.category_name,
            snippet: "",
            ftsRank: 0,
            vectorSim: sim,
            combined: 0.7 * sim,
          });
        }
      }
    }

    const results: DeepSearchResult[] = [];

    // Lesson results (hybrid)
    for (const r of hybridMap.values()) {
      results.push({
        resultType: "lesson",
        title: r.title,
        snippet: r.snippet,
        rank: r.combined,
        lessonSlug: r.slug,
        lessonTitle: r.title,
        similarity: r.vectorSim,
        ftsRank: r.ftsRank,
        combinedScore: r.combined,
      });
    }

    // 4. Section vector search
    const sectionEmbs = getSectionEmbeddings();
    const sectionScored = sectionEmbs
      .map((e) => ({ ...e, sim: cosineSimilarity(queryEmbedding!, e.vec) }))
      .filter((e) => e.sim > 0.3)
      .sort((a, b) => b.sim - a.sim)
      .slice(0, 10);

    if (sectionScored.length > 0) {
      const sectionIds = sectionScored.map((s) => s.sectionId);
      const sectionMeta = contentDb.all<{
        id: string;
        heading: string;
        lesson_slug: string;
        lesson_title: string;
      }>(sql`
        SELECT ls.id, ls.heading, l.slug AS lesson_slug, l.title AS lesson_title
        FROM lesson_sections ls
        JOIN lessons l ON l.id = ls.lesson_id
        WHERE ls.id IN (${sql.join(sectionIds.map((id) => sql`${id}`), sql`, `)})
      `);

      const metaById = new Map(sectionMeta.map((m) => [m.id, m]));
      for (const s of sectionScored) {
        const meta = metaById.get(s.sectionId);
        if (meta) {
          results.push({
            resultType: "section",
            title: meta.heading,
            snippet: "",
            rank: s.sim,
            lessonSlug: meta.lesson_slug,
            lessonTitle: meta.lesson_title,
            similarity: s.sim,
            ftsRank: 0,
            combinedScore: s.sim,
          });
        }
      }
    }

    // Deduplicate
    const seen = new Map<string, DeepSearchResult>();
    for (const r of results.sort((a, b) => b.combinedScore - a.combinedScore)) {
      const key = `${r.resultType}-${r.title}-${r.lessonSlug}`;
      if (!seen.has(key)) {
        seen.set(key, r);
      }
    }

    return [...seen.values()].slice(0, 15);
  } catch (error) {
    console.error("Deep search error:", error);
    return ftsOnlySearch(trimmed);
  }
}

async function ftsOnlySearch(query: string): Promise<DeepSearchResult[]> {
  try {
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
        WHERE lessons_fts MATCH ${query}

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
        WHERE lesson_sections_fts MATCH ${query}
      )
      ORDER BY rank
      LIMIT 15
    `);

    return results.map((r) => ({
      resultType: r.result_type as DeepSearchResult["resultType"],
      title: r.title,
      snippet: r.snippet,
      rank: Math.abs(r.rank),
      lessonSlug: r.lesson_slug ?? null,
      lessonTitle: r.lesson_title ?? null,
      similarity: 0,
      ftsRank: Math.abs(r.rank),
      combinedScore: Math.abs(r.rank),
    }));
  } catch (error) {
    console.error("FTS fallback error:", error);
    return [];
  }
}
