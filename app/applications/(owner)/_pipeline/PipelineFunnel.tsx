"use client";

import { Flex, Text, Badge } from "@radix-ui/themes";
import type { ApplicationStatus, AppData } from "@/components/app-detail/types";
import { COLUMNS } from "@/components/app-detail/constants";
import styles from "./pipeline.module.css";

export function PipelineFunnel({ apps }: { apps: AppData[] }) {
  const counts = Object.fromEntries(
    COLUMNS.map((c) => [c.status, 0])
  ) as Record<ApplicationStatus, number>;
  for (const app of apps) {
    if (counts[app.status] !== undefined) counts[app.status]++;
  }

  return (
    <Flex gap="2" mb="5" wrap="wrap">
      {COLUMNS.map((col, i) => (
        <Flex key={col.status} align="center" gap="2">
          <Flex
            align="center"
            gap="2"
            px="3"
            py="2"
            className={styles.chip}
            style={
              {
                "--chip-bg":
                  counts[col.status] > 0
                    ? `var(--${col.color}-3)`
                    : "var(--gray-2)",
                "--chip-border": `var(--${col.color}-6)`,
                "--chip-op": counts[col.status] > 0 ? 1 : 0.5,
              } as React.CSSProperties
            }
          >
            <Text
              size="2"
              weight="medium"
              color={counts[col.status] > 0 ? col.color : "gray"}
            >
              {col.label}
            </Text>
            <Badge
              color={counts[col.status] > 0 ? col.color : "gray"}
              variant="solid"
              size="1"
              radius="full"
            >
              {counts[col.status]}
            </Badge>
          </Flex>
          {i < COLUMNS.length - 1 && (
            <Text size="1" color="gray" className={styles.sep}>
              &rsaquo;
            </Text>
          )}
        </Flex>
      ))}
    </Flex>
  );
}
