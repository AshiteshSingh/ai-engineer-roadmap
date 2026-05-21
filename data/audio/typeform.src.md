# Typeform Live-Coding Interview — Audio Prep

Spoken-narration prep for the ninety-minute live coding with George Gillams and Ethan Carlsson on the Typeform AI team. Listen until the cadence is yours.

Nine chapters, roughly thirty minutes total. Every chapter is a moment inside the ninety-minute interview. No generic narration, no engineering memoir. Each chapter is what I will say at that specific moment.

## The 60-second background pitch

This is what I say when George asks for the 60-second version of my background, somewhere in the first eight minutes of the call. I say it once, I do not pad it, and I land on the bridge to the role.

Sure. I'm between roles right now. Vitrifi, where I spent four years as a Senior Full Stack, shut down at the start of the year. So I can speak about the architecture concretely. Before that, about twelve years of production web platforms, mostly React, TypeScript, and Go. At Vitrifi we ran five Go services behind a schema-first GraphQL gateway. Around two hundred and forty thousand lines of Go. Close to five thousand commits across four years. Heavy use of an event bus with protocol buffer messages. OpenTelemetry tracing across all of it. The Go work I'd lead with is the stuff I personally designed. Custom GraphQL scalars carrying HTML sanitisation through the type system. Validation directives enforced by middleware. A couple of small library packages for cross-cutting primitives. Since Vitrifi closed I've been going deep on the AI side. Built an AI engineering roadmap site, around a hundred lessons on agents, evals, retrieval-augmented generation, LangGraph, observability. Built it in Next.js and Radix. That's actually what made this role catch my eye. Your stack, my interest area, and I want to ship AI systems daily instead of writing about them.

If I run long, I drop the Go portfolio sentence and let it surface later when George asks "what did you actually write?" If I blank, the fallback is one sentence: between roles since January when Vitrifi shut down, four years of Go and React on a multi-tenant United Kingdom telecoms platform, now deep on an AI engineering roadmap site and looking to ship daily.

## The scaffold opener and the light spec

This is minute eight to thirteen of the call. George has said "want to walk us through what you've got?" and I have the editor open on the small Go scaffold I brought. Two pieces: a thirty-second opener that hands them the choice, and a three-line verbal spec before I touch a line of code.

I lead with the opener. I have a small Go scaffold here with a slash-chat endpoint and three mock Typeform tools — create form, list forms, get responses — so we don't burn time on boilerplate. It streams via server-sent events, the one-direction streaming protocol over plain HTTP, has in-memory session memory, and a Next.js frontend wired up if we want it. Happy to extend it, swap a tool out, or start fresh. What would be most useful for you to see? That's the opener. I do not narrate the architecture before they tell me what they want. The point is to hand them the choice, not to deliver a presentation.

Once George names a direction — say, add an analytics capability that summarises form responses — I do the light spec out loud before opening any new file. The recruiter's warning was sharp on this: useful as a light structure, but never the main event. The spec is the muscle, not the show. So this is forty seconds, not fifteen minutes. The single biggest failure mode in this interview is spending fifteen minutes designing the perfect spec and never getting to working code. That is the failure mode I am explicitly defending against.

The script is four sentences. Goal, one sentence: add a tool the agent can call to compute summary stats over a form's responses. User, one sentence: a Typeform customer who wants quick insight without writing structured query language. Success, one sentence: end-to-end, the user asks, the agent picks the new tool, runs over the mock store, streams a natural-language summary. Out of scope today, one sentence: the real Typeform API, retries, multi-form joins. Then I confirm. Does that match what you're looking for?

That's the whole spec. Maybe forty seconds spoken. I might type those four lines into a fresh file called spec dot M D in the project root, takes another twenty seconds. Then I close the file and start coding. I do not open any methodology directory. I do not whiteboard architecture. I do not open the spec-driven-development scratch directory. I do not name a framework. If I am still typing the spec at thirteen minutes, I stop and start coding immediately.

