"use client";

import { useState } from "react";
import { Heading, Text, Flex, Button, Badge } from "@radix-ui/themes";
import type { PostSessionState } from "@/lib/session-tracking";

const DIFFICULTY_LABELS = ["Very Easy", "Easy", "Medium", "Hard", "Very Hard"];
const RETENTION_LABELS = ["None", "Little", "Some", "Most", "Everything"];

interface PostSessionSummaryProps {
  stats: {
    propertiesReviewed: number;
    correctCount: number;
    totalCount: number;
    mode: string;
    durationSec: number;
  };
  onDone: (postSession: PostSessionState | null) => void;
}

export function PostSessionSummary({ stats, onDone }: PostSessionSummaryProps) {
  const [difficulty, setDifficulty] = useState<number | null>(null);
  const [retention, setRetention] = useState<number | null>(null);

  const accuracy = stats.totalCount > 0
    ? Math.round((stats.correctCount / stats.totalCount) * 100)
    : 0;

  const minutes = Math.floor(stats.durationSec / 60);
  const seconds = stats.durationSec % 60;
  const durationStr = minutes > 0
    ? `${minutes}m ${seconds}s`
    : `${seconds}s`;

  const handleDone = () => {
    if (difficulty !== null && retention !== null) {
      onDone({ perceivedDifficulty: difficulty, perceivedRetention: retention });
    } else {
      onDone(null);
    }
  };

  return (
    <div className="session-summary-overlay">
      <div className="session-summary-card">
        <Heading size="4" mb="3">
          Session Complete
        </Heading>

        <div className="session-summary-stats">
          <div className="session-summary-stat">
            <Text size="6" weight="bold" color="violet">
              {stats.propertiesReviewed}
            </Text>
            <Text size="1" color="gray">reviewed</Text>
          </div>
          <div className="session-summary-stat">
            <Text size="6" weight="bold">
              {accuracy}%
            </Text>
            <Text size="1" color="gray">accuracy</Text>
          </div>
          <div className="session-summary-stat">
            <Text size="6" weight="bold" color="gray">
              {durationStr}
            </Text>
            <Text size="1" color="gray">duration</Text>
          </div>
        </div>

        <Flex align="center" gap="2" mt="3" mb="3">
          <Badge color="violet" variant="soft" size="1">
            {stats.correctCount} correct
          </Badge>
          <Badge color="gray" variant="soft" size="1">
            {stats.totalCount - stats.correctCount} missed
          </Badge>
        </Flex>

        <Text size="2" color="gray" style={{ display: "block", marginBottom: 12 }}>
          How did that feel? (Optional)
        </Text>

        <Flex direction="column" gap="3">
          <Flex direction="column" gap="1">
            <Text size="2" weight="medium">Perceived Difficulty</Text>
            <Flex gap="1" wrap="wrap">
              {DIFFICULTY_LABELS.map((label, i) => (
                <button
                  key={i}
                  className={`session-summary-pill ${difficulty === i + 1 ? "session-summary-pill--active" : ""}`}
                  onClick={() => setDifficulty(i + 1)}
                >
                  {label}
                </button>
              ))}
            </Flex>
          </Flex>

          <Flex direction="column" gap="1">
            <Text size="2" weight="medium">How much will you remember?</Text>
            <Flex gap="1" wrap="wrap">
              {RETENTION_LABELS.map((label, i) => (
                <button
                  key={i}
                  className={`session-summary-pill ${retention === i + 1 ? "session-summary-pill--active" : ""}`}
                  onClick={() => setRetention(i + 1)}
                >
                  {label}
                </button>
              ))}
            </Flex>
          </Flex>
        </Flex>

        <Flex gap="2" mt="4" justify="end">
          <Button
            size="2"
            variant="ghost"
            color="gray"
            onClick={() => onDone(null)}
          >
            Skip
          </Button>
          <Button size="2" variant="solid" color="violet" onClick={handleDone}>
            Done
          </Button>
        </Flex>
      </div>
    </div>
  );
}
