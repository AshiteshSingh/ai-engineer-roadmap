import Link from "next/link";
import { headers } from "next/headers";

import { auth } from "@/lib/auth";
import { isOwner } from "@/lib/owner";
import { LanggraphOwnerDive } from "@/components/langgraph/LanggraphOwnerDive";
import { Topbar } from "@/components/topbar";
import { MarkdownProse } from "@/components/markdown-prose";
import { TableOfContents } from "@/components/toc";
import { ScrollToTop } from "@/components/scroll-to-top";
import { AudioPlayer } from "@/components/audio-player";
import { getAudioMeta, getCategoryMeta } from "@/lib/data";
import { LANGGRAPH_LEAD_GEN_SCRIPT } from "./_content";

// Page body is the Rust pipeline's audio-optimized narration (DeepSeek v4
// output, written by `apps/knowledge/crates/ml/langgraph-audio` into
// `data/langgraph-lead-gen.script.md`, then inlined into `_content.ts` so the
// bundler can ship it inside the serverless function — `data/` is in
// `.vercelignore`, so a runtime `fs.readFileSync` against `data/` can't see
// the file. Same source as the AudioPlayer transcripts, so the on-page text
// and the spoken audio (once TTS lands) stay bit-for-bit aligned.
const AUDIO_SLUG = "langgraph-lead-gen";
const FALLBACK_TITLE = "LangGraph in Production: Lead-Gen Deep Dive";

export const metadata = {
  title: "LangGraph in Production: Lead-Gen Deep Dive — AI Engineering",
  description:
    "How the lead-gen backend orchestrates 60+ LangGraph StateGraphs — Send-based fan-out, merge reducers, RemoteGraph circuit breakers, human-in-the-loop, and Langfuse telemetry.",
};

function extractTitle(markdown: string): string {
  // The Rust pipeline's script.md starts at H2 (no H1), so the H1 regex
  // typically misses — fall through to the page-level title constant.
  const match = markdown.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : FALLBACK_TITLE;
}

function estimateReadingMinutes(markdown: string): number {
  const words = markdown.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 220));
}

export default async function LangGraphLeadGenPage() {
  const content = LANGGRAPH_LEAD_GEN_SCRIPT;
  const title = extractTitle(content);
  const readingMin = estimateReadingMinutes(content);

  const [meta, audioMeta, session] = await Promise.all([
    getCategoryMeta("Agents & Harnesses"),
    getAudioMeta(AUDIO_SLUG),
    auth.api.getSession({ headers: await headers() }),
  ]);
  const owner = isOwner(session);

  return (
    <div className={`cat-${meta.slug}${audioMeta ? " has-audio-player" : ""}`}>
      <Topbar />

      <div className="article-banner">
        <div className="article-banner-inner">
          <div className="article-banner-breadcrumb">
            <Link href="/">&larr; all lessons</Link>
            <span className="sep">/</span>
            <Link href="/langgraph">LangGraph</Link>
            <span className="sep">/</span>
            <span>Lead-Gen Deep Dive</span>
          </div>
          <h1 className="article-banner-title">{title}</h1>
          <p className="article-banner-excerpt">
            A guided tour of how the lead-gen backend wires sixty-plus
            LangGraph StateGraphs into one production sales-intelligence
            system — sharing a Neon checkpointer, fanning out through the
            Send API, gating outreach with{" "}
            <code>interrupt()</code>, and tracing every LLM call through
            Langfuse.
          </p>
          <div className="article-banner-badges">
            <span className="badge-pill badge-pill--category">
              {meta.icon} Agents & Harnesses
            </span>
            <span className="badge-pill badge-pill--difficulty badge-pill--advanced">
              Advanced
            </span>
            <span className="badge-pill badge-pill--glass">
              ~{readingMin} min read
            </span>
            {audioMeta && (
              <span className="badge-pill badge-pill--glass">
                ~{Math.round(audioMeta.duration_secs / 60)} min listen
              </span>
            )}
          </div>
        </div>
      </div>

      {audioMeta && <AudioPlayer meta={audioMeta} />}

      <div className="article-grid">
        <div>
          <MarkdownProse content={content} />
          {owner && <LanggraphOwnerDive />}
          <ScrollToTop />
        </div>
        <TableOfContents markdown={content} />
      </div>
    </div>
  );
}
