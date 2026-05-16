# UX-Polish Team Loop — Backlog Ledger

Orchestrator-owned. Worktree `ai-engineer-roadmap-ux`, branch `ux-polish`
(off `origin/main` @ 5aae9ec; integrates to `main`). Plan:
`/Users/vadimnicolai/.claude/plans/need-5min-ux-and-eager-pixel.md`.
Team: `ux-polish` (3 persistent agents: ux1, ux2, ux3). 10-min loop.

## Hard rules (every item)

- STRICT no-global-CSS: never edit/create/grow `app/globals.css`,
  `app/styles/*.css`, `components/**/css-memorize.css`; no new global imports.
  All styling via `app/styles/tokens.css` tokens + `components/ui/*` + a NEW
  co-located `*.module.css`. Pre-existing global classes left as-is
  (referenced via `:global()` only when unavoidable).
- JS-queried classes (`scroll-animations.tsx` → `.cat-card`,
  `.hero-stat-number`): keep literal via `:global(.x)` in the module; never
  hash them; never edit the JS selector.
- One component/page + its co-located module per atomic commit.
  `pnpm run build` green before commit. Targeted `git add` only, never `-A`.
- Polish/consistency, NOT redesign. Light Playwright screenshot = no-regression
  gate. Hard gate: `git diff` must touch ZERO global stylesheet lines.
- `components/ui/*` and `app/styles/tokens.css` are REFERENCE ONLY — never edit.
- **VALUE-PRESERVING tokenization (hard rule):** only replace a literal with a
  `--ds-*`/`--text-*`/`--space-*` token if that token's RESOLVED value in
  tokens.css EXACTLY equals the original. If no exact-value token exists, keep
  the literal (commented) — NEVER approximate to the nearest token. Known
  traps: `line-height: 1.7` ≠ `--ds-leading-body` (1.6); `99px` ≠
  `--ds-radius-pill` (999px); `--radius-3`(6px) ≠ `--ds-radius-lg`(12px).
  Orchestrator reconcile MUST value-check new module vars against tokens.css,
  not just run the no-global gate (the gate cannot catch same-file value drift).
- `evals/*` already have co-located modules — skip (DS-clean).

## Tier A — shared components (priority order)

