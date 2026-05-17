---
kind: team
id: team_10
slug: data-integrity
name: Data Integrity Team
status: available
claimed_direction: null
claimed_at: null
size: 3
---

## Archetype
data-integrity

## Roster (roles, not names)
- Lead: data engineer (content↔DB diffing, seed determinism)
- Member: Rust engineer (drift-detector binary alongside content-gate)
- Member: Drizzle / migrations engineer (schema + reconciliation)

## Core Competencies
- Deterministic diff: `content/*.md` ↔ `LESSON_SLUGS` ↔ DB `lessons` ↔ `index.json`
- Seed idempotency assertion via content hash
- Drizzle migration hygiene (0000–0004 lineage)
- Lesson/category count reconciliation + README correction

## Tools & Access Needed
- DB read (`lessons`, `categories`) on a Neon dev branch
- `crates/ml/core` build toolchain (content-gate sibling)
- Filesystem access to `content/` and `lib/articles.ts`

## Default Working Agreement
- Branch `research/data-integrity`, worktree-isolated
- Eval-gate: drift-detector exits non-zero on any mismatch; `pnpm run build` green
- Detector as a Rust binary under `crates/ml` (sibling to content-gate)
- Atomic targeted commits; orchestrator merges via `gh pr merge --rebase`

## Claim Protocol
1. Read the INDEX.md Teams + target direction file (direction_10).
2. In ONE atomic commit touching `teams/team_10_data-integrity.md`,
   `directions/direction_10_*.md`, and `INDEX.md`: set team `status=claimed` +
   `claimed_direction`, and the direction `status=claimed` + `claimed_by_team` +
   `claimed_at`.
3. Re-read after commit; on conflict, revert and pick the next compatible direction.
4. Move to `status=active` when work begins; `finished` when the PR merges.
   (Recommended foundational claim — unblocks clean BKT replay and trustworthy
   eval goldens.)
