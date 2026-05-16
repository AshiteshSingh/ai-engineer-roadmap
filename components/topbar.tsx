"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { useSession, signOut } from "@/lib/auth-client";
import { isOwner } from "@/lib/owner";
import { useRouter } from "next/navigation";
import { GitHubLogoIcon } from "@radix-ui/react-icons";
import styles from "./topbar.module.css";

function initials(name?: string | null): string {
  if (!name) return "AI";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "AI";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function Topbar({ lessonCount }: { lessonCount?: number }) {
  const { data: session } = useSession();
  const owner = isOwner(session);
  const router = useRouter();
  const [scrolled, setScrolled] = useState(false);
  const [progress, setProgress] = useState(0);
  const [navOpen, setNavOpen] = useState(false);
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

  const pct = Math.round(progress * 100);

  return (
    <nav
      aria-label="Main navigation"
      className={`yc-topbar${scrolled ? " yc-topbar--scrolled" : ""}`}
    >
      {/* ── ZONE 1: brand lockup ─────────────────────────────── */}
      <div className="yc-topbar-brand">
        <Link href="/" className="yc-topbar-brandlink">
          <span className="yc-topbar-logo" aria-hidden="true">
            <span className="yc-topbar-logo-pulse" />
          </span>
          <span className="yc-topbar-wordmark">
            <span className="yc-topbar-wordmark-main">AI ENGINEERING</span>
            <span className="yc-topbar-wordmark-sub">ROADMAP</span>
          </span>
        </Link>
        {lessonCount != null && (
          <span className="yc-topbar-count" aria-label={`${lessonCount} lessons`}>
            <span className="yc-topbar-count-dot" aria-hidden="true" />
            {lessonCount}
            <span className="yc-topbar-count-label"> lessons</span>
          </span>
        )}
      </div>

      {/* ── ZONE 2: centered segmented nav (owner only) ──────── */}
      {owner && (
        <div className="yc-topbar-seg" role="presentation">
          <Link href="/applications" className="yc-topbar-seg-link">
            Applications
          </Link>
          <Link href="/coursework" className="yc-topbar-seg-link">
            Coursework
          </Link>
        </div>
      )}

      {/* ── ZONE 3: identity / actions ───────────────────────── */}
      <div className="yc-topbar-right">
        <a
          href="https://github.com/v9ai/ai-engineer-roadmap"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="View source on GitHub"
          title="GitHub repository"
          className={styles.githubLink}
        >
          <GitHubLogoIcon width={18} height={18} aria-hidden="true" />
        </a>
        {session?.user ? (
          <div className="yc-topbar-user">
            <span className="yc-topbar-id" title={session.user.name ?? undefined}>
              <span className="yc-topbar-avatar" aria-hidden="true">
                {initials(session.user.name)}
              </span>
              <span className="yc-topbar-username">{session.user.name}</span>
            </span>
            <button
              type="button"
              aria-label="Sign out"
              className="yc-topbar-signin yc-topbar-signin--ghost"
              onClick={() => signOut().then(() => router.push("/login"))}
            >
              Sign Out
            </button>
          </div>
        ) : (
          <Link
            href="/login"
            className="yc-topbar-signin yc-topbar-signin--pill yc-topbar-cta"
          >
            Sign In
            <span className="yc-topbar-cta-arrow" aria-hidden="true">
              →
            </span>
          </Link>
        )}
        <button
          type="button"
          aria-label="Open menu"
          aria-expanded={navOpen}
          aria-controls="yc-nav-drawer"
          aria-haspopup="dialog"
          className="yc-nav-hamburger"
          onClick={() => setNavOpen(true)}
        >
          <span className="yc-nav-hamburger-bar" aria-hidden="true" />
          <span className="yc-nav-hamburger-bar" aria-hidden="true" />
          <span className="yc-nav-hamburger-bar" aria-hidden="true" />
        </button>
      </div>

      {/* scroll progress (desktop styled; markup unchanged for mobile) */}
      <div
        className="yc-topbar-progress"
        style={{ transform: `scaleX(${progress})` }}
        role="progressbar"
        aria-label="Reading progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
      />

      {/* ── MOBILE DRAWER (TEAM-A owned styling — DO NOT ALTER) ─ */}
      {navOpen && (
        <div
          className="yc-nav-drawer-backdrop yc-nav-drawer-backdrop--open"
          aria-hidden="true"
          onClick={() => setNavOpen(false)}
        />
      )}
      <div
        id="yc-nav-drawer"
        className={`yc-nav-drawer ${navOpen ? "yc-nav-drawer--open" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label="Navigation menu"
        aria-hidden={!navOpen}
      >
        <div className="yc-nav-drawer-handle" aria-hidden="true" />
        {session?.user ? (
          <>
            <span className="yc-nav-drawer-username">{session.user.name}</span>
            {owner && (
              <>
                <Link
                  href="/applications"
                  className="yc-nav-drawer-link"
                  onClick={() => setNavOpen(false)}
                >
                  Applications
                </Link>
                <Link
                  href="/coursework"
                  className="yc-nav-drawer-link"
                  onClick={() => setNavOpen(false)}
                >
                  Coursework
                </Link>
              </>
            )}
            <button
              type="button"
              aria-label="Sign out"
              className="yc-nav-drawer-link"
              onClick={() => {
                setNavOpen(false);
                signOut().then(() => router.push("/login"));
              }}
            >
              Sign Out
            </button>
          </>
        ) : (
          <Link
            href="/login"
            className="yc-nav-drawer-link"
            onClick={() => setNavOpen(false)}
          >
            Sign In
          </Link>
        )}
      </div>
    </nav>
  );
}
