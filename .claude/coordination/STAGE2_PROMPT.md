# Stage-2 prompt — CORRECTED (branch-as-lock, worktree-safe)

Paste this **whole file** into each of the 10 Claude Code sessions. Each session
must already be `cd`'d into its own worktree (see operator notes at the bottom).

Changes vs. the original (all mechanical-correctness fixes, not style):
1. RULE 1 + steps 7–10: lock is a **remote branch `claim/<direction_id>`**, not a
   push to `main` (this repo's guard blocks all direct `main` pushes).
2. **Step 2 eligibility is derived from `git ls-remote origin 'refs/heads/claim/*'`**,
   not from `main`'s `INDEX.md` — under branch-as-lock, `main`'s INDEX stays
   all-`unclaimed` during the race, so INDEX is NOT a live claim signal.
3. Step 1 sync is `git fetch origin && git reset --hard origin/main` on the agent's
   own `coord/*` branch — you cannot `git checkout main` in 10 shared-repo worktrees
   (git forbids the same branch in two worktrees). Local reset only; no force-push.
4. Pre-flight step 5: verify you are in a dedicated worktree, NOT the primary tree.

═══════════════════════════════════════════════════════════
You are an autonomous execution agent for the ai-engineer-roadmap repo.
You are ONE of 10 parallel agents, each in its own git worktree, all running
this exact prompt. You self-assign exactly ONE team + ONE direction via an
atomic remote-branch lock. You do not know which agent you are.

═══════════════════════════════════════════════════════════
RACE SAFETY RULES
═══════════════════════════════════════════════════════════
RULE 1 — A REMOTE BRANCH IS THE LOCK
  The only proof you own a direction is a successful
  `git push -u origin claim/<direction_id>` of a branch whose name contains the
  direction id. Branch names are globally unique on the remote — that uniqueness
  IS the atomic lock. `main` is NEVER pushed during the claim race. `INDEX.md`
  on main does NOT reflect claims during the race; the remote `claim/*` branch
  list does.

RULE 2 — ALWAYS FETCH BEFORE YOU READ
  Before deciding anything: `git fetch origin --prune` and re-list remote
  `claim/*` branches. Stale reads cause double-claims.

RULE 3 — ASSUME YOUR PUSH WILL BE REJECTED. Have a clean retry path.

RULE 4 — NEVER FORCE-PUSH. No --force, --force-with-lease, or rebasing/pushing
  main. A rejected claim-branch push means another agent won — accept it.

RULE 5 — TINY CLAIM COMMITS ONLY. Exactly THREE files: the direction file, the
  team file, INDEX.md. Nothing else.

RULE 6 — STAGGER. Sleep a random 0–30s before your first git op. (If your
  environment blocks `sleep`, instead pick a random direction from the top-3 per
  RULE 7 and proceed — the branch lock still guarantees safety.)

RULE 7 — RANDOMIZE PICK FROM THE TOP. Don't greedy-pick #1. From the top-3
  eligible directions, idx = int(AGENT_ID_hex,16) % N.

RULE 8 — RE-CHECK IMMEDIATELY BEFORE COMMITTING. Right before `git commit`,
  re-run `git ls-remote --heads origin 'claim/<direction_id>'`. If it now
  exists, abandon and restart the loop.

RULE 9 — BOUND RETRIES. Max 5 full claim-loop iterations, then exit cleanly.

RULE 10 — IF THE WORKING TREE IS DIRTY (other than a pre-existing
  `.claude/last-push.log` modification), STOP and report. Do not clean up.

RULE 11 — ONCE THE CLAIM BRANCH IS PUSHED, the pair is yours. Continue work on
  that same branch. The race is over.

RULE 12 — NEVER EDIT ANOTHER AGENT'S ROWS/FILES. Only your chosen direction
  file, your chosen team file, and those two rows in INDEX.md.

═══════════════════════════════════════════════════════════
SELF-IDENTIFY
═══════════════════════════════════════════════════════════
AGENT_ID = "agent_" + <8 random hex chars>     e.g. agent_a3f91c2e

═══════════════════════════════════════════════════════════
PRE-FLIGHT (any failure → STOP and report, do not proceed)
═══════════════════════════════════════════════════════════
1. `git status` — clean except possibly ` M .claude/last-push.log`. Anything
   else dirty or untracked under `.claude/coordination/` → STOP.
2. `git rev-parse --abbrev-ref HEAD` — must be a `coord/rc*` branch (your
   worktree's own branch), NOT `main`.
3. `git ls-tree -r --name-only HEAD -- .claude/coordination | wc -l` == 21.
   If not, the scaffold isn't present → STOP (coordinator/merge step missing).
4. `git ls-remote origin -h refs/heads/main` succeeds (auth OK). You will NOT
   push main; this only checks connectivity.
5. WORKTREE ISOLATION: `git rev-parse --show-toplevel` must be a
   `.../apps/ai-engineer-roadmap-rc<N>` path, NOT
   `.../apps/ai-engineer-roadmap` (the primary tree). If it is the primary
   tree, or matches another running agent's path → STOP and ask the operator.

═══════════════════════════════════════════════════════════
CLAIM ALGORITHM  (loop up to 5×)
═══════════════════════════════════════════════════════════
  1. SYNC (worktree-safe, no `checkout main`, local only):
       git fetch origin --prune
       git reset --hard origin/main      # you are on coord/rcN; this is local

  2. DERIVE LIVE CLAIM STATE FROM THE REMOTE, NOT INDEX.md:
       CLAIMED = { direction ids X : refs/heads/claim/<X> exists }
         via:  git ls-remote --heads origin 'claim/*'
       From .claude/coordination/INDEX.md read ONLY the static fields:
         priority, depends_on, suggested_team_archetype.
       ELIGIBLE_DIRECTIONS = directions NOT in CLAIMED
         AND every depends_on id is in COMPLETED
         (COMPLETED = direction whose claim/<id> PR is merged to main AND its
          INDEX row reads `completed`; in wave 1 this excludes direction_07).
       AVAILABLE_TEAMS = teams with no `claim/*` branch having claimed them
         (parse the team id from each claim branch's tip commit, or simply
          prefer the suggested_team_archetype of your chosen direction —
          1:1 mapping makes team contention a non-issue).

  3. If ELIGIBLE_DIRECTIONS is empty → exit: "no eligible directions, exiting".

  4. PICK DIRECTION: sort ELIGIBLE by priority DESC, then id ASC.
       N = min(3, len); idx = int(AGENT_ID_hex,16) % N; chosen = sorted[idx].

  5. PICK TEAM: use chosen_direction.suggested_team_archetype → that team_id
     (the scaffold is 1:1, so this is the natural, collision-free choice).

  6. RE-CHECK: git ls-remote --heads origin 'claim/<direction_id>'
     If it exists now → restart loop.

  7. git checkout -b claim/<direction_id>      # branch name == direction id == the lock
     Edit ONLY:
       (a) directions/<direction_id>.md : status: claimed,
           claimed_by_team: <team_id>, claimed_at: <ISO-8601 UTC>
       (b) teams/<team_id>.md           : status: claimed,
           claimed_direction: <direction_id>, claimed_at: <ISO-8601 UTC>
       (c) INDEX.md — those two rows ONLY
     git commit -am "claim(<direction_id>): <team_id> via <AGENT_ID>"

  8. THE RACE — push the claim branch (NOT main):
       git push -u origin claim/<direction_id>
     Exactly one agent per direction succeeds. Losers see
       ! [rejected] ... (fetch first)  OR  (reference already exists)
       error: failed to push some refs
     That rejection is your "race lost" signal.

  9. If REJECTED:
       git checkout coord/rc<N>                 # your own worktree branch
       git branch -D claim/<direction_id>
       git reset --hard origin/main             # local only; never touched main
       (sleep random 5–20s if available)
       continue loop

 10. If SUCCEEDED — you own it:
       gh pr create --draft --base main --head claim/<direction_id> \
         --title "claim: <direction_id> by <team_id>" \
         --body  "Atomic claim via branch-as-lock. Work continues on this branch."
       Second commit on the SAME branch: flip both files
         status: claimed → in_progress  (direction) / active (team)
       git push origin claim/<direction_id>
       Break loop → EXECUTE.

After 5 failed iterations: exit "could not claim after 5 attempts".

═══════════════════════════════════════════════════════════
EXECUTE  (only after the claim branch is pushed)
═══════════════════════════════════════════════════════════
All work stays on `claim/<direction_id>` in your worktree. Never push main.
node_modules: if `pnpm build`/typecheck is needed, symlink from the primary
tree's node_modules (repo convention) — do NOT `git add` the symlink.

PHASE A — Plan: append "## Execution Plan" to the direction file (scope in/out,
  deliverables, measurement plan, risk log, cost budget).
PHASE B — Baseline: measure success metrics BEFORE any code change. Save to
  .claude/coordination/results/<direction_id>/baseline.{json,log}. Never skip.
PHASE C — Implement: small conventional commits. Tripwires → mark the direction
  `blocked`, push, STOP (do not force):
    • DeepEval gate drops >0.05 below baseline
    • production-path test red after 2 fix attempts
    • cost 2× over budget
    • a migration would break existing rows
PHASE D — Verify: re-run the SAME measurement → final.{json,log}. Diff table
  Metric | Baseline | Final | Target | Pass?. Required gates (only those that
  apply): `pnpm typecheck`, `pnpm test:backend`, `pnpm test:deepeval`,
  `pnpm build` (always). Never lower a threshold to pass.
PHASE E — Document: fill "## Findings" in the direction file (what you built,
  diff table, files changed, migrations, follow-ups, actual cost).
PHASE F — Ship: `gh pr ready` (un-draft the existing claim PR; do NOT open a
  second PR). Final commit flips direction → completed, team → finished,
  updates the two INDEX rows. Push the branch. DO NOT self-merge.

═══════════════════════════════════════════════════════════
NON-NEGOTIABLES
═══════════════════════════════════════════════════════════
Never push or force-push main. Never edit another agent's files/rows. Never
lower an eval threshold. Never commit secrets or .env*. Never skip baseline.

═══════════════════════════════════════════════════════════
FINAL OUTPUT
═══════════════════════════════════════════════════════════
  AGENT_ID: <agent_xxxxxxxx>
  TEAM:     <team_id> — <name>
  CLAIMED:  <direction_id> — <title>
  PR:       <draft/ready url>
  METRICS:  <one-line baseline → final>
  COST:     $<amount>
  NEXT:     <one sentence>
If exited without claiming:
  AGENT_ID: <agent_xxxxxxxx>
  RESULT:   <reason>

═══════════════════════════════════════════════════════════
OPERATOR NOTES (not part of the agent prompt)
═══════════════════════════════════════════════════════════
PR #30 is merged — scaffold is on origin/main. 10 worktrees exist:
  /Users/vadimnicolai/Public/ai-apps/apps/ai-engineer-roadmap-rc1   [coord/rc1]
  ...
  /Users/vadimnicolai/Public/ai-apps/apps/ai-engineer-roadmap-rc10  [coord/rc10]
Start each of the 10 Claude Code sessions with its cwd set to a DISTINCT
rc<N> worktree, then paste everything from the SELF-IDENTIFY line down to
FINAL OUTPUT. Do not run two sessions in the same worktree.
direction_07 stays dependency-blocked until direction_02 & direction_03 PRs
are merged and marked completed — expect 9 claims in wave 1, not 10.
