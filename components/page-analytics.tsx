"use client";

import { usePageAnalytics } from "@/lib/analytics/use-page-analytics";

export function PageAnalytics({ lessonSlug }: { lessonSlug: string }) {
  usePageAnalytics(lessonSlug);
  return null;
}
