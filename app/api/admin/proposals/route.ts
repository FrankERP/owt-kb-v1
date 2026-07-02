import { NextResponse } from "next/server";
import { requireActiveManager } from "@/app/utils/authGuards";
import { serverClient } from "@/sanity/lib/serverClient";

export async function GET() {
  const session = await requireActiveManager();
  if (!session) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  // Restricted to admin and super-admin (not content-editor)
  if (session.user.role === "content-editor") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const proposals = await serverClient.fetch(`
    *[_type == "setlistProposal"] | order(service_date asc) {
      _id,
      service_type,
      service_date,
      status,
      lead_notes,
      admin_notes,
      submitted_at,
      reviewed_at,
      "service_ref": service_ref._ref,
      "lead_name": coalesce(lead->alias, lead->member_name),
      "lead_id": lead->_id,
      songs[] {
        _key,
        play_key,
        medley_tag,
        "song_id": song._ref,
        "title": song->title,
        "author": song->author,
        "key": song->key
      }
    }
  `);

  return NextResponse.json(proposals);
}
