"use client";

import { Heading, Card } from "@radix-ui/themes";
import { MarkdownProse } from "@/components/markdown-prose";
import type { TabBaseProps } from "./types";

/**
 * Renders the public committed coding-task spec (app.codingTask, sourced from
 * data/app-prep/<slug>.task.md). Reuses the shared MarkdownProse renderer for
 * consistent prose styling; MarkdownProse strips the leading H1 so the gist's
 * "# Coding Interview" title doesn't duplicate the card heading.
 */
export function CodingTaskTab({ app }: TabBaseProps) {
  if (!app.codingTask) return null;
  return (
    <Card mb="5" id="coding-task">
      <Heading size="4" mb="4">
        Coding task
      </Heading>
      <MarkdownProse content={app.codingTask} />
    </Card>
  );
}
