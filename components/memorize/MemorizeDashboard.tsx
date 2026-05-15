"use client";

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { Heading, Text, Flex, Button, Badge, Box } from "@radix-ui/themes";
import type { MemorizeItem, MemorizeCategory } from "@/lib/memorize-types";
import { ProgressBar } from "./ProgressBar";
import { FlashcardDeck } from "./FlashcardDeck";
import { FillInTheBlank } from "./FillInTheBlank";
import { VisualMatcher } from "./VisualMatcher";
import { TimedDrill } from "./TimedDrill";
import { PropertyExplorer } from "./PropertyExplorer";
import { DueForReview } from "./DueForReview";
import { LearningScienceSidebar } from "./LearningScienceSidebar";
import { ModeTip } from "./ModeTip";
import { PreSessionCheckIn } from "./PreSessionCheckIn";
import { PostSessionSummary } from "./PostSessionSummary";
import { LearningInsights } from "./LearningInsights";
import {
  createSession,
  endSession,
  type PreSessionState,
  type PostSessionState,
  type PracticeMode,
} from "@/lib/session-tracking";

export type MasteryMap = Record<
  string,
  {
    pMastery: number;
    masteryLevel: string;
    totalInteractions: number;
    correctInteractions: number;
    lastInteractionAt: Date | null;
  }
>;

type Mode = "dashboard" | "flashcards" | "fill" | "matcher" | "drill" | "explorer";

interface MemorizeDashboardProps {
  categories: MemorizeCategory[];
  mastery: MasteryMap;
  namespaceKey: string;
  title?: string;
  onRate: (itemId: string, isCorrect: boolean) => void;
}

function getFilteredItems(
  categories: MemorizeCategory[],
  activeCategory: string | null,
): MemorizeItem[] {
  if (!activeCategory) return categories.flatMap((c) => c.items);
  return categories.find((c) => c.id === activeCategory)?.items ?? [];
}

function getSmartPracticeItems(
  allItems: MemorizeItem[],
  mastery: MasteryMap,
): MemorizeItem[] {
  return [...allItems].sort((a, b) => {
    const ma = mastery[a.id]?.pMastery ?? 0;
    const mb = mastery[b.id]?.pMastery ?? 0;
    return ma - mb;
  });
}

