"use client";

import { Flex, Text, Box, Skeleton } from "@radix-ui/themes";
import type { ApplicationStatus } from "@/components/app-detail/types";
import { usePipeline } from "./context";
import { ApplicationRow } from "./ApplicationRow";
import styles from "./pipeline.module.css";

export function StatusList({ status }: { status: ApplicationStatus | "all" }) {
  const { apps, loading, handleMove, handleReject } = usePipeline();

  if (loading) {
    return (
      <Flex direction="column" gap="3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} height="52px" />
        ))}
      </Flex>
    );
  }

  const list = status === "all" ? apps : apps.filter((a) => a.status === status);

  if (list.length === 0) {
    return (
      <Flex
        align="center"
        justify="center"
        py="6"
        className={styles.emptySlot}
      >
        <Text size="1" color="gray">
          Nothing here yet
        </Text>
      </Flex>
    );
  }

  return (
    <Box className={styles.list}>
      {list.map((app, i) => (
        <ApplicationRow
          key={app.id}
          app={app}
          index={i}
          onMove={handleMove}
          onReject={handleReject}
        />
      ))}
    </Box>
  );
}
