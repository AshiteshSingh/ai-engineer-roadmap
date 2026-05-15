"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import {
  Heading,
  Button,
  Flex,
  Text,
  Box,
  Badge,
  Skeleton,
  Spinner,
  Card,
} from "@radix-ui/themes";
import { ArrowLeftIcon, RocketIcon } from "@radix-ui/react-icons";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  MemorizeDashboard,
  type MasteryMap,
} from "@/components/memorize/MemorizeDashboard";
import type { MemorizeCategory } from "@/lib/memorize-types";
import "@/components/app-detail/memorize/css-memorize.css";

interface AppData {
  slug: string;
  company: string;
  position: string;
  aiTechStack: string | null;
}

function MemorizePageInner() {
  const params = useParams<{ id: string }>();
  const router = useRouter();

  const [app, setApp] = useState<AppData | null>(null);
  const [categories, setCategories] = useState<MemorizeCategory[]>([]);
  const [mastery, setMastery] = useState<MasteryMap>({});
  const [generated, setGenerated] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch app data and memorize state in parallel
  useEffect(() => {
    if (!params.id) return;

    Promise.all([
      fetch(`/api/applications/${params.id}`).then((r) => {
        if (r.status === 401) {
          router.push("/login");
          return null;
        }
        if (!r.ok) throw new Error("Not found");
        return r.json();
      }),
      fetch(`/api/applications/${params.id}/memorize`)
        .then((r) => (r.ok ? r.json() : { mastery: {}, categories: [], generated: false }))
        .catch(() => ({ mastery: {}, categories: [], generated: false })),
    ])
      .then(([appData, memorizeData]) => {
        if (appData) setApp(appData);
        setMastery(memorizeData.mastery || {});
        setCategories(memorizeData.categories || []);
        setGenerated(memorizeData.generated || false);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [params.id, router]);

  const handleGenerate = useCallback(async () => {
    if (!params.id) return;
    setGenerating(true);
    try {
      const res = await fetch(`/api/applications/${params.id}/memorize/generate`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Generation failed");
      }
      const data = await res.json();
      setCategories(data.categories || []);
      setGenerated(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setGenerating(false);
    }
  }, [params.id]);

  const handleRate = useCallback(
    (itemId: string, isCorrect: boolean) => {
      // Optimistic local update
      setMastery((prev) => {
        const current = prev[itemId];
        const pMastery = current?.pMastery ?? 0.1;
        const newMastery = isCorrect
          ? Math.min(1, pMastery + 0.1)
          : Math.max(0, pMastery - 0.05);
        const level =
          newMastery >= 0.8
            ? "expert"
            : newMastery >= 0.6
              ? "proficient"
              : newMastery >= 0.4
                ? "intermediate"
                : newMastery >= 0.2
                  ? "beginner"
                  : "novice";
        return {
          ...prev,
          [itemId]: {
            pMastery: newMastery,
            masteryLevel: level,
            totalInteractions: (current?.totalInteractions ?? 0) + 1,
            correctInteractions:
              (current?.correctInteractions ?? 0) + (isCorrect ? 1 : 0),
            lastInteractionAt: new Date(),
          },
        };
      });

      // Fire-and-forget server sync
      fetch(`/api/applications/${params.id}/memorize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId: itemId, isCorrect }),
      }).catch(() => {});
    },
    [params.id],
  );

  if (loading) {
    return (
      <Box px={{ initial: "2", md: "3" }} py="4" style={{ height: "100vh" }}>
        <Skeleton height="32px" mb="6" style={{ maxWidth: 300 }} />
        <Skeleton height="400px" />
      </Box>
    );
  }

  if (error || !app) {
    return (
      <Box px={{ initial: "2", md: "3" }} py="4" style={{ height: "100vh" }}>
        <Heading size="5" mb="3">
          {error ? "Error" : "Not Found"}
        </Heading>
        <Text color="gray">
          {error ?? "This application doesn't exist or you don't have access."}
        </Text>
      </Box>
    );
  }

  // Not generated yet — show generation prompt
  if (!generated) {
    return (
      <Box px={{ initial: "2", md: "3" }} py={{ initial: "2", md: "3" }} style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
        <Flex align="center" gap="2" mb="5">
          <Link
            href={`/applications/${app.slug}/prep`}
            style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--gray-11)", textDecoration: "none" }}
          >
            <ArrowLeftIcon />
            <Text size="2">Study Plan</Text>
          </Link>
          <Text size="2" color="gray">/</Text>
          <Heading size="4">Memorize</Heading>
        </Flex>

        <Flex direction="column" align="center" justify="center" style={{ flex: 1 }}>
          <Card style={{ maxWidth: 480, width: "100%", padding: 32 }}>
            <Flex direction="column" align="center" gap="4">
              <RocketIcon width={32} height={32} style={{ color: "var(--violet-9)" }} />
              <Heading size="5" align="center">Generate Flashcards</Heading>
              <Text size="2" color="gray" align="center">
                Create spaced-repetition flashcards from the tech stack in your {app.position} application at {app.company}.
              </Text>
              {!app.aiTechStack && (
                <Text size="2" color="red" align="center">
                  Generate a study plan first to populate the tech stack.
                </Text>
              )}
              <Button
                size="3"
                color="violet"
                disabled={generating || !app.aiTechStack}
                onClick={handleGenerate}
                style={{ width: "100%" }}
              >
                {generating ? (
                  <Flex align="center" gap="2">
                    <Spinner size="1" />
                    Generating...
                  </Flex>
                ) : (
                  "Generate Flashcards"
                )}
              </Button>
            </Flex>
          </Card>
        </Flex>
      </Box>
    );
  }

  return (
    <Box px={{ initial: "2", md: "3" }} py={{ initial: "2", md: "3" }} style={{ height: "100vh", display: "flex", flexDirection: "column", overflow: "auto" }}>
      {/* Compact header */}
      <Flex justify="between" align="center" mb="3" wrap="wrap" gap="2">
        <Flex align="center" gap="2">
          <Link
            href={`/applications/${app.slug}/prep`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              color: "var(--gray-11)",
              textDecoration: "none",
            }}
          >
            <ArrowLeftIcon />
            <Text size="2">Study Plan</Text>
          </Link>
          <Text size="2" color="gray">/</Text>
          <Heading size="4">Memorize</Heading>
          <Badge color="violet" variant="soft" size="1">
            Active Recall
          </Badge>
          <Text size="2" color="gray">
            {app.company} &middot; {app.position}
          </Text>
        </Flex>
        <Flex gap="2">
          <Button size="2" variant="soft" color="gray" asChild>
            <Link href={`/applications/${app.slug}/prep`}>Study Plan</Link>
          </Button>
          <Button size="2" variant="soft" color="gray" asChild>
            <Link href={`/applications/${app.slug}/notes`}>Notes</Link>
          </Button>
        </Flex>
      </Flex>

      {/* Dashboard */}
      <MemorizeDashboard
        categories={categories}
        mastery={mastery}
        namespaceKey={app.slug}
        title="Key Concepts"
        onRate={handleRate}
      />
    </Box>
  );
}

export default function MemorizePage() {
  return (
    <Suspense
      fallback={
        <Box px={{ initial: "2", md: "3" }} py="4" style={{ height: "100vh" }}>
          <Skeleton height="32px" mb="6" style={{ maxWidth: 300 }} />
          <Skeleton height="400px" />
        </Box>
      }
    >
      <MemorizePageInner />
    </Suspense>
  );
}
