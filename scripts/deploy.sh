#!/usr/bin/env bash
#
# Deploy ai-engineer-roadmap to Vercel production.
#
# Why this is NOT just `vercel deploy --prod` (like the sibling apps):
#   This app is a git SUBMODULE (v9ai/ai-engineer-roadmap) inside the
#   v9ai/ai-apps monorepo. A plain `vercel deploy --prod` from the monorepo
#   root does a git-aware upload that SKIPS submodule contents -> broken
#   deploy. The prebuilt flow below builds locally (files exist on disk) and
#   ships a single tgz archive, which sidesteps BOTH the submodule-upload gap
#   and the >5000-file free-tier upload cap (`api-upload-free`).
#
# Usage:  pnpm run deploy        (or)  bash scripts/deploy.sh
# Runs from anywhere; resolves paths from this script's own location.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
MONOREPO_ROOT="$(cd "$APP_DIR/../.." && pwd)"

# Vercel project: vadim-nicolais-projects/ai-engineer-roadmap
export VERCEL_ORG_ID="team_PWwGsn3xORVtRDLLoES2BYVV"
export VERCEL_PROJECT_ID="prj_HmZ37BPDql0kOnFT9iiPsnQBOryr"

# --- Guard: vercel.json buildCommand must be "pnpm run build" ---------------
# A background content-loop intermittently rewrites it to a broken turbo
# filter (turbo dies on duplicate `knowledge` workspaces from sibling
# worktrees), which fails `vercel build`. Fail fast with a clear message
# instead of producing a confusing mid-build error.
BUILD_CMD="$(cd "$APP_DIR" && node -p "require('./vercel.json').buildCommand || ''")"
if [ "$BUILD_CMD" != "pnpm run build" ]; then
  echo "ERROR: vercel.json buildCommand is \"$BUILD_CMD\", expected \"pnpm run build\"." >&2
  echo "       A background loop reverts it; fix apps/ai-engineer-roadmap/vercel.json then re-run." >&2
  exit 1
fi

cd "$MONOREPO_ROOT"

echo "==> vercel pull (production env)"
vercel pull --yes --environment=production

echo "==> vercel build --prod"
vercel build --prod

echo "==> vercel deploy --prebuilt --prod --archive=tgz"
DEPLOY_URL="$(vercel deploy --prebuilt --prod --archive=tgz | tail -n1)"
echo "Deployed: $DEPLOY_URL"

# --- Verify the apex domain ------------------------------------------------
# Deploying from a detached HEAD sometimes aliases only the generated
# *.vercel.app URL (not the apex). Verify with a cache-busted request and
# tell the operator the exact remediation command if it didn't take.
APEX="https://ai-engineer-roadmap.xyz"
echo "==> Verifying $APEX"
CODE="$(curl -s -o /dev/null -w '%{http_code}' "$APEX/?cb=$(date +%s)")"
if [ "$CODE" = "200" ]; then
  echo "OK: $APEX -> HTTP 200"
else
  echo "WARN: $APEX -> HTTP $CODE (apex may not point at this deploy)." >&2
  echo "      Run: vercel alias set \"$DEPLOY_URL\" ai-engineer-roadmap.xyz" >&2
  exit 1
fi
