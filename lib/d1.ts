const CF_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const D1_ID = process.env.CLOUDFLARE_AUDIO_D1_ID;
const D1_TOKEN = process.env.CLOUDFLARE_D1_API_TOKEN;

export function d1Configured(): boolean {
  return Boolean(CF_ACCOUNT_ID && D1_ID && D1_TOKEN);
}

export interface D1Row {
  [key: string]: string | number | null;
}

export interface D1QueryOptions {
  /**
   * When set, the request is stored in the Next Data Cache for this many
   * seconds (and is revalidatable via `tags`) instead of `no-store`. Use ONLY
   * for read-only content safe to share across users/requests — a `no-store`
   * read in the render path forces the whole route to dynamic rendering.
   */
  revalidate?: number;
  /** Cache tags for on-demand `revalidateTag` busting (see /api/revalidate). */
  tags?: string[];
}

export async function d1Query<T = D1Row>(
  sql: string,
  params: (string | number | null)[] = [],
  opts?: D1QueryOptions,
): Promise<T[]> {
  if (!d1Configured()) {
    throw new Error("D1 env vars missing");
  }
  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/d1/database/${D1_ID}/query`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${D1_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ sql, params }),
    // Per-user / mutating callers (email, audio-progress) omit `opts` and stay
    // uncached; shared content readers opt into ISR caching so they don't poison
    // static generation.
    ...(opts?.revalidate !== undefined
      ? { next: { revalidate: opts.revalidate, tags: opts.tags } }
      : { cache: "no-store" as const }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`D1 ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    success: boolean;
    errors?: { message: string }[];
    result?: { results?: T[] }[];
  };
  if (!json.success) {
    throw new Error(`D1 error: ${json.errors?.[0]?.message ?? "unknown"}`);
  }
  return json.result?.[0]?.results ?? [];
}
