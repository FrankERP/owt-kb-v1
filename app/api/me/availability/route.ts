import { NextRequest, NextResponse } from "next/server";
import { requireActiveSession } from "@/app/utils/authGuards";
import { serverClient, writeClient } from "@/sanity/lib/serverClient";

export async function GET() {
  const session = await requireActiveSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const member = await serverClient.fetch(
    `*[_type == "teamMembers" && _id == $id][0] { unavailableDates, unavailabilityNotes }`,
    { id: session.user.sanityId }
  );

  return NextResponse.json({
    unavailableDates:    member?.unavailableDates    ?? [],
    unavailabilityNotes: member?.unavailabilityNotes ?? [],
  });
}

export async function PATCH(req: NextRequest) {
  const session = await requireActiveSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json() as {
    unavailableDates: string[];
    unavailabilityNotes?: { date: string; note: string }[];
  };

  if (!Array.isArray(body.unavailableDates)) {
    return NextResponse.json({ error: "unavailableDates must be an array" }, { status: 400 });
  }

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

  const doc = await writeClient
    .patch(session.user.sanityId)
    .set({ unavailableDates: valid, unavailabilityNotes: validNotes })
    .commit();

  return NextResponse.json({
    unavailableDates:    (doc as any).unavailableDates    ?? [],
    unavailabilityNotes: (doc as any).unavailabilityNotes ?? [],
  });
}
