import type { Metadata } from "next";
import { PhaseHub } from "@/components/phase-hub/PhaseHub";
import { phaseHubMetadata } from "@/lib/phase-hub-metadata";

const SLUG = "phase-3-rag";

export async function generateMetadata(): Promise<Metadata> {
  return phaseHubMetadata(SLUG);
}

// Dedicated hub for Phase 3 · Embeddings & RAG. Thin wrapper over the
// reusable <PhaseHub> (design-system components, zero global CSS,
// interactive search / filter / sort). Browser-voice narration (Web Speech
// API "Listen" tiles / play-all / docked speech player) is intentionally
// disabled — do NOT re-add the `audio` prop without an explicit request.
export default function RagHubPage() {
  return <PhaseHub slug={SLUG} />;
}
