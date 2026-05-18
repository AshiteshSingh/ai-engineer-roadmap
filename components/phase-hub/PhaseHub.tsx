import type { CSSProperties } from "react";
import { notFound } from "next/navigation";
import { getGroupedLessons, getAudioMeta } from "@/lib/data";
import type { AudioMeta } from "@/lib/audio";
import { getRagPodcasts } from "@/lib/db/podcasts";
import type { RagPodcast } from "@/lib/db/podcasts";
import { Topbar } from "@/components/topbar";
import { Footer } from "@/components/footer";
import { PhaseHero } from "@/components/phase-hub/PhaseHero";
import { PhaseBrowser } from "@/components/phase-hub/PhaseBrowser";
import { ReferencesSection } from "@/components/references-section";
import { PHASE_HUB_REFERENCES } from "@/lib/references";

export interface PhaseHubProps {
  /** Category slug to render (e.g. "phase-3-rag", "phase-5-evals"). */
  slug: string;
  /** Opt this hub into the Audible-style "Listen" tiles. Route-level flag —
   *  only routes that pass this get narration tiles (keeps other hubs as-is). */
  audio?: boolean;
  /** Opt this hub into the "RAG Podcasts" Spotify rail. Route-level flag —
   *  only /rag passes this; other hubs render no rail (stay byte-identical). */
  podcasts?: boolean;
}

/**
 * PhaseHub — reusable, server-rendered dedicated page for a single roadmap
 * phase: Topbar + hero + interactive (search / filter / sort) lesson browser
 * + Footer. Design-system components, zero global CSS. Each route under app/
 * is a thin wrapper that binds one `slug`.
 */
export async function PhaseHub({
  slug,
  audio = false,
  podcasts = false,
}: PhaseHubProps) {
  const groups = await getGroupedLessons();
  const allLessons = groups.flatMap((g) => g.articles);
  const total = allLessons.length;
  const wordCount = allLessons.reduce((sum, l) => sum + l.wordCount, 0);

  const group = groups.find((g) => g.meta.slug === slug);
  if (!group) notFound();

  const { meta, category, articles } = group;
  const minutes = Math.round(
    articles.reduce((sum, a) => sum + a.readingTimeMin, 0),
  );

  // Narration metadata for every lesson, fetched in parallel. getAudioMeta
  // returns null on no-R2 / 404 / error and is `revalidate: 3600`, so /rag
  // stays ISR-static. A lesson is PLAYABLE when it has chapter scripts — the
  // hub reads them aloud via SpeechSynthesis (no MP3 needed; audio_url empty /
  // "pending-tts" is fine). `audioMetas` is the ordered (roadmap-order) queue
  // for the whole-phase continuous playthrough. Skipped unless `audio` opted in.
  let audioBySlug: Record<string, AudioMeta> | undefined;
  let audioMetas: AudioMeta[] | undefined;
  if (audio) {
    const metas = await Promise.all(
      articles.map((a) => getAudioMeta(a.fileSlug)),
    );
    audioBySlug = {};
    audioMetas = [];
    articles.forEach((a, i) => {
      const m = metas[i];
      if (m && m.chapters?.length) {
        audioBySlug![a.slug] = m;
        audioMetas!.push(m);
      }
    });
  }

  // RAG-related Spotify episodes for the phase rail. Route-level opt-in
  // (only /rag passes `podcasts`); getRagPodcasts() degrades to [] when no
  // JSON is seeded, so other hubs render no rail and stay byte-identical.
  let ragPodcasts: RagPodcast[] | undefined;
  if (podcasts) {
    const eps = await getRagPodcasts();
    if (eps.length > 0) ragPodcasts = eps;
  }

  // Bind the category gradient from data so the hero AND the lesson cards
  // share the same accent, without depending on any global .cat-* class.
  const gradientVars = {
    "--cat-from": meta.gradient[0],
    "--cat-to": meta.gradient[1],
  } as CSSProperties;

  // Static phase-level "further reading" links (page chrome, not lesson
  // content). Empty for phases without an entry ⇒ section renders nothing ⇒
  // those routes (e.g. /evals) stay byte-identical.
  const references = PHASE_HUB_REFERENCES[slug] ?? [];

  return (
    <div style={gradientVars}>
      <Topbar lessonCount={total} />

      <PhaseHero
        category={category}
        meta={meta}
        lessonCount={articles.length}
        totalMinutes={minutes}
        categoryHref={`/#cat-${meta.slug}`}
      />

      <PhaseBrowser
        lessons={articles}
        audioBySlug={audioBySlug}
        audioMetas={audioMetas}
        podcasts={ragPodcasts}
        gradient={meta.gradient}
        icon={meta.icon}
        category={category}
      />

      {references.length > 0 ? (
        <ReferencesSection references={references} contained />
      ) : null}

      <Footer wordCount={wordCount} />
    </div>
  );
}

PhaseHub.displayName = "PhaseHub";
