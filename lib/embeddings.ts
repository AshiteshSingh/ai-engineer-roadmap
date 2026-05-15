/**
 * Local embedding client — calls the Rust embed-server (candle + Metal).
 *
 * Start the server:
 *   cd crates/candle && cargo run --bin embed-server --features server
 *
 * Env vars:
 *   EMBED_URL — optional, default "http://localhost:9999"
 */

const DEFAULT_URL = "http://localhost:9999";

interface EmbedResponse {
  data: { embedding: number[]; index: number }[];
}

function getBaseUrl(): string {
  return process.env.EMBED_URL || DEFAULT_URL;
}

export async function embed(text: string): Promise<number[]> {
  const res = await fetch(`${getBaseUrl()}/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input: text }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Embed server error (${res.status}): ${err}`);
  }

  const json: EmbedResponse = await res.json();
  return json.data[0].embedding;
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  const res = await fetch(`${getBaseUrl()}/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input: texts }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Embed server error (${res.status}): ${err}`);
  }

  const json: EmbedResponse = await res.json();
  return json.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
}
