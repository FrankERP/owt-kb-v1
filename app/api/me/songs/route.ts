import { NextRequest, NextResponse } from "next/server";
import { requireActiveSession } from "@/app/utils/authGuards";
import { serverClient } from "@/sanity/lib/serverClient";
import { operationalClient } from "@/sanity/lib/operationalClient";
import { buildPreviousKeysBySong, type SongPlayHistorySet } from "@/app/utils/songPlayHistory";
import { canonicalizePlayHistory, playHistoryTargetKey } from "@/app/utils/serviceReadSelect";

interface SongSearchResult {
  _id: string;
  title: string;
  author: string;
  key: string;
  slug: string;
}

export async function GET(req: NextRequest) {
  const session = await requireActiveSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";

  const songs = await serverClient.fetch<SongSearchResult[]>(
    q
      ? `*[_type == "post" && published != false && (title match $pattern || author match $pattern)] | order(title asc) [0..29] {
           _id, title, author, key, "slug": slug.current
         }`
      : `*[_type == "post" && published != false] | order(title asc) [0..49] {
           _id, title, author, key, "slug": slug.current
         }`,
    { pattern: `${q}*` }
  );

  if (songs.length === 0) return NextResponse.json([]);

  const today = new Date().toLocaleDateString("sv", { timeZone: "America/Mexico_City" });
  const songIds = songs.map(song => song._id);
  // Canonical (published-perspective) client: a `drafts.*` overlay never counts
  // as a play. Project the target identity so duplicate-target (ambiguous)
  // setlists are collapsed before keys are tallied — no double-counted history.
  type HistorySet = SongPlayHistorySet & { _id?: string; _type?: string; week?: string };
  const historyRaw = await operationalClient.fetch<HistorySet[]>(
    `*[
      (
        (_type in ["featuredSongs", "saturdarSongs"] && week < $today) ||
        (_type == "special_role" && date < $today && published != false)
      ) && count(songs[song._ref in $songIds]) > 0
    ] | order(coalesce(week, date) desc) {
      _id, _type, "week": coalesce(week, date),
      "songs": songs[song._ref in $songIds] {
        "songId": song._ref,
        play_key
      }
    }`,
    { songIds, today }
  );
  const history = canonicalizePlayHistory(historyRaw, playHistoryTargetKey);
  const previousKeysBySong = buildPreviousKeysBySong(history);

  return NextResponse.json(songs.map(song => ({
    ...song,
    previous_keys: previousKeysBySong.get(song._id) ?? [],
  })));
}
