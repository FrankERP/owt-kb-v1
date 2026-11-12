import "server-only";

// THE ONE READER of `ministryEvent` (ADR-0081; plan
// `docs/superpowers/plans/2026-10-30-jovenes-events-access.md` §4). Every read of the type under
// `app/**` goes through `readMinistryEvents`; `ministryEventCoverage.test.ts` fails the build on any
// other file that names it.
//
// Why the query, and not the page, is the boundary: the Sanity dataset answers anyone without a
// token, so a document is private only by its dotted id (`ministryEvent.<uuid>`), and a group's
// meetings are kept from another group only by this module's GROQ — never by a wider read filtered
// in TypeScript afterwards. The reader's groups travel as a query PARAMETER.
//
// `mayRead` is the same rule in TypeScript, for the server decisions that judge one stored event
// (the writer's 404, the encargado's program right). `ministryEventReads.test.ts` runs the real GROQ
// on `groq-js` over one matrix and holds `mayRead` equal to it on every pair.

import { operationalClient } from "@/sanity/lib/operationalClient";
import { LEVELED_MINISTRY_IDS, isGroupId, type MinistryId } from "@/app/ministries";
import type { MemberAccess } from "./memberAccess";
import { groupsIn, isMinistryManager, isMinistryMember, ledGroupsIn } from "./ministryAccess";
import { lessonOf, type Lesson } from "./ministryLesson";

export const MINISTRY_EVENT_TYPE = "ministryEvent";

/** `member`: the pages a pastor sees. `editor`: the planner (admins everything, leaders the drafts of the groups they lead). */
export type MinistryEventMode = "member" | "editor";

/** No read token: the dotted ids would read as «no events» with no error, so the reader refuses. */
export class MinistryEventReadUnavailable extends Error {
  constructor() {
    super("ministry event reads need SANITY_API_READ_TOKEN");
    this.name = "MinistryEventReadUnavailable";
  }
}

/** A stored event as `mayRead` judges it — only the fields access depends on. */
export type StoredMinistryEvent = {
  _id?: unknown;
  _type?: unknown;
  ministry?: unknown;
  audience?: unknown;
  published?: unknown;
};

type Access = Pick<MemberAccess, "active" | "role" | "ministries" | "managesMinistries" | "ministryRoles">;

/** Which arm a person reads through, or `null` for none (no query at all). */
type Arm = { kind: "all" } | { kind: "member"; groups: string[] } | { kind: "leader"; groups: string[]; led: string[] };

function armFor(access: Access, ministry: MinistryId, mode: MinistryEventMode): Arm | null {
  if (!access.active) return null;
  if (!LEVELED_MINISTRY_IDS.includes(ministry)) return null;
  if (!isMinistryMember(access, ministry)) return null;
  const groups = groupsIn(access, ministry).filter((g) => isGroupId(ministry, g));
  if (mode === "member") return { kind: "member", groups };
  if (isMinistryManager(access, ministry)) return { kind: "all" };
  // The leader arm: every group they are IN for published meetings, only the groups they LEAD for
  // drafts (plan 2026-11-11 §5.1). A `leader` who leads no group is, here, a member: no editor read.
  const led = ledGroupsIn(access, ministry);
  if (led.length > 0) return { kind: "leader", groups, led };
  return null;
}

// ── The GROQ ────────────────────────────────────────────────────────────────

const BASE =
  `_type == "${MINISTRY_EVENT_TYPE}" && _id in path("${MINISTRY_EVENT_TYPE}.*") && ministry == $ministry` +
  ` && date >= $from && date <= $to`;
const MEMBER_ARM =
  `published == true && (audience.kind == "ministry" || (audience.kind == "groups" && count(audience.groups[@ in $groups]) > 0))`;
const LEADER_DRAFT_ARM =
  `published != true && audience.kind == "groups" && count(audience.groups[@ in $led]) > 0`;

