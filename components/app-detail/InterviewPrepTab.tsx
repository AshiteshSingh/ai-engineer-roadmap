"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Heading, Flex, Text, Box, Card, Button, Spinner } from "@radix-ui/themes";
import { InfoCircledIcon, RocketIcon } from "@radix-ui/react-icons";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ReactElement } from "react";
import type { TabBaseProps } from "./types";
import { MermaidFlow } from "@/components/mermaid-flow";
import s from "./InterviewPrepTab.module.css";

export function InterviewPrepTab({ app, isAdmin }: TabBaseProps) {
  const [running, setRunning] = useState(false);
  const [deepening, setDeepening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prepContent, setPrepContent] = useState(app.interviewQuestions ?? null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const deepPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(
    () => () => {
      if (deepPollRef.current) clearInterval(deepPollRef.current);
    },
    [],
  );

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => () => stopPolling(), [stopPolling]);

  useEffect(() => {
    if (app.interviewQuestions) {
      setPrepContent(app.interviewQuestions);
      setRunning(false);
      stopPolling();
    }
  }, [app.interviewQuestions, stopPolling]);

  const startPipeline = async () => {
    // The runtime prep route + knowledge-server were removed. Prep is now
    // generated offline by the Rust pipeline (writes the Neon row):
    //   pnpm prep:loop -- --slug <slug>     (or prep:rust / prep:owner:rust)
    setRunning(false);
    stopPolling();
    setError(
      `Interview prep is generated offline now — run \`pnpm prep:loop -- --slug ${app.slug}\` (writes to Neon), then refresh.`,
    );
  };

  // Live "deepen" path: expands the existing prep + tech via the Cloudflare
  // Python worker (DEEPEN_WORKER_URL), then reloads. Mirrors the prep page.
  const startDeepen = async () => {
    setDeepening(true);
    setError(null);
    let before: string | null = null;
    try {
      const pre = await fetch(`/api/applications/${app.slug}/deepen`);
      if (pre.ok)
        before = ((await pre.json()) as { updatedAt: string | null }).updatedAt;
    } catch {
      /* poll baseline is best-effort */
    }
    try {
      const res = await fetch(`/api/applications/${app.slug}/deepen`, {
        method: "POST",
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Deepen failed");
      window.location.reload();
    } catch (e) {
      deepPollRef.current = setInterval(async () => {
        try {
          const poll = await fetch(`/api/applications/${app.slug}/deepen`);
          if (!poll.ok) return;
          const pd = (await poll.json()) as { updatedAt: string | null };
          if (pd.updatedAt && pd.updatedAt !== before) {
            if (deepPollRef.current) clearInterval(deepPollRef.current);
            window.location.reload();
          }
        } catch {
          /* keep polling */
        }
      }, 4_000);
      setError(e instanceof Error ? e.message : "Deepen failed");
    }
  };

  if (!prepContent) {
    return (
      <Card className={s.card}>
        <Flex direction="column" align="center" justify="center" gap="3" py="8">
          {running ? (
            <>
              <Spinner size="3" />
              <Text size="2" color="gray">
                Generating interview prep + tech knowledge...
              </Text>
              <Text size="1" color="gray">
                This takes 1-2 minutes (parsing JD, generating questions, creating study material)
              </Text>
            </>
          ) : (
            <>
              <InfoCircledIcon width={24} height={24} color="var(--gray-8)" />
              <Text size="2" color="gray">No interview prep generated yet.</Text>
              {isAdmin && app.jobDescription && (
                <Flex gap="2">
                  <Button
                    size="2"
                    variant="solid"
                    color="violet"
                    onClick={startPipeline}
                  >
                    <RocketIcon />
                    Generate Prep
                  </Button>
                  <Button
                    size="2"
                    variant="soft"
                    color="cyan"
                    disabled={deepening}
                    onClick={startDeepen}
                  >
                    {deepening ? (
                      <>
                        <Spinner size="1" /> Deepening…
                      </>
                    ) : (
                      "Deepen"
                    )}
                  </Button>
                </Flex>
              )}
              {isAdmin && !app.jobDescription && (
                <Text size="1" color="red">
                  Add a job description first (paste manually on the Description tab)
                </Text>
              )}
              {error && <Text size="1" color="red">{error}</Text>}
            </>
          )}
        </Flex>
      </Card>
    );
  }

  return (
    <Card className={s.card}>
      <Flex justify="between" align="center" mb="4">
        <Heading size="4">Interview Prep</Heading>
        {isAdmin && (
          <Flex gap="2" align="center">
            <Button
              size="1"
              variant="ghost"
              color="violet"
              disabled={running}
              onClick={startPipeline}
            >
              {running ? <><Spinner size="1" /> Regenerating...</> : "Regenerate"}
            </Button>
            <Button
              size="1"
              variant="ghost"
              color="cyan"
              disabled={deepening}
              onClick={startDeepen}
            >
              {deepening ? <><Spinner size="1" /> Deepening…</> : "Deepen"}
            </Button>
          </Flex>
        )}
      </Flex>
      <Box className="interview-prep-md">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            h1: ({ children }) => (
              <Heading size="5" mb="2" mt="4" className={s.mdH1}>{children}</Heading>
            ),
            h2: ({ children }) => (
              <Box mt="5" mb="2" pt="4" className={s.mdH2}>
                <Heading size="4" className={s.mdH2Title}>{children}</Heading>
              </Box>
            ),
            h3: ({ children }) => (
              <Box mt="4" mb="2" p="3" className={s.mdH3}>
                <Heading size="3">{children}</Heading>
              </Box>
            ),
            p: ({ children }) => (
              <Text as="p" size="2" mb="2" className={s.mdParagraph}>{children}</Text>
            ),
            strong: ({ children }) => (
              <strong className={s.mdStrong}>{children}</strong>
            ),
            em: ({ children }) => <em>{children}</em>,
            a: ({ href, children }) => {
              const external = href?.startsWith("http");
              return (
                <a
                  href={href}
                  style={{ color: "var(--violet-11)", textDecoration: "underline" }}
                  {...(external
                    ? { target: "_blank", rel: "noopener noreferrer" }
                    : {})}
                >
                  {children}
                </a>
              );
            },
            ul: ({ children }) => (
              <ul className={s.mdList}>{children}</ul>
            ),
            ol: ({ children }) => (
              <ol className={s.mdList}>{children}</ol>
            ),
            li: ({ children }) => (
              <li className={s.mdListItem}>{children}</li>
            ),
            blockquote: ({ children }) => (
              <Box mb="3" pl="3" className={s.mdQuote}>
                {children}
              </Box>
            ),
            pre: ({ children }: { children?: React.ReactNode }) => {
              const codeEl = children as ReactElement<{ className?: string; children?: string }>;
              if (codeEl?.props) {
                const m = codeEl.props.className?.match(/language-(\w+)/);
                if (m?.[1] === "mermaid") {
                  const raw = String(codeEl.props.children || "").replace(/\n$/, "");
                  return <MermaidFlow chart={raw} />;
                }
              }
              return <pre>{children}</pre>;
            },
            code: ({ children, className }) => {
              const isBlock = className?.includes("language-");
              return isBlock ? (
                <Box mb="3" p="3" className={s.mdCodeBlock}>
                  <pre className={s.mdCodeBlockPre}>
                    <code>{children}</code>
                  </pre>
                </Box>
              ) : (
                <code className={s.mdCodeInline}>
                  {children}
                </code>
              );
            },
            hr: () => <Box mb="4" className={s.mdHr} />,
          }}
        >
          {prepContent}
        </ReactMarkdown>
      </Box>
    </Card>
  );
}
