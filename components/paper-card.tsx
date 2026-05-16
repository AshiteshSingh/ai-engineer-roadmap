"use client";

import { useState } from "react";
import type { ResearchPaper } from "@/lib/research-papers";
import { cx } from "@/components/ui";
import s from "./paper-card.module.css";

const SOURCE_COLORS: Record<string, string> = {
  arXiv: "var(--red-9)",
  OpenAlex: "var(--blue-9)",
  Crossref: "var(--jade-9)",
  "Semantic Scholar": "var(--violet-9)",
  CORE: "var(--orange-9)",
  Zenodo: "var(--cyan-9)",
};

export function PaperCard({ paper }: { paper: ResearchPaper }) {
  const [expanded, setExpanded] = useState(false);
  const abstract_ = paper.abstract;
  const hasLongAbstract = abstract_ && abstract_.length > 200;
  const displayAbstract = hasLongAbstract && !expanded
    ? abstract_.slice(0, 200) + "..."
    : abstract_;

  const authors = paper.authors.length <= 3
    ? paper.authors.join(", ")
    : `${paper.authors[0]} et al.`;

  return (
    <div className={s.card}>
      <div className={s.header}>
        <h4 className={s.title}>
          {paper.url ? (
            <a href={paper.url} target="_blank" rel="noopener noreferrer">
              {paper.title}
            </a>
          ) : (
            paper.title
          )}
        </h4>
        {paper.pdf_url && (
          <a
            href={paper.pdf_url}
            target="_blank"
            rel="noopener noreferrer"
            className={s.pdfLink}
            title="PDF"
          >
            PDF
          </a>
        )}
      </div>

      <div className={s.meta}>
        <span className={s.authors}>{authors}</span>
        {paper.year && <span className={s.year}>{paper.year}</span>}
        {paper.citation_count != null && paper.citation_count > 0 && (
          <span className={s.cites}>{paper.citation_count} cites</span>
        )}
        <span
          className={s.sourceBadge}
          style={{ backgroundColor: SOURCE_COLORS[paper.source] || "var(--gray-8)" }}
        >
          {paper.source}
        </span>
      </div>

      {displayAbstract && (
        <p className={s.abstract}>
          {displayAbstract}
          {hasLongAbstract && (
            <button
              className={cx(s.expandBtn)}
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? "less" : "more"}
            </button>
          )}
        </p>
      )}
    </div>
  );
}
