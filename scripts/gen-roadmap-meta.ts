/**
 * Dump the roadmap structure from lib/articles.ts (the single source of the
 * category metadata + lesson ordering) to data/roadmap-meta.json — the only
 * seed input the Rust `seed-content` binary needs beyond content/*.md.
 *
 * Uses NO database driver (pure TS constants → JSON), so it does not
 * reintroduce the better-sqlite3 dependency.
 *
 *   npm run roadmap:meta
 */

import fs from "fs";
import path from "path";
import { CATEGORIES, CATEGORY_META, LESSON_NUMBER } from "../lib/articles";

const categories = CATEGORIES.map(([lo, hi, name], i) => {
  const meta = CATEGORY_META[name];
  return {
    name,
    slug: meta.slug,
    icon: meta.icon,
    description: meta.description,
    gradientFrom: meta.gradient[0],
    gradientTo: meta.gradient[1],
    outcomes: meta.outcomes ?? [],
    sortOrder: i,
    lessonRangeLo: lo,
    lessonRangeHi: hi,
  };
});

const out = { categories, lessonNumber: LESSON_NUMBER };

const file = path.join(process.cwd(), "data", "roadmap-meta.json");
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify(out, null, 2));

console.log(
  `Wrote ${file} (${categories.length} categories, ${Object.keys(LESSON_NUMBER).length} lesson numbers)`,
);
