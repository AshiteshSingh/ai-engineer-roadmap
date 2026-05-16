"use client";

import { useState, useEffect, Suspense } from "react";
import type { CSSProperties } from "react";
import { Text, Flex, Skeleton, Badge } from "@radix-ui/themes";
import Link from "next/link";
import { Section, Heading } from "@/components/ui";
import "@/components/memorize/css-memorize.css";
import styles from "./page.module.css";

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
      <Section>
        <Skeleton height="40px" mb="6" className={styles.skelTitle} />
        <div className={styles.grid}>
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} height="140px" />
          ))}
        </div>
      </Section>
    );
  }

  const totalConcepts = categories.reduce((s, c) => s + c.totalConcepts, 0);
  const totalMastered = categories.reduce((s, c) => s + c.mastered, 0);

  return (
    <Section>
      <Flex direction="column" gap="2" mb="5">
        <Heading as="h1" size="xl">
          Memorize
        </Heading>
        <Text size="3" className={styles.sub}>
          Active recall practice across {categories.length} skill areas
          {totalConcepts > 0 && (
            <> &middot; {totalMastered} / {totalConcepts} concepts mastered</>
          )}
        </Text>
      </Flex>

      {categories.length === 0 ? (
        <div className={styles.empty}>
          <Text size="3" color="gray">
            No concepts extracted yet. Run the seed script to populate.
          </Text>
        </div>
      ) : (
        <div className={styles.grid}>
          {categories.map((cat) => {
            const pct = cat.totalConcepts > 0 ? Math.round(cat.overallMastery * 100) : 0;
            return (
              <Link
                key={cat.slug}
                href={`/memorize/${cat.slug}`}
                className={styles.cardLink}
              >
                <div className={`memorize-cat-card ${styles.card}`}>
                  <div
                    className={styles.progress}
                    style={
                      {
                        "--pct": `${pct}%`,
                        "--bar": cat.gradient[0],
                      } as CSSProperties
                    }
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
    </Section>
  );
}

export default function MemorizeLandingPage() {
  return (
    <Suspense
      fallback={
        <Section>
          <Skeleton height="40px" mb="6" className={styles.skelTitle} />
          <Skeleton height="400px" />
        </Section>
      }
    >
      <MemorizeLandingInner />
    </Suspense>
  );
}
