// GET /api/app/v1/songs/previous-keys?ids=a,b,… — «Tonos anteriores» for songs the native app is
// about to add to a proposal (ADR-0091 W1, spec D3b): `{ [songId]: string[] }`, newest first, the
// same read the web editor's song search uses. At most 50 canonical ids, else 400.

import { requireAppSession } from "@/app/appAuth/requireAppSession";
import { appUnavailableResponse, jsonNoStore } from "@/app/appAuth/responses";
import { previousKeysFor } from "@/app/utils/songPreviousKeys";
import { parsePreviousKeysIds } from "@/app/utils/appProposalEditor";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request): Promise<Response> {
  const auth = await requireAppSession(request, { needs: { ministry: "worship", as: "member" } });
  if (!auth.ok) return auth.response;

  const ids = parsePreviousKeysIds(new URL(request.url).searchParams.get("ids"));
  if (!ids) return jsonNoStore({ error: "invalid_request" }, 400);

  const today = new Date().toLocaleDateString("sv", { timeZone: "America/Mexico_City" });
  let byId: Map<string, string[]>;
  try {
    byId = await previousKeysFor(ids, today);
  } catch {
    return appUnavailableResponse();
  }
  return jsonNoStore(Object.fromEntries(ids.map((id) => [id, byId.get(id) ?? []])));
}
