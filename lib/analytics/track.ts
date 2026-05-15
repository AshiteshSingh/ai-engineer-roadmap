import { trackAnalyticsEvent } from "@/lib/actions/analytics";
import { getSessionId } from "./session";

export async function trackEvent(
  eventName: string,
  lessonSlug: string,
  properties?: Record<string, unknown>,
) {
  try {
    await trackAnalyticsEvent(eventName, lessonSlug, getSessionId(), properties);
  } catch {
    // Silent fail — analytics should never break the app
  }
}
