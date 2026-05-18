import { NextRequest, NextResponse } from "next/server";
import { db } from "@/src/db";
import { chatMessages } from "@/src/db/schema";
import { eq, asc } from "drizzle-orm";
import { searchContent } from "@/lib/actions/search";
import { deepSearch } from "@/lib/actions/deep-search";
import { generateChat } from "@/lib/chat-llm";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const message = body.message;
  const threadId = body.thread_id || crypto.randomUUID();

  if (!message) {
    return NextResponse.json(
      { error: "message is required" },
      { status: 400 },
    );
  }

  const [history, ftsResults, hybridResults] = await Promise.all([
    db
      .select({ role: chatMessages.role, content: chatMessages.content })
      .from(chatMessages)
      .where(eq(chatMessages.threadId, threadId))
      .orderBy(asc(chatMessages.createdAt))
      .limit(50),
    searchContent(message).catch(() => []),
    deepSearch(message).catch(() => []),
  ]);

  const snippets: string[] = [];
  if (ftsResults.length > 0) {
    for (const r of ftsResults.slice(0, 4)) {
      const label = r.lessonTitle && r.lessonTitle !== r.title
        ? `[${r.lessonTitle} > ${r.title}]`
        : `[${r.title}]`;
      snippets.push(`${label}\n${r.snippet}`);
    }
  }
  if (hybridResults.length > 0) {
    for (const r of hybridResults.slice(0, 4)) {
      const isDupe = snippets.some((s) => s.includes(r.title));
      if (!isDupe) {
        snippets.push(
          `[${r.title}] (relevance: ${(r.combinedScore * 100).toFixed(0)}%)`,
        );
      }
    }
  }

  let assistantContent: string;
  try {
    assistantContent = await generateChat({
      message,
      history: history.map((m) => ({ role: m.role, content: m.content })),
      contextSnippets: snippets,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: "chat generation failed",
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 502 },
    );
  }

  await db
    .insert(chatMessages)
    .values([
      { threadId, role: "user", content: message },
      { threadId, role: "assistant", content: assistantContent },
    ]);

  return NextResponse.json({
    response: assistantContent,
    thread_id: threadId,
  });
}
