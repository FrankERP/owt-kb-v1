import { NextRequest, NextResponse } from "next/server";
import { requireActiveSession } from "@/app/utils/authGuards";
import { serverClient, writeClient } from "@/sanity/lib/serverClient";
import { sanityConflictKind } from "@/app/utils/roleWriteRequest";

const CURRENT_QUERY = `*[_type == "teamMembers" && _id == $id][0] {
    _rev,
    "unavailableDates": coalesce(unavailableDates, []),
    "unavailabilityNotes": coalesce(unavailabilityNotes, [])
  }`;

interface CurrentMember {
  _rev?: string;
  unavailableDates: string[];
  unavailabilityNotes: { date: string; note: string }[];
}

interface PatchedMember {
  _rev?: string;
  unavailableDates?: string[];
  unavailabilityNotes?: { date: string; note: string }[];
}

/** The 409 body: the member's edit did NOT land, and this is the state that did. */
function staleRevision(current: CurrentMember | null) {
  return NextResponse.json(
    {
      error: "stale_revision",
      _rev: current?._rev ?? null,
      unavailableDates: current?.unavailableDates ?? [],
      unavailabilityNotes: current?.unavailabilityNotes ?? [],
    },
    { status: 409 },
  );
}

export async function GET() {
  const session = await requireActiveSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // `_rev` rides along because the PATCH below requires it: a reader that cannot
  // learn the revision it read at cannot save.
  const member = await serverClient.fetch<CurrentMember | null>(CURRENT_QUERY, {
    id: session.user.sanityId,
  });

  return NextResponse.json({
    _rev:                member?._rev                 ?? null,
    unavailableDates:    member?.unavailableDates     ?? [],
    unavailabilityNotes: member?.unavailabilityNotes  ?? [],
  });
}

/**
 * The member marks their own absences at `/me`.
 *
 * WHY `_rev` IS MANDATORY. `unavailableDates` has TWO wholesale writers — this
 * one and the Kids manager's override (`/api/kids/members/[id]/availability`),
 * which is already guarded. Both replace the ENTIRE array from a page-load
 * snapshot, and `/me` is a page members leave open for hours, so without a
 * precondition this direction of the same race silently DELETES a stated absence
 * behind a "Guardado ✓":
 *
 *   09:30  the member opens `/me`; the calendar snapshots their dates
 *   10:00  the Kids manager records "out on 2026-09-20" and it commits
 *   10:05  the member toggles an October date and saves — the PATCH carries the
 *          09:30 array, 2026-09-20 is gone, and the worship solver seats them on
 *          a Sunday they refused.
 *
 * So the body must carry the `_rev` the calendar was rendered at and the commit
 * runs under `ifRevisionId`. A MISSING `_rev` is a 400, never a fallback to the
 * old unconditional write: a fallback would keep the bug alive for every caller
 * that omits the field — including a client bundle still cached from before this
 * deploy — which is exactly the audience the guard exists for.
 */
export async function PATCH(req: NextRequest) {
  const session = await requireActiveSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json() as {
    _rev?: unknown;
    unavailableDates: string[];
    unavailabilityNotes?: { date: string; note: string }[];
  };

  if (typeof body._rev !== "string" || !body._rev) {
    return NextResponse.json({ error: "_rev is required" }, { status: 400 });
  }
  if (!Array.isArray(body.unavailableDates)) {
    return NextResponse.json({ error: "unavailableDates must be an array" }, { status: 400 });
  }

  const id = session.user.sanityId;

  // The revision the calendar was rendered at is already stale at read time —
  // refuse before writing anything. `ifRevisionId` below closes the remaining
  // window between this read and the commit; this arm exists so the common case
  // answers with fresh arrays instead of burning a mutation.
  const current = await serverClient.fetch<CurrentMember | null>(CURRENT_QUERY, { id });
  if (current?._rev !== body._rev) return staleRevision(current);

  const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

  // Validate dates
  const valid = body.unavailableDates.filter(d => ISO_RE.test(d));
  const validSet = new Set(valid);

  // Validate notes: must reference a valid date, have a non-empty note string,
  // and be unique per date. Each item gets a _key (required by Sanity for
  // object array items); the date is unique per note so it makes a stable key.
  const seenDates = new Set<string>();
  const validNotes = (body.unavailabilityNotes ?? [])
    .filter(n => ISO_RE.test(n.date) && validSet.has(n.date) && typeof n.note === "string" && n.note.trim())
    .filter(n => (seenDates.has(n.date) ? false : (seenDates.add(n.date), true)))
    .map(n => ({ _key: n.date, date: n.date, note: n.note.trim() }));

  let doc: PatchedMember;
  try {
    doc = await writeClient
      .patch(id)
      .ifRevisionId(body._rev)
      .set({ unavailableDates: valid, unavailabilityNotes: validNotes })
      .commit();
  } catch (err) {
    // ONLY a genuine Content Lake 409 is a lost race. A missing write token, a
    // network fault or a schema complaint must surface as itself — reporting
    // those as "someone else changed it" sends the member to reload, get the
    // SAME revision back, and fail identically forever.
    if (!sanityConflictKind(err)) throw err;
    const fresh = await serverClient.fetch<CurrentMember | null>(CURRENT_QUERY, { id });
    return staleRevision(fresh);
  }

  return NextResponse.json({
    _rev:                doc._rev                ?? null,
    unavailableDates:    doc.unavailableDates    ?? [],
    unavailabilityNotes: doc.unavailabilityNotes ?? [],
  });
}
