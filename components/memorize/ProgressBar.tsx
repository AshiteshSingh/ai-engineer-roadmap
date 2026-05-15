"use client";

import { memo } from "react";
import { Text, Flex } from "@radix-ui/themes";

interface ProgressBarProps {
  pMastery: number;
  masteryLevel?: string;
  showLabel?: boolean;
}

function levelFromP(p: number): string {
  if (p >= 0.8) return "expert";
  if (p >= 0.6) return "proficient";
  if (p >= 0.4) return "intermediate";
  if (p >= 0.2) return "beginner";
  return "novice";
}

export const ProgressBar = memo(function ProgressBar({
  pMastery,
  masteryLevel,
  showLabel = true,
}: ProgressBarProps) {
  const level = masteryLevel || levelFromP(pMastery);
  const pct = Math.round(pMastery * 100);

  return (
    <div>
      {showLabel && (
        <Flex justify="between" align="center">
          <Text size="1" color="gray" style={{ textTransform: "capitalize" }}>
            {level}
          </Text>
          <Text size="1" color="gray">
            {pct}%
          </Text>
        </Flex>
      )}
      <div className="memorize-progress">
        <div
          className={`memorize-progress-fill memorize-progress-fill--${level}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
});
