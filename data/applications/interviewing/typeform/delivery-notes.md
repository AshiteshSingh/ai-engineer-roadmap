# Delivery Notes — Typeform Mock (live coaching)

Generated during the live mock. Keep in `.sdd-scratch/` — do NOT show on screen-share.

## Background opener — cue card (memorize triggers, not sentences)

```
1. BETWEEN ROLES   → Vitrifi shut down Jan, 4 yrs Senior Full Stack
2. GO + SCALE      → 12 yrs web; 5 Go services, GraphQL gateway, ~240K Go, OTel/NATS
3. WHAT I BUILT    → GraphQL scalars (HTML sanitisation in the type system), validation directives
4. AI BRIDGE       → lead-gen agentic system (LangGraph, eval-gated, grounded, multi-model routing); ship daily
```

## AI story = lead-gen app (NOT the roadmap site)

Decision: lead-gen is the "what I've built in AI" story; Go signal still comes from
live-coding the typeform scaffold. Lead with the **B2B sales lead-gen / outreach** framing.
DO NOT surface the job-application-automation parts (auto_apply / fit_scorer / cover_letter /
classify_recruitment) — reads as spray-applying. Don't expand the repo file tree on screen
(scraped CSVs, .env, swap files).

**AI-bridge line (slots into the 45-sec opener):**
> "Since Vitrifi closed I've gone deep on AI — I built an agentic B2B lead-gen system: a
> multi-graph LangGraph pipeline with eval-gated prompts, schema-grounded outputs, and
> multi-model routing. I want to ship this kind of system daily — and a Go-backed agent
> platform is exactly that."

**Deep-dive (~60 sec, one slice, mapped to Typeform's roadmap: more tools / smarter
routing / better grounding):**
> "It's B2B lead-gen — an agentic pipeline: discover companies → enrich → find contacts →
> draft outreach. The part relevant to you is the agent layer: specialized graphs, and the
> orchestration decides which to run — the same 'which tool does this map to' problem.
> Three things: (1) Eval-first — every prompt/model change clears an 80% accuracy bar
> before it ships, so behavior doesn't silently drift. (2) Grounding — outputs are
> schema-constrained and validated against a taxonomy, so the model can't invent a category
> that doesn't exist. (3) Multi-model routing — cheap model first, escalate to the reasoning
> model only on low confidence, keeps cost sane at batch scale. Stack: Python/LangGraph
> agent runtime, TypeScript/Apollo over Neon for serving, Rust for the hot ML kernels (NER,
> embeddings, bandit scoring). No Go in that one — which is partly why I built the Go
> scaffold for today."

**"What draws you to AI":**
> "Building lead-gen showed me the part I enjoy most isn't the model — it's the engineering
> around it: evals, grounding, routing, the stuff that turns a flaky demo into something you
> can trust in production. That's what your roadmap is about, and it's what I want daily."

**If pushed on weaknesses (own them, don't hide):** observability is partial (tracing only
emerging); some `any` types in resolvers; no GraphQL query-depth limiting yet. "Known, and
on the list — eval-first came before observability because drift was the bigger risk."

## Compact spoken version (~45 sec — the one to rehearse)

> "I'm between roles right now — four years as Senior Full Stack at Vitrifi, a UK telecoms
> platform, and they shut down in January. Before that, ~12 years of web, mostly React,
> TypeScript, and Go.
>
> At Vitrifi we ran five Go services behind a GraphQL gateway — around 240K lines of Go,
> NATS, OpenTelemetry throughout. The piece I'm proudest of is work I designed myself:
> custom GraphQL scalars that carried HTML sanitisation through the type system, so an
> unsanitised value couldn't reach a safe field by accident.
>
> Since then I've gone deep on AI — built a roadmap site, ~100 lessons on agents, evals,
> RAG. I want to ship this kind of system daily instead of writing about it. That's why
> this role caught my eye."

**Delivery tip:** drill *just the first sentence* until it's automatic. Once "between
roles… shut down in January" comes out calm and unbothered, the rest flows. Nerves live
in the opening line — kill them there.

## Severance / "why out since January" — do NOT mention the package

- Don't volunteer the generous severance. It's irrelevant to your engineering value,
  reads as defensive, and pulls toward money/timeline — which is Sean's (recruiter's) lane,
  not the technical panel's.
- The clean reason is already complete: "Between roles — Vitrifi shut down in January."
- If asked "what have you been doing since January?", answer with the *investment*, not the
  cushion that funded it:
  > "Used it to go deep on the AI side — built the roadmap site, ~100 lessons on agents,
  > evals, RAG. Deliberately wanted to retool before jumping back in, and this is exactly
  > the kind of work I want to do."
- Let the runway show in your *demeanor* (relaxed, selective), never in your words.

## Ethan's question — "how would you know it's working in production?" (FLAGSHIP)

Ethan speaks ~once; this is it. Lead with what's *already wired*, not aspirations.

> "Three layers, and the nice thing is the scaffold already has the spine for it.
> **One — structured telemetry per tool call.** Each tool call emits a span with the tool name,
> arguments, latency, error code, and which model produced it. I'm already exporting OpenTelemetry
> traces to Langfuse, span per turn and per tool, so I can replay the whole agent loop for any
> request — which tool it picked, what it returned, where time went.
> **Two — two behaviour metrics, not uptime.** Tool-selection accuracy graded by the eval harness,
> and a turns-to-completion distribution. If accuracy drops or turns creep up after I add a tool,
> that's the agent regressing — a health check never catches it.
> **Three — scoring + sampling.** I already attach scores to traces (guardrails, optional
> LLM-as-judge, 👍/👎 user feedback wired to the generation). In prod I'd sample ~1% of full
> conversations into Langfuse and watch the scores; when something feels off I open the trace and
> read what happened.
> The principle: the metric tells me there's a problem; the sample tells me what kind. Uptime says
> the server's alive — these say the *agent* is alive."

**Why it scores:** you point at what's *built* (OTel→Langfuse spans, scores, Go eval harness), not
theory. Closing line is the keeper — say it and stop. (Consistency note: the "improve next" answer
must NOT say "observability isn't built" — it is; next step there is dashboards/alerts on the two
metrics.) Audio: this is **Chapter Seven** in `typeform-interview-tts.md`.
