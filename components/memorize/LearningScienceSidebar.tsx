"use client";

import { useState } from "react";
import { Heading, Text, Flex, Badge, Card, Button } from "@radix-ui/themes";
import {
  getLearningScience,
  EVIDENCE_COLORS,
  formatAuthors,
  type TechniqueGroup,
} from "@/lib/learning-science";

export function LearningScienceSidebar() {
  const [open, setOpen] = useState(false);
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const data = getLearningScience();

  return (
    <div className="science-sidebar">
      <button
        className="science-sidebar-toggle"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <Flex align="center" gap="2">
          <span className="science-sidebar-icon">🔬</span>
          <Text size="3" weight="bold">
            Learning Science
          </Text>
          <Badge color="indigo" variant="soft" size="1">
            {data.totalPapers} papers
          </Badge>
          <span className={`science-sidebar-chevron ${open ? "science-sidebar-chevron--open" : ""}`}>
            &#9660;
          </span>
        </Flex>
      </button>

      {open && (
        <div className="science-sidebar-content">
          <Text size="2" color="gray" style={{ display: "block", marginBottom: 12 }}>
            Evidence-based memory techniques backed by peer-reviewed research.
          </Text>

          <div className="science-sidebar-groups">
            {data.techniqueGroups.map((group) => (
              <TechniqueGroupCard
                key={group.id}
                group={group}
                expanded={expandedGroup === group.id}
                onToggle={() =>
                  setExpandedGroup(expandedGroup === group.id ? null : group.id)
                }
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TechniqueGroupCard({
  group,
  expanded,
  onToggle,
}: {
  group: TechniqueGroup;
  expanded: boolean;
  onToggle: () => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const visiblePapers = showAll ? group.papers : group.papers.slice(0, 3);

  return (
    <Card variant="surface" className="science-group-card">
      <button className="science-group-header" onClick={onToggle}>
        <Flex align="center" gap="2" style={{ flex: 1 }}>
          <span style={{ fontSize: 20 }}>{group.icon}</span>
          <Text size="3" weight="bold">
            {group.name}
          </Text>
          <Badge color="gray" variant="soft" size="1">
            {group.papers.length}
          </Badge>
        </Flex>
        <span className={`science-sidebar-chevron ${expanded ? "science-sidebar-chevron--open" : ""}`}>
          &#9660;
        </span>
      </button>

      {expanded && (
        <Flex direction="column" gap="2" mt="2">
          <Text size="2" color="gray">
            {group.description}
          </Text>
          <div className="science-group-tip">
            <Text size="2" weight="medium">
              {group.practiceTip}
            </Text>
          </div>

          <Flex direction="column" gap="2" mt="1">
            {visiblePapers.map((paper, i) => (
              <div key={i} className="science-paper">
                <Text size="2" weight="medium" style={{ display: "block" }}>
                  {paper.title}
                </Text>
                <Flex align="center" gap="2" wrap="wrap" mt="1">
                  {paper.authors.length > 0 && (
                    <Text size="1" color="gray">
                      {formatAuthors(paper.authors)}
                    </Text>
                  )}
                  {paper.year > 0 && (
                    <Badge color="gray" variant="soft" size="1">
                      {paper.year}
                    </Badge>
                  )}
                  <Badge
                    color={EVIDENCE_COLORS[paper.evidenceLevel] || "gray"}
                    variant="outline"
                    size="1"
                  >
                    {paper.evidenceLevel.replace(/_/g, " ")}
                  </Badge>
                  <Badge color="indigo" variant="soft" size="1">
                    {paper.relevanceScore}% relevant
                  </Badge>
                </Flex>
                {paper.keyFindings.length > 0 && (
                  <Text
                    size="1"
                    color="gray"
                    style={{ lineHeight: "1.5", display: "block", marginTop: 4 }}
                  >
                    {paper.keyFindings.join("; ")}
                  </Text>
                )}
              </div>
            ))}
          </Flex>

          {group.papers.length > 3 && (
            <Button
              size="1"
              variant="ghost"
              color="gray"
              onClick={() => setShowAll(!showAll)}
            >
              {showAll ? "Show less" : `Show all ${group.papers.length} papers`}
            </Button>
          )}
        </Flex>
      )}
    </Card>
  );
}
