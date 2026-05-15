"""Build an AudioMeta JSON from a knowledge article's markdown so the existing
AudioPlayer (`apps/knowledge/components/audio-player.tsx`) and TTS binary
(`crates/tts/src/bin/langgraph_audio_tts.rs`) can pick it up.

The output shape mirrors `apps/knowledge/lib/audio.ts:AudioMeta` plus
`chapters[].script` and `full_script` extensions consumed by the TTS step.
H2 (`## `) headings define chapter boundaries. Code blocks, xyflow diagrams,
images, tables, and inline markdown formatting are stripped so the script
reads cleanly to a TTS voice. H3 (`### `) headings become spoken subsection
transitions ("Now, about <title>.").

Usage:
    python3 backend/scripts/build_audio_meta.py \\
        --slug langgraph \\
        --title "LangGraph — Audio Guide" \\
        --input content/langgraph.md \\
        --output data/langgraph-audio.json

Run from `apps/knowledge/`.
"""

from __future__ import annotations

import argparse
import json
import re
from dataclasses import dataclass
from pathlib import Path

NARRATION_WPM = 150  # matches `crates/langgraph-audio/src/wpm.rs`

# Skip H2 sections whose titles match these. Cross-references / see-also are
# page-navigation links; Comparison sections in this corpus are 100% markdown
# tables that vanish under TTS stripping and leave only spoken H3 titles.
SKIP_H2_TITLES = {"cross-references", "see also", "further reading", "comparison"}


@dataclass
class Chapter:
    index: int
    title: str
    start_secs: int
    duration_secs: int
    script: str


def strip_frontmatter(md: str) -> str:
    if not md.startswith("---"):
        return md
    end = md.find("\n---", 3)
    if end == -1:
        return md
    return md[end + 4 :].lstrip("\n")


def strip_markdown(text: str) -> str:
    """Strip markdown formatting to produce clean prose for TTS.

    Mirrors the regex sequence used in `crates/tts/src/bin/knowledge_tts.rs`,
    extended for xyflow diagram blocks which are knowledge-app specific.
    """
    s = text

    # Fenced code blocks of any language (```...```)
    s = re.sub(r"```.*?```", "", s, flags=re.DOTALL)

    # LaTeX display + inline math
    s = re.sub(r"\$\$.*?\$\$", "", s, flags=re.DOTALL)
    s = re.sub(r"\$[^$\n]+\$", "", s)

    # Images
    s = re.sub(r"!\[[^\]]*\]\([^)]*\)", "", s)

    # Links → keep the link text only
    s = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", s)

    # H3 (or deeper) headings → spoken transition. Strip any trailing
    # punctuation on the title so we don't emit "Now, about Foo?." after a
    # questioning subhead. H1 unlikely inside a chapter body but normalize the
    # same way.
    def _transition(match: re.Match) -> str:
        title = match.group(1).rstrip(" .!?:;,")
        return f"Now, about {title}."

    s = re.sub(r"(?m)^####\s+(.+)$", _transition, s)
    s = re.sub(r"(?m)^###\s+(.+)$", _transition, s)
    s = re.sub(r"(?m)^#\s+(.+)$", r"\1.", s)

    # Markdown hard line-breaks (two trailing spaces) → plain newline
    s = re.sub(r"  +\n", "\n", s)

    # Bold / italic markers. Italic regexes use a word-boundary anchor so
    # snake_case identifiers (e.g. `send_email, execute_sql`) survive the
    # earlier backtick-strip pass without getting their internal underscores
    # eaten across delimiters.
    s = re.sub(r"\*\*([^*]+)\*\*", r"\1", s)
    s = re.sub(r"(?<!\w)\*(?!\s)([^*\n]+?)(?<!\s)\*(?!\w)", r"\1", s)
    s = re.sub(r"__([^_]+)__", r"\1", s)
    s = re.sub(r"(?<!\w)_(?!\s)([^_\n]+?)(?<!\s)_(?!\w)", r"\1", s)

    # Tables: rows and separator lines
    s = re.sub(r"(?m)^\|.*\|$", "", s)
    s = re.sub(r"(?m)^\s*[-|:]+\s*$", "", s)

    # Bullet / numbered list markers (keep the text)
    s = re.sub(r"(?m)^\s*[-*+]\s+", "", s)
    s = re.sub(r"(?m)^\s*\d+\.\s+", "", s)

    # Inline backticks
    s = re.sub(r"`([^`]+)`", r"\1", s)

    # Collapse 3+ blank lines
    s = re.sub(r"\n{3,}", "\n\n", s)

    return s.strip()


def split_chapters(md: str) -> list[tuple[str, str]]:
    """Split markdown on H2 headings into (title, body) pairs.

    Content before the first H2 is grouped under an "Introduction" chapter
    so the opening paragraphs aren't dropped.
    """
    chapters: list[tuple[str, str]] = []
    current_title = "Introduction"
    current_body: list[str] = []

    for line in md.splitlines():
        if line.startswith("## ") and not line.startswith("### "):
            body = "\n".join(current_body).strip()
            if body:
                chapters.append((current_title, body))
            current_title = line[3:].strip()
            current_body = []
        else:
            current_body.append(line)

    body = "\n".join(current_body).strip()
    if body:
        chapters.append((current_title, body))

    return chapters


def estimate_secs(words: int) -> int:
    return round(words * 60 / NARRATION_WPM)


def build_audio_meta(
    md_path: Path, slug: str, title: str
) -> dict:
    raw = md_path.read_text(encoding="utf-8")
    md = strip_frontmatter(raw)

    # Skip the article's top-level H1 — the chapter list opens with the H2 sections.
    # (`split_chapters` will fold any pre-H2 lead-in into "Introduction".)
    md = re.sub(r"\A#\s+[^\n]+\n+", "", md, count=1)

    raw_chapters = split_chapters(md)

    chapters: list[Chapter] = []
    cumulative = 0
    full_script_parts: list[str] = []
    for raw_title, raw_body in raw_chapters:
        if raw_title.strip().lower() in SKIP_H2_TITLES:
            continue
        body = strip_markdown(raw_body)
        if not body:
            continue
        words = len(body.split())
        if words < 12:
            # Skip near-empty stub sections (one-liners that survived stripping)
            continue
        duration = estimate_secs(words)
        chapters.append(
            Chapter(
                index=len(chapters),
                title=raw_title,
                start_secs=cumulative,
                duration_secs=duration,
                script=body,
            )
        )
        cumulative += duration
        full_script_parts.append(f"## {raw_title}\n\n{body}")

    return {
        "slug": slug,
        "title": title,
        "voice": "pending-tts",
        "duration_secs": cumulative,
        "file_size_bytes": 0,
        "audio_url": "",
        "chapters": [c.__dict__ for c in chapters],
        "full_script": "\n\n".join(full_script_parts),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--slug", required=True)
    parser.add_argument("--title", required=True)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    meta = build_audio_meta(args.input, args.slug, args.title)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(meta, indent=2, ensure_ascii=False))

    total_words = sum(len(c["script"].split()) for c in meta["chapters"])
    print(
        f"wrote {args.output} — {len(meta['chapters'])} chapters, "
        f"{total_words} words, ~{meta['duration_secs']}s "
        f"({meta['duration_secs'] // 60}m {meta['duration_secs'] % 60}s)"
    )
    for ch in meta["chapters"]:
        words = len(ch["script"].split())
        print(f"  ch{ch['index']:02d} [{ch['duration_secs']:>3}s, {words:>4}w] {ch['title']}")


if __name__ == "__main__":
    main()
