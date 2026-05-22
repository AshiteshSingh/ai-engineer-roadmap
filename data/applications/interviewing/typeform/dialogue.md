# Full Rehearsal Script — Typeform Go Live-Coding Mock

90-minute mock of the Friday 22 May, 12:00 EEST interview. Read **George**'s and **Ethan**'s lines aloud (or have a friend do it). You answer as yourself. Self-grade at the end against the rubric.

> ⚠️ This file lives in the project root and will be visible if you expand the file tree on screen-share. **Delete or move to `.sdd-scratch/` before Friday.**

## Setup (do once, before starting the mock)

- [ ] Backend running: `make run` (verify `listening on :8080`)
- [ ] Confirm DEMO.md curl 1 returns a tool_result
- [ ] Cursor / Claude Code signed in
- [ ] Hidden on screen: `.sdd-scratch/`, `.claude/`, `web/AGENTS.md`, this file
- [ ] Visible: `main.go`, `tools.go`, `DEMO.md`, terminal, browser, frontend (optional)
- [ ] Phone away, notifications off, ~90 uninterrupted minutes

## Cast

- **George Gillams** — lead interviewer, frontend background. Friendly, broad questions, evaluating clarity & AI workflow.
- **Ethan Carlsson** — silent observer ~95% of the time. Speaks ~once. Real Go judge. API/testing/event-driven lens.
- **You** — drives code, narrates continuously, AI prompts out loud.

---

## Phase 1 — Intros (0:00–0:08)

**George:**
> Hey Vadim, good to see you. Thanks for making the time on a Friday lunchtime. Can you hear me okay? Cool. This is Ethan — he's one of the senior engineers on the AI team, he'll be on with us today, mostly just listening in.
>
> Quick context on what we're up to: Typeform AI is a chat-based way for our users to do things across our products without clicking through the UI. They type something like "create me a feedback form for our new pricing page" or "show me last week's NPS responses", and the agent figures out which tools to call and does it. We launched the first version about a month ago — it works, but it's narrow. The next year is basically: more tools, smarter routing, better grounding, and turning it from a novelty into the way most people use Typeform. The team's small — five engineers right now, mostly Go on the backend, React on the frontend.
>
> Quick screen-share check — I can see your screen, yep, looks good.
>
> Before we get into the coding bit, just so I get a feel for where you're coming from — could you give me the 60-second version of your background? Specifically curious about your Go experience and anything you've done with LLMs or agent-style systems.

**You — 60-second background (≤ 90 seconds). Pick the version that feels true; don't read, speak.**

> *"Sure. I'm between roles right now — Vitrifi, where I spent four years as a Senior Full Stack, shut down at the start of the year. Before that, about 12 years of production web platforms, mostly React + TypeScript + Go. At Vitrifi we ran five Go services behind a schema-first GraphQL gateway — around 240K lines of Go, ~5,000 commits across four years. Heavy use of NATS with protobuf events, Temporal for long-running orders, OpenTelemetry threaded across all of it. The Go work I'd lead with is the stuff I personally designed: custom GraphQL scalars carrying HTML sanitisation through the type system, validation directives, a couple of small library packages for cross-cutting primitives.*
>
> *Since Vitrifi closed I've been going deep on the AI side — built an AI engineering roadmap site, around 100 lessons across agents, evals, RAG, LangGraph, observability. Built it in Next + Radix. That's actually what made this role catch my eye — your stack, my interest area, and I want to ship this kind of system daily instead of writing about it."*

**Shorter fallback if you blank or run long:**

> *"Between roles right now — Vitrifi shut down in January after four years of Go + React on a multi-tenant UK telecoms platform. Since then I've been building an AI engineering roadmap site — about 100 lessons on agents, evals, RAG, LangGraph. Wanted to turn that into something I ship daily, which is why this role caught my eye."*

**Key beats:**
- "Between roles" — own it, don't dance around it
- "Vitrifi shut down" — clean reason, said once, then move on
- 12 years experience (depth) + Vitrifi scale (240K Go, ~5k commits)
- The personal Go work (scalars, directives) — pivots "what we built" → "what I built"
- Roadmap site as the gap-fill (4 months of deep AI work)
- Next + Radix bridge to their stack
- "Ship daily, not write about it" — honest motivation

