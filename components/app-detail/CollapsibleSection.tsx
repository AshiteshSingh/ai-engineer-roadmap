"use client";

import { useState } from "react";
import { Flex, Text, Box } from "@radix-ui/themes";
import { ChevronDownIcon, ChevronRightIcon } from "@radix-ui/react-icons";

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
        style={{ cursor: "pointer", userSelect: "none" }}
      >
        {open ? (
          <ChevronDownIcon width={14} height={14} color="var(--gray-9)" />
        ) : (
          <ChevronRightIcon width={14} height={14} color="var(--gray-9)" />
        )}
        <Text
          size="1"
          color="gray"
          weight="medium"
          style={{ textTransform: "uppercase", letterSpacing: "0.05em" }}
        >
          {title}
        </Text>
      </Flex>
      <Box className={`collapsible-body ${open ? "collapsible-open" : ""}`}>
        <Box className="collapsible-inner">{children}</Box>
      </Box>
    </Box>
  );
}
