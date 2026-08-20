import { NextRequest, NextResponse } from "next/server";
import { requireMinistryManager } from "@/app/utils/authGuards";
import { serverClient, writeClient } from "@/sanity/lib/serverClient";
import { revalidateKidsViews } from "@/app/utils/revalidate";
import { sanityConflictKind } from "@/app/utils/roleWriteRequest";
import { normalizeMinistries } from "@/app/ministries";

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

const CURRENT_QUERY = `*[_type == "teamMembers" && _id == $id][0]{
    _id, _rev, ministries,
    "unavailableDates": coalesce(unavailableDates, []),
    "unavailabilityNotes": coalesce(unavailabilityNotes, [])
  }`;

interface CurrentMember {
  _id: string;
  _rev?: string;
  ministries?: unknown;
  unavailableDates: string[];
  unavailabilityNotes: { date: string; note: string }[];
}

interface PatchedMember {
  _rev?: string;
  unavailableDates?: string[];
  unavailabilityNotes?: { date: string; note: string }[];
}

/** The 409 body: the manager's edit did NOT land, and this is the state that did. */
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

/**
 * A Kids manager records a volunteer's absences on their behalf (the volunteer's
 * own `/me` availability panel writes the same two fields). Validation mirrors
 * `app/api/me/availability` exactly: unparseable dates are dropped rather than
 * stored, and a note is kept only when it hangs off a date that survived.
 *
 * WHY `_rev` IS MANDATORY. This route made `unavailableDates` a field with TWO
 * wholesale writers, and the other one is the member themself. The panel holds
 * the member's ENTIRE array from a page-load snapshot, so without a precondition
 * the interleaving below silently DELETES a stated absence with a success toast:
 *
 *   10:00  member marks 2026-09-20 unavailable at `/me`
 *   09:30  manager's `/kids/admin` snapshot (no 2026-09-20) is already open
 *   10:05  manager toggles an October date and saves — the PATCH carries the
 *          09:30 array, the member is available again on a Sunday they refused,
 *          and the solver seats them.
 *
 * So the body must carry the `_rev` the manager last saw and the commit runs
 * under `ifRevisionId`. A MISSING `_rev` is a 400, never a fallback to the old
 * unconditional write: a fallback would keep the bug alive for every caller that
 * omits the field — including a stale client bundle still cached after deploy —
 * which is exactly the audience the guard exists for. 400 is loud and fixable;
 * a silent unconditional write is neither.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireMinistryManager("kids");
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;

  const target = await serverClient.fetch<CurrentMember | null>(CURRENT_QUERY, { id });
  // `normalizeMinistries` is the SHARED rule (app/ministries.ts) — never
  // re-derive "absent means worship" here; a fourth open-coded copy is how the
  // admin form came to disagree with storage. A worship member is a 404 and not
  // a 403: a Kids manager has no business learning they exist.
  if (!target || !normalizeMinistries(target.ministries).includes("kids")) {
    return NextResponse.json({ error: "Not a kids member" }, { status: 404 });
  }

  const body = (await req.json()) as {
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

  // The revision the manager last saw is already stale at read time — refuse
  // before writing anything. `ifRevisionId` below closes the remaining window
  // between this read and the commit; this arm exists so the common case answers
  // with fresh arrays instead of burning a mutation.
  if (target._rev !== body._rev) return staleRevision(target);

  const valid = body.unavailableDates.filter((d) => ISO_RE.test(d));
  const validSet = new Set(valid);

  // One note per date, keyed by the date — unique within the array, so it is a
  // stable `_key` (required by Sanity for object array items).
  const seenDates = new Set<string>();
  const validNotes = (body.unavailabilityNotes ?? [])
    .filter(
      (n) =>
        ISO_RE.test(n.date) && validSet.has(n.date) && typeof n.note === "string" && n.note.trim(),
    )
    .filter((n) => (seenDates.has(n.date) ? false : (seenDates.add(n.date), true)))
    .map((n) => ({ _key: n.date, date: n.date, note: n.note.trim() }));

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
    // those as "someone else changed it" sends the manager to reload, get the
    // SAME revision back, and fail identically forever.
    if (!sanityConflictKind(err)) throw err;
    const fresh = await serverClient.fetch<CurrentMember | null>(CURRENT_QUERY, { id });
    return staleRevision(fresh);
  }

  revalidateKidsViews();

  return NextResponse.json({
    _rev: doc._rev ?? null,
    unavailableDates: doc.unavailableDates ?? [],
    unavailabilityNotes: doc.unavailabilityNotes ?? [],
  });
}
