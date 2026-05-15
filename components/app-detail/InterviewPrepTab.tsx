"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Heading, Flex, Text, Box, Card, Button, Spinner } from "@radix-ui/themes";
import { InfoCircledIcon, RocketIcon } from "@radix-ui/react-icons";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ReactElement } from "react";
import type { TabBaseProps } from "./types";
import { MermaidFlow } from "@/components/mermaid-flow";

const POLL_INTERVAL = 4_000;

export function InterviewPrepTab({ app, isAdmin }: TabBaseProps) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prepContent, setPrepContent] = useState(app.aiInterviewQuestions ?? null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => () => stopPolling(), [stopPolling]);

  useEffect(() => {
    if (app.aiInterviewQuestions) {
      setPrepContent(app.aiInterviewQuestions);
      setRunning(false);
      stopPolling();
    }
  }, [app.aiInterviewQuestions, stopPolling]);

  const startPipeline = async () => {
    setRunning(true);
    setError(null);

    try {
      const res = await fetch(`/api/applications/${app.slug}/prep`, { method: "POST" });
      const data = await res.json() as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to start pipeline");

      pollRef.current = setInterval(async () => {
        try {
          const pollRes = await fetch(`/api/applications/${app.slug}/prep`);
          const pollData = await pollRes.json() as { hasInterview?: boolean };
          if (pollData.hasInterview) {
            stopPolling();
            window.location.reload();
          }
        } catch {}
      }, POLL_INTERVAL);
    } catch (e) {
      setRunning(false);
      setError(e instanceof Error ? e.message : "Failed to start pipeline");
    }
  };

  if (!prepContent) {
    return (
      <Card style={{ borderLeft: "3px solid var(--violet-6)", borderRadius: 0 }}>
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
                <Button
                  size="2"
                  variant="solid"
                  color="violet"
                  onClick={startPipeline}
                >
                  <RocketIcon />
                  Generate Prep
                </Button>
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
    <Card style={{ borderLeft: "3px solid var(--violet-6)", borderRadius: 0 }}>
      <Flex justify="between" align="center" mb="4">
        <Heading size="4">Interview Prep</Heading>
        {isAdmin && (
          <Button
            size="1"
            variant="ghost"
            color="violet"
            disabled={running}
            onClick={startPipeline}
          >
            {running ? <><Spinner size="1" /> Regenerating...</> : "Regenerate"}
          </Button>
        )}
      </Flex>
      <Box className="interview-prep-md">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            h1: ({ children }) => (
              <Heading size="5" mb="2" mt="4" style={{ color: "var(--violet-11)" }}>{children}</Heading>
            ),
            h2: ({ children }) => (
              <Box mt="5" mb="2" pt="4" style={{ borderTop: "1px solid var(--gray-4)" }}>
                <Heading size="4" style={{ color: "var(--violet-11)" }}>{children}</Heading>
              </Box>
            ),
            h3: ({ children }) => (
              <Box mt="4" mb="2" p="3" style={{ borderLeft: "3px solid var(--violet-8)", borderRadius: 0 }}>
                <Heading size="3">{children}</Heading>
              </Box>
            ),
            p: ({ children }) => (
              <Text as="p" size="2" mb="2" style={{ lineHeight: 1.7 }}>{children}</Text>
            ),
            strong: ({ children }) => (
              <strong style={{ fontWeight: 600 }}>{children}</strong>
            ),
            em: ({ children }) => <em>{children}</em>,
            ul: ({ children }) => (
              <ul style={{ paddingLeft: 20, lineHeight: 1.8, marginBottom: 12 }}>{children}</ul>
            ),
            ol: ({ children }) => (
              <ol style={{ paddingLeft: 20, lineHeight: 1.8, marginBottom: 12 }}>{children}</ol>
            ),
            li: ({ children }) => (
              <li style={{ lineHeight: 1.7, marginBottom: 4, fontSize: "var(--font-size-2)" }}>{children}</li>
            ),
            blockquote: ({ children }) => (
              <Box mb="3" pl="3" style={{ borderLeft: "3px solid var(--gray-6)", color: "var(--gray-11)" }}>
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
                <Box mb="3" p="3" style={{ backgroundColor: "var(--gray-2)", borderRadius: "var(--radius-2)", overflowX: "auto" }}>
                  <pre style={{ margin: 0, fontSize: "var(--font-size-1)", fontFamily: "var(--font-mono, monospace)", lineHeight: 1.6 }}>
                    <code>{children}</code>
                  </pre>
                </Box>
              ) : (
                <code style={{ backgroundColor: "var(--gray-3)", padding: "1px 5px", borderRadius: "var(--radius-1)", fontSize: "0.9em", fontFamily: "var(--font-mono, monospace)" }}>
                  {children}
                </code>
              );
            },
            hr: () => <Box mb="4" style={{ borderTop: "1px solid var(--gray-4)" }} />,
          }}
        >
          {prepContent}
        </ReactMarkdown>
      </Box>
    </Card>
  );
}
