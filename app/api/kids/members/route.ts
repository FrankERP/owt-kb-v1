import { NextResponse } from "next/server";
import { requireMinistryManager } from "@/app/utils/authGuards";
import { serverClient } from "@/sanity/lib/serverClient";

/**
 * The Kids roster's member picker — deliberately NOT `GET /api/admin/members`,
 * which is worship-admin gated and scoped to worship members.
 *
 * `"kids" in ministries` needs no `!defined(ministries)` arm, unlike the worship
 * filter: absent or empty normalizes to worship-only (`normalizeMinistries`),
 * never to kids, so no member the shared rule would include can be missed here.
 *
 * `_rev` is part of the contract, not a debugging extra: the availability
 * override replaces `unavailableDates` wholesale and the member's own `/me`
 * calendar writes the same field, so the panel must send back the revision it
 * read or the PATCH refuses it (400/409). Dropping `_rev` here breaks saving.
 */
const KIDS_MEMBERS_QUERY = `*[_type == "teamMembers" && "kids" in ministries] | order(member_name asc) {
    _id, _rev, member_name, alias,
    "unavailableDates": coalesce(unavailableDates, []),
    "unavailabilityNotes": coalesce(unavailabilityNotes, [])
  }`;

export async function GET() {
  const session = await requireMinistryManager("kids");
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const members = await serverClient.fetch(KIDS_MEMBERS_QUERY);
  return NextResponse.json(members);
}
