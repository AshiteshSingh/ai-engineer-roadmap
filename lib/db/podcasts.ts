/**
 * RAG podcast-episode reader, backed by the Rust-exported JSON
 * (data/content/rag-podcasts.json). Mirrors lib/db/queries.ts: no SQLite, a
 * cached read with a graceful empty-array fallback so the /rag rail renders
 * nothing when the file is absent (other hubs stay byte-identical).
 *
 * The file is produced by the `spotify-podcasts` aer-ml bin (Spotify Web API,
 * client-credentials) and is shipped to the serverless bundle via
 * next.config.ts `outputFileTracingIncludes` ("./data/content/**").
 */

import fs from "fs";
import path from "path";
import { resolveContentDir } from "../content-json";

export interface RagPodcast {
  id: string;
  title: string;
  /** Podcast / show name. */
  show: string;
  publisher: string | null;
  /** https://open.spotify.com/episode/<id> */
  url: string;
  imageUrl: string | null;
  description: string | null;
  durationMin: number;
  /** ISO date, YYYY-MM-DD. */
  releaseDate: string;
  /** Ranking score; the rail is sorted by this descending. */
  relevance: number;
}

function readJson<T>(file: string, fallback: T): T {
  try {
    const p = path.join(resolveContentDir(), file);
    return JSON.parse(fs.readFileSync(p, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

let _episodes: RagPodcast[] | null = null;

/**
 * RAG-related Spotify episodes for the /rag phase rail, sorted by relevance
 * (then most-recent). Returns [] when nothing is seeded (rail renders nothing).
 */
export async function getRagPodcasts(): Promise<RagPodcast[]> {
  if (!_episodes)
    _episodes = readJson<RagPodcast[]>("rag-podcasts.json", []);
  return [..._episodes].sort(
    (a, b) =>
      b.relevance - a.relevance ||
      (b.releaseDate < a.releaseDate ? -1 : b.releaseDate > a.releaseDate ? 1 : 0),
  );
}
