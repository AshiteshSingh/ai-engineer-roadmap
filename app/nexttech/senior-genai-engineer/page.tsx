import Link from "next/link";
import { Container, Heading, Text, Box, Flex, Card, Badge, Separator } from "@radix-ui/themes";
import { ExternalLinkIcon, ArrowLeftIcon } from "@radix-ui/react-icons";
import { MarkdownProse } from "@/components/markdown-prose";
import { contentDb } from "@/src/db/content";
import { publicJobs } from "@/src/db/content-schema";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";

export const metadata = {
  title: "Senior GenAI Engineer / LLM Developer — Nexttech",
  description:
    "Production-grade AI agent platform for enterprise engineering tools in the energy industry. Remote, Cluj-Napoca.",
};

export default function NexttechJobPage() {
  const jobData = contentDb
    .select()
    .from(publicJobs)
    .where(eq(publicJobs.slug, "senior-genai-engineer"))
    .get();

  if (!jobData) notFound();
  return (
    <Container size="3" p={{ initial: "4", md: "8" }}>
      {/* Back link */}
      <Flex mb="5" align="center" gap="2">
        <ArrowLeftIcon />
        <Text size="2" asChild>
          <Link href="/" style={{ color: "var(--gray-11)", textDecoration: "none" }}>
            Back to Knowledge Base
          </Link>
        </Text>
      </Flex>

      {/* Header card */}
      <Card mb="6" style={{ borderLeft: "4px solid var(--teal-9)" }}>
        <Flex direction="column" gap="3" p="2">
          <Flex align="center" gap="3" wrap="wrap">
            <Badge size="2" color="teal" variant="solid">
              {jobData.company}
            </Badge>
            <Badge size="1" color="gray" variant="soft">
              {jobData.location ?? "Remote"}
            </Badge>
          </Flex>

          <Heading size="7" style={{ lineHeight: 1.2 }}>
            {jobData.position}
          </Heading>

          <Flex align="center" gap="2">
            <Text size="2" asChild>
              <a
                href={jobData.url ?? "#"}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  color: "var(--teal-11)",
                  textDecoration: "none",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                Apply on TalentLyft <ExternalLinkIcon />
              </a>
            </Text>
          </Flex>
        </Flex>
      </Card>

      <Separator size="4" mb="6" />

      {/* Job description rendered as markdown */}
      <Box className="deep-dive-content" style={{ lineHeight: 1.8 }}>
        <MarkdownProse content={jobData.description} />
      </Box>

      {/* Footer */}
      <Separator size="4" mt="8" mb="4" />
      <Flex justify="center">
        <Text size="2" asChild>
          <a
            href={jobData.url ?? "#"}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              color: "var(--teal-11)",
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            Apply for this position <ExternalLinkIcon />
          </a>
        </Text>
      </Flex>
    </Container>
  );
}
