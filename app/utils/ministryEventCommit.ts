import "server-only";

// THE ONE WRITER of `ministryEvent` (ADR-0081; plan
// `docs/superpowers/plans/2026-10-30-jovenes-events-access.md` §5, W1–W9; the fixed parts and W10
// «Mi parte», ADR-0089, plan `2026-11-17-jovenes-meeting-parts.md` §4). Its routes
// (`/api/ministries/[ministry]/events…`) check the session and the rollout, parse JSON and call
// these; nothing else imports this module (`serviceCommitCallers.test.ts`; MCP and the admin
// assistant are refused by `ministryEventCoverage.test.ts`).
//
// Every write, in ONE order of refusals (W2), so a refusal never tells a person anything they
// could not read:
//   1. the body's shape (400) — depends on no document;
//   2. the actor's FRESH access (W1): inactive or missing ⇒ 403, whatever the role;
//   3. the stored event, read under R1's identity filters: missing, foreign or unreadable to the
//      actor in BOTH modes ⇒ 404 «Ese evento no existe.», as if it did not exist;
//   4. who may write what (W3/W3a) ⇒ 403;
//   5. the client's revision against the stored one (W2a) ⇒ 409.
// People are validated only where the write adds or changes them (W5), so an old meeting that
// names someone who has left stays editable. A seat may instead hold a typed name (someone with
// no account, or the group that hosts): that is text, never a person, so it is never validated,
// is never «Tú» and grants no program right (plan `2026-11-10-jovenes-place-and-names.md`). Every member reference is stored WEAK (D4). Every
// write answers `{ ok, id, rev }` and nothing of the meeting (W3b); the screen re-reads through R1.
//
// EMAILS (ADR-0089, M5). The writer sends nothing itself. It COMPUTES what a write owes — who it
// newly assigns, a request for the worship team that appeared or went away — from the row it read
// BEFORE its commit and the fields it stores, and hands that back as `effects.notices`; the route
// sends it in `after()` (`ministryEventNotify.ts`). Nothing is re-read after the commit: the
// revision the write asserts is what makes «before» exact. A group's CLASSES owe their holders the
// same way (`effects.classNotices`, `ministryLessonNotices.ts`; ADR-0089, addendum of 2026-11-25):
// a create, an edit, a delete, «Recorrer» and «Cambiar con…» compute who of them it changed.

import { randomUUID } from "node:crypto";
import { writeClient } from "@/sanity/lib/serverClient";
import { operationalClient } from "@/sanity/lib/operationalClient";
import { LEVELED_MINISTRY_IDS, isGroupId, type MinistryId } from "@/app/ministries";
import { accessFromDoc, fetchMemberAccessFresh, type MemberAccess, type MemberAccessDoc } from "./memberAccess";
import { groupsIn, isMinistryManager, ledGroupsIn } from "./ministryAccess";
import { MINISTRY_EVENT_TYPE, MinistryEventReadUnavailable, mayRead, type StoredMinistryEvent } from "./ministryEventReads";
import { isServiceTime } from "./serviceTime";
import { NO_CLASS_TITLE, SHIFT_DONE_WORDS, lessonDoc, lessonOf, parseLesson, shiftedDate, singleGroup, type Lesson } from "./ministryLesson";
import { revalidateMinistryViews } from "./revalidate";
import { sanityConflictKind } from "./roleWriteRequest";
import type { CommitOutcome } from "./commitOutcome";
import { PART_LIMITS, PLATICA_SEAT, isPartMusic, partSpec, type PartId, type PartMusic, type PartSpec } from "./ministryParts";
import { hasNotices, meetingNotices, snapshotOf, type EventNoticeEffects } from "./ministryEventNotices";
import { classNotices, classSnapOf, type ClassNoticeEffects } from "./ministryLessonNotices";

/** Every refusal, named. The Spanish ones reach a person; the codes reach the client's logic. */
export const EVENT_ERROR = {
  invalidBody: "invalid_body",
  revRequired: "rev_required",
  duplicateKey: "duplicate_key",
  nothingToUpdate: "nothing_to_update",
  invalidToken: "invalid_token",
  invalidAudience: "invalid_audience",
  invalidKind: "invalid_kind",
  invalidDate: "invalid_date",
  invalidTime: "invalid_time",
  invalidArrival: "invalid_arrival",
  invalidTitle: "invalid_title",
  invalidNotes: "invalid_notes",
  invalidPlace: "invalid_place",
  invalidPublished: "invalid_published",
  invalidSeats: "invalid_seats",
  invalidProgram: "invalid_program",
  invalidPart: "invalid_part",
  invalidLesson: "invalid_lesson",
  invalidShift: "invalid_shift",
  invalidSwap: "invalid_swap",
  shiftChanged: "El rol cambió mientras lo veías; recarga.",
  shiftDone: SHIFT_DONE_WORDS,
  invalidMember: "invalid_member",
  alreadyCreated: "already_created",
  inactive: "Tu acceso no está activo.",
  notFound: "Ese evento no existe.",
  createForbidden: "No puedes crear este evento.",
  forbidden: "No puedes editar este evento.",
  programForbidden: "No puedes editar el programa de este evento.",
  partForbidden: "No puedes editar esta parte.",
  stale: "Alguien más cambió este evento; recarga.",
} as const;

export const SEAT_ROLES = ["encargado", "apoyo", "comparte"] as const;
export type SeatRole = (typeof SEAT_ROLES)[number];
/** The seats that may write a whole-ministry meeting's program (W3). */
const PROGRAM_SEATS: readonly string[] = ["encargado", "apoyo"];

/** `note` is ONE number with a part's description (Frank: «unos 300 caracteres máximo»). */
export const LIMITS = { seats: 6, lines: 20, label: 60, note: PART_LIMITS.note, title: 80, notes: 2000, place: 120, name: 60 } as const;

export type EventAudience = { kind: "ministry" } | { kind: "groups"; groups: string[] };
/** `notices`: what the write owes by email (M5), or `null` — the route sends it in `after()`. */
/**
 * `notices`: what a write to a whole-ministry meeting owes (ADR-0089). `classNotices`: what a write
 * to a group's classes owes their holders (ADR-0089, addendum of 2026-11-25). Both sent by the route.
 */
export type EventEffects = {
  id: string;
  rev: string | null;
  notices: EventNoticeEffects | null;
  classNotices: ClassNoticeEffects | null;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const KEY = /^[A-Za-z0-9_-]{1,40}$/;
const MEMBER_ID = /^[A-Za-z0-9._-]{1,128}$/;
/** The routes pass the URL's token; the stored id is the dotted one minted from it. */
function eventIdOf(token: unknown): string | null {
  return typeof token === "string" && UUID.test(token) ? `${MINISTRY_EVENT_TYPE}.${token}` : null;
}

// ── Small helpers ───────────────────────────────────────────────────────────

type Refusal = { ok: false; status: number; body: Record<string, unknown> };
const refuse = (status: number, error: string, extra: Record<string, unknown> = {}): Refusal => ({
  ok: false,
  status,
  body: { error, ...extra },
});
const isRefusal = (x: unknown): x is Refusal =>
  typeof x === "object" && x !== null && (x as { ok?: unknown }).ok === false;

function fields(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
}
const has = (o: Record<string, unknown>, k: string) => Object.hasOwn(o, k);
const plainObject = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);
const weakRef = (id: string) => ({ _type: "reference", _ref: id, _weak: true });
const mintKey = () => randomUUID().replace(/-/g, "").slice(0, 12);

