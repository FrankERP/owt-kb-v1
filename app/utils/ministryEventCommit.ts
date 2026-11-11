import "server-only";

// THE ONE WRITER of `ministryEvent` (ADR-0081; plan
// `docs/superpowers/plans/2026-10-30-jovenes-events-access.md` §5, W1–W9). Its four routes
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

import { randomUUID } from "node:crypto";
import { writeClient } from "@/sanity/lib/serverClient";
import { operationalClient } from "@/sanity/lib/operationalClient";
import { LEVELED_MINISTRY_IDS, isGroupId, type MinistryId } from "@/app/ministries";
import { accessFromDoc, fetchMemberAccessFresh, type MemberAccess, type MemberAccessDoc } from "./memberAccess";
import { groupsIn, isMinistryManager, ledGroupsIn } from "./ministryAccess";
import { MINISTRY_EVENT_TYPE, MinistryEventReadUnavailable, mayRead, type StoredMinistryEvent } from "./ministryEventReads";
import { isServiceTime } from "./serviceTime";
import { revalidateMinistryViews } from "./revalidate";
import { sanityConflictKind } from "./roleWriteRequest";
import type { CommitOutcome } from "./commitOutcome";

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
  invalidMember: "invalid_member",
  alreadyCreated: "already_created",
  inactive: "Tu acceso no está activo.",
  notFound: "Ese evento no existe.",
  createForbidden: "No puedes crear este evento.",
  forbidden: "No puedes editar este evento.",
  programForbidden: "No puedes editar el programa de este evento.",
  stale: "Alguien más cambió este evento; recarga.",
} as const;

export const SEAT_ROLES = ["encargado", "apoyo", "comparte"] as const;
export type SeatRole = (typeof SEAT_ROLES)[number];
/** The seats that may write a whole-ministry meeting's program (W3). */
const PROGRAM_SEATS: readonly string[] = ["encargado", "apoyo"];

export const LIMITS = { seats: 6, lines: 20, label: 60, note: 300, title: 80, notes: 2000, place: 120, name: 60 } as const;

export type EventAudience = { kind: "ministry" } | { kind: "groups"; groups: string[] };
export type EventEffects = { id: string; rev: string | null };

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
export type LineIn = { key: string | null; label: string; member: string | null; note: string | null };

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
  const out: LineIn[] = [];
  for (const item of raw) {
    if (!plainObject(item)) return refuse(400, EVENT_ERROR.invalidProgram);
    const key = optionalKey(item._key);
    const member = optionalMember(item.member);
    const label = optionalText(item.label, LIMITS.label);
    const note = optionalText(item.note, LIMITS.note);
    if (key === undefined || member === undefined || !label || note === undefined) {
      return refuse(400, EVENT_ERROR.invalidProgram);
    }
    out.push({ key, label, member, note });
  }
  return duplicateKeys(out) ? refuse(400, EVENT_ERROR.duplicateKey) : out;
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

// ── The stored event (step 3) ───────────────────────────────────────────────

type StoredRow = StoredMinistryEvent & {
  _id: string;
  _rev: string;
  kind?: unknown;
  seats?: unknown;
  program?: unknown;
  createdBy?: string | null;
};

const STORED_QUERY =
  `*[_type == "${MINISTRY_EVENT_TYPE}" && _id in path("${MINISTRY_EVENT_TYPE}.*") && ministry == $ministry && _id == $id][0]` +
  `{ _id, _rev, _type, ministry, audience, kind, published, seats, program, "createdBy": createdBy._ref }`;

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

type StoredItem = { _key: string; member: string | null; role?: string };

function storedItems(raw: unknown): StoredItem[] {
  return (Array.isArray(raw) ? raw : [])
    .filter(plainObject)
    .filter((i): i is Record<string, unknown> & { _key: string } => typeof i._key === "string")
    .map((i) => ({ _key: i._key, member: refOf(i.member), role: typeof i.role === "string" ? i.role : undefined }));
}

