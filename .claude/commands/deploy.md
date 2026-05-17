---
description: Deploy ai-engineer-roadmap to Vercel production (submodule-safe prebuilt flow)
allowed-tools: Bash(pnpm run deploy), Bash(bash scripts/deploy.sh), Bash(git -C *), Read
---

Deploy this app (`ai-engineer-roadmap`, a git submodule) to Vercel production.

Do this:

1. Run `pnpm run deploy` from the app directory. This invokes `scripts/deploy.sh`,
   which: guards `vercel.json` buildCommand (`pnpm run build`), `cd`s to the
   monorepo root, runs `vercel pull --yes --environment=production` →
   `vercel build --prod` → `vercel deploy --prebuilt --prod --archive=tgz`,
   then verifies `https://ai-engineer-roadmap.xyz` (HTTP 200, cache-busted).

2. Do NOT substitute a plain `vercel deploy --prod` — this app is a git
   submodule and that form silently skips submodule contents (broken deploy).
   The prebuilt + `--archive=tgz` flow in the script is the only one that works.

3. If the script exits non-zero on the buildCommand guard, fix
   `apps/ai-engineer-roadmap/vercel.json` back to `"buildCommand": "pnpm run build"`
   (a background content-loop reverts it) and re-run.

4. If the apex check fails, run the `vercel alias set <deploy-url> ai-engineer-roadmap.xyz`
   command the script prints, then re-verify the apex.

5. If the submodule working tree ended up on a detached HEAD or feature branch
   for the deploy, restore it: `git -C . checkout main` (keep `.next`/`.vercel`
   untracked so the Stop-hook/loops don't commit onto a detached HEAD).

Report the final deployment URL and the apex HTTP status. $ARGUMENTS
