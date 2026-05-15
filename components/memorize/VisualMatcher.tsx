"use client";

import { useState, useCallback, useMemo } from "react";
import { Button, Flex, Text } from "@radix-ui/themes";
import type { MemorizeItem } from "@/lib/memorize-types";
import { LiveDemo } from "./LiveDemo";

/** VisualMatcher only works with items that have a demo field. */
type DemoItem = MemorizeItem & { demo: NonNullable<MemorizeItem["demo"]> };

interface VisualMatcherProps {
  items: MemorizeItem[];
  onRate: (itemId: string, isCorrect: boolean) => void;
}

interface CssContext {
  blankedCss: string;
  revealedCss: string;
  highlightLine: number;
}

interface MatchQuestion {
  item: DemoItem;
  correctOption: string;
  options: string[];
  cssContext: CssContext;
}

/** Build an explanation for why the correct answer is right and the wrong pick is wrong */
function buildExplanation(
  question: MatchQuestion,
  selectedOption: string,
): string {
  const { item, correctOption } = question;
  const hl = item.demo.highlightProp;

  // Parse property and value from an option string like "grid-column: 1 / 3;"
  const parseOption = (opt: string) => {
    const m = opt.match(/^(.+?):\s*(.+);$/);
    return m ? { prop: m[1].trim(), value: m[2].trim() } : null;
  };

  const correct = parseOption(correctOption);
  const picked = parseOption(selectedOption);
  if (!correct || !picked) return item.description;

  const lines: string[] = [];

  // Explain what the correct answer does
  const correctValueDesc = item.details.find(
    (d) => correct.value === d.label || correct.value.match(new RegExp(`^${d.label.replace(/<[^>]+>/g, ".+")}$`)),
  );
  lines.push(
    `${correctOption} — ${correctValueDesc?.description ?? item.description}`,
  );

  // Explain why the picked option is wrong
  if (picked.prop !== correct.prop) {
    // They picked a different property entirely
    lines.push(
      `${selectedOption} is a different property (${picked.prop}) — it wouldn't control column placement here.`,
    );
  } else if (picked.value === "inherit") {
    lines.push(
      `"inherit" copies the parent's value, which is typically "auto" — it wouldn't produce this specific span.`,
    );
  } else {
    // Same property, different value
    const pickedValueDesc = item.details.find(
      (d) => picked.value === d.label || picked.value.match(new RegExp(`^${d.label.replace(/<[^>]+>/g, ".+")}$`)),
    );
    if (pickedValueDesc) {
      lines.push(
        `${selectedOption} would instead: ${pickedValueDesc.description.charAt(0).toLowerCase()}${pickedValueDesc.description.slice(1)}`,
      );
    }
  }

  return lines.join("\n");
}

/** Build CSS context with the tested property blanked out */
function buildCssContext(item: DemoItem): CssContext {
  const lines = item.demo.css.split("\n");
  const hl = item.demo.highlightProp;
  const singleLineRe = new RegExp(`(${hl}\\s*:\\s*)([^;]+)(;)`);

  // Try single-line match first
  let highlightLine = -1;
  let blankedLines: string[] | null = null;

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(singleLineRe);
    if (match) {
      highlightLine = i;
      blankedLines = lines.map((line, j) =>
        j === i ? line.replace(singleLineRe, `$1______$3`) : line,
      );
      break;
    }
  }

  // Handle multi-line values (e.g. grid-template-areas spanning several lines)
  if (highlightLine === -1) {
    const startRe = new RegExp(`${hl}\\s*:`);
    let startIdx = -1;
    let endIdx = -1;

    for (let i = 0; i < lines.length; i++) {
      if (startIdx === -1 && startRe.test(lines[i])) {
        startIdx = i;
      }
      if (startIdx !== -1 && i > startIdx && lines[i].includes(";")) {
        endIdx = i;
        break;
      }
    }

    if (startIdx !== -1) {
      highlightLine = startIdx;
      const indent = lines[startIdx].match(/^(\s*)/)?.[1] ?? "  ";
      blankedLines = [
        ...lines.slice(0, startIdx),
        `${indent}${hl}: ______;`,
        ...lines.slice((endIdx !== -1 ? endIdx : startIdx) + 1),
      ];
    }
  }

  return {
    blankedCss: blankedLines ? blankedLines.join("\n") : item.demo.css,
    revealedCss: item.demo.css,
    highlightLine,
  };
}

/** Pick a value variation for an item to create wrong answers */
function generateVariations(item: DemoItem): string[] {
  const hl = item.demo.highlightProp;
  const css = item.demo.css;

  // Extract the current value from the demo CSS
  const re = new RegExp(`${hl}\\s*:\\s*([^;]+);`);
  const match = css.match(re);
  if (!match) return [];

  const currentValue = match[1].trim();
  const allValues = item.details
    .map((d) => d.label)
    .filter(
      (v) =>
        v !== currentValue &&
        !v.startsWith("<") &&
        v !== "none" &&
        v !== "auto",
    );

  return allValues;
}

