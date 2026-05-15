"use client";

import { Suspense, useState, useEffect, useCallback } from "react";
import { Container, Heading, Button, Flex, Text, Box, Card, Skeleton, Tabs } from "@radix-ui/themes";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useSession } from "@/lib/auth-client";
import { ApplicationHeader } from "@/components/app-detail/ApplicationHeader";
import { DebriefTab } from "@/components/app-detail/DebriefTab";
import type { AppData } from "@/components/app-detail/types";

function DebriefPageInner() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { data: session, isPending } = useSession();

  const [app, setApp] = useState<AppData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isAdmin = true;

  useEffect(() => {
    if (!isPending && !session?.user) {
      router.push("/login");
    }
  }, [isPending, session, router]);

  useEffect(() => {
    if (session?.user && params.id) {
      fetch(`/api/applications/${params.id}`)
        .then((r) => {
          if (!r.ok) throw new Error("Not found");
          return r.json();
        })
        .then(setApp)
        .catch((e) => setError(e.message))
        .finally(() => setLoading(false));
    }
  }, [session, params.id]);

  const handleTabChange = useCallback(
    (tab: string) => {
      if (tab === "debrief") return;
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
      router.push(`/applications/${params.id}?tab=${tab}`);
    },
    [router, params.id],
  );

  if (isPending || !session?.user) return null;

  if (loading) {
    return (
      <Container size="3" p="8">
        <Skeleton height="32px" mb="6" style={{ maxWidth: 200 }} />
        <Skeleton height="400px" />
      </Container>
    );
  }

  if (error) {
    return (
      <Container size="3" p="8">
        <Card>
          <Flex direction="column" align="center" gap="4" p="6">
            <Heading size="5">Error Loading Application</Heading>
            <Text color="gray">{error}</Text>
          </Flex>
        </Card>
      </Container>
    );
  }

  if (!app) {
    return (
      <Container size="3" p="8">
        <Card>
          <Flex direction="column" align="center" gap="4" p="6">
            <Heading size="5">Application Not Found</Heading>
            <Text color="gray">This application doesn&apos;t exist or you don&apos;t have access.</Text>
            <Button asChild>
              <Link href="/applications">Back to Applications</Link>
            </Button>
          </Flex>
        </Card>
      </Container>
    );
  }

  return (
    <Container size="3" p={{ initial: "4", md: "8" }}>
      <ApplicationHeader app={app} isAdmin={isAdmin} onUpdate={setApp} onSlugChange={(s) => router.replace(`/applications/${s}/debrief`)} />

      <Tabs.Root value="debrief" onValueChange={handleTabChange}>
        <Tabs.List style={{ borderBottom: "1px solid var(--gray-6)" }}>
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
          <Tabs.Content value="debrief">
            <DebriefTab app={app} isAdmin={isAdmin} />
          </Tabs.Content>
        </Box>
      </Tabs.Root>
    </Container>
  );
}

export default function DebriefPage() {
  return (
    <Suspense fallback={
      <Container size="3" p="8">
        <Skeleton height="32px" mb="6" style={{ maxWidth: 200 }} />
        <Skeleton height="400px" />
      </Container>
    }>
      <DebriefPageInner />
    </Suspense>
  );
}
