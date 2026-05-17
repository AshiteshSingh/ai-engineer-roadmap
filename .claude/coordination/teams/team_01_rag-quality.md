---
kind: team
id: team_01
slug: rag-quality
name: RAG Quality Squad
status: available
claimed_direction: null
claimed_at: null
size: 3
---

## Archetype
rag-quality

## Roster (roles, not names)
- Lead: RAG engineer with reranking + hybrid-fusion experience
- Member: retrieval-eval engineer (recall@k / MRR / nDCG harness authoring)
- Member: Rust engineer (LanceDB / Candle embed server / `langgraph-server`)

## Core Competencies
- LanceDB and pgvector tuning; 1024-dim bge embedding pipeline
- Reciprocal Rank Fusion and learned-weight hybrid merge
- Cross-encoder / LLM reranking under a latency budget
- Retrieval golden construction from `content/*.md` cross-references

## Tools & Access Needed
- DB read (`section_embeddings`, lessons), LanceDB store
- Candle embed server endpoint
- DeepSeek key (LLM reranker / chat GEval cross-check)
- Local `crates/ml` build toolchain

## Default Working Agreement
- Branch `research/rag-quality`, worktree-isolated (never the primary tree)
- Eval-gate required: `pnpm run build` green + chat DeepEval not regressed
- Gates/harnesses as Rust crates under `crates/ml` (not ad-hoc Python)
- Atomic, targeted `git add <paths>` commits; orchestrator merges via
  `gh pr merge --rebase` (no direct push to `main` — guard-blocked)

## Claim Protocol
1. Read the INDEX.md Teams + target direction file (direction_01).
2. In ONE atomic commit touching `teams/team_01_rag-quality.md`,
   `directions/direction_01_*.md`, and `INDEX.md`: set team `status=claimed` +
   `claimed_direction`, and the direction `status=claimed` + `claimed_by_team` +
   `claimed_at`.
3. Re-read after commit; on conflict, revert and pick the next compatible direction.
4. Move to `status=active` when work begins; `finished` when the PR merges.
