import type { Metadata } from "next";
import { PhaseHub } from "@/components/phase-hub/PhaseHub";
import { phaseHubMetadata } from "@/lib/phase-hub-metadata";

const SLUG = "phase-5-evals";

export async function generateMetadata(): Promise<Metadata> {
  return phaseHubMetadata(SLUG);
}

// Dedicated hub for Phase 6 · Evals, Safety & Observability. Thin wrapper
// over the reusable <PhaseHub> (design-system components, zero global CSS,
// interactive search / filter / sort).
export default function EvalsHubPage() {
  return <PhaseHub slug={SLUG} />;
}
