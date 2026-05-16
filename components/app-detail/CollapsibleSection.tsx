"use client";

import { useState } from "react";
import { Flex, Text, Box } from "@radix-ui/themes";
import { ChevronDownIcon, ChevronRightIcon } from "@radix-ui/react-icons";
import { cx } from "@/components/ui";
import s from "./CollapsibleSection.module.css";

const COLLAPSIBLE_BODY = "collapsible-body";
const COLLAPSIBLE_OPEN = "collapsible-open";
const COLLAPSIBLE_INNER = "collapsible-inner";

interface CollapsibleSectionProps {
  title: string;
  id: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

export function CollapsibleSection({
  title,
  id,
  defaultOpen = false,
  children,
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Box id={id} mb="4">
      <Flex
        align="center"
        gap="2"
        mb={open ? "3" : "0"}
        onClick={() => setOpen(!open)}
        className={s.toggle}
      >
        {open ? (
          <ChevronDownIcon width={14} height={14} className={s.chevron} />
        ) : (
          <ChevronRightIcon width={14} height={14} className={s.chevron} />
        )}
        <Text size="1" className={s.label}>
          {title}
        </Text>
      </Flex>
      <Box className={cx(COLLAPSIBLE_BODY, open && COLLAPSIBLE_OPEN)}>
        <Box className={COLLAPSIBLE_INNER}>{children}</Box>
      </Box>
    </Box>
  );
}
