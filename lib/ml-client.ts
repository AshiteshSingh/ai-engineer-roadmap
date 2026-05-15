/**
 * Unified ML client — calls the Rust embed-server (candle + Metal)
 * and loads precomputed JSON artifacts from crates/ml/data/.
 *
 * Embedding server:
 *   cd crates/ml/core && cargo run --bin build-similarity
 *   cd ../../../../../crates/candle && cargo run --bin embed-server --features server
 *
 * Env vars:
 *   EMBED_URL — optional, default "http://localhost:9999"
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";

const DEFAULT_EMBED_URL = "http://localhost:9999";

function getEmbedUrl(): string {
  return process.env.EMBED_URL || DEFAULT_EMBED_URL;
}

// ── Embeddings (proxy to existing embed-server) ─────────────────────

interface EmbedResponse {
  data: { embedding: number[]; index: number }[];
}

export async function embed(text: string): Promise<number[]> {
  const res = await fetch(`${getEmbedUrl()}/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input: text }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Embed server error (${res.status}): ${err}`);
  }
  const json: EmbedResponse = await res.json();
  return json.data[0].embedding;
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  const res = await fetch(`${getEmbedUrl()}/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input: texts }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Embed server error (${res.status}): ${err}`);
  }
  const json: EmbedResponse = await res.json();
  return json.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

// ── Similarity Matrix (precomputed JSON) ─────────────────────────────

interface SimilarityMatrix {
  slugs: string[];
  scores: number[];
  n: number;
}

let _similarityMatrix: SimilarityMatrix | null = null;

function loadSimilarityMatrix(): SimilarityMatrix | null {
  if (_similarityMatrix) return _similarityMatrix;

  const path = join(process.cwd(), "crates", "ml", "data", "similarity-matrix.json");
  if (!existsSync(path)) return null;

  _similarityMatrix = JSON.parse(readFileSync(path, "utf-8"));
  return _similarityMatrix;
}

export function getSimilarLessons(
  slug: string,
  k = 5,
): { slug: string; score: number }[] {
  const matrix = loadSimilarityMatrix();
  if (!matrix) return [];

  const idx = matrix.slugs.indexOf(slug);
  if (idx === -1) return [];

  const row = matrix.scores.slice(idx * matrix.n, (idx + 1) * matrix.n);
  const scored = row
    .map((score, i) => ({ slug: matrix.slugs[i], score }))
    .filter((_, i) => i !== idx)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);

  return scored;
}

// ── Readability (precomputed JSON) ───────────────────────────────────

interface ReadabilityMetrics {
  flesch_kincaid_grade: number;
  gunning_fog: number;
  avg_sentence_length: number;
  avg_syllables_per_word: number;
  technical_term_density: number;
  code_block_ratio: number;
  formula_density: number;
  difficulty: "Beginner" | "Intermediate" | "Advanced";
}

interface SectionReadability {
  heading: string;
  metrics: ReadabilityMetrics;
}

interface LessonReadability {
  slug: string;
  overall: ReadabilityMetrics;
  sections: SectionReadability[];
}

let _readabilityData: LessonReadability[] | null = null;

function loadReadability(): LessonReadability[] | null {
  if (_readabilityData) return _readabilityData;

  const path = join(process.cwd(), "crates", "ml", "data", "readability.json");
  if (!existsSync(path)) return null;

  _readabilityData = JSON.parse(readFileSync(path, "utf-8"));
  return _readabilityData;
}

export function getLessonReadability(
  slug: string,
): LessonReadability | null {
  const data = loadReadability();
  if (!data) return null;
  return data.find((l) => l.slug === slug) ?? null;
}

export function getAllReadability(): LessonReadability[] {
  return loadReadability() ?? [];
}
