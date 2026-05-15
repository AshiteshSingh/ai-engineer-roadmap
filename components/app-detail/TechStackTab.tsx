"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Heading, Flex, Text, Box, Card, Badge, Button, Spinner } from "@radix-ui/themes";
import { InfoCircledIcon, ExternalLinkIcon, Cross2Icon, PlusIcon, RocketIcon } from "@radix-ui/react-icons";
import type { TabBaseProps } from "./types";

interface TechBadge {
  tag: string;
  label: string;
  category: string;
  relevance: "primary" | "secondary";
}

const CATEGORY_COLORS: Record<string, "cyan" | "green" | "violet" | "blue" | "orange" | "red" | "indigo"> = {
  "Databases & Storage": "cyan",
  "Backend Frameworks": "green",
  "Frontend Frameworks": "violet",
  "Cloud & DevOps": "blue",
  "Languages": "orange",
  "Testing & Quality": "red",
  "API & Communication": "indigo",
};

const CATEGORY_ICONS: Record<string, string> = {
  "Databases & Storage": "\u{1F5C4}\uFE0F",
  "Backend Frameworks": "\u2699\uFE0F",
  "Frontend Frameworks": "\u{1F3A8}",
  "Cloud & DevOps": "\u2601\uFE0F",
  "Languages": "\u{1F4DD}",
  "Testing & Quality": "\u2705",
  "API & Communication": "\u{1F50C}",
};

