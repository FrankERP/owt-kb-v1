import { NextRequest, NextResponse } from "next/server";
import { requireMinistryManager } from "@/app/utils/authGuards";
import { serverClient, writeClient } from "@/sanity/lib/serverClient";
import { revalidateKidsViews } from "@/app/utils/revalidate";
import { KIDS_ROOMS, type KidsRoom } from "@/app/utils/kidsTypes";

// The Oasis Kids pair roster. Guarded by `requireMinistryManager("kids")`, which
// a worship `admin` does NOT satisfy — two-way ministry isolation (P1).

const isRoom = (v: unknown): v is KidsRoom => KIDS_ROOMS.includes(v as KidsRoom);

/**
 * `active` is `coalesce`d because the schema's `initialValue: true` only applies
 * to documents authored in Studio; a pair created before the field existed, or
 * by a hand-written mutation, must still read as active rather than vanish from
 * every rotation.
 */
const PAIRS_QUERY = `*[_type == "kidsPair"] | order(name asc) {
    "id": _id, name, room,
    "active": coalesce(active, true),
    "memberIds": coalesce(members[]._ref, [])
  }`;

export async function GET() {
  const session = await requireMinistryManager("kids");
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const pairs = await serverClient.fetch(PAIRS_QUERY);
  return NextResponse.json(pairs);
}

export async function POST(req: NextRequest) {
  const session = await requireMinistryManager("kids");
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = (await req.json()) as { name?: string; room?: string; memberIds?: string[] };

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
  if (!isRoom(body.room)) return NextResponse.json({ error: "Invalid room" }, { status: 400 });

  const memberIds = body.memberIds;
  if (
    !Array.isArray(memberIds) ||
    memberIds.length !== 2 ||
    !memberIds.every((id) => typeof id === "string" && id.trim())
  ) {
    return NextResponse.json({ error: "memberIds must be two member ids" }, { status: 400 });
  }
  // Two seats, two people — and the `_key` below is the member ref, so a repeated
  // id would also write two array items sharing one key, which Sanity rejects.
  if (memberIds[0] === memberIds[1]) {
    return NextResponse.json({ error: "A pair needs two different members" }, { status: 400 });
  }

  const doc = await writeClient.create({
    _type: "kidsPair",
    name,
    room: body.room,
    active: true,
    // `_key` per array item is a repo invariant (Sanity drops/garbles keyless
    // object arrays on patch); the member ref is unique within the pair, so it
    // makes a stable key with no extra id to mint.
    members: memberIds.map((id) => ({ _type: "reference", _ref: id, _key: id })),
  });

  revalidateKidsViews();
  return NextResponse.json(doc, { status: 201 });
}
