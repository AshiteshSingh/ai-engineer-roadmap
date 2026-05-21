import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getAudioMeta } from "@/lib/audio";
import { MarkdownProse } from "@/components/markdown-prose";
import { AudioPlayer } from "@/components/audio-player";
import styles from "../../../experience/experience.module.css";
import rail from "./interviewing.module.css";

type Props = { params: Promise<{ slug: string }> };

type InterviewMeta = {
  title: string;
  role: string;
  date: string;
  context: string;
  format: string[];
  preparation: string[];
  logo?: { src: string; alt: string };
};

const INTERVIEWS: Record<string, InterviewMeta> = {
  typeform: {
    title: "Typeform",
    role: "Go Engineer · AI team",
    date: "Friday 22 May 2026, 12:00 EEST",
    context:
      "Live coding interview for the Typeform AI team. They've launched a chat layer over Typeform that lets users perform actions via natural language, and they're hiring to extend it.",
    format: [
      "90 minutes total — intros at the start, Q&A at the end, ~60 minutes of coding",
      "Free choice of frameworks, libraries, databases, and IDE",
      "AI tools (Cursor, Claude, ChatGPT) strongly encouraged and explicitly assessed",
      "Screen-share throughout so they can follow the code, the AI prompts, and the workflow",
      "Simplicity and clarity over completeness or polish",
    ],
    preparation: [
      "Small Go scaffold ready — `/chat` endpoint, SSE streaming, three mock Typeform tools, in-memory session memory, optional Next.js frontend",
      "Background pitch rehearsed: between roles since Vitrifi shut down in January 2026, ~12 years production web platforms, AI engineering roadmap site since",
      "Anchor stories from Vitrifi for trade-off questions: observability, event-driven, multi-tenant isolation, secure-by-default directives",
      "Light SDD as practice — 3-line verbal spec, out-of-scope line, no methodology theatre",
      "Three-item 'what I'd improve next' list: observability per tool call, eval coverage on entity resolution, event-driven decoupling",
    ],
  },
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const entry = INTERVIEWS[slug];
  if (!entry) return {};
  return {
    title: `${entry.title} — Live coding prep`,
    description: entry.context,
  };
}

export default async function InterviewingDetailPage({ params }: Props) {
  const { slug } = await params;
  const entry = INTERVIEWS[slug];
  if (!entry) notFound();

  const audioMeta = await getAudioMeta(slug);

  return (
    <div className={rail.railLayout}>
    <main className={styles.page}>
      <nav className={styles.crumbs} aria-label="Breadcrumb">
        <Link href="/" className={styles.crumbLink}>
          ← Home
        </Link>
      </nav>

      <header className={styles.header}>
        <h1 className={styles.company}>{entry.title}</h1>
        <p className={styles.role}>{entry.role}</p>
        <p className={styles.meta}>
          <span>{entry.date}</span>
          <span className={styles.badge}>Live coding</span>
        </p>
      </header>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Context</h2>
        <p>{entry.context}</p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Format</h2>
        <ul className={styles.bullets}>
          {entry.format.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>How I'm preparing</h2>
        <ul className={styles.bullets}>
          {entry.preparation.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      </section>

      {audioMeta && (
        <section className={styles.listen}>
          <h2 className={styles.sectionTitle}>Listen</h2>
          <p className={styles.listenNote}>
            ~{Math.round(audioMeta.duration_secs / 60)} min narration — eight
            chapters, each one a specific moment inside the 90-minute interview.
            Chapter headings below jump the player.
          </p>
          <AudioPlayer
            meta={audioMeta}
            category="Applications"
            logoSrc={entry.logo?.src}
            logoAlt={entry.logo?.alt}
            desktopRail
          />
          {audioMeta.full_script && (
            <MarkdownProse
              content={audioMeta.full_script}
              chapters={audioMeta.chapters}
            />
          )}
        </section>
      )}
    </main>
    </div>
  );
}
