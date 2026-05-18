/**
 * Static owner-only topic-guide loader. The Rust `gen-topic` binary writes
 * data/topics/<slug>.json (single-shot LLM study guide); this reads it back
 * for the owner-gated topic route (e.g. /module-federation).
 *
 * Pipeline: `pnpm prep:topic` → data/topics/<slug>.json → here →
 * app/module-federation/page.tsx (behind app/module-federation/layout.tsx).
 *
 * Mirrors lib/app-prep-seed.ts (same cwd-scoped, turbopackIgnore-annotated
 * dir resolution and path-traversal guard).
 */

import fs from "fs";
import path from "path";

export interface TopicSeed {
  slug: string;
  title: string;
  body: string;
  generatedAt: string;
}

function resolveSeedDir(): string {
  if (process.env.TOPIC_DIR) return process.env.TOPIC_DIR;

  const candidates = [
    path.join(/*turbopackIgnore: true*/ process.cwd(), "data", "topics"),
    path.join(/*turbopackIgnore: true*/ process.cwd(), "apps", "knowledge", "data", "topics"),
    path.join(/*turbopackIgnore: true*/ process.cwd(), "apps", "ai-engineer-roadmap", "data", "topics"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(/*turbopackIgnore: true*/ c)) return c;
  }
  return candidates[0];
}

const _cache = new Map<string, TopicSeed | null>();

/**
 * Resolve a generated topic guide by slug. Returns null for anything that
 * isn't a clean kebab-case slug (path-traversal guard) or has no artifact.
 */
export function getTopicSeed(slug: string): TopicSeed | null {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) return null;
  if (_cache.has(slug)) return _cache.get(slug)!;

  const file = path.join(resolveSeedDir(), `${slug}.json`);
  let topic: TopicSeed | null = null;
  if (fs.existsSync(/*turbopackIgnore: true*/ file)) {
    const t = JSON.parse(
      fs.readFileSync(/*turbopackIgnore: true*/ file, "utf-8"),
    ) as TopicSeed;
    topic = {
      slug: t.slug,
      title: t.title,
      body: t.body,
      generatedAt: t.generatedAt,
    };
  }
  _cache.set(slug, topic);
  return topic;
}
