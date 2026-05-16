# UX-Polish Team Loop — Backlog Ledger

Orchestrator-owned. Worktree `ai-engineer-roadmap-ux`, branch `ux-polish`
(thin tracking lane). Plan:
`/Users/vadimnicolai/.claude/plans/need-5min-ux-and-eager-pixel.md`.
3 disjoint background general-purpose agents (ux1/ux2/ux3) per 10-min tick.

## Lane model — DIRECT-TO-MAIN (user directive 2026-05-16)

- Agents commit to the `ux-polish` lane in the shared worktree (the bare
  submodule has `main` checked out, so the worktree cannot check out `main`).
- Orchestrator runs the gates (no-global + VALUE-CHECK) on every new sha,
  THEN pushes the lane to `main` directly: `git push origin ux-polish:main`
  fast-forward-only. Reject (main raced) → `git fetch` + `git rebase
  origin/main` + retry. **NEVER force-push main.** Rebase conflict (stale
  granular history vs a squashed main) → reset lane to `origin/main`,
  re-apply only the genuinely-unmerged source delta, re-gate, push.
- No PR step (PR #16 squash-merged the prior lane to main; user wants
  commits direct on main). Nothing is deployed by the loop.
- Per-tick safety snapshot: `git push origin HEAD:refs/heads/
  ux-polish-salvage-<ts>` before any reset (cheap insurance).
- The value-check gate stays BEFORE main — direct-to-main skips the PR
  *merge* step, NOT the gate (the gate caught real JobDescriptionTab drifts).

## Hard rules (every item)

- STRICT no-global-CSS: never edit/create/grow `app/globals.css`,
  `app/styles/*.css`, `components/**/css-memorize.css`, `app/layout.tsx`;
  no new global imports. Styling via `app/styles/tokens.css` tokens +
  `components/ui/*` + a NEW co-located `*.module.css`. Pre-existing global
  classes left as-is (referenced via `:global()` only when unavoidable).
- JS-queried classes (`scroll-animations.tsx` → `.cat-card`,
  `.hero-stat-number`): keep literal via `:global(.x)`; never hash; never
  edit the JS selector.
- One component/page + its co-located module per atomic commit.
  `pnpm run build` green before commit. Targeted `git add`, never `-A`.
- Polish/consistency, NOT redesign. `components/ui/*` + `tokens.css` are
  REFERENCE ONLY — never edit.
- **VALUE-PRESERVING (hard):** only replace a literal with a
  `--ds-*`/`--text-*`/`--space-*` token if that token's RESOLVED value in
  tokens.css EXACTLY equals the original; else keep the literal (commented).
  NEVER approximate to nearest token. Traps: `line-height 1.7` ≠
  `--ds-leading-body`(1.6); `99px` ≠ `--ds-radius-pill`(999px);
  `--radius-3`(6px) ≠ `--ds-radius-lg`(12px); `20px` ≠ `--space-5`(24px);
  Radix `--accent`/`--violet`/`--gray-N` kept raw unless an exact `--ds-*`
  alias. Orchestrator value-checks every sha (the no-global gate cannot
  catch same-file value drift).
- `evals/*` already co-located — skip (DS-clean).

## Tier A — shared components

