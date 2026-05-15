#!/usr/bin/env python3
"""PostToolUse hook: nudges Claude to update README.md after significant file changes."""
import json, sys, os

data = json.load(sys.stdin)
fp = data.get("tool_input", {}).get("file_path", "")

SIGNIFICANT = [
    "schema", "route", "middleware", "config", "component",
    "/api/", "/lib/", "/src/", "/app/", "scripts/",
    "drizzle", "package.json", "next.config", "vercel.json",
    "evals/", "sql/", "migrations/",
]
SKIP = ["README", "node_modules", ".claude", ".env", "tsconfig", "tsbuild", ".json.lock"]

if fp and any(p in fp for p in SIGNIFICANT) and not any(p in fp for p in SKIP):
    name = os.path.basename(fp)
    msg = (
        f"You just modified `{name}`. "
        "If this change affects architecture, data flow, stack, API routes, "
        "schema, or directory structure described in README.md — update it."
    )
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PostToolUse",
            "additionalContext": msg,
        }
    }))
