// GET /api/app/v1/songs/[slug]/mixes/[key] — where one rehearsal mix's audio lives, for a
// worship member of the native app (ADR-0091). The twin of the web's `/api/audio/[songId]/[key]`
// (rehearsal mixes spec §8.1, D2), with one difference of shape: the web answers a 302 the
// browser follows with its cookie; the app's player cannot carry a bearer token through a
// redirect, so this answers `{url}` and the app hands that to the player.
//
// The protection is the same and no stronger: the address is hidden from anyone without a
// worship session and stops being handed out when a member leaves; past this answer the app
// holds the CDN address. It is asked for at play time and never stored in the song payload.

import { requireAppSession } from "@/app/appAuth/requireAppSession";
import { appUnavailableResponse, jsonNoStore } from "@/app/appAuth/responses";
import { operationalClient } from "@/sanity/lib/operationalClient";
import { APP_MIX_AUDIO_QUERY, mixAudioUrl } from "@/app/utils/appSongs";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request, { params }: { params: Promise<{ slug: string; key: string }> }): Promise<Response> {
  const auth = await requireAppSession(request, { needs: { ministry: "worship", as: "member" } });
  if (!auth.ok) return auth.response;

  const { slug, key } = await params;
  let stored: unknown;
  try {
    // Both are GROQ parameters, never part of the query text.
    stored = await operationalClient.fetch<unknown>(APP_MIX_AUDIO_QUERY, { slug, key });
  } catch {
    return appUnavailableResponse();
  }
  const url = mixAudioUrl(stored);
  return url ? jsonNoStore({ url }) : jsonNoStore({ error: "not_found" }, 404);
}
