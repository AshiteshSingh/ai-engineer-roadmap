---
kind: team
id: team_08
slug: audio-pipeline
name: Audio Pipeline Team
status: available
claimed_direction: null
claimed_at: null
size: 3
---

## Archetype
audio-pipeline

## Roster (roles, not names)
- Lead: Rust audio engineer (`crates/ml/langgraph-audio`)
- Member: Cloudflare engineer (R2 SDK, idempotent uploads, D1 backfill)
- Member: QA engineer (duration probing, voice-stability validation)

## Core Competencies
- Rust audio pipeline: `wpm.rs`, `chunker.rs`, `audio_meta.rs`
- Cloudflare R2 idempotent upload (retry + checksum)
- Measured TTS duration probing vs WPM estimate
- D1 resume-offset reconciliation and reversible backfill

## Tools & Access Needed
- R2 credentials (`R2_*`), Cloudflare audio D1 (`CLOUDFLARE_AUDIO_D1_ID`)
- DeepSeek key (narration script generation)
- `crates/ml/langgraph-audio` build toolchain + a fixture audio artifact

## Default Working Agreement
- Branch `research/audio-pipeline`, worktree-isolated
- Eval-gate: `pnpm run build` green + dry-run D1 backfill diff reviewed
- All pipeline logic stays in the `langgraph-audio` Rust crate
- Atomic targeted commits; orchestrator merges via `gh pr merge --rebase`

## Claim Protocol
1. Read the INDEX.md Teams + target direction file (direction_08).
2. In ONE atomic commit touching `teams/team_08_audio-pipeline.md`,
   `directions/direction_08_*.md`, and `INDEX.md`: set team `status=claimed` +
   `claimed_direction`, and the direction `status=claimed` + `claimed_by_team` +
   `claimed_at`.
3. Re-read after commit; on conflict, revert and pick the next compatible direction.
4. Move to `status=active` when work begins; `finished` when the PR merges.
