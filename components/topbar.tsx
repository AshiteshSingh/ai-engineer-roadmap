"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { useSession, signOut } from "@/lib/auth-client";
import { useRouter } from "next/navigation";

export function Topbar({ lessonCount }: { lessonCount?: number }) {
  const { data: session } = useSession();
  const router = useRouter();
  const [scrolled, setScrolled] = useState(false);
  const [progress, setProgress] = useState(0);
  const rafRef = useRef(0);

  const onScroll = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      setScrolled(window.scrollY > 20);
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      setProgress(docHeight > 0 ? Math.min(window.scrollY / docHeight, 1) : 0);
      rafRef.current = 0;
    });
  }, []);

  useEffect(() => {
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [onScroll]);

  return (
    <nav aria-label="Main navigation" className={`yc-topbar${scrolled ? " yc-topbar--scrolled" : ""}`}>
      <Link href="/">
        <span className="yc-topbar-logo" />
        AI ENGINEERING
      </Link>
      {lessonCount != null && (
        <span className="yc-topbar-count">{lessonCount} lessons</span>
      )}
      <div className="yc-topbar-right">
        {session?.user ? (
          <div className="yc-topbar-user">
            <Link href="/applications" className="yc-topbar-signin">
              Applications
            </Link>
            <Link href="/coursework" className="yc-topbar-signin">
              Coursework
            </Link>
            <span className="yc-topbar-username">{session.user.name}</span>
            <button
              type="button"
              aria-label="Sign out"
              className="yc-topbar-signin"
              onClick={() => signOut().then(() => router.push("/login"))}
            >
              Sign Out
            </button>
          </div>
        ) : (
          <Link href="/login" className="yc-topbar-signin yc-topbar-signin--pill">
            Sign In
          </Link>
        )}
      </div>
      <div
        className="yc-topbar-progress"
        style={{ transform: `scaleX(${progress})` }}
        aria-hidden="true"
      />
    </nav>
  );
}