/**
 * W4/W5 keys: an item whose `_key` names a stored item keeps it; any other gets a fresh one. An
 * item is KEPT (its person not re-validated) when its key, person and — for a seat — role are the
 * stored ones. Returns the items with final keys and the people the write adds or changes.
 */
function reconcile<T extends { key: string | null; member: string | null; role?: string }>(
  incoming: T[],
  stored: StoredItem[],
): { items: (T & { finalKey: string })[]; added: string[] } {
  const byKey = new Map(stored.map((s) => [s._key, s]));
  const added = new Set<string>();
  const items = incoming.map((item) => {
    const prior = item.key ? byKey.get(item.key) : undefined;
    const kept = !!prior && prior.member === item.member && (item.role === undefined || prior.role === item.role);
    if (!kept && item.member) added.add(item.member);
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
const lineDoc = (l: LineIn & { finalKey: string }) => ({
  _key: l.finalKey,
  _type: "ministryEventProgramLine",
  label: l.label,
  ...(l.member ? { member: weakRef(l.member) } : {}),
  ...(l.note ? { note: l.note } : {}),
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

const ok = (id: string, rev: string | null): CommitOutcome<EventEffects> => ({
  ok: true,
  status: 200,
  body: { ok: true, id, rev },
  effects: { id, rev },
});

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
    seats: seats.items.map(seatDoc),
    program: program.items.map(lineDoc),
    published: edit.published ?? false,
    // Written once, from the FRESH actor id, never from a body (W1, W3).
    createdBy: weakRef(actor.id),
  };
  try {
    const created = await writeClient.create(doc);
    revalidateMinistryViews(ministry);
    return ok(id, typeof created?._rev === "string" ? created._rev : null);
  } catch (err) {
    if (sanityConflictKind(err) !== "already_exists") throw err;
    // A retry or double tap of the same token: «already created» only to someone who may read it.
    const stored = await readStored(id, ministry);
    if (stored && readable(actor, stored, ministry)) return refuse(409, EVENT_ERROR.alreadyCreated, { id });
    return refuse(404, EVENT_ERROR.notFound);
  }
}

// ── Edit, publish ───────────────────────────────────────────────────────────

const EDITABLE = ["audience", "kind", "date", "time", "arrival", "title", "notes", "place", "published", "seats", "program"];

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
  if (edit.seats) {
    const r = reconcile(edit.seats, storedItems(stored.seats));
    set.seats = r.items.map(seatDoc);
    added.push(...r.added);
  }
  if (edit.program) {
    const r = reconcile(edit.program, storedItems(stored.program));
    set.program = r.items.map(lineDoc);
    added.push(...r.added);
  }
  if (!(await peopleFit([...new Set(added)], ministry, resulting))) return refuse(400, EVENT_ERROR.invalidMember);

  try {
    let patch = writeClient.patch(id).ifRevisionId(rev).set(set);
    if (unset.length) patch = patch.unset(unset);
    const written = await patch.commit();
    revalidateMinistryViews(ministry);
    return ok(id, typeof written?._rev === "string" ? written._rev : null);
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

  const audience = parseAudience(stored.audience, ministry);
  const r = reconcile(lines, storedItems(stored.program));
  // A malformed stored audience admits no new person; kept lines still save.
  if (r.added.length && (!audience || !(await peopleFit(r.added, ministry, audience)))) {
    return refuse(400, EVENT_ERROR.invalidMember);
  }

  try {
    const written = await writeClient.patch(id).ifRevisionId(rev).set({ program: r.items.map(lineDoc) }).commit();
    revalidateMinistryViews(ministry);
    return ok(id, typeof written?._rev === "string" ? written._rev : null);
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

  try {
    // `delete` takes no revision precondition: a revision-asserting no-op patch and the delete in
    // ONE transaction (the fairness executor's guarded delete).
    await writeClient
      .transaction()
      .patch(id, (p) => p.ifRevisionId(rev).set({ ministry }))
      .delete(id)
      .commit();
    revalidateMinistryViews(ministry);
    return ok(id, null);
  } catch (err) {
    if (!revisionConflict(err)) throw err;
    return refuse(409, EVENT_ERROR.stale);
  }
}
