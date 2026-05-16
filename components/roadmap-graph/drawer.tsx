"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui";
import type { LessonLookup } from "./lesson-lookup";
import type { NodeStatus } from "@/lib/roadmap-progress";
import { navigateToHref } from "./navigate";

interface Props {
  selectedId: string | null;
  lookup: LessonLookup;
  statusOf: (id: string) => NodeStatus;
  setStatus: (id: string, status: NodeStatus) => void;
  onClose: () => void;
}

const STATUS_OPTIONS: Array<{ value: NodeStatus; label: string }> = [
  { value: "done", label: "Mark done" },
  { value: "in-progress", label: "In progress" },
  { value: "skipped", label: "Skip" },
];

export function RoadmapDrawer({
  selectedId,
  lookup,
  statusOf,
  setStatus,
  onClose,
}: Props) {
  const open = selectedId != null;
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const detail = selectedId ? lookup[selectedId] : undefined;

  // Portal out of the graph subtree: ancestors use CSS transforms
  // (.roadmap-flow, ScrollReveal) which would otherwise make our
  // position:fixed overlay positioned relative to them, not the viewport.
  // Target the Radix theme root (not <body>) so design tokens
  // (--gray-*, --ds-*) still resolve; it has no transformed ancestors.
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setHost(
      (document.querySelector(".radix-themes") as HTMLElement | null) ??
        document.body,
    );
  }, []);

  // Esc to close + focus trap while open.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;
      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'a[href],button:not([disabled]),[tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [open, onClose]);

  // Focus management + body scroll lock.
  useEffect(() => {
    if (open) {
      restoreFocusRef.current = document.activeElement as HTMLElement | null;
      const prevOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      const t = window.setTimeout(() => {
        panelRef.current
          ?.querySelector<HTMLElement>(".rg-drawer__close")
          ?.focus();
      }, 30);
      return () => {
        window.clearTimeout(t);
        document.body.style.overflow = prevOverflow;
        restoreFocusRef.current?.focus?.();
      };
    }
  }, [open]);

  const go = useCallback(
    (href: string) => {
      onClose();
      // Let the drawer-close transition start before scrolling/navigating.
      window.setTimeout(() => navigateToHref(href), 60);
    },
    [onClose],
  );

  const titleId = "rg-drawer-title";

  function renderBody() {
    if (!detail) return null;

    if (detail.kind === "lesson") {
      const cur = selectedId ? statusOf(selectedId) : "todo";
      return (
        <>
          <span className="rg-drawer__eyebrow">{detail.groupTitle}</span>
          <h2 id={titleId} className="rg-drawer__title">
            {detail.title}
          </h2>
          <div className="rg-drawer__meta">
            <span className="rg-drawer__pill">Lesson #{detail.number}</span>
            <span className="rg-drawer__pill">{detail.readingTimeMin} min</span>
            <span className="rg-drawer__pill">{detail.difficulty}</span>
          </div>
          {detail.excerpt && (
            <p className="rg-drawer__excerpt">{detail.excerpt}</p>
          )}
          <Button variant="primary" onClick={() => go(detail.url)}>
            Open lesson →
          </Button>
          <div className="rg-drawer__section">
            <span className="rg-drawer__section-label">Your progress</span>
            <div className="rg-drawer__segmented" role="group" aria-label="Lesson status">
              {STATUS_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  className={`rg-drawer__seg ${
                    cur === o.value ? "rg-drawer__seg--active" : ""
                  }`}
                  aria-pressed={cur === o.value}
                  onClick={() =>
                    selectedId &&
                    setStatus(
                      selectedId,
                      cur === o.value ? "todo" : o.value,
                    )
                  }
                >
                  {o.label}
                </button>
              ))}
            </div>
            {cur !== "todo" && (
              <button
                type="button"
                className="rg-drawer__clear"
                onClick={() => selectedId && setStatus(selectedId, "todo")}
              >
                Clear status
              </button>
            )}
          </div>
        </>
      );
    }

    if (detail.kind === "phase" || detail.kind === "appendix") {
      const doneInGroup = detail.lessonIds.filter(
        (lid) => statusOf(lid) === "done",
      ).length;
      return (
        <>
          {detail.phaseLabel && (
            <span className="rg-drawer__eyebrow">{detail.phaseLabel}</span>
          )}
          <h2 id={titleId} className="rg-drawer__title">
            {detail.icon} {detail.title}
          </h2>
          <div className="rg-drawer__meta">
            <span className="rg-drawer__pill">
              {detail.lessonCount} lesson{detail.lessonCount !== 1 ? "s" : ""}
            </span>
            <span className="rg-drawer__pill">{detail.totalMinutes} min</span>
            <span className="rg-drawer__pill">{detail.difficultyHint}</span>
          </div>
          <p className="rg-drawer__excerpt">{detail.description}</p>
          {detail.outcomes.length > 0 && (
            <div className="rg-drawer__section">
              <span className="rg-drawer__section-label">
                What you&apos;ll be able to do
              </span>
              <ul className="rg-drawer__outcomes">
                {detail.outcomes.map((o) => (
                  <li key={o}>{o}</li>
                ))}
              </ul>
            </div>
          )}
          <p className="rg-drawer__group-progress">
            {doneInGroup} / {detail.lessonCount} lesson
            {detail.lessonCount !== 1 ? "s" : ""} done in this section
          </p>
          <Button variant="primary" onClick={() => go(detail.href)}>
            Jump to section →
          </Button>
        </>
      );
    }

    // entry / ship marker
    if (detail.kind === "entry" || detail.kind === "ship") {
      return (
        <>
          <h2 id={titleId} className="rg-drawer__title">
            {detail.title}
          </h2>
          <p className="rg-drawer__excerpt">{detail.blurb}</p>
          <Button variant="primary" onClick={() => go(detail.href)}>
            Jump to lessons →
          </Button>
        </>
      );
    }

    return null;
  }

  if (!host) return null;

  return createPortal(
    <>
      <div
        className={`rg-drawer-backdrop ${open ? "rg-drawer-backdrop--open" : ""}`}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        className={`rg-drawer ${open ? "rg-drawer--open" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-hidden={open ? undefined : true}
      >
        <span className="rg-drawer__handle" aria-hidden="true" />
        <button
          type="button"
          className="rg-drawer__close"
          aria-label="Close"
          onClick={onClose}
        >
          ✕
        </button>
        <div className="rg-drawer__content">{renderBody()}</div>
      </div>
    </>,
    host,
  );
}
