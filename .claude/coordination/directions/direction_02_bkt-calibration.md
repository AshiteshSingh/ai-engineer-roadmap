---
kind: direction
id: direction_02
slug: bkt-calibration
title: BKT calibration & predictive validity
status: unclaimed
claimed_by_team: null
claimed_at: null
priority: 7
effort: L
axis: pedagogy
depends_on: []
suggested_team_archetype: team_02
---

## Context
Bayesian Knowledge Tracing is implemented in `lib/bkt.ts` (inline TS client) and
`crates/ml/bkt/src/bkt.rs` (Rust reference + server). Both use **hardcoded global
parameters** `p_transit=0.1`, `p_slip=0.1`, `p_guess=0.2` for *every* concept. Per
user-concept posteriors land in `knowledge_states` (`p_mastery`, `mastery_level`
enum) in `src/db/schema.ts`; learner activity is logged in `interaction_events`
(`is_correct`, `response_time_ms`, `concept_id`). The Rust test suite only asserts
monotonicity (correct ↑ mastery, incorrect ↓) and clamping — there is **no AUC,
Brier, or calibration measurement** anywhere.

## Problem Statement
A single global parameter set cannot reflect per-concept difficulty/guessability;
the model has never been validated for predictive accuracy, and the
`novice/beginner/intermediate/proficient/expert` thresholds (0.2/0.4/0.6/0.8) are
arbitrary rather than empirically calibrated.

## Hypotheses / Research Questions
- Per-concept (or hierarchical) BKT parameters fit from `interaction_events`
  outperform the fixed global parameters on held-out next-response prediction.
- The fixed mastery-level bin edges are mis-calibrated against observed correctness.
- Real interaction volume may be sparse; a synthetic generator is needed to validate
  the fitting pipeline before live data accrues.

## Proposed Methodology
1. New Rust fit/eval binary under `crates/ml/bkt`.
2. Replay `interaction_events` (or a synthetic generator when sparse) into per-user
   per-concept sequences.
3. EM-fit per-concept (and a hierarchical-prior variant) BKT parameters.
4. Held-out split: measure next-correct prediction AUC and Brier vs the
   fixed-parameter baseline.
5. Produce a reliability diagram; recalibrate `mastery_level` thresholds; feed fitted
   params back into `lib/bkt.ts` / `crates/ml/bkt/src/bkt.rs`.

## Success Criteria
- Held-out next-correct prediction AUC ≥ 0.78.
- Brier score improvement ≥ 15% versus the fixed-parameter baseline.
- Expected Calibration Error (ECE) ≤ 0.05 after threshold recalibration.

## Risks & Mitigations
- Sparse real `interaction_events` → document a synthetic fallback and revisit after
  direction_10 (clean, drift-free seed) lands.
- Overfitting per-concept params on thin data → hierarchical shrinkage prior.
- Parameter drift between TS and Rust implementations → single source of truth file.

## Files Likely to Touch
- `crates/ml/bkt/src/bkt.rs`
- new fit/eval binary under `crates/ml/bkt`
- `lib/bkt.ts` (parameter source)
- `src/db/schema.ts` (`knowledge_states`, `interaction_events` — read)

## Findings  (filled by claiming team)
_None yet._

## Claiming Protocol
1. Read INDEX.md to confirm status is still 'unclaimed'.
2. Set status=claimed, claimed_by_team, claimed_at.
3. Update INDEX.md in the same commit.
4. Re-read after commit; if conflict, revert and pick next.
