/**
 * Local LLM client — calls any OpenAI-compatible endpoint (mlx_lm.server, etc.)
 *
 * Start the server:
 *   mlx_lm.server --model mlx-community/Qwen2.5-7B-Instruct-4bit --port 8080
 *
 * Env vars:
 *   LLM_BASE_URL — default "http://localhost:8080/v1"
 *   LLM_MODEL    — default "mlx-community/Qwen2.5-7B-Instruct-4bit"
 *   LLM_API_KEY  — optional, for remote providers
 */

export interface ChatMessage {
  role: string;
  content: string;
}

export interface LLMConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
  timeoutMs: number;
}

const DEFAULTS: LLMConfig = {
  baseUrl: "http://localhost:8080/v1",
  model: "mlx-community/Qwen2.5-7B-Instruct-4bit",
  apiKey: "",
  timeoutMs: 120_000,
};

export function getConfig(): LLMConfig {
  return {
    baseUrl: process.env.LLM_BASE_URL || DEFAULTS.baseUrl,
    model: process.env.LLM_MODEL || DEFAULTS.model,
    apiKey: process.env.LLM_API_KEY || DEFAULTS.apiKey,
    timeoutMs: Number(process.env.LLM_TIMEOUT_MS) || DEFAULTS.timeoutMs,
  };
}

export function buildHeaders(apiKey: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }
  return headers;
}

export async function chatCompletion(
  messages: ChatMessage[],
  config?: Partial<LLMConfig>,
): Promise<{ content: string; raw: unknown }> {
  const cfg = { ...getConfig(), ...config };
  const url = `${cfg.baseUrl}/chat/completions`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: buildHeaders(cfg.apiKey),
      body: JSON.stringify({ model: cfg.model, messages }),
      signal: AbortSignal.timeout(cfg.timeoutMs),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "TimeoutError") {
      throw new LLMError(408, `Request timed out after ${cfg.timeoutMs}ms`);
    }
    throw new LLMError(
      502,
      `Cannot reach LLM server at ${cfg.baseUrl}: ${err instanceof Error ? err.message : err}`,
    );
  }

  if (!response.ok) {
    const body = await response.text();
    throw new LLMError(response.status, body);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content ?? "";
  return { content, raw: data };
}

export class LLMError extends Error {
  constructor(
    public status: number,
    public details: string,
  ) {
    super(`LLM API error (${status}): ${details}`);
    this.name = "LLMError";
  }
}
