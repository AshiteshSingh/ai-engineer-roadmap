"use client";

import { useMemo } from "react";
import { Heading, Text, Flex, Button, Badge } from "@radix-ui/themes";
import type { MemorizeCategory } from "@/lib/memorize-types";
import type { MasteryMap } from "./MemorizeDashboard";
import {
  getDueItems,
  getAllSchedules,
  formatRelativeTime,
  type ReviewItem,
} from "@/lib/spaced-repetition";

interface DueForReviewProps {
  categories: MemorizeCategory[];
  mastery: MasteryMap;
  onReviewProperty: (itemId: string) => void;
  onStartDueReview: () => void;
}

export function DueForReview({
  categories,
  mastery,
  onReviewProperty,
  onStartDueReview,
}: DueForReviewProps) {
  const now = useMemo(() => new Date(), []);

  const { dueItems, nextUpcoming } = useMemo(() => {
    const allProps = categories.flatMap((c) => c.items);
    const reviewItems: ReviewItem[] = allProps
      .filter((p) => mastery[p.id]?.lastInteractionAt)
      .map((p) => ({
        id: p.id,
        pMastery: mastery[p.id].pMastery,
        totalInteractions: mastery[p.id].totalInteractions,
        lastInteractionAt: new Date(mastery[p.id].lastInteractionAt!),
      }));

    const due = getDueItems(reviewItems, now);
    const allSchedules = getAllSchedules(reviewItems);
    const upcoming = allSchedules.find((s) => s.nextReviewAt > now) ?? null;

    return { dueItems: due, nextUpcoming: upcoming };
  }, [categories, mastery, now]);

  // Nothing reviewed yet
  const hasAnyMastery = Object.keys(mastery).length > 0;
  if (!hasAnyMastery) return null;

  const findItemName = (id: string): string => {
    for (const cat of categories) {
      const item = cat.items.find((p) => p.id === id);
      if (item) return item.term;
    }
    return id;
  };

  const getLevelColor = (id: string): "gray" | "orange" | "blue" | "cyan" | "green" => {
    const level = mastery[id]?.masteryLevel ?? "novice";
    switch (level) {
      case "expert": return "green";
      case "proficient": return "cyan";
      case "intermediate": return "blue";
      case "beginner": return "orange";
      default: return "gray";
    }
  };

  if (dueItems.length === 0) {
    return (
      <div className="due-review-card due-review-card--clear">
        <Flex justify="between" align="center" wrap="wrap" gap="2">
          <Flex direction="column" gap="1">
            <Text size="3" weight="bold" color="green">
              All caught up!
            </Text>
            {nextUpcoming && (
              <Text size="2" color="gray">
                Next review: <code>{findItemName(nextUpcoming.id)}</code>{" "}
                {formatRelativeTime(nextUpcoming.nextReviewAt, now)}
              </Text>
            )}
          </Flex>
        </Flex>
      </div>
    );
  }

  const displayItems = dueItems.slice(0, 5);

  return (
    <div className="due-review-card">
      <Flex justify="between" align="center" mb="3">
        <Flex align="center" gap="2">
          <Heading size="4">Due for Review</Heading>
          <Badge color="crimson" variant="soft" size="2">
            {dueItems.length}
          </Badge>
        </Flex>
        <Button
          size="2"
          variant="solid"
          color="violet"
          onClick={onStartDueReview}
        >
          Review All
        </Button>
      </Flex>

      <div className="due-review-list">
        {displayItems.map((item) => (
          <div key={item.id} className="due-review-item">
            <Flex justify="between" align="center" gap="2">
              <Flex align="center" gap="2" style={{ flex: 1, minWidth: 0 }}>
                <code className="due-review-prop">{findItemName(item.id)}</code>
                <Badge
                  color={getLevelColor(item.id)}
                  variant="soft"
                  size="1"
                >
                  {mastery[item.id]?.masteryLevel ?? "novice"}
                </Badge>
              </Flex>
              <Flex align="center" gap="2">
                <Text size="1" color="gray">
                  {formatRelativeTime(item.nextReviewAt, now)}
                </Text>
                <Button
                  size="1"
                  variant="ghost"
                  color="violet"
                  onClick={() => onReviewProperty(item.id)}
                >
                  Review
                </Button>
              </Flex>
            </Flex>
          </div>
        ))}
        {dueItems.length > 5 && (
          <Text size="2" color="gray" style={{ padding: "4px 0" }}>
            +{dueItems.length - 5} more due
          </Text>
        )}
      </div>
    </div>
  );
}
