# Stage-2 prompt — FINAL (branch-as-lock, worktree-safe, paste-ready)

The block between the two `=== PASTE BELOW ===` / `=== PASTE ABOVE ===` markers is
identical for all 10 tabs. The only per-tab difference is the working directory the
operator starts each Claude Code session in (see OPERATOR NOTES at the bottom).

=== PASTE BELOW ===

You are an autonomous execution agent for the ai-engineer-roadmap repo. You are ONE
of 10 parallel agents, each running in its own dedicated git worktree, all given
this exact prompt. You self-assign exactly ONE direction (and its 1:1 team) via an
atomic remote-branch lock, then execute it. You do NOT know which agent you are.

────────────────────────────────────────────────────────────
KEY FACTS ABOUT THIS REPO (do not relearn the hard way)
────────────────────────────────────────────────────────────
• Direct pushes to `main` are BLOCKED by a server guard — even fast-forward. The
  lock is therefore a remote branch, never a main push. NEVER force-push anything.
• The scaffold mapping is strictly 1:1: `direction_NN` ⇄ `team_NN` (see each
  direction's `suggested_team_archetype`). Claiming a direction claims its team.
  There is no separate team race.
• Agent-branch pushes can SILENTLY no-op here. Always push with `-u` AND verify the
  remote ref afterward (commands below). An unverified push is not a claim.
• During the race, `main`'s `INDEX.md` is NOT a live claim signal (claims live on
  side branches). The set of remote `claim/*` branches IS the live signal.

────────────────────────────────────────────────────────────
RACE SAFETY RULES
────────────────────────────────────────────────────────────
R1  The lock is a verified remote branch `claim/<direction_id>`. Local branches
    and file contents prove nothing. Only `git ls-remote` confirming your ref
    proves ownership.
R2  Always `git fetch origin --prune` and re-list remote `claim/*` before deciding.
R3  Assume you will LOSE the race. Every attempt has a clean retry path.
R4  NEVER `--force`, `--force-with-lease`, rebase main, or push main.
R5  The claim commit touches exactly THREE files: your direction file, your team
    file, INDEX.md. Make all three edits then commit+push in ONE uninterrupted
    sequence (a Stop-time hook may auto-commit/revert partial edits — do not pause
    mid-claim).
R6  (Optional) jitter before first git op if `sleep` works; skip if blocked —
    branch-as-lock makes collisions cheap and safe regardless.
R7  Don't greedy-pick #1. Pick from the top-3 eligible by an AGENT_ID hash (below).
R8  Immediately before committing, re-list remote `claim/*`. If your target now
    has a `claim/` branch, abandon and restart the loop.
R9  Max 5 claim-loop iterations, then exit cleanly with the RESULT line.
R10 If the working tree is dirty with anything other than possibly
    ` M .claude/last-push.log`, or pre-flight fails, STOP and report. Do not
    "clean up".
R11 Once your claim push is VERIFIED, the pair is yours. Continue all work on that
    same `claim/<direction_id>` branch. The race is over for you.
R12 Only ever edit your own direction file, your own team file, and those two rows
    in INDEX.md. Never touch another direction/team/row.

────────────────────────────────────────────────────────────
SELF-IDENTIFY
────────────────────────────────────────────────────────────
Run: `AGENT_ID="agent_$(openssl rand -hex 4)"; echo "$AGENT_ID"`
(If openssl is unavailable: `AGENT_ID="agent_$(python3 -c 'import secrets;print(secrets.token_hex(4))')"`.)
Use this exact AGENT_ID in commit messages and the final output.

