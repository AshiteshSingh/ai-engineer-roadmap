"""Seed the top-N Udemy courses for an arbitrary lesson topic.

Pipeline:
    1. Subprocess to ``scripts/fetch-udemy-search.ts`` (Playwright) — Udemy is
       Cloudflare-protected so direct httpx scraping doesn't work.
    2. ``fetch_courses`` LangGraph via direct ``graph.ainvoke()`` — the same
       pattern article generation uses (no HTTP, no TS client).
    3. Upsert ranked courses into Neon Postgres ``external_courses`` and link
       them to ``lesson_courses`` via psycopg.

Usage (from ``apps/knowledge/backend/``):
    ./run-with-env.sh ../.env.local ../../.env -- \\
      .venv/bin/python -m scripts.seed_topic_courses \\
        --slug public-speaking \\
        --topic-name "Public Speaking" \\
        --search-url "https://www.udemy.com/courses/search/?q=public+speaking&sort=most-reviewed" \\
        --topic-group "Communication Skills" \\
        --count 10
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import subprocess
import sys
from pathlib import Path

import psycopg

_BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

from knowledge_agent.fetch_courses_graph import build_graph  # noqa: E402

_KNOWLEDGE_ROOT = _BACKEND_DIR.parent

UPSERT_COURSE_SQL = """
INSERT INTO external_courses (
    title, url, provider, description, level,
    rating, review_count, duration_hours, is_free, enrolled,
    image_url, language, topic_group, metadata, updated_at
) VALUES (
    %s, %s, %s, %s, %s,
    %s, %s, %s, %s, %s,
    %s, %s, %s, %s::jsonb, NOW()
)
ON CONFLICT (url) DO UPDATE SET
    title = EXCLUDED.title,
    provider = EXCLUDED.provider,
    description = EXCLUDED.description,
    level = EXCLUDED.level,
    rating = EXCLUDED.rating,
    review_count = EXCLUDED.review_count,
    duration_hours = EXCLUDED.duration_hours,
    is_free = EXCLUDED.is_free,
    enrolled = EXCLUDED.enrolled,
    image_url = EXCLUDED.image_url,
    language = EXCLUDED.language,
    topic_group = EXCLUDED.topic_group,
    metadata = EXCLUDED.metadata,
    updated_at = NOW()