// A person is drawn from the ONE profile every ministry shares (`teamMembers`): the alias when
// there is one, and the photo `/me` shows (the upload over the Google one). Both are read through
// the seat's own reference, so the read gains a field of somebody it already names, never a person
// or a meeting (ADR-0081). A typed name has no member, so it has no photo.
const MEMBER_PHOTO = `"photo": member->{ "p": coalesce(profilePhoto.asset->url, googlePhotoUrl) }.p`;
const PERSON = `"memberId": member._ref, "name": member->{ "n": coalesce(alias, member_name) }.n, ${MEMBER_PHOTO}, "mine": member._ref == $me`;
// A seat holds a member OR a typed name (plan 2026-11-10 P2): the member's live name wins, else
// the seat's own text. Program lines keep members only, so they keep PERSON.
const SEAT_PERSON =
  `"memberId": member._ref, "name": coalesce(member->{ "n": coalesce(alias, member_name) }.n, name), ${MEMBER_PHOTO}, "mine": member._ref == $me`;
const PROJECTION = `{
  _id,
  _rev,
  ministry,
  audience,
  kind,
  date,
  time,
  arrival,
  title,
  notes,
  place,
  lesson,
  "published": coalesce(published, false),
  "seats": seats[]{ _key, role, ${SEAT_PERSON} },
  "program": program[]{ _key, label, note, ${PERSON} },
  "createdById": createdBy._ref,
  "createdByName": createdBy->{ "n": coalesce(alias, member_name) }.n
}`;

export type MinistryEventQuery = { query: string; params: Record<string, unknown> };

/**
 * The query and parameters a person's read runs, or `null` when they read nothing (inactive, not a
 * member, not a leveled ministry, or editor mode without a planner level) — the caller then returns
 * `[]` with no I/O. Exported for the shape and isolation tests.
 */
export function buildMinistryEventQuery(
  access: Access,
  opts: { me: string; ministry: MinistryId; from: string; to: string; mode: MinistryEventMode },
): MinistryEventQuery | null {
  const arm = armFor(access, opts.ministry, opts.mode);
  if (!arm) return null;
  const params: Record<string, unknown> = { ministry: opts.ministry, from: opts.from, to: opts.to, me: opts.me };
  let filter = BASE;
  if (arm.kind === "member") {
    filter += ` && (${MEMBER_ARM})`;
    params.groups = arm.groups;
  } else if (arm.kind === "leader") {
    filter += ` && ((${MEMBER_ARM}) || (${LEADER_DRAFT_ARM}))`;
    params.groups = arm.groups;
    params.led = arm.led;
  }
  return { query: `*[${filter}] | order(date asc, time asc) ${PROJECTION}`, params };
}

// ── The same rule in TypeScript ─────────────────────────────────────────────

/** Content Lake's `path("ministryEvent.*")`: the literal prefix and ONE segment with no dot after it.
 *  (groq-js does not escape the `.`, so it also matches `ministryEvent-x`; Content Lake does not.) */
function hasEventId(id: unknown): boolean {
  return typeof id === "string" && /^ministryEvent\.[^.]+$/.test(id);
}

function plainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function overlaps(groups: unknown, mine: readonly string[]): boolean {
  return Array.isArray(groups) && groups.some((g) => typeof g === "string" && mine.includes(g));
}

function memberSees(event: StoredMinistryEvent, groups: readonly string[]): boolean {
  if (event.published !== true || !plainObject(event.audience)) return false;
  const { kind } = event.audience;
  return kind === "ministry" || (kind === "groups" && overlaps(event.audience.groups, groups));
}

/**
 * Whether this person may read this stored event in this mode — the GROQ above, minus the date
 * window (a page range, not access). Held equal to the GROQ by the isolation test.
 */
export function mayRead(access: Access, event: StoredMinistryEvent, mode: MinistryEventMode, ministry: MinistryId = "jovenes"): boolean {
  const arm = armFor(access, ministry, mode);
  if (!arm) return false;
  if (event._type !== MINISTRY_EVENT_TYPE || !hasEventId(event._id) || event.ministry !== ministry) return false;
  if (arm.kind === "all") return true;
  if (memberSees(event, arm.groups)) return true;
  if (arm.kind !== "leader") return false;
  return (
    event.published !== true &&
    plainObject(event.audience) &&
    event.audience.kind === "groups" &&
    overlaps(event.audience.groups, arm.led)
  );
}

