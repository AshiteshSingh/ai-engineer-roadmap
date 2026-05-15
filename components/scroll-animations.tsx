"use client";

import { useEffect } from "react";

/**
 * Global scroll-triggered animations:
 *  1. IntersectionObserver adds `.in-view` to `.cat-card` elements on scroll
 *  2. Count-up animation on `.hero-stat-number` elements when they enter the viewport
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
      return;
    }

    /* ---- 1. Scroll-triggered fade-up for category cards ---- */
    const cardObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            (entry.target as HTMLElement).classList.add("in-view");
            cardObserver.unobserve(entry.target); // animate once
          }
        }
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

    return () => {
      cardObserver.disconnect();
      statObserver.disconnect();
    };
  }, []);

  return null; // pure side-effect component
}
