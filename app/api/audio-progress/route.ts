import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { d1Configured, d1Query } from "@/lib/d1";

export const runtime = "nodejs";

interface ProgressRow {
  current_time: number;
  playback_rate: number;
  updated_at: number;
}

async function getSession() {
  return auth.api.getSession({ headers: await headers() });
}

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ progress: null });
  if (!d1Configured()) return NextResponse.json({ progress: null });

  const slug = new URL(req.url).searchParams.get("slug");
  if (!slug) {
    return NextResponse.json({ error: "slug required" }, { status: 400 });
  }

  try {
    const rows = await d1Query<ProgressRow>(
      "SELECT current_time, playback_rate, updated_at FROM audio_progress WHERE user_id = ? AND slug = ? LIMIT 1",
      [session.user.id, slug],
    );
    const row = rows[0];
    if (!row) return NextResponse.json({ progress: null });
    return NextResponse.json({
      progress: {
        currentTime: row.current_time,
        playbackRate: row.playback_rate,
        updatedAt: row.updated_at,
      },
    });
  } catch (err) {
    console.error("audio-progress GET d1 error:", err);
    return NextResponse.json({ progress: null });
  }
}

export async function PUT(req: Request) {
  const session = await getSession();
  if (!session) return new NextResponse(null, { status: 204 });
  if (!d1Configured()) return new NextResponse(null, { status: 204 });

  const body = (await req.json().catch(() => null)) as {
    slug?: string;
    currentTime?: number;
    playbackRate?: number;
    updatedAt?: number;
  } | null;

  if (
    !body ||
    typeof body.slug !== "string" ||
    typeof body.currentTime !== "number" ||
    typeof body.playbackRate !== "number" ||
    typeof body.updatedAt !== "number"
  ) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  try {
    await d1Query(
      `INSERT INTO audio_progress (user_id, slug, current_time, playback_rate, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (user_id, slug) DO UPDATE SET
         current_time  = excluded.current_time,
         playback_rate = excluded.playback_rate,
         updated_at    = excluded.updated_at`,
      [
        session.user.id,
        body.slug,
        body.currentTime,
        body.playbackRate,
        body.updatedAt,
      ],
    );
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    console.error("audio-progress PUT d1 error:", err);
    return new NextResponse(null, { status: 204 });
  }
}