RETURNING id;
"""

UPSERT_LESSON_COURSE_SQL = """
INSERT INTO lesson_courses (lesson_slug, course_id, relevance)
VALUES (%s, %s, %s)
ON CONFLICT (lesson_slug, course_id) DO UPDATE
SET relevance = EXCLUDED.relevance;
"""


def slim_metadata(course: dict) -> dict:
    """Drop bulky fields to keep DB row size small (mirrors TS scraper)."""
    metadata = dict(course.get("metadata") or {})
    metadata.pop("requirements", None)
    metadata.pop("targetAudience", None)
    learn = metadata.get("whatYoullLearn") or []
    if isinstance(learn, list):
        metadata["whatYoullLearn"] = learn[:8]
    curriculum = metadata.get("curriculum") or []
    if isinstance(curriculum, list):
        metadata["curriculum"] = curriculum[:20]
    return metadata


def truncate_description(desc: str | None) -> str | None:
    if not desc:
        return None
    return desc[:1500]


def run_ts_scraper(search_url: str, max_courses: int) -> list[dict]:
    """Run scripts/fetch-udemy-search.ts and return the parsed course list."""
    cwd = _KNOWLEDGE_ROOT
    cmd = [
        "pnpm",
        "tsx",
        "scripts/fetch-udemy-search.ts",
        search_url,
        "--max",
        str(max_courses),
    ]
    print(f"$ {' '.join(cmd)}\n  (cwd={cwd})", file=sys.stderr)
    proc = subprocess.run(
        cmd,
        cwd=cwd,
        capture_output=True,
        text=True,
        timeout=900,
        check=False,
    )
    # TS script writes progress to stderr — surface it to the user.
    if proc.stderr:
        sys.stderr.write(proc.stderr)
    if proc.returncode != 0:
        raise RuntimeError(
            f"fetch-udemy-search.ts exited {proc.returncode}; see stderr above."
        )
    out = proc.stdout.strip().splitlines()
    if not out:
        raise RuntimeError("scraper returned no stdout")
    payload = json.loads(out[-1])
    return payload.get("courses") or []


async def run_graph(
    courses: list[dict],
    topic_name: str,
    count: int,
    topic_group: str,
) -> dict:
    graph = build_graph()
    state = {
        "courses": courses,
        "topic_name": topic_name,
        "count": count,
        "topic_group": topic_group,
    }
    return await graph.ainvoke(state)


def persist(
    db_url: str,
    lesson_slug: str,
    topic_group: str,
    ranked: list[dict],
    courses_by_url: dict[str, dict],
) -> int:
    saved = 0
    with psycopg.connect(db_url) as conn:
        with conn.cursor() as cur:
            for r in ranked:
                url = r.get("url")
                course = courses_by_url.get(url) if url else None
                if not course:
                    print(f"  skip (LLM returned unknown url): {url}", file=sys.stderr)
                    continue
                metadata = slim_metadata(course)
                cur.execute(
                    UPSERT_COURSE_SQL,
                    (
                        course["title"],
                        course["url"],
                        "Udemy",
                        truncate_description(course.get("description")),
                        course.get("level"),
                        course.get("rating"),
                        course.get("reviewCount"),
                        course.get("durationHours"),
                        course.get("isFree", False),
                        course.get("enrolled"),
                        course.get("imageUrl"),
                        course.get("language") or "English",
                        topic_group,
                        json.dumps(metadata, ensure_ascii=False),
                    ),
                )
                row = cur.fetchone()
                if not row:
                    continue
                course_id = row[0]
                cur.execute(
                    UPSERT_LESSON_COURSE_SQL,
                    (lesson_slug, course_id, float(r.get("relevance") or 0.5)),
                )
                saved += 1
                print(
                    f"  ✓ {course['title'][:70]}  rel={r.get('relevance')}  why={r.get('why')}",
                    file=sys.stderr,
                )
        conn.commit()
    return saved


async def main_async(args: argparse.Namespace) -> int:
    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        print("DATABASE_URL is required", file=sys.stderr)
        return 1

    print(f"Step 1/3: scraping Udemy for top {args.max} candidates", file=sys.stderr)
    candidates = run_ts_scraper(args.search_url, args.max)
    if not candidates:
        print("No candidates scraped — aborting.", file=sys.stderr)
        return 1
    print(f"  scraped {len(candidates)} candidates", file=sys.stderr)

    print(f"\nStep 2/3: ranking via fetch_courses LangGraph", file=sys.stderr)
    result = await run_graph(
        candidates, args.topic_name, args.count, args.topic_group
    )
    ranked = result.get("ranked") or []
    summary = result.get("summary") or ""
    print(f"  ranked {len(ranked)} courses", file=sys.stderr)
    if summary:
        print(f"\n  Summary: {summary}\n", file=sys.stderr)

    print(f"Step 3/3: persisting to Neon Postgres", file=sys.stderr)
    by_url = {c.get("url"): c for c in candidates}
    saved = persist(db_url, args.slug, args.topic_group, ranked, by_url)
    print(
        f"\nDone. Saved {saved} course(s) and linked to lesson '{args.slug}'.",
        file=sys.stderr,
    )
    return 0 if saved > 0 else 1


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--slug", required=True, help="Lesson slug (e.g. public-speaking)")
    ap.add_argument("--topic-name", required=True, help='Human topic name (e.g. "Public Speaking")')
    ap.add_argument("--search-url", required=True, help="Udemy search URL")
    ap.add_argument("--topic-group", default="", help="DB topic_group bucket")
    ap.add_argument("--count", type=int, default=10, help="Top N to keep (default 10)")
    ap.add_argument("--max", type=int, default=25, help="Max candidates to scrape (default 25)")
    args = ap.parse_args()
    return asyncio.run(main_async(args))


if __name__ == "__main__":
    raise SystemExit(main())
