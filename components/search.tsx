"use client";

import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { GroupedLessons } from "@/lib/articles";
import type { SearchResult } from "@/lib/data";
import { searchContent } from "@/lib/actions/search";
import { deepSearch, type DeepSearchResult } from "@/lib/actions/deep-search";
import { CategoryGrid } from "./category-grid";

function highlightSnippet(snippet: string) {
  const parts = snippet.split("**");
  return parts.map((part, i) =>
    i % 2 === 1 ? <mark key={i}>{part}</mark> : <span key={i}>{part}</span>,
  );
}

/**
 * Resolve where a search result links. DeepLearning.AI transcript chunks are
 * indexed under synthetic `dlai-<courseSlug>` slugs (chat-retrieval grounding,
 * not roadmap routes); send those to the course on learn.deeplearning.ai in a
 * new tab instead of an internal route that would 404.
 */
function resolveResultHref(
  lessonSlug: string | null,
  metaUrl?: string,
): { href: string; external: boolean } {
  if (lessonSlug && lessonSlug.startsWith("dlai-")) {
    return {
      href: `https://learn.deeplearning.ai/courses/${lessonSlug.slice(5)}`,
      external: true,
    };
  }
  return { href: metaUrl ?? `/${lessonSlug}`, external: false };
}

function typeBadgeLabel(type: SearchResult["resultType"]) {
  switch (type) {
    case "lesson":
      return "Lesson";
    case "section":
      return "Section";
  }
}

interface Props {
  groups: GroupedLessons[];
}

const SEARCH_SUGGESTIONS = [
  "transformers",
  "RAG",
  "agents",
  "fine-tuning",
  "evals",
  "RLHF",
  "embeddings",
  "prompt engineering",
];

