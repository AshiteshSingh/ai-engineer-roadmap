# Spec-Driven Development: Specs as the Durable Contract for Coding Agents

Spec-Driven Development (SDD) is the professional response to the chaos of unsupervised AI code generation. Instead of prompting an agent ("create me a button") and iterating against whatever it produces, you decouple the *specification* — the what and the why — from the *implementation* — the how. The spec becomes a permanent technical artifact and a contract between humans, and between humans and the agent. This lesson distills the DeepLearning.AI / JetBrains course *Spec-Driven Development with Coding Agents* into the engineering principles that make it work, and connects them to the rest of Phase 2: a project constitution is a [system prompt](/system-prompts) for an entire codebase, a feature spec is a [structured-output](/structured-output) contract for generated code, and the whole discipline is the intent-fidelity principle from [prompt engineering fundamentals](/prompt-engineering-fundamentals) applied at project scale. The course teaches one opinionated workflow; the back half of this lesson widens the lens — the competing tool landscape, a maturity taxonomy, and a deliberately skeptical reading drawn from Birgitta Böckeler's Thoughtworks survey [*Understanding Spec-Driven Development*](https://martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html) — so you can judge *when* SDD earns its overhead rather than adopt it by reflex.

## Mental Model

The mental model for SDD is **a control system with a small, durable setpoint driving a large, disposable output**. Vibe coding is open-loop: a high-level prompt produces code, you eyeball it, you correct the agent in a long conversational dialogue whose history is never saved, and technical debt mounts because nothing authoritative records *what was intended*. SDD closes the loop by promoting intent to a versioned file. A few sentences in a spec — "use SQLite with Prisma ORM" — amplify into hundreds of lines of implementation; change one sentence to "MongoDB" and the same amplification regenerates downstream. Because the setpoint is tiny relative to the output, the cognitive overhead of supervising an ultra-fast coding agent collapses from "read every diff" to "review the spec, then spot-check the amplification." This is why the spec, not the code, is the primary engineering artifact: it has the highest leverage-to-size ratio in the system, it survives across agent sessions, and it is the only place where human architectural judgment is recorded once and reused indefinitely. The agent is a stateless amplifier; the spec is the memory.

```xyflow
{
  "direction": "LR",
  "nodes": [
    {"id": "intent", "label": "Human intent", "shape": "stadium"},
    {"id": "spec", "label": "Spec\n(small setpoint)", "shape": "circle"},
    {"id": "agent", "label": "Coding agent\n(amplifier)", "shape": "diamond"},
    {"id": "code", "label": "Implementation\n(large output)", "shape": "rect"},
    {"id": "review", "label": "Human review", "shape": "stadium"}
  ],
  "edges": [
    {"source": "intent", "target": "spec", "label": "convert to contract"},
    {"source": "spec", "target": "agent", "label": "boot context"},
    {"source": "agent", "target": "code", "label": "amplify"},
    {"source": "code", "target": "review", "label": "validate"},
    {"source": "review", "target": "spec", "label": "correct the setpoint"}
  ]
}
```

## Why Specs Beat Vibe Coding

Vibe coding is fast for a button and catastrophic for a project. You write a prompt, hope for the best, point out what is wrong, and repeat. The result is disposable code and an unsaved dialogue — there is no artifact a teammate, or a future agent session, can read to learn what the system is supposed to do. SDD trades a small amount of upfront writing for three compounding benefits that the course states explicitly.

First, **leverage**: large code changes are controlled by small spec changes. One clause about look and feel can translate to hundreds of lines of CSS, so editing the spec is dramatically more efficient than editing code by hand.

Second, **context durability**: specs eliminate context decay between sessions. Agents are stateless — every session boots fresh — so the highest-quality context must be loaded at boot time. A spec is exactly that durable boot payload, which is why this is the same discipline as [context engineering](/context-engineering): you are deciding what the model must know the instant it starts.

