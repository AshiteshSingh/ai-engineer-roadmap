# Coach Dialogue + Live-Coding Prompts — Typeform AI (Fri 22 May, 12:00 EEST)

> ⚠️ Lives in `.sdd-scratch/` — **never open on screen-share.** 90 min: intros → live coding →
> questions. Screen shared; AI-tool use assessed; talk through everything.
>
> **Cast.** **George Gillams** — lead, frontend background, broad/friendly, judging clarity + AI
> workflow. **Ethan Carlsson** — senior Go engineer, near-silent, speaks ~once (the observability
> question). **You** — drive Claude Code, narrate continuously, read prompts + diffs aloud.
>
> **Locked decisions.** Lead-gen = your AI *story* (talk, don't code; B2B framing; never show the
> repo). Go signal comes from **live-coding the typeform scaffold**. Tool = **Claude Code**.
> Rehearsed feature = **`analyze_responses`**.

---

# PART A — The Coach Dialogue

## Phase 1 — Intros & background (0:00–0:10)

**George:** "Hey Vadim, thanks for making time on a Friday. This is Ethan, one of our senior
engineers — he'll mostly be listening. Quick context: Typeform AI is a chat layer over our
products — someone types 'create a feedback form for our pricing page' or 'show me last week's NPS
responses' and the agent figures out which tools to call. v1 shipped a month ago; it's narrow. The
next year is more tools, smarter routing, better grounding. Small team, mostly Go backend, React
front. Could you give me the 60-second version of your background — Go, and anything with LLMs or
agents?"

**You:**
> "I'm between roles — four years as Senior Full Stack at Vitrifi, a UK telecoms platform, and they
> shut down in January. Before that, about twelve years of web, mostly React, TypeScript, and Go.
> At Vitrifi we ran five Go services behind a GraphQL gateway — around 240K lines of Go, NATS,
> OpenTelemetry throughout. The piece I'm proudest of is work I designed: custom GraphQL scalars
> that carried HTML sanitisation through the type system, so an unsanitised value couldn't reach a
> safe field by accident.
>
> Since then I've gone deep on AI — I built an agentic B2B lead-gen system: a multi-graph LangGraph
> pipeline with eval-gated prompts, schema-grounded outputs, and multi-model routing. I want to ship
> this kind of system daily — and a Go-backed agent platform is exactly that."

**📝 Coach.** Land beat 1 calm — "between roles… shut down in January" said unbothered. One scale
number, not a dump. End on the Go bridge so George *has* to ask about lead-gen or the scaffold. Do
**not** mention severance or the job-application side of lead-gen.

**George (follow-up):** "What draws you to the AI side specifically?"

**You:**
> "Building lead-gen showed me the part I enjoy most isn't the model — it's the engineering around
> it: evals, grounding, routing, the stuff that turns a flaky demo into something you can trust in
> production. That's what your roadmap is about, and what I want to do daily."

**📝 Coach.** One or two sentences. Don't ramble. The phrase "turns a flaky demo into something you
can trust" is the hook — it signals production maturity, not hobbyist.

---

## Phase 2 — Lead-gen deep-dive (only if asked; ~0:03)

**George:** "Tell me more about that lead-gen system — what does it do, and what was the hard part?"

**You:**
> "It's B2B lead-gen — an agentic pipeline: discover companies, enrich them, find the right contacts,
> draft outreach. The part relevant to you is the agent layer: a set of specialised graphs, and the
> orchestration decides which to run — the same 'which tool does this map to' problem you described.
> Three things I'd call out. Eval-first — every prompt or model change has to clear an accuracy bar
> before it ships, so behaviour doesn't silently drift. Grounding — outputs are schema-constrained
> and validated against a taxonomy, so the model can't invent a category that doesn't exist.
> Multi-model routing — a cheap model runs first and escalates to the reasoning model only on low
> confidence, which keeps cost sane at batch scale. Stack-wise the agent runtime is Python on
> LangGraph, serving is TypeScript over Postgres, and the hot ML kernels are Rust. No Go in that one
> — which is partly why I built the Go scaffold for today."

**📝 Coach.** One slice, not a tour of 50 graphs. Volunteer the language split *before* asked.
Mapping to their roadmap (more tools / smarter routing / better grounding) is the whole point —
say "the same problem you described" out loud.

**George (the eval challenge):** "Eval-first is the part most people skip. But an accuracy bar on
*outreach email generation* — how do you measure that? What's ground truth for a good email?"