The reason I do the spec at all is that it gives me an anchor for the rest of the hour. When George asks at minute twenty-three why did you do X, I can point at the verbal spec — not the file — and say out of scope for what we agreed on, or in scope, here is why. It also gives me a clean way to skip things without looking sloppy. The out-of-scope line is the most useful sentence in the whole spec. I will use it deliberately, at least twice, during the coding stretch.

## What I'll say while coding

This is the long stretch, minute thirteen to about minute sixty. I'm in the editor, AI assistance running, narrating continuously. The narration is the deliverable as much as the code. George's email said "talk through your thinking process throughout" and "we assess your use of AI tools." Both are graded by what comes out of my mouth, not by what I type.

So I narrate every meaningful action. Before I send a prompt to Cursor or Claude, I read the prompt out loud. After the AI generates code, I read the generated code out loud before I accept it, and I say what I'm checking for — that the types match, that the error handling is what I'd write, that nothing has been silently invented. If I disagree with a suggestion I say so and explain why I'm overriding it. Silent acceptance is the failure mode here. If they wanted silent acceptance they wouldn't be assessing how I use AI tools — they want to see judgment, not stenography.

I narrate trade-offs deliberately, at least twice during the coding stretch. The first one comes early, around minute twenty. I'll say something like: I'm using an in-memory session store, which is fine for the demo. In production I'd put it behind an interface and back it with Redis or a document store so sessions survive a restart. That's a one-hour swap, not a redesign. The second trade-off lands around minute forty: I'm not adding retries on the language-model call. Happy path is fine for showing the loop. In production I'd add exponential backoff and a circuit breaker, and the more interesting question is what idempotency looks like for tools that have side effects, which is where saga compensation comes in. Both lines come out naturally because I've rehearsed them. They're not apologies, they're flags I'm planting on purpose.

I test as I go. After each meaningful change I curl the endpoint, or use the frontend, and I narrate what I'm checking. I say: I'm running curl number one to confirm the agent picks the new tool. I say: I'm checking that the tool result event fires before the streamed text. I say: this is the showstopper for session memory, the model has to remember from turn one that the net-promoter-score form is form one. Testing is part of the workflow they're grading, so I do it on screen rather than alt-tabbing.

The light spec resurfaces twice during this stretch, both times as a tool not a fence. The first time is when I am about to skip something. I say it out loud: real Typeform API integration is out of scope for what we agreed on. Mock store is fine for the hour. That single line gives me cover to skip without looking sloppy. The second time is if I find myself adding something the spec did not list. I say it out loud the other way: that's out of scope for what I wrote down, but I'm adding it because the model needs it to terminate the loop. Both directions are honest, both are deliberate. The out-of-scope line is the muscle the verbal spec exists for.

When George asks why did I do X, I point at the verbal spec, not the file. I do not walk them through a methodology document. I do not open the scratch directory. I say: that's in scope because the success criterion we agreed on is end-to-end streaming, and this tool is on the critical path. Or I say: that's out of scope and I'd come back to it. Two sentences. Then I keep coding.

If I hit a wall — the AI generates something wrong, a test fails, the endpoint hangs — I narrate the wall, name two ways out, pick one, move on. I do not go silent. Silence at minute thirty-five is worse than picking the wrong fix at minute thirty-five.

## How I keep the AI tool consistent

This is a thing I do throughout the coding stretch, and it's worth calling out on its own because it's exactly what they said they're assessing — my use of AI tools. I don't drive the tool from a blank slate every prompt. I keep a small set of scoped instructions — skills — that load the house conventions for this codebase, so the generated code already follows them instead of me re-explaining the style every time.

