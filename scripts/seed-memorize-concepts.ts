/**
 * Extracts key concepts from lesson sections and populates the
 * `concepts` and `lesson_concepts` tables for the memorize feature.
 *
 * Usage:
 *   DATABASE_URL="..." npx tsx scripts/seed-memorize-concepts.ts
 */

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq, sql } from "drizzle-orm";
import fs from "fs";
import path from "path";
import { CATEGORIES, CATEGORY_META } from "../lib/articles";
import * as schema from "../src/db/schema";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("Missing DATABASE_URL");
  process.exit(1);
}

const client = neon(databaseUrl);
const db = drizzle(client, { schema });

const CONTENT_DIR = path.join(process.cwd(), "content");

// ── helpers ──────────────────────────────────────────────────────

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function extractTitle(content: string): string {
  for (const line of content.split("\n")) {
    const match = line.match(/^#\s+(.+)/);
    if (match) return match[1].trim();
  }
  return "Untitled";
}

function getCategory(num: number): string {
  for (const [lo, hi, name] of CATEGORIES) {
    if (num >= lo && num <= hi) return name;
  }
  return "Other";
}

interface ExtractedConcept {
  term: string;
  description: string;
  details: { label: string; description: string }[];
  sourceLesson: string;
  sourceSectionHeading: string;
  headingLevel: number;
}

/**
 * Extract the first 1-2 sentences from a markdown block.
 */
function extractDescription(text: string, maxLen = 200): string {
  // Strip code blocks
  const stripped = text.replace(/```[\s\S]*?```/g, "").trim();
  // Get lines that aren't headings, lists, or empty
  const lines = stripped.split("\n").filter((l) => {
    const t = l.trim();
    return t && !t.startsWith("#") && !t.startsWith("|") && !t.startsWith("```");
  });

  const paragraph = lines.join(" ").replace(/\s+/g, " ").trim();
  // Strip markdown formatting
  const plain = paragraph
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/\[(.+?)\]\(.+?\)/g, "$1")
    .replace(/`(.+?)`/g, "$1");

  // Take first 1-2 sentences
  const sentences = plain.match(/[^.!?]+[.!?]+/g);
  if (!sentences) return plain.slice(0, maxLen);

  let result = sentences[0];
  if (sentences.length > 1 && result.length + sentences[1].length <= maxLen) {
    result += sentences[1];
  }
  return result.trim();
}

/**
 * Extract bold terms from markdown text as detail entries.
 */
function extractBoldTerms(text: string): { label: string; description: string }[] {
  const details: { label: string; description: string }[] = [];
  const re = /\*\*(.+?)\*\*\s*[:\-—]\s*(.+?)(?:\n|$)/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    const label = match[1].trim();
    const desc = match[2].trim().replace(/\*\*/g, "");
    if (label.length < 60 && desc.length > 10) {
      details.push({ label, description: desc });
    }
  }
  return details.slice(0, 6);
}

interface Section {
  heading: string;
  headingLevel: number;
  content: string;
}

