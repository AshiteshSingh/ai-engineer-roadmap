import { useEffect, useRef } from "react";
import { trackEvent } from "./track";

export function usePageAnalytics(lessonSlug: string) {
  const startRef = useRef(Date.now());
  const milestonesRef = useRef(new Set<number>());

  useEffect(() => {
    startRef.current = Date.now();
    milestonesRef.current.clear();

    // Fire page_view
    trackEvent("page_view", lessonSlug);

    // Scroll milestones via IntersectionObserver
    const milestones = [25, 50, 75, 100];
    const sentinels: HTMLDivElement[] = [];
    const articleGrid = document.querySelector(".article-grid > div:first-child");
    if (!articleGrid) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const pct = Number(entry.target.getAttribute("data-milestone"));
          if (pct && !milestonesRef.current.has(pct)) {
            milestonesRef.current.add(pct);
            trackEvent("read_progress", lessonSlug, { percent: pct });
          }
        }
      },
      { threshold: 0 },
    );

    for (const pct of milestones) {
      const el = document.createElement("div");
      el.setAttribute("data-milestone", String(pct));
      el.style.height = "1px";
      el.style.pointerEvents = "none";
      // Insert at percentage of content height
      const totalHeight = articleGrid.scrollHeight;
      const position = (pct / 100) * totalHeight;
      el.style.position = "absolute";
      el.style.top = `${position}px`;
      el.style.left = "0";
      el.style.right = "0";
      (articleGrid as HTMLElement).style.position = "relative";
      articleGrid.appendChild(el);
      sentinels.push(el);
      observer.observe(el);
    }

    // Time on page
    function sendTimeOnPage() {
      const duration = Date.now() - startRef.current;
      trackEvent("time_on_page", lessonSlug, { duration_ms: duration });
    }

    window.addEventListener("beforeunload", sendTimeOnPage);

    return () => {
      observer.disconnect();
      for (const el of sentinels) el.remove();
      window.removeEventListener("beforeunload", sendTimeOnPage);
      sendTimeOnPage();
    };
  }, [lessonSlug]);
}
