import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { isOwner } from "@/lib/owner";
import { getExperienceBySlug, parseSummary } from "@/lib/experience";
import { getExperienceDetail } from "@/lib/experience-detail";
import { getAudioMeta } from "@/lib/audio";
import { MarkdownProse } from "@/components/markdown-prose";
import { AudioPlayer } from "@/components/audio-player";
import styles from "../experience.module.css";

// Most /experience entries are owner-only; the Vitrifi case study is public.
// Gating is per-slug below (the segment layout no longer blocks the route).
// Rendered per-request so the owner-session check can run on gated slugs —
// intentionally NO generateStaticParams (no static prerender).
type Props = { params: Promise<{ slug: string }> };

// Experience slugs anyone may view. Every other slug stays owner-gated.
const PUBLIC_EXPERIENCE_SLUGS = new Set(["vitrifi"]);

// Brand logo shown in the narration player's cover plate, per experience slug.
// Entries without a mapping fall back to the player's default emoji/gradient.
const EXPERIENCE_LOGOS: Record<string, { src: string; alt: string }> = {
  vitrifi: { src: "/experience/vitrifi-logo.png", alt: "Vitrifi" },
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const entry = getExperienceBySlug(slug);
  if (!entry) return {};
  const { bullets } = parseSummary(entry.summary);
  return {
    title: `${entry.name} — ${entry.position}`,
    description: bullets[0] ?? `${entry.position} at ${entry.name}`,
  };
}

export default async function ExperienceDetailPage({ params }: Props) {
  const { slug } = await params;

  // Public allow-list; non-public experience pages remain owner-only.
  if (!PUBLIC_EXPERIENCE_SLUGS.has(slug)) {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!isOwner(session)) redirect("/");
  }

  const entry = getExperienceBySlug(slug);
  if (!entry) notFound();

  const { bullets, techStack } = parseSummary(entry.summary);
  const detail = getExperienceDetail(slug);
  // Only entries with a hand-authored deep dive have audio — gate the fetch
  // so siblings don't trigger a per-request R2 lookup.
  const audioMeta = detail ? await getAudioMeta(slug) : null;
  const expLogo = EXPERIENCE_LOGOS[slug];

  return (
    <main className={styles.page}>
      <nav className={styles.crumbs} aria-label="Breadcrumb">
        <Link href="/" className={styles.crumbLink}>
          ← Home
        </Link>
      </nav>

      <header className={styles.header}>
        <h1 className={styles.company}>{entry.name}</h1>
        <p className={styles.role}>{entry.position}</p>
        <p className={styles.meta}>
          <span>
            {entry.startDate} – {entry.endDate}
          </span>
          {entry.years ? (
            <span className={styles.badge}>{entry.years}</span>
          ) : null}
        </p>
      </header>

      {bullets.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>What I did</h2>
          <ul className={styles.bullets}>
            {bullets.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        </section>
      )}

      {techStack.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Tech stack</h2>
          <ul className={styles.chips}>
            {techStack.map((t) => (
              <li key={t} className={styles.chip}>
                {t}
              </li>
            ))}
          </ul>
        </section>
      )}

      {audioMeta && (
        <section className={styles.listen}>
          <h2 className={styles.sectionTitle}>Listen</h2>
          <p className={styles.listenNote}>
            ~{Math.round(audioMeta.duration_secs / 60)} min narration — a
            spoken walkthrough of the work. Chapter headings below jump the
            player.
          </p>
          <AudioPlayer
            meta={audioMeta}
            category="Experience"
            logoSrc={expLogo?.src}
            logoAlt={expLogo?.alt}
          />
          {audioMeta.full_script && (
            <MarkdownProse
              content={audioMeta.full_script}
              chapters={audioMeta.chapters}
            />
          )}
        </section>
      )}

      {detail && (
        <section className={styles.caseStudy}>
          <h2 className={styles.sectionTitle}>Case study</h2>
          <MarkdownProse content={detail} />
        </section>
      )}
    </main>
  );
}
