"""Article structure quality gate.

Extracted verbatim from article_generate_graph.py so the same gate can be
applied to the existing corpus (scripts/content_gate_scan.py) without importing
the LangGraph pipeline. check_quality() is byte-identical to the original — do
not change thresholds or regexes here; review_node/revise_node depend on it.
"""

from __future__ import annotations

import re
from typing import Any

MIN_WORD_COUNT = 1500
MIN_CODE_BLOCKS = 2
MIN_CROSS_REFS = 1
MIN_MERMAID_BLOCKS = 5


def check_quality(content: str) -> dict[str, Any]:
    words = [w for w in re.split(r"\s+", content) if w]
    word_count = len(words)
    code_blocks = len(re.findall(r"```\w+", content))
    cross_refs = len(re.findall(r"\]\(/[\w-]+\)", content))
    has_title = content.lstrip().startswith("# ")
    section_count = len(re.findall(r"^## ", content, flags=re.MULTILINE))
    xyflow_blocks = len(re.findall(r"```xyflow\b", content))
    mermaid_blocks = len(re.findall(r"```mermaid\b", content))
    has_mental_model = bool(re.search(r"^##\s+Mental Model\b", content, flags=re.MULTILINE))
    has_runtime_internals = bool(re.search(r"^##\s+Runtime Internals\b", content, flags=re.MULTILINE))

    issues: list[str] = []
    if word_count < MIN_WORD_COUNT:
        issues.append(f"Too short: {word_count} words (min {MIN_WORD_COUNT})")
    if code_blocks < MIN_CODE_BLOCKS:
        issues.append(f"Too few code examples: {code_blocks} (min {MIN_CODE_BLOCKS})")
    if cross_refs < MIN_CROSS_REFS:
        issues.append(f"Missing cross-references: {cross_refs} (min {MIN_CROSS_REFS})")
    if not has_title:
        issues.append("Missing # title on first line")
    if section_count < 3:
        issues.append("Fewer than 3 ## sections")
    if xyflow_blocks < MIN_MERMAID_BLOCKS:
        issues.append(
            f"Too few xyflow diagrams: {xyflow_blocks} (min {MIN_MERMAID_BLOCKS}). "
            "Use ```xyflow JSON fences, not ```mermaid."
        )
    if mermaid_blocks > 0:
        issues.append(
            f"Found {mermaid_blocks} ```mermaid block(s) — replace each with a ```xyflow JSON diagram."
        )
    if not has_mental_model:
        issues.append("Missing `## Mental Model` section (required as the second-level section before Core Concepts).")
    if not has_runtime_internals:
        issues.append("Missing `## Runtime Internals` deep-dive section.")

    return {
        "ok": len(issues) == 0,
        "issues": issues,
        "wordCount": word_count,
        "codeBlocks": code_blocks,
        "crossRefs": cross_refs,
        "xyflowBlocks": xyflow_blocks,
    }
