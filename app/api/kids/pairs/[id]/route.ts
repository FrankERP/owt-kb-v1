import { NextRequest, NextResponse } from "next/server";
import { requireMinistryManager } from "@/app/utils/authGuards";
import { serverClient, writeClient } from "@/sanity/lib/serverClient";
import { revalidateKidsViews } from "@/app/utils/revalidate";
import { KIDS_ROOMS, type KidsRoom } from "@/app/utils/kidsTypes";
import { validatePairMembers } from "../pairMembers";

const isRoom = (v: unknown): v is KidsRoom => KIDS_ROOMS.includes(v as KidsRoom);

/**
 * Edit one pair: rename, move room, swap members, or retire it (`active: false`).
 *
 * Every field is guarded by `!== undefined`, so a body that never mentions a
 * field leaves the stored value alone — the roster form sends only what was
 * touched, and an unconditional write would blank the rest.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireMinistryManager("kids");
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;

  // The id comes from the PATH and is otherwise unverified — `patch(id).set({name})`
  // would rename ANY document that has a `name` field (a worship `author` or `tag`
  // does), and a Kids manager reaches no worship data by design. Same shape as the
  // availability route: check the target first, 404 when it is not ours — a 403
  // would confirm the document exists.
  const target = await serverClient.fetch<{ _type: string } | null>(
    `*[_id == $id][0]{ _type }`,
    { id },
  );
  if (target?._type !== "kidsPair") {
    return NextResponse.json({ error: "Not a kids pair" }, { status: 404 });
  }

  const body = (await req.json()) as {
    name?: string;
    room?: string;
    memberIds?: string[];
    active?: boolean;
  };

  const patch: Record<string, unknown> = {};

  if (body.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
    patch.name = name;
  }

  if (body.room !== undefined) {
    if (!isRoom(body.room)) return NextResponse.json({ error: "Invalid room" }, { status: 400 });
    patch.room = body.room;
  }

  if (body.memberIds !== undefined) {
    const memberIds = body.memberIds;
    if (
      !Array.isArray(memberIds) ||
      memberIds.length !== 2 ||
      !memberIds.every((m) => typeof m === "string" && m.trim())
    ) {
      return NextResponse.json({ error: "memberIds must be two member ids" }, { status: 400 });
    }
    if (memberIds[0] === memberIds[1]) {
      return NextResponse.json({ error: "A pair needs two different members" }, { status: 400 });
    }
    // Same seating rule as the create route (shared, so the two cannot drift):
    // a swap may only seat real kids members.
    const memberError = await validatePairMembers(memberIds);
    if (memberError) return NextResponse.json({ error: memberError }, { status: 400 });
    // Same `_key` convention as the create route: the member ref.
    patch.members = memberIds.map((m) => ({ _type: "reference", _ref: m, _key: m }));
  }

  if (body.active !== undefined) {
    if (typeof body.active !== "boolean") {
      return NextResponse.json({ error: "active must be a boolean" }, { status: 400 });
    }
    patch.active = body.active;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const doc = await writeClient.patch(id).set(patch).commit();
  revalidateKidsViews();
  return NextResponse.json(doc);
}