Concretely, three of them matter for this scaffold. One carries the backend conventions: how the tool-definitions slice is shaped, how the dispatch function is structured, how the session store sits behind an interface, how the server-sent-events stream is written. One carries the test conventions: standard-library testing, fake the upstream model with an http test server, reset shared state between tests. One carries the tracing conventions: the span names and attributes so a trace is readable later. So when I ask the tool to add the summarise-responses capability, it already writes the tool definition in our shape, writes the test the way the rest of the suite is written, and traces the call like every other tool — without me hand-holding each prompt.

If George asks why bother, the answer is the principle I keep coming back to: make the machine carry the invariant instead of trusting myself to remember it under pressure. A skill is how I stop the tool from free-styling its own conventions, and it's reviewable and version-controlled, so the conventions live next to the code rather than in my head. Same instinct as schema-first contracts and the eval suite — move correctness somewhere that fails earlier than production.

And the honest limit, which I'll say out loud: a skill biases the tool strongly toward the house style, it doesn't guarantee it. That's why I still read every diff out loud before I accept it. The skill narrows what the model is likely to do; the read-aloud review is what proves what it actually did.

## Answers to design probes

This is the band of the conversation where George or Ethan pushes back on something. "Why did you go with that?" "Could that prompt go wrong?" "How would you know this is working in production?" These are not gotchas. They are the questions they came in planning to ask. The answers below are the answers I give.

When asked why a particular tool name or shape, I lean on the spec instinct. For an agent the spec is the contract. Name, arguments, return type, side effects. I name tools so the model can pick them from intent rather than from copy-pasted examples. If I have a tool called create-form alongside one called summarise-responses, the model has enough signal to route correctly without me hand-tuning the prompt for every phrasing. That is the same engineering instinct as schema-first GraphQL at Vitrifi, just with the language model as the new consumer of the contract.

When asked how I would handle off-topic or impossible asks, the answer has two parts. First, the tool registry already returns a structured error for unknown tool names. That's in the execute-tool function in the scaffold. The model surfaces that back to the user. Second, in production I'd add an explicit refusal path in the system prompt and grade refusal quality in the eval suite. A confident refusal is a feature. A flailing refusal is a bug. The model should know what it can do and admit what it can't.

When asked how I would know this is working in production, the answer is observability per tool call. Structured logs for tool name, args, latency, error code, model used. Two metrics: turns to completion, and tool-selection accuracy. Plus a sampling pipeline that logs whole conversations for some small percent of traffic so I can look at what's actually happening when something feels off. The metric tells me there's a problem. The sample tells me what kind. That's the shape of observability I built into the Go services at Vitrifi, threaded through OpenTelemetry across HTTP, gRPC, and event-bus subjects.

When asked about testing, the answer is three layers. Unit tests per tool, easy because they're pure functions. A contract test on the server-sent-events format. And an eval suite of scripted conversations against the real model, graded on tool-selection accuracy. The eval is the part most agent codebases skip, and a quarter later they regret it because behaviour drifts silently. I'd treat eval failure exactly like a fuzz crash — it breaks the build.

When asked about extending the system to long-running tools — say, exporting all responses across a large form — the answer is event-driven decoupling. Publish a tool-requested event, have a worker consume it, stream tool-progress and tool-result events back. That's the messaging-bus pattern we ran at Vitrifi for state transitions, where the activator consumed events from the portal rather than being called inline. Same shape, different domain.

The throughline across these answers is one principle. Move correctness from runtime to a place that fails earlier. Type system for GraphQL. Eval suite for agents. Schema for tool contracts. I do not say that sentence as a slogan, I say it as the reason for each specific choice.

## What I'd improve next

This is the question Sean from the recruiter side explicitly flagged as the exit question. Probably around minute sixty to seventy-five. The answer is three items, ranked, memorised, delivered without looking at notes.

First, observability per tool call. Structured logs for tool name, args, latency, error code. Two metrics: turns to completion, and tool-selection accuracy. This goes first because without it the next two improvements are guesses. I cannot tell whether a new tool I add makes the agent better or worse. I cannot tell whether a system prompt change improved refusal quality. Observability is the diagnostic layer everything else depends on.

