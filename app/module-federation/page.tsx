import Link from "next/link";
import { Box, Flex, Text, Separator } from "@radix-ui/themes";
import { ArrowLeftIcon } from "@radix-ui/react-icons";
import { notFound } from "next/navigation";
import { Section, Heading as DSHeading } from "@/components/ui";
import { MarkdownProse } from "@/components/markdown-prose";
import { getTopicSeed } from "@/lib/topic-seed";

export const metadata = {
  title: "Module Federation — Deep Dive",
  description:
    "In-depth study guide on Webpack Module Federation: host/remote wiring, shared singletons, runtime version skew, and micro-frontend architecture.",
};

// Owner-only (enforced by ./layout.tsx). Content is the Rust `gen-topic`
// artifact at data/topics/module-federation.json (`pnpm prep:topic`).
export default function ModuleFederationPage() {
  const topic = getTopicSeed("module-federation");
  if (!topic) notFound();

  return (
    <Section>
      <Flex mb="5" align="center" gap="2">
        <ArrowLeftIcon />
        <Text size="2" asChild>
          <Link href="/">Back to Knowledge Base</Link>
        </Text>
      </Flex>

      <DSHeading as="h1" size="xl">
        {topic.title}
      </DSHeading>

      <Separator size="4" mt="4" mb="6" />

      <Box className="deep-dive-content">
        <MarkdownProse content={topic.body} />
      </Box>
    </Section>
  );
}
