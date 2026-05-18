#!/usr/bin/env bash
#
# Regenerate an application's prep artifact via the `deepseek-loop` CLI agent.
#
# The agent Reads the committed data/app-prep/<slug>.json (for the job
# description it must keep verbatim), regenerates aiInterviewQuestions +
# aiTechStack, and Writes the file back in the exact PrepArtifact shape that
# lib/app-prep-seed.ts / scripts/test-app-prep-seed.ts expect.
#
# This is the GENERATION step only. Validate with `pnpm test:app-prep`, then
# push into Neon with `pnpm prep:db`.
#
#   pnpm prep:loop                 # ECB SSM Cockpit Developer (default)
#   pnpm prep:loop <slug>
#
# Exits non-zero if the artifact is missing, the agent run fails, or no
# terminal success Result is emitted.

set -euo pipefail

SLUG="${1:-european-central-bank-ssm-cockpit-developer}"
APP_DIR="/Users/vadimnicolai/Public/ai-apps/apps/ai-engineer-roadmap"
LOOP_CRATE="/Users/vadimnicolai/Public/ai-apps/crates/deepseek-loop"
MONO_ENV="/Users/vadimnicolai/Public/ai-apps/.env"
ART="$APP_DIR/data/app-prep/$SLUG.json"
LOG="/tmp/prep-loop-$SLUG.ndjson"

[ -f "$ART" ] || { echo "ERROR: $ART not found — it carries the job description the agent reads." >&2; exit 1; }

# The Rust agent does not load .env; export the key from the monorepo-root .env
# (NOT .env.local — its LLM_BASE_URL is dead). Same gotcha as gen-app-prep.
DEEPSEEK_API_KEY="$(grep -m1 '^DEEPSEEK_API_KEY=' "$MONO_ENV" | cut -d= -f2- | tr -d '[:space:]')"
[ -n "$DEEPSEEK_API_KEY" ] || { echo "ERROR: DEEPSEEK_API_KEY missing from $MONO_ENV" >&2; exit 1; }
export DEEPSEEK_API_KEY

PROMPT=$(cat <<EOF
You are regenerating a job-application interview-prep artifact.

1. Use the Read tool to read this exact file:
   $ART
   It is JSON. Keep these fields EXACTLY as they are: slug, company, position,
   url, status, jobDescription.

2. From its "jobDescription" (plus company/position), generate:

   - "aiInterviewQuestions": GitHub-flavored Markdown, high-signal, specific to
     the JD. It MUST contain exactly these four level-2 headings, in order:
       ## Technical screen likely topics
       ## System design scenarios
       ## Behavioral themes
       ## Questions to ask them
     (bulleted, concrete, no padding; ~6-10 technical topics, 2-3 system-design
     prompts, 4-6 behavioral themes, 5 questions).

   - "aiTechStack": a JSON STRING (the array JSON-encoded as a string, NOT a
     nested array) of 8-20 objects, each:
       {"tag": kebab-case-id, "label": "Human Name",
        "category": one of EXACTLY
          "Databases & Storage" | "Backend Frameworks" | "Frontend Frameworks"
          | "Cloud & DevOps" | "Languages" | "Testing & Quality"
          | "API & Communication",
        "relevance": "primary" | "secondary"}
     Skip soft skills/seniority. Merge synonyms.

3. Use the Write tool to overwrite $ART with a single JSON object having EXACTLY
   these keys: slug, company, position, url, status, jobDescription,
   aiInterviewQuestions, aiTechStack, generatedAt
   - slug/company/position/url/status/jobDescription: copied verbatim from step 1
   - generatedAt: the current UTC time in ISO-8601 (e.g. 2026-05-18T12:34:56Z)
   - valid JSON, UTF-8, no trailing prose.

Do ONLY this. After the Write succeeds, stop.
EOF
)

echo "==> deepseek-loop: regenerating $ART"
cd "$LOOP_CRATE"
printf '%s' "$PROMPT" | cargo run -q --features cli --release --bin deepseek-loop -- \
  --model deepseek-v4-pro \
  --permission-mode acceptEdits \
  --allowed-tools Read,Write \
  --max-turns 6 \
  --max-budget-usd 0.30 \
  2>&1 | tee "$LOG"

# SdkMessage is serde(tag="type", snake_case); terminal success is
# {"type":"result","subtype":"success",...}.
if ! grep -q '"type":"result"' "$LOG"; then
  echo "ERROR: agent emitted no terminal Result (see $LOG)." >&2
  exit 1
fi
if ! grep -q '"type":"result"[^}]*"subtype":"success"' "$LOG" \
   && ! grep -q '"subtype":"success"' "$LOG"; then
  echo "ERROR: agent run did not end in success (see $LOG)." >&2
  exit 1
fi

echo "==> done. Validate next:  pnpm test:app-prep   then  pnpm prep:db"