- [ ] components/topbar.tsx
- [ ] components/footer.tsx
- [ ] components/reading-progress.tsx
- [x] components/scroll-to-top.tsx — NO-OP (ux1-4, definitive): pure global-class shell; styling in globals.css:1029-1060/5176/1330 + base.css:56-64 (forbidden); focus-visible already global (globals.css:5665-5676 + base.css:40-46); reduced-motion is per-component-global by codebase convention. Nothing co-locatable. Do not re-pick.
- [x] components/scroll-reveal.tsx — NO-OP (ux2-3): zero co-locatable static styling (only dynamic `--sr-delay` var); all styling is JS-toggled global `.scroll-reveal`/`--visible` classes (can't hash/move without breaking + violating no-global); reduced-motion guard already present ×2 + JS short-circuit; tokens already --ds-* upstream. Nothing actionable. Do not re-pick.
- [ ] components/scroll-animations.tsx
- [ ] components/article-nav.tsx
- [ ] components/related-lessons.tsx
- [ ] components/toc.tsx
- [ ] components/category-progress.tsx
- [ ] components/audio-player.tsx
- [ ] components/markdown-prose.tsx
- [ ] components/search.tsx
- [ ] components/category-grid.tsx
- [x] components/paper-card.tsx — DONE (ux3-3, 4d19617): co-located paper-card.module.css, DS-tokenized, per-commit global gate CLEAN (0 lines). On ux-polish lane.
- [x] components/external-courses.tsx — NO-OP (ux2-4): 100% shared global contract classes (course-*/badge-pill, reused by `.lg-course-card` — can't hash/move); only style is a dynamic verdict color; colors already Radix semantic tokens; a:focus-visible already global. Nothing co-locatable. Do not re-pick.
- [x] components/langgraph-extra.tsx — DONE (ux3-4, 9d984b0): co-located langgraph-extra.module.css, DS-tokenized, per-commit global gate CLEAN (0 lines). On ux-polish lane.
- [ ] components/page-analytics.tsx
- [x] components/app-detail/ApplicationHeader.tsx — DONE (ux1-5, 19be462): co-located ApplicationHeader.module.css, static inline → module (dynamic status color via CSS var), gate CLEAN (0 global). On lane.
- [x] components/app-detail/CollapsibleSection.tsx — DONE (ux2-5, 921ee2b): co-located CollapsibleSection.module.css, static inline → module, gate CLEAN (0 global). On lane.
- [x] components/app-detail/CompanyTab.tsx — DONE (ux1-6, 62b92ff): 6 inline → co-located module, value-preserving tokens, dynamic signal width via CSS var, Radix scale kept raw. Gate CLEAN.
- [x] components/app-detail/DebriefTab.tsx — NO-OP (ux2-6): pure config pass-through wrapper around <NotesPanel>, no markup/styling/className of its own. Nothing co-locatable. Do not re-pick.
- [x] components/app-detail/InterviewPrepTab.tsx — DONE (ux1-7, 51427ac): co-located module; orchestrator value-verified all token swaps exact (--ds-hairline-subtle=1px gray-4, --ds-text=gray-11, --ds-surface-hover=gray-2, --ds-surface-sub=gray-3, --space-3=12, --space-1=4); correctly kept violet/radius/font-size/padding-20 literal. Gate CLEAN + value-exact. (Also cross-flagged JobDescriptionTab drifts — good catch.)
- [x] components/app-detail/JobDescriptionTab.tsx — DONE (ux3-6, d55d42d) + FIXES (38251ad, 990febf): ux3-6 introduced THREE value drifts (caught by orchestrator value-check + ux1-7 cross-flag): line-height 1.7→--ds-leading-body(1.6) [fixed 38251ad]; --violet-11→--accent-11 (violet≠indigo accent, color change) + paddingLeft 20→--space-5(24px) [fixed 990febf]. Now gate-clean AND value-exact. Lesson: agents over-eagerly "tokenize" to nearest token — value-check is essential.
- [x] components/app-detail/NotesPanel.tsx — DONE (ux2-7, 5a87b91): value-verified — 1.6→--ds-leading-body(exact 1.6), 1.7/1.8 kept literal, grays→exact --ds-* aliases. Gate CLEAN + value-exact (agent correctly handled the leading-body trap).
- [ ] components/app-detail/NotesTab.tsx
- [x] components/app-detail/TechStackTab.tsx — DONE (ux3-7, c1efb69): co-located module, ZERO --ds-/--text-/--space- token swaps (no value-drift possible), gate CLEAN. Value-safe by construction.
- [ ] components/app-detail/StudyRoadmap.tsx (+ remaining app-detail/* tsx)
- [~] components/memorize/* (14 tsx) — DONE: MemorizeDashboard (ef4c48e), FlashcardDeck (3dcb286, value-exact --space-4=16px; auto/1fr literal), memorize/ProgressBar (16d4388, value-safe — 0 token swaps, dynamic width via CSS var). NO-OP: TimedDrill (ux2-8 — all .drill-* css-memorize globals, only Radix display:block API shims; no a11y gap). FillInTheBlank (d7328f5, value-safe — 0 swaps, --violet-3/--radius-1/--font-mono kept raw), PropertyExplorer (b7bf0c4, value-EXACT — 1 swap marginBottom:12→--space-3=12px verified exact; display:block literal; .flashcard-hint kept via cx. NB: orchestrator's first vars-grep raced the fetch and falsely showed 0 swaps — agent's token→value report caught it; re-verify authoritative). NO-OP: VisualMatcher (ux2-9 — zero inline; 100% .matcher-*/.memorize-* css-memorize globals; Radix props only; no a11y gap). ~7 memorize/* tsx still open.
- [ ] components/roadmap-graph/* (4 tsx)
- [ ] components/mermaid-flow/* (2 tsx)
- [ ] components/xyflow-direct/index.tsx
- [ ] components/problems/* (1 tsx)

## Tier B — page UX polish (after Tier A; lower priority)

- [ ] app/**/page.tsx (32 routes) — spacing rhythm / hierarchy / hover-focus /
  reduced-motion / responsive, token-only, one route per item.

## Status

| Agent | Current item | Status |
|-------|--------------|--------|
| ux1 | — | spawning |
| ux2 | — | spawning |
| ux3 | — | spawning |

## Tick log

- setup — ux-polish worktree @ 5aae9ec (off origin/main), node_modules linked,
  upstream set, ledger created. globals.css baseline = 4263 lines (must not change).
- Prior verified work (footer a11y c803785 + reading-progress 3f27312) lives on
  origin/ux-polish-salvage → PR #14 (user merges at will). topbar = NO-OP.
- tick (cron 87e07ee0, lane=origin/main 6ce8f0d): paper-card DONE 4d19617
  (gate-clean) ✓; scroll-reveal NO-OP ✓; scroll-to-top UNRESOLVED — ux1-3 idled
  with no commit/report → loop re-picks next tick. Lane = main + paper-card.
