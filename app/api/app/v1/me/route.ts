// GET /api/app/v1/me — the native app's proof endpoint (ADR-0091, spec §3.6):
// the signed-in person's OWN record. `role` and `ministries` are reported so
// the app can hide tabs; the server still decides every call.

import { requireAppSession } from "@/app/appAuth/requireAppSession";
import { appUnavailableResponse, jsonNoStore } from "@/app/appAuth/responses";
import { serverClient } from "@/sanity/lib/serverClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface MeRow {
  _id: string;
  member_name: string | null;
  alias: string | null;
  photoUrl: string | null;
}

export async function GET(request: Request): Promise<Response> {
  const auth = await requireAppSession(request, { needs: "self" });
  if (!auth.ok) return auth.response;
  const { sanityId, access, platform } = auth.session;

  let row: MeRow | null;
  try {
    row = await serverClient.fetch<MeRow | null>(
      `*[_type == "teamMembers" && _id == $id][0]{
        _id, member_name, alias,
        "photoUrl": coalesce(profilePhoto.asset->url, googlePhotoUrl)
      }`,
      { id: sanityId },
    );
  } catch {
    return appUnavailableResponse();
  }
  if (!row) return appUnavailableResponse();

  return jsonNoStore({
    id: row._id,
    name: row.member_name ?? null,
    alias: row.alias ?? null,
    photoUrl: row.photoUrl ?? null,
    role: access.role,
    ministries: access.ministries,
    platform,
  });
}
