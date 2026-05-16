import { notFound } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { Flex, Text } from "@radix-ui/themes";
import { Section } from "@/components/ui";
import styles from "./page.module.css";
import { Topbar } from "@/components/topbar";
import { db } from "@/src/db";
import { problems } from "@/src/db/schema";
import { auth } from "@/lib/auth";
import { ProblemWorkspace } from "@/components/problems/problem-workspace";
import type { TestCase } from "@/lib/problems/runner";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [p] = await db.select({ title: problems.title }).from(problems).where(eq(problems.slug, slug)).limit(1);
  return {
    title: p ? `${p.title} — Coding Problem` : "Coding Problem",
  };
}

export default async function ProblemPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [problem] = await db.select().from(problems).where(eq(problems.slug, slug)).limit(1);
  if (!problem) notFound();

  const session = await auth.api.getSession({ headers: await headers() });

  return (
    <>
      <Topbar />
      <Section>
          <Flex justify="between" align="center" mb="3">
            <Link href="/problems" className={styles.backLink}>
              ← All problems
            </Link>
            {!session && (
              <Text size="2" color="gray">
                <Link href="/login" className={styles.signin}>Sign in</Link> to save submissions
              </Text>
            )}
          </Flex>
          <ProblemWorkspace
            slug={problem.slug}
            title={problem.title}
            difficulty={problem.difficulty}
            prompt={problem.prompt}
            starterJs={problem.starterJs}
            starterTs={problem.starterTs}
            entrypoint={problem.entrypoint}
            testCases={problem.testCases as TestCase[]}
            isAuthenticated={!!session}
          />
      </Section>
    </>
  );
}
