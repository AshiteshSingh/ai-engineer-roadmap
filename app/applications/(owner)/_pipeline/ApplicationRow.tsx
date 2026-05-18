"use client";

import { Flex, Text, Box, IconButton, DropdownMenu } from "@radix-ui/themes";
import { DotsHorizontalIcon, ArrowRightIcon } from "@radix-ui/react-icons";
import Link from "next/link";
import type { ApplicationStatus, AppData } from "@/components/app-detail/types";
import { COLUMNS, NEXT_STATUS, formatDate } from "@/components/app-detail/constants";
import styles from "./pipeline.module.css";

export function ApplicationRow({
  app,
  index,
  onMove,
  onReject,
}: {
  app: AppData;
  index: number;
  onMove: (id: string, status: ApplicationStatus) => void;
  onReject: (id: string) => void;
}) {
  const displayTitle = app.position;
  const nextStatus = NEXT_STATUS[app.status];
  const nextLabel = COLUMNS.find((c) => c.status === nextStatus)?.label;

  return (
    <Link href={`/applications/${app.slug}`} className={styles.rowLink}>
      <Flex
        align="center"
        gap="3"
        px="4"
        py="3"
        className={`app-row ${styles.row}${index > 0 ? ` ${styles.rowDivided}` : ""}`}
      >
        <Box className={styles.rowMain}>
          <Text size="2" weight="medium" className={styles.ellipsis}>
            {displayTitle}
          </Text>
          <Text size="1" color="gray">
            {app.company} &middot; {formatDate(app.createdAt)}
          </Text>
        </Box>

        <Box onClick={(e) => e.preventDefault()}>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger>
              <IconButton size="1" variant="ghost" color="gray">
                <DotsHorizontalIcon />
              </IconButton>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content size="1">
              {nextStatus && nextLabel && (
                <DropdownMenu.Item onClick={() => onMove(app.slug, nextStatus)}>
                  <ArrowRightIcon />
                  Move to {nextLabel}
                </DropdownMenu.Item>
              )}
              {app.status !== "rejected" && (
                <DropdownMenu.Item color="red" onClick={() => onReject(app.slug)}>
                  Mark Rejected
                </DropdownMenu.Item>
              )}
              {app.status === "rejected" && (
                <DropdownMenu.Item onClick={() => onMove(app.slug, "saved")}>
                  Restore to Saved
                </DropdownMenu.Item>
              )}
            </DropdownMenu.Content>
          </DropdownMenu.Root>
        </Box>
      </Flex>
    </Link>
  );
}
