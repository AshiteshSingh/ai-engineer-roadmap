import Link from "next/link";
import { Badge, Box, Card, Container, Flex, Heading, Section, Text } from "@radix-ui/themes";
import { headers } from "next/headers";
import { asc, desc, eq, sql } from "drizzle-orm";
import { Topbar } from "@/components/topbar";
import { db } from "@/src/db";
import { problems, problemSubmissions } from "@/src/db/schema";
import { auth } from "@/lib/auth";

export const metadata = {
  title: "Coding Problems — Practice JavaScript & TypeScript",
  description: "LeetCode-style coding problems with an in-browser editor and instant test feedback.",
};

export const dynamic = "force-dynamic";

const DIFFICULTY_COLOR = {
  easy: "green",
  medium: "amber",
  hard: "red",
} as const;

export default async function ProblemsPage() {
  const session = await auth.api.getSession({ headers: await headers() });

  const rows = await db
    .select({
      id: problems.id,
      slug: problems.slug,
      title: problems.title,
      difficulty: problems.difficulty,
      tags: problems.tags,
    })
    .from(problems)
    .orderBy(asc(problems.sortOrder));

  let solvedSet = new Set<string>();
  if (session) {
    const solved = await db
      .select({ problemId: problemSubmissions.problemId })
      .from(problemSubmissions)
      .where(eq(problemSubmissions.userId, session.user.id))
      .groupBy(problemSubmissions.problemId)
      .having(sql`bool_or(${problemSubmissions.status} = 'passed')`);
    solvedSet = new Set(solved.map((s) => s.problemId));
  }

  const easy = rows.filter((r) => r.difficulty === "easy").length;
  const medium = rows.filter((r) => r.difficulty === "medium").length;
  const hard = rows.filter((r) => r.difficulty === "hard").length;

  return (
    <>
      <Topbar />
      <Section size="3">
        <Container size="3">
          <Flex direction="column" gap="2" mb="5">
            <Heading size="8">Coding Problems</Heading>
            <Text color="gray" size="3">
              Practice JavaScript & TypeScript in-browser. Tests run sandboxed in a Web Worker — no server round-trip.
            </Text>
            <Flex gap="2" mt="2" wrap="wrap">
              <Badge color="green" variant="soft">{easy} easy</Badge>
              <Badge color="amber" variant="soft">{medium} medium</Badge>
              <Badge color="red" variant="soft">{hard} hard</Badge>
              {session && (
                <Badge color="teal" variant="soft">
                  {solvedSet.size} / {rows.length} solved
                </Badge>
              )}
            </Flex>
          </Flex>

          <Flex direction="column" gap="2">
            {rows.map((p) => (
              <Link key={p.id} href={`/problems/${p.slug}`} style={{ textDecoration: "none", color: "inherit" }}>
                <Card variant="surface">
                  <Flex align="center" justify="between" gap="3" p="2" wrap="wrap">
                    <Flex align="center" gap="3">
                      {solvedSet.has(p.id) ? (
                        <Badge color="teal" variant="solid">✓</Badge>
                      ) : (
                        <Box style={{ width: 22 }} />
                      )}
                      <Text size="4" weight="medium">{p.title}</Text>
                    </Flex>
                    <Flex gap="2" align="center" wrap="wrap">
                      {Array.isArray(p.tags) && (p.tags as string[]).slice(0, 3).map((t) => (
                        <Badge key={t} color="gray" variant="soft">{t}</Badge>
                      ))}
                      <Badge color={DIFFICULTY_COLOR[p.difficulty]} variant="soft" size="2">
                        {p.difficulty}
                      </Badge>
                    </Flex>
                  </Flex>
                </Card>
              </Link>
            ))}
          </Flex>
        </Container>
      </Section>
    </>
  );
}