Third, **intent fidelity**: when you define the problem, success criteria, and constraints precisely, the agent can elaborate a fuller plan that matches what you actually need rather than what a terse prompt implied. One effective authoring technique from the course is to *converse* with an agent (Claude Code, Gemini, Codex) to make the key architectural trade-offs using your own judgment, then have the agent summarize the agreed decisions into the spec.

```xyflow
{
  "direction": "TD",
  "nodes": [
    {"id": "vibe", "label": "Vibe prompt", "shape": "rect"},
    {"id": "guess", "label": "Agent guesses", "shape": "diamond"},
    {"id": "debt", "label": "Disposable code\n+ unsaved dialogue", "shape": "rect"},
    {"id": "sdd", "label": "Spec contract", "shape": "circle"},
    {"id": "fidelity", "label": "Intent fidelity", "shape": "stadium"},
    {"id": "artifact", "label": "Durable artifact", "shape": "stadium"},
    {"id": "scale", "label": "Scales to a project", "shape": "circle"}
  ],
  "edges": [
    {"source": "vibe", "target": "guess"},
    {"source": "guess", "target": "debt", "label": "mounting tech debt"},
    {"source": "sdd", "target": "fidelity"},
    {"source": "sdd", "target": "artifact"},
    {"source": "fidelity", "target": "scale"},
    {"source": "artifact", "target": "scale"}
  ]
}
```

## The Constitution: A System Prompt for the Whole Project

Before any feature, SDD establishes a **Constitution** — project-level decisions formalized into three documents the course names directly: `mission.md` (the why: vision, audience, scope), `tech-stack.md` (the common understanding of development and deployment technologies and constraints), and `roadmap.md` (a living, phased sequence of features). A Constitution is agent-agnostic and more structured than a single top-level `AGENTS.md`, and it captures the agreement on key decisions both between the human and the agent *and* between humans on the team.

```text
# mission.md
AgentClinic — a place for AI agents to get relief from their humans.
Audience: developers learning agentic workflows. Scope: web app, parody
of PetClinic. Non-negotiable: every feature ships behind a feature spec.

# tech-stack.md
Runtime: Node + TypeScript (strict). Web: Hono. DB: SQLite + plain SQL
migrations. Tests required for validation. Deploy: single container.

# roadmap.md
Phase 1: Hello Hono (placeholder home page)
Phase 2: Agents & Ailments (CRUD over SQLite)
Phase 3: MVP — implement the remaining roadmap
```

You do not write the Constitution alone — you write it *in conversation with the agent*, which surfaces architecture patterns you had not considered, existing packages that already do the work, and trade-offs such as speed versus data fidelity. Architecturally this is identical to the discipline taught in [system prompts](/system-prompts): the Constitution is the highest-priority, lowest-trust-required instruction set that constrains everything the agent generates afterward. It is the codebase's constitution in the same sense a system prompt is an application's constitution — durable, authoritative, and the first thing loaded.

## The Per-Feature Loop: Specify → Plan → Implement → Validate

Once the Constitution exists, every feature runs through a repeatable loop. The key skill is choosing the **right level of detail**: treat the agent as a highly capable pair programmer — give it rich context about goals, mission, audience, and constraints, and *less* about low-level decisions it can figure out itself.

You start each feature with **fresh agent context** on a dedicated branch. The agent draws what it needs from the authoritative source — the Constitution — then helps produce a feature spec, a task plan, collected requirements, and a validation scorecard. The agent asks clarifying questions; you make the key decisions (pin the framework version, enforce strict TypeScript, choose plain SQL migrations) and watch for conflicts. After implementation you `/clear` context and review against the spec, focusing on whether the feature works and reflects the spec rather than on which CSS classes were used. A mistake in the code usually traces back to a mistake in the plan, so you correct *both* the spec and the implementation to keep requirements and validation in sync. This generate-then-verify rhythm is the human-in-the-loop.

