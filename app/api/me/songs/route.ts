import { NextRequest, NextResponse } from "next/server";
import { requireMinistryMember } from "@/app/utils/authGuards";
import { serverClient } from "@/sanity/lib/serverClient";
import { previousKeysFor } from "@/app/utils/songPreviousKeys";

interface SongSearchResult {
  _id: string;
  title: string;
  author: string;
  key: string;
  slug: string;
}

export async function GET(req: NextRequest) {
  // The single largest worship read a kids-only member could otherwise make:
  // this returns the ENTIRE song catalog, and no UI change hides a typed URL.
  const worship = await requireMinistryMember("worship");
  if (!worship) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

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
  const previousKeysBySong = await previousKeysFor(songs.map(song => song._id), today);

  return NextResponse.json(songs.map(song => ({
    ...song,
    previous_keys: previousKeysBySong.get(song._id) ?? [],
  })));
}
