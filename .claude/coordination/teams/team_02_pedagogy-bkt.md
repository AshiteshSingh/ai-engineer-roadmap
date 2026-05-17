---
kind: team
id: team_02
slug: pedagogy-bkt
name: Pedagogy & BKT Lab
status: available
claimed_direction: null
claimed_at: null
size: 3
---

## Archetype
pedagogy-bkt

## Roster (roles, not names)
- Lead: learning-analytics scientist (BKT / IRT / knowledge tracing)
- Member: Rust engineer (`crates/ml/bkt` EM fitting + eval binary)
- Member: data analyst (AUC / Brier / ECE, reliability diagrams)

## Core Competencies
- BKT parameter fitting via EM; hierarchical shrinkage priors
- Predictive-validity evaluation: held-out AUC, Brier, calibration (ECE)
- `crates/ml/bkt` internals and `lib/bkt.ts` parity
- `interaction_events` replay + synthetic learner generation

## Tools & Access Needed
- DB read (`interaction_events`, `knowledge_states`, `concepts`)
- Neon read branch for replay
- `crates/ml/bkt` build toolchain

## Default Working Agreement
- Branch `research/pedagogy-bkt`, worktree-isolated
- Eval-gate: `pnpm run build` green + Rust `bkt` tests pass
- Fitting/eval as a Rust binary under `crates/ml/bkt` (not a Python script)
- Atomic targeted commits; orchestrator merges via `gh pr merge --rebase`

## Claim Protocol
1. Read the INDEX.md Teams + target direction file (direction_02).
2. In ONE atomic commit touching `teams/team_02_pedagogy-bkt.md`,
   `directions/direction_02_*.md`, and `INDEX.md`: set team `status=claimed` +
   `claimed_direction`, and the direction `status=claimed` + `claimed_by_team` +
   `claimed_at`.
3. Re-read after commit; on conflict, revert and pick the next compatible direction.
4. Move to `status=active` when work begins; `finished` when the PR merges.
   (Note: direction_07 unblocks only when this direction is `completed`.)
