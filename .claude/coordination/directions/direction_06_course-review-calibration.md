---
kind: direction
id: direction_06
slug: course-review-calibration
title: Course-reviewer aggregation bias & human calibration
status: unclaimed
claimed_by_team: null
claimed_at: null
priority: 6
effort: L
axis: course-review
depends_on: []
suggested_team_archetype: team_06
---

## Context
`backend/knowledge_agent/course_review_graph.py` runs 10 expert LLM evaluators
(REASONER temp 0.0: pedagogy, technical_accuracy, domain_relevance, aggregator;
FAST temp 0.3: the other 7) then an aggregator that emits `aggregate_score` and a
`verdict` from fixed bands (≥8.5 excellent / ≥7.0 recommended / ≥5.5 average / else
skip). Results persist to `course_reviews` (10 dimension scores + `expert_details`
jsonb). The aggregator is **purely LLM-driven, unweighted, and has zero calibration
against human ratings**; the golden `expected_verdict_in` values are author-supplied,
not empirical.

## Problem Statement
Verdicts are produced by an uncalibrated, unweighted LLM aggregation with arbitrary
band edges; experts may be mutually redundant, biasing the aggregate, and there is no
evidence the verdict tracks real human judgement of course quality.

## Hypotheses / Research Questions
- A calibrated weighted aggregator beats the raw LLM aggregator on agreement with
  human ratings.
- Some of the 10 experts are collinear and contribute no independent signal.
- The fixed verdict bands are mis-placed relative to human-labeled quality.

## Proposed Methodology
1. Assemble a held-out human-rated sample of `external_courses` using weak labels
   (`rating`, `review_count`) plus a small hand-labeled set.
2. Measure each expert's correlation with the human label; build an inter-expert
   correlation matrix to find collinear experts.
3. Fit a calibrated weighted aggregator (logistic / isotonic) to predict the human
   label from the 10 dimension scores.
4. Re-tune verdict band thresholds against the human labels.

## Success Criteria
- Aggregate ↔ human-rating Spearman ρ ≥ 0.6 on held-out courses.
- Verdict-band accuracy ≥ 0.70 versus human labels.
- ≥1 redundant/collinear expert identified and documented.
- Calibration ECE ≤ 0.07.

## Risks & Mitigations
- Weak labels (star ratings) are noisy proxies → anchor with a small hand-labeled gold
  set; report metrics on both.
- Dropping an expert regresses a dimension → down-weight rather than remove first.

## Files Likely to Touch
- `backend/knowledge_agent/course_review_graph.py`
- `backend/knowledge_agent/course_review_prompts.py`
- `backend/tests/deepeval/golden/course_review.json`
- `src/db/schema.ts` (`course_reviews`, `external_courses` — read)

## Findings  (filled by claiming team)
_None yet._

## Claiming Protocol
1. Read INDEX.md to confirm status is still 'unclaimed'.
2. Set status=claimed, claimed_by_team, claimed_at.
3. Update INDEX.md in the same commit.
4. Re-read after commit; if conflict, revert and pick next.