function ministryOf(raw: unknown): MinistryId | null {
  return typeof raw === "string" && (LEVELED_MINISTRY_IDS as string[]).includes(raw) ? (raw as MinistryId) : null;
}

function assertToken() {
  // W2: an untokened read of a dotted id answers null, which would surface as a misleading 404.
  if (!process.env.SANITY_API_READ_TOKEN) throw new MinistryEventReadUnavailable();
}

// ── Body parsing (pure; step 1) ─────────────────────────────────────────────

export function parseAudience(raw: unknown, ministry: MinistryId): EventAudience | null {
  if (!plainObject(raw)) return null;
  if (raw.kind === "ministry") {
    // A whole-ministry audience carries no `groups`, so «malformed» stays a write-time refusal (W5).
    return has(raw, "groups") ? null : { kind: "ministry" };
  }
  if (raw.kind !== "groups" || !Array.isArray(raw.groups)) return null;
  const groups = raw.groups;
  if (groups.length < 1 || groups.length > 3) return null;
  if (!groups.every((g) => isGroupId(ministry, g))) return null;
  if (new Set(groups).size !== groups.length) return null;
  return { kind: "groups", groups: groups as string[] };
}

/** `YYYY-MM-DD` that is a real calendar day. */
function isIsoDate(v: unknown): v is string {
  if (typeof v !== "string" || !ISO_DATE.test(v)) return false;
  const d = new Date(v + "T12:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** An optional text: absent/null/blank ⇒ null; too long or not a string ⇒ undefined (refused). */
function optionalText(v: unknown, max: number): string | null | undefined {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  if (!t) return null;
  return t.length <= max ? t : undefined;
}

/** A one-line optional text (a place, a typed name): `optionalText` that also refuses a line
 *  break, because the WhatsApp copy gives each field one line. */
function optionalLine(v: unknown, max: number): string | null | undefined {
  const t = optionalText(v, max);
  return typeof t === "string" && /[\r\n\u2028\u2029]/.test(t) ? undefined : t;
}

function optionalTime(v: unknown): string | null | undefined {
  if (v === undefined || v === null || v === "") return null;
  return isServiceTime(v) ? v : undefined;
}

function optionalMember(v: unknown): string | null | undefined {
  if (v === undefined || v === null || v === "") return null;
  return typeof v === "string" && MEMBER_ID.test(v) ? v : undefined;
}

function optionalKey(v: unknown): string | null | undefined {
  if (v === undefined || v === null) return null;
  return typeof v === "string" && KEY.test(v) ? v : undefined;
}

/** A seat holds a member, a typed name (someone without an account, or a hosting group), or
 *  nobody — never both (plan 2026-11-10 P2). A name is not a person: it is never validated. */
export type SeatIn = { key: string | null; role: SeatRole; member: string | null; name: string | null };
/**
 * A program line. A PART line (ADR-0089) carries `part`; its label is the table's, it may hold a
 * second person, and its responsable fills `note` (the description), `music` and `helpers`. A free
 * line has none of the three new fields.
 */
export type LineIn = {
  key: string | null;
  label: string;
  part: PartId | null;
  member: string | null;
  member2: string | null;
  note: string | null;
  music: PartMusic | null;
  helpers: string | null;
};

/** A part's `music`: none, or a known choice on a part that takes one. `undefined` ⇒ refused. */
function partMusic(v: unknown, spec: PartSpec): PartMusic | null | undefined {
  if (v === undefined || v === null || v === "") return null;
  return spec.music && isPartMusic(v) ? v : undefined;
}

/** A part's `helpers`: one line of names, only on a part that takes them. `undefined` ⇒ refused. */
function partHelpers(v: unknown, spec: PartSpec): string | null | undefined {
  const t = optionalLine(v, PART_LIMITS.helpers);
  return typeof t === "string" && !spec.helpers ? undefined : t;
}

function parseSeats(raw: unknown): SeatIn[] | Refusal {
  if (!Array.isArray(raw) || raw.length > LIMITS.seats) return refuse(400, EVENT_ERROR.invalidSeats);
  const out: SeatIn[] = [];
  for (const item of raw) {
    if (!plainObject(item)) return refuse(400, EVENT_ERROR.invalidSeats);
    const key = optionalKey(item._key);
    const member = optionalMember(item.member);
    const name = optionalLine(item.name, LIMITS.name);
    if (key === undefined || member === undefined || name === undefined) return refuse(400, EVENT_ERROR.invalidSeats);
    if (member && name) return refuse(400, EVENT_ERROR.invalidSeats);
    if (typeof item.role !== "string" || !(SEAT_ROLES as readonly string[]).includes(item.role)) {
      return refuse(400, EVENT_ERROR.invalidSeats);
    }
    out.push({ key, role: item.role as SeatRole, member, name });
  }
  return duplicateKeys(out) ? refuse(400, EVENT_ERROR.duplicateKey) : out;
}

export function parseProgram(raw: unknown): LineIn[] | Refusal {
  if (!Array.isArray(raw) || raw.length > LIMITS.lines) return refuse(400, EVENT_ERROR.invalidProgram);
  const bad = refuse(400, EVENT_ERROR.invalidProgram);
  const out: LineIn[] = [];
  const parts = new Set<PartId>();
  for (const item of raw) {
    if (!plainObject(item)) return bad;
    const key = optionalKey(item._key);
    const note = optionalText(item.note, LIMITS.note);
    const member = optionalMember(item.member);
    if (key === undefined || note === undefined || member === undefined) return bad;

    if (item.part === undefined || item.part === null) {
      // A free line: today's rules, and none of a part's fields (M2).
      const label = optionalText(item.label, LIMITS.label);
      if (!label) return bad;
      for (const k of ["member2", "music", "helpers"] as const) {
        if (item[k] !== undefined && item[k] !== null) return bad;
      }
      out.push({ key, label, part: null, member, member2: null, note, music: null, helpers: null });
      continue;
    }

    // A part line. The body's label is ignored: the stored one is the table's, so an older
    // reader, a rollback and the WhatsApp copy all still say «Oración».
    const spec = partSpec(item.part);
    const second = optionalMember(item.member2);
    if (!spec || second === undefined) return bad;
    if (member && member === second) return bad;
    const people = [member, second].filter((m): m is string => m !== null);
    // More people than the part holds: anyone on Plática (its people are the `comparte` seats),
    // two on Oración.
    if (people.length > spec.people) return bad;
    const music = partMusic(item.music, spec);
    const helpers = partHelpers(item.helpers, spec);
    if (music === undefined || helpers === undefined) return bad;
    if (parts.has(spec.id)) return bad;
    parts.add(spec.id);
    // A lone second person is stored as the first.
    out.push({ key, label: spec.label, part: spec.id, member: people[0] ?? null, member2: people[1] ?? null, note, music, helpers });
  }
  return duplicateKeys(out) ? refuse(400, EVENT_ERROR.duplicateKey) : out;
}

/**
 * M2a — a KEPT part line keeps what its responsable filled. An incoming line whose `_key` names a
 * stored line that carries a valid `part` must name that same part (so a body built by code that
 * does not know parts — a tab loaded before the deploy sends `_key, label, member, note` — can
 * never turn a part into a free line), and the stored `note`, `music` and `helpers` are written
 * back, each only while it still passes that part's rules; the body's values for those three are
 * ignored. W10 («Mi parte») is their only writer once the line exists. The body still decides the
 * line's people, which lines remain, and their order. Any other line is taken as parsed.
 *
 * Called after the 404, the 403 and the 409, beside the people check: a stale tab answers 409 first.
 */
function keepFilledParts(lines: LineIn[], storedProgram: unknown): LineIn[] | Refusal {
  const byKey = new Map<string, Record<string, unknown>>();
  for (const item of Array.isArray(storedProgram) ? storedProgram : []) {
    if (plainObject(item) && typeof item._key === "string" && !byKey.has(item._key)) byKey.set(item._key, item);
  }
  const out: LineIn[] = [];
  for (const line of lines) {
    const prior = line.key ? byKey.get(line.key) : undefined;
    const spec = prior ? partSpec(prior.part) : null;
    if (!prior || !spec) {
      out.push(line);
      continue;
    }
    if (line.part !== spec.id) return refuse(400, EVENT_ERROR.invalidProgram);
    out.push({
      ...line,
      note: optionalText(prior.note, LIMITS.note) ?? null,
      music: partMusic(prior.music, spec) ?? null,
      helpers: partHelpers(prior.helpers, spec) ?? null,
    });
  }
  return out;
}

function duplicateKeys(items: { key: string | null }[]): boolean {
  const keys = items.map((i) => i.key).filter((k): k is string => k !== null);
  return new Set(keys).size !== keys.length;
}

/** The editable fields a create or PATCH body carries, validated; absent fields stay absent. */
type Edit = {
  audience?: EventAudience;
  kind?: string;
  date?: string;
  time?: string | null;
  arrival?: string | null;
  title?: string | null;
  notes?: string | null;
  place?: string | null;
  published?: boolean;
  seats?: SeatIn[];
  program?: LineIn[];
  /** `null`: unset. Absent: untouched (plan 2026-11-12 L1). */
  lesson?: Lesson | null;
};

function parseEdit(body: Record<string, unknown>, ministry: MinistryId): Edit | Refusal {
  const edit: Edit = {};
  if (has(body, "audience")) {
    const a = parseAudience(body.audience, ministry);
    if (!a) return refuse(400, EVENT_ERROR.invalidAudience);
    edit.audience = a;
  }
  if (has(body, "kind")) {
    if (typeof body.kind !== "string") return refuse(400, EVENT_ERROR.invalidKind);
    edit.kind = body.kind;
  }
  if (has(body, "date")) {
    if (!isIsoDate(body.date)) return refuse(400, EVENT_ERROR.invalidDate);
    edit.date = body.date;
  }
  if (has(body, "time")) {
    const t = optionalTime(body.time);
    if (t === undefined) return refuse(400, EVENT_ERROR.invalidTime);
    edit.time = t;
  }
  if (has(body, "arrival")) {
    const t = optionalTime(body.arrival);
    if (t === undefined) return refuse(400, EVENT_ERROR.invalidArrival);
    edit.arrival = t;
  }
  if (has(body, "title")) {
    const t = optionalText(body.title, LIMITS.title);
    if (t === undefined) return refuse(400, EVENT_ERROR.invalidTitle);
    edit.title = t;
  }
  if (has(body, "notes")) {
    const t = optionalText(body.notes, LIMITS.notes);
    if (t === undefined) return refuse(400, EVENT_ERROR.invalidNotes);
    edit.notes = t;
  }
  if (has(body, "place")) {
    const t = optionalLine(body.place, LIMITS.place);
    if (t === undefined) return refuse(400, EVENT_ERROR.invalidPlace);
    edit.place = t;
  }
  if (has(body, "published")) {
    if (typeof body.published !== "boolean") return refuse(400, EVENT_ERROR.invalidPublished);
    edit.published = body.published;
  }
  if (has(body, "seats")) {
    const s = parseSeats(body.seats);
    if (isRefusal(s)) return s;
    edit.seats = s;
  }
  if (has(body, "program")) {
    const p = parseProgram(body.program);
    if (isRefusal(p)) return p;
    edit.program = p;
  }
  if (has(body, "lesson")) {
    if (body.lesson === null) edit.lesson = null;
    else {
      // A request's roster name is trimmed first; everything else is the one stored-shape check.
      const raw = plainObject(body.lesson) && typeof body.lesson.series === "string"
        ? { ...body.lesson, series: body.lesson.series.trim() }
        : body.lesson;
      const l = parseLesson(raw);
      if (!l) return refuse(400, EVENT_ERROR.invalidLesson);
      edit.lesson = l;
    }
  }
  return edit;
}

/**
 * D3: the kind follows the audience. A `groups` audience's kind is derived (one group ⇒ `group`,
 * more ⇒ `joint`) and a different requested kind is refused; a whole-ministry audience is
 * `saturday` or `ministry`, the requested one, else the stored one, else `saturday`.
 */
export function resolveKind(audience: EventAudience, requested: string | undefined, stored: unknown): string | null {
  if (audience.kind === "groups") {
    const derived = audience.groups.length === 1 ? "group" : "joint";
    return requested === undefined || requested === derived ? derived : null;
  }
  const allowed = ["saturday", "ministry"];
  if (requested !== undefined) return allowed.includes(requested) ? requested : null;
  return typeof stored === "string" && allowed.includes(stored) ? stored : "saturday";
}

// ── Who may write (W3, W3a) ─────────────────────────────────────────────────

type Actor = { id: string; access: MemberAccess };

/** The groups the actor LEADS (per group, plan 2026-11-11 §5.1) — never every group they are in. */
function led(actor: Actor, ministry: MinistryId): string[] {
  return ledGroupsIn(actor.access, ministry);
}

/** A stored `groups` audience's distinct valid groups; `null` for anything else. */
function storedGroups(stored: StoredRow, ministry: MinistryId): string[] | null {
  const a = stored.audience;
  if (!plainObject(a) || a.kind !== "groups" || !Array.isArray(a.groups)) return null;
  return [...new Set(a.groups.filter((g): g is string => isGroupId(ministry, g)))];
}

/** W3: may this actor edit, publish or delete this STORED event? */
export function canWriteStored(actor: Actor, stored: StoredRow, ministry: MinistryId): boolean {
  if (isMinistryManager(actor.access, ministry)) return true;
  const mine = led(actor, ministry);
  if (mine.length === 0) return false;
  const groups = storedGroups(stored, ministry);
  if (!groups || groups.length === 0) return false;
  // One group: any leader of it. Joint: its creator, while they still lead one of its groups.
  if (groups.length === 1) return mine.includes(groups[0]);
  return stored.createdBy === actor.id && groups.some((g) => mine.includes(g));
}

/** W3: may this actor give an event THIS audience (create, or the result of an edit)? */
export function canSetAudience(actor: Actor, audience: EventAudience, ministry: MinistryId): boolean {
  if (isMinistryManager(actor.access, ministry)) return true;
  const mine = led(actor, ministry);
  return audience.kind === "groups" && audience.groups.some((g) => mine.includes(g));
}

/** W3a: a seat holder's program right — never outliving the right to read. */
function seatGrantsProgram(actor: Actor, stored: StoredRow): boolean {
  if (!plainObject(stored.audience) || stored.audience.kind !== "ministry") return false;
  const seats = Array.isArray(stored.seats) ? stored.seats : [];
  const seated = seats.some(
    (s) => plainObject(s) && PROGRAM_SEATS.includes(String(s.role)) && refOf(s.member) === actor.id,
  );
  return seated && mayRead(actor.access, stored, "member", ministryOf(stored.ministry) ?? "jovenes");
}

/**
 * W10: is the actor this part's RESPONSABLE on the stored meeting — and may they still read it as
 * a member? (Never a draft, never after leaving Jóvenes or the group: a seat is a reason to
 * write, never to read, as W3a.) Plática's responsables are the `comparte` seats; any other
 * part's are the people on the FIRST stored line of that part. A typed name is never a person.
 */
function partResponsable(actor: Actor, stored: StoredRow, ministry: MinistryId, part: PartId): boolean {
  if (!mayRead(actor.access, stored, "member", ministry)) return false;
  if (part === "platica") {
    const seats = Array.isArray(stored.seats) ? stored.seats : [];
    return seats.some((s) => plainObject(s) && s.role === PLATICA_SEAT && refOf(s.member) === actor.id);
  }
  const line = (Array.isArray(stored.program) ? stored.program : []).find((l) => plainObject(l) && partSpec(l.part)?.id === part);
  return plainObject(line) && (refOf(line.member) === actor.id || refOf(line.member2) === actor.id);
}

// ── The stored event (step 3) ───────────────────────────────────────────────

type StoredRow = StoredMinistryEvent & {
  _id: string;
  _rev: string;
  kind?: unknown;
  seats?: unknown;
  program?: unknown;
  createdBy?: string | null;
  date?: unknown;
  time?: unknown;
  arrival?: unknown;
  title?: unknown;
  place?: unknown;
  lesson?: unknown;
};

const STORED_QUERY =
  `*[_type == "${MINISTRY_EVENT_TYPE}" && _id in path("${MINISTRY_EVENT_TYPE}.*") && ministry == $ministry && _id == $id][0]` +
  `{ _id, _rev, _type, ministry, audience, kind, published, seats, program, date, time, arrival, title, place, lesson, "createdBy": createdBy._ref }`;

async function readStored(id: string, ministry: MinistryId): Promise<StoredRow | null> {
  const row = await operationalClient.fetch<StoredRow | null>(STORED_QUERY, { id, ministry });
  return row && typeof row._id === "string" && typeof row._rev === "string" ? row : null;
}

const readable = (actor: Actor, stored: StoredRow, ministry: MinistryId) =>
  mayRead(actor.access, stored, "editor", ministry) || mayRead(actor.access, stored, "member", ministry);

function refOf(x: unknown): string | null {
  return plainObject(x) && typeof x._ref === "string" ? x._ref : null;
}

// ── People (W5) ─────────────────────────────────────────────────────────────

type StoredItem = { _key: string; member: string | null; member2: string | null; role?: string };

function storedItems(raw: unknown): StoredItem[] {
  return (Array.isArray(raw) ? raw : [])
    .filter(plainObject)
    .filter((i): i is Record<string, unknown> & { _key: string } => typeof i._key === "string")
    .map((i) => ({
      _key: i._key,
      member: refOf(i.member),
      member2: refOf(i.member2),
      role: typeof i.role === "string" ? i.role : undefined,
    }));
}

/**
 * W4/W5 keys: an item whose `_key` names a stored item keeps it; any other gets a fresh one. A
 * person is KEPT (not re-validated) when the stored item with that key already holds them — on
 * either slot of a line (M3: swapping a part's two people re-validates nobody) — and, for a seat,
 * under the same role. Returns the items with final keys and the people the write adds or changes.
 */
function reconcile<T extends { key: string | null; member: string | null; member2?: string | null; role?: string }>(
  incoming: T[],
  stored: StoredItem[],
): { items: (T & { finalKey: string })[]; added: string[] } {
  const byKey = new Map(stored.map((s) => [s._key, s]));
  const added = new Set<string>();
  const items = incoming.map((item) => {
    const prior = item.key ? byKey.get(item.key) : undefined;
    const sameRole = !!prior && (item.role === undefined || prior.role === item.role);
    const had = sameRole && prior ? [prior.member, prior.member2] : [];
    for (const m of [item.member, item.member2 ?? null]) if (m && !had.includes(m)) added.add(m);
    return { ...item, finalKey: prior ? prior._key : mintKey() };
  });
  return { items, added: [...added] };
}

/** Every added person must be an active member of the ministry and, for groups, of one of them. */
async function peopleFit(ids: string[], ministry: MinistryId, audience: EventAudience): Promise<boolean> {
  if (ids.length === 0) return true;
  const docs = await operationalClient.fetch<MemberAccessDoc[] | null>(
    `*[_type == "teamMembers" && _id in $ids]{ _id, disabled, role, ministries, managesMinistries, ministryRoles }`,
    { ids },
  );
  const byId = new Map((Array.isArray(docs) ? docs : []).map((d) => [d._id, d]));
  return ids.every((id) => {
    const doc = byId.get(id);
    if (!doc) return false;
    const a = accessFromDoc(doc);
    if (!a.active || !a.ministries.includes(ministry)) return false;
    if (audience.kind === "ministry") return true;
    const mine = groupsIn(a, ministry);
    return audience.groups.some((g) => mine.includes(g));
  });
}

const seatDoc = (s: SeatIn & { finalKey: string }) => ({
  _key: s.finalKey,
  _type: "ministryEventSeat",
  role: s.role,
  ...(s.member ? { member: weakRef(s.member) } : {}),
  ...(s.name ? { name: s.name } : {}),
});
const LINE_TYPE = "ministryEventProgramLine";
const lineDoc = (l: LineIn & { finalKey: string }) => ({
  _key: l.finalKey,
  _type: LINE_TYPE,
  label: l.label,
  ...(l.part ? { part: l.part } : {}),
  ...(l.member ? { member: weakRef(l.member) } : {}),
  ...(l.member2 ? { member2: weakRef(l.member2) } : {}),
  ...(l.note ? { note: l.note } : {}),
  ...(l.music ? { music: l.music } : {}),
  ...(l.helpers ? { helpers: l.helpers } : {}),
});
const audienceDoc = (a: EventAudience) => (a.kind === "ministry" ? { kind: "ministry" } : { kind: "groups", groups: a.groups });

// ── Actor (step 2) ──────────────────────────────────────────────────────────

async function actorFor(actorId: string): Promise<Actor | Refusal> {
  const access = await fetchMemberAccessFresh(actorId);
  return access.active ? { id: actorId, access } : refuse(403, EVENT_ERROR.inactive);
}

function revisionConflict(err: unknown): boolean {
  const kind = sanityConflictKind(err);
  return kind === "revision_mismatch" || kind === "conflict";
}

const ok = (
  id: string,
  rev: string | null,
  notices: EventNoticeEffects | null = null,
  classes: ClassNoticeEffects | null = null,
): CommitOutcome<EventEffects> => ({
  ok: true,
  status: 200,
  body: { ok: true, id, rev },
  effects: { id, rev, notices, classNotices: classes },
});

// ── Notices (M5) ────────────────────────────────────────────────────────────

/** The fields of a meeting a notice reads: the stored row, or the same fields as a write stores them. */
type NoticeRow = {
  _id?: unknown;
  lesson?: unknown;
  audience?: unknown;
  published?: unknown;
  date?: unknown;
  seats?: unknown;
  program?: unknown;
  time?: unknown;
  arrival?: unknown;
  place?: unknown;
  title?: unknown;
  kind?: unknown;
};

const textOrNull = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/**
 * What this write owes by email, or `null`. `before` is the row read at step 3 — the state the
 * write replaces, guaranteed by `ifRevisionId` — or `null` for a create; `after` is what the write
 * stores. Pure: called BEFORE the commit and returned only when the commit succeeds. Only Jóvenes
 * announces (ADR-0089); the audience rules are `meetingNotices`'s, narrowed again by the sender.
 */
function noticesFor(
  ministry: MinistryId,
  actorId: string,
  id: string,
  before: NoticeRow | null,
  after: NoticeRow,
): EventNoticeEffects | null {
  if (ministry !== "jovenes") return null;
  const today = new Date().toLocaleDateString("sv", { timeZone: "America/Mexico_City" });
  const notices = meetingNotices(before ? snapshotOf(before) : null, snapshotOf(after), { actorId, today });
  if (!hasNotices(notices)) return null;
  return {
    ...notices,
    ministry,
    actorId,
    meeting: {
      id,
      date: textOrNull(after.date) ?? "",
      time: textOrNull(after.time),
      arrival: textOrNull(after.arrival),
      place: textOrNull(after.place),
      title: textOrNull(after.title),
      kind: textOrNull(after.kind),
    },
  };
}

/**
 * What a write owes the holders of the classes it touched, or `null`. `before`: the rows read
 * before the commit (none for a create); `after`: the same rows as the write stores them (none for
 * a delete). Pure, computed BEFORE the commit and returned only when it succeeds, like `noticesFor`.
 * Only Jóvenes has classes; the audience rules are `classNotices`'s, narrowed again by the sender.
 */
function classNoticesFor(ministry: MinistryId, actorId: string, before: NoticeRow[], after: NoticeRow[]): ClassNoticeEffects | null {
  if (ministry !== "jovenes") return null;
  const today = new Date().toLocaleDateString("sv", { timeZone: "America/Mexico_City" });
  const notices = classNotices(before.map(classSnapOf), after.map(classSnapOf), { actorId, today });
  return notices.length > 0 ? { ministry, actorId, notices } : null;
}

// ── Create ──────────────────────────────────────────────────────────────────

export async function createMinistryEvent(
  actorId: string,
  ministryRaw: unknown,
  raw: unknown,
): Promise<CommitOutcome<EventEffects>> {
  const ministry = ministryOf(ministryRaw);
  if (!ministry) return refuse(404, EVENT_ERROR.notFound);
  const body = fields(raw);
  if (!body) return refuse(400, EVENT_ERROR.invalidBody);
  // W6: the client's create token, a v4 UUID, lowercased so one UUID in two cases is one id.
  const token = typeof body.token === "string" ? body.token.toLowerCase() : "";
  if (!UUID.test(token)) return refuse(400, EVENT_ERROR.invalidToken);
  const edit = parseEdit(body, ministry);
  if (isRefusal(edit)) return edit;
  if (!edit.audience) return refuse(400, EVENT_ERROR.invalidAudience);
  if (!edit.date) return refuse(400, EVENT_ERROR.invalidDate);
  const kind = resolveKind(edit.audience, edit.kind, undefined);
  if (!kind) return refuse(400, EVENT_ERROR.invalidKind);

  assertToken();
  const actor = await actorFor(actorId);
  if (isRefusal(actor)) return actor;
  if (!canSetAudience(actor, edit.audience, ministry)) return refuse(403, EVENT_ERROR.createForbidden);
  // L0: a class belongs to ONE group (Frank, 2026-11-12: «Cada uno tiene clases aparte»).
  if (edit.lesson && singleGroup(edit.audience) === null) return refuse(400, EVENT_ERROR.invalidLesson);

  const seats = reconcile(edit.seats ?? [], []);
  const program = reconcile(edit.program ?? [], []);
  if (!(await peopleFit([...new Set([...seats.added, ...program.added])], ministry, edit.audience))) {
    return refuse(400, EVENT_ERROR.invalidMember);
  }

  const id = `${MINISTRY_EVENT_TYPE}.${token}`;
  const doc = {
    _id: id,
    _type: MINISTRY_EVENT_TYPE,
    ministry,
    audience: audienceDoc(edit.audience),
    kind,
    date: edit.date,
    ...(edit.time ? { time: edit.time } : {}),
    ...(edit.arrival ? { arrival: edit.arrival } : {}),
    ...(edit.title ? { title: edit.title } : {}),
    ...(edit.notes ? { notes: edit.notes } : {}),
    ...(edit.place ? { place: edit.place } : {}),
    ...(edit.lesson ? { lesson: lessonDoc(edit.lesson) } : {}),
    seats: seats.items.map(seatDoc),
    program: program.items.map(lineDoc),
    published: edit.published ?? false,
    // Written once, from the FRESH actor id, never from a body (W1, W3).
    createdBy: weakRef(actor.id),
  };
  const notices = noticesFor(ministry, actor.id, id, null, doc);
  // «Nuevo libro» creates a whole roster in a row (up to 60 classes) and says `announce: false`:
  // each holder hears about their class from the reminders instead of one email per class. A
  // client can only make a create quieter with it, never louder.
  const classes = body.announce === false ? null : classNoticesFor(ministry, actor.id, [], [doc]);
  try {
    const created = await writeClient.create(doc);
    revalidateMinistryViews(ministry);
    return ok(id, typeof created?._rev === "string" ? created._rev : null, notices, classes);
  } catch (err) {
    if (sanityConflictKind(err) !== "already_exists") throw err;
    // A retry or double tap of the same token: «already created» only to someone who may read it.
    const stored = await readStored(id, ministry);
    if (stored && readable(actor, stored, ministry)) return refuse(409, EVENT_ERROR.alreadyCreated, { id });
    return refuse(404, EVENT_ERROR.notFound);
  }
}

// ── Edit, publish ───────────────────────────────────────────────────────────

const EDITABLE = ["audience", "kind", "date", "time", "arrival", "title", "notes", "place", "published", "seats", "program", "lesson"];

export async function updateMinistryEvent(
  actorId: string,
  ministryRaw: unknown,
  tokenRaw: unknown,
  raw: unknown,
): Promise<CommitOutcome<EventEffects>> {
  const ministry = ministryOf(ministryRaw);
  const id = eventIdOf(tokenRaw);
  // A token the writer could not have minted names no event: 404 with no I/O.
  if (!ministry || !id) return refuse(404, EVENT_ERROR.notFound);
  const body = fields(raw);
  if (!body) return refuse(400, EVENT_ERROR.invalidBody);
  if (typeof body._rev !== "string" || !body._rev) return refuse(400, EVENT_ERROR.revRequired);
  const rev = body._rev;
  const edit = parseEdit(body, ministry);
  if (isRefusal(edit)) return edit;
  if (!EDITABLE.some((k) => has(body, k))) return refuse(400, EVENT_ERROR.nothingToUpdate);

  assertToken();
  const actor = await actorFor(actorId);
  if (isRefusal(actor)) return actor;
  const stored = await readStored(id, ministry);
  if (!stored || !readable(actor, stored, ministry)) return refuse(404, EVENT_ERROR.notFound);

  // The audience the event will have: the requested one, else the stored one (which must be
  // well-formed to be kept — a malformed stored audience is repaired by sending a new one).
  const resulting = edit.audience ?? parseAudience(stored.audience, ministry);
  if (!canWriteStored(actor, stored, ministry)) return refuse(403, EVENT_ERROR.forbidden);
  if (!resulting) return refuse(400, EVENT_ERROR.invalidAudience);
  if (!canSetAudience(actor, resulting, ministry)) return refuse(403, EVENT_ERROR.forbidden);
  // L2: a lesson is written only onto a one-group meeting (after the 404 and 403, before the 409).
  if (edit.lesson && singleGroup(resulting) === null) return refuse(400, EVENT_ERROR.invalidLesson);
  if (stored._rev !== rev) return refuse(409, EVENT_ERROR.stale);

  const kind = resolveKind(resulting, edit.kind, stored.kind);
  if (!kind) return refuse(400, EVENT_ERROR.invalidKind);

  const set: Record<string, unknown> = { audience: audienceDoc(resulting), kind };
  const unset: string[] = [];
  const added: string[] = [];
  for (const k of ["date", "time", "arrival", "title", "notes", "place", "published"] as const) {
    if (!has(body, k)) continue;
    const v = edit[k];
    if (v === null) unset.push(k);
    else set[k] = v;
  }
  if (edit.lesson) set.lesson = lessonDoc(edit.lesson);
  // `lesson: null` unsets it; and a meeting that ends up shared (or for all of Jóvenes) never keeps
  // one, so a lesson can never revive in another group's roster later (L2).
  else if (has(stored, "lesson") && stored.lesson != null && (edit.lesson === null || singleGroup(resulting) === null)) {
    unset.push("lesson");
  }
  if (edit.seats) {
    const r = reconcile(edit.seats, storedItems(stored.seats));
    set.seats = r.items.map(seatDoc);
    added.push(...r.added);
  }
  if (edit.program) {
    const lines = keepFilledParts(edit.program, stored.program);
    if (isRefusal(lines)) return lines;
    const r = reconcile(lines, storedItems(stored.program));
    set.program = r.items.map(lineDoc);
    added.push(...r.added);
  }
  if (!(await peopleFit([...new Set(added)], ministry, resulting))) return refuse(400, EVENT_ERROR.invalidMember);

  // What the meeting will be: the stored fields overlaid with this edit.
  const after: Record<string, unknown> = { ...stored, ...set };
  for (const k of unset) delete after[k];
  const notices = noticesFor(ministry, actor.id, id, stored, after);
  const classes = classNoticesFor(ministry, actor.id, [stored], [after]);

  try {
    let patch = writeClient.patch(id).ifRevisionId(rev).set(set);
    if (unset.length) patch = patch.unset(unset);
    const written = await patch.commit();
    revalidateMinistryViews(ministry);
    return ok(id, typeof written?._rev === "string" ? written._rev : null, notices, classes);
  } catch (err) {
    if (!revisionConflict(err)) throw err;
    return refuse(409, EVENT_ERROR.stale);
  }
}

// ── Program lines (W3a, W4) ─────────────────────────────────────────────────

export async function updateMinistryEventProgram(
  actorId: string,
  ministryRaw: unknown,
  tokenRaw: unknown,
  raw: unknown,
): Promise<CommitOutcome<EventEffects>> {
  const ministry = ministryOf(ministryRaw);
  const id = eventIdOf(tokenRaw);
  // A token the writer could not have minted names no event: 404 with no I/O.
  if (!ministry || !id) return refuse(404, EVENT_ERROR.notFound);
  const body = fields(raw);
  if (!body) return refuse(400, EVENT_ERROR.invalidBody);
  if (typeof body._rev !== "string" || !body._rev) return refuse(400, EVENT_ERROR.revRequired);
  const rev = body._rev;
  // W4: only `program` is read from the body; every other field is ignored, whatever it says.
  const lines = parseProgram(body.program);
  if (isRefusal(lines)) return lines;

  assertToken();
  const actor = await actorFor(actorId);
  if (isRefusal(actor)) return actor;
  const stored = await readStored(id, ministry);
  if (!stored || !readable(actor, stored, ministry)) return refuse(404, EVENT_ERROR.notFound);
  if (!canWriteStored(actor, stored, ministry) && !seatGrantsProgram(actor, stored)) {
    return refuse(403, EVENT_ERROR.programForbidden);
  }
  if (stored._rev !== rev) return refuse(409, EVENT_ERROR.stale);

  const kept = keepFilledParts(lines, stored.program);
  if (isRefusal(kept)) return kept;
  const audience = parseAudience(stored.audience, ministry);
  const r = reconcile(kept, storedItems(stored.program));
  // A malformed stored audience admits no new person; kept lines still save.
  if (r.added.length && (!audience || !(await peopleFit(r.added, ministry, audience)))) {
    return refuse(400, EVENT_ERROR.invalidMember);
  }

  const program = r.items.map(lineDoc);
  const notices = noticesFor(ministry, actor.id, id, stored, { ...stored, program });
  try {
    const written = await writeClient.patch(id).ifRevisionId(rev).set({ program }).commit();
    revalidateMinistryViews(ministry);
    return ok(id, typeof written?._rev === "string" ? written._rev : null, notices);
  } catch (err) {
    if (!revisionConflict(err)) throw err;
    return refuse(409, EVENT_ERROR.stale);
  }
}

// ── «Mi parte» (W10; ADR-0089) ──────────────────────────────────────────────

const PART_FIELDS = ["note", "music", "helpers"] as const;

/**
 * «Mi parte»: the responsable of ONE fixed part fills its description, its music choice and who
 * helps — and nothing else. Whoever may edit the meeting or its program may fill any part.
 *
 * The write sets ONLY `program`, rebuilt from the STORED raw items passed through untouched except
 * the target line, under the stored revision: the array written is the array read plus one change,
 * so it can never drop, reorder or reassign another person's line. It never writes seats, people
 * on a line, a label or `published`, whatever the body says.
 */
export async function updateMinistryEventPart(
  actorId: string,
  ministryRaw: unknown,
  tokenRaw: unknown,
  partRaw: unknown,
  raw: unknown,
): Promise<CommitOutcome<EventEffects>> {
  const ministry = ministryOf(ministryRaw);
  const id = eventIdOf(tokenRaw);
  const spec = partSpec(partRaw);
  // An unknown ministry, a token the writer could not have minted, or no such part: 404, no I/O.
  if (!ministry || !id || !spec) return refuse(404, EVENT_ERROR.notFound);
  const body = fields(raw);
  if (!body) return refuse(400, EVENT_ERROR.invalidBody);
  if (typeof body._rev !== "string" || !body._rev) return refuse(400, EVENT_ERROR.revRequired);
  const rev = body._rev;
  // Only these three are read. A KEY that is present is a change (`null` clears it); absent is untouched.
  const change: { note?: string | null; music?: PartMusic | null; helpers?: string | null } = {};
  if (has(body, "note")) {
    const note = optionalText(body.note, LIMITS.note);
    if (note === undefined) return refuse(400, EVENT_ERROR.invalidPart);
    change.note = note;
  }
  if (has(body, "music")) {
    const music = partMusic(body.music, spec);
    if (music === undefined) return refuse(400, EVENT_ERROR.invalidPart);
    change.music = music;
  }
  if (has(body, "helpers")) {
    const helpers = partHelpers(body.helpers, spec);
    if (helpers === undefined) return refuse(400, EVENT_ERROR.invalidPart);
    change.helpers = helpers;
  }
  if (!PART_FIELDS.some((k) => has(change, k))) return refuse(400, EVENT_ERROR.nothingToUpdate);

  assertToken();
  const actor = await actorFor(actorId);
  if (isRefusal(actor)) return actor;
  const stored = await readStored(id, ministry);
  if (!stored || !readable(actor, stored, ministry)) return refuse(404, EVENT_ERROR.notFound);
  if (
    !canWriteStored(actor, stored, ministry) &&
    !seatGrantsProgram(actor, stored) &&
    !partResponsable(actor, stored, ministry, spec.id)
  ) {
    return refuse(403, EVENT_ERROR.partForbidden);
  }
  if (stored._rev !== rev) return refuse(409, EVENT_ERROR.stale);

  const items: unknown[] = Array.isArray(stored.program) ? stored.program : [];
  const at = items.findIndex((l) => plainObject(l) && partSpec(l.part)?.id === spec.id);
  let program: unknown[];
  if (at >= 0) {
    const target: Record<string, unknown> = { ...(items[at] as Record<string, unknown>) };
    for (const k of PART_FIELDS) {
      if (!has(change, k)) continue;
      const v = change[k];
      if (v === null || v === undefined) delete target[k];
      else target[k] = v;
    }
    program = items.map((l, i) => (i === at ? target : l));
  } else {
    const filled = PART_FIELDS.flatMap((k) => (change[k] ? [[k, change[k]] as const] : []));
    // Nothing stored and nothing to store: the answer is the meeting as it is, with no write.
    if (filled.length === 0) return ok(id, stored._rev);
    if (items.length >= LIMITS.lines) return refuse(400, EVENT_ERROR.invalidProgram);
    program = [...items, { _key: mintKey(), _type: LINE_TYPE, label: spec.label, part: spec.id, ...Object.fromEntries(filled) }];
  }

  // A part write changes no person, so only a music change can owe a notice.
  const notices = noticesFor(ministry, actor.id, id, stored, { ...stored, program });
  try {
    const written = await writeClient.patch(id).ifRevisionId(rev).set({ program }).commit();
    revalidateMinistryViews(ministry);
    return ok(id, typeof written?._rev === "string" ? written._rev : null, notices);
  } catch (err) {
    if (!revisionConflict(err)) throw err;
    return refuse(409, EVENT_ERROR.stale);
  }
}

// ── Delete ──────────────────────────────────────────────────────────────────

export async function deleteMinistryEvent(
  actorId: string,
  ministryRaw: unknown,
  tokenRaw: unknown,
  raw: unknown,
): Promise<CommitOutcome<EventEffects>> {
  const ministry = ministryOf(ministryRaw);
  const id = eventIdOf(tokenRaw);
  // A token the writer could not have minted names no event: 404 with no I/O.
  if (!ministry || !id) return refuse(404, EVENT_ERROR.notFound);
  const body = fields(raw);
  if (!body) return refuse(400, EVENT_ERROR.invalidBody);
  if (typeof body._rev !== "string" || !body._rev) return refuse(400, EVENT_ERROR.revRequired);
  const rev = body._rev;

  assertToken();
  const actor = await actorFor(actorId);
  if (isRefusal(actor)) return actor;
  const stored = await readStored(id, ministry);
  if (!stored || !readable(actor, stored, ministry)) return refuse(404, EVENT_ERROR.notFound);
  if (!canWriteStored(actor, stored, ministry)) return refuse(403, EVENT_ERROR.forbidden);
  if (stored._rev !== rev) return refuse(409, EVENT_ERROR.stale);
  // A deleted class owes its holders a «ya no te toca» (ADR-0089, addendum of 2026-11-25).
  const classes = classNoticesFor(ministry, actor.id, [stored], []);

  try {
    // `delete` takes no revision precondition: a revision-asserting no-op patch and the delete in
    // ONE transaction (the fairness executor's guarded delete).
    await writeClient
      .transaction()
      .patch(id, (p) => p.ifRevisionId(rev).set({ ministry }))
      .delete(id)
      .commit();
    revalidateMinistryViews(ministry);
    return ok(id, null, null, classes);
  } catch (err) {
    if (!revisionConflict(err)) throw err;
    return refuse(409, EVENT_ERROR.stale);
  }
}

// ── «Recorrer» (plan 2026-11-12 L3) ─────────────────────────────────────────

/**
 * A roster holds at most this many rows (classes and «No hubo clase» gaps) from the anchor on. Twice
 * «Nuevo libro»'s 60 classes, so the largest book still shifts after it has gathered gaps.
 */
export const SHIFT_MAX_ROWS = 120;
const EVENT_ID = /^ministryEvent\.[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

type RosterRow = StoredMinistryEvent & {
  _id: string;
  _rev: string;
  date?: unknown;
  lesson?: unknown;
  seats?: unknown;
  title?: unknown;
  time?: unknown;
  place?: unknown;
  createdBy?: string | null;
};

// The writer's one other query shape (sanctioned by ADR-0081's 2026-11-12 addendum): R1's identity
// filters, ONE group the actor was already found to write, and its rows are never returned.
const ROSTER_QUERY =
  `*[_type == "${MINISTRY_EVENT_TYPE}" && _id in path("${MINISTRY_EVENT_TYPE}.*") && ministry == $ministry` +
  ` && audience.kind == "groups" && count(audience.groups) == 1 && audience.groups[0] == $group` +
  ` && lesson.series == $series && date >= $date]` +
  // `seats`, `title`, `time`, `place`: only for the holders' notices this write owes, never returned.
  `{ _id, _rev, _type, ministry, audience, published, date, lesson, seats, title, time, place, "createdBy": createdBy._ref }`;

function mapCommitConflict(err: unknown): Refusal {
  const kind = sanityConflictKind(err);
  // A revision that moved, or a marker id that already exists (a retry after a lost answer).
  if (kind === "revision_mismatch" || kind === "conflict" || kind === "already_exists") return refuse(409, EVENT_ERROR.stale);
  throw err;
}

/**
 * «Recorrer»: the class in `[token]` did not happen. Its date becomes a «No hubo clase» row (a
 * DRAFT, so no member view shows a cancelled Sunday as a meeting), and that class and every later
 * class of its roster move a week, hopping the roster's «No hubo clase» dates, which never move.
 * All or nothing, under every row's revision, and only when the rows are the ones the screen showed.
 */
export async function shiftMinistryLesson(
  actorId: string,
  ministryRaw: unknown,
  tokenRaw: unknown,
  raw: unknown,
): Promise<CommitOutcome<EventEffects & { moved: number }>> {
  const ministry = ministryOf(ministryRaw);
  const id = eventIdOf(tokenRaw);
  if (!ministry || !id) return refuse(404, EVENT_ERROR.notFound);
  const body = fields(raw);
  if (!body) return refuse(400, EVENT_ERROR.invalidBody);
  if (typeof body._rev !== "string" || !body._rev) return refuse(400, EVENT_ERROR.revRequired);
  const rev = body._rev;
  const markerToken = typeof body.token === "string" ? body.token.toLowerCase() : "";
  if (!UUID.test(markerToken)) return refuse(400, EVENT_ERROR.invalidToken);
  const ids = body.ids;
  if (
    !Array.isArray(ids) ||
    ids.length < 1 ||
    ids.length > SHIFT_MAX_ROWS ||
    !ids.every((x) => typeof x === "string" && EVENT_ID.test(x)) ||
    new Set(ids).size !== ids.length
  ) {
    return refuse(400, EVENT_ERROR.invalidShift);
  }

  assertToken();
  const actor = await actorFor(actorId);
  if (isRefusal(actor)) return actor;
  const anchor = await readStored(id, ministry);
  if (!anchor || !readable(actor, anchor, ministry)) return refuse(404, EVENT_ERROR.notFound);
  if (!canWriteStored(actor, anchor, ministry)) return refuse(403, EVENT_ERROR.forbidden);
  const group = singleGroup(anchor.audience);
  const lesson = lessonOf(anchor.audience, anchor.lesson);
  if (!group || !isGroupId(ministry, group) || !lesson || lesson.track === "sin_clase" || lesson.done) {
    return refuse(400, EVENT_ERROR.invalidShift);
  }
  if (typeof anchor.date !== "string" || !isIsoDate(anchor.date)) return refuse(400, EVENT_ERROR.invalidShift);
  if (anchor._rev !== rev) return refuse(409, EVENT_ERROR.stale);
  const anchorDate = anchor.date;

  const fetched = await operationalClient.fetch<RosterRow[] | null>(ROSTER_QUERY, {
    ministry,
    group,
    series: lesson.series,
    date: anchorDate,
  });
  // The TypeScript re-check: a row the query returned but L0 does not call this roster's is dropped.
  const rows = (Array.isArray(fetched) ? fetched : []).filter(
    (r) =>
      typeof r?._id === "string" &&
      typeof r._rev === "string" &&
      singleGroup(r.audience) === group &&
      typeof r.date === "string" &&
      isIsoDate(r.date) &&
      r.date >= anchorDate &&
      lessonOf(r.audience, r.lesson)?.series === lesson.series,
  );
  if (rows.length > SHIFT_MAX_ROWS) return refuse(400, EVENT_ERROR.invalidShift);
  const classes = rows.filter((r) => lessonOf(r.audience, r.lesson)?.track !== "sin_clase");
  const gaps = rows.filter((r) => lessonOf(r.audience, r.lesson)?.track === "sin_clase");
  const self = classes.find((r) => r._id === id);
  // The anchor moved between the first read and this one.
  if (!self || self._rev !== rev) return refuse(409, EVENT_ERROR.stale);
  const want = new Set(ids as string[]);
  if (classes.length !== want.size || !classes.every((r) => want.has(r._id))) return refuse(409, EVENT_ERROR.shiftChanged);
  if (classes.some((r) => lessonOf(r.audience, r.lesson)?.done)) return refuse(409, EVENT_ERROR.shiftDone);
  if (!rows.every((r) => canWriteStored(actor, r as StoredRow, ministry))) return refuse(403, EVENT_ERROR.forbidden);

  const gapDates = new Set<string>([anchorDate, ...gaps.map((g) => g.date as string)]);
  const markerId = `${MINISTRY_EVENT_TYPE}.${markerToken}`;
  let tx = writeClient.transaction();
  const moved: RosterRow[] = [];
  for (const r of classes) {
    const to = shiftedDate(r.date as string, gapDates);
    tx = tx.patch(r._id, (p) => p.ifRevisionId(r._rev).set({ date: to }));
    moved.push({ ...r, date: to });
  }
  // Every holder of a moved class hears once, with all of their new dates (the marker is a draft).
  const notices = classNoticesFor(ministry, actor.id, classes, moved);
  // A gap removed or re-dated after the read fails the whole write instead of being hopped blind.
  for (const g of gaps) tx = tx.patch(g._id, (p) => p.ifRevisionId(g._rev).set({ ministry }));
  tx = tx.create({
    _id: markerId,
    _type: MINISTRY_EVENT_TYPE,
    ministry,
    audience: { kind: "groups", groups: [group] },
    kind: "group",
    date: anchorDate,
    title: NO_CLASS_TITLE,
    lesson: lessonDoc({ series: lesson.series, track: "sin_clase", done: false }),
    seats: [],
    program: [],
    published: false,
    createdBy: weakRef(actor.id),
  });
  try {
    await tx.commit();
  } catch (err) {
    return mapCommitConflict(err);
  }
  revalidateMinistryViews(ministry);
  return {
    ok: true,
    status: 200,
    body: { ok: true, id, rev: null, moved: classes.length },
    effects: { id, rev: null, notices: null, classNotices: notices, moved: classes.length },
  };
}

// ── «Cambiar con…» (plan 2026-11-12 L4) ─────────────────────────────────────

type SeatOut = { _key: string; _type: "ministryEventSeat"; role: string; member?: ReturnType<typeof weakRef>; name?: string };

/** A stored seat array re-built as the writer writes seats, or `null` when any seat is malformed. */
function rebuildSeats(raw: unknown): { seats: SeatOut[]; members: string[] } | null {
  const seats: SeatOut[] = [];
  const members: string[] = [];
  for (const s of Array.isArray(raw) ? raw : []) {
    if (!plainObject(s) || typeof s._key !== "string" || !KEY.test(s._key)) return null;
    if (typeof s.role !== "string" || !(SEAT_ROLES as readonly string[]).includes(s.role)) return null;
    const member = s.member === undefined || s.member === null ? null : refOf(s.member);
    if (s.member !== undefined && s.member !== null && (!member || !MEMBER_ID.test(member))) return null;
    const name = s.name === undefined || s.name === null ? null : optionalLine(s.name, LIMITS.name);
    if (name === undefined) return null;
    if (member && name) return null;
    seats.push({
      _key: s._key,
      _type: "ministryEventSeat",
      role: s.role,
      ...(member ? { member: weakRef(member) } : {}),
      ...(name ? { name } : {}),
    });
    if (member) members.push(member);
  }
  return { seats, members };
}

/**
 * «Cambiar con…»: two classes of one group trade their people (Frank, 2026-11-12: «cuando alguien
 * cambia de clase con alguien, cambian de día y de capítulo»). Only `seats` move — every seat of
 * each — in one transaction under both revisions.
 */
export async function swapMinistryLessons(
  actorId: string,
  ministryRaw: unknown,
  tokenRaw: unknown,
  raw: unknown,
): Promise<CommitOutcome<EventEffects>> {
  const ministry = ministryOf(ministryRaw);
  const idA = eventIdOf(tokenRaw);
  if (!ministry || !idA) return refuse(404, EVENT_ERROR.notFound);
  const body = fields(raw);
  if (!body) return refuse(400, EVENT_ERROR.invalidBody);
  const other = fields(body.with);
  if (typeof body._rev !== "string" || !body._rev || !other || typeof other._rev !== "string" || !other._rev) {
    return refuse(400, EVENT_ERROR.revRequired);
  }
  const idB = eventIdOf(typeof other.token === "string" ? other.token.toLowerCase() : other.token);
  if (!idB || idB === idA) return refuse(400, EVENT_ERROR.invalidSwap);
  const revA = body._rev;
  const revB = other._rev;

  assertToken();
  const actor = await actorFor(actorId);
  if (isRefusal(actor)) return actor;
  const [a, b] = await Promise.all([readStored(idA, ministry), readStored(idB, ministry)]);
  if (!a || !b || !readable(actor, a, ministry) || !readable(actor, b, ministry)) return refuse(404, EVENT_ERROR.notFound);
  if (!canWriteStored(actor, a, ministry) || !canWriteStored(actor, b, ministry)) return refuse(403, EVENT_ERROR.forbidden);
  const group = singleGroup(a.audience);
  const la = lessonOf(a.audience, a.lesson);
  const lb = lessonOf(b.audience, b.lesson);
  const held = (l: Lesson | null) => !l || l.done || l.track === "sin_clase";
  // One roster only: a trade moves a responsable between two chapters of the same book (L4).
  if (!group || singleGroup(b.audience) !== group || held(la) || held(lb) || la!.series !== lb!.series) {
    return refuse(400, EVENT_ERROR.invalidSwap);
  }
  if (a._rev !== revA || b._rev !== revB) return refuse(409, EVENT_ERROR.stale);

  const sa = rebuildSeats(a.seats);
  const sb = rebuildSeats(b.seats);
  if (!sa || !sb) return refuse(400, EVENT_ERROR.invalidSwap);
  const moved = [...new Set([...sa.members, ...sb.members])];
  if (!(await peopleFit(moved, ministry, { kind: "groups", groups: [group] }))) return refuse(400, EVENT_ERROR.invalidMember);
  // Each holder hears what they gave and what they took, in one email.
  const classes = classNoticesFor(ministry, actor.id, [a, b], [{ ...a, seats: sb.seats }, { ...b, seats: sa.seats }]);

  try {
    await writeClient
      .transaction()
      .patch(idA, (p) => p.ifRevisionId(revA).set({ seats: sb.seats }))
      .patch(idB, (p) => p.ifRevisionId(revB).set({ seats: sa.seats }))
      .commit();
  } catch (err) {
    return mapCommitConflict(err);
  }
  revalidateMinistryViews(ministry);
  return ok(idA, null, null, classes);
}
