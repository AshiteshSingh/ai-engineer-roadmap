#!/usr/bin/env bash
# Load dotenv files (handles `&` and other shell-metachars that `. file` trips on),
# then exec whatever command was passed. Invoked by `pnpm test:deepeval*` scripts.
#
# Usage: ./run-with-env.sh path/to/env1 [path/to/env2 …] -- command args...
set -euo pipefail

env_files=()
while [ $# -gt 0 ]; do
  if [ "$1" = "--" ]; then shift; break; fi
  env_files+=("$1"); shift
done

if [ ${#env_files[@]} -gt 0 ]; then
  exports="$(python3 - "${env_files[@]}" <<'PY'
import sys
for path in sys.argv[1:]:
    try:
        fh = open(path)
    except FileNotFoundError:
        continue
    with fh:
        for line in fh:
            line = line.rstrip("\n")
            if not line or line.lstrip().startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            key = key.strip()
            if not key or not key.replace("_", "").isalnum():
                continue
            v = val
            if (v.startswith('"') and v.endswith('"')) or (v.startswith("'") and v.endswith("'")):
                v = v[1:-1]
            v = v.replace("'", "'\\''")
            print(f"export {key}='{v}'")
PY
)"
  eval "$exports"
fi

# Deepeval: silence telemetry + first-run update prompt so pytest never blocks on stdin.
export DEEPEVAL_TELEMETRY_OPT_OUT="${DEEPEVAL_TELEMETRY_OPT_OUT:-YES}"
export DEEPEVAL_UPDATE_WARNING_OPT_IN="${DEEPEVAL_UPDATE_WARNING_OPT_IN:-NO}"
export ERROR_REPORTING="${ERROR_REPORTING:-NO}"

exec "$@" < /dev/null
