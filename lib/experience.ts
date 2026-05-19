import { resumeData } from "@ai-apps/resume";
import { toSlug } from "@/lib/slug";

export type WorkEntry = (typeof resumeData.work)[number];

export const WORK: readonly WorkEntry[] = resumeData.work;

/**
 * Stable, hand-curated slugs keyed by the entry's immutable `id` so URLs stay
 * clean and survive copy edits to company names in data.json. Any unmapped id
 * falls back to the shared toSlug() of the company name.
 */
const SLUG_BY_ID: Record<string, string> = {
  "1": "vitrifi",
  "2": "wunderman-thompson",
  "3": "event-espresso",
  "4": "modus-create",
  "5": "atomate",
  "6": "developmentaid",
  "7": "endava",
};

export function slugForEntry(entry: WorkEntry): string {
  return SLUG_BY_ID[entry.id] ?? toSlug(entry.name);
}

export function getAllExperience(): { slug: string; entry: WorkEntry }[] {
  return WORK.map((entry) => ({ slug: slugForEntry(entry), entry }));
}

export function getExperienceBySlug(slug: string): WorkEntry | undefined {
  return WORK.find((entry) => slugForEntry(entry) === slug);
}

export type ParsedSummary = { bullets: string[]; techStack: string[] };

/**
 * Port of htmlToBullets() from packages/resume/src/render.tsx — turns the
 * stored `<ul><li>…</li></ul>` summary into plain-text bullets plus a parsed
 * tech-stack list. Pure string parsing: no DOM, no deps, no dangerouslySetInnerHTML.
 */
export function parseSummary(html: string): ParsedSummary {
  const bullets: string[] = [];
  let techStackRaw: string | undefined;

  const liRegex = /<li>([\s\S]*?)<\/li>/gi;
  let match: RegExpExecArray | null;
  while ((match = liRegex.exec(html)) !== null) {
    const text = match[1].replace(/<[^>]+>/g, "").trim();
    if (!text) continue;
    if (text.startsWith("Tech stack:")) {
      techStackRaw = text.replace("Tech stack:", "").trim();
    } else {
      bullets.push(text);
    }
  }

  if (bullets.length === 0 && !techStackRaw) {
    for (const line of html.replace(/<[^>]+>/g, "\n").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith("Tech stack:")) {
        techStackRaw = trimmed.replace("Tech stack:", "").trim();
      } else {
        bullets.push(trimmed);
      }
    }
  }

  const techStack = techStackRaw
    ? techStackRaw
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
    : [];

  return { bullets, techStack };
}
