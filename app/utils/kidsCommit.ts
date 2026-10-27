// Oasis Kids' writers, after authorization: one Sunday of the rotation, the pair
// roster (create, edit, retire) and a volunteer's absences recorded by a Kids
// manager. The `/api/kids/*` routes check `requireMinistryManager("kids")`, parse
// JSON and call these; the MCP connector's Kids tools call the same functions
// (admin parity phase 3, S4), so both surfaces refuse and write through one code
// path (ADR-0043).
//
// Every function returns a `CommitOutcome`: `body` and `status` are EXACTLY what
// the route sends. A refusal's `error` is one of `KIDS_ERROR`'s strings — the
// words the routes always answered with, now named so a second caller can tell
// them apart without retyping them. The rationale for each rule lives beside
// it, moved here from the routes unchanged.
//
// Nobody is notified by any of these writes (the Kids planner sends nothing).

import { serverClient, writeClient } from "@/sanity/lib/serverClient";
import { revalidateKidsViews } from "@/app/utils/revalidate";
import { sanityConflictKind } from "@/app/utils/roleWriteRequest";
import { normalizeMinistries } from "@/app/ministries";
import { KIDS_ROOMS, KIDS_SEATS, type KidsRoom, type KidsSeat } from "@/app/utils/kidsTypes";
import type { CommitOutcome } from "@/app/utils/commitOutcome";

/** Every refusal these writers answer with, as the routes always worded it. */
export const KIDS_ERROR = {
  invalidDate: "date must be YYYY-MM-DD",
  seatsNotObject: "seats must be an object",
  publishedNotBoolean: "published must be a boolean",
  unknownSeat: "Unknown seat",
  invalidPairId: "Invalid pair id",
  pairTwoSeats: "A pair cannot hold two seats",
  unknownPair: "Unknown pair",
  pairRetired: "Pair is retired",
  wrongRoom: "Pair does not belong to that room",
  nameRequired: "name required",
  invalidRoom: "Invalid room",
  twoMemberIds: "memberIds must be two member ids",
  sameMember: "A pair needs two different members",
  notKidsMembers: "memberIds must be kids members",
  notAPair: "Not a kids pair",
  activeNotBoolean: "active must be a boolean",
  nothingToUpdate: "Nothing to update",
  notKidsMember: "Not a kids member",
  revRequired: "_rev is required",
  datesNotArray: "unavailableDates must be an array",
  staleRevision: "stale_revision",
} as const;

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

const isSeat = (v: string): v is KidsSeat => (KIDS_SEATS as string[]).includes(v);
const isRoomSeat = (seat: KidsSeat): seat is KidsRoom => (KIDS_ROOMS as string[]).includes(seat);
const isRoom = (v: unknown): v is KidsRoom => KIDS_ROOMS.includes(v as KidsRoom);

function refuse(status: number, error: string): { ok: false; status: number; body: Record<string, unknown> } {
  return { ok: false, status, body: { error } };
}

/** Untrusted JSON as an object whose fields may be read; anything else reads as `{}`. */
function fields(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
}

// ── One Sunday ───────────────────────────────────────────────────────────────

export interface KidsSundayEffects {
  date: string;
  /** The seats as written: an omitted seat was CLEARED. */
  seats: Partial<Record<KidsSeat, string>>;
  /** Present only when the request set it. */
  published?: boolean;
}

/**
 * Write one Sunday of the rotation, WHOLE: the four seats as given (an omitted
 * seat is cleared) and, when the request carries it, `published`.
 */
