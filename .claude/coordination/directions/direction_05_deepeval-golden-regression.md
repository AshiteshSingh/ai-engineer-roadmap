---
kind: direction
id: direction_05
slug: deepeval-golden-regression
title: DeepEval golden expansion & regression detection
status: unclaimed
claimed_by_team: null
claimed_at: null
priority: 8
effort: M
axis: eval
depends_on: []
suggested_team_archetype: team_05
---

## Context
`backend/tests/deepeval/` holds 5 golden cases per graph
(`golden/chat.json`, `app_prep.json`, `article_generate.json`,
`course_review.json`). `conftest.py` sets `DEFAULT_THRESHOLD=0.7` per metric and
`DEFAULT_AGGREGATE_GATE=0.65` (≈1-in-15 cells flake on judge JSON errors). The judge
is DeepSeek at temperature 0 with one JSON-retry. `course_review` and
`article_generate` are `@slow` (opt-in). There is **no historical pass-rate tracking
and no regression alerting** — each run is evaluated in isolation.

## Problem Statement
Five cases per graph is too small to be statistically trustworthy, the 0.65 aggregate
floor is low, and silent quality regressions between runs are undetectable because no
per-run score history is retained.

## Hypotheses / Research Questions
- Expanding to ≥20 stratified cases per graph makes the gate stable enough to ratchet
  to ≥0.75.
- A committed per-run score ledger plus a simple drop-detector catches real
  regressions with a low false-positive rate.

## Proposed Methodology
1. Expand each golden to ≥20 cases, stratified across lesson categories, chat intents,
   and known edge cases.
2. Emit a committed JSON ledger of per-run, per-case, per-metric scores.
3. Build a Rust regression-detector binary under `crates/ml` that flags pass-rate
   drops beyond a configurable threshold against the ledger.
4. Ratchet `DEFAULT_AGGREGATE_GATE` upward once the expanded set is stably green.

## Success Criteria
- ≥20 golden cases per graph.
- Aggregate gate raised to ≥0.75 and stably green over consecutive runs.
- Regression detector flags any >0.10 pass-rate drop with <5% false-positive rate
  over 10 historical runs.

## Risks & Mitigations
- More cases ⇒ higher judge cost → keep heavy graphs `@slow`, sample for CI.
- Judge JSON flakiness inflates noise → keep the JSON-retry, record flake reason in
  the ledger.
- Soft synergy with direction_01 (chat golden ↔ retrieval): coordinate on chat cases,
  not a hard dependency.

## Files Likely to Touch
- `backend/tests/deepeval/golden/*.json`
- `backend/tests/deepeval/conftest.py`
- new `crates/ml/<regression-detector>/`

## Findings  (filled by claiming team)
_None yet._

## Claiming Protocol
1. Read INDEX.md to confirm status is still 'unclaimed'.
2. Set status=claimed, claimed_by_team, claimed_at.
3. Update INDEX.md in the same commit.
4. Re-read after commit; if conflict, revert and pick next.
