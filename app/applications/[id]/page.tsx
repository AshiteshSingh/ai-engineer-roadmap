"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { Container, Heading, Button, Flex, Text, Box, Card, Skeleton, Tabs } from "@radix-ui/themes";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useSession } from "@/lib/auth-client";
import { isOwner } from "@/lib/owner";
import { ApplicationHeader } from "@/components/app-detail/ApplicationHeader";
import { JobDescriptionTab } from "@/components/app-detail/JobDescriptionTab";
import { TechStackTab } from "@/components/app-detail/TechStackTab";
import { CompanyTab } from "@/components/app-detail/CompanyTab";
import { InterviewPrepTab } from "@/components/app-detail/InterviewPrepTab";
import { CodingTaskTab } from "@/components/app-detail/CodingTaskTab";
import type { AppData } from "@/components/app-detail/types";
import { Section } from "@/components/ui";
import styles from "./page.module.css";

const TAB_VALUES = ["description", "task", "tech", "company", "prep", "interviewers", "notes", "debrief"] as const;
type TabValue = (typeof TAB_VALUES)[number];

function ApplicationDetailInner() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session } = useSession();

  const [app, setApp] = useState<AppData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [typeformUrl, setTypeformUrl] = useState<string | null>(null);

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

  useEffect(() => {
    if (!isAdmin || !app) return;
    fetch(`/api/applications/${app.id}/typeform-url`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { url: string | null } | null) => setTypeformUrl(d?.url ?? null))
      .catch(() => setTypeformUrl(null));
  }, [isAdmin, app]);

  // Tab state persisted to URL
  const rawTab = searchParams.get("tab") ?? "description";
  const activeTab: TabValue = TAB_VALUES.includes(rawTab as TabValue) ? (rawTab as TabValue) : "description";
  const setActiveTab = useCallback(
    (tab: string) => {
      if (tab === "prep") {
        router.push(`/applications/${params.id}/prep`);
        return;
      }
      if (tab === "interviewers") {
        router.push(`/applications/${params.id}/interviewers`);
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
      const url = new URL(window.location.href);
      url.searchParams.set("tab", tab);
      router.replace(url.pathname + url.search, { scroll: false });
    },
    [router, params.id],
  );

  // Keyboard shortcuts 1-3 to switch tabs
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const idx = Number(e.key) - 1;
      if (idx >= 0 && idx < TAB_VALUES.length) {
        setActiveTab(TAB_VALUES[idx]);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [setActiveTab]);

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
            <Button onClick={() => window.location.reload()}>Retry</Button>
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
            <Text color="gray">This application doesn&apos;t exist or you don&apos;t have access.</Text>
            <Button asChild>
              <Link href="/applications">Back to Applications</Link>
            </Button>
          </Flex>
        </Card>
      </Section>
    );
  }

  return (
    <Container size="4" className="app-detail" style={{ maxWidth: "100%" }} px={{ initial: "3", sm: "5", md: "8" }} py={{ initial: "4", md: "8" }}>
      <ApplicationHeader app={app} isAdmin={isAdmin} onUpdate={setApp} onSlugChange={(s) => router.replace(`/applications/${s}?tab=${activeTab}`)} />

      <Tabs.Root value={activeTab} onValueChange={setActiveTab}>
        <Tabs.List className="app-detail-tabs">
          <Tabs.Trigger value="description">
            <Flex direction="column" align="center" gap="0">
              <Text>Job Description</Text>
              <span className="tab-shortcut-hint">1</span>
            </Flex>
          </Tabs.Trigger>
          {app.codingTask && (
            <Tabs.Trigger value="task">
              <Flex direction="column" align="center" gap="0">
                <Text>Coding task</Text>
              </Flex>
            </Tabs.Trigger>
          )}
          <Tabs.Trigger value="tech">
            <Flex direction="column" align="center" gap="0">
              <Text>Tech Stack</Text>
              <span className="tab-shortcut-hint">2</span>
            </Flex>
          </Tabs.Trigger>
          <Tabs.Trigger value="company">
            <Flex direction="column" align="center" gap="0">
              <Text>Company</Text>
              <span className="tab-shortcut-hint">3</span>
            </Flex>
          </Tabs.Trigger>
          <Tabs.Trigger value="prep">
            <Flex direction="column" align="center" gap="0">
              <Text>Prep</Text>
              <span className="tab-shortcut-hint">4</span>
            </Flex>
          </Tabs.Trigger>
          <Tabs.Trigger value="interviewers">
            <Flex direction="column" align="center" gap="0">
              <Text>Interviewers</Text>
              <span className="tab-shortcut-hint">5</span>
            </Flex>
          </Tabs.Trigger>
          <Tabs.Trigger value="notes">
            <Flex direction="column" align="center" gap="0">
              <Text>Notes</Text>
              <span className="tab-shortcut-hint">6</span>
            </Flex>
          </Tabs.Trigger>
          <Tabs.Trigger value="debrief">
            <Flex direction="column" align="center" gap="0">
              <Text>Debrief</Text>
              <span className="tab-shortcut-hint">7</span>
            </Flex>
          </Tabs.Trigger>
        </Tabs.List>

        <Box pt="4">
          <Tabs.Content value="description">
            <JobDescriptionTab app={app} isAdmin={isAdmin} onUpdate={setApp} />
          </Tabs.Content>
          {app.codingTask && (
            <Tabs.Content value="task">
              <CodingTaskTab app={app} isAdmin={isAdmin} />
            </Tabs.Content>
          )}
          <Tabs.Content value="tech">
            <TechStackTab app={app} isAdmin={isAdmin} />
          </Tabs.Content>
          <Tabs.Content value="company">
            <CompanyTab app={app} isAdmin={isAdmin} />
          </Tabs.Content>
        </Box>
      </Tabs.Root>

      {typeformUrl && (
        <Flex mt="5" justify="end">
          <Button asChild variant="soft">
            <a href={typeformUrl} target="_blank" rel="noopener noreferrer">
              Open feedback form
            </a>
          </Button>
        </Flex>
      )}
    </Container>
  );
}

export default function ApplicationDetailPage() {
  return (
    <Suspense fallback={
      <Section>
        <Skeleton height="32px" mb="6" className={styles.skel} />
        <Skeleton height="400px" />
      </Section>
    }>
      <ApplicationDetailInner />
    </Suspense>
  );
}