Second, eval coverage on entity resolution. The phrase "the net-promoter-score one" works in my demo because the session memory carries form one from the first turn. That is brittle. It works because the model held the context, not because the system did anything to guarantee it. I'd write a small eval suite — maybe twenty scripted conversations to start — covering realistic phrasings, and grade two things: tool-selection accuracy and argument-resolution accuracy. Eval failure breaks the build the same way a fuzz crash breaks the build today. That's the framing.

Third, event-driven decoupling for long-running tools. The current loop is synchronous. The next request waits for the tool to finish. That's fine for create-form, which is fast. It's not fine for response export over millions of rows. For tools like that I'd publish a tool-requested event, have a worker consume it, and stream tool-progress and tool-result events back. At Vitrifi we ran this pattern over our messaging bus with protocol buffer events, and the activator side never got called inline. Same shape here, different domain. Plus retries with idempotency keys on create-form, timeouts on every external call, and a dead-letter queue for messages that fail repeatedly so they surface instead of disappearing.

Those are the three. Observability first because without it I'm guessing. Evals second because they freeze the behaviour I have. Event-driven third because it unlocks the long-running tools you cannot do well synchronously. If George asks a follow-up like "which would you start tomorrow?" the answer is observability. That's where the leverage compounds fastest.

## Curveball answers

These are the specific Q&A pairs I want at the front of my mind. They might land anywhere — middle of coding, during the trade-off Q&A, or in the final five minutes. Each one is short.

If asked how a non-technical user would know what the agent can do: discoverability is a user-experience problem, not a code problem. The frontend already shows example prompts in the empty state. I'd extend that with suggestion chips driven by the tool registry, so when a tool is added the user-facing examples update automatically. Long term, the right move is a large-language-model-generated capabilities summary that updates when we add tools. Tooling tells the engineers what's possible. The interface has to tell the user.

If asked how I'd test this end-to-end: three layers. Unit tests per tool, pure functions, easy. A contract test on the server-sent-events format — I have one already in the scaffold. And an eval suite of scripted conversations against the real model, graded on tool-selection accuracy. Eval is the part most agent codebases skip.

If asked what happens when the user asks for something the agent cannot do: strict tool-name validation in the execute-tool function returns an unknown-tool error. The model receives that in the next turn and surfaces it to the user. For production I'd add an explicit refusal path in the system prompt and an eval that scores refusal quality.

If asked why server-sent events instead of WebSockets: one-direction server-push fits the token-streaming pattern. Plain HTTP works through proxies and load balancers. The streaming hook on the frontend consumes it natively. WebSockets would be over-engineered. I'd reach for them only if I needed the client to push back mid-stream.

If asked why Go: matches your stack, the chat loop is mostly orchestration and IO, Go's standard library handles HTTP and server-sent events without a framework, and the team already runs it. No benefit to introducing a second language for this surface.

If asked about multi-user concurrency on the same form: sessions are keyed by session ID, not user ID, so two users hit two sessions naturally. The interesting question is shared state on the form itself — for that I'd lean on optimistic locking at the API boundary, same way we handled concurrent order edits at Vitrifi.

If asked about tuning the system prompt: I treat it as code. It lives in version control, every change has a commit message explaining what behaviour it shifts, and I run the eval suite against each version. The eval is the test for the prompt.

If asked what the eval grading rubric looks like: each scripted conversation has an expected outcome — which tool, which args, whether the model declines. I grade per-turn on tool-selection accuracy and argument-resolution accuracy, and per-conversation on whether the user's goal was achieved. The aggregate over the suite is what I track over time.

## The frame mismatch — title versus work

If Ethan probes the gap between my title and what they're hiring for — Senior Full Stack versus Go Engineer — this is the answer. Honest, short, with a pivot.

