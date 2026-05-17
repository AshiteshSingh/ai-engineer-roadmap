import type { CSSProperties } from "react";
import { notFound } from "next/navigation";
import { getGroupedLessons, getAudioMeta } from "@/lib/data";
import type { AudioMeta } from "@/lib/audio";
import { Topbar } from "@/components/topbar";
import { Footer } from "@/components/footer";
import { PhaseHero } from "@/components/phase-hub/PhaseHero";
import { PhaseBrowser } from "@/components/phase-hub/PhaseBrowser";

export interface PhaseHubProps {
  /** Category slug to render (e.g. "phase-3-rag", "phase-5-evals"). */
  slug: string;
  /** Opt this hub into the Audible-style "Listen" tiles. Route-level flag —
   *  only routes that pass this get narration tiles (keeps other hubs as-is). */
  audio?: boolean;
}

/**
 * PhaseHub — reusable, server-rendered dedicated page for a single roadmap
 * phase: Topbar + hero + interactive (search / filter / sort) lesson browser
 * + Footer. Design-system components, zero global CSS. Each route under app/
 * is a thin wrapper that binds one `slug`.
 */
export async function PhaseHub({ slug, audio = false }: PhaseHubProps) {
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
  // stays ISR-static and degrades to all-"coming soon" if R2 is unset. Only
  // entries with a real audio_url are playable (empty / "pending-tts" ⇒
  // "coming soon"). Skipped entirely unless the route opted in via `audio`.
  let audioBySlug: Record<string, AudioMeta> | undefined;
  if (audio) {
    const metas = await Promise.all(
      articles.map((a) => getAudioMeta(a.fileSlug)),
    );
    audioBySlug = {};
    articles.forEach((a, i) => {
      const m = metas[i];
      if (m && m.audio_url) audioBySlug![a.slug] = m;
    });
  }

  // Bind the category gradient from data so the hero AND the lesson cards
  // share the same accent, without depending on any global .cat-* class.
  const gradientVars = {
    "--cat-from": meta.gradient[0],
    "--cat-to": meta.gradient[1],
  } as CSSProperties;

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
        gradient={meta.gradient}
        icon={meta.icon}
        category={category}
      />

      <Footer wordCount={wordCount} />
    </div>
  );
}

PhaseHub.displayName = "PhaseHub";
