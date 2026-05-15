"use client";

import { useState, useCallback, useMemo } from "react";
import { Button, Flex, Text } from "@radix-ui/themes";
import type { MemorizeItem } from "@/lib/memorize-types";
import { LiveDemo } from "./LiveDemo";

interface FillInTheBlankProps {
  items: MemorizeItem[];
  onRate: (itemId: string, isCorrect: boolean) => void;
}

interface BlankChallenge {
  item: MemorizeItem;
  blankedText: string;
  answer: string;
  blankLabel: string;
  mode: "css" | "text";
}

function generateChallenge(item: MemorizeItem): BlankChallenge {
  // CSS mode: blank the value from demo CSS
  if (item.demo) {
    const css = item.demo.css;
    const highlightProp = item.demo.highlightProp;
    const lines = css.split("\n");
    let answer = "";
    const blankedLines = lines.map((line) => {
      const re = new RegExp(`(${highlightProp}\\s*:\\s*)([^;]+)(;?)`);
      const match = line.match(re);
      if (match && !answer) {
        answer = match[2].trim();
        return line.replace(re, `$1_____$3`);
      }
      return line;
    });
    return { item, blankedText: blankedLines.join("\n"), answer, blankLabel: highlightProp, mode: "css" };
  }

  // Text mode: blank the term from the description
  const answer = item.term;
  const escaped = answer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const blankedText = item.description.replace(new RegExp(escaped, "gi"), "_____");
  return { item, blankedText, answer, blankLabel: "term", mode: "text" };
}

export function FillInTheBlank({
  items,
  onRate,
}: FillInTheBlankProps) {
  const [index, setIndex] = useState(0);
  const [userInput, setUserInput] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const challenge = useMemo(
    () => (items[index] ? generateChallenge(items[index]) : null),
    [items, index],
  );

  const isCorrect = useMemo(() => {
    if (!challenge || !submitted) return false;
    const normalize = (s: string) =>
      s.toLowerCase().replace(/\s+/g, " ").trim();
    return normalize(userInput) === normalize(challenge.answer);
  }, [challenge, submitted, userInput]);

  const handleSubmit = useCallback(() => {
    if (!challenge) return;
    setSubmitted(true);
    onRate(challenge.item.id, isCorrect);
  }, [challenge, isCorrect, onRate]);

  const handleNext = useCallback(() => {
    setSubmitted(false);
    setUserInput("");
    setIndex((i) => (i + 1 < items.length ? i + 1 : 0));
  }, [items.length]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        if (submitted) handleNext();
        else handleSubmit();
      }
    },
    [submitted, handleSubmit, handleNext],
  );

  if (!challenge) {
    return (
      <div className="memorize-empty">
        <span className="memorize-empty-icon">&#x270F;</span>
        <Text size="2">No concepts to practice.</Text>
      </div>
    );
  }

  const isCssMode = challenge.mode === "css" && challenge.item.demo;

  // Build preview with user's input substituted
  const previewCss = isCssMode
    ? submitted
      ? challenge.item.demo!.css
      : challenge.blankedText.replace("_____", userInput || "/* ? */")
    : "";

  return (
    <div className="fill-blank-container">
      <Text size="2" color="gray" mb="3" style={{ display: "block" }}>
        {isCssMode ? (
          <>Fill in the value for{" "}
            <code style={{ fontFamily: "var(--font-mono)", background: "var(--violet-3)", padding: "1px 6px", borderRadius: "var(--radius-1)" }}>
              {challenge.blankLabel}
            </code>:
          </>
        ) : (
          "Fill in the missing term:"
        )}
      </Text>

      <div className={isCssMode ? "fill-blank-code" : "fill-blank-text"}>
        {challenge.blankedText.split("\n").map((line, i) => {
          if (line.includes("_____")) {
            const [before, after] = line.split("_____");
            return (
              <div key={i}>
                {before}
                <input
                  className={`fill-blank-input ${
                    submitted
                      ? isCorrect
                        ? "fill-blank-input--correct"
                        : "fill-blank-input--incorrect"
                      : ""
                  }`}
                  value={submitted && !isCorrect ? challenge.answer : userInput}
                  onChange={(e) => !submitted && setUserInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={isCssMode ? "value" : "term"}
                  disabled={submitted}
                  autoFocus
                />
                {after}
              </div>
            );
          }
          return <div key={i}>{line}</div>;
        })}
      </div>

      {isCssMode && (
        <div className="fill-blank-preview">
          <LiveDemo
            html={challenge.item.demo!.html}
            css={previewCss}
            height={140}
          />
        </div>
      )}

      <div className="fill-blank-controls">
        {!submitted ? (
          <Button
            size="2"
            variant="solid"
            color="violet"
            onClick={handleSubmit}
          >
            Check <span className="memorize-kbd">Enter</span>
          </Button>
        ) : (
          <>
            {isCorrect ? (
              <Text size="2" color="grass" weight="bold">
                Correct!
              </Text>
            ) : (
              <Text size="2" color="red" weight="bold">
                Answer: {challenge.answer}
              </Text>
            )}
            <Button
              size="2"
              variant="soft"
              color="gray"
              onClick={handleNext}
            >
              Next <span className="memorize-kbd">Enter</span>
            </Button>
          </>
        )}
      </div>

      <Flex justify="center" mt="3">
        <Text size="1" color="gray">
          {index + 1} / {items.length}
        </Text>
      </Flex>
    </div>
  );
}
