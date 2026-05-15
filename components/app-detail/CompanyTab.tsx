"use client";

import { useEffect, useState } from "react";
import {
  Heading,
  Flex,
  Text,
  Box,
  Card,
  Badge,
  Skeleton,
  Link as RxLink,
} from "@radix-ui/themes";
import {
  ExternalLinkIcon,
  InfoCircledIcon,
  GitHubLogoIcon,
  LinkedInLogoIcon,
  RocketIcon,
} from "@radix-ui/react-icons";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { TabBaseProps } from "./types";

interface Company {
  id: number;
  key: string;
  name: string;
  website: string | null;
  logo_url: string | null;
  description: string | null;
  industry: string | null;
  location: string | null;
  category: string;
  services: string | null;
  service_taxonomy: string | null;
  score: number;
  ai_tier: number;
  ai_classification_reason: string | null;
  deep_analysis: string | null;
  github_url: string | null;
  github_org: string | null;
  github_ai_score: number | null;
  github_hiring_score: number | null;
  github_activity_score: number | null;
  linkedin_url: string | null;
}

interface Contact {
  id: number;
  first_name: string;
  last_name: string;
  position: string | null;
  email: string | null;
  linkedin_url: string | null;
  is_decision_maker: boolean | null;
  seniority: string | null;
}

interface CompanyIntelResponse {
  key: string | null;
  intel: {
    company: Company;
    facts: unknown[];
    contacts: Contact[];
  } | null;
}

const CATEGORY_COLOR: Record<string, "gray" | "cyan" | "orange" | "green" | "violet"> = {
  unknown: "gray",
  product: "cyan",
  consultancy: "orange",
  agency: "violet",
  staffing: "green",
};

const AI_TIER_LABEL: Record<number, { label: string; color: "gray" | "blue" | "violet" }> = {
  0: { label: "Not AI", color: "gray" },
  1: { label: "AI-First", color: "blue" },
  2: { label: "AI-Native", color: "violet" },
};

function parseJsonArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function CompanyTab({ app }: TabBaseProps) {
  const [data, setData] = useState<CompanyIntelResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/applications/${app.slug}/company`)
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body.error ?? `HTTP ${r.status}`);
        }
        return r.json() as Promise<CompanyIntelResponse>;
      })
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [app.slug]);

  if (loading) {
    return (
      <Card>
        <Skeleton height="120px" mb="3" />
        <Skeleton height="300px" />
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <Flex direction="column" align="center" gap="2" py="6">
          <InfoCircledIcon width={24} height={24} color="var(--gray-8)" />
          <Text size="2" color="gray">Could not load company intel: {error}</Text>
        </Flex>
      </Card>
    );
  }

  if (!data?.key || !data.intel) {
    return (
      <Card>
        <Flex direction="column" align="center" gap="2" py="6">
          <InfoCircledIcon width={24} height={24} color="var(--gray-8)" />
          <Text size="2" color="gray">
            No lead-gen match for &ldquo;{app.company}&rdquo;.
          </Text>
          <Text size="1" color="gray">
            The company isn&rsquo;t in the lead-gen database yet. Run the enrichment
            pipeline in lead-gen to populate this view.
          </Text>
        </Flex>
      </Card>
    );
  }

  const { company, contacts } = data.intel;
  const services = parseJsonArray(company.services);
  const taxonomy = parseJsonArray(company.service_taxonomy);
  const aiTier = AI_TIER_LABEL[company.ai_tier] ?? AI_TIER_LABEL[0];

  return (
    <>
      <Card mb="5">
        <Flex gap="4" align="start" wrap="wrap">
          {company.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={company.logo_url}
              alt={company.name}
              width={64}
              height={64}
              style={{ borderRadius: "var(--radius-2)", objectFit: "contain", background: "var(--gray-2)" }}
            />
          ) : null}
          <Box style={{ flex: "1 1 auto", minWidth: 240 }}>
            <Flex align="center" gap="3" mb="1" wrap="wrap">
              <Heading size="5">{company.name}</Heading>
              <Badge color={CATEGORY_COLOR[company.category.toLowerCase()] ?? "gray"} variant="soft">
                {company.category.toLowerCase()}
              </Badge>
              <Badge color={aiTier.color} variant="soft">{aiTier.label}</Badge>
              <Badge color="gray" variant="soft">
                score {company.score.toFixed(2)}
              </Badge>
            </Flex>
            {company.description ? (
              <Text as="p" size="2" color="gray" mb="2">{company.description}</Text>
            ) : null}
            <Flex gap="3" wrap="wrap">
              {company.website ? (
                <RxLink size="2" href={company.website} target="_blank" rel="noopener noreferrer">
                  <Flex align="center" gap="1"><ExternalLinkIcon /> Website</Flex>
                </RxLink>
              ) : null}
              {company.linkedin_url ? (
                <RxLink size="2" href={company.linkedin_url} target="_blank" rel="noopener noreferrer">
                  <Flex align="center" gap="1"><LinkedInLogoIcon /> LinkedIn</Flex>
                </RxLink>
              ) : null}
              {company.github_url ? (
                <RxLink size="2" href={company.github_url} target="_blank" rel="noopener noreferrer">
                  <Flex align="center" gap="1"><GitHubLogoIcon /> {company.github_org ?? "GitHub"}</Flex>
                </RxLink>
              ) : null}
              {company.industry ? (
                <Text size="2" color="gray">· {company.industry}</Text>
              ) : null}
              {company.location ? (
                <Text size="2" color="gray">· {company.location}</Text>
              ) : null}
            </Flex>
          </Box>
        </Flex>
      </Card>

      {company.deep_analysis ? (
        <Card mb="5">
          <Flex align="center" gap="2" mb="3">
            <RocketIcon />
            <Heading size="4">Deep Analysis</Heading>
          </Flex>
          <Box style={{ lineHeight: 1.7, fontSize: "var(--font-size-2)" }}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {company.deep_analysis}
            </ReactMarkdown>
          </Box>
        </Card>
      ) : null}

      {services.length + taxonomy.length > 0 ? (
        <Card mb="5">
          <Heading size="4" mb="3">Services &amp; Tech</Heading>
          {services.length > 0 ? (
            <Box mb="3">
              <Text size="1" color="gray" mb="1" as="div">Services</Text>
              <Flex gap="2" wrap="wrap">
                {services.map((s) => (
                  <Badge key={s} variant="soft" color="gray">{s}</Badge>
                ))}
              </Flex>
            </Box>
          ) : null}
          {taxonomy.length > 0 ? (
            <Box>
              <Text size="1" color="gray" mb="1" as="div">Tech taxonomy</Text>
              <Flex gap="2" wrap="wrap">
                {taxonomy.map((t) => (
                  <Badge key={t} variant="soft" color="cyan">{t}</Badge>
                ))}
              </Flex>
            </Box>
          ) : null}
        </Card>
      ) : null}

      {(company.github_ai_score != null || company.github_hiring_score != null) ? (
        <Card mb="5">
          <Heading size="4" mb="3">Signals</Heading>
          <Flex gap="4" wrap="wrap">
            {company.github_ai_score != null ? (
              <Signal label="GitHub AI adoption" value={company.github_ai_score} />
            ) : null}
            {company.github_hiring_score != null ? (
              <Signal label="GitHub hiring" value={company.github_hiring_score} />
            ) : null}
            {company.github_activity_score != null ? (
              <Signal label="GitHub activity" value={company.github_activity_score} />
            ) : null}
          </Flex>
        </Card>
      ) : null}

      {contacts.length > 0 ? (
        <Card mb="5">
          <Heading size="4" mb="3">Contacts ({contacts.length})</Heading>
          <Flex direction="column" gap="3">
            {contacts.map((c) => (
              <Flex key={c.id} justify="between" align="center" gap="3" wrap="wrap">
                <Box style={{ minWidth: 200 }}>
                  <Text size="2" weight="medium" as="div">
                    {c.first_name} {c.last_name}
                    {c.is_decision_maker ? (
                      <Badge ml="2" size="1" color="green" variant="soft">DM</Badge>
                    ) : null}
                  </Text>
                  {c.position ? (
                    <Text size="1" color="gray" as="div">{c.position}</Text>
                  ) : null}
                </Box>
                <Flex gap="3" align="center">
                  {c.linkedin_url ? (
                    <RxLink size="1" href={c.linkedin_url} target="_blank" rel="noopener noreferrer">
                      <Flex align="center" gap="1"><LinkedInLogoIcon /> LinkedIn</Flex>
                    </RxLink>
                  ) : null}
                  {c.email ? (
                    <RxLink size="1" href={`mailto:${c.email}`}>{c.email}</RxLink>
                  ) : null}
                </Flex>
              </Flex>
            ))}
          </Flex>
        </Card>
      ) : null}
    </>
  );
}

function Signal({ label, value }: { label: string; value: number }) {
  const pct = Math.round(value * 100);
  return (
    <Box style={{ minWidth: 160 }}>
      <Text size="1" color="gray" as="div">{label}</Text>
      <Flex align="center" gap="2">
        <Text size="3" weight="medium">{pct}</Text>
        <Text size="1" color="gray">/ 100</Text>
      </Flex>
      <Box
        mt="1"
        style={{
          height: 4,
          background: "var(--gray-4)",
          borderRadius: 2,
          overflow: "hidden",
        }}
      >
        <Box style={{ width: `${pct}%`, height: "100%", background: "var(--violet-9)" }} />
      </Box>
    </Box>
  );
}