```xyflow
{
  "direction": "LR",
  "nodes": [
    {"id": "const", "label": "Constitution", "shape": "circle"},
    {"id": "specify", "label": "Specify\n(spec + scorecard)", "shape": "rect"},
    {"id": "plan", "label": "Plan\n(task groups)", "shape": "rect"},
    {"id": "impl", "label": "Implement", "shape": "rect"},
    {"id": "validate", "label": "Validate\n(human in loop)", "shape": "diamond"},
    {"id": "merge", "label": "Merge feature\nbranch", "shape": "stadium"}
  ],
  "edges": [
    {"source": "const", "target": "specify", "label": "fresh context"},
    {"source": "specify", "target": "plan"},
    {"source": "plan", "target": "impl"},
    {"source": "impl", "target": "validate"},
    {"source": "validate", "target": "specify", "label": "fix spec + code"},
    {"source": "validate", "target": "merge", "label": "passes scorecard"}
  ]
}
```

Implementing feature-by-feature, with frequent commits, keeps each diff manageable. For areas where small mistakes compound — security, database migrations — run task groups one at a time instead of implementing the whole plan in a single step. The validation scorecard turns "does this look right?" into a checkable contract, which is the [structured-output](/structured-output) principle applied to feature acceptance.

## Replanning, the MVP Gamble, and Legacy Projects

Between features you deliberately **run slow to run fast**. The Constitution is a living document: when you discover a missing testing preference, or the product manager reports that 40% of users are on mobile and you must emphasize responsive design, you make the change on a dedicated *replanning* branch so you can track which version of the Constitution produced which code. You then instruct the agent to update existing feature specs and implementations to reflect the constitutional change — spec and code evolve together, never independently.

The **MVP gamble** is a controlled stress test: a variation of the standard prompt that tells the agent to implement the *rest* of the roadmap at once, with guidance about existing specs. You only take this risk when you are confident in the quality of your Constitution and specs and can handle the review load. If the result diverges from intent, that is a signal to run a disciplined replanning phase to eliminate whatever led the agent astray — the divergence is diagnostic feedback on your context quality, not just a bug.

SDD is not only for greenfield work. To bring it to a **legacy project**, start a fresh agent session on `main` without a specs folder and run the Constitution step against existing artifacts — a `README.md`, a `TODO.md`, issue trackers, spreadsheets. The agent explores the codebase through tool calls and reverse-engineers the SDD artifacts: it extracts the file structure, framework versions, and roadmap items from what already exists. The Constitution then aligns *future* agent changes with what past developers already built.

```xyflow
{
  "direction": "TD",
  "nodes": [
    {"id": "f1", "label": "Feature 1 done", "shape": "stadium"},
    {"id": "reflect", "label": "Reflect", "shape": "diamond"},
    {"id": "branch", "label": "Replanning\nbranch", "shape": "rect"},
    {"id": "const2", "label": "Constitution v2\n(living doc)", "shape": "circle"},
    {"id": "sync", "label": "Sync specs\n+ code", "shape": "rect"},
    {"id": "mvp", "label": "MVP gamble", "shape": "diamond"},
    {"id": "legacy", "label": "Legacy onboarding\n(reverse-engineer)", "shape": "rect"}
  ],
  "edges": [
    {"source": "f1", "target": "reflect"},
    {"source": "reflect", "target": "branch", "label": "run slow"},
    {"source": "branch", "target": "const2"},
    {"source": "const2", "target": "sync"},
    {"source": "sync", "target": "mvp", "label": "if confident"},
    {"source": "const2", "target": "legacy", "label": "existing artifacts"}
  ]
}
```

## Runtime Internals

Understanding *why* SDD works requires looking at how a coding agent actually runs. An agent is **stateless across sessions**: each invocation boots with an empty working memory and a finite context budget. There is no persistence of the previous dialogue unless something external recorded it — which is precisely the failure mode of vibe coding. SDD treats the spec set as the agent's externalized memory: at boot, the Constitution and the active feature spec are loaded as the highest-quality context, so the model's limited budget is spent on the next unit of work rather than on reconstructing forgotten intent. Between phases you issue `/clear` to flush the context window deliberately, ensuring the next feature is driven by the *written spec* (intent) and not by a stale memory snapshot of the last conversation. Versioning is the other half of the runtime: because specs and code live in git, a replanning branch records exactly which Constitution version produced which implementation, so a regression can be traced to a constitutional change rather than guessed at. The agent discovers artifacts at runtime through tool calls — reading files, exploring directories — which is why the [tool-use](/tool-use) layer and good repository hygiene matter: the spec is only authoritative if the agent can reliably find and read it. This boot-context-plus-versioned-artifacts model is what converts a fast but forgetful generator into a supervised, auditable engineering process.

