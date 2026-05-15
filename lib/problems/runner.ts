// Browser-side test runner for LeetCode-style problems.
// Uses a sandboxed Web Worker built from a blob URL so it works under Turbopack
// without extra bundler config. TypeScript is transpiled to JS via sucrase
// before being sent to the worker.

import { transform } from "sucrase";

export type TestCase = {
  name: string;
  args: unknown[];
  expected: unknown;
};

export type CaseResult =
  | { name: string; ok: true; actual: unknown; runtimeMs: number }
  | { name: string; ok: false; actual: unknown; expected: unknown; runtimeMs: number; error?: string };

export type RunResult = {
  status: "passed" | "failed" | "error" | "timeout";
  results: CaseResult[];
  passed: number;
  total: number;
  runtimeMs: number;
  errorMessage?: string;
  logs: string[];
};

export type Language = "js" | "ts";

const WORKER_SOURCE = `
self.onmessage = (e) => {
  const { code, entrypoint, cases, perCaseTimeoutMs } = e.data;
  const logs = [];
  const origLog = console.log;
  console.log = (...args) => {
    try {
      logs.push(args.map((a) => {
        try { return typeof a === 'string' ? a : JSON.stringify(a); } catch { return String(a); }
      }).join(' '));
    } catch {}
    if (logs.length > 200) logs.length = 200;
  };

  let fn;
  try {
    // eslint-disable-next-line no-new-func
    fn = new Function(code + '\\n;return typeof ' + entrypoint + " === 'function' ? " + entrypoint + ' : null;')();
  } catch (err) {
    self.postMessage({ kind: 'error', message: 'SyntaxError: ' + (err && err.message ? err.message : String(err)), logs });
    return;
  }
  if (typeof fn !== 'function') {
    self.postMessage({ kind: 'error', message: 'Could not find function "' + entrypoint + '" in your code', logs });
    return;
  }

  const results = [];
  const overallStart = performance.now();
  for (const c of cases) {
    const start = performance.now();
    try {
      // Per-case soft timeout: we can't truly preempt sync code from inside the
      // worker, but the outer page enforces a hard timeout via worker.terminate().
      const actual = fn(...JSON.parse(JSON.stringify(c.args)));
      const runtimeMs = performance.now() - start;
      const ok = deepEqual(actual, c.expected);
      results.push(ok
        ? { name: c.name, ok: true, actual, runtimeMs }
        : { name: c.name, ok: false, actual, expected: c.expected, runtimeMs });
    } catch (err) {
      const runtimeMs = performance.now() - start;
      results.push({
        name: c.name, ok: false, actual: null, expected: c.expected, runtimeMs,
        error: (err && err.message ? err.message : String(err)),
      });
    }
  }

  const totalRuntimeMs = performance.now() - overallStart;
  self.postMessage({ kind: 'done', results, totalRuntimeMs, logs });
};

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  if (typeof a === 'object') {
    const ak = Object.keys(a), bk = Object.keys(b);
    if (ak.length !== bk.length) return false;
    for (const k of ak) if (!deepEqual(a[k], b[k])) return false;
    return true;
  }
  if (typeof a === 'number' && typeof b === 'number') {
    return Number.isNaN(a) && Number.isNaN(b);
  }
  return false;
}
`;

export async function runTests(opts: {
  code: string;
  language: Language;
  entrypoint: string;
  cases: TestCase[];
  hardTimeoutMs?: number;
}): Promise<RunResult> {
  const hardTimeout = opts.hardTimeoutMs ?? 4000;
  let code = opts.code;
  if (opts.language === "ts") {
    try {
      code = transform(code, { transforms: ["typescript"] }).code;
    } catch (err) {
      return {
        status: "error",
        results: [],
        passed: 0,
        total: opts.cases.length,
        runtimeMs: 0,
        errorMessage: `TS transpile failed: ${(err as Error).message}`,
        logs: [],
      };
    }
  }

  const blob = new Blob([WORKER_SOURCE], { type: "application/javascript" });
  const url = URL.createObjectURL(blob);
  const worker = new Worker(url);
  const start = performance.now();

  return new Promise<RunResult>((resolve) => {
    let done = false;
    const finish = (r: RunResult) => {
      if (done) return;
      done = true;
      worker.terminate();
      URL.revokeObjectURL(url);
      resolve(r);
    };

    const timer = setTimeout(() => {
      finish({
        status: "timeout",
        results: [],
        passed: 0,
        total: opts.cases.length,
        runtimeMs: performance.now() - start,
        errorMessage: `Execution timed out after ${hardTimeout}ms`,
        logs: [],
      });
    }, hardTimeout);

    worker.onmessage = (e: MessageEvent) => {
      const msg = e.data as
        | { kind: "error"; message: string; logs: string[] }
        | { kind: "done"; results: CaseResult[]; totalRuntimeMs: number; logs: string[] };
      clearTimeout(timer);
      if (msg.kind === "error") {
        finish({
          status: "error",
          results: [],
          passed: 0,
          total: opts.cases.length,
          runtimeMs: performance.now() - start,
          errorMessage: msg.message,
          logs: msg.logs,
        });
        return;
      }
      const passed = msg.results.filter((r) => r.ok).length;
      finish({
        status: passed === msg.results.length ? "passed" : "failed",
        results: msg.results,
        passed,
        total: msg.results.length,
        runtimeMs: msg.totalRuntimeMs,
        logs: msg.logs,
      });
    };

    worker.onerror = (e) => {
      clearTimeout(timer);
      finish({
        status: "error",
        results: [],
        passed: 0,
        total: opts.cases.length,
        runtimeMs: performance.now() - start,
        errorMessage: e.message || "Worker crashed",
        logs: [],
      });
    };

    worker.postMessage({
      code,
      entrypoint: opts.entrypoint,
      cases: opts.cases,
    });
  });
}
