import { NextResponse } from "next/server";
import { requireMinistryMember } from "@/app/utils/authGuards";
import { operationalClient } from "@/sanity/lib/operationalClient";

// Notification badge count for the current user. Fetched client-side by NavMenu
// after paint so it never blocks page rendering / static caching.
export async function GET() {
  // The counts are worship setlist proposals. NavMenu treats a non-ok response
  // as zero, so a kids-only member simply sees no badge.
  const session = await requireMinistryMember("worship");
  if (!session) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const role = session.user.role as string | undefined;
  const isAdmin = role === "super-admin" || role === "admin";
  const isLead = role === "member" || role === "content-editor" || isAdmin;

  let count = 0;
  if (isAdmin) {
    count = await operationalClient.fetch<number>(
      `count(*[_type == "setlistProposal" && status == "pending"])`,
      {}
    );
  } else if (isLead) {
    count = await operationalClient.fetch<number>(
      `count(*[_type == "setlistProposal" && lead._ref == $id && status == "changes_requested"])`,
      { id: session.user.sanityId }
    );
  }

  return NextResponse.json({ count });
}
