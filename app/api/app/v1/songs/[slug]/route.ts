// GET /api/app/v1/songs/[slug] — one song for the native app (ADR-0091): the catalogue row plus
// its lyric, its chord charts, its links and its rehearsal mixes, for a worship member. 404 for a slug with no song.

import { requireAppSession } from "@/app/appAuth/requireAppSession";
import { appUnavailableResponse, jsonNoStore } from "@/app/appAuth/responses";
import { operationalClient } from "@/sanity/lib/operationalClient";
import { APP_SONG_QUERY, buildAppSong, type AppSongDetailRow } from "@/app/utils/appSongs";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }): Promise<Response> {
  const auth = await requireAppSession(request, { needs: { ministry: "worship", as: "member" } });
  if (!auth.ok) return auth.response;

  const { slug } = await params;
  let row: AppSongDetailRow | null;
  try {
    // The slug is a GROQ parameter, never part of the query text. `me` is the token's member id:
    // it reads only that member's instruments, to choose the mix offered first.
    row = await operationalClient.fetch<AppSongDetailRow | null>(APP_SONG_QUERY, { slug, me: auth.session.sanityId });
  } catch {
    return appUnavailableResponse();
  }
  const song = buildAppSong(row);
  return song ? jsonNoStore({ song }) : jsonNoStore({ error: "not_found" }, 404);
}
