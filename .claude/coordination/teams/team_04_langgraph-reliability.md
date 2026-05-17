---
kind: team
id: team_04
slug: langgraph-reliability
name: LangGraph Reliability Crew
status: available
claimed_direction: null
claimed_at: null
size: 3
---

## Archetype
langgraph-reliability

## Roster (roles, not names)
- Lead: LangGraph engineer (conditional loops, checkpointing internals)
- Member: backend engineer (retry/backoff, DeepSeek failure modes)
- Member: performance engineer (token + latency instrumentation)

## Core Competencies
- `article_generate_graph.py` node/loop structure and `_after_revise()` routing
- `check_quality()` rule analysis and convergence measurement
- Structured retry/backoff in `backend/knowledge_agent/llm.py`
- Per-node token + p95 latency telemetry

## Tools & Access Needed
- LangGraph container / local backend run
- DeepSeek key (generation batch)
- DB read (checkpointer / `lessons` for batch inputs)

## Default Working Agreement
- Branch `research/langgraph-reliability`, worktree-isolated
- Eval-gate: `pnpm run build` green + article DeepEval golden not regressed
- Batch tooling as a Rust crate under `crates/ml` where logic is non-trivial
- Atomic targeted commits; orchestrator merges via `gh pr merge --rebase`

## Claim Protocol
1. Read the INDEX.md Teams + target direction file (direction_04).
2. In ONE atomic commit touching `teams/team_04_langgraph-reliability.md`,
   `directions/direction_04_*.md`, and `INDEX.md`: set team `status=claimed` +
   `claimed_direction`, and the direction `status=claimed` + `claimed_by_team` +
   `claimed_at`.
3. Re-read after commit; on conflict, revert and pick the next compatible direction.
4. Move to `status=active` when work begins; `finished` when the PR merges.