- [x] components/topbar.tsx — NO-OP (prior: pure global-class shell).
- [x] components/footer.tsx — DONE on main (globals migration PR + #16).
- [x] components/reading-progress.tsx — DONE on main (#12 t1 migration).
- [x] components/scroll-to-top.tsx — NO-OP (ux1-4 definitive): pure global-class shell; styling forbidden globals; focus-visible/reduced-motion already global by codebase convention. Do not re-pick.
- [x] components/scroll-reveal.tsx — NO-OP (ux2-3): only dynamic `--sr-delay`; all styling JS-toggled global classes; reduced-motion guard already present. Do not re-pick.
- [x] components/scroll-animations.tsx — NO-OP (ux1-12): JS-observer; only toggles global `.cat-card`/`.hero-stat-number` classes (JS-queried, must stay literal); no co-locatable static styling. Do not re-pick.
- [x] components/article-nav.tsx — DONE on main (globals migration).
- [x] components/related-lessons.tsx — DONE on main (globals migration).
- [x] components/toc.tsx — DONE on main (globals migration).
- [x] components/category-progress.tsx — DONE on main (globals migration).
- [x] components/audio-player.tsx — DONE on main (globals migration).
- [x] components/markdown-prose.tsx — NO-OP (ux2-12): no commit produced; markdown prose styled by global `.prose`/`.markdown-*` stylesheet, no co-locatable static inline styling, no a11y gap. Do not re-pick.
- [x] components/search.tsx — NO-OP (ux3-12 definitive): zero inline `style=`; 100% global classes (cmd-bar/cmd-search/cmd-suggest/cmd-filter/search-result-card, globals.css ~L1201–5024) that are runtime-toggled/JS-queried (forbidden to migrate); a11y already complete (aria-label/role/aria-pressed/aria-live/keyboard nav). Do not re-pick.
- [ ] components/category-grid.tsx
- [x] components/paper-card.tsx — DONE (4d19617, gate-clean) → on main.
- [x] components/external-courses.tsx — NO-OP (ux2-4): 100% shared global contract classes; only dynamic verdict color; colors already Radix tokens. Do not re-pick.
- [x] components/langgraph-extra.tsx — DONE (9d984b0, gate-clean) → on main.
- [x] components/page-analytics.tsx — NO-OP (ux2-13): no commit produced; side-effect/tracking component, no rendered UI / co-locatable static styling, no a11y gap. Do not re-pick.
- [x] components/app-detail/ApplicationHeader.tsx — DONE (19be462) → main.
- [x] components/app-detail/CollapsibleSection.tsx — DONE (921ee2b) → main.
- [x] components/app-detail/CompanyTab.tsx — DONE (62b92ff) → main.
- [x] components/app-detail/DebriefTab.tsx — NO-OP (ux2-6): config pass-through wrapper, no markup/styling of its own. Do not re-pick.
- [x] components/app-detail/InterviewPrepTab.tsx — DONE (51427ac, value-verified exact) → main.
- [x] components/app-detail/JobDescriptionTab.tsx — DONE (d55d42d) + value-fixes (38251ad, 990febf): 3 drifts caught+fixed; now gate-clean AND value-exact → main.
- [x] components/app-detail/NotesPanel.tsx — DONE (5a87b91, value-verified) → main.
- [ ] components/app-detail/NotesTab.tsx
- [x] components/app-detail/TechStackTab.tsx — DONE (c1efb69, 0 token swaps) → main.
- [ ] components/app-detail/StudyRoadmap.tsx
- [x] components/memorize/* — **TIER COMPLETE (all 14 accounted).** DONE: MemorizeDashboard (ef4c48e), FlashcardDeck (3dcb286, --space-4=16px exact), ProgressBar (16d4388, 0 swaps), FillInTheBlank (d7328f5, 0 swaps), PropertyExplorer (b7bf0c4, --space-3=12px exact), **DueForReview (af32a1b — value-EXACT: `padding:"4px 0"`→`var(--space-1) 0`, --space-1=4px exact; flex/minWidth literal; global due-review-* kept literal)**, **ModeTip (af32a1b — value-safe: only `.fill{flex:1}`/`.citation{font-style:italic}`, 0 tokens; global mode-tip/mode-tip-dismiss kept literal)**, **PreSessionCheckIn (2247d5f — value-EXACT: `marginBottom:16`→`var(--space-4)`, --space-4=16px exact; display:block literal; global session-checkin-* kept literal)**, **LearningScienceSidebar (873298b — value-EXACT: `marginBottom:12`→`--space-3`(12px), `marginTop:4`→`--space-1`(4px); kept literal w/ comments: font-size:20px, line-height:1.5, display:block, flex:1; global science-* kept literal)**, **PostSessionSummary (873298b — value-EXACT: `marginBottom:12`→`--space-3`(12px); display:block literal; global session-summary-* kept literal)**. NO-OP: TimedDrill (ux2-8), VisualMatcher (ux2-9), **LearningInsights (ux2-10: produced nothing — pure global-class component, no co-locatable styling; do not re-pick)**.
- [ ] components/roadmap-graph/index.tsx
- [ ] components/roadmap-graph/nodes.tsx
- [ ] components/mermaid-flow/index.tsx
- [ ] components/mermaid-flow/nodes.tsx
- [ ] components/xyflow-direct/index.tsx
- [ ] components/problems/problem-workspace.tsx

## Tier B — page UX polish (after Tier A)

- [ ] app/**/page.tsx (32 routes) — spacing rhythm / hierarchy / hover-focus
  / reduced-motion / responsive, token-only, one route per item.

## Status

| Agent | Current item | Status |
|-------|--------------|--------|
| ux1-13 | components/category-grid.tsx | spawning |
| ux2-13 | components/page-analytics.tsx | spawning |
| ux3-13 | components/app-detail/NotesTab.tsx | spawning |
| ux2-12 | components/markdown-prose.tsx | in flight (no commit yet) |
| ux3-12 | components/search.tsx | in flight (no commit yet) |

## Tick log

- **tick (reconcile + LANE REALIGN):** ux2-12 markdown-prose, ux2-13
  page-analytics, ux3-12 search → all NO-OP (no commits; global-class /
  side-effect, a11y complete). KEY FIX: `origin/ux-polish` was stuck at
  stale divergent `86a417b` (granular tail vs squashed main) — every agent
  `git push -q` FF'd onto that old graph, forcing a reset+reapply recovery
  each tick. Verified `origin/ux-polish` had ZERO source not on main, then
  force-realigned the **disposable lane pointer** to `origin/main`
  (`737cb7d`; salvage `-1237`/`-1242` preserve old graph; `main` NOT
  force-pushed). Future agent pushes now FF cleanly → no more per-tick
  recovery. ux1-13/ux3-13 (category-grid/NotesTab) still in flight.
- **tick (direct-to-main):** LearningScienceSidebar + PostSessionSummary
  DONE on main `873298b` (both value-EXACT `marginBottom:12`→`--space-3`
  12px; LSS also `marginTop:4`→`--space-1` 4px; literals 20px/1.5 kept w/
  comments; no-global gate=0). ux2-11 sent no DONE but its `d14d448`
  PostSessionSummary commit was clean+value-exact (orchestrator-verified).
  scroll-animations = **NO-OP** (ux1-12, JS-observer, absent on lane).
  **memorize/* tier COMPLETE (14/14).** Recovery: agents' commits were on
  origin/ux-polish (stale granular tail) — snapshot
  `ux-polish-salvage-20260516-1242`, verified net delta = LSS+PSS 4 files,
  reset to origin/main, re-apply, gate, FF-push. ux2-12/ux3-12
  (markdown-prose/search) still in flight — not re-spawned. Spawned 3
  non-colliding: category-grid, page-analytics, app-detail/NotesTab.
- **tick (direct-to-main):** PreSessionCheckIn DONE on main `2247d5f`
  (value-EXACT `marginBottom:16`→`--space-4`=16px; no-global gate=0).
  Same stale-granular-vs-squashed conflict on rebase → proven recovery
  (snapshot `ux-polish-salvage-20260516-1237`, verified only-delta=
  PreSessionCheckIn, reset to origin/main, re-apply, gate, FF-push to main).
  ux2-11/ux3-11 (PostSessionSummary/LearningScienceSidebar) produced no
  lane commit (slow / scratch wiped by per-tick clean) — left OPEN, not
  re-spawned this tick to avoid same-file collision with possibly-live
  agents. Spawned 3 non-colliding: scroll-animations, markdown-prose,
  search.
- **tick (DIRECT-TO-MAIN switch + reconcile):** user directed
  "commit directly on main". PR #16 "Ux polish" squash-merged the prior
  lane → `main` (all migrated modules + stale early ledger on main). Rebase
  of 31 granular lane commits onto squashed main conflicted on a
  ledger-only commit (98bb92f). Resolution (non-destructive): pushed safety
  snapshot `origin/ux-polish-salvage-20260516-1229`, verified the only
  non-ledger lane delta vs main = DueForReview + ModeTip, `git reset --hard
  origin/main`, re-applied just those 4 files, built green, gated, pushed
  `ux-polish:main` (FF-only; raced once → fetch+rebase+retry, no force) =>
  on main as af32a1b (now 8312ff8). Both value-checked: DueForReview
  `4px 0`→`--space-1`(4px) EXACT; ModeTip 0 tokens. Reconciled ledger
  against squashed main (7 Tier-A + 7 app-detail + 7 memorize auto-DONE).
- setup — ux-polish worktree off origin/main, node_modules linked, ledger.
- Prior salvage: footer a11y + reading-progress live on
  origin/ux-polish-salvage / merged via globals PRs + #16.
