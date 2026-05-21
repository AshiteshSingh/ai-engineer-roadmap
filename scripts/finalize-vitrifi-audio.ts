/**
 * Back-compat shim. The finalizer is now slug-driven in
 * scripts/finalize-audio.ts (slug = process.argv[2] || "vitrifi"), so the
 * historical `npx tsx --env-file=.env.local scripts/finalize-vitrifi-audio.ts`
 * (no slug arg) still finalizes vitrifi byte-for-byte.
 */
import "./finalize-audio";
