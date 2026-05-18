"use client";

import { Suspense, useState, useEffect, useCallback } from "react";
import {
  Heading,
  Button,
  Flex,
  Text,
  Box,
  Card,
  Skeleton,
  Tabs,
  TextArea,
} from "@radix-ui/themes";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useSession } from "@/lib/auth-client";
import { isOwner } from "@/lib/owner";
import { ApplicationHeader } from "@/components/app-detail/ApplicationHeader";
import type { AppData } from "@/components/app-detail/types";
import { Section } from "@/components/ui";
import styles from "./page.module.css";

function InterviewersPageInner() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { data: session } = useSession();

  const [app, setApp] = useState<AppData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  const isAdmin = isOwner(session);

  useEffect(() => {
    if (params.id) {
      fetch(`/api/applications/${params.id}`)
        .then((r) => {
          if (r.status === 401) {
            router.push("/login");
            return null;
          }
          if (!r.ok) throw new Error("Not found");
          return r.json();
        })
        .then((data) => data && setApp(data))
        .catch((e) => setError(e.message))
        .finally(() => setLoading(false));
    }
  }, [params.id, router]);

  const handleTabChange = useCallback(
    (tab: string) => {
      if (tab === "interviewers") return;
      if (tab === "prep") {
        router.push(`/applications/${params.id}/prep`);
        return;
      }
      if (tab === "notes") {
        router.push(`/applications/${params.id}/notes`);
        return;
      }
      if (tab === "debrief") {
        router.push(`/applications/${params.id}/debrief`);
        return;
      }
      router.push(`/applications/${params.id}?tab=${tab}`);
    },
    [router, params.id],
  );

  const startEditing = () => {
    setDraft(app?.interviewers ?? "");
    setEditing(true);
  };

  const cancelEditing = () => {
    setEditing(false);
    setDraft("");
  };

  const save = async () => {
    if (!app) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/applications/${app.slug}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interviewers: draft }),
      });
      if (!res.ok) throw new Error("Failed to save");
      const updated = await res.json();
      setApp(updated);
      setEditing(false);
    } catch {
      // keep editing open on error
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Section>
        <Skeleton height="32px" mb="6" className={styles.skel} />
        <Skeleton height="400px" />
      </Section>
    );
  }

  if (error) {
    return (
      <Section>
        <Card>
          <Flex direction="column" align="center" gap="4" p="6">
            <Heading size="5">Error Loading Application</Heading>
            <Text color="gray">{error}</Text>
          </Flex>
        </Card>
      </Section>
    );
  }

  if (!app) {
    return (
      <Section>
        <Card>
          <Flex direction="column" align="center" gap="4" p="6">
            <Heading size="5">Application Not Found</Heading>
            <Text color="gray">
              This application doesn&apos;t exist or you don&apos;t have access.
            </Text>
            <Button asChild>
              <Link href="/applications">Back to Applications</Link>
            </Button>
          </Flex>
        </Card>
      </Section>
    );
  }

  return (
    <Section>
      <ApplicationHeader
        app={app}
        isAdmin={isAdmin}
        onUpdate={setApp}
        onSlugChange={(s) => router.replace(`/applications/${s}/interviewers`)}
      />

      <Tabs.Root value="interviewers" onValueChange={handleTabChange}>
        <Tabs.List className={styles.tabsList}>
          <Tabs.Trigger value="description">
            <Flex direction="column" align="center" gap="0">
              <Text>Job Description</Text>
              <span className="tab-shortcut-hint">1</span>
            </Flex>
          </Tabs.Trigger>
          <Tabs.Trigger value="tech">
            <Flex direction="column" align="center" gap="0">
              <Text>Tech Stack</Text>
              <span className="tab-shortcut-hint">2</span>
            </Flex>
          </Tabs.Trigger>
          <Tabs.Trigger value="prep">
            <Flex direction="column" align="center" gap="0">
              <Text>Prep</Text>
              <span className="tab-shortcut-hint">3</span>
            </Flex>
          </Tabs.Trigger>
          <Tabs.Trigger value="interviewers">
            <Flex direction="column" align="center" gap="0">
              <Text>Interviewers</Text>
              <span className="tab-shortcut-hint">4</span>
            </Flex>
          </Tabs.Trigger>
          <Tabs.Trigger value="notes">
            <Flex direction="column" align="center" gap="0">
              <Text>Notes</Text>
              <span className="tab-shortcut-hint">5</span>
            </Flex>
          </Tabs.Trigger>
          <Tabs.Trigger value="debrief">
            <Flex direction="column" align="center" gap="0">
              <Text>Debrief</Text>
              <span className="tab-shortcut-hint">6</span>
            </Flex>
          </Tabs.Trigger>
        </Tabs.List>

        <Box pt="4">
          <Tabs.Content value="interviewers">
            <Card className={styles.panel}>
              <Flex justify="between" align="center" mb="4">
                <Heading size="4">Interviewers</Heading>
                {isAdmin && !editing && (
                  <Button
                    size="1"
                    variant="ghost"
                    color="cyan"
                    onClick={startEditing}
                  >
                    {app.interviewers ? "Edit" : "Add"}
                  </Button>
                )}
              </Flex>

              {editing ? (
                <Box>
                  <Text size="1" color="gray" mb="2" as="p">
                    Use markdown. Example: ## Jane Smith\n**Role:** Engineering
                    Manager\n**LinkedIn:** ...\n**Background:** ...
                  </Text>
                  <TextArea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder={`## Jane Smith\n**Role:** Engineering Manager\n**LinkedIn:** https://linkedin.com/in/...\n**Background:** 10 years at Criteo, leads the AI team...\n\n## John Doe\n**Role:** Senior Developer\n...`}
                    rows={16}
                    className={styles.codeArea}
                  />
                  <Flex gap="2" mt="3" justify="end">
                    <Button
                      size="2"
                      variant="soft"
                      color="gray"
                      onClick={cancelEditing}
                    >
                      Cancel
                    </Button>
                    <Button
                      size="2"
                      variant="solid"
                      color="cyan"
                      onClick={save}
                      disabled={saving}
                    >
                      {saving ? "Saving..." : "Save"}
                    </Button>
                  </Flex>
                </Box>
              ) : app.interviewers ? (
                <Box className="interview-prep-md">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      h1: ({ children }) => (
                        <Heading
                          size="5"
                          mb="2"
                          mt="4"
                          style={{ color: "var(--cyan-11)" }}
                        >
                          {children}
                        </Heading>
                      ),
                      h2: ({ children }) => (
                        <Box
                          mt="5"
                          mb="2"
                          pt="4"
                          style={{
                            borderTop: "1px solid var(--gray-4)",
                          }}
                        >
                          <Heading
                            size="4"
                            style={{ color: "var(--cyan-11)" }}
                          >
                            {children}
                          </Heading>
                        </Box>
                      ),
                      h3: ({ children }) => (
                        <Box
                          mt="4"
                          mb="2"
                          p="3"
                          style={{
                            backgroundColor: "var(--cyan-2)",
                            borderLeft: "3px solid var(--cyan-8)",
                            borderRadius: 0,
                          }}
                        >
                          <Heading size="3">{children}</Heading>
                        </Box>
                      ),
                      p: ({ children }) => (
                        <Text
                          as="p"
                          size="2"
                          mb="2"
                          style={{ lineHeight: 1.7 }}
                        >
                          {children}
                        </Text>
                      ),
                      strong: ({ children }) => (
                        <strong style={{ fontWeight: 600 }}>{children}</strong>
                      ),
                      a: ({ href, children }) => (
                        <a
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: "var(--cyan-11)" }}
                        >
                          {children}
                        </a>
                      ),
                      ul: ({ children }) => (
                        <ul
                          style={{
                            paddingLeft: 20,
                            lineHeight: 1.8,
                            marginBottom: 12,
                          }}
                        >
                          {children}
                        </ul>
                      ),
                      ol: ({ children }) => (
                        <ol
                          style={{
                            paddingLeft: 20,
                            lineHeight: 1.8,
                            marginBottom: 12,
                          }}
                        >
                          {children}
                        </ol>
                      ),
                      li: ({ children }) => (
                        <li
                          style={{
                            lineHeight: 1.7,
                            marginBottom: 4,
                            fontSize: "var(--font-size-2)",
                          }}
                        >
                          {children}
                        </li>
                      ),
                      blockquote: ({ children }) => (
                        <Box
                          mb="3"
                          pl="3"
                          style={{
                            borderLeft: "3px solid var(--gray-6)",
                            color: "var(--gray-11)",
                          }}
                        >
                          {children}
                        </Box>
                      ),
                      hr: () => (
                        <Box
                          mb="4"
                          style={{ borderTop: "1px solid var(--gray-4)" }}
                        />
                      ),
                    }}
                  >
                    {app.interviewers}
                  </ReactMarkdown>
                </Box>
              ) : (
                <Flex
                  direction="column"
                  align="center"
                  justify="center"
                  gap="3"
                  py="8"
                >
                  <Text size="2" color="gray">
                    No interviewer information added yet.
                  </Text>
                  <Text size="1" color="gray">
                    Add details about who will interview you — names, roles,
                    LinkedIn profiles, and background.
                  </Text>
                </Flex>
              )}
            </Card>
          </Tabs.Content>
        </Box>
      </Tabs.Root>
    </Section>
  );
}

export default function InterviewersPage() {
  return (
    <Suspense
      fallback={
        <Section>
          <Skeleton height="32px" mb="6" className={styles.skel} />
          <Skeleton height="400px" />
        </Section>
      }
    >
      <InterviewersPageInner />
    </Suspense>
  );
}
