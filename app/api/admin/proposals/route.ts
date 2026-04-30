import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { serverClient } from "@/sanity/lib/serverClient";

const ALLOWED = ["super-admin", "admin"];

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || !ALLOWED.includes(session.user.role ?? "")) {
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
        "song_id": song._ref,
        "title": song->title,
        "author": song->author,
        "key": song->key
      }
    }
  `);

  return NextResponse.json(proposals);
}
