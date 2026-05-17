---
kind: team
id: team_09
slug: observability-cost
name: Observability & Cost Crew
status: available
claimed_direction: null
claimed_at: null
size: 3
---

## Archetype
observability-cost

## Roster (roles, not names)
- Lead: observability engineer (distributed tracing, trace-ID propagation)
- Member: backend engineer (FastAPI middleware, LangGraph state threading)
- Member: Rust engineer (cost-attribution report binary)

## Core Competencies
- End-to-end trace-ID injection: Next.js → `/runs/wait` → DeepSeek
- FastAPI Bearer middleware + LangGraph state plumbing
- Per-node token/cost capture and reconciliation vs the DeepSeek bill
- Doc-drift correction (`AsyncCloudflareD1Saver` vs README)

## Tools & Access Needed
- LangGraph container / local backend run
- DeepSeek key + billing reference for reconciliation
- `crates/ml` build toolchain (cost-report binary)

## Default Working Agreement
- Branch `research/observability-cost`, worktree-isolated
- Eval-gate: `pnpm run build` green + no behavior change to graph outputs
- Cost-report tooling as a Rust binary under `crates/ml`
- Atomic targeted commits; orchestrator merges via `gh pr merge --rebase`

## Claim Protocol
1. Read the INDEX.md Teams + target direction file (direction_09).
2. In ONE atomic commit touching `teams/team_09_observability-cost.md`,
   `directions/direction_09_*.md`, and `INDEX.md`: set team `status=claimed` +
   `claimed_direction`, and the direction `status=claimed` + `claimed_by_team` +
   `claimed_at`.
3. Re-read after commit; on conflict, revert and pick the next compatible direction.
4. Move to `status=active` when work begins; `finished` when the PR merges.
