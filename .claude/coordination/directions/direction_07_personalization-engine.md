---
kind: direction
id: direction_07
slug: personalization-engine
title: "Personalization: mastery→recommendation, spaced-rep, cold-start"
status: unclaimed
claimed_by_team: null
claimed_at: null
priority: 7
effort: L
axis: personalization
depends_on: [direction_02, direction_03]
suggested_team_archetype: team_07
---

## Context
`lib/spaced-repetition.ts` (SM-2 modulated by BKT mastery) and
`crates/ml/bkt/src/scheduler.rs` (SM-2 + slow-response/incorrect penalties) are fully
**defined but never wired into any learner path or API**. There is no recommender:
`getCoursesForLesson(slug)` always returns `[]`, sequencing is the fixed Phase 0–6
spine only, and `knowledge_states.mastery_level` is computed but never consumed for
ordering. No cold-start strategy exists for new learners.

## Problem Statement
The platform computes mastery but cannot act on it: no "what should I learn next"
endpoint, no prerequisite gating, no spaced-repetition delivery, and no guidance for
a brand-new learner.

## Hypotheses / Research Questions
- Combining calibrated BKT mastery with KG prerequisites and spaced-rep due-items
  yields recommendations that reduce predicted time-to-mastery versus the fixed spine.
- A difficulty-prior + category-order cold-start beats no guidance for users with no
  interaction history.

## Proposed Methodology
1. Recommendation module: a Rust crate under `crates/ml/*` plus a Next.js API route.
2. Score candidates from calibrated BKT mastery (direction_02), KG prerequisite
   readiness (direction_03), and spaced-repetition due-items (`lib/spaced-repetition.ts`).
3. Cold-start via `lib/articles.ts` difficulty priors + category order for
   zero-history users.
4. ε-greedy exploration to avoid over-exploiting the strongest known concept.
5. Offline replay over `interaction_events` to compare predicted time-to-mastery vs
   the fixed-spine baseline.

## Success Criteria
- "next-3-lessons" endpoint returns prerequisite-valid recommendations for any
  user state.
- ≥95% of recommendations satisfy the prerequisite-mastery ≥0.6 gate.
- Offline replay shows lower predicted time-to-mastery than the fixed-spine baseline.

## Risks & Mitigations
- **Hard dependency**: requires direction_02 (calibrated BKT) and direction_03
  (populated, acyclic KG) — cannot be claimed first.
- Replay metric gameable → also report prerequisite-violation rate and coverage.

## Files Likely to Touch
- new recommendation crate under `crates/ml/*`
- a Next.js API route (`app/api/...`)
- `lib/spaced-repetition.ts`
- `lib/data.ts` (`getCoursesForLesson` — read)

## Findings  (filled by claiming team)
_None yet._

## Claiming Protocol
1. Read INDEX.md to confirm status is still 'unclaimed'.
2. Confirm depends_on (direction_02, direction_03) are 'completed' before claiming.
3. Set status=claimed, claimed_by_team, claimed_at.
4. Update INDEX.md in the same commit.
5. Re-read after commit; if conflict, revert and pick next.
