// GET /api/app/v1/songs — the native app's Biblioteca (ADR-0091): the whole song catalogue,
// one row per song, for a worship member (`app/utils/appSongs.ts` holds the read and its shape).

import { requireAppSession } from "@/app/appAuth/requireAppSession";
import { appUnavailableResponse, jsonNoStore } from "@/app/appAuth/responses";
import { operationalClient } from "@/sanity/lib/operationalClient";
import { APP_SONGS_QUERY, buildAppSongs, type AppSongRow } from "@/app/utils/appSongs";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request): Promise<Response> {
  const auth = await requireAppSession(request, { needs: { ministry: "worship", as: "member" } });
  if (!auth.ok) return auth.response;

  let rows: AppSongRow[] | null;
  try {
    rows = await operationalClient.fetch<AppSongRow[] | null>(APP_SONGS_QUERY);
  } catch {
    return appUnavailableResponse();
  }
  return jsonNoStore({ songs: buildAppSongs(rows) });
}
