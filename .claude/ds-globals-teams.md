# globals.css Migration — 5-Team Coordination Ledger

Orchestrator-owned tracking doc (branch `design-system-loop`, worktree
`ai-engineer-roadmap-ds`). Teams do **not** edit this — they report via commits
+ SendMessage; the orchestrator updates status here. Plan:
`/Users/vadimnicolai/.claude/plans/need-5min-ux-and-eager-pixel.md`.

Base: all team branches `ds-globals-t{1..5}` forked from `design-system-loop`
@ `55d892a`. Integration branch `ds-globals` created at first merge.

## Rules (all teams)

- Behavior-preserving MOVE, not redesign. Playwright parity vs `/` + own routes.
- Only delete OWNED `globals.css` ranges; re-confirm exact banner boundaries in
  your worktree before cutting. One cascade chain → one owner.
- Do NOT touch: `tokens.css`, `base.css`, `app/layout.tsx`, HP-10 cohesion
  (`globals.css` ~6488-6606), `resume.css`, other teams' ranges,
  `app/**/page.tsx` (loop already did pages — only touch if it inlines a class
  you're migrating).
- Targeted commits only (component + new module + globals.css), never
  `git add -A`. `pnpm run build` green before each commit + push to your branch.
- Uncertain on a homepage/HP-TEAM block → SendMessage the orchestrator and
  DEFER that block rather than risk a live regression.

## Status

| Team | Domain | Worktree | Branch | Status |
|------|--------|----------|--------|--------|
| T1 | Shell & chrome (topbar+HP2, footer+HP7, reading-progress, scroll-to-top, mobile-TOC, TEAM-A nav, HP9 a11y) | `ai-engineer-roadmap-ds-t1` | `ds-globals-t1` | spawning |
| T2 | Home (hero+HP1, learning-path+HP3, research+HP5) | `ai-engineer-roadmap-ds-t2` | `ds-globals-t2` | spawning |
| T3 | Search/cards/discovery (HP6 + legacy search/filter/bento/cat-card, search-results, no-results) | `ai-engineer-roadmap-ds-t3` | `ds-globals-t3` | spawning |
| T4 | Article reading & media (banner, nav, toc, related, audio, category-progress, markdown.css, third-party.css, HP8 keyframes→motion.css) | `ai-engineer-roadmap-ds-t4` | `ds-globals-t4` | spawning |
| T5 | App-section pages (not-found, app-detail, courses, se-*, scroll-reveal, cw-*, lg-*, prep, css-memorize.css) | `ai-engineer-roadmap-ds-t5` | `ds-globals-t5` | spawning |

## Merge log

(orchestrator: serialized merges into `ds-globals`, then HP-10 reconcile, then
full verification + PR)

## PLAN CORRECTION (2026-05-16)

Original plan's premise was WRONG: it assumed globals.css = 6,608 lines with
HP-TEAM regions + legacy↔HP cascade chains. That was measured from
`homepage-polish` (6,519 lines, 31 HP-TEAM banners) because the volatile
`apps/ai-engineer-roadmap` submodule had branch-switched during plan-time
exploration. **Actual `design-system-loop`@55d892a globals.css = 4,263 lines,
ZERO HP-TEAM structure, already DS-tokenized** (253 residual raw gray/hex).

Teams (t2/t3/t4 esp.) correctly refused to guess and t2 **empirically proved**
naive move+delete regresses the LIVE site: scattered responsive `@media`
overrides are bare single-class (spec 0,1,0) and lose to the CSS-Module class
by source order. JS coupling: `scroll-animations.tsx` queries `.cat-card`/
`.hero-stat-number`.

User decision: **continue the migration** — via the CORRECTED behavior-
preserving technique below (not naive move+delete):

1. Move ALL of an owned class's rules into its module — base AND every
   responsive `@media` override, including surgically lifted from shared/
   managed `@media` blocks (own selectors only).
2. JS-coupled classes: keep literal name via `:global(.x){…}` in the module;
   never hash JS-queried classes; don't edit `scroll-animations.tsx`.
3. `app/**/page.tsx` className strings MAY now be minimally edited for migrated
   classes. base.css ancestor rules handled via `:global()` + specificity.
4. Keyframes → one shared `app/styles/motion.css` (t4-owned).
5. **MANDATORY parity gate**: Playwright 1280/768/390 screenshot+
   getComputedStyle vs clean 55d892a baseline before EVERY commit; ~0 diff or
   fix/revert. t2 owns the baseline harness, shared to all.
6. Nothing reaches prod until orchestrator integration + full parity sweep +
   explicit user approval. Live site stays on the just-deployed state.

## Tick / event log

- setup — 5 worktrees @ 55d892a, node_modules symlinked, upstreams set, ledger created.
- correction — premise-mismatch surfaced by teams; HOLD broadcast; user chose continue; all 5 re-briefed with corrected `:global()`+relocate-@media+parity-gate technique. t1 pushed 86c5ea7/a5c931d, t5 pushed 9af8b1d — flagged for parity re-verification (possible leftover @media regression).
