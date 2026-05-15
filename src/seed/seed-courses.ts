/**
 * Seed Udemy course data into external_courses + lesson_courses.
 * Run: npm run seed:courses
 */
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { externalCourses, lessonCourses } from "../db/content-schema";
import path from "path";

const DB_PATH =
  process.env.CONTENT_DB_PATH ||
  path.join(process.cwd(), "data", "knowledge.db");
const sqlite = new Database(DB_PATH);
sqlite.pragma("foreign_keys = ON");
const db = drizzle(sqlite);

interface CourseEntry {
  title: string;
  provider: string;
  description: string;
  level: "Beginner" | "Intermediate" | "Advanced";
  isFree: boolean;
  rating?: number;
  reviewCount?: number;
  durationHours?: number;
  url: string;
  /** Lesson slugs this course maps to */
  slugs: string[];
}

// ---------------------------------------------------------------------------
// Curated Udemy catalog
// ---------------------------------------------------------------------------
const CATALOG: CourseEntry[] = [
  // ── LangGraph (Udemy) ───────────────────────────────────────────────────
  {
    title: "LangGraph — Develop LLM-Powered AI Agents with LangGraph",
    provider: "Udemy",
    description:
      "Build sophisticated LLM-powered agentic applications with LangGraph. Covers advanced agent patterns (multi-agent, reflection, reflexion), corrective/adaptive/self-RAG, parallel execution, human-in-the-loop, and the LangGraph ecosystem.",
    level: "Advanced",
    isFree: false,
    rating: 4.54,
    reviewCount: 3336,
    durationHours: 7.7,
    url: "https://www.udemy.com/course/langgraph/",
    slugs: ["langgraph", "langgraph-red-teaming"],
  },
  {
    title: "LangChain — Agentic AI Engineering with LangChain & LangGraph",
    provider: "Udemy",
    description:
      "Build AI agents with LangChain and LangGraph — RAG, tools, MCP, and production-ready agentic AI systems. Re-recorded for 2026, supports LangChain 1.2+.",
    level: "Intermediate",
    isFree: false,
    rating: 4.6,
    reviewCount: 48018,
    durationHours: 18,
    url: "https://www.udemy.com/course/langchain/",
    slugs: ["langgraph", "langgraph-red-teaming", "agent-architectures"],
  },
  {
    title: "Complete Agentic AI Bootcamp With LangGraph and LangChain",
    provider: "Udemy",
    description:
      "Build real-world AI agents, multi-agent workflows, and autonomous apps. Covers foundational agentic AI principles through production deployment of multi-agent systems (38.5h).",
    level: "Intermediate",
    isFree: false,
    rating: 4.54,
    reviewCount: 4947,
    durationHours: 38.5,
    url: "https://www.udemy.com/course/complete-agentic-ai-bootcamp-with-langgraph-and-langchain/",
    slugs: ["langgraph", "langgraph-red-teaming", "multi-agent-systems"],
  },
  {
    title: "LangGraph in Action: Develop Advanced AI Agents with LLMs",
    provider: "Udemy",
    description:
      "Production-focused LangGraph course — state-based design, memory management, human-in-the-loop, parallel execution, subgraphs, FastAPI deployment, and unit testing.",
    level: "Intermediate",
    isFree: false,
    rating: 4.45,
    reviewCount: 685,
    durationHours: 3.5,
    url: "https://www.udemy.com/course/langgraph-in-action-develop-advanced-ai-agents-with-llms/",
    slugs: ["langgraph"],
  },
  {
    title: "LangGraph for Beginners: Agentic Workflows in Simple Steps",
    provider: "Udemy",
    description:
      "Beginner-friendly LangGraph course — state machines, Pydantic validation, conditional routing, checkpointers, tool calling, agentic RAG, and real-world use cases.",
    level: "Beginner",
    isFree: false,
    rating: 4.49,
    reviewCount: 318,
    durationHours: 3.1,
    url: "https://www.udemy.com/course/langgraph-for-beginners/",
    slugs: ["langgraph"],
  },
  {
    title: "Agentic AI — Private Agentic RAG with LangGraph and Ollama",
    provider: "Udemy",
    description:
      "Build private, production-ready RAG systems running 100% locally with LangGraph v1, Ollama, ChromaDB, and Docling. Covers corrective RAG, reflexion, self-RAG, and adaptive RAG.",
    level: "Advanced",
    isFree: false,
    rating: 4.61,
    reviewCount: 248,
    durationHours: 16.5,
    url: "https://www.udemy.com/course/agentic-ai-private-agentic-rag-with-langgraph-and-ollama/",
    slugs: ["langgraph", "langgraph-red-teaming"],
  },

  // ── AWS Deep Dives ──────────────────────────────────────────────────────
  {
    title: "Introduction to AWS - Understand AWS basics in 4 hours!",
    provider: "Udemy / Rick Crisci",
    description:
      "A quick, fun, and easy to follow introduction to AWS — covers EC2, S3, IAM, VPC, Lambda, ECS, RDS, DynamoDB and more with hands-on demos and quizzes.",
    level: "Beginner",
    isFree: false,
    rating: 4.6,
    reviewCount: 19946,
    durationHours: 5.3,
    url: "https://www.udemy.com/course/awsintro/",
    slugs: [
      "aws",
      "aws-lambda-serverless",
      "aws-api-gateway-networking",
      "aws-iam-security",
      "aws-compute-containers",
      "aws-storage-s3",
      "aws-cicd-devops",
      "aws-architecture",
      "aws-ai-ml-services",
      "dynamodb-data-services",
    ],
  },
  {
    title: "AWS Lambda and the Serverless Framework",
    provider: "Udemy / Stephane Maarek",
    description:
      "Build serverless apps with AWS Lambda, API Gateway, DynamoDB, SQS, and SNS — event-driven architectures and best practices.",
    level: "Intermediate",
    isFree: false,
    rating: 4.7,
    reviewCount: 22000,
    durationHours: 15,
    url: "https://www.udemy.com/course/aws-lambda-serverless/",
    slugs: ["aws-lambda-serverless", "aws-api-gateway-networking"],
  },
  {
    title: "AWS Machine Learning Specialty (MLS-C01)",
    provider: "Udemy / Stephane Maarek",
    description:
      "Complete prep for the AWS ML Specialty exam — SageMaker, data engineering, modeling, and production ML workflows on AWS.",
    level: "Advanced",
    isFree: false,
    rating: 4.7,
    reviewCount: 14500,
    durationHours: 20,
    url: "https://www.udemy.com/course/aws-machine-learning/",
    slugs: ["aws-ai-ml-services", "aws-architecture"],
  },

  // ── Infrastructure ─────────────────────────────────────────────────────
  {
    title: "Docker and Kubernetes: The Complete Guide",
    provider: "Udemy / Stephen Grider",
    description:
      "Complete Docker + Kubernetes course — containerization, multi-service apps, deployments, networking, and CI/CD pipelines.",
    level: "Intermediate",
    isFree: false,
    rating: 4.7,
    reviewCount: 58000,
    durationHours: 22,
    url: "https://www.udemy.com/course/docker-and-kubernetes-the-complete-guide/",
    slugs: ["docker", "kubernetes"],
  },

  // ── Software Engineering ────────────────────────────────────────────────
  {
    title: "Software Architecture: From Developer to Architect",
    provider: "Udemy / Mark Richards",
    description:
      "Architectural styles — microservices, event-driven, layered, space-based, and orchestration vs. choreography trade-offs.",
    level: "Advanced",
    isFree: false,
    rating: 4.6,
    reviewCount: 9200,
    durationHours: 10,
    url: "https://www.udemy.com/course/developer-to-architect/",
    slugs: ["microservices", "solid-principles"],
  },
  {
    title: "Node.js, Express, MongoDB & More: The Complete Bootcamp",
    provider: "Udemy / Jonas Schmedtmann",
    description:
      "Full-stack Node.js — Express, MongoDB, Mongoose, authentication, REST APIs, security, and deployment to production.",
    level: "Intermediate",
    isFree: false,
    rating: 4.8,
    reviewCount: 81000,
    durationHours: 42,
    url: "https://www.udemy.com/course/nodejs-express-mongodb-bootcamp/",
    slugs: ["nodejs"],
  },
  {
    title: "The Missing CI/CD with GitHub Actions",
    provider: "Udemy",
    description:
      "Automate testing, building, and deployment with GitHub Actions — workflows, secrets, matrix builds, and CD to cloud providers.",
    level: "Intermediate",
    isFree: false,
    rating: 4.6,
    reviewCount: 5400,
    durationHours: 8,
    url: "https://www.udemy.com/course/the-complete-github-actions-and-workflows-guide/",
    slugs: ["ci-cd", "ci-cd-ai"],
  },
  // ── Public Speaking (Udemy) — top reviewed from /topic/public-speaking/ ──
  {
    title: "2026 Complete Public Speaking Masterclass For Every Occasion",
    provider: "Udemy",
    description:
      "Comprehensive public speaking masterclass — structure, delivery, and audience engagement for every occasion.",
    level: "Intermediate",
    isFree: false,
    rating: 4.4,
    reviewCount: 10203,
    durationHours: 31.5,
    url: "https://www.udemy.com/course/the-complete-public-speaking-masterclass-for-every-occasion/",
    slugs: ["public-speaking"],
  },
  {
    title: "How to Present Your Thoughts Smoothly, Clearly & Powerfully",
    provider: "Udemy",
    description:
      "Present thoughts smoothly and clearly — practical techniques for clear, powerful delivery.",
    level: "Intermediate",
    isFree: false,
    rating: 4.5,
    reviewCount: 14527,
    durationHours: 1.5,
    url: "https://www.udemy.com/course/how-to-present-your-thoughts-smoothly-clearly-powerfully/",
    slugs: ["public-speaking"],
  },
  {
    title: "The Complete Presentation and Public Speaking/Speech Course",
    provider: "Udemy",
    description:
      "Thorough presentation and public speaking course covering business and personal contexts.",
    level: "Intermediate",
    isFree: false,
    rating: 4.4,
    reviewCount: 20203,
    durationHours: 32,
    url: "https://www.udemy.com/course/the-complete-presentation-and-public-speaking-speech-course/",
    slugs: ["public-speaking"],
  },
  {
    title: "Speak Like a Pro: Public Speaking for Professionals",
    provider: "Udemy",
    description:
      "Master presentation skills and impromptu speaking for professional contexts.",
    level: "Intermediate",
    isFree: false,
    rating: 4.6,
    reviewCount: 26147,
    durationHours: 6,
    url: "https://www.udemy.com/course/speak-like-a-pro-public-speaking-for-professionals/",
    slugs: ["public-speaking"],
  },
  {
    title: "Articulation Unleashed: Speak With Precision and Clarity",
    provider: "Udemy",
    description:
      "Improve articulation and clarity of speech — vocal precision techniques for confident delivery.",
    level: "Intermediate",
    isFree: false,
    rating: 4.6,
    reviewCount: 1014,
    durationHours: 2,
    url: "https://www.udemy.com/course/articulation-unleashed-speak-with-precision-and-clarity/",
    slugs: ["public-speaking"],
  },
  {
    title: "Leadership Communication Skills for Influence and Impact",
    provider: "Udemy",
    description:
      "Enhance leadership communication for influence and impact — communication skills for managers and leaders.",
    level: "Intermediate",
    isFree: false,
    rating: 4.6,
    reviewCount: 4413,
    durationHours: 5,
    url: "https://www.udemy.com/course/communication-skills-for-leadership-and-management-influence/",
    slugs: ["public-speaking"],
  },
  {
    title: "Public Speaking Training & Facilitator Certification",
    provider: "Udemy",
    description:
      "Professional public speaking and facilitation training — workshop facilitator certification.",
    level: "Intermediate",
    isFree: false,
    rating: 4.6,
    reviewCount: 2383,
    durationHours: 12,
    url: "https://www.udemy.com/course/public-speaker-training-workshop-facilitator-certification/",
    slugs: ["public-speaking"],
  },
];

