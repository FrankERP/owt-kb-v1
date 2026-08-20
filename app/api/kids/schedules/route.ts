import { NextRequest, NextResponse } from "next/server";
import { requireMinistryManager } from "@/app/utils/authGuards";
import { serverClient, writeClient } from "@/sanity/lib/serverClient";
import { revalidateKidsViews } from "@/app/utils/revalidate";
import { KIDS_ROOMS, KIDS_SEATS, type KidsRoom, type KidsSeat } from "@/app/utils/kidsTypes";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

const isSeat = (v: string): v is KidsSeat => (KIDS_SEATS as string[]).includes(v);
const isRoomSeat = (seat: KidsSeat): seat is KidsRoom => (KIDS_ROOMS as string[]).includes(seat);

/**
 * Seat references are projected RAW (`._ref`), not dereferenced: the planner
 * needs the pair id it will send back, and the pair roster is fetched once
 * alongside. `published` is coalesced, not compared: in GROQ `null == true` is
 * `null`, so a document written before the field existed would answer neither
 * true nor false.
 */
const SCHEDULES_QUERY = `*[_type == "kidsSchedule" && date >= $from && date <= $to] | order(date asc) {
    date,
    "published": coalesce(published, false),
    "ensenanza": ensenanza._ref,
    "chiquitos": chiquitos._ref,
    "medianos": medianos._ref,
    "grandes": grandes._ref
  }`;

interface ScheduleRow {
  date: string;
  published: boolean;
  ensenanza?: string | null;
  chiquitos?: string | null;
  medianos?: string | null;
  grandes?: string | null;
}

export async function GET(req: NextRequest) {
  const session = await requireMinistryManager("kids");
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const month = req.nextUrl.searchParams.get("month") ?? "";
  if (!MONTH_RE.test(month)) {
    return NextResponse.json({ error: "month must be YYYY-MM" }, { status: 400 });
  }

  // String bounds, no `Date` arithmetic: ISO dates sort lexicographically, and
  // `<= YYYY-MM-31` covers every real day of the month while excluding the next
  // month's first — which is exactly what the repo's timezone invariant asks for
  // (`new Date(iso)` here would drift a day either way).
  const rows = await serverClient.fetch<ScheduleRow[]>(SCHEDULES_QUERY, {
    from: `${month}-01`,
    to: `${month}-31`,
  });

  return NextResponse.json(
    (rows ?? []).map((row) => {
      const seats: Partial<Record<KidsSeat, string>> = {};
      for (const seat of KIDS_SEATS) {
        const pairId = row[seat];
        if (pairId) seats[seat] = pairId;
      }
      return { date: row.date, seats, published: row.published };
    }),
  );
}

export async function PUT(req: NextRequest) {
  const session = await requireMinistryManager("kids");
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = (await req.json()) as {
    date?: string;
    seats?: Record<string, string | null>;
    published?: boolean;
  };

  if (typeof body.date !== "string" || !ISO_RE.test(body.date)) {
    return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
  }
  if (!body.seats || typeof body.seats !== "object" || Array.isArray(body.seats)) {
    return NextResponse.json({ error: "seats must be an object" }, { status: 400 });
  }
  if (body.published !== undefined && typeof body.published !== "boolean") {
    return NextResponse.json({ error: "published must be a boolean" }, { status: 400 });
  }

  // Only the four known seats, and only pair ids or an explicit clear.
  const requested: Partial<Record<KidsSeat, string>> = {};
  for (const [seat, pairId] of Object.entries(body.seats)) {
    if (!isSeat(seat)) return NextResponse.json({ error: "Unknown seat" }, { status: 400 });
    if (pairId === null || pairId === undefined || pairId === "") continue;
    if (typeof pairId !== "string") {
      return NextResponse.json({ error: "Invalid pair id" }, { status: 400 });
    }
    requested[seat] = pairId;
  }

  // A pair holds at most ONE seat per Sunday (spec §1). The rotation engine
  // guarantees it; a hand override from the planner does not, so it is checked
  // here rather than trusted.
  const chosen = Object.values(requested);
  if (new Set(chosen).size !== chosen.length) {
    return NextResponse.json({ error: "A pair cannot hold two seats" }, { status: 400 });
  }

  if (chosen.length > 0) {
    const pairs = await serverClient.fetch<{ _id: string; room: KidsRoom; active: boolean }[]>(
      `*[_type == "kidsPair" && _id in $ids]{ _id, room, "active": coalesce(active, true) }`,
      { ids: chosen },
    );
    const byId = new Map((pairs ?? []).map((p) => [p._id, p]));
    for (const [seat, pairId] of Object.entries(requested) as [KidsSeat, string][]) {
      const pair = byId.get(pairId);
      if (!pair) return NextResponse.json({ error: "Unknown pair" }, { status: 400 });
      if (!pair.active) {
        return NextResponse.json({ error: "Pair is retired" }, { status: 400 });
      }
      // Room seats take their own room's pairs only; enseñanza takes any active
      // pair. Cross-room seating is refused SERVER-side: the planner's dropdowns
      // already scope the options, and a dropdown is not a control.
      if (isRoomSeat(seat) && pair.room !== seat) {
        return NextResponse.json({ error: "Pair does not belong to that room" }, { status: 400 });
      }
    }
  }

  // DETERMINISTIC id: one document per Sunday. A regenerate updates in place and
  // two concurrent saves cannot fork the same Sunday into two documents.
  const _id = `kidsSchedule-${body.date}`;
  await writeClient.createIfNotExists({
    _id,
    _type: "kidsSchedule",
    date: body.date,
    published: false,
  });

  const seatPatch: Record<string, unknown> = { date: body.date };
  const seatUnset: string[] = [];
  for (const seat of KIDS_SEATS) {
    const pairId = requested[seat];
    if (pairId) seatPatch[seat] = { _type: "reference", _ref: pairId };
    // An omitted seat is CLEARED, not left behind: the planner PUTs the whole
    // Sunday, so a seat the admin emptied must not survive as a stale reference.
    else seatUnset.push(seat);
  }
  if (body.published !== undefined) seatPatch.published = body.published;

  // A full Sunday — every seat filled, the ordinary result of "Generar mes" —
  // leaves `seatUnset` empty, and `@sanity/client` would put `unset: []` into the
  // mutation verbatim. Guarded the way the repo already guards it in
  // `applyPublishReadyAssertions`: only call `.unset()` with something to unset.
  let patch = writeClient.patch(_id).set(seatPatch);
  if (seatUnset.length) patch = patch.unset(seatUnset);
  await patch.commit();
  revalidateKidsViews();

  return NextResponse.json({
    _id,
    date: body.date,
    seats: requested,
    ...(body.published !== undefined ? { published: body.published } : {}),
  });
}