export async function saveKidsSunday(raw: unknown): Promise<CommitOutcome<KidsSundayEffects>> {
  const body = fields(raw) as {
    date?: unknown;
    seats?: unknown;
    published?: unknown;
  };

  if (typeof body.date !== "string" || !ISO_RE.test(body.date)) return refuse(400, KIDS_ERROR.invalidDate);
  if (!body.seats || typeof body.seats !== "object" || Array.isArray(body.seats)) {
    return refuse(400, KIDS_ERROR.seatsNotObject);
  }
  if (body.published !== undefined && typeof body.published !== "boolean") {
    return refuse(400, KIDS_ERROR.publishedNotBoolean);
  }
  const date = body.date;
  const published = body.published as boolean | undefined;

  // Only the four known seats, and only pair ids or an explicit clear.
  const requested: Partial<Record<KidsSeat, string>> = {};
  for (const [seat, pairId] of Object.entries(body.seats as Record<string, unknown>)) {
    if (!isSeat(seat)) return refuse(400, KIDS_ERROR.unknownSeat);
    if (pairId === null || pairId === undefined || pairId === "") continue;
    if (typeof pairId !== "string") return refuse(400, KIDS_ERROR.invalidPairId);
    requested[seat] = pairId;
  }

  // A pair holds at most ONE seat per Sunday (spec §1). The rotation engine
  // guarantees it; a hand override from the planner does not, so it is checked
  // here rather than trusted.
  const chosen = Object.values(requested);
  if (new Set(chosen).size !== chosen.length) return refuse(400, KIDS_ERROR.pairTwoSeats);

  if (chosen.length > 0) {
    const pairs = await serverClient.fetch<{ _id: string; room: KidsRoom; active: boolean }[]>(
      `*[_type == "kidsPair" && _id in $ids]{ _id, room, "active": coalesce(active, true) }`,
      { ids: chosen },
    );
    const byId = new Map((pairs ?? []).map((p) => [p._id, p]));
    for (const [seat, pairId] of Object.entries(requested) as [KidsSeat, string][]) {
      const pair = byId.get(pairId);
      if (!pair) return refuse(400, KIDS_ERROR.unknownPair);
      if (!pair.active) return refuse(400, KIDS_ERROR.pairRetired);
      // Room seats take their own room's pairs only; enseñanza takes any active
      // pair. Cross-room seating is refused SERVER-side: the planner's dropdowns
      // already scope the options, and a dropdown is not a control.
      if (isRoomSeat(seat) && pair.room !== seat) return refuse(400, KIDS_ERROR.wrongRoom);
    }
  }

  // DETERMINISTIC id: one document per Sunday. A regenerate updates in place and
  // two concurrent saves cannot fork the same Sunday into two documents.
  const _id = `kidsSchedule-${date}`;
  await writeClient.createIfNotExists({
    _id,
    _type: "kidsSchedule",
    date,
    published: false,
  });

  const seatPatch: Record<string, unknown> = { date };
  const seatUnset: string[] = [];
  for (const seat of KIDS_SEATS) {
    const pairId = requested[seat];
    if (pairId) seatPatch[seat] = { _type: "reference", _ref: pairId };
    // An omitted seat is CLEARED, not left behind: the planner PUTs the whole
    // Sunday, so a seat the admin emptied must not survive as a stale reference.
    else seatUnset.push(seat);
  }
  if (published !== undefined) seatPatch.published = published;

  // A full Sunday — every seat filled, the ordinary result of "Generar mes" —
  // leaves `seatUnset` empty, and `@sanity/client` would put `unset: []` into the
  // mutation verbatim. Guarded the way the repo already guards it in
  // `applyPublishReadyAssertions`: only call `.unset()` with something to unset.
  let patch = writeClient.patch(_id).set(seatPatch);
  if (seatUnset.length) patch = patch.unset(seatUnset);
  await patch.commit();
  revalidateKidsViews();

  return {
    ok: true,
    status: 200,
    body: {
      _id,
      date,
      seats: requested,
      ...(published !== undefined ? { published } : {}),
    },
    effects: { date, seats: requested, ...(published !== undefined ? { published } : {}) },
  };
}

// ── The pair roster ──────────────────────────────────────────────────────────

/**
 * Both seats of a pair must resolve to REAL kids `teamMembers`. Without this a
 * Kids manager can write ANY document id into `members[]._ref` — the ids of the
 * worship roster are one `GET /api/kids/members` away — and the reference lands
 * unchecked, which is the same hole the availability writer closes on its target.
 *
 * `normalizeMinistries` is the SHARED rule (app/ministries.ts) — never
 * re-derive "absent means worship" here; a member predating the kids feature
 * carries no `ministries` field and is a worship member, not a seatable one.
 *
 * Returns an error string (the shape `validateMinistryWrite` uses) or null when
 * every id may be seated. Create and edit both call it, so they cannot drift.
 */