```xyflow
{
  "direction": "LR",
  "nodes": [
    {"id": "boot", "label": "Session boot\n(empty memory)", "shape": "stadium"},
    {"id": "load", "label": "Load Constitution\n+ feature spec", "shape": "circle"},
    {"id": "budget", "label": "Finite context\nbudget", "shape": "diamond"},
    {"id": "tools", "label": "Tool calls\n(read repo)", "shape": "rect"},
    {"id": "gen", "label": "Generate", "shape": "rect"},
    {"id": "clear", "label": "/clear", "shape": "rect"},
    {"id": "git", "label": "Git: branch +\ncommit checkpoints", "shape": "stadium"},
    {"id": "next", "label": "Next feature\n(fresh context)", "shape": "circle"}
  ],
  "edges": [
    {"source": "boot", "target": "load"},
    {"source": "load", "target": "budget"},
    {"source": "budget", "target": "tools"},
    {"source": "tools", "target": "gen"},
    {"source": "gen", "target": "git", "label": "checkpoint"},
    {"source": "git", "target": "clear"},
    {"source": "clear", "target": "next", "label": "no stale snapshot"},
    {"source": "next", "target": "load"}
  ]
}
```

## Build Your Own Workflow, and Agent Replaceability

Once the loop is mastered, the repeated prompting ("write these three files, plan, implement, validate") is friction worth automating. The course automates it with an **Agent Skill** — an open-standard, reusable capability authored with the agent's own skill-creator. Skills can be per-project or global and are invoked through *progressive disclosure*: the agent reads a skill's description and decides when to call it. Because that judgment degrades as the context window grows, apply the same heuristic as file tagging — if you know you want a skill used, name it explicitly to save thinking tokens. This is the [code-agents](/code-agents) automation pattern: capturing a repeatable engineering process as a first-class, named artifact.

```bash
# The SDD loop, per feature, as a scripted ritual a Skill encodes:
git checkout -b feat/agents-and-ailments
# 1. Specify: agent drafts spec.md, plan.md, validation.md from the Constitution
# 2. Plan:    review task groups; run risky groups (db, security) one at a time
# 3. Implement
# 4. Validate: human-in-the-loop review against validation.md
git add -A && git commit -m "feat: agents & ailments (spec-driven)"
git checkout main && git merge --no-ff feat/agents-and-ailments
```

The final principle is **agent replaceability**. Models and agents improve monthly, so you do not want a workflow welded to one vendor. Open standards make agents swappable while the SDD workflow and tools stay put: MCP for external tools, `AGENTS.md` for rules, Agent Skills for repeatable workflows-plus-context, and ACP (the Agent Client Protocol) for connecting agents to editors. A feature-spec skill authored for Claude Code runs unchanged in Codex once copied to its path; the ACP registry automates discovering, installing, and connecting agents to clients across their lifecycle. SDD moves the work from the *how* to the *what and why*, so the *how* — which specific agent executes the spec — becomes an interchangeable implementation detail. The specs you write today become the memory of your projects tomorrow; keep them sharp, and the agent stays a replaceable driver of an engineering process you own. The same intent-first reasoning underlies [prompt optimization](/prompt-optimization): improve the durable instruction, not the disposable output.

## The SDD Tool Landscape: Kiro, Spec-Kit & Tessl

