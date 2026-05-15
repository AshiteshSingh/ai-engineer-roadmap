const CF_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const D1_ID = process.env.CLOUDFLARE_AUDIO_D1_ID;
const D1_TOKEN = process.env.CLOUDFLARE_D1_API_TOKEN;

export function d1Configured(): boolean {
  return Boolean(CF_ACCOUNT_ID && D1_ID && D1_TOKEN);
}

export interface D1Row {
  [key: string]: string | number | null;
}

export async function d1Query<T = D1Row>(
  sql: string,
  params: (string | number | null)[] = [],
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
    cache: "no-store",
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
