---
kind: direction
id: direction_10
slug: content-db-drift
title: Content↔DB drift, seed determinism & doc accuracy
status: unclaimed
claimed_by_team: null
claimed_at: null
priority: 9
effort: M
axis: data
depends_on: []
suggested_team_archetype: team_10
---

## Context
`scripts/seed.ts` deletes then re-inserts categories/lessons/sections,
deterministically ordered by the hardcoded `LESSON_NUMBER` map in `lib/articles.ts`,
but it **silently skips** any `content/*.md` file not present in `LESSON_SLUGS`
(filter `file in LESSON_NUMBER`, no warning). The filesystem currently holds 99 `.md`
files across 10 categories, while the README and project framing claim 108 lessons /
15 categories — a **real, unflagged drift**. `lesson_courses` and `concept_edges` are
schema-defined but unpopulated. Drizzle migrations run 0000–0004. There is no
content↔DB drift detector anywhere.

## Problem Statement
Content can silently diverge from the DB and the docs: a new lesson missing from
`LESSON_SLUGS` never appears and never errors, the lesson/category counts disagree
across README/content/DB, and nothing asserts seed determinism.

## Hypotheses / Research Questions
- A deterministic diff across `content/*.md` ↔ `LESSON_SLUGS` ↔ DB `lessons` ↔
  `index.json` can catch every drift class as a hard CI failure.
- The 99-vs-108 / 10-vs-15 discrepancy resolves to one canonical count.

## Proposed Methodology
1. Build a Rust drift-detector binary under `crates/ml` (sibling to `content-gate`)
   that diffs `content/*.md` ↔ `LESSON_SLUGS` ↔ DB `lessons` ↔ `index.json` and
   exits non-zero on any mismatch.
2. Reconcile the 99/108 and 10/15 discrepancy to a single source of truth; correct the
   README.
3. Assert seed idempotency: run `seed.ts` twice, compare a content hash.
4. Wire the detector into the build pipeline as a gate.

## Success Criteria
- Drift-detector exits non-zero on any content/`LESSON_SLUGS`/DB/`index.json`
  mismatch.
- Lesson and category counts reconciled and consistent across README, content, and DB.
- Seed produces a byte-identical content hash across two consecutive runs.
- Gate wired into the build pipeline.

## Risks & Mitigations
- DB unavailable in CI → detector supports a content↔`LESSON_SLUGS`↔`index.json`
  subset mode without a live DB.
- Reconciliation reveals genuinely missing lessons → report, do not auto-delete;
  surface for authoring.

## Files Likely to Touch
- `scripts/seed.ts`
- `lib/articles.ts` (`LESSON_SLUGS`, `LESSON_NUMBER`, `CATEGORIES`)
- `crates/ml/core` (content-gate sibling)
- `README.md`

## Findings  (filled by claiming team)
_None yet._

## Claiming Protocol
1. Read INDEX.md to confirm status is still 'unclaimed'.
2. Set status=claimed, claimed_by_team, claimed_at.
3. Update INDEX.md in the same commit.
4. Re-read after commit; if conflict, revert and pick next.
