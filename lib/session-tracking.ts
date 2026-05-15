/**
 * Session-level cognitive tracking — localStorage only, no database.
 *
 * Tracks pre/post session cognitive state and aggregates learning insights.
 */

export type TimeOfDay = "morning" | "afternoon" | "evening" | "night";
export type PracticeMode = "flashcards" | "fill" | "matcher" | "drill" | "explorer";

export interface PreSessionState {
  focusLevel: number;   // 1-5
  energyLevel: number;  // 1-5
  timeOfDay: TimeOfDay;
}

export interface PostSessionState {
  perceivedDifficulty: number;  // 1-5
  perceivedRetention: number;   // 1-5
}

export interface CognitiveSession {
  id: string;
  startedAt: string;
  endedAt: string | null;
  preSession: PreSessionState | null;
  postSession: PostSessionState | null;
  mode: PracticeMode;
  propertiesReviewed: number;
  correctCount: number;
  totalCount: number;
}

const MAX_SESSIONS = 100;

function storageKey(namespaceKey: string): string {
  return `memorize-sessions-${namespaceKey}`;
}

export function detectTimeOfDay(): TimeOfDay {
  const hour = new Date().getHours();
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  if (hour < 21) return "evening";
  return "night";
}

// ── CRUD ──────────────────────────────────────────────────────────

