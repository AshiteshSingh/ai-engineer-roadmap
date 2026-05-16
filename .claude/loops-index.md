# Loops — ai-engineer-roadmap (status index)

> **Human reference only.** The bare-`/loop` default prompt is
> [`.claude/loop.md`](./loop.md) — do **not** put status tables there; that file
> is executed verbatim as a maintenance prompt. This file is the glue/index.

Index of every `/loop`-driven workstream on this repo: purpose, branch/worktree,
ledger, and current status. Per-loop detail lives in the linked ledger; this file
is the glue. Last reconciled: **2026-05-16**.

> This repo is a **git submodule** of `ai-apps` with a committed `.next/` and
> **no Tailwind**. Branches switch under long agent runs — always operate loops
> from an **isolated worktree**, never the primary tree. Loops never deploy;
> deploy is manual (`pnpm run build`, see `vercel-buildcommand-fix` memory).

## Loop status

| Loop | Branch / Worktree | Ledger / Plan | Status |
|------|-------------------|---------------|--------|
| **content-quality** | `content-gate-loop` / `ai-engineer-roadmap-cloop` (also `content-loop`) | memory `content-quality-loop-complete` | **DONE** — all 71 AI lessons pass the quality gate; merged via **PR #23** (`7a40fa8`). Local `main` ref stale → use `origin/main`. |
| **design-system** (page rubric) | `design-system-loop` / `ai-engineer-roadmap-ds` | [`.claude/design-system-loop.md`](./design-system-loop.md) · plan `need-5min-ux-and-eager-pixel.md` | **COMPLETE** — all 33 pages `[x]` (page rubric applied; many ledger-only NO-OP ticks). |
| **ds-globals** (globals→module cascade) | `ds-globals-t1..t5` / `ai-engineer-roadmap-ds-t1..t5` (+ `-ds-t5-base`) | memory `ds-globals-t5-deferred`, `ds-globals-cascade-constraint`, `ds-globals-parity-gate-lesson`, `ds-globals-prs-vs-redesign` | **RESOLVED / DEFERRED** — t5 domain done (tip `665c36b`); 4 groups deferred (runtime-selector / cross-route / cross-domain). All PRs resolved (#6/#12 merged, #13/#11 closed-superseded, #14 footer-a11y → `8312ff8`). |
| **ux-polish** | `ux-polish` / `ai-engineer-roadmap-ux` | [`.claude/ux-polish-loop.md`](./ux-polish-loop.md) · plan `need-5min-ux-and-eager-pixel.md` | **WOUND DOWN** (2026-05-16, user-directed) — Tier-A complete, merged **PR #21** (`origin/main 1e074ee`); cron `45f9199e` deleted; lane realigned `== main`. Tier-B (32 routes) deferred (already DS-migrated). |
| **homepage** | `homepage-polish` / `ai-engineer-roadmap-homepage` | memory `homepage-redesign-status` | **LANDED / LIVE** — hero removed; redesign-minus-hero consolidated on `main` (`64b5d15`, deployed). |

No `/loop` crons are active in the current session. Crons are session-scoped and
managed per-loop via the `/loop` skill (or `/schedule`); to resume a wound-down
loop, re-create its cron with that ledger's tick procedure.

## Lane model (shared) — LANE-ACCUMULATE + PR-MERGE

Guard-forced 2026-05-16. Applies to every loop that lands on `main`.

- A safety guard **BLOCKS direct pushes to `main`** (even a plain FF). Do **not**
  retry or circumvent it. The earlier DIRECT-TO-MAIN model is dead.
- Agents commit to the loop's **lane branch** in its dedicated worktree. The bare
  submodule has `main` checked out and is volatile/dirty on feature branches —
  **never checkout/merge `main` there**.
- Orchestrator runs the gates on every new sha; value-checked commits
  **ACCUMULATE** on `origin/<lane>`.
- **Land on main via GitHub PR only** (server-side, guard doesn't apply):
  `gh pr create --base main --head <lane> …` then `gh pr merge <n> --rebase`.
- **After a merge:** confirm `git diff origin/main..origin/<lane> -- . ':(exclude).claude/<lane>.md'`
  is EMPTY, then realign the **disposable lane pointer**:
  `git reset --hard origin/main && git push -f origin <lane>`. This is the **only**
  sanctioned force-push and it targets the throwaway lane — **never `main`**.
  Salvage refs `<lane>-salvage-<ts>` preserve old graphs.
- The **VALUE-CHECK gate stays BEFORE the PR** (it has caught real same-file
  value drifts the no-global gate cannot see).

## Gates / hard rules (every tick, every loop)

1. **STRICT no-global-CSS** — never edit/create/grow `app/globals.css`,
   `app/styles/*.css`, `components/**/css-memorize.css`, `app/layout.tsx`; add
   **no** new global imports. Style via `app/styles/tokens.css` tokens +
   `components/ui/*` + a **new co-located `*.module.css`**. Pre-existing global
   classes left as-is (`:global()` only when unavoidable). JS-queried classes
   (`.cat-card`, `.hero-stat-number`) stay literal — never hash, never edit the
   JS selector.
2. **VALUE-PRESERVING token swaps** — only replace a literal with a
   `--ds-*`/`--text-*`/`--space-*` token if the token's *resolved* value in
   `tokens.css` is **exactly** equal. Never approximate to nearest. Traps:
   `line-height 1.7 ≠ --ds-leading-body (1.6)`, `99px ≠ --ds-radius-pill (999px)`,
   `--radius-3 (6px) ≠ --ds-radius-lg (12px)`, `20px ≠ --space-5 (24px)`.
   `components/ui/*` and `tokens.css` are **reference-only — never edit**.
3. **Build green** — `pnpm run build` (exactly that — **never a turbo filter**;
   see `vercel-buildcommand-fix` memory) must pass before commit; fix new TS/lint.
4. **Atomic** — one page/component + its co-located module per commit; **targeted
   `git add`, never `-A`**. The DeepSeek hooks server reverts partial multi-file
   edits and auto-commits at Stop, so each file change must be self-contained
   (see `hooks-server-edit-behavior` memory).
5. **Nothing deploys** from a loop. Deploy stays manual.

## How to run a tick (generic)

1. From the loop's **worktree** (never the primary tree), take the **first
   unchecked** item in its ledger.
2. Apply that loop's rubric to **only** that item's file + a co-located
   `*.module.css`.
3. `pnpm run build` green.
4. Value-check every token swap (gate 2). `git add` the touched files only,
   commit, push the **lane** branch.
5. Check the box and append a one-line entry to the ledger's tick log.
6. To land: accumulate on the lane, then PR-merge per the lane model above.

## Adding a new loop

1. Create a dedicated worktree + lane branch off `origin/main`
   (`ai-engineer-roadmap-<x>` / `<x>-loop`); link `node_modules`.
2. Add `.claude/<x>-loop.md` (rubric + checklist + tick log) and a row in this
   table.
3. Drive it with the `/loop` skill or `/schedule`; gates/pipelines that need
   real logic are **Rust crates/bins** under `crates/ml` or `crates/udemy`, not
   ad-hoc Python (see `feedback-loop-tooling-rust` memory).
4. Land via LANE-ACCUMULATE + PR-MERGE.

## Related memory

`ai-engineer-roadmap-ops` · `deploy-architecture` · `agent-worktree-stale-base` ·
`v9ai-submodule-pointer-staleness` · `vercel-buildcommand-fix` ·
`hooks-server-edit-behavior` · `feedback-loop-tooling-rust` ·
`ux-loop-direct-to-main` · `content-quality-loop-complete` ·
`design-system-loop-status` · `homepage-redesign-status`
