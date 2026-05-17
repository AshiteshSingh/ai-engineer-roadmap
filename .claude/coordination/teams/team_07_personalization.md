---
kind: team
id: team_07
slug: personalization
name: Personalization Squad
status: available
claimed_direction: null
claimed_at: null
size: 4
---

## Archetype
personalization

## Roster (roles, not names)
- Lead: recommender-systems engineer (sequencing, exploration policies)
- Member: ML engineer (BKT-mastery + KG-prerequisite scoring)
- Member: Rust engineer (recommendation crate under `crates/ml`)
- Member: full-stack engineer (Next.js API route + integration)

## Core Competencies
- Mastery→next-lesson scoring; prerequisite gating
- SM-2 + BKT spaced-repetition integration (`lib/spaced-repetition.ts`)
- Cold-start via difficulty priors + category order
- ε-greedy exploration; offline replay over `interaction_events`

## Tools & Access Needed
- DB read (`knowledge_states`, `concept_edges`, `interaction_events`)
- Calibrated BKT params (from direction_02) + populated KG (from direction_03)
- `crates/ml` build toolchain + Next.js dev environment

## Default Working Agreement
- Branch `research/personalization`, worktree-isolated
- Eval-gate: `pnpm run build` green + prerequisite-violation rate reported
- Recommendation core as a Rust crate under `crates/ml`
- Atomic targeted commits; orchestrator merges via `gh pr merge --rebase`

## Claim Protocol
1. Read the INDEX.md Teams + target direction file (direction_07).
2. **Verify direction_02 AND direction_03 are `completed`** — direction_07 is
   dependency-blocked and MUST NOT be claimed before both finish.
3. In ONE atomic commit touching `teams/team_07_personalization.md`,
   `directions/direction_07_*.md`, and `INDEX.md`: set team `status=claimed` +
   `claimed_direction`, and the direction `status=claimed` + `claimed_by_team` +
   `claimed_at`.
4. Re-read after commit; on conflict, revert and pick the next compatible direction.
5. Move to `status=active` when work begins; `finished` when the PR merges.
