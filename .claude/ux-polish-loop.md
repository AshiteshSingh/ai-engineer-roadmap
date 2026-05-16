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
- `evals/*` already have co-located modules — skip (DS-clean).

## Tier A — shared components (priority order)

- [ ] components/topbar.tsx
- [ ] components/footer.tsx
- [ ] components/reading-progress.tsx
- [ ] components/scroll-to-top.tsx
- [ ] components/scroll-reveal.tsx
- [ ] components/scroll-animations.tsx
- [ ] components/article-nav.tsx
- [ ] components/related-lessons.tsx
- [ ] components/toc.tsx
- [ ] components/category-progress.tsx
- [ ] components/audio-player.tsx
- [ ] components/markdown-prose.tsx
- [ ] components/search.tsx
- [ ] components/category-grid.tsx
- [ ] components/paper-card.tsx
- [ ] components/external-courses.tsx
- [ ] components/langgraph-extra.tsx
- [ ] components/page-analytics.tsx
- [ ] components/app-detail/ApplicationHeader.tsx
- [ ] components/app-detail/CollapsibleSection.tsx
- [ ] components/app-detail/CompanyTab.tsx
- [ ] components/app-detail/DebriefTab.tsx
- [ ] components/app-detail/InterviewPrepTab.tsx
- [ ] components/app-detail/JobDescriptionTab.tsx
- [ ] components/app-detail/NotesPanel.tsx
- [ ] components/app-detail/NotesTab.tsx
- [ ] components/app-detail/TechStackTab.tsx
- [ ] components/app-detail/StudyRoadmap.tsx (+ remaining app-detail/* tsx)
- [ ] components/memorize/* (14 tsx — one sub-item per file, MemorizeDashboard first)
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
