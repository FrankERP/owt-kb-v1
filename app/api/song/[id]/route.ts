import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { serverClient } from "@/sanity/lib/serverClient";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const song = await serverClient.fetch(
    `*[_type == "post" && _id == $id][0] {
      _id, _createdAt, title, author, key, bpm, timeSig,
      "slug": slug.current,
      body,
      chords[]{ key, content },
      "lyricsURL": lyrics.asset->url,
      audioTracks[] { title, tone, "audioFileURL": audioFile.asset->url },
      chordsPDF[] { title, key, "chordsURL": chordsPDF.asset->url },
    }`,
    { id }
  );

  if (!song) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(song);
}