**George (likely follow-up):**
> Cool. And what draws you to the AI side specifically?

**You:** One-sentence honest answer. Don't ramble.

---

## Phase 2 — Prompt + Opener (0:08–0:10)

**George:**
> Cool, so I was going to give you a small coding task — but I noticed you mentioned you'd brought a scaffold. Want to walk us through what you've got?

**You — 30-sec opener (memorize, don't read):**
> "I've got a small Go scaffold with a `/chat` endpoint and three mock Typeform tools — create form, list forms, get responses — so we don't burn time on boilerplate. It streams via SSE, has in-memory session memory, and a Next.js frontend wired up if we need it. Happy to extend it, swap a tool out, or start fresh. What would be most useful for you to see?"

**George:**
> Yeah, extending it sounds good. Can you add a new capability: when the user asks for analytics on a form's responses — something like "what's the average NPS for the Customer NPS form?" — the agent should pick the right tool, run it against the mock store, and stream a one-paragraph natural-language summary. Use whatever AI assistance you want.

---

## Phase 3 — Light SDD spec (0:10–0:13)

**Goal:** show that you can frame a problem before coding, *without* making spec-design the show. Sean's exact advice: "define a very small spec up front, identify the core user flow, then get something running quickly … don't spend too long designing the perfect spec."

**Step 1 — say it out loud (≤3 sentences):**
> "Goal: add an `analyze_responses` tool the agent can call to compute summary stats over a form's responses. User: a Typeform customer who wants quick insight without writing SQL. Success: end-to-end — user asks → agent picks the new tool → runs over the mock store → streams a natural-language summary. Does that match what you're looking for?"

**Step 2 — write it down (optional, ~30 sec).** Open a new file `SPEC.md` in the project root and type:

```markdown
# analyze_responses

**Goal.** A tool the agent can call to compute summary stats over a form's responses.
**User.** Typeform customer who wants quick insight without writing SQL.
**Success.** User asks → agent picks `analyze_responses` → runs over mock store → streams a natural-language summary.

Out of scope (for this session): real Typeform API, retries, auth, multi-form joins.
```

**Why bother writing it down?**
- Anchors the next 50 minutes — you can point at it when George asks "why did you do X?"
- Out-of-scope line gives you cover to skip things without looking sloppy ("right, that's out-of-scope for today — I'd add it next")
- Reads as "engineer who can frame a problem", not "engineer with a methodology". One file, no folders, no `openspec/`.

**Step 3 — confirm with George:**
> "Out-of-scope today: real API, retries, multi-form. In-scope: the tool, the agent picking it, and a streamed summary. Sound right?"

**George:**
> Yep, that works. Go for it.

⏱ Note the time. You have ~57 minutes for coding.

### What NOT to do here (Sean's warnings)

- ❌ Don't open `.sdd-scratch/`, `openspec/`, or any methodology dir
- ❌ Don't whiteboard architecture
- ❌ Don't spend more than 3 minutes total on the spec — if you're still typing at 0:13, stop and start coding
- ❌ Don't invoke the `sdd-init` / `sdd-spec` / `sdd-propose` skills in Cursor. They scaffold a whole directory structure that's exactly what Sean warned against. A single `SPEC.md` is enough.

---

## Phase 4 — Coding (0:13–1:10)

### Continuous rules (memorize)

- Talk continuously. Long silences = points off.
- AI prompts: read out loud *before* sending.
- AI output: read out loud *before* accepting / pasting.
- `curl` (or use the frontend) after each meaningful change. Narrate what you're verifying.
- Skip something on purpose at least twice. Name the trade-off out loud.
- Don't open: `web/AGENTS.md`, `.claude/`, `.sdd-scratch/`, tests (unless asked), this file.

### Suggested first moves (you decide)

1. Open `tools.go`. Show the existing tool registry pattern.
2. Add a 4th tool def: `analyze_responses(form_id string)` returning stats (count, distribution, top-text).
3. Add the mock implementation — keep it small. Maybe 10–15 lines.
4. Restart server, curl it.
5. Iterate on the system prompt if the model doesn't pick the new tool reliably.

### Trade-offs to narrate (≥2 during this phase)

- "In-memory session store — fine for the demo, Redis or a DB in prod so sessions survive a restart."
- "Skipping retries on the LLM call — happy path first. Exponential backoff + circuit breaker for prod."
- Bonus: "Mock store is a `map[string][]Response` — would be a real Typeform API call in prod, behind an interface for testability."
- Bonus: "Stats are computed in Go — fine for small datasets, but for forms with millions of responses I'd push the aggregation down to the storage layer."

### Interjections (read aloud at these times)

**~minute 20 — George:**
> Why did you go with [point at the most recent decision: tool name, struct shape, error handling] there?

**You:** One sentence. Defensible. Don't over-explain. Examples:
- *"`analyze_responses` rather than `summarize` because the model needs to know it computes stats, not just paraphrases — naming carries semantic load when there are multiple analytics-ish tools later."*
- *"Returning the stats as a struct rather than a string so the model can decide phrasing — separates 'what' from 'how'."*

**~minute 40 — George:**
> Could that prompt go wrong if the user asks for a stat we don't compute, or asks about a form that doesn't exist?

**You:** Name the failure mode, name the simplest mitigation, decide whether to fix now or note it. Don't unravel. Example:
> *"Two failure modes. Form doesn't exist: `analyze_responses` returns `{error: form not found}`, model surfaces it — that's covered by `executeTool`'s validation pattern. Stat we don't compute: model would either hallucinate a number or admit it can't — the eval suite I mentioned earlier would catch this. For now I'd add the unknown-form case to the test, and note the stat-coverage gap as a 'next' item."*

**~minute 55 — Ethan (first time he speaks):**
> How would you know this is working in production?

This is **the** observability prompt. Land it cleanly:
> *"Three things. One, structured log per tool call — tool name, args (redacted), latency, error code, model used. Two, two metrics: tool-selection accuracy (eval-harness graded) and turns-to-completion distribution. Three, a sampling pipeline — log full conversations for, say, 1% of traffic, into a queryable store so I can look at what's actually happening when something feels off. The metric tells me there's a problem; the sample tells me what kind."*

---

## Phase 5 — Trade-off Q&A (1:10–1:25)

**George:**
> Okay, that's good. If you had another day or two, what would you improve first?

**You — 3-item ranked list (memorize, don't read):**

1. **Observability per tool call.** Structured logs (tool name, args, latency, error) + metrics for "turns to completion" and "tool-selection accuracy." Without it you can't tell if the agent is regressing as you add tools.
2. **Eval coverage on entity resolution.** "The NPS one" works today because session memory carries `form_1` from turn 1 — brittle. Eval suite with realistic phrasings, graded on tool-selection accuracy and arg-resolution accuracy.
3. **Event-driven decoupling + reliability.** Long-running tools (e.g. response export) shouldn't block the request thread. Publish `tool_requested`, worker consumes, stream `tool_progress`/`tool_result` events back. Plus idempotency keys on `create_form`, timeouts on all external calls.

**George (possible curveball):**
> How would a non-technical user know what the agent can do?

**You:** *"Discoverability is a UX problem, not a code problem. The frontend already shows example prompts in the empty state — I'd extend that with suggestion chips driven by the tool registry, and longer-term an LLM-generated capabilities summary that updates when we add tools. Tooling tells the engineers what's possible; the UI has to tell the user."*

**George or Ethan curveball:**
> How would you test this end-to-end?

**You:** *"Three layers. Unit tests per tool — they're pure functions, easy. A contract test on the SSE format — I have `streaming_test.go` for that already. And an eval suite of scripted conversations against the real model, graded on tool-selection accuracy. The eval is the part most agent codebases skip and regret a quarter later when behavior silently drifts."*

**George or Ethan curveball (prompt iteration):**
> The system prompt is hardcoded right now. How would PMs iterate on it, or how would you know a prompt change actually improved things?

This maps straight onto the **Langfuse prompt management** answer — and it closes the loop with the observability narration (Phase 4, ~min 55). Lead with *why the constant is correct today*, then the upgrade path:

> *"For this scope a hardcoded constant is the right call — keeping prompt management out of a one-day scaffold is deliberate. In production I'd move it to Langfuse prompt management, and the payoff is that I'm **already** sending traces to Langfuse over OTel — so I'd get prompt-version → trace → eval correlation basically for free. I could see which prompt version produced which tool-selection accuracy, instead of guessing whether a wording change helped."*

**Then volunteer the trade-off (this is the part that scores):**
> *"Two costs I'd call out. One, it puts Langfuse in the request hot path — I'd mitigate with the SDK's local cache plus a TTL, and a fallback prompt so an outage never breaks chat. Two, the prompt leaves git, so I lose PR review and atomic 'prompt + code' deploys — that's the deliberate trade for letting non-engineers ship prompt changes. Worth it once PMs are iterating; over-engineering before then."*

**Don't:** propose building it during the live session — it's SDK plumbing, not Go signal. Keep it as the answer, not an artifact.

---

## Phase 6 — Your Questions (1:25–1:30)

You have ~5 minutes. Two questions is the sweet spot — three feels rushed, one feels disengaged. **Pick the right one for the right person:**

**Ask Ethan (technical, save for him):**
> "I noticed event-driven programming is something the team leans on — is the agent loop itself event-driven internally, or more of a synchronous request/response with streaming on the edge?"

**Ask George (lead):**
> "You're a frontend lead hiring a Go engineer — how does the AI team think about the boundary between the agent's behavior and the UX layer? Where does prompt-engineering live, and where does product design take over?"

**Backup, neutral (if conversation runs short):**
> "What's the hardest problem the team hasn't cracked yet?"

**Don't ask:**
- Anything about salary / process / next steps (Sean handles that)
- "What's your tech stack?" — you already know
- Yes/no questions

---

## Phase 7 — Close (1:30)

**George:**
> Thanks Vadim, this was great. Sean will be in touch with next steps. Have a good weekend.

**You:** Smile. Thank them by name. "You too." Disconnect.

---

## Self-grading rubric — score yourself honestly

Answer yes/no for each. **5 yeses = ready for Friday.**

- [ ] Narrated continuously, no silences longer than ~10 seconds
- [ ] Read every AI-generated chunk out loud before accepting it
- [ ] Shipped a working end-to-end slice (curl returns sensible answer)
- [ ] Named ≥2 trade-offs you deliberately skipped, with reasoning
- [ ] Gave the 3-item "improve next" list crisply, without looking
- [ ] Did NOT show: `.sdd-scratch/`, `.claude/`, `web/AGENTS.md`, this file, OpenSpec dirs, tests (unless asked)

### Score interpretation

- **6/6** → you're ready, just sleep well Thursday.
- **5/6** → fix the one gap with a 15-min focused drill, then call it done.
- **3–4/6** → one more full mock-run before Friday.
- **≤2/6** → identify whether the issue is technical (DEMO.md not landing), verbal (silences, no narration), or strategic (showing wrong files). Drill that specific axis.

---

## Quick refreshers (skim Friday morning)

### SSE — Server-Sent Events

One-way HTTP streaming, server → client. Your `main.go` uses this.

- **Wire format:** `data: hello\n\n` (each event ends with a blank line). Content type `text/event-stream`.
- **Frontend:** browser `EventSource` API, or `@ai-sdk/react`'s `useChat` (what your scaffold uses) — auto-reconnects on drop.
- **Backend:** just write to `http.ResponseWriter` and call `Flush()`. No special server, no protocol upgrade.

**If asked "why SSE over WebSockets?":**

> *"One-direction server-push fits the chat-token streaming pattern, plain HTTP so it just works through proxies and load balancers, and `useChat` on the frontend consumes it natively. WebSockets would be over-engineered — I'd reach for them if I needed the client to push back mid-stream."*

### Light SDD verbal spec (Phase 3 — ≤3 sentences)

Reusable template — adapt the nouns to whatever prompt George gives:

> *"Goal: [one sentence — what the new capability does]. User: [one sentence — who calls it and why]. Success: [one sentence — end-to-end criterion, what works after this]. Out of scope today: [1-3 things you're explicitly not doing]. Sound right?"*

**Optional 30-sec follow-up:** type those 4 lines into a fresh `SPEC.md` in the project root. Anchors the next hour and gives George something to point at. Don't if it slows you down — verbal is enough.

---

## After the mock

- [ ] Delete or move this file: `mv dialogue.md .sdd-scratch/dialogue.md`
- [ ] Note your score + the one weakest axis in your prep journal (or just remember it)
- [ ] If 5+/6: stop preparing. Over-prep is its own failure mode. Read a novel.