**You:**
> "Fair — I'd push back on my own number. The bar isn't on 'is this a good email.' It's on the parts
> that have ground truth: did the agent pick the right contact, extract the company's actual pain
> point, classify intent correctly — those have labels. For the generated copy I use weaker signals:
> deterministic constraint checks — personalisation present, under length, has a call-to-action;
> faithfulness — every factual claim about the prospect has to trace to retrieved source data, and a
> hallucinated fact is an automatic fail; and an LLM-as-judge on a rubric, but only after I've
> validated the judge against a small human-labelled set. The real ground truth is reply rate, but
> that's slow, so offline checks gate deploys and reply-rate is the long-loop signal. I wouldn't
> claim a hard accuracy number on pure persuasiveness — that'd be fake precision."

**📝 Coach.** The decomposition *is* the senior answer. "Fake precision" is the line that scores —
it shows you know where metrics stop. This exact distinction (faithfulness = checkable, quality =
subjective) comes back in the coding task.

---

## Phase 3 — Scaffold opener & the task (0:10–0:13)

**George:** "I noticed you brought a scaffold — want to walk us through it?"

**You (30-sec opener):**
> "It's a small Go binary with a `/chat` endpoint and three mock Typeform tools — create form, list
> forms, get responses — so we don't burn time on boilerplate. It streams over S-S-E, keeps
> per-session memory, and there's a Next.js front end if we want it. The chat handler runs a
> tool-calling loop: call the model, if it asks for a tool run it, stream the result back, feed it
> into the next turn, cap at five turns. Happy to extend it, swap a tool, or start fresh — what's
> most useful to see?"

**George:** "Extending sounds good. Add analytics: when someone asks 'what's the average NPS for the
Customer NPS form?', the agent should pick the right tool, run it on the mock store, and stream a
one-paragraph summary. Use whatever AI assistance you like."

**You (light verbal spec, ≤3 sentences):**
> "So: a new `analyze_responses` tool the agent can call to compute summary stats over a form's
> responses. User's a Typeform customer who wants quick insight without writing S-Q-L. Success is
> end-to-end — they ask, the agent picks the new tool, runs it over the mock store, streams a
> natural-language summary. Out of scope today: real Typeform A-P-I, retries, auth. Sound right?"

**George:** "Yep, go for it."

**📝 Coach.** Note the time — ~57 min for coding. Spec is verbal; don't open SDD dirs or whiteboard.
The out-of-scope line is your cover to skip things cleanly later. Then **start coding** — if you're
still talking at minute 13, stop.

---

## Phase 4 — Coding (0:13–1:10)

> Drive Claude Code per **Part B**. Talk continuously; read every prompt aloud before sending and
> every diff aloud before accepting; `curl` after each change.

**~min 20 — George:** "Why did you go with [the most recent decision] there?"

**You (pick the true one, one sentence):**
> "`analyze_responses` rather than `summarize` because the model needs to know it computes stats, not
> paraphrases — the name carries semantic load once there are several analytics-ish tools."
>
> *or* "Returning the stats as a struct rather than a string so the model decides phrasing —
> separates what from how."

**~min 40 — George:** "Could that go wrong if the user asks for a stat you don't compute, or a form
that doesn't exist?"

**You:**
> "Two failure modes. Form doesn't exist — `analyze_responses` returns a structured `form not found`
> error and the model surfaces it; that's the existing `executeTool` validation pattern. A stat I
> don't compute — the model would either admit it can't or try to invent a number, and that second
> case is exactly what the eval suite catches. For now I'd add the unknown-form case to the test and
> note the stat-coverage gap as a next item."

**~min 55 — Ethan (his one question):** "How would you know this is working in production?"