My title at Vitrifi was Senior Full Stack. Across roughly five thousand commits I touched both sides. But the work I'd want to lead with is Go. The x-h-t-m-l package carrying HTML sanitisation through the type system. The x-validate composable builder. The x-g-q-l preload helpers eliminating N-plus-one on list endpoints. A path-traversal fix that resolved to absolute, joined target, rejected if the result didn't still prefix the base. Moving address sort out of the browser into the addressing service's typed query layer. The frontend work is real too. Zod schemas with a form-error-handler hook routing GraphQL errors back to exact form fields. The type-safety campaign removing any-type escape hatches. But the design judgement I'm proudest of lives on the Go side. I'd be glad to go heavier-Go in the next role.

I do not pretend to be a pure Go engineer. I do not minimise the frontend work. I name the split honestly, point at the Go pieces I designed, and signal direction. Anything else reads as either insecure or evasive.

## Questions, and what I will not say

Last five minutes of the interview. They'll ask if I have questions. Two is the sweet spot — three feels rushed, one feels disengaged. I pick the right one for the right person.

For Ethan, the technical one. I noticed event-driven programming is something the team leans on. At Vitrifi we ran a messaging bus with protocol buffer events, signature verification on consume, so the activator side picked up state transitions from the portal rather than being called inline. I'm curious how the agent loop is shaped here. More event-driven internally, with workers picking up tool-requested events and streaming results back, or a synchronous tool loop with streaming on the HTTP edge. The answer changes how I'd think about extending it for longer-running tools.

For George, the broader question. You're a frontend lead hiring a Go engineer. How does the AI team think about the boundary between the agent's behaviour and the user-experience layer. Where does prompt engineering live, and where does product design take over. That boundary is one of the harder problems in agent-driven products, and I'm curious how you draw it.

If both feel like too much in five minutes, the backup is: what's the hardest problem the team has not cracked yet. Safe, opens any direction they want.

The rest of this chapter is the discipline. The things I will say, and the things I will not say. I rehearse both lists because the say-list is the one that has to come out under pressure, and the not-say list is the one I will be tempted to violate when the conversation gets warm.

The things I will say, verbatim, because they are rehearsed. The opening line: between roles right now, Vitrifi shut down in January. Once, with the reason, then I move on. The three-line verbal spec before I code. The out-of-scope line at least twice during coding, as a deliberate skip. Two trade-offs out loud while I work: in-memory session store fine for the demo, would be Redis in production; and, I'm skipping retries on the language-model call, happy path first, I'd add exponential backoff and a circuit breaker for production. The three-item exit list when they ask what I'd improve next: observability per tool call, eval coverage on entity resolution, event-driven decoupling for long-running tools. And the two questions for them at the end, directed at the right person.

The things I will not say, and the reason each one stays in the box. I will not say spec-driven development by name. The recruiter's warning was direct: spec is the muscle, not the show. Light is the point, not the brand. If I name the framework I have made it the main event, which is exactly the failure mode I'm avoiding. I will not open the spec-driven scratch directory on screen. I will not whiteboard a methodology diagram. I will not reference any specific personal detail about George or Ethan from their social profiles. The research-stalking cost is far higher than the value. I will not mention Ethan's open-source Rust projects unprompted, even though I know about them. If Rust comes up naturally because they raise it, I will mention my own Rust work briefly. If they do not raise it, I do not. The role is Go. I will not humblebrag the roadmap site. If it comes up I frame it as evidence of where my interest has been, not as a credential. I will not pre-build a fourth tool just in case. If I have built it the moment they ask for something different, I will be tempted to force-fit, and the force-fit will show. I will not sit silent while the AI tool generates code. I read every line out loud before I accept it. That is the behaviour they are assessing, not just the code itself. And I will not have the dialogue or LinkedIn-scratch files visible in my editor file tree. They are hidden before I join the call.

That is the prep. The say-list and the don't-say list are the same list read from two sides. Both are the discipline. The interview is conversation, not recital. Read these chapters until the cadence is mine, then close the file.
