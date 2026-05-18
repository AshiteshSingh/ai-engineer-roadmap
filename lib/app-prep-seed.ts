/**
 * Static interview-prep seed loader. The Rust `gen-app-prep` binary writes
 * data/app-prep/<slug>.json (in-process `app_prep` graph output); this reshapes
 * it into the `AppData` the prep page expects, so a committed artifact renders
 * publicly without a Neon row or an owner session.
 *
 * Pipeline: `pnpm prep:rust` → data/app-prep/<slug>.json → here →
 * GET /api/applications/[id] public fallback + the prep layout guard.
 */

import fs from "fs";
import path from "path";
import type { AppData } from "@/components/app-detail/types";

interface PrepArtifact {
  slug: string;
  company: string;
  position: string;
  url: string | null;
  status: string;
  jobDescription: string | null;
  aiInterviewQuestions: string | null;
  aiTechStack: string | null;
  generatedAt: string;
}

// Owner-only artifact written by the Rust `gen-app-prep-owner` bin to
// data/app-prep/<slug>.owner.json. A SEPARATE file from <slug>.json so neither
// regeneration path can clobber the other (regen-proof both ways).
interface OwnerPrepArtifact {
  slug: string;
  company: string;
  position: string;
  ownerPrep: string | null;
  generatedAt: string;
}

function resolveSeedDir(): string {
  if (process.env.APP_PREP_DIR) return process.env.APP_PREP_DIR;

  // Mirrors lib/content-json.ts: process.cwd()-scoped, /*turbopackIgnore*/-
  // annotated so the NFT tracer doesn't walk the project. The JSON ships via
  // next.config.ts outputFileTracingIncludes ("./data/app-prep/**").
  const candidates = [
    path.join(/*turbopackIgnore: true*/ process.cwd(), "data", "app-prep"),
    path.join(/*turbopackIgnore: true*/ process.cwd(), "apps", "knowledge", "data", "app-prep"),
    path.join(/*turbopackIgnore: true*/ process.cwd(), "apps", "ai-engineer-roadmap", "data", "app-prep"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(/*turbopackIgnore: true*/ c)) return c;
  }
  return candidates[0];
}

const _cache = new Map<string, AppData | null>();

/**
 * Resolve a seeded prep artifact by slug. Returns null for UUIDs, unknown
 * slugs, or anything that isn't a clean kebab-case slug (path-traversal guard).
 */
export function getAppPrepSeed(idOrSlug: string): AppData | null {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(idOrSlug)) return null;
  if (_cache.has(idOrSlug)) return _cache.get(idOrSlug)!;

  const file = path.join(resolveSeedDir(), `${idOrSlug}.json`);
  let app: AppData | null = null;
  if (fs.existsSync(/*turbopackIgnore: true*/ file)) {
    const a = JSON.parse(
      fs.readFileSync(/*turbopackIgnore: true*/ file, "utf-8"),
    ) as PrepArtifact;
    app = {
      id: a.slug,
      slug: a.slug,
      company: a.company,
      position: a.position,
      url: a.url ?? null,
      status: (a.status as AppData["status"]) ?? "saved",
      notes: null,
      jobDescription: a.jobDescription ?? null,
      aiInterviewQuestions: a.aiInterviewQuestions ?? null,
      // Owner-only: never sourced from the public seed. The API attaches it
      // from getOwnerPrepSeed() for the owner only; null everywhere else.
      ownerPrep: null,
      aiTechStack: a.aiTechStack ?? null,
      aiInterviewers: null,
      techDismissedTags: null,
      appliedAt: null,
      createdAt: a.generatedAt,
      updatedAt: a.generatedAt,
    };
  }
  _cache.set(idOrSlug, app);
  return app;
}

const _ownerCache = new Map<string, { ownerPrep: string } | null>();

/**
 * Resolve the owner-only tailored prep for a slug from
 * data/app-prep/<slug>.owner.json. Same path-traversal guard and dir
 * resolution as getAppPrepSeed. The CALLER is responsible for owner gating —
 * this only reads the file; it must only ever be invoked in an owner-verified
 * server branch (see app/api/applications/[id]/route.ts).
 */
export function getOwnerPrepSeed(
  idOrSlug: string,
): { ownerPrep: string } | null {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(idOrSlug)) return null;
  if (_ownerCache.has(idOrSlug)) return _ownerCache.get(idOrSlug)!;

  const file = path.join(resolveSeedDir(), `${idOrSlug}.owner.json`);
  let result: { ownerPrep: string } | null = null;
  if (fs.existsSync(/*turbopackIgnore: true*/ file)) {
    const a = JSON.parse(
      fs.readFileSync(/*turbopackIgnore: true*/ file, "utf-8"),
    ) as OwnerPrepArtifact;
    if (a.ownerPrep && a.ownerPrep.trim()) {
      result = { ownerPrep: a.ownerPrep };
    }
  }
  _ownerCache.set(idOrSlug, result);
  return result;
}
