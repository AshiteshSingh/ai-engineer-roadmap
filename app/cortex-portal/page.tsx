import Link from "next/link";
import { Box, Flex, Text, Separator } from "@radix-ui/themes";
import { ArrowLeftIcon } from "@radix-ui/react-icons";
import { Section, Heading as DSHeading } from "@/components/ui";
import { MarkdownProse } from "@/components/markdown-prose";
import { CORTEX_PORTAL_TITLE, CORTEX_PORTAL_BODY } from "./_content";

export const metadata = {
  title: "Cortex Portal — Deep Dive",
  description:
    "Owner-only deep dive: the Vitrifi Cortex Portal — a regulated UK-fibre telecom platform and the production analogue behind the LangGraph lead-gen patterns.",
};

// Owner-only (enforced by ./layout.tsx). Content is the REDACTED inline copy
// in ./_content.ts — no internal contact details or raw git statistics.
export default function CortexPortalPage() {
  return (
    <Section>
      <Flex mb="5" align="center" gap="2">
        <ArrowLeftIcon />
        <Text size="2" asChild>
          <Link href="/langgraph/lead-gen">Back to Lead-Gen Deep Dive</Link>
        </Text>
      </Flex>

      <DSHeading as="h1" size="xl">
        {CORTEX_PORTAL_TITLE}
      </DSHeading>

      <Separator size="4" mt="4" mb="6" />

      <Box className="deep-dive-content">
        <MarkdownProse content={CORTEX_PORTAL_BODY} />
      </Box>
    </Section>
  );
}
