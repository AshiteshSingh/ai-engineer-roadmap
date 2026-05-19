# Spec-Driven Development: Specs as the Durable Contract for Coding Agents

Spec-Driven Development (SDD) is the professional response to the chaos of unsupervised AI code generation. Instead of prompting an agent ("create me a button") and iterating against whatever it produces, you decouple the *specification* — the what and the why — from the *implementation* — the how. The spec becomes a permanent technical artifact and a contract between humans, and between humans and the agent. This lesson distills the DeepLearning.AI / JetBrains course *Spec-Driven Development with Coding Agents* into the engineering principles that make it work, and connects them to the rest of Phase 2: a project constitution is a [system prompt](/system-prompts) for an entire codebase, a feature spec is a [structured-output](/structured-output) contract for generated code, and the whole discipline is the intent-fidelity principle from [prompt engineering fundamentals](/prompt-engineering-fundamentals) applied at project scale.

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
