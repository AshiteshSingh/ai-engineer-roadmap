# Pre-share preflight — Friday interview

Hidden on purpose (lives in `.sdd-scratch/`). Run top to bottom before the call.

## Verified ready (last check 2026-05-21)
- [x] `make build` / `make vet` / `make test-unit` — green
- [x] DEMO.md sequence 1–5 + refusal bonus — all correct against the live server
      (create→form_1, create→form_2, list_forms, get_responses form_1 from "the NPS one",
      summarize w/ no tool, "delete" → graceful decline)
- [x] Frontend e2e: 10/11 pass; the DEMO walkthrough spec passes. (1 stale `· done`
      badge assertion in `chat.spec.ts` from the in-progress scores UI — cosmetic, not a blocker)

## Must do before sharing (manual — only you can)
- [ ] **Rotate the Langfuse secret key** — Langfuse → Project Settings → API Keys → rotate;
      update `LANGFUSE_SECRET_KEY` in `.env`. (Old key was exposed in chat history.)
- [ ] **macOS screen-share perms** — System Settings → Privacy & Security → Screen & System
      Audio Recording → enable for the meeting app AND your terminal/IDE → do a 30-sec test share.
- [ ] **Collapse in the file tree** before sharing: `.sdd-scratch/`, `.claude/`, `evals/`.
      Don't open in the editor: `.env`, `web/AGENTS.md`, `PROMPTS.txt`, `OBSERVABILITY.md`.
- [ ] **`.env` funded** — DeepSeek + OpenAI keys have credit so live calls don't 401.
- [ ] Notifications off / Do Not Disturb on.

## Optional
- [ ] Commit or `git stash` the uncommitted scores/feedback feature so `git status` is quiet
      if you ever show the tree (additive — won't change the demo either way).
- [ ] Rehearse DEMO.md twice more until it's boring.

## Run cheatsheet
- Both servers: `make dev`  (Go :8080 + Next :3000). Or backend only: `make run`.
- Smoke one curl: `curl -N -X POST localhost:8080/chat -H 'Content-Type: application/json' -d '{"session_id":"s1","message":"List my forms"}'`
- Light spec to say out loud (no skill scaffolding): **Goal / User / Success / Out-of-scope**;
  optionally type those 4 lines into a single `SPEC.md`.

## Visible vs hidden (screen-share)
- Show: `main.go`, `tools.go`, `config.go`, `DEMO.md`, terminal, browser (frontend optional).
- Hide: `.sdd-scratch/`, `.claude/`, `evals/`, `web/AGENTS.md`, `.env`, `PROMPTS.txt`.