function splitSections(markdown: string): Section[] {
  const lines = markdown.split("\n");
  const sections: Section[] = [];
  let currentHeading = "Introduction";
  let currentLevel = 2;
  let currentLines: string[] = [];
  let pastTitle = false;

  for (const line of lines) {
    if (!pastTitle && /^#\s+/.test(line)) {
      pastTitle = true;
      continue;
    }
    const match = line.match(/^(#{2,3})\s+(.+)/);
    if (match) {
      const content = currentLines.join("\n").trim();
      if (content) {
        sections.push({ heading: currentHeading, headingLevel: currentLevel, content });
      }
      pastTitle = true;
      currentHeading = match[2].trim();
      currentLevel = match[1].length;
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }

  const content = currentLines.join("\n").trim();
  if (content) {
    sections.push({ heading: currentHeading, headingLevel: currentLevel, content });
  }

  return sections;
}

// Ordered list of lesson slugs — position determines lesson number
const LESSON_SLUGS = [
  "transformer-architecture", "scaling-laws", "tokenization", "model-architectures",
  "inference-optimization", "pretraining-data", "embeddings",
  "prompt-engineering-fundamentals", "few-shot-chain-of-thought", "system-prompts",
  "structured-output", "prompt-optimization", "adversarial-prompting",
  "embedding-models", "vector-databases", "chunking-strategies",
  "retrieval-strategies", "rag-pipeline", "advanced-rag",
  "fine-tuning-overview", "lora-qlora", "training-data-curation",
  "rlhf-preference", "continued-pretraining", "evaluation-fine-tuning",
  "context-engineering", "memory-architectures", "prompt-caching",
  "tool-augmented-context", "multi-turn-context", "context-distillation",
  "function-calling", "agent-architectures", "agent-frameworks",
  "multi-agent-systems", "human-in-the-loop", "agent-memory",
  "agent-evaluation", "agent-debugging", "agent-sdks", "mcp-protocol",
  "eval-fundamentals", "benchmark-design", "llm-as-judge",
  "human-evaluation", "eval-automation", "red-teaming", "regression-testing",
  "model-serving", "inference-engines", "gpu-optimization",
  "api-gateways", "cost-optimization", "observability",
  "hallucination-mitigation", "content-safety", "bias-fairness",
  "privacy-data-protection", "interpretability", "ai-governance", "adversarial-robustness",
  "vision-language-models", "speech-audio-ai", "code-generation", "conversational-ai",
  "context-engineering-patterns", "langgraph-llamaindex", "ai-engineer-career",
  "ai-product-management", "startup-ai", "enterprise-ai",
  "cloud-providers-overview", "docker-containers", "kubernetes-orchestration",
  "serverless-computing", "cloud-networking",
  "aws-lambda-serverless", "aws-api-gateway-networking", "aws-iam-security",
  "aws-compute-containers", "aws-storage-s3", "aws-cicd-devops",
  "aws-architecture", "aws-ai-ml-services", "dynamodb-data-services",
  "solid-principles", "acid-transactions", "api-design",
  "microservices-architecture", "cicd-pipelines",
];

// ── main ─────────────────────────────────────────────────────────

async function main() {
  console.log("Extracting memorize concepts from lessons...\n");

  let totalConcepts = 0;

  for (let i = 0; i < LESSON_SLUGS.length; i++) {
    const slug = LESSON_SLUGS[i];
    const lessonNumber = i + 1;
    const categoryName = getCategory(lessonNumber);
    const categoryMeta = CATEGORY_META[categoryName];
    if (!categoryMeta) continue;

    const filePath = path.join(CONTENT_DIR, `${slug}.md`);
    if (!fs.existsSync(filePath)) {
      console.log(`  skip: ${slug}.md (not found)`);
      continue;
    }

    const markdown = fs.readFileSync(filePath, "utf-8");
    const title = extractTitle(markdown);
    const sections = splitSections(markdown);

    const concepts: ExtractedConcept[] = [];

    for (const section of sections) {
      // Skip very short sections and "Introduction"
      const wordCount = section.content.split(/\s+/).filter(Boolean).length;
      if (wordCount < 30 || section.heading === "Introduction") continue;

      const description = extractDescription(section.content);
      if (!description || description.length < 20) continue;

      const details = extractBoldTerms(section.content);

      concepts.push({
        term: section.heading,
        description,
        details,
        sourceLesson: slug,
        sourceSectionHeading: section.heading,
        headingLevel: section.headingLevel,
      });
    }

    if (concepts.length === 0) continue;

    console.log(`  ${categoryMeta.slug}/${slug}: ${concepts.length} concepts`);
    totalConcepts += concepts.length;

    // Upsert concepts into database
    for (const concept of concepts) {
      const conceptName = `${categoryMeta.slug}:${slugify(concept.term)}`;

      await db
        .insert(schema.concepts)
        .values({
          name: conceptName,
          description: concept.description,
          conceptType: concept.headingLevel === 2 ? "topic" : "skill",
          metadata: {
            term: concept.term,
            details: concept.details,
            sourceLesson: concept.sourceLesson,
            sourceSectionHeading: concept.sourceSectionHeading,
          },
        })
        .onConflictDoUpdate({
          target: schema.concepts.name,
          set: {
            description: concept.description,
            conceptType: concept.headingLevel === 2 ? "topic" : "skill",
            metadata: sql`EXCLUDED.metadata`,
          },
        });
    }
  }

  console.log(`\nDone. Extracted ${totalConcepts} concepts total.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
