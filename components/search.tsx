"use client";

import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { GroupedLessons, DifficultyLevel } from "@/lib/articles";
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

const DIFFICULTY_FILTERS: { value: DifficultyLevel | "all"; label: string }[] = [
  { value: "all", label: "All Levels" },
  { value: "beginner", label: "Beginner" },
  { value: "intermediate", label: "Intermediate" },
  { value: "advanced", label: "Advanced" },
];

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
  const [diffFilter, setDiffFilter] = useState<DifficultyLevel | "all">("all");
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

  const filteredGroups = useMemo(() => {
    if (diffFilter === "all") return groups;
    return groups
      .map((g) => ({
        ...g,
        articles: g.articles.filter((a) => a.difficulty === diffFilter),
      }))
      .filter((g) => g.articles.length > 0);
  }, [groups, diffFilter]);

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
      router.push(meta?.url ?? `/${r.lessonSlug}`);
    }
  }

  const hasQuery = query.trim().length >= 2;

  return (
    <>
      <div className="yc-search">
        <input
          ref={inputRef}
          type="text"
          aria-label="Search lessons"
          placeholder={isDeepSearch ? "Deep search with AI embeddings..." : "Search lessons, topics, concepts..."}
          value={query}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => setInputFocused(true)}
          onBlur={() => setInputFocused(false)}
        />
        <button
          className={`yc-search-mode${isDeepSearch ? " yc-search-mode--active" : ""}`}
          onClick={() => {
            setIsDeepSearch((v) => !v);
            if (query.trim().length >= 2) {
              clearTimeout(timerRef.current);
              timerRef.current = setTimeout(() => doSearch(query), 100);
            }
          }}
          title={isDeepSearch ? "Deep search (pgvector + FTS)" : "Keyword search (FTS only)"}
        >
          {isDeepSearch ? "Deep" : "FTS"}
        </button>
        {!hasQuery && <span className="yc-search-hint">⌘K</span>}
        {hasQuery && results.length > 0 && (
          <span className="yc-search-count">{results.length}</span>
        )}
        {query.length > 0 && (
          <button className="yc-search-clear" aria-label="Clear search" onClick={handleClear}>
            ✕
          </button>
        )}
      </div>

      {!hasQuery && inputFocused && (
        <div className="search-suggestions">
          {SEARCH_SUGGESTIONS.map((s) => (
            <button
              key={s}
              className="search-suggestion-pill"
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

      {!hasQuery && (
        <div className="difficulty-filter">
          {DIFFICULTY_FILTERS.map((f) => (
            <button
              key={f.value}
              className={`difficulty-filter-btn${f.value !== "all" ? ` difficulty-filter-btn--${f.value}` : ""}${diffFilter === f.value ? " difficulty-filter-btn--active" : ""}`}
              aria-pressed={diffFilter === f.value}
              onClick={() => setDiffFilter(f.value)}
            >
              {f.label}
              {f.value !== "all" && (
                <span className="difficulty-filter-count">
                  {groups.reduce((sum, g) => sum + g.articles.filter((a) => a.difficulty === f.value).length, 0)}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {hasQuery ? (
        <div className="search-results" aria-live="polite">
          {searching && results.length === 0 && (
            <div className="search-loading">
              <div className="search-skeleton-card">
                <div className="search-skeleton-header" />
                <div className="search-skeleton-line" />
                <div className="search-skeleton-line search-skeleton-line--short" />
              </div>
              <div className="search-skeleton-card">
                <div className="search-skeleton-header" />
                <div className="search-skeleton-line" />
                <div className="search-skeleton-line search-skeleton-line--short" />
              </div>
              <div className="search-skeleton-card">
                <div className="search-skeleton-header" />
                <div className="search-skeleton-line" />
                <div className="search-skeleton-line search-skeleton-line--short" />
              </div>
              <div className="search-skeleton-card">
                <div className="search-skeleton-header" />
                <div className="search-skeleton-line" />
                <div className="search-skeleton-line search-skeleton-line--short" />
              </div>
            </div>
          )}
          {!searching && results.length === 0 && (
            <div className="no-results" role="status">
              <div className="no-results-icon">
                <svg width="48" height="48" viewBox="0 0 48 48" fill="none" aria-hidden="true">
                  <circle cx="22" cy="22" r="14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" opacity="0.35" />
                  <line x1="32" y1="32" x2="42" y2="42" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" opacity="0.35" />
                  <line x1="16" y1="22" x2="28" y2="22" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.25" />
                </svg>
              </div>
              <div className="no-results-title">Nothing matched your search</div>
              <div className="no-results-hint">
                {!isDeepSearch
                  ? "No keyword hits — Deep search understands meaning, not just words"
                  : "Try rephrasing or broadening your query"}
              </div>
              {!isDeepSearch && (
                <button
                  className="yc-search-mode yc-search-mode--inline"
                  onClick={() => {
                    setIsDeepSearch(true);
                    clearTimeout(timerRef.current);
                    timerRef.current = setTimeout(() => doSearch(query), 100);
                  }}
                >
                  Try Deep Search
                </button>
              )}
              <button className="no-results-clear" onClick={handleClear}>
                Clear search
              </button>
            </div>
          )}
          {results.map((r, i) => {
            const meta = r.lessonSlug ? lessonLookup.get(r.lessonSlug) : undefined;
            return (
              <Link
                key={`${r.resultType}-${r.title}-${i}`}
                href={meta?.url ?? `/${r.lessonSlug}`}
                className={`search-result-card${meta ? ` cat-${meta.catSlug}` : ""}${i === focusedIndex ? " search-result-card--focused" : ""}`}
              >
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
        <CategoryGrid groups={filteredGroups} />
      )}
    </>
  );
}
