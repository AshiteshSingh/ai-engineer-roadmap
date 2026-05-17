---
kind: team
id: team_05
slug: eval-harness
name: Eval Harness Team
status: available
claimed_direction: null
claimed_at: null
size: 2
---

## Archetype
eval-harness

## Roster (roles, not names)
- Lead: eval engineer (DeepEval / GEval authoring, judge prompt design)
- Member: Rust engineer (regression-detector binary + score ledger)

## Core Competencies
- DeepEval test authoring and `conftest.py` aggregate-gate semantics
- Stratified golden construction across categories / chat intents / edge cases
- Regression statistics (pass-rate drop detection, false-positive control)
- Committed per-run JSON score ledger design

## Tools & Access Needed
- DeepSeek key (judge LLM)
- `backend/tests/deepeval` run environment
- `crates/ml` build toolchain (regression detector)

## Default Working Agreement
- Branch `research/eval-harness`, worktree-isolated
- Eval-gate: expanded goldens stably green before ratcheting
  `DEFAULT_AGGREGATE_GATE`
- Detector as a Rust binary under `crates/ml` (not a Python script)
- Atomic targeted commits; orchestrator merges via `gh pr merge --rebase`

## Claim Protocol
1. Read the INDEX.md Teams + target direction file (direction_05).
2. In ONE atomic commit touching `teams/team_05_eval-harness.md`,
   `directions/direction_05_*.md`, and `INDEX.md`: set team `status=claimed` +
   `claimed_direction`, and the direction `status=claimed` + `claimed_by_team` +
   `claimed_at`.
3. Re-read after commit; on conflict, revert and pick the next compatible direction.
4. Move to `status=active` when work begins; `finished` when the PR merges.
   (Soft-coordinate chat cases with team_01 / direction_01.)
