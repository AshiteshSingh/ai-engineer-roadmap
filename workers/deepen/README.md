# deepen-prep — Cloudflare Python Worker

Expands ("deepens") an application's interview prep + tech stack via DeepSeek.
Called by the Next route `app/api/applications/[id]/deepen/route.ts` (the
"Deepen" button). This is **separate infra** from the Next app — the app ships
to Vercel, this Worker ships to Cloudflare.

## Contract

`POST /` with JSON:

```json
{ "jobDescription": "…", "interviewQuestions": "…markdown…", "techStack": "…json…" }
```

Returns:

```json
{ "prepMarkdown": "…expanded markdown…", "techStack": [ { "tag": "", "label": "", "category": "", "relevance": "" } ] }
```

If `DEEPEN_SHARED_SECRET` is set, callers must send a matching
`x-deepen-secret` header.

## Local development

```sh
cd workers/deepen
echo 'DEEPSEEK_API_KEY=sk-…' > .dev.vars      # gitignored
# optional: echo 'DEEPEN_SHARED_SECRET=…' >> .dev.vars
npx wrangler dev                               # http://localhost:8787
```

Smoke test:

```sh
curl -X POST http://localhost:8787 \
  -H 'content-type: application/json' \
  -d '{"jobDescription":"Senior React + Go, regulated env","interviewQuestions":"# Prep\n- q1","techStack":"[]"}'
```

> **Verify the Python import surface once.** The exact module names
> (`from workers import Response`, `from js import fetch`) and the
> `fetch(..., method=…, headers=…, body=…)` keyword form depend on the
> installed `wrangler` version and `compatibility_date`. The first
> `wrangler dev` run will surface any mismatch in its error output —
> adjust `src/entry.py` imports accordingly (handler logic is unchanged).

Point the Next app at the local Worker by adding to `.env.local`:

```
DEEPEN_WORKER_URL=http://localhost:8787
# DEEPEN_SHARED_SECRET=…   (only if you set it above; must match)
```

## Deploy (out-of-band — no Cloudflare creds in CI here)

```sh
cd workers/deepen
npx wrangler login
npx wrangler secret put DEEPSEEK_API_KEY        # required
npx wrangler secret put DEEPEN_SHARED_SECRET    # optional, must match Next env
npx wrangler deploy                              # → https://deepen-prep.<acct>.workers.dev
```

Then set `DEEPEN_WORKER_URL` (and `DEEPEN_SHARED_SECRET` if used) in **Vercel
Production** env to the deployed `*.workers.dev` URL.

`DEEPSEEK_API_KEY` lives **only** as a Worker secret here — it is not a Next
env var.