function extractTechFromDescription(description: string | null | undefined): TechBadge[] {
  if (!description) return [];
  const text = description.toLowerCase();
  const techs: TechBadge[] = [];
  const seen = new Set<string>();

  const patterns: [RegExp, string, string, string, "primary" | "secondary"][] = [
    [/\btypescript\b/i, "typescript", "TypeScript", "Languages", "primary"],
    [/\bjavascript\b/i, "javascript", "JavaScript", "Languages", "primary"],
    [/\bpython\b/i, "python", "Python", "Languages", "primary"],
    [/\bjava\b(?!script)/i, "java", "Java", "Languages", "primary"],
    [/\trust\b/i, "rust", "Rust", "Languages", "secondary"],
    [/\bgo\b(?:lang)?\b/i, "go", "Go", "Languages", "primary"],
    [/\bruby\b/i, "ruby", "Ruby", "Languages", "secondary"],
    [/\bkotlin\b/i, "kotlin", "Kotlin", "Languages", "secondary"],
    [/\bscala\b/i, "scala", "Scala", "Languages", "secondary"],
    [/\bswift\b/i, "swift", "Swift", "Languages", "secondary"],
    [/\belixir\b/i, "elixir", "Elixir", "Languages", "secondary"],
    [/\bc#|csharp\b/i, "csharp", "C#", "Languages", "secondary"],
    [/\bphp\b/i, "php", "PHP", "Languages", "secondary"],
    [/\breact\b(?!\s*native)/i, "react", "React", "Frontend Frameworks", "primary"],
    [/\bnext\.?js\b/i, "nextjs", "Next.js", "Frontend Frameworks", "primary"],
    [/\bvue\b/i, "vue", "Vue.js", "Frontend Frameworks", "primary"],
    [/\bangular\b/i, "angular", "Angular", "Frontend Frameworks", "primary"],
    [/\bsvelte\b/i, "svelte", "Svelte", "Frontend Frameworks", "secondary"],
    [/\btailwind\b/i, "tailwind", "Tailwind CSS", "Frontend Frameworks", "secondary"],
    [/\breact[\s-]?native\b/i, "react-native", "React Native", "Frontend Frameworks", "primary"],
    [/\bflutter\b/i, "flutter", "Flutter", "Frontend Frameworks", "primary"],
    [/\bremix\b/i, "remix", "Remix", "Frontend Frameworks", "secondary"],
    [/\bnode\.?js\b/i, "nodejs", "Node.js", "Backend Frameworks", "primary"],
    [/\bexpress\b/i, "express", "Express.js", "Backend Frameworks", "secondary"],
    [/\bdjango\b/i, "django", "Django", "Backend Frameworks", "primary"],
    [/\bflask\b/i, "flask", "Flask", "Backend Frameworks", "secondary"],
    [/\bfastapi\b/i, "fastapi", "FastAPI", "Backend Frameworks", "primary"],
    [/\bspring[\s-]?boot\b/i, "spring-boot", "Spring Boot", "Backend Frameworks", "primary"],
    [/\blaravel\b/i, "laravel", "Laravel", "Backend Frameworks", "secondary"],
    [/\bpostgres(?:ql)?\b/i, "postgresql", "PostgreSQL", "Databases & Storage", "primary"],
    [/\bmysql\b/i, "mysql", "MySQL", "Databases & Storage", "primary"],
    [/\bmongodb\b/i, "mongodb", "MongoDB", "Databases & Storage", "primary"],
    [/\bredis\b/i, "redis", "Redis", "Databases & Storage", "secondary"],
    [/\belasticsearch\b/i, "elasticsearch", "Elasticsearch", "Databases & Storage", "secondary"],
    [/\bdynamodb\b/i, "dynamodb", "DynamoDB", "Databases & Storage", "secondary"],
    [/\baws\b|\bamazon web services\b/i, "aws", "AWS", "Cloud & DevOps", "primary"],
    [/\bgcp\b|\bgoogle cloud\b/i, "gcp", "Google Cloud", "Cloud & DevOps", "primary"],
    [/\bazure\b/i, "azure", "Azure", "Cloud & DevOps", "primary"],
    [/\bdocker\b/i, "docker", "Docker", "Cloud & DevOps", "primary"],
    [/\bkubernetes\b|\bk8s\b/i, "kubernetes", "Kubernetes", "Cloud & DevOps", "primary"],
    [/\bterraform\b/i, "terraform", "Terraform", "Cloud & DevOps", "secondary"],
    [/\bci[\s/]?cd\b/i, "ci-cd", "CI/CD", "Cloud & DevOps", "secondary"],
    [/\bgraphql\b/i, "graphql", "GraphQL", "API & Communication", "primary"],
    [/\brest\s?api\b|\brestful\b/i, "rest-api", "REST API", "API & Communication", "primary"],
    [/\bgrpc\b/i, "grpc", "gRPC", "API & Communication", "secondary"],
    [/\bwebsocket\b/i, "websocket", "WebSocket", "API & Communication", "secondary"],
    [/\bjest\b/i, "jest", "Jest", "Testing & Quality", "secondary"],
    [/\bplaywright\b/i, "playwright", "Playwright", "Testing & Quality", "secondary"],
    [/\bcypress\b/i, "cypress", "Cypress", "Testing & Quality", "secondary"],
  ];

  for (const [regex, tag, label, category, relevance] of patterns) {
    if (!seen.has(tag) && regex.test(text)) {
      seen.add(tag);
      techs.push({ tag, label, category, relevance });
    }
  }

  return techs;
}

function groupByCategory(techs: TechBadge[]): Map<string, TechBadge[]> {
  const groups = new Map<string, TechBadge[]>();
  for (const tech of techs) {
    const list = groups.get(tech.category) || [];
    list.push(tech);
    groups.set(tech.category, list);
  }
  return groups;
}

function parseSavedTechStack(raw: string | null | undefined): TechBadge[] | null {
  if (!raw) return null;
  try {
    const arr = JSON.parse(raw);
    if (Array.isArray(arr) && arr.length > 0 && arr[0].tag) return arr;
  } catch {}
  return null;
}

export function TechStackTab({ app, isAdmin }: TabBaseProps) {
  const hasLlmTech = !!parseSavedTechStack(app.aiTechStack);
  const techs = parseSavedTechStack(app.aiTechStack) ?? extractTechFromDescription(app.jobDescription);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [prepError, setPrepError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const startPipeline = async () => {
    setRunning(true);
    setPrepError(null);
    try {
      const res = await fetch(`/api/applications/${app.slug}/prep`, { method: "POST" });
      const data = await res.json() as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to start pipeline");

      pollRef.current = setInterval(async () => {
        try {
          const pollRes = await fetch(`/api/applications/${app.slug}/prep`);
          const pollData = await pollRes.json() as { hasTech?: boolean };
          if (pollData.hasTech) {
            if (pollRef.current) clearInterval(pollRef.current);
            window.location.reload();
          }
        } catch {}
      }, 4_000);
    } catch (e) {
      setRunning(false);
      setPrepError(e instanceof Error ? e.message : "Failed");
    }
  };

  // Load dismissed tags from API
  useEffect(() => {
    fetch(`/api/applications/${app.slug}/tech-dismissed`)
      .then((r) => r.json())
      .then((data) => setDismissed(new Set(data.dismissed || [])))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [app.slug]);

  const toggleDismiss = useCallback(
    async (tag: string) => {
      const next = new Set(dismissed);
      if (next.has(tag)) {
        next.delete(tag);
      } else {
        next.add(tag);
      }
      setDismissed(next);

      await fetch(`/api/applications/${app.slug}/tech-dismissed`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dismissed: Array.from(next) }),
      }).catch(() => {});
    },
    [app.slug, dismissed],
  );

  if (techs.length === 0) {
    return (
      <Card>
        <Flex direction="column" align="center" justify="center" gap="2" py="8" style={{ opacity: 0.7 }}>
          <InfoCircledIcon width={24} height={24} color="var(--gray-8)" />
          <Text size="2" color="gray">No technologies detected in the job description.</Text>
        </Flex>
      </Card>
    );
  }

  const activeTechs = techs.filter((t) => !dismissed.has(t.tag));
  const dismissedTechs = techs.filter((t) => dismissed.has(t.tag));
  const activeGrouped = groupByCategory(activeTechs);

  return (
    <Flex direction="column" gap="4">
      {/* Active technologies */}
      <Card>
        <Flex justify="between" align="center" mb="4">
          <Flex align="center" gap="2">
            <Heading size="4">Tech Stack</Heading>
            {!hasLlmTech && (
              <Badge size="1" color="gray" variant="outline">regex</Badge>
            )}
          </Flex>
          <Flex gap="2" align="center">
            <Badge size="1" color="cyan">{activeTechs.length} active</Badge>
            {dismissedTechs.length > 0 && (
              <Badge size="1" color="gray">{dismissedTechs.length} dismissed</Badge>
            )}
            {isAdmin && !hasLlmTech && app.jobDescription && (
              <Button
                size="1"
                variant="soft"
                color="cyan"
                disabled={running}
                onClick={startPipeline}
              >
                {running ? <><Spinner size="1" /> Running...</> : <><RocketIcon /> Extract with AI</>}
              </Button>
            )}
            {prepError && <Text size="1" color="red">{prepError}</Text>}
          </Flex>
        </Flex>

        <Flex direction="column" gap="4">
          {Array.from(activeGrouped.entries()).map(([category, items]) => (
            <Box key={category}>
              <Flex align="center" gap="2" mb="2">
                <Text size="1">{CATEGORY_ICONS[category] || "\u{1F4E6}"}</Text>
                <Text size="2" weight="bold" color="gray">{category}</Text>
              </Flex>
              <Flex wrap="wrap" gap="2">
                {items.map((tech) => (
                  <Flex key={tech.tag} align="center" gap="0">
                    <a
                      href={`/${tech.tag}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ textDecoration: "none" }}
                    >
                      <Badge
                        size="2"
                        color={CATEGORY_COLORS[category] || "gray"}
                        variant={tech.relevance === "primary" ? "solid" : "soft"}
                        highContrast={tech.relevance === "primary"}
                        style={{
                          cursor: "pointer",
                          borderTopRightRadius: 0,
                          borderBottomRightRadius: 0,
                        }}
                      >
                        <Flex align="center" gap="1">
                          {tech.label}
                          <ExternalLinkIcon width={10} height={10} style={{ opacity: 0.6 }} />
                        </Flex>
                      </Badge>
                    </a>
                    <button
                      onClick={() => toggleDismiss(tech.tag)}
                      title="Dismiss — won't generate study material"
                      style={{
                        borderTopLeftRadius: 0,
                        borderBottomLeftRadius: 0,
                        borderTopRightRadius: "var(--radius-1)",
                        borderBottomRightRadius: "var(--radius-1)",
                        height: 22,
                        width: 20,
                        cursor: "pointer",
                        border: "none",
                        background: "var(--gray-a3)",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "var(--gray-11)",
                      }}
                    >
                      <Cross2Icon width={10} height={10} />
                    </button>
                  </Flex>
                ))}
              </Flex>
            </Box>
          ))}
        </Flex>
      </Card>

      {/* Dismissed technologies */}
      {dismissedTechs.length > 0 && (
        <Card style={{ opacity: 0.7 }}>
          <Flex align="center" gap="2" mb="2">
            <Text size="2" weight="bold" color="gray">Dismissed</Text>
          </Flex>
          <Flex wrap="wrap" gap="2">
            {dismissedTechs.map((tech) => (
              <Flex key={tech.tag} align="center" gap="0">
                <Badge
                  size="2"
                  color="gray"
                  variant="outline"
                  style={{
                    textDecoration: "line-through",
                    borderTopRightRadius: 0,
                    borderBottomRightRadius: 0,
                    opacity: 0.6,
                  }}
                >
                  {tech.label}
                </Badge>
                <button
                  onClick={() => toggleDismiss(tech.tag)}
                  title="Restore — include in study material"
                  style={{
                    borderTopLeftRadius: 0,
                    borderBottomLeftRadius: 0,
                    borderTopRightRadius: "var(--radius-1)",
                    borderBottomRightRadius: "var(--radius-1)",
                    height: 22,
                    width: 20,
                    cursor: "pointer",
                    border: "none",
                    background: "var(--green-a3)",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "var(--green-11)",
                  }}
                >
                  <PlusIcon width={10} height={10} />
                </button>
              </Flex>
            ))}
          </Flex>
        </Card>
      )}

      {/* Help text */}
      <Card style={{ backgroundColor: "var(--gray-2)" }}>
        <Flex align="center" gap="2">
          <InfoCircledIcon width={14} height={14} color="var(--gray-9)" />
          <Text size="1" color="gray">
            Dismiss technologies you don&apos;t need to study. The pipeline will skip dismissed tags automatically.
          </Text>
        </Flex>
      </Card>
    </Flex>
  );
}
