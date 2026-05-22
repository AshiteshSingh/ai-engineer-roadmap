# Live-Run Simulation — Typeform (dialogue + prompts + keyboard)

> One pass through the whole session. Each beat is tagged:
> **🟢 George / 🔵 Ethan** (they say) · **🗣️ You** (you say) · **⌨️** (what you type/press/run) · **✅** (verify).
> Pairs with `coach-dialogue.md` (full spoken answers) and `delivery-notes.md` (cue cards).
> **Assumption:** you're demoing the **lean 3-tool mock scaffold** and building `analyze_responses`
> live. Live-API / scores / sampling / evals = **talking points**, not the demo.

---

## ⌨️ Keyboard cheat (the whole coding loop, in order)

```
Pane layout:  [editor + Claude Code]   [server]   [curl]

Server (pane 2):     make run            # → "listening on :8080"; Ctrl-C to stop, ↑+Enter to restart
Claude Code (pane 1): type prompt → Enter → READ DIFF ALOUD → accept (or Esc/No to reject)
Curl (pane 3):       paste a one-liner below after each change

THE LOOP, every change:  prompt → read diff aloud → accept → restart server → curl → narrate result
RULES: small prompts (one change each) · never auto-accept · curl after every change · never silent
```

**Curl one-liners** (same `session_id=s1` so memory carries across turns):
```bash
# create
curl -N -X POST localhost:8080/chat -H 'Content-Type: application/json' \
 -d '{"session_id":"s1","message":"Create a form called Customer NPS with fields rating, comment, email"}'
# the analytics ask (the one that should hit analyze_responses)
curl -N -X POST localhost:8080/chat -H 'Content-Type: application/json' \
 -d '{"session_id":"s1","message":"Whats the breakdown of responses for the Customer NPS form?"}'
```

---

## 0. Pre-call setup (⌨️ — before they join)

- ⌨️ Repo in **lean demo state** (3 tools, mock, SSE, loop). `git status` clean; analyze_responses NOT yet added.
- ⌨️ `make run` in pane 2 → **✅ `listening on :8080`**. Ctrl-C it; you'll restart live.
- ⌨️ Run create + analytics curls once now to confirm the baseline; then reset (`rm -f sessions.db` if you want a clean slate).
- ⌨️ Claude Code open in pane 1, **signed in**, permission mode that **shows diffs before applying** (NOT auto-accept/bypass).
- ⌨️ Hidden from the tree: `.sdd-scratch/`, `.claude/`, `web/AGENTS.md`, the lead-gen repo. Visible: `tools.go`, `main.go`, `DEMO.md`, terminals.
- ⌨️ macOS Screen Recording enabled for the call app + **test screen-share** done.

---

## 1. Intro / background (0:00–0:08) — dialogue only

🟢 George: greets, gives Typeform-AI context, asks for the 60-sec background.
🗣️ You: the cue-card background (between roles → Go scale → what *I* built → lead-gen AI bridge), end on the Go-scaffold bridge. *(full text: delivery-notes.md / Chapter One)*
🟢 George: "What draws you to AI?"
🗣️ You: "…the engineering around the model — evals, grounding, routing — that turns a flaky demo into something you can trust." Stop.

---

## 2. Opener + the task (0:08–0:10)