**You (land this cleanly — it's the observability beat):**
> "Three things. One, a structured log per tool call — tool name, arguments redacted, latency, error
> code, model used. Two, two metrics: tool-selection accuracy, graded by the eval harness, and a
> turns-to-completion distribution. Three, a sampling pipeline — full conversations for maybe one
> percent of traffic into a queryable store, so when something feels off I can look at what actually
> happened. The metric tells me there's a problem; the sample tells me what kind. I'd wire it through
> OpenTelemetry — same instrumentation I used at Vitrifi — so it routes to whatever backend you run."

**📝 Coach.** Ethan speaks once; this is the moment he's judging. Three crisp items, then stop. The
"metric says there's a problem, sample says what kind" line is the keeper.

---

## Phase 5 — Trade-off Q&A (1:10–1:25)

**George:** "Good. If you had another day or two, what would you improve first?"

**You (ranked, don't read):**
> "One — observability per tool call. Structured logs plus the two metrics I mentioned; without it I
> can't tell if the agent regresses as we add tools. Two — eval coverage on entity resolution. 'The
> NPS one' works today because session memory carries form one from turn one, which is brittle; I'd
> grow the Go eval harness I already have into scripted conversations graded on tool-selection and
> argument-resolution accuracy. Three — event-driven decoupling for long-running tools, so a response
> export doesn't block the request thread: publish a tool-requested event, a worker consumes it,
> stream progress and result back. Plus idempotency keys on create-form and timeouts on every
> external call."

**📝 Coach.** **Reframed for reality:** you migrated the evals to Go this week, so they *exist* —
say "the Go eval harness I already have," not "I haven't built evals." Observability first because
the other two are guesses without it.

**George (curveball):** "How would a non-technical user know what the agent can do?"

**You:**
> "Discoverability is a U-X problem, not a code problem. The front end already shows example prompts
> in the empty state — I'd extend that with suggestion chips driven by the tool registry, so adding a
> tool updates the examples automatically, and longer-term an L-L-M-generated capabilities summary.
> Tooling tells the engineers what's possible; the interface has to tell the user."

**George/Ethan (curveball):** "How would you test this end-to-end?"

**You:**
> "Three layers. Unit tests per tool — they're pure functions, easy. A contract test on the S-S-E
> format — I have one in the scaffold already. And an eval suite of scripted conversations against
> the real model, graded on tool-selection accuracy. The eval is the part most agent codebases skip
> and regret a quarter later when behaviour silently drifts — so I treat an eval failure like a test
> failure: it breaks the build."

**George/Ethan (curveball — prompt iteration):** "The system prompt is hardcoded. How would P-Ms
iterate on it, or how would you know a prompt change actually helped?"

**You:**
> "For this scope a hardcoded constant is the right call. In production I'd move it to managed prompt
> storage — Langfuse — and the payoff is I'm already sending traces to Langfuse over OpenTelemetry,
> so I'd get prompt-version to trace to eval correlation almost for free; I could see which prompt
> version produced which tool-selection accuracy instead of guessing. Two costs I'd call out: it puts
> Langfuse in the request hot path, so I'd cache locally with a T-T-L and keep an embedded fallback
> prompt so an outage never breaks chat; and the prompt leaves git, so I lose P-R review — that's the
> deliberate trade for letting non-engineers ship prompt changes. Worth it once P-Ms are iterating,
> over-engineering before then."

**📝 Coach.** This closes the loop with the observability answer — lead with *why the constant is
right today*, then the upgrade path, then volunteer the two costs. Don't offer to build it live;
it's S-D-K plumbing, not Go signal.

**Curveball — why S-S-E not WebSockets:**
> "One-direction server push fits chat-token streaming, plain H-T-T-P works through proxies and load
> balancers, and the front-end hook consumes it natively. WebSockets would be over-engineered — I'd
> reach for them only if the client had to push back mid-stream."

**Curveball — why Go:**
> "The chat loop is mostly orchestration and I-O. Go's standard library does H-T-T-P and streaming
> without a framework, and the team already runs Go — no reason to add a second language."

---

## Phase 6 — Your questions (1:25–1:30)

**Ask Ethan (technical — save it for him):**
> "I noticed the team leans on event-driven programming — is the agent loop itself event-driven
> internally, or more synchronous request/response with streaming on the edge? I'm asking because it
> changes how I'd extend it for longer-running tools."

**Ask George (lead):**
> "You're a frontend lead hiring a Go engineer — how does the team think about the boundary between
> the agent's behaviour and the U-X layer? Where does prompt engineering live, and where does product
> design take over?"

**Backup (if short on time):** "What's the hardest problem the team hasn't cracked yet?"

**📝 Coach.** Two questions is the sweet spot. Direct the technical one at Ethan by name. Don't ask
about salary/process (that's Sean's lane) or the tech stack (you know it).

---

## Phase 7 — Close (1:30)
Thank them by name, smile, "have a good weekend." Disconnect.

## Self-grade (5/6 = ready)
- [ ] Narrated continuously, no >10s silences
- [ ] Read every AI prompt + diff aloud before accepting
- [ ] Shipped a working end-to-end slice (curl returns a sensible answer)
- [ ] Named ≥2 trade-offs you deliberately skipped, with reasoning
- [ ] Gave the 3-item improve-next list crisply, without reading
- [ ] Did NOT show `.sdd-scratch/`, `.claude/`, the lead-gen repo, or tests (unless asked)

---

# PART B — Live-Coding Prompts for `analyze_responses` (Claude Code)

**Meta-rules (the assessed behaviour):**
- Keep prompts **small and targeted** — one change each, so each diff is reviewable on camera.
- **Read the prompt aloud before sending; read the proposed diff aloud before accepting.**
- Do **not** auto-accept / bypass permissions — the review step is what they want to watch.
- `curl` after every meaningful change and narrate what you're verifying.
- The scaffold's pattern: tool **schema** lives in `toolDefs` (`tools.go:16`); tool **impl** is a
  `case` in `dispatchTool` (`tools.go:92`); mock data is `store.responses` (`tools.go:139`).

### Prompt 1 — add the tool definition
**Type:**
> "In tools.go, add a fourth entry to the `toolDefs` slice for a tool named `analyze_responses`,
> following the exact shape of the `get_responses` entry. Description: it computes summary statistics
> over a form's submitted responses — count and a distribution of answers — and should be used when
> the user asks for analytics, averages, breakdowns, or a summary of responses. One required string
> parameter `form_id`. Only edit the `toolDefs` slice; don't touch anything else yet."

**Why phrased this way.** Naming it `analyze_responses` (not `summarize`) carries semantic load so
the model distinguishes it from `get_responses`. "Following the exact shape of get_responses" makes
the diff small and idiomatic. "Only edit toolDefs" prevents a runaway multi-file change.

**Say aloud while it runs:** "I'm adding just the schema first so I can eyeball how the model sees
the tool, before I write any logic."

**Verify:** read the diff aloud; confirm it's one new map entry with `form_id` required.

### Prompt 2 — add the implementation
**Type:**
> "Now add a `case \"analyze_responses\":` to the `dispatchTool` switch in tools.go. Unmarshal
> `form_id` like `get_responses` does, return an error if it's empty, read the responses from
> `store.responses` under the mutex, and compute a small stats struct — total count and a
> map of answer to count — then marshal that struct to JSON and return it. Keep it about ten to
> fifteen lines. Don't change the other cases."

**Why phrased this way.** Returning a **struct → JSON** (not a prose sentence) keeps "what" separate
from "how" — the model phrases the summary, the tool just computes. Reusing the `get_responses`
mutex/unmarshal pattern keeps it consistent and review-light.

**Say aloud:** "I'm returning structured stats rather than a sentence, so the model owns the wording
— same reason I'd return a struct from any tool. And note the canned answers are qualitative —
'Strongly agree', 'Neutral' — so a literal *average* has no number; a count-and-distribution is the
honest computation here. If they want a numeric average I'd add a numeric `rating` to the mock."

**Verify:** read the diff; confirm error path on empty `form_id`, mutex used, struct marshalled.

### Prompt 3 — build, restart, curl
**Type (or just run in the terminal):**
> `go build ./... && ./typeform-chat`  *(in another pane)* then a curl that first creates a form and
> then asks for analytics, e.g. copy the create-form + analyze prompts from DEMO.md.

**curl:**
```
curl -N -X POST localhost:8080/chat -H 'Content-Type: application/json' \
  -d '{"session_id":"s1","message":"Whats the breakdown of responses for the Customer NPS form?"}'
```

**Say aloud:** "I'm verifying two things — that the model *routes* to analyze_responses rather than
get_responses, and that it streams a readable summary off the struct."

**Verify:** an `event: tool_result` with `name: analyze_responses`, then streamed text. If it routed
to `get_responses` instead → Prompt 4.

### Prompt 4 — only if the model misroutes
**Type:**
> "The model is calling get_responses instead of analyze_responses for analytics questions. Tighten
> the two tool descriptions in tools.go so they're mutually exclusive: get_responses returns the raw
> list of submissions; analyze_responses computes aggregate statistics. Don't change any logic."

**Why.** Tool selection is driven by the `toolDefs` descriptions via the function-calling A-P-I, so
disambiguating descriptions is the right lever — `prompts/system.txt` is the fallback if that's not
enough. Narrate: "I'm fixing routing at the tool description, not the system prompt — that's where
the model actually reads intent."

### Prompt 5 — optional, only if asked for tests
**Type:**
> "Add a table-driven test in tools_test.go for dispatchTool with name analyze_responses: a happy
> path over a seeded form, and the empty form_id error case. Match the style of the existing tests."

**Why.** Tools are pure functions — cheapest possible test. Mentioning it unprompted signals you
think about tests; only build it if there's time or they ask.

---

## After Friday
- `mv` this file + audio out of sight (already in `.sdd-scratch/`).
- If you scored 5+/6 on the rehearsal, stop preparing.
