---
kind: team
id: team_03
slug: knowledge-graph
name: Knowledge Graph Cell
status: available
claimed_direction: null
claimed_at: null
size: 3
---

## Archetype
knowledge-graph

## Roster (roles, not names)
- Lead: graph algorithms engineer (SCC, topological ordering)
- Member: ML engineer (embedding-based edge inference)
- Member: data engineer (Drizzle schema + deterministic seeding)

## Core Competencies
- Tarjan SCC cycle detection, topological layering, path queries
- Embedding-proximity + lesson-order + cross-reference edge inference
- `crates/ml/topic-miner` extension
- Deterministic `concept_edges` seeding via `scripts/seed-memorize-concepts.ts`

## Tools & Access Needed
- DB read/write (`concepts`, `concept_edges`, `lesson_concepts`,
  `concept_embeddings`)
- Neon dev branch for seed validation
- `crates/ml/topic-miner` build toolchain

## Default Working Agreement
- Branch `research/knowledge-graph`, worktree-isolated
- Eval-gate: `pnpm run build` green + acyclicity assertion passes
- Inference/validation as a Rust pass in `crates/ml/topic-miner`
- Atomic targeted commits; orchestrator merges via `gh pr merge --rebase`

## Claim Protocol
1. Read the INDEX.md Teams + target direction file (direction_03).
2. In ONE atomic commit touching `teams/team_03_knowledge-graph.md`,
   `directions/direction_03_*.md`, and `INDEX.md`: set team `status=claimed` +
   `claimed_direction`, and the direction `status=claimed` + `claimed_by_team` +
   `claimed_at`.
3. Re-read after commit; on conflict, revert and pick the next compatible direction.
4. Move to `status=active` when work begins; `finished` when the PR merges.
   (Note: direction_07 unblocks only when this direction is `completed`.)
