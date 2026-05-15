"use client";

import { useState, useMemo } from "react";
import { Heading, Text, Flex, Badge } from "@radix-ui/themes";
import { computeInsights } from "@/lib/session-tracking";

const TIME_LABELS: Record<string, string> = {
  morning: "Morning",
  afternoon: "Afternoon",
  evening: "Evening",
  night: "Night",
};

export function LearningInsights({ namespaceKey }: { namespaceKey: string }) {
  const [open, setOpen] = useState(false);
  const insights = useMemo(() => computeInsights(namespaceKey), [namespaceKey]);

  if (insights.totalSessions === 0) return null;

  return (
    <div className="insights-section">
      <button
        className="insights-toggle"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <Flex align="center" gap="2">
          <span style={{ fontSize: 18 }}>📊</span>
          <Text size="3" weight="bold">
            Learning Insights
          </Text>
          <Badge color="gray" variant="soft" size="1">
            {insights.totalSessions} sessions
          </Badge>
          <span className={`science-sidebar-chevron ${open ? "science-sidebar-chevron--open" : ""}`}>
            &#9660;
          </span>
        </Flex>
      </button>

      {open && (
        <div className="insights-grid">
          {/* Streak */}
          <div className="insights-card">
            <Text size="1" color="gray">Current Streak</Text>
            <Text size="6" weight="bold" color="violet">
              {insights.currentStreak}
            </Text>
            <Text size="1" color="gray">
              days {insights.longestStreak > insights.currentStreak && (
                <>(best: {insights.longestStreak})</>
              )}
            </Text>
          </div>

          {/* Total reviewed */}
          <div className="insights-card">
            <Text size="1" color="gray">Total Reviewed</Text>
            <Text size="6" weight="bold">
              {insights.totalPropertiesReviewed}
            </Text>
            <Text size="1" color="gray">properties</Text>
          </div>

          {/* Average accuracy */}
          <div className="insights-card">
            <Text size="1" color="gray">Average Accuracy</Text>
            <Text size="6" weight="bold" color={insights.averageAccuracy >= 0.7 ? "green" : "orange"}>
              {Math.round(insights.averageAccuracy * 100)}%
            </Text>
            <Text size="1" color="gray">overall</Text>
          </div>

          {/* Study velocity */}
          <div className="insights-card">
            <Text size="1" color="gray">Study Velocity</Text>
            <Text size="6" weight="bold">
              {Math.round(insights.studyVelocity)}
            </Text>
            <Text size="1" color="gray">per week</Text>
          </div>

          {/* Best time of day */}
          {insights.bestTimeOfDay && (
            <div className="insights-card">
              <Text size="1" color="gray">Best Time</Text>
              <Text size="4" weight="bold" color="cyan">
                {TIME_LABELS[insights.bestTimeOfDay]}
              </Text>
              <Text size="1" color="gray">highest accuracy</Text>
            </div>
          )}

          {/* Accuracy trend */}
          {insights.accuracyTrend.length >= 3 && (
            <div className="insights-card insights-card--wide">
              <Text size="1" color="gray" style={{ display: "block", marginBottom: 8 }}>
                Recent Accuracy Trend
              </Text>
              <Flex gap="1" align="end" style={{ height: 40 }}>
                {insights.accuracyTrend.map((acc, i) => (
                  <div
                    key={i}
                    className="insights-bar"
                    style={{
                      height: `${Math.max(4, acc * 40)}px`,
                      background: acc >= 0.7
                        ? "var(--green-9)"
                        : acc >= 0.5
                          ? "var(--orange-9)"
                          : "var(--red-9)",
                    }}
                    title={`Session ${i + 1}: ${Math.round(acc * 100)}%`}
                  />
                ))}
              </Flex>
              <Flex justify="between" mt="1">
                <Text size="1" color="gray">oldest</Text>
                <Text size="1" color="gray">latest</Text>
              </Flex>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
