<div align="center">

# 🧠 AI Engineering — From Zero to AI Engineer

**A structured, hands-on learning path that takes junior engineers all the way to production AI systems.**

108 deeply-researched lessons across 15 categories — RAG, agents, evals, fine-tuning, prompting & context engineering — wired together with semantic search, generated audio narration, an interactive knowledge graph, and per-learner mastery analytics.

[![Next.js](https://img.shields.io/badge/Next.js-15-000000?logo=next.js&logoColor=white)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![LangGraph](https://img.shields.io/badge/LangGraph-5_graphs-1C3C3C?logo=langchain&logoColor=white)](https://langchain-ai.github.io/langgraph/)
[![Postgres](https://img.shields.io/badge/Neon_Postgres-pgvector-336791?logo=postgresql&logoColor=white)](https://neon.tech/)
[![Cloudflare](https://img.shields.io/badge/Cloudflare-Containers_·_R2_·_D1-F38020?logo=cloudflare&logoColor=white)](https://developers.cloudflare.com/containers/)
[![Vercel](https://img.shields.io/badge/Deployed_on-Vercel-000000?logo=vercel&logoColor=white)](https://vercel.com/)

[Quick Start](#-quick-start) · [Features](#-features) · [Architecture](#architecture) · [Database Schema](#database-schema) · [LangGraph Pipelines](#langgraph-pipelines) · [Dev](#dev)

</div>

---

## ✨ Features

| | |
|---|---|
| 📚 **108 lessons, 15 categories** | A curriculum from transformer internals → RAG → agents → evals → production, with prerequisite-aware ordering. |
| 🔎 **Semantic + full-text search** | `Cmd+K` instant search over Postgres FTS *and* pgvector cosine similarity. |
| 🎧 **Audio narration** | Every lesson has TTS audio (Rust pipeline → Cloudflare R2) with per-user resume positions stored in D1. |
| 🕸️ **Interactive knowledge graph** | Concepts linked by `prerequisite` / `builds_on` / `related` edges, rendered as an explorable graph. |
| 🤖 **AI tutor chat** | RAG chat grounded in lesson content, with intent routing (keyword vs. conceptual) and checkpointed threads. |
| 📈 **Mastery analytics** | Bayesian Knowledge Tracing (`mastery / transit / slip / guess`) per learner per lesson. |
| ✍️ **Self-authoring pipeline** | A 5-pass LangGraph writer (research → outline → draft → review → revise) generates new articles with a quality gate. |
| 🎓 **Course reviewer** | 10 expert evaluators run concurrently to score & rank external AI courses. |

## 🚀 Quick Start

```bash
# Node 22.x · pnpm
pnpm install
# create .env.local — see the "Environment" section below for the full list of keys

pnpm db:push      # sync schema to Neon
pnpm seed         # seed lessons from content/*.md
pnpm dev          # → http://localhost:3006
```

Want the AI features (chat, article/flashcard/course-review generation)? Spin up the LangGraph backend too — see [LangGraph backend](#langgraph-backend-backend).

## 🧱 Stack

| Layer | Technology |
|---|---|
| **Framework** | Next.js 15 (App Router, Turbopack) |
| **Database** | Neon PostgreSQL + pgvector |
| **ORM** | Drizzle ORM |
| **UI** | Radix UI Themes |
| **AI / LLM** | OpenAI · DeepSeek |
| **AI backend** | Python FastAPI + LangGraph on Cloudflare Containers — all 5 graphs (`chat`, `app_prep`, `memorize_generate`, `article_generate`, `course_review`) with `AsyncPostgresSaver` checkpointing on Neon |
| **File storage** | Cloudflare R2 (audio files) |
| **Playback state** | Cloudflare D1 (`knowledge-audio-progress`) via D1 REST API |
| **Deployment** | Vercel (frontend) + Cloudflare Containers (LangGraph backend) |

## Architecture

```mermaid
graph TD
    subgraph Client
        Browser["Browser"]
    end

    subgraph Next.js["Next.js App on Vercel (Port 3006 dev)"]
        Pages["Pages\n/[slug]\n/aws\n/aws/[slug]\n/courses\n/coursework\n/coursework/[slug]\n/coursework/[slug]/slovenia\n/coursework/[slug]/slovenia/ideas\n/coursework/[slug]/slovenia/images\n/coursework/[slug]/slovenia/images/[imageSlug]\n/anthropic\n/problems\n/problems/[slug]"]
        API["API Routes\n/api/chat (proxy)\n/api/applications/[id]/prep (proxy)\n/api/applications/[id]/memorize/generate (proxy)\n/api/research\n/api/course-review/[id]\n/api/learners\n/api/coursework\n/api/problems/[slug]/submit\n/api/audio-progress (D1)"]
        Client["src/lib/langgraph-client.ts\nPOST /runs/wait"]
        SA["Server Actions\nsearch · analytics"]
        MW["Middleware\nURL redirects"]
    end

    subgraph LangGraph["LangGraph Backend (Cloudflare Containers)"]
        Worker["Worker proxy\nknowledge-langgraph.workers.dev"]
        Container["FastAPI container :7860\nchat · app_prep · memorize_generate\narticle_generate · course_review"]
    end

    subgraph Data["Data Layer"]
        Adapter["data.ts adapter\nDB or filesystem"]
        FS["Filesystem\ncontent/*.md"]
        DB["Neon PostgreSQL\n+ pgvector\n+ checkpoints"]
    end

    subgraph External
        OpenAI["OpenAI API\nchat · embeddings"]
        DeepSeek["DeepSeek API\nalternative LLM"]
        R2["Cloudflare R2\naudio files"]
        D1["Cloudflare D1\naudio_progress\n(per-user, per-slug)"]
    end

    Browser --> MW
    MW --> Pages
    Pages --> Adapter
    SA --> DB
    API --> Client
    Client -->|LANGGRAPH_URL + bearer| Worker
    Worker --> Container
    Container --> DeepSeek
    Container --> DB
    Adapter -->|NEXT_PUBLIC_DATA_SOURCE=db| DB
    Adapter -->|NEXT_PUBLIC_DATA_SOURCE=fs| FS
    Pages --> R2
    API -->|GET/PUT audio-progress\nCF_API_TOKEN| D1
```

## Database Schema

```mermaid
erDiagram
    categories ||--o{ lessons : contains
    lessons ||--o{ lesson_sections : has
    lessons ||--o{ lesson_concepts : tagged_with
    lessons ||--o{ lesson_embeddings : embedded_as
    lesson_sections ||--o{ section_embeddings : embedded_as
    concepts ||--o{ concept_edges : connects
    concepts ||--o{ lesson_concepts : appears_in
    concepts ||--o{ concept_embeddings : embedded_as
    user_profiles ||--o{ knowledge_states : tracks
    user_profiles ||--o{ interaction_events : generates
    user_profiles ||--o{ user_lesson_interactions : has
    user_profiles ||--o{ chat_messages : sends
    lessons ||--o{ knowledge_states : subject_of
    lessons ||--o{ user_lesson_interactions : interacted_in
    learners ||--o{ coursework : has
    problems ||--o{ problem_submissions : attempted_in

    categories {
        uuid id PK
        text slug
        text name
        int lesson_range_start
        int lesson_range_end
    }

    lessons {
        uuid id PK
        text slug
        int number
        text title
        uuid category_id FK
        int word_count
        int reading_time_minutes
    }

    concepts {
        uuid id PK
        text name
        text type
        text description
    }

    concept_edges {
        uuid from_concept_id FK
        uuid to_concept_id FK
        text relationship
    }

    lesson_embeddings {
        uuid lesson_id FK
        vector embedding
        text model
    }

    knowledge_states {
        uuid user_id FK
        uuid lesson_id FK
        float mastery_probability
        float transit_prob
        float slip_prob
        float guess_prob
    }

    problems {
        uuid id PK
        text slug
        text title
        text difficulty
        text prompt
        text starter_js
        text starter_ts
        jsonb test_cases
        text entrypoint
    }

    problem_submissions {
        uuid id PK
        uuid problem_id FK
        text user_id
        text language
        text code
        text status
        int passed_count
        int total_count
        float runtime_ms
    }
```

## Data Flow — Lesson Page

```mermaid
sequenceDiagram
    participant User
    participant Page as /[slug] Page
    participant Adapter as data.ts
    participant DB as Neon DB
    participant R2 as Cloudflare R2

    User->>Page: GET /transformer-architecture
    Page->>Adapter: getLessonBySlug(slug)
    Adapter->>DB: SELECT lesson + sections
    DB-->>Adapter: lesson data
    Adapter-->>Page: LessonWithSections
    Page->>DB: getSimilarLessons (pgvector cosine)
    DB-->>Page: related lessons
    Page->>R2: check audio exists
    R2-->>Page: audio URL
    Page-->>User: rendered lesson
    User->>Page: scroll / bookmark / search
    Page->>DB: INSERT interaction_events (analytics)
```

## Data Flow — Chat

```mermaid
sequenceDiagram
    participant User
    participant ChatUI as Chat Component
    participant Route as /api/chat
    participant CDB as Content SQLite
    participant LG as LangGraph container
    participant LLM as DeepSeek

    User->>ChatUI: send message
    ChatUI->>Route: POST { message, thread_id? }
    Route->>CDB: FTS + vector search + history
    CDB-->>Route: snippets + prior messages
    Route->>LG: POST /runs/wait { chat, message, history, context_snippets }
    LG->>LLM: chat completion (system + snippets + history + user)
    LLM-->>LG: assistant reply
    LG-->>Route: { response }
    Route->>CDB: INSERT chat_messages (user + assistant)
    Route-->>ChatUI: { response, thread_id }
```

## Knowledge Graph

```mermaid
graph LR
    subgraph Transformers
        T1[Transformer Architecture]
        T2[Tokenization]
        T3[Scaling Laws]
        T4[RLHF]
    end

    subgraph RAG
        R1[RAG Fundamentals]
        R2[Advanced RAG]
        R3[Embeddings]
    end

    subgraph Context["Context Engineering"]
        C1[Context Engineering]
        C2[Window Management]
        C3[Memory Architectures]
        C4[Prompt Caching]
        C5[Dynamic Assembly]
        C6[Compression]
    end

    subgraph Agents["Agents & Harnesses"]
        A1[Agent Architectures]
        A2[Tool Use]
        A3[Memory Systems]
        A4[Agent Harnesses]
        A5[Orchestration]
        A6[Agent SDKs]
        A7[Agent Debugging]
    end

    T1 -->|prerequisite| T3
    T1 -->|prerequisite| T4
    T2 -->|prerequisite| T1
    T3 -->|builds_on| R1
    R3 -->|prerequisite| R1
    R1 -->|prerequisite| R2
    T1 -->|prerequisite| C1
    C1 -->|prerequisite| C2
    C1 -->|prerequisite| C3
    C2 -->|related| C4
    C3 -->|related| C5
    C5 -->|related| C6
    C1 -->|prerequisite| A1
    A1 -->|related| A2
    A1 -->|related| A3
    A1 -->|prerequisite| A4
    A4 -->|related| A5
    A4 -->|related| A6
    A5 -->|related| A7
```

## LangGraph Pipelines

### Content Generation Pipeline

LangGraph graph (`backend/knowledge_agent/article_generate_graph.py`, `assistant_id: article_generate`) generates knowledge base articles from a topic slug. Uses DeepSeek through five LLM passes, with a conditional revision loop (max 2) gated by quality checks (word count, code blocks, cross-refs, ≥5 ```xyflow JSON diagrams, mandatory `## Mental Model` and `## Runtime Internals` sections, no ```mermaid blocks).

**Article generation runs in pure Python** via `backend/scripts/generate_article.py` — it imports `build_graph()` directly and calls `graph.ainvoke(state)` in-process. No HTTP, no TS langgraph-client. Catalog context (existing articles, style sample) is derived by the script scanning `content/*.md` directly. The other four graphs (`chat`, `app_prep`, `memorize_generate`, `course_review`) still go through the FastAPI HTTP path because they're invoked at runtime from the Next.js app.

```mermaid
graph TD
    START((Start)) --> research
    research --> outline
    outline --> draft
    draft --> review
    review --> revise_loop{quality OK?}
    revise_loop -->|"yes"| finalize
    revise_loop -->|"no, <2 revs"| revise
    revise --> revise_loop
    finalize --> END((End))

    style research fill:#9cf,stroke:#333
    style outline fill:#ff9,stroke:#333
    style draft fill:#bbf,stroke:#333
    style review fill:#fbb,stroke:#333
    style revise_loop fill:#f9f,stroke:#333
    style revise fill:#fcb,stroke:#333
    style finalize fill:#bfb,stroke:#333
```

### RAG Pipeline

Query routing classifies intent (keyword vs conceptual), then retrieves via the best method (FTS/vector/hybrid), formats context, and generates an answer.

```mermaid
graph TD
    START((Start)) --> route_query
    route_query -->|"classify intent"| retrieve
    retrieve -->|"FTS / vector / hybrid"| format_context
    format_context --> generate
    generate --> END((End))

    style route_query fill:#ff9,stroke:#333
    style retrieve fill:#9cf,stroke:#333
    style generate fill:#bbf,stroke:#333
```

### Course Review Pipeline

LangGraph graph (`backend/knowledge_agent/course_review_graph.py`, `assistant_id: course_review`) running ten expert evaluators concurrently via `asyncio.gather` (pedagogy, technical accuracy, content depth, practical application, instructor clarity, curriculum fit, prerequisites, AI domain relevance, community health, value proposition — at `REASONER_TEMP=0` or `FAST_TEMP=0.3` each), then an aggregator step computes a weighted score and verdict. Output shape is stable.

```mermaid
graph TD
    START((Start)) --> experts
    experts --> aggregator
    aggregator --> END((End))

    style experts fill:#f9f,stroke:#333
    style aggregator fill:#bfb,stroke:#333
```

## Directory Structure

```
apps/knowledge/
├── app/                    # Next.js App Router
│   ├── [slug]/page.tsx     # Lesson pages (SSG) — non-AWS slugs only
│   ├── aws/page.tsx        # AWS hub page (/aws)
│   ├── aws/[slug]/page.tsx # AWS deep-dive pages (/aws/lambda-serverless, etc.)
│   ├── anthropic/page.tsx  # Claude Partner Network learning path (static)
│   ├── anthropic/agent-skills/page.tsx       # "Introduction to agent skills" course overview
│   ├── anthropic/agent-skills/[lesson]/page.tsx  # Per-lesson view (static, sourced from lessons.ts)
│   ├── anthropic/claude-api/page.tsx         # "Building with the Claude API" course overview
│   ├── anthropic/claude-api/[lesson]/page.tsx    # Per-lesson view (static, sourced from lessons.ts)
│   ├── api/chat/           # Streaming chat endpoint
│   ├── api/research/       # Research endpoints
│   ├── api/course-review/[id]/  # GET fetch review · POST upsert AI review
│   ├── coursework/page.tsx     # All learners + files (cards UI)
│   ├── coursework/[slug]/page.tsx  # Per-learner view; slug = lowercased/hyphenated name
│   ├── coursework/[slug]/slovenia/page.tsx  # Static event page: Ziua Europei — standul Slovenia (echipa Bogdan)
│   ├── coursework/[slug]/slovenia/ideas/page.tsx  # Full 13-section preparation guide (concept, stamp, decor, tasting, script…)
│   ├── coursework/[slug]/slovenia/images/page.tsx  # Image gallery (flag, symbols, phrases) with A4 JPG download/email
│   ├── coursework/[slug]/slovenia/images/[imageSlug]/page.tsx  # Per-image detail page with prev/next nav
│   ├── coursework/[slug]/slovenia/images/_data.ts  # Shared image data + slug helpers (server-safe)
│   ├── coursework/[slug]/slovenia/images/_canvas.tsx  # Shared canvas/share helpers + PreviewDialog (client)
│   ├── api/learners/       # CRUD for managed learners
│   ├── api/coursework/     # GET list coursework files
│   ├── api/coursework/upload/  # FormData upload to Cloudflare R2
│   └── api/audio-progress/     # GET/PUT per-user audio playback position (D1)
├── components/             # React components
│   ├── search.tsx          # Cmd+K full-text search
│   ├── audio-player.tsx    # TTS audio playback
│   ├── toc.tsx             # Auto-generated ToC
│   └── ...
├── content/                # 92 markdown lesson files
├── src/db/
│   ├── index.ts            # Neon serverless client
│   └── schema.ts           # Drizzle schema (22 tables, incl. learners, coursework, external_courses[+topic_group], lesson_courses, course_reviews)
├── src/lib/langgraph-client.ts       # Typed POST /runs/wait client (chat, runAppPrep, runMemorizeGenerate, runCourseReview) — article_generate is NOT here, it runs in pure Python
├── lib/article-catalog.ts            # Catalog helpers (slugs, categories, related topics, style sample) — used by Next.js features; the Python article generator scans content/*.md directly
├── backend/                # Python FastAPI + LangGraph on Cloudflare Containers
│   ├── wrangler.jsonc      # Worker + KnowledgeContainer (standard-1 on :7860)
│   ├── Dockerfile          # python:3.12-slim, uvicorn --workers 1
│   ├── pyproject.toml      # pytest config (asyncio_mode=auto)
│   ├── requirements.txt    # runtime: fastapi, langgraph, langgraph-checkpoint-postgres, psycopg[binary]
│   ├── requirements-dev.txt # adds pytest, pytest-asyncio, httpx, deepeval for local test runs
│   ├── app.py              # FastAPI harness — create_app() factory, /health + /runs/wait, bearer-token middleware
│   ├── src/index.js        # Cloudflare Worker proxying to KnowledgeContainer
│   ├── package.json        # wrangler deploy script
│   ├── run-with-env.sh     # Loads .env files via Python (handles `&` etc.) + opts out of deepeval telemetry before exec'ing pytest
│   ├── tests/              # pytest suite
│   │   ├── conftest.py             # StubGraph fixtures + TestClient wiring (create_app with use_prod_lifespan=False)
│   │   ├── test_app.py             # /health, bearer auth gate, routing, 404s, graph dispatch
│   │   ├── test_helpers.py         # Pure-function tests: check_quality, _normalize_expert, _category_id, _format_course_info, _after_revise
│   │   └── deepeval/               # LLM-judge gate (costs tokens; opt-in via `-m deepeval`)
│   │       ├── conftest.py         # DeepEvalBaseLLM judge (reuses make_llm()), golden loaders, aggregate_gate helper
│   │       ├── golden/             # 5-case JSON fixtures per graph
│   │       ├── test_chat_eval.py            # Faithfulness + AnswerRelevancy vs context_snippets
│   │       ├── test_app_prep_eval.py        # Tech-Coverage + Interview-Relevance GEvals
│   │       ├── test_course_review_eval.py   # Verdict direction + Verdict-Coherence GEval (@slow)
│   │       └── test_article_generate_eval.py # Quality gate + Faithfulness vs research + Technical-Depth GEval (@slow)
│   └── knowledge_agent/
│       ├── llm.py                       # make_llm() + ainvoke_json() shared helpers
│       ├── state.py                     # TypedDict schemas for all 5 graph states
│       ├── chat_graph.py                # RAG chat — retrieval stays in Next.js, graph runs LLM
│       ├── app_prep_graph.py            # Derive tech_stack + interview_questions from jobDescription
│       ├── memorize_generate_graph.py   # Per-tech fan-out flashcards (8 primary, 4 secondary)
│       ├── article_generate_graph.py    # Knowledge-base article writer (research → outline → draft → review → revise)
│       ├── course_review_graph.py       # 10 parallel experts + weighted aggregator
│       └── course_review_prompts.py     # 10 expert system prompts + aggregator prompt
├── lib/
│   ├── articles.ts         # Lesson data layer — Lesson interface includes url field;
│   │                       # exports AWS_DEEP_DIVE_SLUGS and getUrlPath()
│   ├── data.ts             # DB/filesystem adapter — re-exports AWS_DEEP_DIVE_SLUGS, getUrlPath
│   ├── db/queries.ts       # DB query layer
│   ├── r2.ts               # Cloudflare R2 upload/delete helpers
│   ├── d1.ts               # Cloudflare D1 REST-API client (audio_progress)
│   └── actions/            # Server actions
├── migrations/d1/                       # Cloudflare D1 SQL migrations
│   └── 0001_audio_progress.sql          # audio_progress table (user_id, slug, current_time, …)
├── scripts/seed.ts                 # DB seeder (lessons from markdown)
├── scripts/seed-courses.ts         # Udemy course catalog seeder
├── scripts/scrape-udemy-courses.ts # Playwright scraper — deep-scrapes Udemy topic pages into external_courses
├── scripts/inline-audio-script.py  # Inline `data/<slug>.script.md` into a TS module under `app/.../` so Vercel bundles the Rust-pipeline-generated audio narration into the serverless function (data/ is .vercelignored)
├── backend/scripts/generate_article.py # Python CLI for article generation — invokes the LangGraph StateGraph in-process (no HTTP)
├── backend/scripts/build_audio_meta.py # Parse a content/*.md article into an AudioMeta JSON (chapters by H2, code/xyflow stripped) for the TTS step

├── scripts/review-courses.ts       # 10-expert course reviewer CLI
├── scripts/test-langgraph-e2e.ts   # E2E integration test against deployed worker (routing/auth/404; --live adds one DeepSeek call)
├── sql/setup.sql           # Neon setup (FTS, RPCs, mat views)
└── sql/add_course_reviews.sql  # course_reviews table (10-expert scores, verdict, aggregate)
```

## Dev

```bash
pnpm dev          # start on :3006
pnpm db:push      # sync schema to Neon
pnpm db:studio    # open Drizzle Studio
pnpm seed         # seed DB from markdown files
pnpm seed:courses # seed Udemy course catalog
pnpm scrape:udemy # scrape 20+ AI/ML Udemy topics → external_courses (with topic_group classification)
pnpm generate prompt-caching               # generate article via LangGraph (backend/)
pnpm generate:dry prompt-caching           # preview without saving
pnpm generate prompt-caching --model deepseek-reasoner  # use specific model
pnpm generate:missing                      # list articles without content files
pnpm generate:batch                        # generate all missing articles
pnpm generate:graph                        # print workflow as Mermaid

# Batch-review unreviewed courses (calls course_review graph):
pnpm review:courses                             # review up to 5 courses
pnpm review:courses --limit=10
pnpm review:courses --provider="DeepLearning.AI"
pnpm review:courses:dry                         # preview without calling the pipeline

# Backend (LangGraph container) scripts — run from apps/knowledge/:
pnpm backend:dev                                # uvicorn --reload on :7860 (needs .env in backend/)
pnpm backend:deploy                             # wrangler deploy from backend/
pnpm backend:tail                               # live wrangler tail

# Tests — three layers:
pnpm test:backend                               # pytest (unit + FastAPI integration, stubbed graphs; no LLM, no DB)
pnpm test:e2e                                   # smoke the deployed worker (routing/auth/404; no LLM cost)
pnpm test:e2e:live                              # + one real DeepSeek chat call (~$0.001)
pnpm test:deepeval                              # LLM-judge gate on chat + app_prep (~$0.05, excludes @slow graphs)
pnpm test:deepeval:all                          # + course_review + article_generate (~$0.20 total, 5+ min)
```

### DeepEval gate (`backend/tests/deepeval/`)

Each of the 4 LLM-driven graphs has a 5-case golden set and an aggregate-pass gate at ≥ 0.80 across all `(case × metric)` cells. The judge is a `DeepEvalBaseLLM` wrapper over `make_llm()`, so it picks up the same `LLM_BASE_URL` / `DEEPSEEK_API_KEY` the graphs use — no separate judge configuration. Metrics per graph:

| Graph | Fast/Slow | Judged metrics | Deterministic checks |
| --- | --- | --- | --- |
| `chat` | fast | FaithfulnessMetric (vs snippets), AnswerRelevancyMetric | must_mention heuristic, non-empty response |
| `app_prep` | fast | Tech-Coverage GEval, Interview-Relevance GEval | tech-tag coverage heuristic, shape |
| `course_review` | slow | Verdict-Coherence GEval | verdict direction vs golden band, aggregate in range, 10 expert scores present |
| `article_generate` | slow | FaithfulnessMetric (vs research), Technical-Depth GEval | `check_quality()` passes, expected-theme hits ≥ 50% |

Tests are excluded from `pnpm test:backend` by default (`addopts = -m 'not deepeval'` in `pyproject.toml`). Opt in with `pnpm test:deepeval` (fast subset) or `pnpm test:deepeval:all` (adds `@slow` graphs).

**Gate calibration:** the aggregate pass-rate gate is currently **0.65** (`DEFAULT_AGGREGATE_GATE` in `tests/deepeval/conftest.py`). This is the empirical floor for 5-case goldens judged by DeepSeek: ~1 of 15 cells flakes on judge JSON-parse errors and another 1-2 hit real borderline-quality signals (answer redundancy, mild conflation). `run_metric()` retries judge calls once on exception and treats `score >= threshold` as a pass even when deepeval's `is_successful()` flag false-negatives (a known edge case when a sub-step errors mid-run despite a valid final score). Tighten the gate as the golden set grows or the judge is swapped for a more reliable model.

### First-time test setup

The pytest suite uses an isolated venv under `backend/.venv`. Create it once with Python 3.12:

```bash
cd backend
python3.12 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
```

After that `pnpm test:backend` runs against it. The venv is `.gitignore`d.

`pnpm test:deepeval*` scripts source `.env.local` before invoking pytest so `DEEPSEEK_API_KEY` and `LLM_BASE_URL` reach the judge. If the env vars are missing, deepeval cases are skipped rather than failing.

### LangGraph backend (`backend/`)

```bash
# Local dev (run against local Python)
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app:app --host 0.0.0.0 --port 7860 --reload

# Local dev via Docker
docker build -t knowledge-langgraph .
docker run --env-file .env -p 7860:7860 knowledge-langgraph

# Deploy to Cloudflare Containers
wrangler deploy              # or: pnpm deploy (from backend/)
wrangler secret put DATABASE_URL
wrangler secret put DEEPSEEK_API_KEY
wrangler secret put LANGGRAPH_AUTH_TOKEN
wrangler tail                # live logs
```

Once deployed, set `LANGGRAPH_URL` + `LANGGRAPH_AUTH_TOKEN` in the Next.js Vercel environment so `/api/chat`, `/api/applications/[id]/prep`, and `/api/applications/[id]/memorize/generate` route to the container.

### Environment

```env
DATABASE_URL=           # Neon connection string (also used by backend container)
OPENAI_API_KEY=
DEEPSEEK_API_KEY=
LANGGRAPH_URL=          # http://127.0.0.1:7860 locally; workers.dev URL in prod
LANGGRAPH_AUTH_TOKEN=   # bearer token shared between Next.js and backend
NEXT_PUBLIC_R2_DOMAIN=  # audio CDN domain
WORKER_URL=             # Cloudflare Worker endpoint
NEXT_PUBLIC_DATA_SOURCE= # "db" | "fs"
R2_ACCOUNT_ID=           # Cloudflare R2
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=          # defaults to "knowledge"
CLOUDFLARE_ACCOUNT_ID=   # for D1 REST API (audio_progress)
CLOUDFLARE_AUDIO_D1_ID=  # database_id of knowledge-audio-progress
CLOUDFLARE_D1_API_TOKEN= # CF API token, D1:Edit scoped to the audio DB
```