The course teaches one workflow, but "spec-driven development" is a label several tools wear differently — as Böckeler puts it, SDD "is not just one thing." Three are worth knowing because they bracket the design space. **Kiro** is the lightweight end: a VS Code-based tool with a fixed `Requirements → Design → Tasks` flow, one markdown document per step, requirements expressed as `As a…` user stories with `GIVEN…WHEN…THEN…` acceptance criteria, and a flexible memory bank it calls *steering* (`product.md`, `structure.md`, `tech.md`). **GitHub Spec-Kit** is the most customizable: a CLI scaffolds workspace files for many coding assistants, you drive it through slash commands, and its memory bank is the **constitution** — immutable high-level principles applied to every change, the same idea this lesson's constitution section described. Its loop is `Constitution → ⟲ Specify → Plan → Tasks ⟲`, instantiated through bash scripts and templates with heavy AI-interpreted checklists acting as a per-step "definition of done." **Tessl Framework** (private beta, CLI that doubles as an [MCP](/tool-use) server) is the only one explicitly chasing the deep end: code files carry a `// GENERATED FROM SPEC — DO NOT EDIT` header, `tessl document --code` reverse-engineers a spec, `@generate`/`@test` tags and an API section pin the exposed interface, and `tessl build` regenerates the file. The decisive axes that separate them are workflow opinionation, how many artifacts a single spec sprawls into, whether a "memory bank" is optional or mandatory, and the abstraction level the spec sits at. Pick the tool by problem shape, not by brand — the same selection discipline you apply to an [agent harness](/agent-harnesses).

```xyflow
{
  "direction": "TD",
  "nodes": [
    {"id": "kiro", "label": "Kiro\n(lightweight)", "shape": "circle"},
    {"id": "spec", "label": "Spec-Kit\n(customizable CLI)", "shape": "circle"},
    {"id": "tessl", "label": "Tessl\n(beta, ambitious)", "shape": "circle"},
    {"id": "kflow", "label": "Requirements→\nDesign→Tasks", "shape": "rect"},
    {"id": "sflow", "label": "Constitution→\nSpecify→Plan→Tasks", "shape": "rect"},
    {"id": "tflow", "label": "Spec is source;\ncode GENERATED", "shape": "rect"},
    {"id": "bank", "label": "Memory bank\n(optional vs required)", "shape": "diamond"},
    {"id": "abs", "label": "Abstraction level\n+ artifact sprawl", "shape": "diamond"}
  ],
  "edges": [
    {"source": "kiro", "target": "kflow"},
    {"source": "spec", "target": "sflow"},
    {"source": "tessl", "target": "tflow"},
    {"source": "kflow", "target": "bank", "label": "steering (loose)"},
    {"source": "sflow", "target": "bank", "label": "constitution (required)"},
    {"source": "tflow", "target": "abs", "label": "per-file 1:1"},
    {"source": "bank", "target": "abs"}
  ]
}
```

## A Maturity Taxonomy: Spec-First → Spec-Anchored → Spec-as-Source

Böckeler's most useful contribution is a maturity ladder that cuts through the marketing. **Spec-first**: a well-considered spec is written, used for the task, and then effectively discarded — every change starts a new spec. **Spec-anchored**: the spec survives the task and is maintained as the feature evolves, edited alongside the code over time. **Spec-as-source**: the spec is the primary artifact; humans edit only the spec and never touch the (generated) code. Every approach she examined is at least spec-first, but few genuinely reach spec-anchored, and the maintenance strategy over time is usually left vague — Spec-Kit even branches per spec, which reads more like change-request scope than feature-lifetime anchoring. Her working definition is worth memorizing: *a spec is a structured, behavior-oriented artifact — or set of related artifacts — written in natural language that expresses software functionality and serves as guidance to AI coding agents.* Crucially, separate the **spec** (task-scoped, only relevant to the change it drives) from the **memory bank** (cross-session rules and product/architecture context relevant to *every* session) — conflating them is why so many setups feel bloated; this is the same boundary [context engineering](/context-engineering) draws between durable and per-task context. The honest warning attached to the top of the ladder is the Model-Driven Development parallel: spec-as-source is MDD with a natural-language model and an LLM code generator. MDD never took hold for business applications — awkward abstraction level, too much overhead — and LLMs remove the parseable-DSL overhead only by trading it for non-determinism, risking the downsides of *both*: inflexibility and unpredictability, minus the tool support that once validated specs for completeness.

