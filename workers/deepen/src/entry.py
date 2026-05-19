# Cloudflare Python Worker — expands ("deepens") interview prep + tech stack.
#
# Contract (matches the rest of the repo's DeepSeek usage — see
# lib/chat-llm.ts / crates/ml/src/server/llm.rs):
#   POST {DEEPSEEK_BASE_URL}/chat/completions, model deepseek-chat,
#   temperature 0.2, stream false, bearer DEEPSEEK_API_KEY,
#   read choices[0].message.content.
#
# Request  (POST JSON): { jobDescription, interviewQuestions, techStack }
# Response (JSON):       { prepMarkdown: str, techStack: list }
#
# Python Workers import surface depends on the wrangler version /
# compatibility_date. If `from workers import Response` / `from js import
# fetch` differ on your runtime, run `wrangler dev` once and adjust per the
# error (see README.md). The handler logic below is the part that matters.

import json

from workers import Response
from js import fetch

SYSTEM_PROMPT = (
    "You expand and deepen interview preparation. You are given a job "
    "description plus the candidate's existing prep markdown and existing "
    "tech-stack JSON. Produce a SIGNIFICANTLY EXPANDED, deeper version: more "
    "probing questions, model answers, system-design trade-offs, likely "
    "follow-ups, and common pitfalls. Preserve anything already correct and "
    "build on it; never shorten. Respond with STRICT JSON ONLY, no prose, no "
    "code fences, exactly this shape:\n"
    '{"prep_markdown": "<full expanded markdown>", '
    '"tech_stack": [{"tag": "", "label": "", "category": "", '
    '"relevance": ""}]}'
)


def _strip_fences(text):
    """Tolerate models that wrap JSON in ```json ... ``` fences."""
    t = text.strip()
    if t.startswith("```"):
        nl = t.find("\n")
        if nl != -1:
            t = t[nl + 1 :]
        if t.endswith("```"):
            t = t[:-3]
    return t.strip()


async def on_fetch(request, env):
    if request.method != "POST":
        return Response("method not allowed", status=405)

    # Optional shared-secret gate (mirrors WORKER_AUTH_SECRET convention).
    expected = getattr(env, "DEEPEN_SHARED_SECRET", None)
    if expected and request.headers.get("x-deepen-secret") != expected:
        return Response("forbidden", status=403)

    try:
        body = json.loads(await request.text())
    except Exception:
        return Response("invalid JSON body", status=400)

    job_description = body.get("jobDescription") or ""
    existing_prep = body.get("interviewQuestions") or ""
    existing_tech = body.get("techStack") or ""

    if not job_description.strip():
        return Response("jobDescription required", status=400)

    user_msg = (
        "# Job Description\n" + job_description + "\n\n"
        "# Existing prep markdown\n" + existing_prep + "\n\n"
        "# Existing tech stack JSON\n" + existing_tech + "\n\n"
        "Expand and deepen substantially. Return strict JSON only."
    )

    payload = json.dumps(
        {
            "model": env.DEEPSEEK_MODEL,
            "temperature": 0.2,
            "stream": False,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_msg},
            ],
        }
    )

    try:
        resp = await fetch(
            env.DEEPSEEK_BASE_URL + "/chat/completions",
            method="POST",
            headers={
                "Authorization": "Bearer " + env.DEEPSEEK_API_KEY,
                "Content-Type": "application/json",
            },
            body=payload,
        )
    except Exception as exc:  # network / binding failure
        return Response("upstream fetch failed: " + str(exc), status=502)

    if not resp.ok:
        detail = await resp.text()
        return Response(
            "deepseek error " + str(resp.status) + ": " + detail[:500],
            status=502,
        )

    data = json.loads(await resp.text())
    try:
        content = data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError):
        return Response("malformed deepseek response", status=502)

    cleaned = _strip_fences(content)
    try:
        parsed = json.loads(cleaned)
        prep_markdown = parsed.get("prep_markdown", "") or ""
        tech_stack = parsed.get("tech_stack", []) or []
    except Exception:
        # Robustness: if the model didn't return valid JSON, treat the whole
        # reply as the expanded markdown and leave tech untouched. The Next
        # route applies the same fallback intent (never persist garbage).
        prep_markdown = content
        tech_stack = []

    return Response(
        json.dumps({"prepMarkdown": prep_markdown, "techStack": tech_stack}),
        headers={"Content-Type": "application/json"},
    )
