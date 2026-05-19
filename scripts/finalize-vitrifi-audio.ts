/**
 * Finalize the Vitrifi audio runtime artifact.
 *
 * Merges the authoritative narration (data/audio/vitrifi.json — chapter
 * titles + scripts + full_script) with the REAL measured per-chapter timings
 * from the Qwen-TTS sidecar (crates/tts/knowledge-output/vitrifi.json) and the
 * real MP3, producing the JSON the page serves from R2:
 *   - voice "ethan", audio_url -> https://<R2_PUBLIC_DOMAIN>/knowledge/vitrifi.mp3
 *   - real per-chapter start_secs/duration_secs (so chapter seek lines up)
 *   - chapter scripts + canonical full_script preserved (transcript renders)
 *
 * Output is staged at data/vitrifi.json + data/vitrifi.mp3 — the paths
 * scripts/upload-audio.ts expects. The committed data/audio/vitrifi.json
 * (pending-tts, gate-valid) is left untouched on purpose.
 *
 * Run: npx tsx --env-file=.env.local scripts/finalize-vitrifi-audio.ts
 */

import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";

const APP = path.join(__dirname, "..");
const REPO = path.join(APP, "..", "..");

const AUTH = path.join(APP, "data", "audio", "vitrifi.json");
const SIDE = path.join(REPO, "crates", "tts", "knowledge-output", "vitrifi.json");
const SRC_MP3 = path.join(REPO, "crates", "tts", "knowledge-output", "vitrifi.mp3");
const OUT_JSON = path.join(APP, "data", "vitrifi.json");
const OUT_MP3 = path.join(APP, "data", "vitrifi.mp3");

function die(msg: string): never {
  console.error(`finalize-vitrifi-audio: ${msg}`);
  process.exit(1);
}

const r2Domain = process.env.R2_PUBLIC_DOMAIN;
if (!r2Domain) die("R2_PUBLIC_DOMAIN not set (run with --env-file=.env.local)");
for (const p of [AUTH, SIDE, SRC_MP3]) {
  if (!fs.existsSync(p)) die(`missing required input: ${p}`);
}

type AuthChapter = {
  index: number;
  title: string;
  start_secs: number;
  duration_secs: number;
  script: string;
};
type AuthMeta = {
  slug: string;
  title: string;
  voice: string;
  duration_secs: number;
  file_size_bytes: number;
  audio_url: string;
  chapters: AuthChapter[];
  full_script: string;
};
type SideChapter = {
  index: number;
  title: string;
  start_secs: number;
  duration_secs: number;
};
type SideMeta = {
  slug: string;
  duration_secs: number;
  file_size_bytes: number;
  chapters: SideChapter[];
};

const auth = JSON.parse(fs.readFileSync(AUTH, "utf8")) as AuthMeta;
const side = JSON.parse(fs.readFileSync(SIDE, "utf8")) as SideMeta;

// ── Drift guard: the two MUST describe the same 20 chapters in the same order
if (auth.chapters.length !== side.chapters.length) {
  die(
    `chapter count mismatch: authoritative=${auth.chapters.length} sidecar=${side.chapters.length}. ` +
      `Re-emit knowledge-output/vitrifi.input.md from full_script and re-run TTS.`,
  );
}
for (let i = 0; i < auth.chapters.length; i++) {
  const a = auth.chapters[i].title.trim();
  const s = side.chapters[i].title.trim();
  if (a !== s) {
    die(`chapter ${i} title mismatch:\n  authoritative: ${JSON.stringify(a)}\n  sidecar:       ${JSON.stringify(s)}`);
  }
}

// ── Real total duration: prefer ffprobe on the actual MP3
function ffprobeDuration(mp3: string): number | null {
  try {
    const out = execFileSync(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", mp3],
      { encoding: "utf8" },
    ).trim();
    const n = parseFloat(out);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

const mp3Size = fs.statSync(SRC_MP3).size;
if (mp3Size <= 0) die(`empty mp3 at ${SRC_MP3}`);

// Rebuild start_secs as the cumulative sum of rounded measured durations so
// start_secs === sum(prior durations) exactly (no rounding drift between the
// two), each ≈ the real measured offset. Seek uses these.
let cursor = 0;
const chapters = auth.chapters.map((c, i) => {
  const dur = Math.max(1, Math.round(side.chapters[i].duration_secs));
  const start = cursor;
  cursor += dur;
  return {
    index: i,
    title: c.title,
    start_secs: start,
    duration_secs: dur,
    script: c.script,
  };
});

const probed = ffprobeDuration(SRC_MP3);
const totalDuration = probed ? Math.round(probed) : cursor;

const meta = {
  slug: "vitrifi",
  title: auth.title,
  voice: "ethan",
  duration_secs: totalDuration,
  file_size_bytes: mp3Size,
  audio_url: `https://${r2Domain}/knowledge/vitrifi.mp3`,
  chapters,
  full_script: auth.full_script, // canonical, unchanged
};

fs.writeFileSync(OUT_JSON, JSON.stringify(meta, null, 2) + "\n", "utf8");
fs.copyFileSync(SRC_MP3, OUT_MP3);

console.log(
  `finalize-vitrifi-audio: wrote\n` +
    `  ${OUT_JSON}\n` +
    `  ${OUT_MP3} (${(mp3Size / 1_000_000).toFixed(1)} MB)\n` +
    `  voice=ethan chapters=${chapters.length} ` +
    `duration=${totalDuration}s (~${Math.round(totalDuration / 60)} min, ` +
    `${probed ? "ffprobe" : "sum-of-chapters"}) ` +
    `audio_url=https://${r2Domain}/knowledge/vitrifi.mp3\n` +
    `  start_secs cumulative-of-rounded; chapter titles verified vs authoritative.`,
);
