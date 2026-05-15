"""Inline `data/<slug>.script.md` as a TypeScript module so Next.js bundles
the audio narration into the Vercel serverless function regardless of
`.vercelignore` rules on `data/`.

Run from `apps/knowledge/`:

    python3 scripts/inline-audio-script.py langgraph-lead-gen \\
        --output app/langgraph/lead-gen/_content.ts \\
        --export LANGGRAPH_LEAD_GEN_SCRIPT

Escapes are minimal and audited:
 - literal backslash (one char) → ``\\\\`` (two chars), so the template
   literal sees one backslash.
 - literal backtick (one char) → ``\\` `` (two chars), so the template
   literal sees a literal backtick rather than ending the string.
 - literal ``${`` (two chars) → ``\\${`` (three chars), so the template
   literal does NOT treat the next ``{...}`` as a placeholder.

That is exactly three replacements, and the order matters: do the backslash
pass first so we don't double-escape the backslashes we just emitted.
"""

import argparse
import re
import sys
from pathlib import Path


def inline(md_path: Path, out_path: Path, export_name: str, source_label: str) -> None:
    md = md_path.read_text(encoding="utf-8")

    escaped = md.replace("\\", "\\\\").replace("`", "\\`").replace("${", "\\${")

    header = (
        f"// AUTO-GENERATED — do not edit. Source: {source_label}\n"
        "// Rust pipeline: apps/knowledge/crates/ml/langgraph-audio (DeepSeek v4).\n"
        "// Inlined as a TS module so Next.js bundles it into the serverless\n"
        "// function unconditionally (data/ is .vercelignored).\n\n"
    )
    body = f"export const {export_name} = `{escaped}`;\n"

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(header + body, encoding="utf-8")

    print(
        f"wrote {out_path} — source {len(md):,} chars, escaped {len(escaped):,} chars, "
        f"total {len(header) + len(body):,} chars"
    )


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("slug", help="slug, e.g. `langgraph-lead-gen`")
    ap.add_argument(
        "--input",
        type=Path,
        help="override input markdown path (default: data/<slug>.script.md)",
    )
    ap.add_argument("--output", type=Path, required=True, help="TS module to write")
    ap.add_argument(
        "--export",
        dest="export_name",
        help="exported const name (default: derived from slug)",
    )
    args = ap.parse_args()

    input_path = args.input or Path(f"data/{args.slug}.script.md")
    if not input_path.exists():
        print(f"error: input not found: {input_path}", file=sys.stderr)
        sys.exit(1)

    export_name = args.export_name or _slug_to_const(args.slug)
    inline(input_path, args.output, export_name, str(input_path))


def _slug_to_const(slug: str) -> str:
    # `langgraph-lead-gen` → `LANGGRAPH_LEAD_GEN_SCRIPT`
    return re.sub(r"[^A-Z0-9]+", "_", slug.upper()).strip("_") + "_SCRIPT"


if __name__ == "__main__":
    main()
