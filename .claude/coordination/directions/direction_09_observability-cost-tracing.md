---
kind: direction
id: direction_09
slug: observability-cost-tracing
title: "Production observability: cross-tier tracing & cost attribution"
status: unclaimed
claimed_by_team: null
claimed_at: null
priority: 6
effort: M
axis: observability
depends_on: []
suggested_team_archetype: team_09
---

## Context
There is no LangSmith integration. The Python backend uses
`logging.getLogger("knowledge_agent")`; Rust crates use `tracing`. `wrangler.jsonc`
has `observability.enabled=true` but **no trace-ID is propagated** across
Next.js → FastAPI `/runs/wait` (Bearer middleware in `backend/app.py`) → DeepSeek.
There is **no per-graph or per-expert cost attribution** — `course_review` alone
fires 11 LLM calls per run with no breakdown. README claims `AsyncPostgresSaver`
checkpointing, but the code uses `AsyncCloudflareD1Saver` (documentation drift).

## Problem Statement
A multi-tier LLM system runs blind: a slow or expensive request cannot be traced end
to end, DeepSeek spend cannot be attributed to a graph or an expert, and the README
misstates the checkpointer.

## Hypotheses / Research Questions
- A single trace-ID injected at Next.js and threaded through `/runs/wait` into
  LangGraph state enables full request reconstruction.
- Per-node token capture reconciles to within a few percent of the DeepSeek bill.

## Proposed Methodology
1. Inject a trace-ID at the Next.js LangGraph caller; propagate it through the
   `/runs/wait` Bearer middleware into LangGraph state; tag every LLM call.
2. Emit per-node token + cost events to a committed JSON ledger (and/or D1).
3. Build a Rust cost-attribution report binary under `crates/ml`.
4. Correct the README checkpointer claim (`AsyncCloudflareD1Saver`).

## Success Criteria
- 100% of `/runs/wait` requests carry an end-to-end trace ID.
- Per-graph and per-expert cost breakdown available for `course_review`'s 11 calls.
- ≤5% cost-attribution error versus the DeepSeek bill.
- README checkpointer statement corrected.

## Risks & Mitigations
- Trace plumbing across language boundary is invasive → propagate via a single header
  + state field; no framework swap.
- Token counts unavailable from the API response → fall back to tokenizer-side
  estimation, flag as estimated in the ledger.

## Files Likely to Touch
- `backend/app.py`
- `backend/knowledge_agent/llm.py`
- the Next.js LangGraph caller (`lib/`/`app/api/...`)
- `README.md`
- new cost-report binary under `crates/ml`

## Findings  (filled by claiming team)
_None yet._

## Claiming Protocol
1. Read INDEX.md to confirm status is still 'unclaimed'.
2. Set status=claimed, claimed_by_team, claimed_at.
3. Update INDEX.md in the same commit.
4. Re-read after commit; if conflict, revert and pick next.
