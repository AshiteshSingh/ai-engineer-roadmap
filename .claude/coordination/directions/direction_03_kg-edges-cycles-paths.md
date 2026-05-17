---
kind: direction
id: direction_03
slug: kg-edges-cycles-paths
title: Knowledge-graph edge inference, cycle detection & path optimization
status: unclaimed
claimed_by_team: null
claimed_at: null
priority: 6
effort: L
axis: kg
depends_on: []
suggested_team_archetype: team_03
---

## Context
`src/db/schema.ts` defines `concepts`, `concept_edges` (edge_type enum:
`prerequisite | related | part_of | builds_on | contrasts_with | applies_to`,
`weight` float) and `lesson_concepts` (lesson→concept relevance). These tables are
**defined but unpopulated** — `scripts/seed.ts` only seeds categories/lessons/
sections; `scripts/seed-memorize-concepts.ts` is partial. There is **no cycle
detection, no topological sort, and no learner-path optimizer**; the DAG property is
assumed, never validated. `concept_embeddings` exists for similarity-based inference.

## Problem Statement
The knowledge graph is structurally inert: without populated, validated prerequisite
edges there is no basis for adaptive sequencing or prerequisite gating, and a cyclic
edge set would silently break any future path logic.

## Hypotheses / Research Questions
- Prerequisite edges can be inferred with ≥90% agreement to the fixed Phase 0–6
  lesson ordering by combining `concept_embeddings` similarity, lesson order, and
  `content/*.md` cross-reference direction.
- The inferred edge set is acyclic, or cycles localize to a small fixable set.

## Proposed Methodology
1. Extend `crates/ml/topic-miner` with an edge-inference pass.
2. Infer `prerequisite`/`builds_on` edges from `concept_embeddings` proximity, the
   hardcoded lesson order, and cross-reference link direction in `content/*.md`.
3. Run Tarjan SCC for cycle detection; report and break cycles deterministically.
4. Compute topological layering; expose a learner-path query (target lesson → ordered
   prerequisite path).
5. Deterministically seed `concept_edges` (extend `scripts/seed-memorize-concepts.ts`).

## Success Criteria
- 100% of the seeded edge set validated acyclic (Tarjan SCC: no non-trivial SCC).
- ≥90% of inferred `prerequisite` edges agree with the Phase 0–6 lesson ordering.
- Learner-path query returns a valid topological order for any target lesson.

## Risks & Mitigations
- Embedding-inferred edges introduce spurious cycles → cycle-break by lowest edge
  weight, log every removed edge.
- Non-determinism in seeding → fixed sort keys + content-hash assertion.

## Files Likely to Touch
- `crates/ml/topic-miner/`
- `scripts/seed-memorize-concepts.ts`
- `src/db/schema.ts` (`concepts`, `concept_edges`, `lesson_concepts` — read)

## Findings  (filled by claiming team)
_None yet._

## Claiming Protocol
1. Read INDEX.md to confirm status is still 'unclaimed'.
2. Set status=claimed, claimed_by_team, claimed_at.
3. Update INDEX.md in the same commit.
4. Re-read after commit; if conflict, revert and pick next.