export function getSessions(namespaceKey: string): CognitiveSession[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(storageKey(namespaceKey));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveSessions(namespaceKey: string, sessions: CognitiveSession[]): void {
  const trimmed = sessions.slice(-MAX_SESSIONS);
  localStorage.setItem(storageKey(namespaceKey), JSON.stringify(trimmed));
}

export function createSession(
  namespaceKey: string,
  mode: PracticeMode,
  preSession: PreSessionState | null,
): CognitiveSession {
  const session: CognitiveSession = {
    id: crypto.randomUUID(),
    startedAt: new Date().toISOString(),
    endedAt: null,
    preSession,
    mode,
    propertiesReviewed: 0,
    correctCount: 0,
    totalCount: 0,
    postSession: null,
  };
  const sessions = getSessions(namespaceKey);
  sessions.push(session);
  saveSessions(namespaceKey, sessions);
  return session;
}

export function endSession(
  namespaceKey: string,
  sessionId: string,
  stats: { propertiesReviewed: number; correctCount: number; totalCount: number },
  postSession: PostSessionState | null,
): CognitiveSession | null {
  const sessions = getSessions(namespaceKey);
  const idx = sessions.findIndex((s) => s.id === sessionId);
  if (idx === -1) return null;

  sessions[idx] = {
    ...sessions[idx],
    endedAt: new Date().toISOString(),
    propertiesReviewed: stats.propertiesReviewed,
    correctCount: stats.correctCount,
    totalCount: stats.totalCount,
    postSession,
  };
  saveSessions(namespaceKey, sessions);
  return sessions[idx];
}

// ── Aggregation ───────────────────────────────────────────────────

export interface LearningInsightsData {
  totalSessions: number;
  currentStreak: number;
  longestStreak: number;
  bestTimeOfDay: TimeOfDay | null;
  accuracyTrend: number[];   // last 10 sessions, 0-1
  studyVelocity: number;     // properties reviewed per week (last 30 days)
  totalPropertiesReviewed: number;
  averageAccuracy: number;
}

export function computeInsights(namespaceKey: string): LearningInsightsData {
  const sessions = getSessions(namespaceKey).filter((s) => s.endedAt !== null);

  const empty: LearningInsightsData = {
    totalSessions: 0,
    currentStreak: 0,
    longestStreak: 0,
    bestTimeOfDay: null,
    accuracyTrend: [],
    studyVelocity: 0,
    totalPropertiesReviewed: 0,
    averageAccuracy: 0,
  };

  if (sessions.length === 0) return empty;

  // Streak calculation (consecutive days with sessions)
  const sessionDates = [...new Set(
    sessions.map((s) => new Date(s.startedAt).toISOString().split("T")[0]),
  )].sort();

  let currentStreak = 1;
  let longestStreak = 1;
  let tempStreak = 1;

  for (let i = sessionDates.length - 1; i > 0; i--) {
    const curr = new Date(sessionDates[i]);
    const prev = new Date(sessionDates[i - 1]);
    const diffDays = (curr.getTime() - prev.getTime()) / 86400000;

    if (diffDays <= 1) {
      tempStreak++;
    } else {
      if (i === sessionDates.length - 1 || tempStreak > 1) {
        longestStreak = Math.max(longestStreak, tempStreak);
      }
      tempStreak = 1;
    }
  }
  longestStreak = Math.max(longestStreak, tempStreak);

  // Current streak: count backward from today
  const today = new Date().toISOString().split("T")[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];
  const lastSessionDate = sessionDates[sessionDates.length - 1];

  if (lastSessionDate === today || lastSessionDate === yesterday) {
    currentStreak = 1;
    for (let i = sessionDates.length - 1; i > 0; i--) {
      const curr = new Date(sessionDates[i]);
      const prev = new Date(sessionDates[i - 1]);
      if ((curr.getTime() - prev.getTime()) / 86400000 <= 1) {
        currentStreak++;
      } else {
        break;
      }
    }
  } else {
    currentStreak = 0;
  }

  // Best time of day (highest average accuracy)
  const timeAccuracy: Record<TimeOfDay, { total: number; correct: number }> = {
    morning: { total: 0, correct: 0 },
    afternoon: { total: 0, correct: 0 },
    evening: { total: 0, correct: 0 },
    night: { total: 0, correct: 0 },
  };

  for (const s of sessions) {
    const tod = s.preSession?.timeOfDay ?? detectTimeFromISO(s.startedAt);
    if (s.totalCount > 0) {
      timeAccuracy[tod].total += s.totalCount;
      timeAccuracy[tod].correct += s.correctCount;
    }
  }

  let bestTimeOfDay: TimeOfDay | null = null;
  let bestAccuracy = 0;
  for (const [tod, stats] of Object.entries(timeAccuracy)) {
    if (stats.total >= 5) {
      const acc = stats.correct / stats.total;
      if (acc > bestAccuracy) {
        bestAccuracy = acc;
        bestTimeOfDay = tod as TimeOfDay;
      }
    }
  }

  // Accuracy trend (last 10 sessions)
  const recentSessions = sessions.slice(-10);
  const accuracyTrend = recentSessions.map((s) =>
    s.totalCount > 0 ? s.correctCount / s.totalCount : 0,
  );

  // Study velocity (properties reviewed per week, last 30 days)
  const thirtyDaysAgo = Date.now() - 30 * 86400 * 1000;
  const recentReviewed = sessions
    .filter((s) => new Date(s.startedAt).getTime() > thirtyDaysAgo)
    .reduce((sum, s) => sum + s.propertiesReviewed, 0);
  const weeksInRange = Math.max(1, (Date.now() - thirtyDaysAgo) / (7 * 86400 * 1000));
  const studyVelocity = recentReviewed / weeksInRange;

  // Totals
  const totalPropertiesReviewed = sessions.reduce((sum, s) => sum + s.propertiesReviewed, 0);
  const totalCorrect = sessions.reduce((sum, s) => sum + s.correctCount, 0);
  const totalAttempts = sessions.reduce((sum, s) => sum + s.totalCount, 0);
  const averageAccuracy = totalAttempts > 0 ? totalCorrect / totalAttempts : 0;

  return {
    totalSessions: sessions.length,
    currentStreak,
    longestStreak,
    bestTimeOfDay,
    accuracyTrend,
    studyVelocity,
    totalPropertiesReviewed,
    averageAccuracy,
  };
}

function detectTimeFromISO(iso: string): TimeOfDay {
  const hour = new Date(iso).getHours();
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  if (hour < 21) return "evening";
  return "night";
}
