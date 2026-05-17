---
kind: direction
id: direction_08
slug: audio-r2-resume-voice
title: "Audio pipeline: R2 reliability, voice consistency, resume accuracy"
status: unclaimed
claimed_by_team: null
claimed_at: null
priority: 5
effort: M
axis: audio
depends_on: []
suggested_team_archetype: team_08
---

## Context
`crates/ml/langgraph-audio` emits an `AudioMeta` JSON with per-chapter `start_secs`
and `duration_secs` computed by `wpm.rs` as a **150-WPM word-count estimate**, not a
measured audio duration. There is a single `voice` field (no per-chapter variance),
and **no R2 upload logic exists in the crate** — `audio_url` is a placeholder filled
by downstream orchestration. Per-user playback progress is stored in Cloudflare D1
(`CLOUDFLARE_AUDIO_D1_ID`), keyed off these estimated offsets.

## Problem Statement
Resume positions are computed from a WPM estimate, so D1-stored progress drifts from
the true audio timeline; the crate has no reliable, idempotent R2 upload path; and
voice consistency across chapters and regenerations is unverified.

## Hypotheses / Research Questions
- Replacing the WPM estimate with a measured rendered-audio duration brings chapter
  offsets within a few seconds of truth.
- An idempotent checksum-based R2 upload achieves ≥99.5% success with retry.
- The `voice` field is stable across regenerations (or it is not, and needs pinning).

## Proposed Methodology
1. Add an idempotent Rust R2 upload stage (retry + content checksum, skip-if-present).
2. Replace `wpm.rs` estimate with measured duration probed from the rendered audio;
   recompute chapter `start_secs`.
3. Verify `voice` metadata stability across ≥20 regenerations of the same input.
4. Reconcile D1-stored resume offsets against true chapter starts (migration/backfill).

## Success Criteria
- Chapter `start_secs` error versus measured audio ≤ 2s at p95.
- R2 upload success ≥ 99.5% with idempotent retry.
- `voice` field stable and validated across 20 regenerations.
- Resume position lands within ≤ 3s of the intended chapter offset.

## Risks & Mitigations
- TTS rendering not available in CI → probe a cached/fixture audio artifact.
- D1 backfill corrupts existing progress → dry-run diff + reversible migration.

## Files Likely to Touch
- `crates/ml/langgraph-audio/src/wpm.rs`
- `crates/ml/langgraph-audio/src/chunker.rs`
- `crates/ml/langgraph-audio/src/audio_meta.rs`
- new R2 upload module under `crates/ml/langgraph-audio/src`

## Findings  (filled by claiming team)
_None yet._

## Claiming Protocol
1. Read INDEX.md to confirm status is still 'unclaimed'.
2. Set status=claimed, claimed_by_team, claimed_at.
3. Update INDEX.md in the same commit.
4. Re-read after commit; if conflict, revert and pick next.
