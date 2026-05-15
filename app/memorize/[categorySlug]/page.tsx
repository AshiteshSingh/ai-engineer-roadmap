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
} from "@radix-ui/themes";
import { ArrowLeftIcon } from "@radix-ui/react-icons";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import type { MemorizeItem, MemorizeCategory } from "@/lib/memorize-types";
import {
  MemorizeDashboard,
  type MasteryMap,
} from "@/components/memorize/MemorizeDashboard";
import "@/components/memorize/css-memorize.css";

function CategoryMemorizeInner() {
  const params = useParams<{ categorySlug: string }>();
  const router = useRouter();

  const [categories, setCategories] = useState<MemorizeCategory[]>([]);
  const [mastery, setMastery] = useState<MasteryMap>({});
  const [categoryName, setCategoryName] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!params.categorySlug) return;

    fetch(`/api/memorize/${params.categorySlug}`)
      .then((r) => {
        if (r.status === 401) {
          router.push("/login");
          return null;
        }
        if (!r.ok) throw new Error("Not found");
        return r.json();
      })
      .then((data) => {
        if (!data) return;

        const items: MemorizeItem[] = data.items ?? [];
        setMastery(data.mastery ?? {});

        // Group items by conceptType or source lesson into sub-categories
        const byLesson = new Map<string, MemorizeItem[]>();
        for (const item of items) {
          const key = item.sourceLesson ?? "general";
          if (!byLesson.has(key)) byLesson.set(key, []);
          byLesson.get(key)!.push(item);
        }

        // Create categories from lesson groups
        const cats: MemorizeCategory[] = [];
        for (const [lesson, lessonItems] of byLesson) {
          cats.push({
            id: lesson,
            name: lesson
              .replace(/-/g, " ")
              .replace(/\b\w/g, (c) => c.toUpperCase()),
            icon: "",
            color: "violet",
            items: lessonItems,
          });
        }

        setCategories(cats);

        // Derive readable name from slug
        const readable = params.categorySlug
          .replace(/-/g, " ")
          .replace(/\b\w/g, (c) => c.toUpperCase());
        setCategoryName(readable);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [params.categorySlug, router]);

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
      fetch(`/api/memorize/${params.categorySlug}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId, isCorrect }),
      }).catch(() => {});
    },
    [params.categorySlug],
  );

  if (loading) {
    return (
      <Box px={{ initial: "2", md: "3" }} py="4" style={{ height: "100vh" }}>
        <Skeleton height="32px" mb="6" style={{ maxWidth: 300 }} />
        <Skeleton height="400px" />
      </Box>
    );
  }

  if (error) {
    return (
      <Box px={{ initial: "2", md: "3" }} py="4" style={{ height: "100vh" }}>
        <Heading size="5" mb="3">Error</Heading>
        <Text color="gray">{error}</Text>
      </Box>
    );
  }

  const totalItems = categories.reduce((s, c) => s + c.items.length, 0);

  if (totalItems === 0) {
    return (
      <Box px={{ initial: "2", md: "3" }} py="4" style={{ height: "100vh" }}>
        <Flex align="center" gap="2" mb="4">
          <Link
            href="/memorize"
            style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--gray-11)", textDecoration: "none" }}
          >
            <ArrowLeftIcon />
            <Text size="2">All Categories</Text>
          </Link>
          <Text size="2" color="gray">/</Text>
          <Heading size="4">{categoryName}</Heading>
        </Flex>
        <Box p="6" style={{ textAlign: "center", background: "var(--gray-2)", borderRadius: "var(--radius-3)" }}>
          <Text size="3" color="gray">
            No concepts extracted for this category yet.
          </Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box px={{ initial: "2", md: "3" }} py={{ initial: "2", md: "3" }} style={{ height: "100vh", display: "flex", flexDirection: "column", overflow: "auto" }}>
      <Flex justify="between" align="center" mb="3" wrap="wrap" gap="2">
        <Flex align="center" gap="2">
          <Link
            href="/memorize"
            style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--gray-11)", textDecoration: "none" }}
          >
            <ArrowLeftIcon />
            <Text size="2">All Categories</Text>
          </Link>
          <Text size="2" color="gray">/</Text>
          <Heading size="4">{categoryName}</Heading>
          <Badge color="violet" variant="soft" size="1">
            Active Recall
          </Badge>
        </Flex>
      </Flex>

      <MemorizeDashboard
        categories={categories}
        mastery={mastery}
        namespaceKey={params.categorySlug}
        title={categoryName}
        onRate={handleRate}
      />
    </Box>
  );
}

export default function CategoryMemorizePage() {
  return (
    <Suspense
      fallback={
        <Box px={{ initial: "2", md: "3" }} py="4" style={{ height: "100vh" }}>
          <Skeleton height="32px" mb="6" style={{ maxWidth: 300 }} />
          <Skeleton height="400px" />
        </Box>
      }
    >
      <CategoryMemorizeInner />
    </Suspense>
  );
}
