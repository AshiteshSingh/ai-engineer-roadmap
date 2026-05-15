"use client";

import { useState, useEffect, Suspense } from "react";
import {
  Heading,
  Text,
  Box,
  Flex,
  Skeleton,
  Badge,
} from "@radix-ui/themes";
import Link from "next/link";
import "@/components/memorize/css-memorize.css";

interface CategorySummary {
  slug: string;
  name: string;
  icon: string;
  description: string;
  gradient: [string, string];
  totalConcepts: number;
  mastered: number;
  overallMastery: number;
}

function MemorizeLandingInner() {
  const [categories, setCategories] = useState<CategorySummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/memorize")
      .then((r) => r.json())
      .then((data) => setCategories(data.categories ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <Box px={{ initial: "3", md: "5" }} py="5" style={{ maxWidth: 1000, margin: "0 auto" }}>
        <Skeleton height="40px" mb="6" style={{ maxWidth: 300 }} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 16 }}>
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} height="140px" />
          ))}
        </div>
      </Box>
    );
  }

  const totalConcepts = categories.reduce((s, c) => s + c.totalConcepts, 0);
  const totalMastered = categories.reduce((s, c) => s + c.mastered, 0);

  return (
    <Box px={{ initial: "3", md: "5" }} py="5" style={{ maxWidth: 1000, margin: "0 auto" }}>
      <Flex direction="column" gap="2" mb="5">
        <Heading size="7">Memorize</Heading>
        <Text size="3" color="gray">
          Active recall practice across {categories.length} skill areas
          {totalConcepts > 0 && (
            <> &middot; {totalMastered} / {totalConcepts} concepts mastered</>
          )}
        </Text>
      </Flex>

      {categories.length === 0 ? (
        <Box p="6" style={{ textAlign: "center", background: "var(--gray-2)", borderRadius: "var(--radius-3)" }}>
          <Text size="3" color="gray">
            No concepts extracted yet. Run the seed script to populate.
          </Text>
        </Box>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 16 }}>
          {categories.map((cat) => {
            const pct = cat.totalConcepts > 0 ? Math.round(cat.overallMastery * 100) : 0;
            return (
              <Link
                key={cat.slug}
                href={`/memorize/${cat.slug}`}
                style={{ textDecoration: "none", color: "inherit" }}
              >
                <div
                  className="memorize-cat-card"
                  style={{ minHeight: 130, position: "relative", overflow: "hidden" }}
                >
                  <div
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      height: 3,
                      width: `${pct}%`,
                      background: cat.gradient[0],
                      transition: "width 0.3s",
                    }}
                  />
                  <span className="memorize-cat-icon">{cat.icon}</span>
                  <div className="memorize-cat-name">{cat.name}</div>
                  <div className="memorize-cat-count">
                    {cat.totalConcepts} concepts
                  </div>
                  <Flex align="center" gap="2" mt="2">
                    <Badge
                      color={pct >= 60 ? "green" : pct >= 30 ? "orange" : "gray"}
                      variant="soft"
                      size="1"
                    >
                      {cat.mastered} / {cat.totalConcepts} mastered
                    </Badge>
                  </Flex>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </Box>
  );
}

export default function MemorizeLandingPage() {
  return (
    <Suspense
      fallback={
        <Box px={{ initial: "3", md: "5" }} py="5" style={{ maxWidth: 1000, margin: "0 auto" }}>
          <Skeleton height="40px" mb="6" style={{ maxWidth: 300 }} />
          <Skeleton height="400px" />
        </Box>
      }
    >
      <MemorizeLandingInner />
    </Suspense>
  );
}
