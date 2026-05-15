"use client";

import { useEffect, useRef, useState } from "react";

function easeOutExpo(t: number): number {
  return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
}

function useCountUp(target: number, duration: number, started: boolean) {
  const [value, setValue] = useState(0);

  useEffect(() => {
    if (!started) return;
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

  return (
    <div className="hero-stats" ref={ref}>
      <div className="hero-stat">
        <span className="hero-stat-number">{lessons}</span>
        <span className="hero-stat-label">Lessons</span>
      </div>
      <div className="hero-stat">
        <span className="hero-stat-number">{domains}</span>
        <span className="hero-stat-label">Skill Areas</span>
      </div>
      <div className="hero-stat">
        <span className="hero-stat-number">{hours}h</span>
        <span className="hero-stat-label">Reading Time</span>
      </div>
      <div className="hero-stat">
        <span className="hero-stat-number">{animatedWordLabel}</span>
        <span className="hero-stat-label">Words</span>
      </div>
    </div>
  );
}
