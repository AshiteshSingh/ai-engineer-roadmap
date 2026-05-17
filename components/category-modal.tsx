"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import Link from "next/link";
import { Dialog } from "@radix-ui/themes";
import type { GroupedLessons } from "@/lib/articles";
import styles from "./category-modal.module.css";

interface CategoryModalApi {
  open: (slug: string) => void;
  close: () => void;
}

const Ctx = createContext<CategoryModalApi | null>(null);

const NOOP_API: CategoryModalApi = { open: () => {}, close: () => {} };

/** Returns the modal API, or a no-op fallback when rendered outside a
 * <CategoryModalProvider> (e.g. the shared Footer on non-homepage routes,
 * where there is no roadmap grid to preview). */
export function useCategoryModal(): CategoryModalApi {
  return useContext(Ctx) ?? NOOP_API;
}

function diffLabel(d: string): string {
  return d === "beginner" ? "Beginner" : d === "intermediate" ? "Mid" : "Adv";
}

function CategoryModalBody({
  group,
  onClose,
}: {
  group: GroupedLessons;
  onClose: () => void;
}) {
  const totalMin = Math.round(
    group.articles.reduce((s, a) => s + a.readingTimeMin, 0),
  );
  const [from, to] = group.meta.gradient;
  const first = group.articles[0];

  return (
    <div
      className={styles.body}
      style={
        {
          ["--cat-from" as string]: from,
          ["--cat-to" as string]: to,
        } as React.CSSProperties
      }
    >
      <header className={styles.head}>
        <span className={styles.icon} aria-hidden="true">
          {group.meta.icon}
        </span>
        <div className={styles.headText}>
          <Dialog.Title className={styles.title}>
            {group.category}
          </Dialog.Title>
          <Dialog.Description className={styles.stats}>
            {group.articles.length} lesson
            {group.articles.length !== 1 ? "s" : ""} &middot; {totalMin} min
            total
          </Dialog.Description>
        </div>
      </header>

      <p className={styles.desc}>{group.meta.description}</p>

      {group.meta.outcomes && group.meta.outcomes.length > 0 && (
        <ul className={styles.outcomes}>
          {group.meta.outcomes.map((o, i) => (
            <li key={i}>{o}</li>
          ))}
        </ul>
      )}

      <div className={styles.listWrap}>
        <ol className={styles.list}>
          {group.articles.map((l, i) => (
            <li key={l.slug} className={styles.row}>
              <span className={styles.rowNum} aria-hidden="true">
                {String(i + 1).padStart(2, "0")}
              </span>
              <Link
                href={l.url}
                className={styles.rowLink}
                onClick={onClose}
                title={l.excerpt || undefined}
              >
                <span className={styles.rowTitle}>{l.title}</span>
                <span className={styles.rowMeta}>
                  {diffLabel(l.difficulty)} &middot; {l.readingTimeMin}m
                </span>
              </Link>
            </li>
          ))}
        </ol>
      </div>

      <footer className={styles.footer}>
        <Dialog.Close>
          <button type="button" className={styles.secondary}>
            Close
          </button>
        </Dialog.Close>
        {first && (
          <Link href={first.url} className={styles.cta} onClick={onClose}>
            Start with lesson 01
            <span aria-hidden="true"> &rarr;</span>
          </Link>
        )}
      </footer>
    </div>
  );
}

export function CategoryModalProvider({
  groups,
  children,
}: {
  groups: GroupedLessons[];
  children: React.ReactNode;
}) {
  const [openSlug, setOpenSlug] = useState<string | null>(null);

  const bySlug = useMemo(() => {
    const m = new Map<string, GroupedLessons>();
    for (const g of groups) m.set(g.meta.slug, g);
    return m;
  }, [groups]);

  const close = useCallback(() => setOpenSlug(null), []);

  const api = useMemo<CategoryModalApi>(
    () => ({
      open: (slug) => {
        if (bySlug.has(slug)) setOpenSlug(slug);
      },
      close: () => setOpenSlug(null),
    }),
    [bySlug],
  );

  const group = openSlug ? bySlug.get(openSlug) ?? null : null;

  return (
    <Ctx.Provider value={api}>
      {children}
      <Dialog.Root
        open={group !== null}
        onOpenChange={(v) => {
          if (!v) setOpenSlug(null);
        }}
      >
        <Dialog.Content maxWidth="640px" className={styles.content}>
          {group && <CategoryModalBody group={group} onClose={close} />}
        </Dialog.Content>
      </Dialog.Root>
    </Ctx.Provider>
  );
}

export function CategoryModalTrigger({
  slug,
  className,
  children,
  as = "a",
}: {
  slug: string;
  className?: string;
  children: React.ReactNode;
  as?: "a" | "button";
}) {
  // Raw context: null when outside a provider (shared Footer on non-home
  // routes) — fall back to native /#cat-<slug> navigation, the original
  // cross-page behavior.
  const ctx = useContext(Ctx);
  const href = `/#cat-${slug}`;

  const handleClick = (e: React.MouseEvent) => {
    if (!ctx) return; // no provider → let the browser follow href
    if (as === "a") {
      if (e.defaultPrevented) return;
      if (
        e.metaKey ||
        e.ctrlKey ||
        e.shiftKey ||
        e.altKey ||
        e.button === 1
      ) {
        return; // let the browser follow href (deep-link / new tab)
      }
      e.preventDefault();
    }
    ctx.open(slug);
  };

  if (as === "button") {
    return (
      <button type="button" className={className} onClick={handleClick}>
        {children}
      </button>
    );
  }

  return (
    <a href={href} className={className} onClick={handleClick}>
      {children}
    </a>
  );
}
