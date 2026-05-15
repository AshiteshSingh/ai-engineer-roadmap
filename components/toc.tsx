"use client";

import { useEffect, useMemo, useRef, useState } from "react";

interface TocEntry {
  level: number;
  text: string;
  id: string;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .trim();
}

function extractHeadings(markdown: string): TocEntry[] {
  const entries: TocEntry[] = [];
  for (const line of markdown.split("\n")) {
    const match = line.match(/^(#{2,3})\s+(.+)/);
    if (match) {
      const level = match[1].length;
      const text = match[2].trim();
      entries.push({ level, text, id: slugify(text) });
    }
  }
  return entries;
}

function TocNav({
  headings,
  activeId,
  onSelect,
}: {
  headings: TocEntry[];
  activeId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <nav>
      {headings.map((h, i) => {
        const isActive = activeId === h.id;
        const classes = [
          h.level === 3 ? "toc-h3" : undefined,
          isActive ? "toc-active" : undefined,
        ]
          .filter(Boolean)
          .join(" ") || undefined;

        return (
          <a
            key={`${h.id}-${i}`}
            href={`#${h.id}`}
            className={classes}
            onClick={(e) => {
              e.preventDefault();
              const el = document.getElementById(h.id);
              if (el) {
                el.scrollIntoView({ behavior: "smooth" });
                onSelect(h.id);
              }
            }}
          >
            {h.text}
          </a>
        );
      })}
    </nav>
  );
}

export function TableOfContents({ markdown }: { markdown: string }) {
  const headings = useMemo(() => extractHeadings(markdown), [markdown]);
  const [activeId, setActiveId] = useState<string>("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    if (headings.length === 0) return;

    const visibleHeadings = new Map<string, IntersectionObserverEntry>();

    observerRef.current = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            visibleHeadings.set(entry.target.id, entry);
          } else {
            visibleHeadings.delete(entry.target.id);
          }
        }
        if (visibleHeadings.size > 0) {
          let topEntry: IntersectionObserverEntry | null = null;
          for (const entry of visibleHeadings.values()) {
            if (!topEntry || entry.boundingClientRect.top < topEntry.boundingClientRect.top) {
              topEntry = entry;
            }
          }
          if (topEntry) setActiveId(topEntry.target.id);
        }
      },
      { rootMargin: "-60px 0px -70% 0px", threshold: 0 }
    );

    for (const heading of headings) {
      const el = document.getElementById(heading.id);
      if (el) observerRef.current.observe(el);
    }

    return () => { observerRef.current?.disconnect(); };
  }, [headings]);

  if (headings.length === 0) return null;

  const handleSelect = (id: string) => {
    setActiveId(id);
    setDrawerOpen(false);
  };

  return (
    <>
      {/* Desktop TOC */}
      <div className="toc-sidebar" aria-label="Table of contents">
        <div className="toc-sidebar-title">On this page</div>
        <TocNav headings={headings} activeId={activeId} onSelect={handleSelect} />
      </div>

      {/* Mobile TOC trigger + drawer */}
      <button
        type="button"
        className="toc-mobile-trigger"
        aria-label="Toggle table of contents"
        onClick={() => setDrawerOpen(true)}
      >
        Contents
      </button>

      {drawerOpen && (
        <div
          className="toc-mobile-backdrop toc-mobile-backdrop--open"
          aria-hidden="true"
          onClick={() => setDrawerOpen(false)}
        />
      )}
      <div className={`toc-mobile-drawer ${drawerOpen ? "toc-mobile-drawer--open" : ""}`}>
        <div className="toc-mobile-drawer-handle" />
        <div className="toc-sidebar-title">On this page</div>
        <TocNav headings={headings} activeId={activeId} onSelect={handleSelect} />
      </div>
    </>
  );
}