function buildQuestion(
  item: DemoItem,
  allItems: DemoItem[],
): MatchQuestion {
  const hl = item.demo.highlightProp;
  const css = item.demo.css;
  const re = new RegExp(`(${hl}\\s*:\\s*)([^;]+)(;)`);
  const match = css.match(re);

  const correctValue = match ? match[2].trim() : "";
  const correctOption = `${hl}: ${correctValue};`;

  // Generate wrong options from the same item's other values
  const variations = generateVariations(item);
  const wrongFromSame = variations
    .slice(0, 2)
    .map((v) => `${hl}: ${v};`);

  // One wrong option from a different item
  const siblings = allItems.filter(
    (p) => p.id !== item.id,
  );
  const wrongFromSibling =
    siblings.length > 0
      ? (() => {
          const sib = siblings[Math.floor(Math.random() * siblings.length)];
          const sibVal =
            sib.details.find((d) => !d.label.startsWith("<"))?.label ??
            "inherit";
          return `${sib.term}: ${sibVal};`;
        })()
      : null;

  const wrongs = [...wrongFromSame];
  if (wrongFromSibling && !wrongs.includes(wrongFromSibling)) {
    wrongs.push(wrongFromSibling);
  }

  // Ensure exactly 3 wrong options
  while (wrongs.length < 3) {
    wrongs.push(`${hl}: inherit;`);
  }

  const options = [correctOption, ...wrongs.slice(0, 3)].sort(
    () => Math.random() - 0.5,
  );

  return { item, correctOption, options, cssContext: buildCssContext(item) };
}

export function VisualMatcher({
  items,
  onRate,
}: VisualMatcherProps) {
  // Filter to only items with demos
  const demoItems = useMemo(
    () => items.filter((i): i is DemoItem => !!i.demo),
    [items],
  );

  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [answered, setAnswered] = useState(false);

  const question = useMemo(
    () =>
      demoItems[index]
        ? buildQuestion(demoItems[index], demoItems)
        : null,
    [demoItems, index],
  );

  const handleSelect = useCallback(
    (opt: string) => {
      if (answered || !question) return;
      setSelected(opt);
      setAnswered(true);
      const correct = opt === question.correctOption;
      onRate(question.item.id, correct);
    },
    [answered, question, onRate],
  );

  const handleNext = useCallback(() => {
    setSelected(null);
    setAnswered(false);
    setIndex((i) => (i + 1 < demoItems.length ? i + 1 : 0));
  }, [demoItems.length]);

  if (!question) {
    return (
      <div className="memorize-empty">
        <span className="memorize-empty-icon">&#x1F50D;</span>
        <Text size="2">No visual items to match.</Text>
      </div>
    );
  }

  return (
    <div className="matcher-container">
      <Flex justify="center" mb="3">
        <Text size="1" color="gray">
          {index + 1} / {demoItems.length} &mdash; Which CSS declaration
          produces this output?
        </Text>
      </Flex>

      <div className="matcher-grid">
        <div className="matcher-left">
          <div className="matcher-preview">
            <div className="matcher-preview-label">Target Output</div>
            <LiveDemo
              html={question.item.demo.html}
              css={question.item.demo.css}
            />
          </div>

          <div className="matcher-css-context">
            <div className="matcher-css-label">Stylesheet</div>
            <pre className="matcher-css-code">
              {(answered ? question.cssContext.revealedCss : question.cssContext.blankedCss)
                .split("\n")
                .map((line, i) => (
                  <div
                    key={i}
                    className={
                      i === question.cssContext.highlightLine
                        ? answered
                          ? selected === question.correctOption
                            ? "matcher-css-line matcher-css-line--correct"
                            : "matcher-css-line matcher-css-line--revealed"
                          : "matcher-css-line matcher-css-line--blank"
                        : "matcher-css-line"
                    }
                  >
                    {line || "\u00A0"}
                  </div>
                ))}
            </pre>
          </div>
        </div>

        <div className="matcher-options">
          {question.options.map((opt) => {
            let cls = "matcher-option";
            if (answered && opt === question.correctOption) {
              cls += " matcher-option--correct";
            } else if (answered && opt === selected) {
              cls += " matcher-option--incorrect";
            } else if (!answered && opt === selected) {
              cls += " matcher-option--selected";
            }
            return (
              <button
                key={opt}
                className={cls}
                onClick={() => handleSelect(opt)}
                disabled={answered}
              >
                {opt}
              </button>
            );
          })}
        </div>

        {answered && (
          <div
            className={`matcher-feedback ${
              selected === question.correctOption
                ? "matcher-feedback--correct"
                : "matcher-feedback--incorrect"
            }`}
          >
            {selected === question.correctOption
              ? "Correct!"
              : (
                <>
                  <div className="matcher-feedback-title">
                    The answer was: {question.correctOption}
                  </div>
                  <div className="matcher-feedback-explanation">
                    {buildExplanation(question, selected!).split("\n").map((line, i) => (
                      <p key={i}>{line}</p>
                    ))}
                  </div>
                </>
              )}
          </div>
        )}
      </div>

      {answered && (
        <Flex justify="center" mt="4">
          <Button size="2" variant="soft" color="gray" onClick={handleNext}>
            Next
          </Button>
        </Flex>
      )}
    </div>
  );
}
