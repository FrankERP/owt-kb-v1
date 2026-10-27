import { NextRequest, NextResponse } from "next/server";
import { requireMinistryManager } from "@/app/utils/authGuards";
import { serverClient } from "@/sanity/lib/serverClient";
import { createKidsPair } from "@/app/utils/kidsCommit";
import { PUBLISHED_PERSPECTIVE } from "@/app/utils/kidsScheduleReads";
import { withVerificationRunContext } from "@/app/utils/srVerificationRunContext";

// The Oasis Kids pair roster. Guarded by `requireMinistryManager("kids")`, which
// a worship `admin` does NOT satisfy — two-way ministry isolation (P1).

/**
 * `active` is `coalesce`d because the schema's `initialValue: true` only applies
 * to documents authored in Studio; a pair created before the field existed, or
 * by a hand-written mutation, must still read as active rather than vanish from
 * every rotation. Read `published`, like every Kids planner read: a raw read would list
 * a Studio draft as a second pair the planner could seat by its draft id.
 */
const PAIRS_QUERY = `*[_type == "kidsPair"] | order(name asc) {
    "id": _id, name, room,
    "active": coalesce(active, true),
    "memberIds": coalesce(members[]._ref, [])
  }`;

export async function GET() {
  const session = await requireMinistryManager("kids");
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const pairs = await serverClient.fetch(PAIRS_QUERY, {}, PUBLISHED_PERSPECTIVE);
  return NextResponse.json(pairs);
}

// Wrapped because the module it calls is a `*Commit` (`srVerificationRunContext.test.ts`
// scans by import); the Kids writers send nothing, and an unmarked request behaves as before.
export const POST = withVerificationRunContext(postHandler);

/**
 * Create a pair. Everything after authorization is `createKidsPair`
 * (`app/utils/kidsCommit.ts`), which the MCP `save_kids_pair` calls too.
 */
async function postHandler(req: NextRequest) {
  const session = await requireMinistryManager("kids");
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const outcome = await createKidsPair(await req.json());
  return NextResponse.json(outcome.body, { status: outcome.status });
}