// ---------------------------------------------------------------------------

async function upsertCourse(entry: CourseEntry) {
  const [course] = await db
    .insert(externalCourses)
    .values({
      title: entry.title,
      url: entry.url,
      provider: entry.provider,
      description: entry.description,
      level: entry.level,
      rating: entry.rating,
      reviewCount: entry.reviewCount,
      durationHours: entry.durationHours,
      isFree: entry.isFree,
    })
    .onConflictDoUpdate({
      target: externalCourses.url,
      set: {
        title: entry.title,
        provider: entry.provider,
        description: entry.description,
        level: entry.level,
        rating: entry.rating,
        reviewCount: entry.reviewCount,
        durationHours: entry.durationHours,
        isFree: entry.isFree,
        updatedAt: new Date(),
      },
    })
    .returning({ id: externalCourses.id });

  return course.id;
}

async function main() {
  console.log(`Seeding ${CATALOG.length} Udemy courses…`);
  let coursesInserted = 0;
  let mappingsInserted = 0;

  for (const entry of CATALOG) {
    const courseId = await upsertCourse(entry);
    coursesInserted++;

    for (const slug of entry.slugs) {
      await db
        .insert(lessonCourses)
        .values({ lessonSlug: slug, courseId, relevance: 1.0 })
        .onConflictDoNothing();
      mappingsInserted++;
    }
  }

  // Ensure DB is self-contained (no WAL/SHM) for Vercel's read-only fs
  sqlite.pragma("wal_checkpoint(TRUNCATE)");
  sqlite.pragma("journal_mode = DELETE");
  sqlite.close();

  console.log(`Done. ${coursesInserted} courses, ${mappingsInserted} lesson mappings.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
