/**
 * End-to-end integration tests for the deployed LangGraph backend.
 *
 * Default run ("smoke") hits the routing/auth surface only — zero LLM cost.
 * Pass `--live` to additionally exercise the `chat` graph with one real
 * DeepSeek call (~$0.001) to validate the full stack including the LLM.
 *
 *   LANGGRAPH_URL=https://knowledge-langgraph.eeeew.workers.dev \
 *   LANGGRAPH_AUTH_TOKEN=... \
 *   pnpm test:e2e           # smoke only
 *   pnpm test:e2e --live    # + one live chat call
 *
 * Exits 0 on success, 1 on any failure. Lightweight bespoke runner —
 * deliberately no vitest/jest dep so it runs as a thin shell from CI.
 */

const LANGGRAPH_URL =
  process.env.LANGGRAPH_URL || "http://127.0.0.1:7860";
const LANGGRAPH_AUTH_TOKEN = process.env.LANGGRAPH_AUTH_TOKEN;
const LIVE = process.argv.includes("--live");

interface Check {
  name: string;
  run: () => Promise<void>;
}

let passed = 0;
let failed = 0;
const failures: Array<{ name: string; err: string }> = [];

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function assertEq<T>(actual: T, expected: T, msg: string): void {
  if (actual !== expected) {
    throw new Error(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

async function check(name: string, fn: () => Promise<void>): Promise<void> {
  process.stdout.write(`  ${name} ... `);
  try {
    await fn();
    console.log("OK");
    passed++;
  } catch (err) {
    console.log("FAIL");
    failed++;
    failures.push({
      name,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

async function post(
  path: string,
  body: unknown,
  withAuth: boolean,
): Promise<Response> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (withAuth && LANGGRAPH_AUTH_TOKEN) {
    headers.Authorization = `Bearer ${LANGGRAPH_AUTH_TOKEN}`;
  }
  return fetch(`${LANGGRAPH_URL}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
}

const checks: Check[] = [
  {
    name: "GET /health returns 200 {status: ok}",
    run: async () => {
      const res = await fetch(`${LANGGRAPH_URL}/health`, {
        signal: AbortSignal.timeout(10_000),
      });
      assertEq(res.status, 200, "status");
      const body = (await res.json()) as { status?: string };
      assertEq(body.status, "ok", "body.status");
    },
  },
  {
    name: "POST /runs/wait without Authorization → 401",
    run: async () => {
      const res = await post(
        "/runs/wait",
        { assistant_id: "chat", input: { message: "hi" } },
        false,
      );
      assertEq(res.status, 401, "status");
    },
  },
  {
    name: "POST /runs/wait with wrong Authorization → 401",
    run: async () => {
      const res = await fetch(`${LANGGRAPH_URL}/runs/wait`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer wrong-token",
        },
        body: JSON.stringify({ assistant_id: "chat", input: { message: "hi" } }),
        signal: AbortSignal.timeout(10_000),
      });
      assertEq(res.status, 401, "status");
    },
  },
  {
    name: "POST /runs/wait with valid auth + unknown assistant_id → 404",
    run: async () => {
      assert(LANGGRAPH_AUTH_TOKEN, "LANGGRAPH_AUTH_TOKEN env var is required");
      const res = await post(
        "/runs/wait",
        { assistant_id: "does-not-exist", input: {} },
        true,
      );
      assertEq(res.status, 404, "status");
      const body = (await res.json()) as { detail?: string };
      assert(
        body.detail?.startsWith("Unknown assistant_id"),
        `expected detail to start with "Unknown assistant_id", got ${body.detail}`,
      );
    },
  },
  {
    name: "POST /runs/wait with malformed body (missing input) → 422",
    run: async () => {
      const res = await post("/runs/wait", { assistant_id: "chat" }, true);
      assertEq(res.status, 422, "status");
    },
  },
  {
    name: "All 5 graph IDs are registered (each returns non-404 with minimal input)",
    run: async () => {
      // We can't actually run most graphs without cost, but each registered
      // graph ID should NOT return 404. Malformed/empty input will either
      // succeed (pure-Python graphs) or produce a 5xx from the LLM layer —
      // never a 404. Use short timeout: if a graph starts an LLM call we'll
      // abort; we only care about the routing decision.
      const ids = [
        "chat",
        "app_prep",
        "memorize_generate",
        "article_generate",
        "course_review",
      ];
      for (const id of ids) {
        const res = await fetch(`${LANGGRAPH_URL}/runs/wait`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${LANGGRAPH_AUTH_TOKEN ?? ""}`,
          },
          body: JSON.stringify({ assistant_id: id, input: {} }),
          signal: AbortSignal.timeout(2_000),
        }).catch((e: unknown) => {
          // AbortError is fine — means routing reached the LLM call.
          if (e instanceof Error && e.name === "TimeoutError") return null;
          throw e;
        });
        if (res !== null) {
          assert(
            res.status !== 404,
            `graph ${id} returned 404 — not registered`,
          );
        }
      }
    },
  },
];

if (LIVE) {
  checks.push({
    name: "[live] chat graph returns {response: string} from real DeepSeek call",
    run: async () => {
      assert(LANGGRAPH_AUTH_TOKEN, "LANGGRAPH_AUTH_TOKEN env var is required");
      const res = await fetch(`${LANGGRAPH_URL}/runs/wait`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${LANGGRAPH_AUTH_TOKEN}`,
        },
        body: JSON.stringify({
          assistant_id: "chat",
          input: {
            message: "In one sentence: what is a transformer?",
            history: [],
            context_snippets: [],
          },
        }),
        signal: AbortSignal.timeout(60_000),
      });
      assertEq(res.status, 200, "status");
      const body = (await res.json()) as { response?: unknown };
      assert(
        typeof body.response === "string" && body.response.length > 0,
        `expected non-empty string response, got: ${JSON.stringify(body.response)}`,
      );
    },
  });
}

async function main() {
  console.log(`Testing ${LANGGRAPH_URL}${LIVE ? " (with live LLM call)" : ""}`);
  console.log();

  for (const c of checks) {
    await check(c.name, c.run);
  }

  console.log();
  console.log(`${passed} passed, ${failed} failed`);
  if (failures.length > 0) {
    console.log();
    for (const { name, err } of failures) {
      console.log(`  ✘ ${name}`);
      console.log(`    ${err}`);
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
