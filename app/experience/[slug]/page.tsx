import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import {
  getAllExperience,
  getExperienceBySlug,
  parseSummary,
} from "@/lib/experience";
import { getExperienceDetail } from "@/lib/experience-detail";
import { MarkdownProse } from "@/components/markdown-prose";
import styles from "../experience.module.css";

type Props = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return getAllExperience().map(({ slug }) => ({ slug }));
}

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
  const entry = getExperienceBySlug(slug);
  if (!entry) notFound();

  const { bullets, techStack } = parseSummary(entry.summary);
  const detail = getExperienceDetail(slug);

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

      {detail && (
        <section className={styles.caseStudy}>
          <h2 className={styles.sectionTitle}>Case study</h2>
          <MarkdownProse content={detail} />
        </section>
      )}
    </main>
  );
}
