"""TypedDict state schemas for the knowledge graphs.

Each state matches the input/output shape expected by the Next.js client in
``apps/knowledge/src/lib/langgraph-client.ts``.
"""

from __future__ import annotations

from typing import Any, TypedDict


class ChatState(TypedDict, total=False):
    # input
    message: str
    history: list[dict[str, str]]          # [{role, content}] — prior chat history
    context_snippets: list[str]            # retrieved RAG context from Next.js
    # output
    response: str


class AppPrepState(TypedDict, total=False):
    # input
    app_id: str
    job_description: str
    company: str
    position: str
    # output
    tech_stack: list[dict[str, Any]]       # [{tag, label, category, relevance}]
    interview_questions: str               # markdown


class TechBadge(TypedDict, total=False):
    tag: str
    label: str
    category: str
    relevance: str                          # "primary" | "secondary"


class MemorizeGenerateState(TypedDict, total=False):
    # input
    company: str
    position: str
    techs: list[TechBadge]
    # output
    categories: list[dict[str, Any]]       # [{id, name, icon, color, items: [...]}]


class ArticleGenerateState(TypedDict, total=False):
    # input
    slug: str
    topic: str
    category: str
    related_topics: str                    # resolved by caller (comma-separated)
    existing_articles: str                 # resolved by caller (markdown list)
    style_sample: str                      # resolved by caller (content snippet)
    # internal
    research: str
    outline: str
    draft: str
    revision: int
    quality: dict[str, Any]                # {ok, issues, wordCount, codeBlocks, crossRefs}
    total_tokens: int
    # output
    final: str
    word_count: int
    revisions: int


class RankedCourse(TypedDict, total=False):
    url: str
    relevance: float                       # 0.0 – 1.0
    why: str                               # one-line rationale


class FetchCoursesState(TypedDict, total=False):
    # input
    courses: list[dict[str, Any]]          # pre-scraped ScrapedCourse JSON from TS lib
    topic_name: str                        # e.g. "Public Speaking"
    count: int                             # top N to return (default 10)
    topic_group: str                       # category bucket, e.g. "Communication Skills"
    # output
    ranked: list[RankedCourse]             # top `count` ranked by LLM
    summary: str                           # short intro paragraph for lesson page


class ExpertScore(TypedDict, total=False):
    score: int
    reasoning: str
    strengths: list[str]
    weaknesses: list[str]


class CourseReviewState(TypedDict, total=False):
    # input
    course_id: str
    title: str
    url: str
    provider: str
    description: str
    level: str
    rating: float
    review_count: int
    duration_hours: float
    is_free: bool
    # internal — 10 expert scores
    pedagogy_score: ExpertScore
    technical_accuracy_score: ExpertScore
    content_depth_score: ExpertScore
    practical_application_score: ExpertScore
    instructor_clarity_score: ExpertScore
    curriculum_fit_score: ExpertScore
    prerequisites_score: ExpertScore
    ai_domain_relevance_score: ExpertScore
    community_health_score: ExpertScore
    value_proposition_score: ExpertScore
    # output — aggregator fields
    aggregate_score: float
    verdict: str
    summary: str
    top_strengths: list[str]
    key_weaknesses: list[str]
