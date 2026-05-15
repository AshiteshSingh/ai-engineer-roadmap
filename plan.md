# Plan: Improve Iterate Command and Logic

## Current State
The iterate system is a multi-iteration task execution engine with:
- Shell scripts (start.sh, kick-session.sh, statusline.sh) for lifecycle management
- Python modules (evaluate.py, store_context.py, retrieve_context.py, embeddings.py, reranker.py, bm25_index.py, rrf.py, task_history.py) for eval/context
- 197 passing tests + 36 bash checks

## Problems Identified

### P1: Heuristic evaluation is too crude
The eval uses cosine similarity between task description and output text as a proxy for "task completion." This produces scores that hover around 0.4-0.6 regardless of actual progress. The evaluator can't distinguish between "Claude explained the task" vs "Claude actually implemented the task." This causes:
- Premature stops (plateau detection fires on flat scores)
- Missed completions (real progress doesn't raise the score)
- Poor feedback (scores don't tell Claude what to focus on)

### P2: Stop logic thresholds are miscalibrated
- `tc >= 0.9` for completion — almost unreachable with heuristic scoring
- `pr < 0.2` for no-progress — can fire on legitimate but similar work
- Plateau spread `< 0.05` over 4 iterations — fires too easily with heuristic
- Stall counter of 2 for both git and semantic — too aggressive for large tasks

### P3: Inter-iteration feedback lacks actionability
The feedback sent via stderr in kick-session.sh is a dump of raw retrieved context + eval scores. Claude gets a wall of text but no clear directive about what to do next.

### P4: Code duplication
- `_cosine_similarity` defined in both evaluate.py and retrieve_context.py
- `_extract_errors` duplicated between evaluate.py and store_context.py
- Session-finding logic duplicated between kick-session.sh and statusline.sh

### P5: Startup is slow
Every `/iterate` run installs pip packages and pre-warms the embedding model, even when they're already cached.

### P6: No structured progress tracking
There's no mechanism to track *what specific sub-tasks* have been completed across iterations. The system only knows similarity scores, not actual progress items.

## Plan

### Phase 1: LLM-Powered Evaluation (highest impact)
Add an optional LLM-based evaluator that produces accurate, actionable scores and feedback. Use a lightweight local model or fallback to heuristic.

**Files:** `evaluate.py`, new `llm_eval.py`

1. Create `llm_eval.py` — a self-contained LLM judge module:
   - Accepts task, output, context, diff as inputs
   - Calls a local OpenAI-compatible API (configurable via `ITERATE_EVAL_URL` env var)
   - Uses a structured prompt that asks the LLM to score Task Completion, Incremental Progress, and Code Quality on 0-1 scale with reasoning
   - Returns the same dict shape as `run_heuristic()` for compatibility
   - Falls back to heuristic if the LLM is unavailable
   - Hard timeout of 15s to not block the stop hook

2. Update `evaluate.py`:
   - Try LLM eval first, fall back to heuristic
   - Set `eval_method` to "llm" or "heuristic" accordingly
   - Pass LLM reasoning through to the feedback

3. Update `kick-session.sh`:
   - Pass `ITERATE_EVAL_URL` through to Python
   - Include LLM reasoning in the stderr feedback when available

### Phase 2: Better Stop Logic
**Files:** `evaluate.py`

1. Add a grace period: never stop before iteration 3 (unless completion promise matched)
2. Raise plateau window from 4 to 5 iterations, spread threshold from 0.05 to 0.08
3. Raise semantic stall threshold from 2 to 3 consecutive high-similarity iterations
4. Raise git stall threshold from 2 to 3
5. When using LLM eval, trust the LLM's "should_continue" recommendation
6. Lower completion threshold from 0.9 to 0.85 (LLM scores are more meaningful)

### Phase 3: Structured Inter-Iteration Feedback
**Files:** `kick-session.sh`, `retrieve_context.py`

1. Restructure the stderr feedback into clear sections:
   - `## Status` — iteration N/M, scores
   - `## What Was Done` — brief summary from this iteration's output
   - `## What Remains` — LLM's assessment or heuristic gap analysis
   - `## Context` — relevant prior iterations (condensed)
2. Add a `summarize_iteration()` function in retrieve_context.py that extracts key actions from the output
3. Cap retrieved context to 4000 chars to avoid overwhelming Claude

### Phase 4: Code Cleanup (DRY)
**Files:** `evaluate.py`, `store_context.py`, `retrieve_context.py`

1. Move shared `_cosine_similarity` to `embeddings.py`
2. Move shared `_extract_errors` to a new `utils.py` or consolidate in `store_context.py` with evaluate.py importing from there
3. Extract session-finding logic from kick-session.sh into a shared `find_session.sh` sourced by both scripts

### Phase 5: Faster Startup
**Files:** `start.sh`

1. Check for a `/tmp/claude-iterate-deps-ok` flag file before running pip install
2. Check for fastembed cache directory before pre-warming
3. Skip pre-warm entirely if `ITERATE_SKIP_WARMUP=1`

### Phase 6: Progress Tracking
**Files:** `store_context.py`, `retrieve_context.py`, new section in kick-session.sh

1. Extract "action items" from each iteration output (files created/modified, features added, tests passing)
2. Store as structured metadata in ChromaDB
3. Include a cumulative progress checklist in the feedback

## Implementation Order
Phases 1 → 2 → 3 → 5 → 4 → 6

Phase 1 is the biggest bang for the buck. Phases 2-3 complement it. Phase 5 is quick. Phase 4 is housekeeping. Phase 6 is nice-to-have if time permits.

## Test Strategy
- Update existing pytest tests for changed signatures
- Add tests for llm_eval.py (mock the HTTP call)
- Add tests for new stop logic thresholds
- Run `bash .claude/iterate/test.sh` after each phase to verify no regressions
