/**
 * Audio metadata resolution.
 *
 * Precedence: Cloudflare R2 first (so a later TTS pass that publishes a real
 * MP3 + populated `audio_url` automatically wins), then the in-repo
 * `data/audio/<slug>.json` fallback written by the Rust `build-audio-guide`
 * pipeline. The fallback lets the chaptered transcript + player render in any
 * environment without R2 configured (voice still "pending-tts", no playback).
 *
 * Server-only: callers are server components (app/[slug]/page.tsx, the
 * langgraph lead-gen pages). Client code imports the types via `import type`.
 * The fs/path usage mirrors lib/content-json.ts, which ships in this build.
 */

import fs from "fs";
import path from "path";

export interface AudioChapter {
  index: number;
  title: string;
  start_secs: number;
  duration_secs: number;
  /** Per-chapter narration prose. Present in the generated JSON; consumed by
   *  the hub's Web-Speech player. Optional so an MP3-only meta still type-checks. */
  script?: string;
}

export interface AudioMeta {
  slug: string;
  title: string;
  voice: string;
  duration_secs: number;
  file_size_bytes: number;
  audio_url: string;
  chapters: AudioChapter[];
  /** Concatenated "## title\n\nscript" of every chapter. Present in generated JSON. */
  full_script?: string;
}

const R2_PUBLIC_DOMAIN = process.env.NEXT_PUBLIC_R2_DOMAIN || process.env.R2_PUBLIC_DOMAIN || "";

// process.cwd()-scoped paths are the bundler-static form Turbopack accepts;
// the /*turbopackIgnore*/ comments stop its NFT tracer from conservatively
// walking the whole project. The JSON ships explicitly via next.config.ts
// `outputFileTracingIncludes` ("./data/audio/**"), so nothing is lost. There
// is intentionally NO __dirname candidate — it is opaque to the tracer and
// is never the resolved path in prod (cwd is /var/task).
function resolveAudioDir(): string {
  if (process.env.AUDIO_JSON_DIR) return process.env.AUDIO_JSON_DIR;
  const candidates = [
    path.join(/*turbopackIgnore: true*/ process.cwd(), "data", "audio"),
    path.join(/*turbopackIgnore: true*/ process.cwd(), "apps", "knowledge", "data", "audio"),
    path.join(/*turbopackIgnore: true*/ process.cwd(), "apps", "ai-engineer-roadmap", "data", "audio"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(/*turbopackIgnore: true*/ c)) return c;
  }
  return candidates[0];
}

const _localCache = new Map<string, AudioMeta | null>();

function readLocalAudioMeta(slug: string): AudioMeta | null {
  if (_localCache.has(slug)) return _localCache.get(slug)!;
  let meta: AudioMeta | null = null;
  try {
    const file = path.join(resolveAudioDir(), `${slug}.json`);
    if (fs.existsSync(/*turbopackIgnore: true*/ file)) {
      meta = JSON.parse(
        fs.readFileSync(/*turbopackIgnore: true*/ file, "utf-8"),
      ) as AudioMeta;
    }
  } catch {
    meta = null;
  }
  _localCache.set(slug, meta);
  return meta;
}

export async function getAudioMeta(slug: string): Promise<AudioMeta | null> {
  if (R2_PUBLIC_DOMAIN) {
    try {
      const url = `https://${R2_PUBLIC_DOMAIN}/knowledge/${slug}.json`;
      const res = await fetch(url, { next: { revalidate: 3600 } });
      if (res.ok) return res.json();
    } catch {
      // Fall through to the in-repo fallback.
    }
  }
  return readLocalAudioMeta(slug);
}
