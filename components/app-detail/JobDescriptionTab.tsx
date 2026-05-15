"use client";

import {
  Heading,
  Button,
  Flex,
  Text,
  Box,
  Card,
  TextArea,
} from "@radix-ui/themes";
import { InfoCircledIcon } from "@radix-ui/react-icons";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { AppData, TabBaseProps } from "./types";

interface JobDescriptionTabProps extends TabBaseProps {
  onUpdate: (updated: AppData) => void;
}

export function JobDescriptionTab({
  app,
  isAdmin,
  onUpdate,
}: JobDescriptionTabProps) {
  const [editingJobDescription, setEditingJobDescription] = useState(false);
  const [jobDescriptionValue, setJobDescriptionValue] = useState("");


  const handleSaveJobDescription = async () => {
    const res = await fetch(`/api/applications/${app.slug}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobDescription: jobDescriptionValue }),
    });
    if (res.ok) {
      const updated = await res.json();
      onUpdate(updated);
      setEditingJobDescription(false);
    }
  };

  return (
    <>
      {/* Job description card */}
      <Card mb="5" id="job-description">
        <Flex justify="between" align="center" mb="3">
          <Heading size="4">Job Description</Heading>
          {isAdmin && !editingJobDescription && (
            <Button
              variant="soft"
              size="1"
              onClick={() => {
                setJobDescriptionValue(app.jobDescription ?? "");
                setEditingJobDescription(true);
              }}
            >
              {app.jobDescription ? "Edit" : "Add"}
            </Button>
          )}
        </Flex>
        {editingJobDescription ? (
          <Flex direction="column" gap="2">
            <TextArea
              value={jobDescriptionValue}
              onChange={(e) => setJobDescriptionValue(e.target.value)}
              placeholder="Paste the job description here..."
              rows={12}
            />
            <Flex gap="2" justify="end">
              <Button
                variant="soft"
                color="gray"
                size="1"
                onClick={() => setEditingJobDescription(false)}
              >
                Cancel
              </Button>
              <Button size="1" onClick={handleSaveJobDescription}>
                Save
              </Button>
            </Flex>
          </Flex>
        ) : app.jobDescription ? (
          <Box className="deep-dive-content" style={{ lineHeight: 1.7, fontSize: "var(--font-size-2)" }}>
            <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", margin: 0 }}>
              {app.jobDescription}
            </pre>
          </Box>
        ) : (
          <Flex direction="column" align="center" justify="center" gap="2" py="6" style={{ opacity: 0.7 }}>
            <InfoCircledIcon width={24} height={24} color="var(--gray-8)" />
            <Text size="2" color="gray">No job description yet.</Text>
            {isAdmin && (
              <Button
                variant="soft"
                size="1"
                mt="1"
                onClick={() => {
                  setJobDescriptionValue("");
                  setEditingJobDescription(true);
                }}
              >
                Add
              </Button>
            )}
          </Flex>
        )}
      </Card>

      {/* AI Interview Prep */}
      {app.aiInterviewQuestions && (
        <Card mb="5">
          <Heading size="4" mb="4">Interview Prep</Heading>
          <Box className="interview-prep-md">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                h1: ({ children }) => (
                  <Heading size="5" mb="2" mt="4" style={{ color: "var(--violet-11)" }}>{children}</Heading>
                ),
                h2: ({ children }) => (
                  <Box mt="5" mb="2" pt="4">
                    <Heading size="4" style={{ color: "var(--violet-11)" }}>{children}</Heading>
                  </Box>
                ),
                h3: ({ children }) => (
                  <Box mt="4" mb="2" p="3" style={{ borderRadius: "var(--radius-2)" }}>
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
                  <Box mb="3" pl="3" style={{ color: "var(--gray-11)" }}>
                    {children}
                  </Box>
                ),
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
                hr: () => <Box mb="4" />,
                table: ({ children }) => (
                  <Box mb="3" className="interview-prep-table-wrap">
                    <table className="interview-prep-table">{children}</table>
                  </Box>
                ),
                thead: ({ children }) => <thead>{children}</thead>,
                tbody: ({ children }) => <tbody>{children}</tbody>,
                tr: ({ children }) => <tr>{children}</tr>,
                th: ({ children }) => <th>{children}</th>,
                td: ({ children }) => <td>{children}</td>,
              }}
            >
              {app.aiInterviewQuestions}
            </ReactMarkdown>
          </Box>
        </Card>
      )}
    </>
  );
}
