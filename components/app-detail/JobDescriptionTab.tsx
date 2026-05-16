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
import s from "./JobDescriptionTab.module.css";

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
          <Box className={`deep-dive-content ${s.jdBody}`}>
            <pre className={s.jdPre}>
              {app.jobDescription}
            </pre>
          </Box>
        ) : (
          <Flex direction="column" align="center" justify="center" gap="2" py="6" className={s.empty}>
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
                  <Heading size="5" mb="2" mt="4" className={s.mdH1}>{children}</Heading>
                ),
                h2: ({ children }) => (
                  <Box mt="5" mb="2" pt="4">
                    <Heading size="4" className={s.mdH2Title}>{children}</Heading>
                  </Box>
                ),
                h3: ({ children }) => (
                  <Box mt="4" mb="2" p="3">
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
