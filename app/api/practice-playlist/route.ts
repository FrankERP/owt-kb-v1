import { NextRequest, NextResponse } from "next/server";
import { requireActiveSession } from "@/app/utils/authGuards";
import { client } from "@/sanity/lib/client";
import { pickPracticeVideoUrl } from "@/app/utils/practiceVideo";

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

  const { ids, mode } = (await req.json()) as { ids?: string[]; mode?: "musica" | "letras" };
  const pickMode: "musica" | "letras" = mode === "letras" ? "letras" : "musica";
  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ url: null, count: 0 });
  }

  const songs = await client.fetch<
    { _id: string; musicalReferenceUrl?: string; lyricsVideoUrl?: string; referenceLinks?: { url: string }[]; tutorials2?: { url: string }[] }[]
  >(
    `*[_type == "post" && _id in $ids]{ _id, musicalReferenceUrl, lyricsVideoUrl, referenceLinks[]{url}, tutorials2[]{url} }`,
    { ids }
  );
  const byId = new Map(songs.map((s) => [s._id, s]));

  // One video per song, in setlist order. pickPracticeVideoUrl chooses by mode:
  // "musica" -> musical reference, "letras" -> lyrics video (falling back to the
  // musical reference), each falling back to legacy referenceLinks/tutorials2.
  const videoIds: string[] = [];
  for (const id of ids) {
    const s = byId.get(id);
    if (!s) continue;
    const url = pickPracticeVideoUrl(s, pickMode);
    const vid = ytId(url ?? undefined);
    if (vid && !videoIds.includes(vid)) videoIds.push(vid);
  }

  if (videoIds.length === 0) return NextResponse.json({ url: null, count: 0 });
  const url = `https://www.youtube.com/watch_videos?video_ids=${videoIds.slice(0, 50).join(",")}`;
  return NextResponse.json({ url, count: videoIds.length });
}