🟢 George: "You brought a scaffold — walk us through it?"
🗣️ You (30-sec opener): "Small Go binary, `/chat`, three mock tools, SSE streaming, in-process session memory, tool-calling loop capped at 5 turns. Frontend if we want it. What's useful to see?"
⌨️ Open `tools.go` → point at `toolDefs` (the schema) and `dispatchTool` (the impl). Open `main.go` → point at the `for turn < cfg.MaxTurns` loop. *(Just show; don't scroll-spelunk.)*
🟢 George: "Add analytics — 'what's the average NPS for the Customer NPS form?' — agent picks the tool, runs it, streams a one-paragraph summary."

---

## 3. Light spec (0:10–0:13)

🗣️ You (≤3 sentences): "A new `analyze_responses` tool the agent calls to compute summary stats over a form's responses. User wants quick insight without writing SQL. Success: they ask → agent picks it → runs over the store → streams a summary. Out of scope today: real API, retries, auth. Sound right?"
⌨️ *(Optional, ~20s)* new file `SPEC.md`, type those 4 lines. Skip if it slows you.
🟢 George: "Go for it — talk us through it."  → ⏱️ ~57 min for coding.

---

## 4. CODING — build `analyze_responses` (0:13–1:10) ★ the assessed core

### Step 1 — schema (Prompt 1)
⌨️ In Claude Code (pane 1), type:
> "In tools.go, add a fourth entry to the `toolDefs` slice for a tool `analyze_responses`, following the exact shape of the `get_responses` entry. Description: it computes summary statistics over a form's responses — a total count and a distribution of answers — used when the user asks for analytics, an average, a breakdown, or a summary (not the raw list). One required string param `form_id`. Only edit `toolDefs`."
🗣️ While it runs: "I'm naming it `analyze_responses`, not `summarize` — the name carries semantic load so the model tells it apart from `get_responses`. And I'm adding only the schema first."
⌨️ Claude shows the diff → **READ IT ALOUD** → **accept**. ✅ one new map entry, `form_id` required.

### Step 2 — implementation (Prompt 2)
⌨️ Type:
> "Now add a `case \"analyze_responses\":` to the `dispatchTool` switch, reusing the same arg-parsing and `store.responses` access as `get_responses`. Compute a small stats struct — total count and a map of answer→count — and return it as JSON. ~10–15 lines. Don't touch the other cases."
🗣️ While it runs: "Returning a struct, not a finished sentence — the model owns the wording, that separates the *what* from the *how*. And note the canned answers are qualitative — 'Strongly agree', 'Neutral' — so a literal average has no number; a count + distribution is the honest computation. If you want a numeric average I'd add a numeric `rating` to the mock."
⌨️ Read diff aloud → **accept**. ✅ error path on empty `form_id`; mutex used; struct marshalled.

### Step 3 — build, restart, curl
⌨️ Pane 2: Ctrl-C the server → `make run` (↑+Enter). ✅ `listening on :8080`.
⌨️ Pane 3: paste the **create** curl, then the **analytics** curl (above).
🗣️ "Two things I'm checking: that it *routes* to `analyze_responses` not `get_responses`, and that it streams a readable summary off the struct."
✅ `event: tool_result` with `"name":"analyze_responses"`, then streamed text.

### Inline interjections (answer, then keep coding)
🟢 George (~min 20): "Why did you go with [that name / struct] there?"
🗣️ One sentence: "`analyze_responses` over `summarize` — the model needs to know it computes stats, not paraphrases." *or* "Struct over string so the model decides phrasing."

🟢 George (~min 40): "What if the form doesn't exist, or they ask for a stat you don't compute?"
🗣️ "Two modes. No form → structured `form not found` error, model surfaces it — that's the `executeTool` validation pattern. Uncomputed stat → the eval suite catches it; for now I'd add the unknown-form case to the test and note the gap."

🔵 Ethan (~min 55, his one question): "How would you know this is working in production?"
🗣️ The 3-layer answer — per-tool telemetry (OTel→Langfuse spans), two metrics (tool-selection accuracy via evals, turns-to-completion), scoring + 1% sampling. "The metric tells me there's a problem; the sample tells me what kind." *(full text: Chapter Seven / delivery-notes.)*

### 🔁 Recovery branches (if it goes sideways — narrate, don't panic)
- **Model called `get_responses` instead** → ⌨️ Prompt 4: "The model is calling get_responses for analytics questions. Tighten the two tool descriptions so they're mutually exclusive — get_responses returns the raw list, analyze_responses computes aggregate stats. No logic changes." 🗣️ "Fixing routing at the description, not the system prompt — that's where the model reads intent." Restart → curl again.
- **Curl errors / no tool_result** → 🗣️ read the server log aloud, fix the obvious thing. If you went **live** and the network's flaky: ⌨️ `unset TYPEFORM_TOKEN` → restart → instantly back on the deterministic mock. Say: "Mock fallback behind the interface — same tools, no network."
- **Claude over-edits (touches other files)** → ⌨️ **reject** the diff (Esc/No), 🗣️ "too broad, let me scope it," re-prompt with "only edit X."

### Keyboard hygiene (repeat all phase)
Small prompts · read every diff aloud before accepting · never auto-accept · `curl` after each change · never go silent >10s.

---

## 5. Trade-off Q&A (1:10–1:25) — dialogue *(full answers: coach-dialogue.md Phase 5)*

🟢 "Another day or two — what first?" → 🗣️ ranked 3: surface the observability you already emit (dashboards/alerts on the two metrics) → grow the **Go eval harness** on entity resolution → event-driven decoupling for long-running tools. *(Don't say "I haven't built observability/evals" — you have.)*
🟢 curveballs → discoverability (suggestion chips off the `/tools` catalog) · end-to-end testing (unit + SSE contract test + eval suite) · prompt iteration (hardcoded today → Langfuse managed, cache+fallback, trades PR review). · SSE-vs-WS · why Go.

---

## 6. Your questions (1:25–1:30)
🗣️ Ethan (technical): is the agent loop event-driven internally, or sync with streaming on the edge?
🗣️ George (lead): where's the boundary between agent behaviour and the UX layer — where does prompt-eng end and product design start?
Backup: "Hardest problem the team hasn't cracked yet?"

## 7. Close (1:30)
🗣️ Thank them **by name**, smile, "have a good weekend." Disconnect.

---

## Self-grade (5/6 = ready)
☐ narrated continuously ☐ read every diff aloud before accepting ☐ shipped a working slice (curl returns sensible answer) ☐ named ≥2 deliberate trade-offs ☐ crisp improve-next list ☐ no `.sdd-scratch/` / `.claude/` / lead-gen / tests on screen
