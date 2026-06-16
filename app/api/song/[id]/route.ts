import { NextRequest, NextResponse } from "next/server";
import { requireActiveSession } from "@/app/utils/authGuards";
import { serverClient } from "@/sanity/lib/serverClient";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireActiveSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const [song, history] = await Promise.all([
    serverClient.fetch(
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
    ),
    // Last 5 times this song was played (Sun/Sat setlists), with the key it was
    // played in and who led that week (joined from the matching role doc).
    serverClient.fetch(
      `*[_type in ["featuredSongs", "saturdarSongs"] && references($id)] | order(week desc)[0..4] {
        week,
        _type,
        "play_key": songs[song._ref == $id][0].play_key,
        "leaders": *[
          _type == select(^._type == "featuredSongs" => "sunday_role", "saturday_role")
          && week == ^.week
        ][0].Lead[]-> {
          "name": coalesce(alias, member_name),
          "photo": coalesce(profilePhoto.asset->url, googlePhotoUrl)
        },
        "setlist": songs[defined(song)]{
          "id": song->_id,
          "title": song->title,
          "slug": song->slug.current,
          play_key
        }
      }`,
      { id }
    ),
  ]);

  if (!song) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ...song, history });
}
