/**
 * BKT (Bayesian Knowledge Tracing) client — calls the Rust bkt-server.
 *
 * Start the server:
 *   cd crates/ml/bkt && cargo run --bin bkt-server --features server
 *
 * Env vars:
 *   BKT_URL — optional, default "http://localhost:9998"
 */

const DEFAULT_URL = "http://localhost:9998";

function getBaseUrl(): string {
  return process.env.BKT_URL || DEFAULT_URL;
}

export interface KnowledgeState {
  p_mastery: number;
  p_transit: number;
  p_slip: number;
  p_guess: number;
  total_interactions: number;
  correct_interactions: number;
}

export type MasteryLevel =
  | "Novice"
  | "Beginner"
  | "Intermediate"
  | "Proficient"
  | "Expert";

export interface ReviewSchedule {
  concept_id: string;
  next_review_at: string;
  interval_days: number;
  ease_factor: number;
}

export async function updateState(
  state: KnowledgeState,
  isCorrect: boolean,
): Promise<KnowledgeState> {
  const res = await fetch(`${getBaseUrl()}/bkt/update`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ state, is_correct: isCorrect }),
  });
  if (!res.ok) throw new Error(`BKT update error (${res.status})`);
  return res.json();
}

export async function predict(
  state: KnowledgeState,
): Promise<{ p_correct: number; mastery_level: MasteryLevel }> {
  const res = await fetch(`${getBaseUrl()}/bkt/predict`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ state }),
  });
  if (!res.ok) throw new Error(`BKT predict error (${res.status})`);
  return res.json();
}

export async function scheduleReview(
  state: KnowledgeState,
  lastReview: string,
  isCorrect: boolean,
  responseTimeMs: number,
): Promise<ReviewSchedule> {
  const res = await fetch(`${getBaseUrl()}/schedule/update`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      state,
      last_review: lastReview,
      is_correct: isCorrect,
      response_time_ms: responseTimeMs,
    }),
  });
  if (!res.ok) throw new Error(`BKT schedule error (${res.status})`);
  return res.json();
}

export async function getDueReviews(
  schedules: ReviewSchedule[],
  now?: string,
): Promise<ReviewSchedule[]> {
  const res = await fetch(`${getBaseUrl()}/schedule/due`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      schedules,
      now: now || new Date().toISOString(),
    }),
  });
  if (!res.ok) throw new Error(`BKT due reviews error (${res.status})`);
  return res.json();
}

// ── Inline BKT (works without the Rust server) ────────────────────────

const DEFAULT_P_TRANSIT = 0.1;
const DEFAULT_P_SLIP = 0.1;
const DEFAULT_P_GUESS = 0.2;

export function computeMasteryLevel(pMastery: number): string {
  if (pMastery >= 0.8) return "expert";
  if (pMastery >= 0.6) return "proficient";
  if (pMastery >= 0.4) return "intermediate";
  if (pMastery >= 0.2) return "beginner";
  return "novice";
}

export function updateBktInline(
  currentMastery: number,
  isCorrect: boolean,
  params?: { pTransit?: number; pSlip?: number; pGuess?: number },
): number {
  const pTransit = params?.pTransit ?? DEFAULT_P_TRANSIT;
  const pSlip = params?.pSlip ?? DEFAULT_P_SLIP;
  const pGuess = params?.pGuess ?? DEFAULT_P_GUESS;

  let posterior: number;
  if (isCorrect) {
    const pCorrectMastered = 1 - pSlip;
    const pCorrectUnmastered = pGuess;
    posterior =
      (currentMastery * pCorrectMastered) /
      (currentMastery * pCorrectMastered +
        (1 - currentMastery) * pCorrectUnmastered);
  } else {
    const pIncorrectMastered = pSlip;
    const pIncorrectUnmastered = 1 - pGuess;
    posterior =
      (currentMastery * pIncorrectMastered) /
      (currentMastery * pIncorrectMastered +
        (1 - currentMastery) * pIncorrectUnmastered);
  }

  return posterior + (1 - posterior) * pTransit;
}
