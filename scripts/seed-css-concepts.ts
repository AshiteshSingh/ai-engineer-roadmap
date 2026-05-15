/**
 * Seed CSS property concepts into the knowledge database.
 *
 * Usage:
 *   DATABASE_URL="..." npx tsx scripts/seed-css-concepts.ts
 */

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq, sql } from "drizzle-orm";
import * as schema from "../src/db/schema";
import { ALL_CSS_PROPERTIES } from "../lib/css-properties";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("Missing DATABASE_URL");
  process.exit(1);
}

const client = neon(databaseUrl);
const db = drizzle(client, { schema });

async function main() {
  console.log(`Seeding ${ALL_CSS_PROPERTIES.length} CSS property concepts...`);

  const conceptIds = new Map<string, string>();

  // Upsert each CSS property as a concept
  for (const prop of ALL_CSS_PROPERTIES) {
    const name = `css:${prop.id}`;
    const [row] = await db
      .insert(schema.concepts)
      .values({
        name,
        description: prop.shortDescription,
        conceptType: "skill",
        metadata: {
          category: prop.category,
          property: prop.property,
          defaultValue: prop.defaultValue,
          appliesTo: prop.appliesTo,
        },
      })
      .onConflictDoUpdate({
        target: schema.concepts.name,
        set: {
          description: prop.shortDescription,
          metadata: sql`excluded.metadata`,
        },
      })
      .returning({ id: schema.concepts.id });

    conceptIds.set(prop.id, row.id);
    console.log(`  + ${name} (${row.id})`);
  }

  // Wire up related edges
  let edgeCount = 0;
  for (const prop of ALL_CSS_PROPERTIES) {
    const sourceId = conceptIds.get(prop.id);
    if (!sourceId) continue;

    for (const relatedId of prop.relatedProps) {
      const targetId = conceptIds.get(relatedId);
      if (!targetId) continue;

      await db
        .insert(schema.conceptEdges)
        .values({
          sourceId,
          targetId,
          edgeType: "related",
          weight: 1.0,
        })
        .onConflictDoNothing();
      edgeCount++;
    }
  }

  console.log(`\nDone: ${conceptIds.size} concepts, ${edgeCount} related edges.`);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
