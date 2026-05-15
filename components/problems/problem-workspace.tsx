"use client";

import { useCallback, useMemo, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { oneDark } from "@codemirror/theme-one-dark";
import { Badge, Button, Callout, Card, Flex, SegmentedControl, Tabs, Text } from "@radix-ui/themes";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { runTests, type Language, type RunResult, type TestCase } from "@/lib/problems/runner";

type Difficulty = "easy" | "medium" | "hard";

export type ProblemWorkspaceProps = {
  slug: string;
  title: string;
  difficulty: Difficulty;
  prompt: string;
  starterJs: string;
  starterTs: string;
  entrypoint: string;
  testCases: TestCase[];
  isAuthenticated: boolean;
};

const DIFFICULTY_COLOR: Record<Difficulty, "green" | "amber" | "red"> = {
  easy: "green",
  medium: "amber",
  hard: "red",
};

export function ProblemWorkspace(props: ProblemWorkspaceProps) {
  const [language, setLanguage] = useState<Language>("ts");
  const [codeJs, setCodeJs] = useState(props.starterJs);
  const [codeTs, setCodeTs] = useState(props.starterTs);
  const [running, setRunning] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [submitMsg, setSubmitMsg] = useState<string | null>(null);

  const code = language === "ts" ? codeTs : codeJs;
  const setCode = language === "ts" ? setCodeTs : setCodeJs;

  const extensions = useMemo(
    () => [javascript({ jsx: false, typescript: language === "ts" })],
    [language],
  );

  const onRun = useCallback(async () => {
    setRunning(true);
    setSubmitMsg(null);
    try {
      const r = await runTests({
        code,
        language,
        entrypoint: props.entrypoint,
        cases: props.testCases,
      });
      setResult(r);
    } finally {
      setRunning(false);
    }
  }, [code, language, props.entrypoint, props.testCases]);

  const onSubmit = useCallback(async () => {
    setSubmitting(true);
    setSubmitMsg(null);
    try {
      const r = await runTests({
        code,
        language,
        entrypoint: props.entrypoint,
        cases: props.testCases,
      });
      setResult(r);

      if (!props.isAuthenticated) {
        setSubmitMsg("Sign in to save your submission.");
        return;
      }

      const res = await fetch(`/api/problems/${props.slug}/submit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          language,
          code,
          status: r.status,
          passedCount: r.passed,
          totalCount: r.total,
          runtimeMs: r.runtimeMs,
          errorMessage: r.errorMessage ?? null,
        }),
      });
      if (res.ok) {
        setSubmitMsg(
          r.status === "passed"
            ? "Accepted — submission saved."
            : "Submission saved.",
        );
      } else {
        setSubmitMsg("Submission ran but could not be saved.");
      }
    } finally {
      setSubmitting(false);
    }
  }, [code, language, props.entrypoint, props.isAuthenticated, props.slug, props.testCases]);

  const onReset = useCallback(() => {
    if (language === "ts") setCodeTs(props.starterTs);
    else setCodeJs(props.starterJs);
    setResult(null);
    setSubmitMsg(null);
  }, [language, props.starterJs, props.starterTs]);

  return (
    <Flex direction={{ initial: "column", md: "row" }} gap="4" align="stretch" style={{ minHeight: "70vh" }}>
      <Card style={{ flex: "1 1 0", minWidth: 0 }}>
        <Flex direction="column" gap="3" p="2">
          <Flex align="center" gap="3" wrap="wrap">
            <Text size="6" weight="bold">{props.title}</Text>
            <Badge color={DIFFICULTY_COLOR[props.difficulty]} variant="soft" size="2">
              {props.difficulty}
            </Badge>
          </Flex>
          <div className="markdown-prose">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{props.prompt}</ReactMarkdown>
          </div>
        </Flex>
      </Card>

      <Card style={{ flex: "1 1 0", minWidth: 0 }}>
        <Flex direction="column" gap="3" p="2" style={{ height: "100%" }}>
          <Flex align="center" justify="between" wrap="wrap" gap="2">
            <SegmentedControl.Root
              value={language}
              onValueChange={(v) => setLanguage(v as Language)}
            >
              <SegmentedControl.Item value="ts">TypeScript</SegmentedControl.Item>
              <SegmentedControl.Item value="js">JavaScript</SegmentedControl.Item>
            </SegmentedControl.Root>
            <Flex gap="2">
              <Button variant="soft" onClick={onReset} disabled={running || submitting}>
                Reset
              </Button>
              <Button variant="soft" onClick={onRun} disabled={running || submitting}>
                {running ? "Running…" : "Run"}
              </Button>
              <Button onClick={onSubmit} disabled={running || submitting}>
                {submitting ? "Submitting…" : "Submit"}
              </Button>
            </Flex>
          </Flex>

          <div style={{ flex: "1 1 0", minHeight: 320, border: "1px solid var(--gray-a5)", borderRadius: 8, overflow: "hidden" }}>
            <CodeMirror
              value={code}
              onChange={setCode}
              extensions={extensions}
              theme={oneDark}
              height="100%"
              minHeight="320px"
              basicSetup={{
                lineNumbers: true,
                foldGutter: true,
                highlightActiveLine: true,
                tabSize: 2,
              }}
            />
          </div>

          {submitMsg && (
            <Callout.Root color={result?.status === "passed" ? "green" : "gray"}>
              <Callout.Text>{submitMsg}</Callout.Text>
            </Callout.Root>
          )}

          <ResultPanel result={result} />
        </Flex>
      </Card>
    </Flex>
  );
}

function ResultPanel({ result }: { result: RunResult | null }) {
  if (!result) {
    return (
      <Text size="2" color="gray">
        Run your code to see test results.
      </Text>
    );
  }

  const tone =
    result.status === "passed" ? "green"
    : result.status === "failed" ? "amber"
    : "red";

  return (
    <Flex direction="column" gap="2">
      <Callout.Root color={tone}>
        <Callout.Text>
          <strong>{result.status.toUpperCase()}</strong> — {result.passed}/{result.total} tests passed
          {Number.isFinite(result.runtimeMs) ? ` · ${result.runtimeMs.toFixed(1)}ms` : null}
          {result.errorMessage ? ` · ${result.errorMessage}` : null}
        </Callout.Text>
      </Callout.Root>

      <Tabs.Root defaultValue="cases">
        <Tabs.List>
          <Tabs.Trigger value="cases">Test cases</Tabs.Trigger>
          <Tabs.Trigger value="logs">Console ({result.logs.length})</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="cases">
          <Flex direction="column" gap="2" pt="2">
            {result.results.length === 0 && (
              <Text size="2" color="gray">No cases ran.</Text>
            )}
            {result.results.map((r) => (
              <Card key={r.name} variant="surface">
                <Flex direction="column" gap="1" p="1">
                  <Flex align="center" gap="2">
                    <Badge color={r.ok ? "green" : "red"} variant="soft">
                      {r.ok ? "PASS" : "FAIL"}
                    </Badge>
                    <Text size="2" weight="medium">{r.name}</Text>
                    <Text size="1" color="gray">{r.runtimeMs.toFixed(2)}ms</Text>
                  </Flex>
                  {!r.ok && (
                    <pre style={{ margin: 0, fontSize: 12, whiteSpace: "pre-wrap" }}>
{`expected: ${safeStringify(r.expected)}
actual:   ${safeStringify(r.actual)}${"error" in r && r.error ? `\nerror:    ${r.error}` : ""}`}
                    </pre>
                  )}
                </Flex>
              </Card>
            ))}
          </Flex>
        </Tabs.Content>
        <Tabs.Content value="logs">
          <pre style={{ fontSize: 12, whiteSpace: "pre-wrap", padding: 8, margin: 0, background: "var(--gray-a2)", borderRadius: 6 }}>
            {result.logs.length === 0 ? "(no console output)" : result.logs.join("\n")}
          </pre>
        </Tabs.Content>
      </Tabs.Root>
    </Flex>
  );
}

function safeStringify(v: unknown) {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
