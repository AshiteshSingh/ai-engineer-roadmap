"use client";

import { useState } from "react";
import type { ResearchPaper } from "@/lib/research-papers";

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
    <div className="se-paper-card">
      <div className="se-paper-header">
        <h4 className="se-paper-title">
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
            className="se-pdf-link"
            title="PDF"
          >
            PDF
          </a>
        )}
      </div>

      <div className="se-paper-meta">
        <span className="se-paper-authors">{authors}</span>
        {paper.year && <span className="se-paper-year">{paper.year}</span>}
        {paper.citation_count != null && paper.citation_count > 0 && (
          <span className="se-paper-cites">{paper.citation_count} cites</span>
        )}
        <span
          className="se-source-badge"
          style={{ backgroundColor: SOURCE_COLORS[paper.source] || "var(--gray-8)" }}
        >
          {paper.source}
        </span>
      </div>

      {displayAbstract && (
        <p className="se-paper-abstract">
          {displayAbstract}
          {hasLongAbstract && (
            <button
              className="se-expand-btn"
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
