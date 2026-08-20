import { NextRequest, NextResponse } from "next/server";
import { requireMinistryMember } from "@/app/utils/authGuards";
import { serverClient } from "@/sanity/lib/serverClient";
import { operationalClient } from "@/sanity/lib/operationalClient";
import { canonicalizePlayHistory, playHistoryTargetKey } from "@/app/utils/serviceReadSelect";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // Worship membership, not just an active session: the song catalog is a
  // worship surface and a kids-only member must not reach it by typed URL.
  const worship = await requireMinistryMember("worship");
  if (!worship) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const today = new Date().toLocaleDateString("sv", { timeZone: "America/Mexico_City" });

  const [song, historyRaw] = await Promise.all([
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
    // Recent times this song was played (Sun/Sat setlists), with the key it was
    // played in and who led that week (joined from the matching role doc). Read
    // through the canonical (published-perspective) client so a `drafts.*`
    // overlay never counts as a play; over-fetch then canonicalize by target so
    // an ambiguous (duplicate-week) setlist contributes no false play history.
    operationalClient.fetch<unknown[]>(
      `*[_type in ["featuredSongs", "saturdarSongs"] && references($id) && week < $today] | order(week desc)[0..19] {
        week,
        _type,
        "play_key": songs[song._ref == $id][0].play_key,
        "leaders": *[
          _type == select(^._type == "featuredSongs" => "sunday_role", "saturday_role")
          && week == ^.week
          && published != false
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
      { id, today }
    ),
  ]);

  if (!song) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const history = canonicalizePlayHistory(historyRaw, playHistoryTargetKey).slice(0, 5);
  return NextResponse.json({ ...song, history });
}
