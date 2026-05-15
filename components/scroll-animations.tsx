"use client";

import { useEffect } from "react";

/**
 * Global scroll-triggered animations:
 *  1. IntersectionObserver adds `.in-view` to `.cat-card` elements on scroll,
 *     setting a per-row `--cc-stagger` index so CSS can cascade the entrance.
 *  2. Count-up animation on `.hero-stat-number` elements when they enter.
 *  3. A single passive scroll listener that publishes page scroll progress
 *     (0..1) to `--scroll-progress` on <html> for subtle CSS-driven accents
 *     (e.g. a top progress bar). Pure custom-property write — no layout,
 *     no per-frame style of many nodes; rAF-coalesced and GPU-friendly.
 *
 * Respects `prefers-reduced-motion` — skips all JS-driven animation when set.
 */
export function ScrollAnimations() {
  useEffect(() => {
    /* Mark <html> so CSS knows JS is active — enables scroll-triggered hide/reveal.
       Without this class, cards remain visible (no-JS fallback). */
    document.documentElement.classList.add("js-ready");

    const prefersReduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    if (prefersReduced) {
      // Immediately reveal all cards and show final stat values
      document
        .querySelectorAll<HTMLElement>(".cat-card")
        .forEach((el) => el.classList.add("in-view"));
      document.documentElement.style.setProperty("--scroll-progress", "0");
      return;
    }

    /* ---- 1. Scroll-triggered fade-up for category cards (staggered) ---- */
    const cardObserver = new IntersectionObserver(
      (entries) => {
        // Sort intersecting entries by document order so a group entering
        // together cascades top-to-bottom rather than in observer order.
        const hits = entries
          .filter((e) => e.isIntersecting)
          .sort(
            (a, b) =>
              (a.target as HTMLElement).offsetTop -
              (b.target as HTMLElement).offsetTop,
          );
        hits.forEach((entry, i) => {
          const el = entry.target as HTMLElement;
          // Cap the stagger index so a large group never feels slow.
          el.style.setProperty("--cc-stagger", String(Math.min(i, 5)));
          el.classList.add("in-view");
          cardObserver.unobserve(el); // animate once
        });
      },
      { rootMargin: "0px 0px -60px 0px", threshold: 0.08 },
    );

    document.querySelectorAll(".cat-card").forEach((el) => {
      cardObserver.observe(el);
    });

    /* ---- 2. Count-up animation for hero stat numbers ---- */
    const DURATION_MS = 1200;
    const EASE = (t: number) => 1 - Math.pow(1 - t, 3); // ease-out cubic

    function animateCountUp(el: HTMLElement, finalText: string) {
      // Parse the numeric portion (e.g. "42", "108K+", "12h")
      const match = finalText.match(/^([\d,]+)/);
      if (!match) return; // non-numeric like "108K+" — handled below

      const suffix = finalText.slice(match[0].length); // "h", "K+", ""
      const target = parseInt(match[1].replace(/,/g, ""), 10);
      if (isNaN(target) || target === 0) return;

      const start = performance.now();
      el.textContent = "0" + suffix;

      function tick(now: number) {
        const elapsed = now - start;
        const progress = Math.min(elapsed / DURATION_MS, 1);
        const current = Math.round(EASE(progress) * target);
        el.textContent = current + suffix;
        if (progress < 1) requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    }

    const statEls = document.querySelectorAll<HTMLElement>(".hero-stat-number");
    // Store original text before we zero them
    const originals = new Map<HTMLElement, string>();
    statEls.forEach((el) => originals.set(el, el.textContent || ""));

    const statObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const el = entry.target as HTMLElement;
            const finalText = originals.get(el) || "";
            animateCountUp(el, finalText);
            statObserver.unobserve(el);
          }
        }
      },
      { threshold: 0.5 },
    );

    statEls.forEach((el) => statObserver.observe(el));

    /* ---- 3. Scroll progress accent (rAF-coalesced, passive) ---- */
    const root = document.documentElement;
    let ticking = false;
    let lastProgress = -1;

    function writeProgress() {
      ticking = false;
      const max = root.scrollHeight - root.clientHeight;
      const p = max > 0 ? Math.min(Math.max(window.scrollY / max, 0), 1) : 0;
      // Quantize to avoid redundant style writes on sub-pixel scroll.
      const q = Math.round(p * 1000) / 1000;
      if (q !== lastProgress) {
        lastProgress = q;
        root.style.setProperty("--scroll-progress", String(q));
      }
    }

    function onScroll() {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(writeProgress);
      }
    }

    writeProgress();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });

    return () => {
      cardObserver.disconnect();
      statObserver.disconnect();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  return null; // pure side-effect component
}