export function Search({ groups }: Props) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [isDeepSearch, setIsDeepSearch] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [inputFocused, setInputFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const lessonLookup = useMemo(() => {
    const map = new Map<string, { category: string; icon: string; catSlug: string; difficulty: string; url: string }>();
    for (const g of groups) {
      for (const a of g.articles) {
        map.set(a.slug, { category: g.category, icon: g.meta.icon, catSlug: g.meta.slug, difficulty: a.difficulty, url: a.url });
      }
    }
    return map;
  }, [groups]);

  const totalLessons = useMemo(
    () => groups.reduce((sum, g) => sum + g.articles.length, 0),
    [groups],
  );

  // Reset focused index when results change
  useEffect(() => {
    setFocusedIndex(-1);
  }, [results]);

  // Cmd+K / Ctrl+K to focus
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const doSearch = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const res = isDeepSearch
      ? await deepSearch(trimmed)
      : await searchContent(trimmed);
    setResults(res);
    setSearching(false);
  }, [isDeepSearch]);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    setQuery(val);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => doSearch(val), 300);
  }

  function handleClear() {
    setQuery("");
    setResults([]);
    setFocusedIndex(-1);
    inputRef.current?.focus();
  }

  function handleSuggestionClick(suggestion: string) {
    setQuery(suggestion);
    clearTimeout(timerRef.current);
    doSearch(suggestion);
    inputRef.current?.focus();
  }

  function setMode(deep: boolean) {
    setIsDeepSearch(deep);
    if (query.trim().length >= 2) {
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => doSearch(query), 100);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocusedIndex((prev) => (prev + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocusedIndex((prev) => (prev <= 0 ? results.length - 1 : prev - 1));
    } else if (e.key === "Enter" && focusedIndex >= 0) {
      e.preventDefault();
      const r = results[focusedIndex];
      const meta = r.lessonSlug ? lessonLookup.get(r.lessonSlug) : undefined;
      const { href, external } = resolveResultHref(r.lessonSlug, meta?.url);
      if (external) window.open(href, "_blank", "noopener,noreferrer");
      else router.push(href);
    }
  }

  const hasQuery = query.trim().length >= 2;

  return (
    <>
      <div className="cmd-search">
        <div
          className={`cmd-bar${inputFocused ? " cmd-bar--focused" : ""}${hasQuery ? " cmd-bar--active" : ""}`}
        >
          <span className="cmd-bar-icon" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.8" />
              <line x1="12.2" y1="12.2" x2="16" y2="16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </span>

          <input
            ref={inputRef}
            type="text"
            className="cmd-bar-input"
            aria-label="Search lessons"
            placeholder={
              isDeepSearch
                ? "Deep search by meaning across all lessons…"
                : `Search ${totalLessons} lessons, topics, concepts…`
            }
            value={query}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onFocus={() => setInputFocused(true)}
            onBlur={() => setInputFocused(false)}
          />

          {hasQuery && results.length > 0 && (
            <span className="cmd-bar-count" aria-live="polite">
              {results.length} {results.length === 1 ? "hit" : "hits"}
            </span>
          )}

          {query.length > 0 ? (
            <button
              type="button"
              className="cmd-bar-clear"
              aria-label="Clear search"
              onClick={handleClear}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <line x1="3.5" y1="3.5" x2="10.5" y2="10.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                <line x1="10.5" y1="3.5" x2="3.5" y2="10.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
          ) : (
            <kbd className="cmd-bar-kbd" aria-hidden="true">
              <span>⌘</span>K
            </kbd>
          )}

          <div
            className="cmd-mode"
            role="group"
            aria-label="Search mode"
          >
            <button
              type="button"
              className={`cmd-mode-btn${!isDeepSearch ? " cmd-mode-btn--on" : ""}`}
              aria-pressed={!isDeepSearch}
              onClick={() => setMode(false)}
              title="Keyword search (full-text)"
            >
              Keyword
            </button>
            <button
              type="button"
              className={`cmd-mode-btn${isDeepSearch ? " cmd-mode-btn--on" : ""}`}
              aria-pressed={isDeepSearch}
              onClick={() => setMode(true)}
              title="Deep search (semantic, pgvector + FTS)"
            >
              Deep AI
            </button>
          </div>
        </div>
      </div>

      {!hasQuery && inputFocused && (
        <div className="cmd-suggest">
          <span className="cmd-suggest-label" aria-hidden="true">Try</span>
          {SEARCH_SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              className="cmd-suggest-pill"
              onMouseDown={(e) => {
                e.preventDefault();
                handleSuggestionClick(s);
              }}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {hasQuery ? (
        <div className="search-results" aria-live="polite">
          {searching && results.length === 0 && (
            <div className="search-loading">
              {[0, 1, 2, 3].map((k) => (
                <div className="search-skeleton-card" key={k}>
                  <div className="search-skeleton-header" />
                  <div className="search-skeleton-line" />
                  <div className="search-skeleton-line search-skeleton-line--short" />
                </div>
              ))}
            </div>
          )}
          {!searching && results.length === 0 && (
            <div className="no-results" role="status">
              <div className="no-results-icon" aria-hidden="true">
                <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
                  <circle cx="22" cy="22" r="14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" opacity="0.35" />
                  <line x1="32" y1="32" x2="42" y2="42" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" opacity="0.35" />
                  <line x1="16" y1="22" x2="28" y2="22" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.25" />
                </svg>
              </div>
              <div className="no-results-title">No matches for &ldquo;{query.trim()}&rdquo;</div>
              <div className="no-results-hint">
                {!isDeepSearch
                  ? "No keyword hits — Deep AI search understands meaning, not just words"
                  : "Try rephrasing or broadening your query"}
              </div>
              <div className="no-results-actions">
                {!isDeepSearch && (
                  <button
                    type="button"
                    className="no-results-deep"
                    onClick={() => {
                      setIsDeepSearch(true);
                      clearTimeout(timerRef.current);
                      timerRef.current = setTimeout(() => doSearch(query), 100);
                    }}
                  >
                    Try Deep AI Search
                  </button>
                )}
                <button type="button" className="no-results-clear" onClick={handleClear}>
                  Clear search
                </button>
              </div>
            </div>
          )}
          {results.map((r, i) => {
            const meta = r.lessonSlug ? lessonLookup.get(r.lessonSlug) : undefined;
            const { href, external } = resolveResultHref(r.lessonSlug, meta?.url);
            return (
              <Link
                key={`${r.resultType}-${r.title}-${i}`}
                href={href}
                target={external ? "_blank" : undefined}
                rel={external ? "noopener noreferrer" : undefined}
                className={`search-result-card${meta ? ` cat-${meta.catSlug}` : ""}${i === focusedIndex ? " search-result-card--focused" : ""}`}
              >
                <span className="search-result-rail" aria-hidden="true" />
                <div className="search-result-header">
                  <span className="badge-pill badge-pill--glass search-result-type">
                    {typeBadgeLabel(r.resultType)}
                  </span>
                  {meta && (
                    <span className="badge-pill badge-pill--category search-result-cat">
                      {meta.icon} {meta.category}
                    </span>
                  )}
                  {meta && (
                    <span className={`article-card-level article-card-level--${meta.difficulty}`}>
                      {meta.difficulty === "beginner" ? "Beginner" : meta.difficulty === "intermediate" ? "Mid" : "Adv"}
                    </span>
                  )}
                  <span className="search-result-title">{r.title}</span>
                </div>
                <div className="search-result-snippet">
                  {highlightSnippet(r.snippet)}
                  {isDeepSearch && "similarity" in r && (r as DeepSearchResult).similarity > 0 && (
                    <span className="search-result-similarity">
                      {((r as DeepSearchResult).similarity * 100).toFixed(0)}% match
                    </span>
                  )}
                </div>
                {r.resultType !== "lesson" && r.lessonTitle && (
                  <div className="search-result-lesson">{r.lessonTitle}</div>
                )}
              </Link>
            );
          })}
        </div>
      ) : (
        <CategoryGrid groups={groups} />
      )}
    </>
  );
}
