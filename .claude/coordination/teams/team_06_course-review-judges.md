---
kind: team
id: team_06
slug: course-review-judges
name: Course Review Judges
status: available
claimed_direction: null
claimed_at: null
size: 3
---

## Archetype
course-review-judges

## Roster (roles, not names)
- Lead: ML scientist (LLM-judge calibration, isotonic/logistic aggregation)
- Member: data analyst (inter-rater correlation, collinearity analysis)
- Member: backend engineer (`course_review_graph.py` aggregator wiring)

## Core Competencies
- LLM-as-judge calibration against human / weak labels
- Weighted aggregator fitting (logistic, isotonic regression)
- Inter-expert correlation + redundancy detection
- Verdict-band threshold re-tuning against labeled data

## Tools & Access Needed
- DeepSeek key (10-expert + aggregator runs)
- DB read (`course_reviews`, `external_courses` ratings/review_count)
- LangGraph container / local backend run

## Default Working Agreement
- Branch `research/course-review-judges`, worktree-isolated
- Eval-gate: `pnpm run build` green + course_review DeepEval golden not regressed
- Calibration tooling as a Rust crate under `crates/ml` where logic is non-trivial
- Atomic targeted commits; orchestrator merges via `gh pr merge --rebase`

## Claim Protocol
1. Read the INDEX.md Teams + target direction file (direction_06).
2. In ONE atomic commit touching `teams/team_06_course-review-judges.md`,
   `directions/direction_06_*.md`, and `INDEX.md`: set team `status=claimed` +
   `claimed_direction`, and the direction `status=claimed` + `claimed_by_team` +
   `claimed_at`.
3. Re-read after commit; on conflict, revert and pick the next compatible direction.
4. Move to `status=active` when work begins; `finished` when the PR merges.
