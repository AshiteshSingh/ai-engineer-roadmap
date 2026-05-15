"use client";

import { useEffect, useRef, useState } from "react";

function easeOutExpo(t: number): number {
  return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function useCountUp(target: number, duration: number, started: boolean) {
  const [value, setValue] = useState(0);

  useEffect(() => {
    if (!started) return;
    if (prefersReducedMotion()) {
      setValue(target);
      return;
    }
    let raf: number;
    const start = performance.now();

    function tick(now: number) {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      setValue(Math.round(easeOutExpo(progress) * target));
      if (progress < 1) raf = requestAnimationFrame(tick);
    }

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration, started]);

  return value;
}

export function AnimatedStats({
  lessonCount,
  domainCount,
  readingHours,
  wordLabel,
  wordCount,
}: {
  lessonCount: number;
  domainCount: number;
  readingHours: number;
  wordLabel: string;
  wordCount: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.3 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const duration = 1500;
  const lessons = useCountUp(lessonCount, duration, visible);
  const domains = useCountUp(domainCount, duration, visible);
  const hours = useCountUp(readingHours, duration, visible);
  const wordsRaw = useCountUp(wordCount, duration, visible);
  const animatedWordLabel =
    wordCount >= 1000 ? `${Math.round(wordsRaw / 1000)}K+` : String(wordsRaw);

  const rows = [
    {
      key: "lessons",
      value: String(lessons),
      label: "Lessons",
      ratio: lessonCount ? lessons / lessonCount : 0,
    },
    {
      key: "domains",
      value: String(domains),
      label: "Skill Areas",
      ratio: domainCount ? domains / domainCount : 0,
    },
    {
      key: "hours",
      value: `${hours}h`,
      label: "Reading Time",
      ratio: readingHours ? hours / readingHours : 0,
    },
    {
      key: "words",
      value: animatedWordLabel,
      label: "Words",
      ratio: wordCount ? wordsRaw / wordCount : 0,
    },
  ];

  return (
    <div
      className={`hx-ledger${visible ? " is-live" : ""}`}
      ref={ref}
      role="list"
    >
      {rows.map((r) => (
        <div className="hx-row" role="listitem" key={r.key}>
          <div className="hx-row-top">
            <span className="hx-row-value">{r.value}</span>
            <span className="hx-row-label">{r.label}</span>
          </div>
          <div className="hx-row-track" aria-hidden="true">
            <span
              className="hx-row-fill"
              style={{
                transform: `scaleX(${Math.max(
                  0.04,
                  Math.min(1, r.ratio),
                )})`,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
