# Research Coordination — Master Dashboard

Self-service scaffold for parallel research teams. **Git is the lock**: a direction
is only owned once the claim commit (touching the direction file + this INDEX) has
landed on `origin/main`. File contents are advisory until then.

Repo conventions (project memory): work in a dedicated git worktree (never the
primary tree); land via GitHub PR-merge (`gh pr merge --rebase`) — **direct pushes to
`main` are guard-blocked**; atomic targeted `git add <paths>` commits; gates/loops as
Rust crates under `crates/ml`.

## Directions

| ID | Title | Axis | Status | Team | Priority | Effort | Depends On |
|----|-------|------|--------|------|----------|--------|------------|
| direction_01 | RAG hybrid retrieval eval harness & reranking | rag | unclaimed | — | 8 | L | — |
| direction_02 | BKT calibration & predictive validity | pedagogy | unclaimed | — | 7 | L | — |
| direction_03 | KG edge inference, cycle detection & path optimization | kg | unclaimed | — | 6 | L | — |
| direction_04 | Article-generate revision-loop convergence, cost & latency | langgraph | unclaimed | — | 7 | M | — |
| direction_05 | DeepEval golden expansion & regression detection | eval | unclaimed | — | 8 | M | — |
| direction_06 | Course-reviewer aggregation bias & human calibration | course-review | unclaimed | — | 6 | L | — |
| direction_07 | Personalization: mastery→reco, spaced-rep, cold-start | personalization | unclaimed | — | 7 | L | direction_02, direction_03 |
| direction_08 | Audio pipeline: R2 reliability, voice consistency, resume accuracy | audio | unclaimed | — | 5 | M | — |
| direction_09 | Production observability: cross-tier tracing & cost attribution | observability | unclaimed | — | 6 | M | — |
| direction_10 | Content↔DB drift, seed determinism & doc accuracy | data | unclaimed | — | 9 | M | — |

## Teams

| ID | Name | Archetype | Status | Direction | Size |
|----|------|-----------|--------|-----------|------|
| team_01 | RAG Quality Squad | rag-quality | available | — | 3 |
| team_02 | Pedagogy & BKT Lab | pedagogy-bkt | available | — | 3 |
| team_03 | Knowledge Graph Cell | knowledge-graph | available | — | 3 |
| team_04 | LangGraph Reliability Crew | langgraph-reliability | available | — | 3 |
| team_05 | Eval Harness Team | eval-harness | available | — | 2 |
| team_06 | Course Review Judges | course-review-judges | available | — | 3 |
| team_07 | Personalization Squad | personalization | available | — | 4 |
| team_08 | Audio Pipeline Team | audio-pipeline | available | — | 3 |
| team_09 | Observability & Cost Crew | observability-cost | available | — | 3 |
| team_10 | Data Integrity Team | data-integrity | available | — | 3 |

## Recommended Pairings

Each direction's `suggested_team_archetype` (default compatible match):

- direction_01 ⇄ team_01 (rag-quality)
- direction_02 ⇄ team_02 (pedagogy-bkt)
- direction_03 ⇄ team_03 (knowledge-graph)
- direction_04 ⇄ team_04 (langgraph-reliability)
- direction_05 ⇄ team_05 (eval-harness)
- direction_06 ⇄ team_06 (course-review-judges)
- direction_07 ⇄ team_07 (personalization)
- direction_08 ⇄ team_08 (audio-pipeline)
- direction_09 ⇄ team_09 (observability-cost)
- direction_10 ⇄ team_10 (data-integrity)

## Claim-First Guidance

- **Foundational — claim early**: `direction_10` (data integrity) reconciles the
  content/DB/doc drift that everything else measures against. `direction_05`
  (eval expansion) and `direction_01` (RAG eval) are the quality safety nets.
- **Dependency-blocked — cannot be claimed first**: `direction_07` (personalization)
  requires `direction_02` (calibrated BKT) **and** `direction_03` (populated, acyclic
  KG) to be `completed` before it is eligible.
- All other directions are independently claimable in any order.

## Status legend

Directions: `unclaimed → claimed → in_progress → blocked → completed`
Teams: `available → claimed → active → finished`
