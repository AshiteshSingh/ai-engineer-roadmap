# UX-Polish Team Loop — Backlog Ledger

Orchestrator-owned. Worktree `ai-engineer-roadmap-ux`, branch `ux-polish`
(thin tracking lane). Plan:
`/Users/vadimnicolai/.claude/plans/need-5min-ux-and-eager-pixel.md`.
3 disjoint background general-purpose agents (ux1/ux2/ux3) per 10-min tick.

## Lane model — LANE-ACCUMULATE + PR-MERGE (guard-forced 2026-05-16)

- A safety guard now BLOCKS direct pushes to main (`git push origin
  ux-polish:main` → "Force push to main branch is not allowed", even for a
  plain FF). Do NOT retry/circumvent it. The earlier DIRECT-TO-MAIN model
  is dead.
- Agents commit to the `ux-polish` lane in the shared worktree (bare
  submodule has `main` checked out + is volatile/dirty on other feature
  branches — never checkout/merge `main` there). Orchestrator runs the
  gates (no-global + VALUE-CHECK) on every new sha; value-checked commits
  ACCUMULATE on `origin/ux-polish`.
- To land on main: open a GitHub PR and merge it (server-side, NOT a local
  push, so the guard doesn't apply): `gh pr create --base main --head
  ux-polish …` then `gh pr merge <n> --rebase`. Verified working (PR #20,
  3d5db2c). User authorized merges ("Accumulate on lane, you merge" +
  "fix all conflicts and merge").
- After a merge: confirm `git diff origin/main..origin/ux-polish -- . ':
  (exclude).claude/ux-polish-loop.md'` is EMPTY, then force-realign the
  **disposable lane pointer** to main: `git reset --hard origin/main &&
  git push -f origin ux-polish` (ONLY sanctioned force-push; targets the
  throwaway lane, NEVER `main`). Salvage refs `ux-polish-salvage-<ts>`
  preserve old graphs.
- The VALUE-CHECK gate stays BEFORE the PR — it caught real
  JobDescriptionTab/DueForReview drifts. Nothing is deployed by the loop.

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
- [x] components/category-grid.tsx — NO-OP (ux1-13 definitive): 100% global `.cat-*`/`.bento-grid` classes (globals.css, reference-only); zero inline `style=`; only dynamic cursor-tracking `--cat-mx` (runtime, not co-locatable); `.cat-card` JS-queried by scroll-animations; a11y + reduced-motion already complete. Do not re-pick.
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
- [x] components/app-detail/NotesTab.tsx — NO-OP (ux3-13 silent-idle; orchestrator-verified): pure config pass-through wrapper around `<NotesPanel>` (which is already DONE 5a87b91) — zero markup/className/inline styling of its own (identical to DebriefTab). Do not re-pick.
- [x] components/app-detail/TechStackTab.tsx — DONE (c1efb69, 0 token swaps) → main.
- [x] components/app-detail/StudyRoadmap.tsx — NO-OP (ux1-14 silent-idle; orchestrator-verified): only inline style is `style={{ height }}` (runtime-computed React-Flow container height — dynamic, must stay inline); all visual chrome via global `.roadmap-container`. Nothing static co-locatable. Do not re-pick.
- [x] components/memorize/* — **TIER COMPLETE (all 14 accounted).** DONE: MemorizeDashboard (ef4c48e), FlashcardDeck (3dcb286, --space-4=16px exact), ProgressBar (16d4388, 0 swaps), FillInTheBlank (d7328f5, 0 swaps), PropertyExplorer (b7bf0c4, --space-3=12px exact), **DueForReview (af32a1b — value-EXACT: `padding:"4px 0"`→`var(--space-1) 0`, --space-1=4px exact; flex/minWidth literal; global due-review-* kept literal)**, **ModeTip (af32a1b — value-safe: only `.fill{flex:1}`/`.citation{font-style:italic}`, 0 tokens; global mode-tip/mode-tip-dismiss kept literal)**, **PreSessionCheckIn (2247d5f — value-EXACT: `marginBottom:16`→`var(--space-4)`, --space-4=16px exact; display:block literal; global session-checkin-* kept literal)**, **LearningScienceSidebar (873298b — value-EXACT: `marginBottom:12`→`--space-3`(12px), `marginTop:4`→`--space-1`(4px); kept literal w/ comments: font-size:20px, line-height:1.5, display:block, flex:1; global science-* kept literal)**, **PostSessionSummary (873298b — value-EXACT: `marginBottom:12`→`--space-3`(12px); display:block literal; global session-summary-* kept literal)**. NO-OP: TimedDrill (ux2-8), VisualMatcher (ux2-9), **LearningInsights (ux2-10: produced nothing — pure global-class component, no co-locatable styling; do not re-pick)**.
- [x] components/roadmap-graph/index.tsx — NO-OP (ux2-14 silent-idle; orchestrator-verified): only inline style is dynamic CSS-var passthrough `style={{ "--graph-h": `${graphH}px` }}` (runtime value — sanctioned dynamic pattern); chrome via global `.mermaid-flow-container` + library `.react-flow*`. Nothing static co-locatable. Do not re-pick.
- [ ] components/roadmap-graph/nodes.tsx
- [x] components/mermaid-flow/index.tsx — NO-OP (ux3-14 silent-idle; orchestrator-verified): only inline style is `style={{ height: result.height }}` (runtime mermaid-render height — dynamic, must stay inline); global `.mermaid-flow-container` + library SVG. Nothing static co-locatable. Do not re-pick.
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

- **GUARD + MERGE (user: "fix all conflicts and merge"):** safety guard
  began blocking `git push origin ux-polish:main` mid-session. No
  conflicts existed — `main` was a clean ancestor, lane only 1 ledger
  commit ahead. Merged via GitHub PR #20 (`gh pr merge --rebase`,
  server-side — guard is local-push-only) → origin/main `4601daa`→
  `3d5db2c`. Realigned disposable lane pointer to `3d5db2c`. Model →
  LANE-ACCUMULATE + PR-MERGE (see Lane model section). User chose
  "Accumulate on lane, you merge".
- **tick (reconcile):** ux1-14 StudyRoadmap / ux2-14 roadmap-graph/index /
  ux3-14 mermaid-flow/index → all NO-OP. All silent-idled (no rationale);
  orchestrator-verified each has exactly 1 inline style and it is
  dynamic/functional (runtime height / CSS-var passthrough — must stay
  inline; React-Flow/mermaid container case). Lane aligned (`4601daa`),
  clean FF, no recovery. Backlog now: roadmap-graph/nodes,
  mermaid-flow/nodes, xyflow-direct, problems/problem-workspace, then
  Tier-B pages.
- **tick (reconcile):** ux1-13 category-grid → NO-OP (100% global,
  JS-queried, a11y complete). ux3-13 NotesTab silent-idled → orchestrator
  verified it's a pure `<NotesPanel>` config pass-through (NotesPanel
  already DONE) → NO-OP. Lane stayed aligned (`f67341d`) — realignment
  holding, clean FF, no recovery. Spawned ux1-14 StudyRoadmap / ux2-14
  roadmap-graph/index / ux3-14 mermaid-flow/index (in flight).
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
