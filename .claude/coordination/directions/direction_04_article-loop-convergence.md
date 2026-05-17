---
kind: direction
id: direction_04
slug: article-loop-convergence
title: Article-generate revision-loop convergence, cost & latency
status: unclaimed
claimed_by_team: null
claimed_at: null
priority: 7
effort: M
axis: langgraph
depends_on: []
suggested_team_archetype: team_04
---

## Context
`backend/knowledge_agent/article_generate_graph.py` runs
research → outline → draft → review → revise with a conditional edge `_after_revise()`
that loops to `revise` while `quality.ok == False` and `revision < MAX_REVISIONS` (2),
else `finalize`. `check_quality()` enforces ≥1500 words, ≥2 code blocks, ≥1 cross-ref,
≥5 xyflow blocks, no mermaid, and mandatory sections (`# Title`, `## Mental Model`,
`## Runtime Internals`). The graph has **no retry/backoff** on transient DeepSeek or
JSON-parse failures and **no token/latency telemetry**; the loop can exhaust both
revisions and still emit a quality-failing article with no escalation.

## Problem Statement
Generation reliability is unmeasured: an unknown fraction of runs exhaust
`MAX_REVISIONS` without converging, transient LLM failures crash the run, and there
is no cost or latency budget for a multi-call pipeline.

## Hypotheses / Research Questions
- A sharper, more actionable review rubric raises the within-2-revisions convergence
  rate.
- Most non-convergence is driven by a small number of `check_quality()` rules
  (likely xyflow-block count and word count).
- Structured retry+backoff eliminates the majority of run-level crashes.

## Proposed Methodology
1. Instrument per-node token usage and wall-clock latency.
2. Add structured retry+backoff on transient DeepSeek / JSON-parse failures in
   `backend/knowledge_agent/llm.py`.
3. Run a generation batch; measure convergence rate and which `check_quality()` rule
   most often fails last.
4. Rewrite the review prompt so revise feedback is specific and actionable.
5. Add an early-exit/escalation path when the loop is stuck (emit a flagged artifact
   instead of silently finalizing a failing one).

## Success Criteria
- ≥90% of generations pass `check_quality()` within ≤2 revisions.
- p95 end-to-end generation latency tracked and within an agreed budget.
- 0 unhandled DeepSeek-failure crashes over a 50-lesson batch.

## Risks & Mitigations
- Retry inflates cost/latency → cap retries, exponential backoff, budget alarm.
- Rubric changes regress quality → gate batch results against existing DeepEval
  article golden before landing.

## Files Likely to Touch
- `backend/knowledge_agent/article_generate_graph.py`
- `backend/knowledge_agent/llm.py`
- `backend/knowledge_agent/state.py`
- `backend/tests/deepeval/golden/article_generate.json` (cross-check)

## Findings  (filled by claiming team)
_None yet._

## Claiming Protocol
1. Read INDEX.md to confirm status is still 'unclaimed'.
2. Set status=claimed, claimed_by_team, claimed_at.
3. Update INDEX.md in the same commit.
4. Re-read after commit; if conflict, revert and pick next.
