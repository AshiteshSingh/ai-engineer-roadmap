"use client";

import { useState, useCallback, useEffect } from "react";
import { Button, Text, Badge } from "@radix-ui/themes";
import type { MemorizeItem, MemorizeCategory } from "@/lib/memorize-types";
import { LiveDemo } from "./LiveDemo";

interface FlashcardDeckProps {
  items: MemorizeItem[];
  categories: MemorizeCategory[];
  onRate: (itemId: string, isCorrect: boolean) => void;
}

export function FlashcardDeck({
  items,
  categories,
  onRate,
}: FlashcardDeckProps) {
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);

  const item = items[index];
  const cat = categories.find((c) => c.items.some((i) => i.id === item?.id));
  const total = items.length;

  const toggle = useCallback(() => setRevealed((r) => !r), []);

  const rate = useCallback(
    (isCorrect: boolean) => {
      if (!item) return;
      onRate(item.id, isCorrect);
      setRevealed(false);
      setIndex((i) => (i + 1 < total ? i + 1 : 0));
    },
    [item, onRate, total],
  );

  const navigate = useCallback(
    (dir: -1 | 1) => {
      setRevealed(false);
      setIndex((i) => {
        const next = i + dir;
        if (next < 0) return total - 1;
        if (next >= total) return 0;
        return next;
      });
    },
    [total],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === " " || e.key === "Spacebar") {
        e.preventDefault();
        toggle();
      } else if (e.key === "ArrowRight") {
        navigate(1);
      } else if (e.key === "ArrowLeft") {
        navigate(-1);
      } else if (e.key === "1") {
        rate(true);
      } else if (e.key === "2") {
        rate(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle, rate, navigate]);

  if (!item) {
    return (
      <div className="memorize-empty">
        <span className="memorize-empty-icon">&#x1F4DA;</span>
        <Text size="2">No concepts to review.</Text>
      </div>
    );
  }

  return (
    <div className="flashcard-split-wrapper" style={!item.demo ? { gridTemplateColumns: "1fr" } : undefined}>
      {/* Left: test / quiz */}
      <div className="flashcard-left" onClick={toggle}>
        <div className="flashcard-counter">
          <Text size="1" color="gray">
            {index + 1} / {total}
          </Text>
        </div>

        {cat && (
          <Badge
            size="1"
            color={cat.color as "violet"}
            variant="soft"
            style={{ marginBottom: 16 }}
          >
            {cat.icon} {cat.name}
          </Badge>
        )}

        <div className="flashcard-property">{item.term}</div>
        <div className="flashcard-prompt">
          {item.demo
            ? "What does this property do? What values can it take?"
            : "What is this concept? What are its key aspects?"}
        </div>

        {revealed ? (
          <div className="flashcard-answer">
            <div className="flashcard-description">
              {item.description}
            </div>

            {item.details.length > 0 && (
              <>
                <Text size="1" weight="bold" color="gray" mb="1">
                  {item.demo ? "Values:" : "Key details:"}
                </Text>
                <ul className="flashcard-values">
                  {item.details.map((d) => (
                    <li key={d.label} className="flashcard-value">
                      <code>{d.label}</code>
                      <span className="flashcard-value-desc">
                        {" "}
                        &mdash; {d.description}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}

            {item.context && (
              <Text size="1" color="gray" mb="1">
                {item.context}
              </Text>
            )}

            {item.mnemonicHint && (
              <div className="flashcard-hint">{item.mnemonicHint}</div>
            )}
          </div>
        ) : (
          <Text
            size="1"
            color="gray"
            style={{ marginTop: "auto", paddingTop: 16 }}
          >
            Click or press <span className="memorize-kbd">Space</span> to
            reveal
          </Text>
        )}
      </div>

      {/* Right: rendered demo (only for items with visual demos) */}
      {item.demo && (
        <div className="flashcard-right">
          <LiveDemo
            html={item.demo.html}
            css={item.demo.css}
            height="100%"
          />
        </div>
      )}

      {/* Bottom controls */}
      <div className="flashcard-controls">
        {revealed && (
          <div className="flashcard-rating">
            <Button
              size="2"
              variant="soft"
              color="grass"
              onClick={(e) => {
                e.stopPropagation();
                rate(true);
              }}
            >
              Knew it <span className="memorize-kbd">1</span>
            </Button>
            <Button
              size="2"
              variant="soft"
              color="red"
              onClick={(e) => {
                e.stopPropagation();
                rate(false);
              }}
            >
              Didn&apos;t know <span className="memorize-kbd">2</span>
            </Button>
          </div>
        )}
        <div className="flashcard-nav">
          <Button size="1" variant="ghost" color="gray" onClick={() => navigate(-1)}>
            &larr; Prev
          </Button>
          <Button size="1" variant="ghost" color="gray" onClick={() => navigate(1)}>
            Next &rarr;
          </Button>
        </div>
      </div>
    </div>
  );
}
