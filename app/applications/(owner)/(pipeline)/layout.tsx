"use client";

import { Flex, Text, Box, Card, Heading, Tabs } from "@radix-ui/themes";
import { useState, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import type { ApplicationStatus, AppData } from "@/components/app-detail/types";
import { COLUMNS } from "@/components/app-detail/constants";
import { Section, Heading as DSHeading } from "@/components/ui";
import { PipelineContext } from "../_pipeline/context";
import { AddApplicationDialog } from "../_pipeline/AddApplicationDialog";
import styles from "../_pipeline/pipeline.module.css";

export default function PipelineLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [apps, setApps] = useState<AppData[]>([]);
  const [loading, setLoading] = useState(true);

  // Single fetch — this client layout persists across sibling tab navigation,
  // so the list is loaded once and shared with every tab via context.
  useEffect(() => {
    fetch("/api/applications")
      .then((r) => r.json())
      .then(setApps)
      .finally(() => setLoading(false));
  }, []);

  const handleMove = async (slug: string, status: ApplicationStatus) => {
    const res = await fetch(`/api/applications/${slug}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (res.ok) {
      const updated = await res.json();
      setApps((prev) => prev.map((a) => (a.slug === slug ? updated : a)));
    }
  };

  const handleReject = (slug: string) => handleMove(slug, "rejected");
  const addApp = (app: AppData) => setApps((prev) => [app, ...prev]);

  const total = apps.length;
  const activeCount = apps.filter((a) => a.status !== "rejected").length;

  // Active tab is the path segment after /applications.
  const current = pathname.split("/")[2] ?? "all";

  const counts = Object.fromEntries(
    COLUMNS.map((c) => [
      c.status,
      apps.filter((a) => a.status === c.status).length,
    ])
  ) as Record<ApplicationStatus, number>;

  return (
    <PipelineContext.Provider
      value={{ apps, loading, handleMove, handleReject, addApp }}
    >
      <Section>
        {/* Header */}
        <Flex justify="between" align="center" mb="4" wrap="wrap" gap="3">
          <Box>
            <Flex align="center" gap="3">
              <Link href="/" className={styles.backLink}>
                &larr; Back
              </Link>
              <DSHeading as="h1" size="xl">
                Application Pipeline
              </DSHeading>
            </Flex>
            {total > 0 && (
              <Text size="2" color="gray">
                {activeCount} active &middot; {total} total
              </Text>
            )}
          </Box>
          <AddApplicationDialog onCreated={addApp} />
        </Flex>

        {/* Empty state — no applications at all */}
        {!loading && total === 0 ? (
          <Card size="3" className={styles.emptyCard}>
            <Flex direction="column" align="center" gap="4" p="6">
              <Heading size="5" color="gray">
                No applications yet
              </Heading>
              <Text color="gray" size="3">
                Click <Text weight="medium">+ Add</Text> to start tracking your
                job application pipeline.
              </Text>
            </Flex>
          </Card>
        ) : (
          <Tabs.Root
            value={current}
            onValueChange={(v) => router.push(`/applications/${v}`)}
          >
            <Tabs.List>
              <Tabs.Trigger value="all">All ({total})</Tabs.Trigger>
              {COLUMNS.map((col) => (
                <Tabs.Trigger key={col.status} value={col.status}>
                  {col.label} ({counts[col.status] ?? 0})
                </Tabs.Trigger>
              ))}
            </Tabs.List>
            <Box pt="4">{children}</Box>
          </Tabs.Root>
        )}
      </Section>
    </PipelineContext.Provider>
  );
}
