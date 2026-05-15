import Link from "next/link";

import { Topbar } from "@/components/topbar";
import { MarkdownProse } from "@/components/markdown-prose";
import { TableOfContents } from "@/components/toc";
import { ReadingProgress } from "@/components/reading-progress";
import { ScrollToTop } from "@/components/scroll-to-top";
import { AudioPlayer } from "@/components/audio-player";
import { getAudioMeta, getCategoryMeta } from "@/lib/data";
import { LANGGRAPH_LEAD_GEN_SD_SCRIPT } from "./_content";

const AUDIO_SLUG = "langgraph-lead-gen-sd";
const FALLBACK_TITLE = "AI Product Engineer Interview Prep — System Design";

export const metadata = {
  title:
    "AI Product Engineer Interview Prep — System Design — AI Engineering",
  description:
    "How to interview for a production AI engineering role — trace design, debugging in production, alert thresholds, and the composure habits the hiring manager is actually listening for.",
};

function extractTitle(markdown: string): string {
  const match = markdown.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : FALLBACK_TITLE;
}

function estimateReadingMinutes(markdown: string): number {
  const words = markdown.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 220));
}

export default async function LangGraphLeadGenSdPage() {
  const content = LANGGRAPH_LEAD_GEN_SD_SCRIPT;
  const title = extractTitle(content);
  const readingMin = estimateReadingMinutes(content);

  const [meta, audioMeta] = await Promise.all([
    getCategoryMeta("Agents & Harnesses"),
    getAudioMeta(AUDIO_SLUG),
  ]);

  return (
    <div className={`cat-${meta.slug}${audioMeta ? " has-audio-player" : ""}`}>
      <ReadingProgress />
      <Topbar />

      <div className="article-banner">
        <div className="article-banner-inner">
          <div className="article-banner-breadcrumb">
            <Link href="/">&larr; all lessons</Link>
            <span className="sep">/</span>
            <Link href="/langgraph">LangGraph</Link>
            <span className="sep">/</span>
            <Link href="/langgraph/lead-gen">Lead-Gen Deep Dive</Link>
            <span className="sep">/</span>
            <span>Interview Prep</span>
          </div>
          <h1 className="article-banner-title">{title}</h1>
          <p className="article-banner-excerpt">
            How to interview for a production AI engineering role — what the
            hiring manager is listening for, how to design a trace, how to
            debug a wrong answer from logs alone, what to alert on, and how to
            stay composed when the question goes one layer deeper than your
            experience.
          </p>
          <div className="article-banner-badges">
            <span className="badge-pill badge-pill--category">
              {meta.icon} Agents & Harnesses
            </span>
            <span className="badge-pill badge-pill--difficulty badge-pill--intermediate">
              Intermediate
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
          <MarkdownProse content={content} chapters={audioMeta?.chapters} />
          <ScrollToTop />
        </div>
        <TableOfContents markdown={content} />
      </div>
    </div>
  );
}
