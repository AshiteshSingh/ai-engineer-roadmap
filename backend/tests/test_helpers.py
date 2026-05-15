"""Unit tests for pure helper functions — no network, no LLM."""

from __future__ import annotations

from knowledge_agent.article_generate_graph import (
    MAX_REVISIONS,
    MIN_CODE_BLOCKS,
    MIN_CROSS_REFS,
    MIN_WORD_COUNT,
    _after_revise,
    check_quality,
)
from knowledge_agent.course_review_graph import (
    _EXPERTS,
    _format_course_info,
    _normalize_expert,
)
from knowledge_agent.memorize_generate_graph import _category_id


# ── article_generate ───────────────────────────────────────────────────────


def _long_article() -> str:
    body = "word " * (MIN_WORD_COUNT + 100)
    return (
        "# Title\n\n"
        + body
        + "\n\n## Section one\n\n"
        + "```python\nprint('hi')\n```\n\n"
        + "## Section two\n\n"
        + "```typescript\nconsole.log('hi')\n```\n\n"
        + "## Section three\n\nSee [related](/some-slug) for details.\n"
    )


def test_check_quality_passes_on_well_formed_article():
    q = check_quality(_long_article())
    assert q["ok"] is True
    assert q["issues"] == []
    assert q["wordCount"] >= MIN_WORD_COUNT
    assert q["codeBlocks"] >= MIN_CODE_BLOCKS
    assert q["crossRefs"] >= MIN_CROSS_REFS


def test_check_quality_flags_short_and_missing_sections():
    q = check_quality("Too short, no title, no code, no refs.")
    assert q["ok"] is False
    assert any("Too short" in issue for issue in q["issues"])
    assert any("title" in issue.lower() for issue in q["issues"])
    assert any("sections" in issue.lower() for issue in q["issues"])


def test_check_quality_flags_missing_code_and_refs_when_body_long_enough():
    body = "# Title\n\n" + ("word " * (MIN_WORD_COUNT + 50)) + "\n\n## a\n## b\n## c\n"
    q = check_quality(body)
    assert q["ok"] is False
    assert any("code examples" in issue for issue in q["issues"])
    assert any("cross-references" in issue for issue in q["issues"])


def test_after_revise_finalizes_when_quality_ok():
    state = {"quality": {"ok": True}, "revision": 0}
    assert _after_revise(state) == "finalize"


def test_after_revise_revises_while_under_limit():
    state = {"quality": {"ok": False, "issues": ["x"]}, "revision": 0}
    assert _after_revise(state) == "revise"


def test_after_revise_finalizes_at_max_revisions():
    state = {"quality": {"ok": False, "issues": ["x"]}, "revision": MAX_REVISIONS}
    assert _after_revise(state) == "finalize"


# ── course_review ──────────────────────────────────────────────────────────


def test_experts_registry_has_10_unique_keys():
    keys = [key for key, _fn, _temp in _EXPERTS]
    assert len(keys) == 10
    assert len(set(keys)) == 10


def test_normalize_expert_clamps_score_in_range():
    assert _normalize_expert({"score": 20, "reasoning": "r"})["score"] == 10
    assert _normalize_expert({"score": -5, "reasoning": "r"})["score"] == 1
    assert _normalize_expert({"score": "not-an-int"})["score"] == 1


def test_normalize_expert_handles_missing_fields():
    out = _normalize_expert({})
    assert out["score"] == 1
    assert out["reasoning"] == ""
    assert out["strengths"] == []
    assert out["weaknesses"] == []


def test_normalize_expert_coerces_nonlist_strengths():
    out = _normalize_expert({"score": 8, "strengths": [None, "", "a", 42]})
    assert out["strengths"] == ["a", "42"]


def test_format_course_info_includes_all_fields():
    info = _format_course_info(
        {
            "title": "Deep RL",
            "provider": "X Academy",
            "url": "https://example.com/rl",
            "level": "Advanced",
            "rating": 4.6,
            "review_count": 1234,
            "duration_hours": 12.7,
            "is_free": False,
            "description": "",
        }
    )
    assert "Title: Deep RL" in info
    assert "Rating: 4.6/5 (1,234 reviews)" in info
    assert "Duration: ~13h" in info
    assert "Price: Paid" in info
    assert "Description: N/A" in info


def test_format_course_info_marks_free():
    info = _format_course_info(
        {
            "title": "",
            "provider": "",
            "url": "",
            "level": "Beginner",
            "rating": 0,
            "review_count": 0,
            "duration_hours": 0,
            "is_free": True,
            "description": "",
        }
    )
    assert "Price: Free" in info


# ── memorize_generate ──────────────────────────────────────────────────────


def test_category_id_slugifies():
    assert _category_id("Databases & Storage") == "databases-storage"
    assert _category_id("API & Communication") == "api-communication"
    assert _category_id("Languages") == "languages"


def test_category_id_strips_trailing_dashes():
    assert _category_id("!!! weird---name !!!") == "weird-name"