async function validatePairMembers(memberIds: string[]): Promise<string | null> {
  const rows = await serverClient.fetch<{ _id: string; ministries?: unknown }[]>(
    `*[_type == "teamMembers" && _id in $ids]{ _id, ministries }`,
    { ids: memberIds },
  );
  const seatable = new Set(
    (rows ?? [])
      .filter((r) => normalizeMinistries(r.ministries).includes("kids"))
      .map((r) => r._id),
  );
  // A missing id fails the same way a worship id does: a Kids manager has no
  // business learning which of the two it was.
  return memberIds.every((id) => seatable.has(id)) ? null : KIDS_ERROR.notKidsMembers;
}

/** The two-ids rule both pair writers apply, or the refusal. */
async function pairMembersRefusal(memberIds: unknown): Promise<string | null> {
  if (
    !Array.isArray(memberIds) ||
    memberIds.length !== 2 ||
    !memberIds.every((id) => typeof id === "string" && id.trim())
  ) {
    return KIDS_ERROR.twoMemberIds;
  }
  // Two seats, two people — and the `_key` is the member ref, so a repeated id
  // would also write two array items sharing one key, which Sanity rejects.
  if (memberIds[0] === memberIds[1]) return KIDS_ERROR.sameMember;
  // Two well-formed strings are not two PEOPLE — the ids have to resolve to kids
  // members before they are written as references.
  return validatePairMembers(memberIds as string[]);
}

/**
 * `_key` per array item is a repo invariant (Sanity drops/garbles keyless object
 * arrays on patch); the member ref is unique within the pair, so it makes a
 * stable key with no extra id to mint.
 */
const memberRefs = (memberIds: string[]) => memberIds.map((id) => ({ _type: "reference", _ref: id, _key: id }));

export interface KidsPairEffects {
  id: string;
}

/** Create a pair: a name, a room and two kids volunteers. Answers 201. */
export async function createKidsPair(raw: unknown): Promise<CommitOutcome<KidsPairEffects, 201>> {
  const body = fields(raw) as { name?: unknown; room?: unknown; memberIds?: unknown };

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return refuse(400, KIDS_ERROR.nameRequired);
  if (!isRoom(body.room)) return refuse(400, KIDS_ERROR.invalidRoom);
  const memberError = await pairMembersRefusal(body.memberIds);
  if (memberError) return refuse(400, memberError);

  const doc = await writeClient.create({
    _type: "kidsPair",
    name,
    room: body.room,
    active: true,
    members: memberRefs(body.memberIds as string[]),
  });

  revalidateKidsViews();
  return { ok: true, status: 201, body: doc as Record<string, unknown>, effects: { id: doc._id } };
}

/**
 * Edit one pair: rename, move room, swap members, or retire it (`active: false`).
 *
 * Every field is guarded by `!== undefined`, so a body that never mentions a
 * field leaves the stored value alone — the roster form sends only what was
 * touched, and an unconditional write would blank the rest.
 */
export async function patchKidsPair(id: string, raw: unknown): Promise<CommitOutcome<KidsPairEffects>> {
  // The id comes from the caller (the route's PATH) and is otherwise unverified —
  // `patch(id).set({name})` would rename ANY document that has a `name` field (a
  // worship `author` or `tag` does), and a Kids manager reaches no worship data by
  // design. Same shape as the availability writer: check the target first, 404
  // when it is not ours — a 403 would confirm the document exists.
  const target = await serverClient.fetch<{ _type: string } | null>(
    `*[_id == $id][0]{ _type }`,
    { id },
  );
  if (target?._type !== "kidsPair") return refuse(404, KIDS_ERROR.notAPair);

  const body = fields(raw) as { name?: unknown; room?: unknown; memberIds?: unknown; active?: unknown };
  const patch: Record<string, unknown> = {};

  if (body.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return refuse(400, KIDS_ERROR.nameRequired);
    patch.name = name;
  }

  if (body.room !== undefined) {
    if (!isRoom(body.room)) return refuse(400, KIDS_ERROR.invalidRoom);
    patch.room = body.room;
  }

  if (body.memberIds !== undefined) {
    // Same seating rule as create (shared, so the two cannot drift): a swap may
    // only seat real kids members.
    const memberError = await pairMembersRefusal(body.memberIds);
    if (memberError) return refuse(400, memberError);
    patch.members = memberRefs(body.memberIds as string[]);
  }

  if (body.active !== undefined) {
    if (typeof body.active !== "boolean") return refuse(400, KIDS_ERROR.activeNotBoolean);
    patch.active = body.active;
  }

  if (Object.keys(patch).length === 0) return refuse(400, KIDS_ERROR.nothingToUpdate);

  const doc = await writeClient.patch(id).set(patch).commit();
  revalidateKidsViews();
  return { ok: true, status: 200, body: doc as Record<string, unknown>, effects: { id } };
}

