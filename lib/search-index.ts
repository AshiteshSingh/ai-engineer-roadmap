/**
 * Lexical search over the Rust-exported JSON (replaces SQLite FTS5).
 *
 * Source: data/content/sections.json (one row per lesson section) plus a
 * per-lesson aggregate. Embedding/vector search was removed — those tables
 * were never populated, so deep search was already lexical-only in practice.
 */

import fs from "fs";
import path from "path";
import { resolveContentDir } from "./content-json";

interface SectionRow {
  lessonSlug: string;
  lessonTitle: string;
  heading: string;
  content: string;
}

interface LessonDoc {
  slug: string;
  title: string;
  text: string; // title + all section content, lowercased
}

interface SectionDoc extends SectionRow {
  haystack: string; // heading + content, lowercased
}

let _sections: SectionDoc[] | null = null;
let _lessons: LessonDoc[] | null = null;

function load() {
  if (_sections && _lessons) return;
  const file = path.join(resolveContentDir(), "sections.json");
  const rows: SectionRow[] = JSON.parse(fs.readFileSync(file, "utf-8"));

  _sections = rows.map((r) => ({
    ...r,
    haystack: `${r.heading}\n${r.content}`.toLowerCase(),
  }));

  const byLesson = new Map<string, LessonDoc>();
  for (const r of rows) {
    let doc = byLesson.get(r.lessonSlug);
    if (!doc) {
      doc = {
        slug: r.lessonSlug,
        title: r.lessonTitle,
        text: r.lessonTitle.toLowerCase(),
      };
      byLesson.set(r.lessonSlug, doc);
    }
    doc.text += `\n${r.content.toLowerCase()}`;
  }
  _lessons = [...byLesson.values()];
}

const STOP = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "is", "for", "on", "with",
  "how", "what", "why",
]);

function terms(query: string): string[] {
  return [
    ...new Set(
      query
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length >= 2 && !STOP.has(t)),
    ),
  ];
}

function countOccurrences(haystack: string, term: string): number {
  let n = 0;
  let i = haystack.indexOf(term);
  while (i !== -1) {
    n++;
    i = haystack.indexOf(term, i + term.length);
  }
  return n;
}

function makeSnippet(content: string, ts: string[]): string {
  const lower = content.toLowerCase();
  let at = -1;
  for (const t of ts) {
    const i = lower.indexOf(t);
    if (i !== -1 && (at === -1 || i < at)) at = i;
  }
  if (at === -1) at = 0;
  const start = Math.max(0, at - 40);
  const raw = content.slice(start, start + 200).replace(/\s+/g, " ").trim();
  let snippet = raw;
  for (const t of ts) {
    const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    snippet = snippet.replace(new RegExp(`(${escaped})`, "gi"), "**$1**");
  }
  return `${start > 0 ? "..." : ""}${snippet}...`;
}

export interface ScoredResult {
  resultType: "lesson" | "section";
  title: string;
  snippet: string;
  score: number;
  lessonSlug: string | null;
  lessonTitle: string | null;
}

/** Ranked lexical search across lessons and sections, best-first. */
export function search(query: string, limit = 20): ScoredResult[] {
  const ts = terms(query);
  if (ts.length === 0) return [];
  load();

  const results: ScoredResult[] = [];

  for (const l of _lessons!) {
    let score = 0;
    for (const t of ts) {
      const inTitle = l.title.toLowerCase().includes(t) ? 1 : 0;
      score += countOccurrences(l.text, t) + inTitle * 8;
    }
    if (score > 0) {
      results.push({
        resultType: "lesson",
        title: l.title,
        snippet: "",
        score,
        lessonSlug: l.slug,
        lessonTitle: l.title,
      });
    }
  }

  for (const s of _sections!) {
    let score = 0;
    for (const t of ts) {
      const inHeading = s.heading.toLowerCase().includes(t) ? 1 : 0;
      score += countOccurrences(s.haystack, t) + inHeading * 4;
    }
    if (score > 0) {
      results.push({
        resultType: "section",
        title: s.heading,
        snippet: makeSnippet(s.content, ts),
        score,
        lessonSlug: s.lessonSlug,
        lessonTitle: s.lessonTitle,
      });
    }
  }

  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}
