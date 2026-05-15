import { NextRequest, NextResponse } from "next/server";
import { contentDb } from "@/src/db/content";
import { chatMessages } from "@/src/db/content-schema";
import { eq, asc } from "drizzle-orm";
import { searchContent } from "@/lib/actions/search";
import { deepSearch } from "@/lib/actions/deep-search";
import { chat } from "@/src/lib/langgraph-client";

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
    contentDb
      .select({ role: chatMessages.role, content: chatMessages.content })
      .from(chatMessages)
      .where(eq(chatMessages.threadId, threadId))
      .orderBy(asc(chatMessages.createdAt))
      .limit(50)
      .all(),
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
    const result = await chat({
      message,
      history: history.map((m) => ({ role: m.role, content: m.content })),
      contextSnippets: snippets,
    });
    assistantContent = result.response;
  } catch (err) {
    return NextResponse.json(
      {
        error: "LangGraph chat failed",
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 502 },
    );
  }

  contentDb
    .insert(chatMessages)
    .values([
      { threadId, role: "user", content: message },
      { threadId, role: "assistant", content: assistantContent },
    ])
    .run();

  return NextResponse.json({
    response: assistantContent,
    thread_id: threadId,
  });
}
