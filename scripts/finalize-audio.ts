/**
 * Finalize an audio runtime artifact (per-chapter / no-stitch), slug-driven.
 *
 * Merges the authoritative narration (data/audio/<slug>.json — chapter
 * titles + scripts + full_script) with the REAL measured per-chapter timings
 * AND per-chapter MP3 URLs from the Qwen-TTS sidecar
 * (crates/tts/knowledge-output/<slug>.json, produced by
 * `knowledge_tts --per-chapter`), producing the JSON the page serves from R2:
 *   - voice "ethan"
 *   - per-chapter audio_url -> https://<R2_PUBLIC_DOMAIN>/knowledge/<slug>/NN.mp3
 *   - top-level audio_url -> chapter 0's URL (non-empty ⇒ gate `tts-state` passes)
 *   - real per-chapter start_secs/duration_secs (so chapter seek lines up)
 *   - chapter scripts + canonical full_script preserved (transcript renders)
 *
 * There is NO single stitched MP3 anymore — the player streams each chapter
 * piece and background-prefetches the next. Output is staged at
 * data/<slug>.json (the path scripts/upload-audio.ts expects); the per-chapter
 * MP3s reach R2 via `knowledge_tts --per-chapter --upload`. The committed
 * data/audio/<slug>.json (pending-tts, gate-valid) is left untouched.
 *
 * Run: npx tsx --env-file=.env.local scripts/finalize-audio.ts <slug>
 *      (slug defaults to "vitrifi" for back-compat).
 */

import fs from "fs";
import path from "path";

const APP = path.join(__dirname, "..");
const REPO = path.join(APP, "..", "..");

const slug = process.argv[2] || "vitrifi";

const AUTH = path.join(APP, "data", "audio", `${slug}.json`);
const SIDE = path.join(REPO, "crates", "tts", "knowledge-output", `${slug}.json`);
const OUT_JSON = path.join(APP, "data", `${slug}.json`);

function die(msg: string): never {
  console.error(`finalize-audio[${slug}]: ${msg}`);
  process.exit(1);
}

const r2Domain = process.env.R2_PUBLIC_DOMAIN;
if (!r2Domain) die("R2_PUBLIC_DOMAIN not set (run with --env-file=.env.local)");
for (const p of [AUTH, SIDE]) {
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
  audio_url?: string;
  file_size_bytes?: number;
};
type SideMeta = {
  slug: string;
  duration_secs: number;
  file_size_bytes: number;
  audio_url: string;
  chapters: SideChapter[];
};

const auth = JSON.parse(fs.readFileSync(AUTH, "utf8")) as AuthMeta;
const side = JSON.parse(fs.readFileSync(SIDE, "utf8")) as SideMeta;

// ── Drift guard: same chapters, same order
if (auth.chapters.length !== side.chapters.length) {
  die(
    `chapter count mismatch: authoritative=${auth.chapters.length} sidecar=${side.chapters.length}. ` +
      `Re-run \`npm run audio:${slug}\` then \`npm run audio:${slug}:tts\`.`,
  );
}
for (let i = 0; i < auth.chapters.length; i++) {
  const a = auth.chapters[i].title.trim();
  const s = side.chapters[i].title.trim();
  if (a !== s) {
    die(`chapter ${i} title mismatch:\n  authoritative: ${JSON.stringify(a)}\n  sidecar:       ${JSON.stringify(s)}`);
  }
  if (!side.chapters[i].audio_url) {
    die(
      `chapter ${i} has no audio_url in the sidecar — the TTS run was not ` +
        `--per-chapter. Re-run \`npm run audio:${slug}:tts\`.`,
    );
  }
}

// Rebuild start_secs as the cumulative sum of rounded measured durations so
// start_secs === sum(prior durations) exactly (no rounding drift); carry the
// per-chapter MP3 URL + size through. Player plays each piece; global time =
// chapter.start_secs + element.currentTime.
let cursor = 0;
let totalBytes = 0;
const chapters = auth.chapters.map((c, i) => {
  const s = side.chapters[i];
  const dur = Math.max(1, Math.round(s.duration_secs));
  const start = cursor;
  cursor += dur;
  totalBytes += s.file_size_bytes ?? 0;
  return {
    index: i,
    title: c.title,
    start_secs: start,
    duration_secs: dur,
    script: c.script,
    audio_url: s.audio_url as string,
    file_size_bytes: s.file_size_bytes ?? 0,
  };
});

const totalDuration = cursor;
// Top-level audio_url = chapter 0's piece: non-empty so the audio gate's
// `tts-state` rule (voice!="pending-tts" ⇒ audio_url not empty) stays green.
const topAudioUrl = chapters[0]?.audio_url ?? "";

const meta = {
  slug,
  title: auth.title,
  voice: "ethan",
  duration_secs: totalDuration,
  file_size_bytes: totalBytes,
  audio_url: topAudioUrl,
  chapters,
  full_script: auth.full_script, // canonical, unchanged
};

fs.writeFileSync(OUT_JSON, JSON.stringify(meta, null, 2) + "\n", "utf8");

console.log(
  `finalize-audio[${slug}]: wrote\n` +
    `  ${OUT_JSON}\n` +
    `  voice=ethan chapters=${chapters.length} (per-chapter, no stitch)\n` +
    `  duration=${totalDuration}s (~${Math.round(totalDuration / 60)} min, sum-of-chapters)\n` +
    `  total mp3 bytes=${(totalBytes / 1_000_000).toFixed(1)} MB across ${chapters.length} pieces\n` +
    `  top audio_url=${topAudioUrl}\n` +
    `  per-chapter audio_url=https://${r2Domain}/knowledge/${slug}/NN.mp3; ` +
    `start_secs cumulative-of-rounded; titles verified vs authoritative.`,
);
