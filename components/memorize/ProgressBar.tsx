"use client";

import { memo } from "react";
import type { CSSProperties } from "react";
import { Text, Flex } from "@radix-ui/themes";
import { cx } from "@/components/ui";
import s from "./ProgressBar.module.css";

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
          <Text size="1" color="gray" className={s.level}>
            {level}
          </Text>
          <Text size="1" color="gray">
            {pct}%
          </Text>
        </Flex>
      )}
      <div className={cx("memorize-progress", s.track)}>
        <div
          className={cx(
            "memorize-progress-fill",
            `memorize-progress-fill--${level}`,
            s.fill,
          )}
          style={{ "--memorize-progress-pct": `${pct}%` } as CSSProperties}
        />
      </div>
    </div>
  );
});
