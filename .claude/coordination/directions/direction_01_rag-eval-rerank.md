---
kind: direction
id: direction_01
slug: rag-eval-rerank
title: RAG hybrid retrieval eval harness & reranking
status: unclaimed
claimed_by_team: null
claimed_at: null
priority: 8
effort: L
axis: rag
depends_on: []
suggested_team_archetype: team_01
---

## Context
Retrieval lives in `crates/ml/langgraph-server/src/retrieval.rs`: it merges LanceDB
vector hits (1024-dim bge embeddings via the Candle embed server) with SQLite lexical
hits, capped at `MAX_SNIPPETS=6` and `SNIPPET_CHARS=700`, precedence
caller > vector > lexical, deduped by `lesson_slug#heading`. There is **no reranker**.
A parallel pgvector path exists via `section_embeddings` in `src/db/schema.ts`.
`backend/knowledge_agent/chat_graph.py` is a single `generate` node that consumes
pre-retrieved `context_snippets` — so retrieval quality is currently only observed
*indirectly* through the chat DeepEval GEval metric "Grounded-in-Context".

## Problem Statement
Retrieval quality is unmeasured (no recall@k / MRR / nDCG) and unreranked. The
caller>vector>lexical precedence and the inverse-distance scoring are heuristic and
untuned. Regressions in retrieval are invisible until they surface as low chat
grounding scores on a 5-case golden.

## Hypotheses / Research Questions
- A cross-encoder or LLM reranker over the top-k pre-merge candidates measurably
  lifts grounding versus the current heuristic merge.
- The lexical fallback under-weights strong vector hits when the embed server is
  reachable; RRF fusion with tuned weights outperforms fixed precedence.
- A section-level golden built from `content/*.md` cross-references is sufficient to
  detect retrieval regressions without hand-labeling.

## Proposed Methodology
1. New Rust eval binary under `crates/ml` (sibling to `langgraph-server`).
2. Build a ≥40-query → expected-section golden from `content/*.md` headings and the
   existing internal cross-reference links.
3. Measure recall@k, MRR, nDCG@6 against current `retrieval.rs`.
4. Add a reranker stage (cross-encoder or LLM) over a widened pre-rerank top-k.
5. Replace fixed precedence with RRF fusion; reuse the RRF logic from the iterate
   engine (`rrf.py`) as a reference implementation.
6. Re-run chat DeepEval to confirm downstream lift.

## Success Criteria
- recall@6 ≥ 0.85 on the ≥40-query golden.
- nDCG@6 improvement ≥ 0.10 versus the current merge.
- Chat "Grounded-in-Context" GEval ≥ 0.80 on the existing golden.

## Risks & Mitigations
- Reranker latency on the hot chat path → cap pre-rerank top-k; benchmark p95.
- Golden labeling effort → bootstrap labels from `content/*.md` cross-reference links
  rather than hand-curating.
- Embed server unreachable in CI → keep lexical-only fallback path measured separately.

## Files Likely to Touch
- `crates/ml/langgraph-server/src/retrieval.rs`
- new `crates/ml/<retrieval-eval>/` crate + golden JSON
- `crates/ml/langgraph-server/src/store.rs` (read)
- `backend/tests/deepeval/golden/chat.json` (cross-check)

## Findings  (filled by claiming team)
_None yet._

## Claiming Protocol
1. Read INDEX.md to confirm status is still 'unclaimed'.
2. Set status=claimed, claimed_by_team, claimed_at.
3. Update INDEX.md in the same commit.
4. Re-read after commit; if conflict, revert and pick next.
