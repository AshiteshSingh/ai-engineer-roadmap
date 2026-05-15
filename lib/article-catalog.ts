import fs from "node:fs";
import path from "node:path";

export const KNOWLEDGE_APP_DIR = path.resolve(
  process.env.KNOWLEDGE_APP_DIR ?? process.cwd(),
);
export const CONTENT_DIR = path.join(KNOWLEDGE_APP_DIR, "content");
const ARTICLES_TS = path.join(KNOWLEDGE_APP_DIR, "lib/articles.ts");

let _slugs: string[] | null = null;
let _categories: Array<[number, number, string]> | null = null;

export function getLessonSlugs(): string[] {
  if (_slugs) return _slugs;
  if (!fs.existsSync(ARTICLES_TS)) {
    _slugs = fs
      .readdirSync(CONTENT_DIR)
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.replace(/\.md$/, ""))
      .sort();
    return _slugs;
  }
  const text = fs.readFileSync(ARTICLES_TS, "utf-8");
  const block = text.split("const LESSON_SLUGS")[1]?.split("];")[0] ?? "";
  _slugs = [...block.matchAll(/"([\w-]+)"/g)].map((m) => m[1]);
  return _slugs;
}

export function getCategories(): Array<[number, number, string]> {
  if (_categories) return _categories;
  if (!fs.existsSync(ARTICLES_TS)) return (_categories = [[1, 999, "General"]]);
  const text = fs.readFileSync(ARTICLES_TS, "utf-8");
  const block = text.split("CATEGORIES")[1]?.split("];")[0] ?? "";
  const parsed = [...block.matchAll(/\[(\d+),\s*(\d+),\s*"([^"]+)"\]/g)].map(
    (m) => [+m[1], +m[2], m[3]] as [number, number, string],
  );
  _categories = parsed.length > 0 ? parsed : [[1, 999, "General"]];
  return _categories;
}

export function getCategory(slug: string): string {
  const slugs = getLessonSlugs();
  const idx = slugs.indexOf(slug) + 1;
  for (const [lo, hi, name] of getCategories()) {
    if (idx >= lo && idx <= hi) return name;
  }
  return "Applied AI & Production";
}

export function getRelatedTopics(slug: string): string {
  const slugs = getLessonSlugs();
  if (!slugs.includes(slug)) return slugs.slice(0, 10).join(", ");
  const idx = slugs.indexOf(slug);
  const nearby = [
    ...slugs.slice(Math.max(0, idx - 3), idx),
    ...slugs.slice(idx + 1, idx + 4),
  ];
  return nearby.join(", ");
}

export function getExistingArticles(): string {
  const lines: string[] = [];
  for (const slug of getLessonSlugs()) {
    const md = path.join(CONTENT_DIR, `${slug}.md`);
    if (!fs.existsSync(md)) continue;
    const first = fs.readFileSync(md, "utf-8").split("\n", 1)[0];
    const title = first.startsWith("#")
      ? first.replace(/^#+\s*/, "").trim()
      : slug;
    lines.push(`- [${title}](/${slug})`);
  }
  return lines.join("\n");
}

export function getMissingSlugs(): string[] {
  return getLessonSlugs().filter(
    (s) => !fs.existsSync(path.join(CONTENT_DIR, `${s}.md`)),
  );
}

export function getStyleSample(): string {
  for (const slug of ["langgraph", "transformer-architecture", "embeddings"]) {
    const md = path.join(CONTENT_DIR, `${slug}.md`);
    if (fs.existsSync(md)) return fs.readFileSync(md, "utf-8").slice(0, 2000);
  }
  return "";
}
