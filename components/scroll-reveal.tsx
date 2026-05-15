"use client";
import { useRef, useEffect, useState } from "react";

interface Props {
  children: React.ReactNode;
  className?: string;
  /** Base entrance delay in ms (applied via --sr-delay). */
  delay?: number;
  /**
   * Stagger step in ms. When set together with `index`, the effective
   * delay becomes `delay + index * stagger`, producing a cohesive
   * cascade across sibling sections without per-call hand-tuning.
   */
  stagger?: number;
  /** Position in a staggered group (0-based). */
  index?: number;
}

/**
 * Reveal-on-scroll primitive.
 *
 * - IntersectionObserver with a sensible threshold + bottom rootMargin so
 *   the reveal fires slightly before the block is fully on screen.
 * - Once-only: disconnects after the first intersection (no re-trigger,
 *   no thrash on scroll-back).
 * - GPU-friendly: animates opacity + translateY only. `will-change` is
 *   applied only while pending and cleared once visible to avoid keeping
 *   the element on its own layer indefinitely.
 * - Reduced motion is handled globally in CSS (.scroll-reveal neutralized
 *   under prefers-reduced-motion); we additionally short-circuit to the
 *   visible state so no transition is ever scheduled.
 * - SSR-safe: starts hidden, reveals on mount; if IO is unavailable the
 *   element is shown immediately.
 */
export function ScrollReveal({
  children,
  className = "",
  delay = 0,
  stagger = 0,
  index = 0,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  const effectiveDelay = delay + (stagger > 0 ? index * stagger : 0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Respect reduced-motion at the JS layer too: never schedule a reveal.
    const prefersReduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (prefersReduced || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      // Fire when ~12% is shown, biased to start a touch before the
      // block reaches the fold for a smoother perceived entrance.
      { threshold: 0.12, rootMargin: "0px 0px -64px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`scroll-reveal ${visible ? "scroll-reveal--visible" : ""} ${className}`}
      style={
        effectiveDelay
          ? ({ "--sr-delay": `${effectiveDelay}ms` } as React.CSSProperties)
          : undefined
      }
    >
      {children}
    </div>
  );
}
