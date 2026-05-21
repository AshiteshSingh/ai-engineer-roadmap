/**
 * Read dynamic content from the D1 `content_cache` table (written by the Rust
 * `sync-d1` pipeline). This is the runtime source that lets new/edited lessons
 * and audio guides appear on refresh without redeploying the app.
 *
 * Each row's `payload` is the exact JSON the app already consumes
 * (`ContentIndex` / `LessonFull` / `AudioMeta`), so reads are "row → JSON.parse
 * → existing shaper". All functions degrade to `null` when D1 is unconfigured
 * or empty, so callers fall back to the bundled JSON / R2 sources.
 */

import { cache } from "react";
import { d1Configured, d1Query } from "./d1";
import {
  type ContentIndex,
  type LessonFull,
  lessonWithContentFromFull,
} from "./content-json";
import type { LessonWithContent } from "./articles";
import type { AudioMeta } from "./audio";

interface PayloadRow {
  payload: string;
}

/** Fetch one `content_cache` row and parse its JSON payload. */
async function getDoc<T>(kind: string, slug: string): Promise<T | null> {
  if (!d1Configured()) return null;
  try {
    const rows = await d1Query<PayloadRow>(
      "SELECT payload FROM content_cache WHERE kind = ? AND slug = ? LIMIT 1",
      [kind, slug],
      // ISR: cache content reads (1h TTL) so they do not force every consuming
      // page to dynamic rendering, and tag them so the Rust `sync-d1` publish
      // step can bust them on demand via /api/revalidate. `audio:<slug>` matches
      // the tag that pipeline already POSTs.
      { revalidate: 3600, tags: [kind, `${kind}:${slug}`] },
    );
    const raw = rows[0]?.payload;
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null; // D1 unavailable / table missing — let the caller fall back.
  }
}

/** The content index (categories + lesson list). Deduped per request. */
export const getIndexFromD1 = cache(
  async (): Promise<ContentIndex | null> => getDoc<ContentIndex>("index", "__index__"),
);

export async function getLessonBySlugFromD1(
  slug: string,
): Promise<LessonWithContent | null> {
  const full = await getDoc<LessonFull>("lesson", slug);
  return full ? lessonWithContentFromFull(full) : null;
}

export async function getAudioMetaFromD1(slug: string): Promise<AudioMeta | null> {
  return getDoc<AudioMeta>("audio", slug);
}
