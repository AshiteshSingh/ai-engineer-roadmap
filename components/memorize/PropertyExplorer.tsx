"use client";

import { useState, useMemo } from "react";
import { Text, Badge, Button } from "@radix-ui/themes";
import type { MemorizeItem, MemorizeCategory } from "@/lib/memorize-types";
import { LiveDemo } from "./LiveDemo";
import { ProgressBar } from "./ProgressBar";

interface PropertyExplorerProps {
  categories: MemorizeCategory[];
  mastery: Record<string, { pMastery: number; masteryLevel: string }>;
  onPractice?: (itemId: string) => void;
}

export function PropertyExplorer({
  categories,
  mastery,
  onPractice,
}: PropertyExplorerProps) {
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const allItems = useMemo(
    () => categories.flatMap((c) => c.items),
    [categories],
  );

  const filtered = useMemo(() => {
    let items = activeCategory
      ? allItems.filter((item) => {
          const cat = categories.find((c) => c.items.some((i) => i.id === item.id));
          return cat?.id === activeCategory;
        })
      : allItems;

    if (search.trim()) {
      const q = search.toLowerCase();
      items = items.filter(
        (item) =>
          item.term.toLowerCase().includes(q) ||
          item.description.toLowerCase().includes(q),
      );
    }

    return items;
  }, [allItems, categories, activeCategory, search]);

  return (
    <div className="explorer-container">
      <input
        className="explorer-search"
        type="text"
        placeholder="Search concepts..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      <div className="explorer-tabs">
        <button
          className={`explorer-tab ${!activeCategory ? "explorer-tab--active" : ""}`}
          onClick={() => setActiveCategory(null)}
        >
          All ({allItems.length})
        </button>
        {categories.map((cat) => (
          <button
            key={cat.id}
            className={`explorer-tab ${activeCategory === cat.id ? "explorer-tab--active" : ""}`}
            onClick={() =>
              setActiveCategory(activeCategory === cat.id ? null : cat.id)
            }
          >
            {cat.icon} {cat.name} ({cat.items.length})
          </button>
        ))}
      </div>

      <div className="explorer-grid">
        {filtered.map((item) => {
          const isExpanded = expandedId === item.id;
          const m = mastery[item.id];
          const cat = categories.find((c) => c.items.some((i) => i.id === item.id));

          return (
            <div
              key={item.id}
              className={`explorer-card ${isExpanded ? "explorer-card--expanded" : ""}`}
              onClick={() => setExpandedId(isExpanded ? null : item.id)}
            >
              <div className="explorer-card-header">
                <span className="explorer-card-property">{item.term}</span>
                {cat && (
                  <Badge size="1" color={cat.color as "violet"} variant="soft">
                    {cat.icon} {cat.name}
                  </Badge>
                )}
              </div>
              <div className="explorer-card-desc">
                {item.description}
              </div>
              {m && <ProgressBar pMastery={m.pMastery} masteryLevel={m.masteryLevel} />}

              {isExpanded && (
                <div className="explorer-card-detail">
                  {item.details.length > 0 && (
                    <>
                      <Text size="1" weight="bold" color="gray" mb="1">
                        {item.demo ? "Values:" : "Key details:"}
                      </Text>
                      <ul className="explorer-card-values">
                        {item.details.map((d) => (
                          <li key={d.label} className="explorer-card-value">
                            <code>{d.label}</code> &mdash; {d.description}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}

                  {item.context && (
                    <Text size="1" color="gray" mb="2" style={{ display: "block" }}>
                      {item.context}
                    </Text>
                  )}

                  {item.mnemonicHint && (
                    <div className="flashcard-hint" style={{ marginBottom: 12 }}>
                      {item.mnemonicHint}
                    </div>
                  )}

                  {item.demo && (
                    <div className="explorer-card-demo">
                      <LiveDemo
                        html={item.demo.html}
                        css={item.demo.css}
                        height={140}
                      />
                    </div>
                  )}

                  {onPractice && (
                    <Button
                      size="1"
                      variant="soft"
                      color="violet"
                      mt="3"
                      onClick={(e) => {
                        e.stopPropagation();
                        onPractice(item.id);
                      }}
                    >
                      Practice
                    </Button>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {filtered.length === 0 && (
          <div className="memorize-empty">
            <Text size="2" color="gray">
              No concepts match &quot;{search}&quot;
            </Text>
          </div>
        )}
      </div>
    </div>
  );
}
