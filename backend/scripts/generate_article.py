"""Pure-Python knowledge-base article generator.

Invokes the LangGraph `article_generate` StateGraph directly (no HTTP, no TS
client). The graph runs research → outline → draft → review → revise (loop) →
finalize, with DeepSeek as the per-node LLM.

Usage (run from `apps/knowledge/backend/`):
    ./run-with-env.sh ../.env.local ../../../.env -- \\
      .venv/bin/python -m scripts.generate_article \\
        --slug postgresql-joins \\
        --topic "PostgreSQL JOINs: Inner, Outer, Cross, Self, Lateral & Performance" \\
        [--category "Software Engineering"] \\
        [--related "indexing,query-optimization"]

Catalog context (existing articles, style sample) is derived by scanning the
`apps/knowledge/content/` directory directly — no Next.js / TypeScript glue.

Writes the final markdown to `apps/knowledge/content/<slug>.md`.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

# Make `knowledge_agent` importable when invoked as `python -m scripts.generate_article`
_BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

from knowledge_agent.article_generate_graph import build_graph  # noqa: E402

CONTENT_DIR = _BACKEND_DIR.parent / "content"
STYLE_SAMPLE_MAX_CHARS = 2000
EXISTING_ARTICLES_LIMIT = 40


def gather_existing_articles(current_slug: str) -> str:
    items: list[str] = []
    for path in sorted(CONTENT_DIR.glob("*.md")):
        if path.stem == current_slug:
            continue
        title = path.stem.replace("-", " ").title()
        items.append(f"- [{title}](/{path.stem})")
        if len(items) >= EXISTING_ARTICLES_LIMIT:
            break
    return "\n".join(items)


def pick_style_sample(current_slug: str) -> str:
    """Use the longest existing article (other than current) as style reference."""
    candidates = [p for p in CONTENT_DIR.glob("*.md") if p.stem != current_slug]
    if not candidates:
        return ""
    best = max(candidates, key=lambda p: p.stat().st_size)
    return best.read_text(encoding="utf-8")[:STYLE_SAMPLE_MAX_CHARS]


def humanize_slug(slug: str) -> str:
    return slug.replace("-", " ").replace("_", " ").title()


async def run(
    slug: str,
    topic: str,
    category: str,
    related: str,
) -> dict:
    state = {
        "slug": slug,
        "topic": topic,
        "category": category,
        "related_topics": related,
        "existing_articles": gather_existing_articles(slug),
        "style_sample": pick_style_sample(slug),
    }
    graph = build_graph()
    result = await graph.ainvoke(state)
    return result


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--slug", required=True, help="Article slug, e.g. postgresql-joins")
    ap.add_argument("--topic", default=None, help="Human-readable topic; defaults to titled slug")
    ap.add_argument("--category", default="", help="Lesson category (free-form)")
    ap.add_argument("--related", default="", help="Comma-separated related slugs")
    ap.add_argument("--no-write", action="store_true", help="Print but don't overwrite the .md")
    args = ap.parse_args()

    topic = args.topic or humanize_slug(args.slug)
    out_path = CONTENT_DIR / f"{args.slug}.md"
    print(f"Generating: {topic}  (slug={args.slug})")
    print(f"Output:     {out_path}")
    print("Pipeline:   research -> outline -> draft -> review -> [revise loop] -> finalize")
    print()

    result = asyncio.run(run(args.slug, topic, args.category, args.related))

    final = result.get("final", "")
    quality = result.get("quality", {})
    word_count = result.get("word_count") or quality.get("wordCount", 0)
    revisions = result.get("revisions", 0)
    issues = quality.get("issues", [])

    if args.no_write:
        print(final)
    else:
        out_path.write_text(final, encoding="utf-8")
        print(f"Wrote {out_path}")

    print(f"Done! {word_count} words, {revisions} revisions, ok={quality.get('ok', False)}")
    if issues:
        print("Quality issues:")
        for issue in issues:
            print(f"  - {issue}")
    return 0 if quality.get("ok", False) else 1


if __name__ == "__main__":
    raise SystemExit(main())
