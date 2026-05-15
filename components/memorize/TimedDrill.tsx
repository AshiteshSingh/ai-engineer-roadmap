"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { Button, Flex, Text, Heading } from "@radix-ui/themes";
import type { MemorizeItem } from "@/lib/memorize-types";

interface TimedDrillProps {
  items: MemorizeItem[];
  durationSeconds?: number;
  onRate: (itemId: string, isCorrect: boolean) => void;
}

interface DrillQuestion {
  item: MemorizeItem;
  correctAnswer: string;
  options: string[];
}

function shuffled<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function buildDrillQuestion(
  item: MemorizeItem,
  allItems: MemorizeItem[],
): DrillQuestion {
  const correct = item.description;

  // Get 3 wrong descriptions from other items
  const others = shuffled(
    allItems.filter((p) => p.id !== item.id),
  ).slice(0, 3);

  const options = shuffled([
    correct,
    ...others.map((o) => o.description),
  ]);

  return { item, correctAnswer: correct, options };
}

type Phase = "ready" | "running" | "done";

export function TimedDrill({
  items,
  durationSeconds = 60,
  onRate,
}: TimedDrillProps) {
  const [phase, setPhase] = useState<Phase>("ready");
  const [timeLeft, setTimeLeft] = useState(durationSeconds);
  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [total, setTotal] = useState(0);
  const [correct, setCorrect] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);

  const poolRef = useRef(shuffled(items));
  const indexRef = useRef(0);

  const [question, setQuestion] = useState<DrillQuestion | null>(null);

  const nextQuestion = useCallback(() => {
    const pool = poolRef.current;
    if (pool.length === 0) return;
    const idx = indexRef.current % pool.length;
    indexRef.current++;
    setQuestion(buildDrillQuestion(pool[idx], items));
    setSelected(null);
  }, [items]);

  const start = useCallback(() => {
    poolRef.current = shuffled(items);
    indexRef.current = 0;
    setPhase("running");
    setTimeLeft(durationSeconds);
    setScore(0);
    setStreak(0);
    setTotal(0);
    setCorrect(0);
    nextQuestion();
  }, [items, durationSeconds, nextQuestion]);

  // Timer
  useEffect(() => {
    if (phase !== "running") return;
    const id = setInterval(() => {
      setTimeLeft((t) => {
        if (t <= 1) {
          clearInterval(id);
          setPhase("done");
          return 0;
        }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [phase]);

  const handleAnswer = useCallback(
    (opt: string) => {
      if (!question || selected) return;
      setSelected(opt);
      const isCorrect = opt === question.correctAnswer;
      setTotal((t) => t + 1);

      if (isCorrect) {
        const bonus = Math.max(1, Math.floor(timeLeft / 10));
        setScore((s) => s + 10 + bonus);
        setStreak((s) => s + 1);
        setCorrect((c) => c + 1);
      } else {
        setStreak(0);
      }

      onRate(question.item.id, isCorrect);

      // Auto-advance after brief pause
      setTimeout(() => {
        if (phase === "running") nextQuestion();
      }, 600);
    },
    [question, selected, timeLeft, onRate, phase, nextQuestion],
  );

  const timerClass = useMemo(() => {
    if (timeLeft <= 10) return "drill-timer drill-timer--danger";
    if (timeLeft <= 20) return "drill-timer drill-timer--warning";
    return "drill-timer";
  }, [timeLeft]);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  if (phase === "ready") {
    return (
      <div className="drill-container">
        <div className="drill-results">
          <Heading size="5" mb="3">
            Timed Drill
          </Heading>
          <Text size="2" color="gray" mb="4" style={{ display: "block" }}>
            {durationSeconds} seconds. Identify the correct description for each
            concept. Speed + accuracy = higher score.
          </Text>
          <Button size="3" variant="solid" color="violet" onClick={start}>
            Start Drill
          </Button>
        </div>
      </div>
    );
  }

  if (phase === "done") {
    const accuracy = total > 0 ? Math.round((correct / total) * 100) : 0;
    return (
      <div className="drill-container">
        <div className="drill-results">
          <div className="drill-results-score">{score}</div>
          <Text size="3" weight="bold" mb="3" style={{ display: "block" }}>
            points
          </Text>
          <div className="drill-results-stat">
            {correct} / {total} correct ({accuracy}%)
          </div>
          <div className="drill-results-stat">
            {total} questions in {durationSeconds}s
          </div>
          <Flex justify="center" mt="4" gap="2">
            <Button size="2" variant="solid" color="violet" onClick={start}>
              Try Again
            </Button>
          </Flex>
        </div>
      </div>
    );
  }

  if (!question) return null;

  return (
    <div className="drill-container">
      <div className="drill-header">
        <div className={timerClass}>{formatTime(timeLeft)}</div>
        <div className="drill-score">{score}</div>
        {streak >= 2 && (
          <div className="drill-streak">{streak}x streak</div>
        )}
      </div>

      <div className="drill-question">
        <div className="drill-property">{question.item.term}</div>
        <div className="drill-prompt">What is this?</div>
      </div>

      <div className="drill-options">
        {question.options.map((opt) => {
          let cls = "drill-option";
          if (selected) {
            if (opt === question.correctAnswer) cls += " drill-option--correct";
            else if (opt === selected) cls += " drill-option--incorrect";
          }
          return (
            <button
              key={opt}
              className={cls}
              onClick={() => handleAnswer(opt)}
              disabled={!!selected}
            >
              {opt}
            </button>
          );
        })}
      </div>

      <Text size="1" color="gray">
        Questions answered: {total}
      </Text>
    </div>
  );
}