// ── The read ────────────────────────────────────────────────────────────────

export type MinistryEventPerson = {
  _key: string;
  memberId: string | null;
  name: string | null;
  /** The member's profile photo URL, or null (no photo, a typed name, a member who is gone). */
  photo: string | null;
  mine: boolean;
};
export type MinistryEventSeat = MinistryEventPerson & { role: string | null };
export type MinistryEventLine = MinistryEventPerson & { label: string | null; note: string | null };

export type MinistryEventView = {
  _id: string;
  /** The revision an editor sends back as `_rev`; a write is refused (409) when it moved. */
  rev: string | null;
  ministry: string;
  audience: { kind: "ministry" } | { kind: "groups"; groups: string[] } | null;
  kind: string | null;
  date: string;
  time: string | null;
  arrival: string | null;
  title: string | null;
  notes: string | null;
  /** Where it happens («Oasis Tlalpan»), display only. */
  place: string | null;
  /** A group's class (plan 2026-11-12 L0): only on a one-group meeting with a valid lesson. */
  lesson: Lesson | null;
  published: boolean;
  /** A seat's `name` is its member's live name, or — with `memberId` null — a typed name. */
  seats: MinistryEventSeat[];
  program: MinistryEventLine[];
  createdById: string | null;
  createdByName: string | null;
};

type RawPerson = { _key?: unknown; memberId?: unknown; name?: unknown; photo?: unknown; mine?: unknown };

const str = (x: unknown): string | null => (typeof x === "string" && x.trim() ? x : null);

function person(p: RawPerson, i: number): MinistryEventPerson {
  return {
    _key: str(p._key) ?? `i${i}`,
    memberId: str(p.memberId),
    name: str(p.name),
    photo: str(p.photo),
    mine: p.mine === true,
  };
}

function audienceOf(x: unknown): MinistryEventView["audience"] {
  if (!plainObject(x)) return null;
  if (x.kind === "ministry") return { kind: "ministry" };
  if (x.kind === "groups" && Array.isArray(x.groups)) {
    return { kind: "groups", groups: x.groups.filter((g): g is string => typeof g === "string") };
  }
  return null;
}

function viewOf(row: Record<string, unknown>): MinistryEventView | null {
  const date = typeof row.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(row.date) ? row.date : null;
  if (!date || typeof row._id !== "string") return null;
  const seats = Array.isArray(row.seats) ? row.seats : [];
  const program = Array.isArray(row.program) ? row.program : [];
  return {
    _id: row._id,
    rev: str(row._rev),
    ministry: String(row.ministry),
    audience: audienceOf(row.audience),
    kind: str(row.kind),
    date,
    time: str(row.time),
    arrival: str(row.arrival),
    title: str(row.title),
    notes: str(row.notes),
    place: str(row.place),
    lesson: lessonOf(row.audience, row.lesson),
    published: row.published === true,
    seats: seats.filter(plainObject).map((s, i) => ({ ...person(s as RawPerson, i), role: str(s.role) })),
    program: program
      .filter(plainObject)
      .map((l, i) => ({ ...person(l as RawPerson, i), label: str(l.label), note: str(l.note) })),
    createdById: str(row.createdById),
    createdByName: str(row.createdByName),
  };
}

/**
 * A person's meetings of one ministry between two `YYYY-MM-DD` dates, by `mode`. `access` is the
 * page's snapshot (≤ 30 s, like every guard); `me` the session's effective member id, for «mine».
 * Throws `MinistryEventReadUnavailable` without the read token. Never cache the result across people.
 */
export async function readMinistryEvents(
  access: Access,
  opts: { me: string; ministry: MinistryId; from: string; to: string; mode: MinistryEventMode },
): Promise<MinistryEventView[]> {
  const built = buildMinistryEventQuery(access, opts);
  if (!built) return [];
  if (!process.env.SANITY_API_READ_TOKEN) throw new MinistryEventReadUnavailable();
  const rows = await operationalClient.fetch<unknown>(built.query, built.params);
  return (Array.isArray(rows) ? rows : [])
    .filter(plainObject)
    .map(viewOf)
    .filter((v): v is MinistryEventView => v !== null);
}
