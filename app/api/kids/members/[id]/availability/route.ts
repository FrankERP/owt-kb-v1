import { NextRequest, NextResponse } from "next/server";
import { requireMinistryManager } from "@/app/utils/authGuards";
import { serverClient, writeClient } from "@/sanity/lib/serverClient";
import { revalidateKidsViews } from "@/app/utils/revalidate";
import { normalizeMinistries } from "@/app/ministries";

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A Kids manager records a volunteer's absences on their behalf (the volunteer's
 * own `/me` availability panel is untouched by this route and writes the same
 * two fields). Validation mirrors `app/api/me/availability` exactly: unparseable
 * dates are dropped rather than stored, and a note is kept only when it hangs
 * off a date that survived.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireMinistryManager("kids");
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;

  const target = await serverClient.fetch<{ _id: string; ministries?: unknown } | null>(
    `*[_type == "teamMembers" && _id == $id][0]{ _id, ministries }`,
    { id },
  );
  // `normalizeMinistries` is the SHARED rule (app/ministries.ts) — never
  // re-derive "absent means worship" here; a fourth open-coded copy is how the
  // admin form came to disagree with storage. A worship member is a 404 and not
  // a 403: a Kids manager has no business learning they exist.
  if (!target || !normalizeMinistries(target.ministries).includes("kids")) {
    return NextResponse.json({ error: "Not a kids member" }, { status: 404 });
  }

  const body = (await req.json()) as {
    unavailableDates: string[];
    unavailabilityNotes?: { date: string; note: string }[];
  };

  if (!Array.isArray(body.unavailableDates)) {
    return NextResponse.json({ error: "unavailableDates must be an array" }, { status: 400 });
  }

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

  const doc = await writeClient
    .patch(id)
    .set({ unavailableDates: valid, unavailabilityNotes: validNotes })
    .commit();

  revalidateKidsViews();

  return NextResponse.json({
    unavailableDates: (doc as { unavailableDates?: string[] }).unavailableDates ?? [],
    unavailabilityNotes:
      (doc as { unavailabilityNotes?: { date: string; note: string }[] }).unavailabilityNotes ?? [],
  });
}
