/**
 * RAG chat completion — a 1:1 TypeScript port of the Rust knowledge-server
 * `chat` path (`crates/ml/src/server/mod.rs` `SYSTEM_PROMPT` +
 * `build_chat_messages`, `src/server/llm.rs` `complete`). The Next route does
 * all retrieval/snippet assembly itself, so this just builds the prompt and
 * calls DeepSeek directly — no long-running knowledge-server.
 *
 * Requires `DEEPSEEK_API_KEY` in the Next runtime env (Vercel Production +
 * `.env.local` for `next dev`).
 */

import { createDeepSeekClient, type ChatMessage } from "@ai-apps/deepseek";

/** Verbatim port of `crates/ml/src/server/mod.rs::SYSTEM_PROMPT` — keep in sync. */
export const SYSTEM_PROMPT =
  "You are an AI engineering tutor for a knowledge base covering transformers, RAG, agents, fine-tuning, evaluations, infrastructure, safety, and multimodal AI. Answer questions concisely and accurately. Cite specific architectures or lesson topics when relevant. When context excerpts are provided, base your answer on them and cite the lesson title. If a question is outside AI/ML engineering, politely redirect the conversation back to the subject matter.";

export interface ChatHistoryMsg {
  role: string;
  content: string;
}

/**
 * Mirrors Rust `build_chat_messages` exactly: system (+ snippets joined by
 * `\n\n---\n\n`) → history (skipping empty role/content) → user message.
 */
export function buildChatMessages(input: {
  message: string;
  history: ChatHistoryMsg[];
  contextSnippets: string[];
}): ChatMessage[] {
  const system =
    input.contextSnippets.length === 0
      ? SYSTEM_PROMPT
      : `${SYSTEM_PROMPT}\n\nRelevant knowledge base excerpts:\n${input.contextSnippets.join(
          "\n\n---\n\n",
        )}`;

  const messages: ChatMessage[] = [{ role: "system", content: system }];
  for (const m of input.history) {
    if (!m.role || !m.content) continue;
    messages.push({ role: m.role as ChatMessage["role"], content: m.content });
  }
  messages.push({ role: "user", content: input.message });
  return messages;
}

/**
 * Replaces the knowledge-server `chat` graph: prompt build + one DeepSeek
 * completion (`deepseek-chat`, temperature 0.2, non-stream, no tools/thinking
 * — matches `llm::complete`). Blank message → "" (Rust parity).
 */
export async function generateChat(input: {
  message: string;
  history: ChatHistoryMsg[];
  contextSnippets: string[];
}): Promise<string> {
  if (!input.message.trim()) return "";
  const client = createDeepSeekClient({
    apiKey: process.env.DEEPSEEK_API_KEY,
  });
  const resp = await client.chat({
    model: "deepseek-chat",
    temperature: 0.2,
    stream: false,
    thinking: { type: "disabled" },
    messages: buildChatMessages(input),
  });
  return resp.choices[0]?.message?.content ?? "";
}