// ── A volunteer's absences ───────────────────────────────────────────────────

/** The member's availability as stored, with the revision a write must assert. */
export const KIDS_MEMBER_AVAILABILITY_QUERY = `*[_type == "teamMembers" && _id == $id][0]{
    _id, _rev, ministries,
    "unavailableDates": coalesce(unavailableDates, []),
    "unavailabilityNotes": coalesce(unavailabilityNotes, [])
  }`;

export interface KidsMemberAvailability {
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

export interface KidsAvailabilityEffects {
  rev: string | null;
  unavailableDates: string[];
  unavailabilityNotes: { date: string; note: string }[];
}

/** The 409 body: the manager's edit did NOT land, and this is the state that did. */
function staleRevision(current: KidsMemberAvailability | null) {
  return {
    ok: false as const,
    status: 409,
    body: {
      error: KIDS_ERROR.staleRevision,
      _rev: current?._rev ?? null,
      unavailableDates: current?.unavailableDates ?? [],
      unavailabilityNotes: current?.unavailabilityNotes ?? [],
    },
  };
}

/**
 * A Kids manager records a volunteer's absences on their behalf (the volunteer's
 * own `/me` availability panel writes the same two fields). Validation mirrors
 * `app/api/me/availability` exactly: unparseable dates are dropped rather than
 * stored, and a note is kept only when it hangs off a date that survived.
 *
 * WHY `_rev` IS MANDATORY. This writer made `unavailableDates` a field with TWO
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
export async function setKidsAvailability(
  id: string,
  raw: unknown,
): Promise<CommitOutcome<KidsAvailabilityEffects>> {
  const target = await serverClient.fetch<KidsMemberAvailability | null>(KIDS_MEMBER_AVAILABILITY_QUERY, { id });
  // `normalizeMinistries` is the SHARED rule (app/ministries.ts) — never
  // re-derive "absent means worship" here; a fourth open-coded copy is how the
  // admin form came to disagree with storage. A worship member is a 404 and not
  // a 403: a Kids manager has no business learning they exist.
  if (!target || !normalizeMinistries(target.ministries).includes("kids")) {
    return refuse(404, KIDS_ERROR.notKidsMember);
  }

  const body = fields(raw) as {
    _rev?: unknown;
    unavailableDates?: unknown;
    unavailabilityNotes?: { date: string; note: string }[];
  };

  if (typeof body._rev !== "string" || !body._rev) return refuse(400, KIDS_ERROR.revRequired);
  if (!Array.isArray(body.unavailableDates)) return refuse(400, KIDS_ERROR.datesNotArray);
  const rev = body._rev;

  // The revision the manager last saw is already stale at read time — refuse
  // before writing anything. `ifRevisionId` below closes the remaining window
  // between this read and the commit; this arm exists so the common case answers
  // with fresh arrays instead of burning a mutation.
  if (target._rev !== rev) return staleRevision(target);

  const valid = (body.unavailableDates as unknown[]).filter(
    (d): d is string => typeof d === "string" && ISO_RE.test(d),
  );
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
      .ifRevisionId(rev)
      .set({ unavailableDates: valid, unavailabilityNotes: validNotes })
      .commit();
  } catch (err) {
    // ONLY a genuine Content Lake 409 is a lost race. A missing write token, a
    // network fault or a schema complaint must surface as itself — reporting
    // those as "someone else changed it" sends the manager to reload, get the
    // SAME revision back, and fail identically forever.
    if (!sanityConflictKind(err)) throw err;
    const fresh = await serverClient.fetch<KidsMemberAvailability | null>(KIDS_MEMBER_AVAILABILITY_QUERY, { id });
    return staleRevision(fresh);
  }

  revalidateKidsViews();

  const result = {
    rev: doc._rev ?? null,
    unavailableDates: doc.unavailableDates ?? [],
    unavailabilityNotes: doc.unavailabilityNotes ?? [],
  };
  return {
    ok: true,
    status: 200,
    body: { _rev: result.rev, unavailableDates: result.unavailableDates, unavailabilityNotes: result.unavailabilityNotes },
    effects: result,
  };
}
