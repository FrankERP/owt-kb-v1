import { NextResponse } from "next/server";
import { requireActiveManager } from "@/app/utils/authGuards";
import { operationalClient } from "@/sanity/lib/operationalClient";

export async function GET() {
  const session = await requireActiveManager();
  if (!session) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  // Restricted to admin and super-admin (not content-editor)
  if (session.user.role === "content-editor") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // `_rev` plus the approval-input fingerprint fields (target, ordered songs,
  // team notes) and the recorded approval/transition receipts are part of the
  // contract (A2 §6): an admin transition must submit the revision it actually
  // reviewed, and the panel must be able to tell an approved proposal with a
  // verifiable receipt from a legacy one without one.
  const proposals = await operationalClient.fetch(`
    *[_type == "setlistProposal"] | order(service_date asc) {
      _id,
      _rev,
      service_type,
      service_date,
      status,
      lead_notes,
      team_notes,
      admin_notes,
      submitted_at,
      reviewed_at,
      approval_receipt,
      last_transition,
      "service_ref": service_ref._ref,
      "lead_name": coalesce(lead->alias, lead->member_name),
      "lead_id": lead->_id,
      "contributors": contributors[]{ "id": person->_id, "name": coalesce(person->alias, person->member_name) },
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