export function MemorizeDashboard({
  categories,
  mastery,
  namespaceKey,
  title = "Concepts",
  onRate,
}: MemorizeDashboardProps) {
  const [mode, setMode] = useState<Mode>("dashboard");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  // Session tracking state
  const [showCheckIn, setShowCheckIn] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [pendingMode, setPendingMode] = useState<Mode | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const sessionStartRef = useRef<number>(0);
  const sessionStatsRef = useRef({ reviewed: new Set<string>(), correct: 0, total: 0 });

  useEffect(() => {
    if (mode === "flashcards") {
      document.body.style.overflow = "hidden";
      return () => { document.body.style.overflow = ""; };
    }
  }, [mode]);

  const allItems = useMemo(
    () => categories.flatMap((c) => c.items),
    [categories],
  );

  const filteredItems = useMemo(
    () => getFilteredItems(categories, activeCategory),
    [categories, activeCategory],
  );

  const smartItems = useMemo(
    () => getSmartPracticeItems(allItems, mastery),
    [allItems, mastery],
  );

  const hasVisualDemos = useMemo(
    () => allItems.some((item) => item.demo),
    [allItems],
  );

  // Overall stats
  const totalItems = allItems.length;
  const masteredCount = allItems.filter(
    (p) => (mastery[p.id]?.pMastery ?? 0) >= 0.6,
  ).length;
  const overallMastery =
    totalItems > 0
      ? allItems.reduce((sum, p) => sum + (mastery[p.id]?.pMastery ?? 0), 0) /
        totalItems
      : 0;

  // ── Session flow ────────────────────────────────────────────────

  const startModeWithCheckIn = useCallback((targetMode: Mode) => {
    if (targetMode === "dashboard" || targetMode === "explorer") {
      setMode(targetMode);
      return;
    }
    setPendingMode(targetMode);
    setShowCheckIn(true);
  }, []);

  const handleCheckInDone = useCallback((preSession: PreSessionState | null) => {
    setShowCheckIn(false);
    const targetMode = pendingMode ?? "flashcards";
    const practiceMode = targetMode as PracticeMode;
    const session = createSession(namespaceKey, practiceMode, preSession);
    sessionIdRef.current = session.id;
    sessionStartRef.current = Date.now();
    sessionStatsRef.current = { reviewed: new Set(), correct: 0, total: 0 };
    setMode(targetMode);
    setPendingMode(null);
  }, [namespaceKey, pendingMode]);

  const handleBack = useCallback(() => {
    // If we have an active session, show summary
    if (sessionIdRef.current && mode !== "dashboard") {
      const stats = sessionStatsRef.current;
      const durationSec = Math.round((Date.now() - sessionStartRef.current) / 1000);
      // Store stats for summary display
      sessionStatsRef.current = { ...stats, reviewed: stats.reviewed };
      setShowSummary(true);
      setMode("dashboard");
      return;
    }
    setMode("dashboard");
  }, [mode]);

  const handleSummaryDone = useCallback((postSession: PostSessionState | null) => {
    if (sessionIdRef.current) {
      const stats = sessionStatsRef.current;
      endSession(namespaceKey, sessionIdRef.current, {
        propertiesReviewed: stats.reviewed.size,
        correctCount: stats.correct,
        totalCount: stats.total,
      }, postSession);
      sessionIdRef.current = null;
    }
    setShowSummary(false);
  }, [namespaceKey]);

  // Wrap onRate to track session stats
  const handleRate = useCallback((propertyId: string, isCorrect: boolean) => {
    onRate(propertyId, isCorrect);
    if (sessionIdRef.current) {
      sessionStatsRef.current.reviewed.add(propertyId);
      sessionStatsRef.current.total++;
      if (isCorrect) sessionStatsRef.current.correct++;
    }
  }, [onRate]);

  const handlePractice = useCallback(
    (itemId: string) => {
      const cat = categories.find((c) =>
        c.items.some((p) => p.id === itemId),
      );
      if (cat) setActiveCategory(cat.id);
      startModeWithCheckIn("flashcards");
    },
    [categories, startModeWithCheckIn],
  );

  const handleReviewProperty = useCallback(
    (itemId: string) => {
      const cat = categories.find((c) =>
        c.items.some((p) => p.id === itemId),
      );
      if (cat) setActiveCategory(cat.id);
      startModeWithCheckIn("flashcards");
    },
    [categories, startModeWithCheckIn],
  );

  const handleStartDueReview = useCallback(() => {
    setActiveCategory(null);
    startModeWithCheckIn("flashcards");
  }, [startModeWithCheckIn]);

  // ── Overlays ────────────────────────────────────────────────────

  if (showCheckIn) {
    return <PreSessionCheckIn onStart={handleCheckInDone} />;
  }

  if (showSummary) {
    const stats = sessionStatsRef.current;
    const durationSec = Math.round((Date.now() - sessionStartRef.current) / 1000);
    return (
      <PostSessionSummary
        stats={{
          propertiesReviewed: stats.reviewed.size,
          correctCount: stats.correct,
          totalCount: stats.total,
          mode: mode,
          durationSec,
        }}
        onDone={handleSummaryDone}
      />
    );
  }

  // ── Active practice modes ───────────────────────────────────────

  if (mode === "flashcards") {
    return (
      <div className="flashcard-fullscreen">
        <div className="flashcard-fullscreen-header">
          <Button size="2" variant="ghost" color="gray" onClick={handleBack}>
            &larr; Back
          </Button>
          <Text size="2" color="gray">
            {activeCategory
              ? categories.find((c) => c.id === activeCategory)?.name
              : "All categories"}
          </Text>
        </div>
        <ModeTip mode="flashcards" />
        <FlashcardDeck
          items={activeCategory ? filteredItems : smartItems}
          categories={categories}
          onRate={handleRate}
        />
      </div>
    );
  }

  if (mode === "fill") {
    return (
      <div>
        <ModeHeader
          title="Fill in the Blank"
          subtitle={activeCategory ?? "All categories"}
          onBack={handleBack}
        />
        <ModeTip mode="fill" />
        <FillInTheBlank
          items={activeCategory ? filteredItems : smartItems}
          onRate={handleRate}
        />
      </div>
    );
  }

  if (mode === "matcher") {
    return (
      <div className="matcher-mode">
        <ModeHeader
          title="Visual Matcher"
          subtitle={activeCategory ?? "All categories"}
          onBack={handleBack}
        />
        <VisualMatcher
          items={activeCategory ? filteredItems : smartItems}
          onRate={handleRate}
        />
      </div>
    );
  }

  if (mode === "drill") {
    const drillItems = activeCategory ? filteredItems : smartItems;
    const drillSubtitle = activeCategory
      ? categories.find((c) => c.id === activeCategory)?.name ?? "60 seconds"
      : "All categories";
    return (
      <div>
        <ModeHeader title="Timed Drill" subtitle={drillSubtitle} onBack={handleBack} />
        <ModeTip mode="drill" />
        <TimedDrill items={drillItems} onRate={handleRate} />
      </div>
    );
  }

  if (mode === "explorer") {
    return (
      <div>
        <ModeHeader title="Concept Explorer" subtitle="Browse & study" onBack={handleBack} />
        <ModeTip mode="explorer" />
        <PropertyExplorer
          categories={categories}
          mastery={mastery}
          onPractice={handlePractice}
        />
      </div>
    );
  }

  // ── Dashboard view ──────────────────────────────────────────────
  return (
    <div className="memorize-dashboard">
      {/* Overall progress */}
      <div className="memorize-overall">
        <Flex justify="between" align="baseline">
          <Heading size="6">{title}</Heading>
          <Text size="4" color="gray">
            {masteredCount} / {totalItems} mastered
          </Text>
        </Flex>
        <div className="memorize-overall-bar">
          <div
            className="memorize-overall-fill"
            style={{ width: `${Math.round(overallMastery * 100)}%` }}
          />
        </div>
      </div>

      {/* Due for review */}
      <DueForReview
        categories={categories}
        mastery={mastery}
        onReviewProperty={handleReviewProperty}
        onStartDueReview={handleStartDueReview}
      />

      {/* Category cards */}
      <div className="memorize-categories">
        {categories.map((cat) => {
          const catMastery =
            cat.items.length > 0
              ? cat.items.reduce(
                  (sum, p) => sum + (mastery[p.id]?.pMastery ?? 0),
                  0,
                ) / cat.items.length
              : 0;
          const isActive = activeCategory === cat.id;

          return (
            <div
              key={cat.id}
              className={`memorize-cat-card ${isActive ? "memorize-cat-card--active" : ""}`}
              onClick={() =>
                setActiveCategory(isActive ? null : cat.id)
              }
            >
              <span className="memorize-cat-icon">{cat.icon}</span>
              <div className="memorize-cat-name">{cat.name}</div>
              <div className="memorize-cat-count">
                {cat.items.length} concepts
              </div>
              <ProgressBar pMastery={catMastery} showLabel={false} />
            </div>
          );
        })}
      </div>

      {/* Active category filter indicator */}
      {activeCategory && (
        <Flex align="center" gap="2" mb="3">
          <Text size="4" color="gray">
            Filtered to:
          </Text>
          <Badge color="violet" variant="soft" size="3">
            {categories.find((c) => c.id === activeCategory)?.name}
          </Badge>
          <Button
            size="2"
            variant="ghost"
            color="gray"
            onClick={() => setActiveCategory(null)}
          >
            Clear
          </Button>
        </Flex>
      )}

      {/* Mode buttons */}
      <Heading size="5" mb="3">
        Practice Modes
      </Heading>
      <div className="memorize-modes">
        <Button
          size="4"
          variant="solid"
          color="violet"
          onClick={() => startModeWithCheckIn("flashcards")}
        >
          Flashcards
        </Button>
        <Button
          size="4"
          variant="soft"
          color="cyan"
          onClick={() => startModeWithCheckIn("fill")}
        >
          Fill in the Blank
        </Button>
        {hasVisualDemos && (
          <Button
            size="4"
            variant="soft"
            color="orange"
            onClick={() => startModeWithCheckIn("matcher")}
          >
            Visual Matcher
          </Button>
        )}
        <Button
          size="4"
          variant="soft"
          color="crimson"
          onClick={() => startModeWithCheckIn("drill")}
        >
          Timed Drill
        </Button>
        <Button
          size="4"
          variant="outline"
          color="gray"
          onClick={() => setMode("explorer")}
        >
          Browse All
        </Button>
      </div>

      {/* Smart practice CTA */}
      <Box mt="5" p="4" style={{ borderRadius: "var(--radius-3)", borderLeft: "3px solid var(--violet-8)" }}>
        <Flex justify="between" align="center" wrap="wrap" gap="3">
          <div>
            <Text size="4" weight="bold" style={{ display: "block" }}>
              Smart Practice
            </Text>
            <Text size="3" color="gray">
              Focus on your weakest concepts first, sorted by lowest mastery.
            </Text>
          </div>
          <Button
            size="4"
            variant="solid"
            color="violet"
            onClick={() => {
              setActiveCategory(null);
              startModeWithCheckIn("flashcards");
            }}
          >
            Start
          </Button>
        </Flex>
      </Box>

      {/* Learning insights */}
      <LearningInsights namespaceKey={namespaceKey} />

      {/* Learning science research */}
      <Box mt="5">
        <LearningScienceSidebar />
      </Box>
    </div>
  );
}

/** Shared header for active modes */
function ModeHeader({
  title,
  subtitle,
  onBack,
}: {
  title: string;
  subtitle: string;
  onBack: () => void;
}) {
  return (
    <Flex align="center" gap="3" mb="3">
      <Button size="2" variant="ghost" color="gray" onClick={onBack}>
        &larr; Back
      </Button>
      <Heading size="5">{title}</Heading>
      <Text size="3" color="gray">
        {subtitle}
      </Text>
    </Flex>
  );
}
