"use client";
// TEMPORARY preview route for visual verification of the redesigned audio
// player (R2 audio JSON is unavailable in the sandbox). Deleted immediately
// after screenshotting — must NOT be committed.
import { AudioPlayer } from "@/components/audio-player";

const STUB = {
  slug: "preview",
  title: "Tokenization: BPE, SentencePiece & Vocabulary Design",
  voice: "preview",
  duration_secs: 1440,
  file_size_bytes: 0,
  audio_url: "",
  chapters: [
    { index: 0, title: "Why tokenization matters", start_secs: 0, duration_secs: 240 },
    { index: 1, title: "Byte-Pair Encoding (BPE)", start_secs: 240, duration_secs: 300 },
    { index: 2, title: "SentencePiece & Unigram", start_secs: 540, duration_secs: 300 },
    { index: 3, title: "Vocabulary size trade-offs", start_secs: 840, duration_secs: 300 },
    { index: 4, title: "Special tokens & chat templates", start_secs: 1140, duration_secs: 300 },
  ],
};

export default function PlayerPreview() {
  return (
    <div style={{ minHeight: "120vh", padding: 40, color: "#fff" }}>
      <h1>Audio player preview</h1>
      <p>Temporary route — verifying the Audible-style redesign.</p>
      <AudioPlayer
        meta={STUB}
        gradient={["var(--violet-9)", "var(--violet-11)"]}
        icon="🧠"
        category="Phase 1 · Foundations & Model Inference"
      />
    </div>
  );
}