────────────────────────────────────────────────────────────
PRE-FLIGHT  (any failure → STOP and print the RESULT line)
────────────────────────────────────────────────────────────
P1  `git status --porcelain` — empty, or only ` M .claude/last-push.log`.
P2  `git rev-parse --abbrev-ref HEAD` — must be a `coord/rc*` branch (your
    worktree's own branch), NOT `main`.
P3  `git rev-parse --show-toplevel` — must end in `/apps/ai-engineer-roadmap-rc<N>`,
    NOT `/apps/ai-engineer-roadmap` (the shared primary tree). If it is the primary
    tree → STOP (you'd corrupt other agents).
P4  `git ls-tree -r --name-only HEAD -- .claude/coordination | wc -l` — must be ≥ 21
    (scaffold present). If not → STOP (coordinator/merge step missing).
P5  `git ls-remote origin -h refs/heads/main >/dev/null` succeeds (git auth OK).
P6  `gh auth status` succeeds (you will open a draft PR later).

────────────────────────────────────────────────────────────
CLAIM ALGORITHM  (loop up to 5×)
────────────────────────────────────────────────────────────
1. SYNC (local only — never checkout/push main):
     git fetch origin --prune
     git reset --hard origin/main          # you stay on coord/rc<N>

2. LIVE CLAIM STATE FROM THE REMOTE:
     git ls-remote --heads origin 'claim/*'
   CLAIMED = the set of direction ids X where `refs/heads/claim/direction_<X>`
   exists (parse the trailing `claim/<direction_id>` from each line).
   From .claude/coordination/INDEX.md read ONLY static fields: priority,
   depends_on, suggested_team_archetype.
   COMPLETED = a direction whose INDEX row reads `completed` (its PR already
   merged). In the first wave this is empty.
   ELIGIBLE = directions NOT in CLAIMED whose every depends_on id is in COMPLETED.
   (⇒ direction_07 is ineligible until direction_02 AND direction_03 are completed.)

3. If ELIGIBLE is empty → exit: print RESULT "no eligible directions, exiting".

4. PICK DIRECTION: sort ELIGIBLE by priority DESC then id ASC. Let N = min(3, len).
   HEX = last 8 hex chars of AGENT_ID; idx = (int(HEX, 16)) % N.
   chosen_direction = sorted[idx].  chosen_team = its suggested_team_archetype.

5. RE-CHECK (R8): `git ls-remote --heads origin 'claim/<chosen_direction>'`
   — if it now exists, restart the loop from step 1.

6. CREATE CLAIM (atomic, uninterrupted — R5):
     git checkout -b claim/<chosen_direction>
   Edit exactly these three, then commit in the same step:
     (a) .claude/coordination/directions/<chosen_direction>_*.md frontmatter:
           status: claimed
           claimed_by_team: <chosen_team>
           claimed_at: <current ISO-8601 UTC, e.g. 2026-05-17T09:14:00Z>
     (b) .claude/coordination/teams/<chosen_team>_*.md frontmatter:
           status: claimed
           claimed_direction: <chosen_direction>
           claimed_at: <same timestamp>
     (c) .claude/coordination/INDEX.md — ONLY your direction's row (set Status,
         Team) and your team's row (set Status, Direction). No other rows.
     git commit -am "claim(<chosen_direction>): <chosen_team> via $AGENT_ID"

7. THE RACE — push the claim branch (NEVER main) and VERIFY:
     git push -u origin claim/<chosen_direction>
     LOCAL=$(git rev-parse HEAD)
     REMOTE=$(git ls-remote --heads origin claim/<chosen_direction> | awk '{print $1}')
   CLAIM IS VALID ONLY IF: push exit code 0 AND REMOTE == LOCAL.
   (Rejected push, empty REMOTE, or mismatch = you lost or the push silently
   failed — same handling.)

8. IF NOT VALID:
     git checkout coord/rc<N>          # your own worktree branch
     git branch -D claim/<chosen_direction>
     git reset --hard origin/main
     (sleep 5–20s if available)
     continue loop   # next pass re-derives ELIGIBLE; never reattempt this same id

9. IF VALID — you own it:
     gh pr create --draft --base main --head claim/<chosen_direction> \
       --title "claim: <chosen_direction> by <chosen_team>" \
       --body  "Atomic claim via branch-as-lock. Work continues on this branch."
   Second commit on the SAME branch: flip status `claimed`→`in_progress`
   (direction) / `claimed`→`active` (team) in both files + INDEX rows, then:
     git commit -am "start(<chosen_direction>): $AGENT_ID"
     git push origin claim/<chosen_direction>
   Break the loop → EXECUTE.

After 5 invalid iterations: print RESULT "could not claim after 5 attempts".

────────────────────────────────────────────────────────────
EXECUTE  (only after a VERIFIED claim; all work on claim/<direction_id>)
────────────────────────────────────────────────────────────
Never push or touch main. If `pnpm build`/typecheck is needed, symlink
node_modules from the primary tree (../ai-engineer-roadmap/node_modules) — do NOT
`git add` the symlink.

A. PLAN — append "## Execution Plan" to the direction file: scope in/out,
   deliverables, measurement plan, risk log, cost budget ($).
B. BASELINE — measure the success metrics BEFORE any code change. Save to
   .claude/coordination/results/<direction_id>/baseline.{json,log}. Never skip.
C. IMPLEMENT — small conventional commits. Tripwire → set direction `blocked`,
   commit, push, STOP (do not force through):
     • DeepEval gate drops >0.05 below baseline
     • a production-path test stays red after 2 fix attempts
     • cost exceeds 2× budget
     • a migration would break existing rows
D. VERIFY — re-run the SAME measurement → final.{json,log}. Build a table:
   Metric | Baseline | Final | Target | Pass?. Run only the applicable gates:
   `pnpm typecheck` (TS touched), `pnpm test:backend` (backend touched),
   `pnpm test:deepeval` (LLM-graph touched), `pnpm build` (always).
   Never lower a threshold to make a gate pass.
E. DOCUMENT — fill "## Findings" in the direction file: what you built, the diff
   table, files changed, migrations, follow-ups, actual cost.
F. SHIP — `gh pr ready` (un-draft the existing claim PR; do NOT open a 2nd PR).
   Final commit flips direction→`completed`, team→`finished`, updates both INDEX
   rows. Push the branch. DO NOT self-merge.

────────────────────────────────────────────────────────────
NON-NEGOTIABLES
────────────────────────────────────────────────────────────
Never push/force-push main. Never edit another agent's files or rows. Never lower
an eval threshold. Never commit secrets or .env*. Never skip the baseline. An
unverified push is never a claim.

────────────────────────────────────────────────────────────
FINAL OUTPUT (print exactly this)
────────────────────────────────────────────────────────────
  AGENT_ID: <agent_xxxxxxxx>
  TEAM:     <team_id> — <name>
  CLAIMED:  <direction_id> — <title>
  PR:       <url>
  METRICS:  <one-line baseline → final>
  COST:     $<amount>
  NEXT:     <one sentence>
If you exited without a verified claim, instead print:
  AGENT_ID: <agent_xxxxxxxx>
  RESULT:   <reason>

=== PASTE ABOVE ===

────────────────────────────────────────────────────────────
OPERATOR NOTES (do NOT paste into the tabs)
────────────────────────────────────────────────────────────
Scaffold is merged to origin/main (PR #30). Start each of the 10 Claude Code
sessions with its working directory set to a DISTINCT worktree, then paste the
block above:
  rc1  → /Users/vadimnicolai/Public/ai-apps/apps/ai-engineer-roadmap-rc1
  rc2  → …-rc2     rc3 → …-rc3     …     rc10 → …-rc10
Each is on its own branch coord/rc1..10 off origin/main. Never run two sessions in
the same worktree. Expect 9 successful claims in wave 1 — direction_07 stays
dependency-blocked until direction_02 and direction_03 are completed (their PRs
merged). Claims appear as draft PRs `claim: direction_NN by team_NN`; merge each
direction's PR (gh pr merge --rebase) only after you've reviewed its Findings.
