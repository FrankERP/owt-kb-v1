import { NextRequest, NextResponse } from "next/server";
import { requireActiveSession } from "@/app/utils/authGuards";
import { client } from "@/sanity/lib/client";

// Builds an ad-hoc YouTube playlist URL from a setlist's song videos, so members
// can practice the whole set in one tap. Uses YouTube's no-auth watch_videos URL.
const YT_RE = /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/;

function ytId(url?: string): string | null {
  if (!url) return null;
  const m = url.match(YT_RE);
  return m ? m[1] : null;
}

export async function POST(req: NextRequest) {
  const session = await requireActiveSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { ids } = (await req.json()) as { ids?: string[] };
  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ url: null, count: 0 });
  }

  const songs = await client.fetch<
    { _id: string; referenceLinks?: { url: string }[]; tutorials2?: { url: string }[] }[]
  >(
    `*[_type == "post" && _id in $ids]{ _id, referenceLinks[]{url}, tutorials2[]{url} }`,
    { ids }
  );
  const byId = new Map(songs.map((s) => [s._id, s]));

  // One video per song, in setlist order. Prefer the reference (official) video,
  // fall back to the first tutorial.
  const videoIds: string[] = [];
  for (const id of ids) {
    const s = byId.get(id);
    if (!s) continue;
    const candidates = [...(s.referenceLinks ?? []), ...(s.tutorials2 ?? [])];
    for (const c of candidates) {
      const vid = ytId(c.url);
      if (vid && !videoIds.includes(vid)) { videoIds.push(vid); break; }
    }
  }

  if (videoIds.length === 0) return NextResponse.json({ url: null, count: 0 });
  const url = `https://www.youtube.com/watch_videos?video_ids=${videoIds.slice(0, 50).join(",")}`;
  return NextResponse.json({ url, count: videoIds.length });
}
