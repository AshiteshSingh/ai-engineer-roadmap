"use client";

import { useState } from "react";
import { Flex, Text, Badge } from "@radix-ui/themes";
import { getTipsForMode } from "@/lib/learning-science";

type Mode = "flashcards" | "fill" | "matcher" | "drill" | "explorer" | "dashboard";

export function ModeTip({ mode }: { mode: Mode }) {
  const [dismissed, setDismissed] = useState(false);
  const tips = getTipsForMode(mode);

  if (dismissed || tips.length === 0) return null;

  const tip = tips[Math.floor(Math.random() * tips.length)];

  return (
    <div className="mode-tip">
      <Flex align="center" gap="2" wrap="wrap" style={{ flex: 1 }}>
        <Badge color="violet" variant="soft" size="1">
          {tip.technique}
        </Badge>
        <Text size="2" style={{ flex: 1 }}>
          {tip.tip}
        </Text>
        <Text size="1" color="gray" style={{ fontStyle: "italic" }}>
          {tip.citation}
        </Text>
      </Flex>
      <button
        className="mode-tip-dismiss"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss tip"
      >
        &times;
      </button>
    </div>
  );
}
