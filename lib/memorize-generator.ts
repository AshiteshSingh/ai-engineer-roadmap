import { chatCompletion } from "./llm";
import type { MemorizeCategory, MemorizeItem } from "./memorize-types";

interface TechBadge {
  tag: string;
  label: string;
  category: string;
  relevance: "primary" | "secondary";
}

const CATEGORY_ICONS: Record<string, string> = {
  "Databases & Storage": "db",
  "Backend Frameworks": "server",
  "Frontend Frameworks": "layout",
  "Cloud & DevOps": "cloud",
  "Languages": "code",
  "Testing & Quality": "check",
  "API & Communication": "plug",
};

const CATEGORY_COLORS: Record<string, string> = {
  "Databases & Storage": "cyan",
  "Backend Frameworks": "green",
  "Frontend Frameworks": "violet",
  "Cloud & DevOps": "blue",
  "Languages": "orange",
  "Testing & Quality": "red",
  "API & Communication": "indigo",
};

function parseTechStack(aiTechStack: string | null): TechBadge[] {
  if (!aiTechStack) return [];
  try {
    const parsed = JSON.parse(aiTechStack);
    if (Array.isArray(parsed)) return parsed;
    return [];
  } catch {
    return [];
  }
}

function filterDismissed(
  techs: TechBadge[],
  dismissed: string | null,
): TechBadge[] {
  if (!dismissed) return techs;
  try {
    const tags = JSON.parse(dismissed) as string[];
    const set = new Set(tags.map((t) => t.toLowerCase()));
    return techs.filter((t) => !set.has(t.tag.toLowerCase()));
  } catch {
    return techs;
  }
}

async function generateItemsForTech(
  tech: TechBadge,
  position: string,
  company: string,
  count: number,
): Promise<MemorizeItem[]> {
  const prompt = `Generate exactly ${count} flashcard-style memorization items for a software engineer preparing for a "${position}" interview at ${company}.

Technology: ${tech.label} (category: ${tech.category})

For each item, produce a JSON object with these fields:
- "id": kebab-case identifier (e.g., "use-effect-cleanup")
- "term": the concept name (e.g., "useEffect Cleanup")
- "description": 1-2 sentence explanation
- "details": array of {"label": string, "description": string} pairs — key syntax points, gotchas, or patterns (3-5 per item)
- "context": when/why this matters in interviews (1 sentence)
- "relatedItems": array of related concept ids (can be empty)
- "mnemonicHint": a short memory aid (1 sentence)

Focus on concepts that are commonly asked in technical interviews: core APIs, common patterns, gotchas, performance considerations, best practices.

Return ONLY valid JSON: { "items": [...] }
No markdown fences, no explanation — just the JSON object.`;

  const { content } = await chatCompletion(
    [
      {
        role: "system",
        content:
          "You are a technical interview preparation expert. Return only valid JSON, no markdown.",
      },
      { role: "user", content: prompt },
    ],
    { baseUrl: "http://localhost:19836/v1" },
  );

  const cleaned = content.replace(/```json\s*|```\s*/g, "").trim();
  const parsed = JSON.parse(cleaned);
  const items: MemorizeItem[] = (parsed.items || []).map(
    (item: Record<string, unknown>) => ({
      id: String(item.id || ""),
      term: String(item.term || ""),
      description: String(item.description || ""),
      details: Array.isArray(item.details)
        ? item.details.map((d: Record<string, unknown>) => ({
            label: String(d.label || ""),
            description: String(d.description || ""),
          }))
        : [],
      context: String(item.context || ""),
      relatedItems: Array.isArray(item.relatedItems)
        ? item.relatedItems.map(String)
        : [],
      mnemonicHint: String(item.mnemonicHint || ""),
    }),
  );

  return items.filter((i) => i.id && i.term);
}

export async function generateMemorizeContent(app: {
  company: string;
  position: string;
  aiTechStack: string | null;
  techDismissedTags: string | null;
}): Promise<MemorizeCategory[]> {
  const techs = filterDismissed(
    parseTechStack(app.aiTechStack),
    app.techDismissedTags,
  );

  if (techs.length === 0) return [];

  // Group techs by category
  const grouped = new Map<string, TechBadge[]>();
  for (const tech of techs) {
    const existing = grouped.get(tech.category) || [];
    existing.push(tech);
    grouped.set(tech.category, existing);
  }

  const categories: MemorizeCategory[] = [];

  // Generate items for each tech, grouped by category
  for (const [category, categoryTechs] of grouped) {
    const allItems: MemorizeItem[] = [];

    for (const tech of categoryTechs) {
      const count = tech.relevance === "primary" ? 8 : 4;
      try {
        const items = await generateItemsForTech(
          tech,
          app.position,
          app.company,
          count,
        );
        // Prefix item IDs with tech tag to avoid collisions
        for (const item of items) {
          item.id = `${tech.tag}-${item.id}`;
          allItems.push(item);
        }
      } catch (err) {
        console.error(
          `Failed to generate items for ${tech.label}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }

    if (allItems.length > 0) {
      const categoryId = category.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      categories.push({
        id: categoryId,
        name: category,
        icon: CATEGORY_ICONS[category] || "code",
        color: CATEGORY_COLORS[category] || "gray",
        items: allItems,
      });
    }
  }

  return categories;
}