```xyflow
{
  "direction": "LR",
  "nodes": [
    {"id": "first", "label": "Spec-first\n(spec → task → discard)", "shape": "stadium"},
    {"id": "anchor", "label": "Spec-anchored\n(spec lives with feature)", "shape": "stadium"},
    {"id": "source", "label": "Spec-as-source\n(code GENERATED)", "shape": "stadium"},
    {"id": "mdd", "label": "MDD echo:\ninflexibility +\nnon-determinism", "shape": "diamond"},
    {"id": "bankc", "label": "Memory bank\n(cross-session)", "shape": "rect"},
    {"id": "specc", "label": "Spec\n(task-scoped)", "shape": "rect"}
  ],
  "edges": [
    {"source": "first", "target": "anchor", "label": "persist"},
    {"source": "anchor", "target": "source", "label": "invert ownership"},
    {"source": "source", "target": "mdd", "label": "learn from the past"},
    {"source": "bankc", "target": "specc", "label": "keep distinct"},
    {"source": "specc", "target": "first"}
  ]
}
```

## When SDD Is Over-Engineering

A balanced engineer holds both truths: spec-first is genuinely valuable — "how do I structure my memory bank?" and "how do I write a good spec for AI?" are among the most-asked practitioner questions — *and* the elaborate end of SDD can be `Verschlimmbesserung`, making things worse while trying to make them better. Böckeler's field reports are the cautionary data. **Problem-size mismatch**: asked to fix a small bug, Kiro inflated it into four user stories and sixteen acceptance criteria — "a sledgehammer to crack a nut"; a 3–5 point feature in Spec-Kit produced so many files to review she felt she'd have shipped it faster with plain AI-assisted coding and stayed more in control. **Review burden**: verbose, repetitive markdown that is more tedious to review than the code it describes — an effective tool needs a great spec-*review* experience, not just generation. **False sense of control**: bigger context windows do not mean the agent honors everything in them — it regenerated existing classes as duplicates by ignoring "this already exists" notes, and elsewhere over-applied a constitution rule too zealously. **Functional/technical separation** stays slippery, and our profession's track record at keeping requirements free of implementation is poor. The decision is therefore not "adopt SDD" but "match ceremony to the problem": small or well-understood changes favor tight iterative loops (the control argument from [adversarial-prompting](/adversarial-prompting)'s small-blast-radius logic and from [code agents](/code-agents)); large *and* well-specified work is where heavyweight SDD pays for its overhead. And because agents interpret specs non-deterministically, the validation scorecard is not optional decoration — it is the [eval](/eval-fundamentals) harness that tells you the amplification matched intent. The term is already semantically diffused — people now say "spec" to mean "a detailed prompt" — so the engineering value is not the label but the judgment of when a durable, right-sized spec beats a fast, disposable one. Treat this lesson's enthusiastic methodology and Böckeler's skepticism as the two error bars on the same measurement.

```xyflow
{
  "direction": "TD",
  "nodes": [
    {"id": "q", "label": "New change", "shape": "stadium"},
    {"id": "clear", "label": "Problem\nwell-defined?", "shape": "diamond"},
    {"id": "big", "label": "Large /\nmulti-feature?", "shape": "diamond"},
    {"id": "plain", "label": "Plain AI-assisted\n(tight loop)", "shape": "rect"},
    {"id": "sf", "label": "Spec-first\n(right-sized)", "shape": "rect"},
    {"id": "full", "label": "Full SDD\n+ scorecard", "shape": "rect"},
    {"id": "review", "label": "Review cost <\ncode review?", "shape": "diamond"}
  ],
  "edges": [
    {"source": "q", "target": "clear"},
    {"source": "clear", "target": "plain", "label": "small + clear"},
    {"source": "clear", "target": "big", "label": "clear + sizable"},
    {"source": "big", "target": "sf", "label": "no"},
    {"source": "big", "target": "full", "label": "yes"},
    {"source": "full", "target": "review", "label": "check overhead"},
    {"source": "review", "target": "sf", "label": "if not, downsize"}
  ]
}
```
