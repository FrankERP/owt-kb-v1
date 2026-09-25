// What `get_participation` reports (P1 step 6): the SAME aggregation the
// Servicios sidebar shows (`ParticipationSidebar` → `computeParticipation`),
// fed from the service snapshot's own roles and seat-referenced members. No
// I/O here: `computeParticipation` is called UNCHANGED, so its `especial`/
// `total` counts (A6), its week-deduped instrument/FOH counts and its "only a
// member holding a seat appears" rule are never re-derived.
//
// SIDEBAR PARITY — the finding this module rests on. `ServicesPanel.tsx` feeds
// `computeParticipation` every VISIBLE card's role, filtered by the role's OWN
// calendar date's month (`c.role.date.slice(0, 7)`; that `date` is the admin
// roles GET's `coalesce(week, date)` — the same value `storedRoleDate()`
// computes here from the canonical projection). `computeParticipation` itself
// buckets instrument/FOH seats by `serviceWeekKey`, which for a Saturday or a
// midweek special can fall in the FOLLOWING month — but that bucketing runs on
// whatever input set it is handed; it never re-filters by month itself. So
// matching the sidebar means matching its INPUT SET (services whose own date
// falls in the month), never its week-key output, and that is exactly what
// `participantRolesForMonth` does below: no neighbouring-month bleed either
// way.
//
// Unlike the admin roles GET (which drops a dangling seat reference silently,
// `Lead[defined(@->)]`), a seat referencing a member missing from `members`
// (below) is KEPT and counted — `computeParticipation` accumulates by `_id`
// regardless of whether a name resolved — and reported as `{ missing: true }`
// here, never dropped. A member seated on any role appears regardless of
// ministry (the I5 SEAT exception): this module applies no worship-audience
// filter at all, unlike `memberAvailabilityPresenter.ts`.
//
// NAMES COME FROM A LOOKUP, NOT DIRECTLY FROM `snapshot.membersById`, and this
// is deliberate, not a style choice: `membersById` is built by
// `collectRoleMemberRefs`, which SKIPS every ref on a role that fails
// `validateRole(...).groupable` — a role with one malformed seat group (a
// stored `null` where an array belongs) loses ALL its refs from that bulk
// read, valid seats included. Participation still counts that role (seat
// groups are coerced to `[]` independently per group, never all-or-nothing —
// see `toParticipantRole`), so a member whose ONLY seat that month sits on
// such a role would be wrongly reported `missing` despite having a real
// document. `get_service` already solves this the same way for a single
// service (`serviceContentIds` + `loadMemberNames`); `getParticipation.ts`
// does the same for the whole month before calling `presentParticipation`.

import { derivePublishState, type ServiceSourceKey } from "@/app/components/admin/serviceReadiness";
import {
  computeParticipation,
  type MemberParticipation,
  type ParticipantRole,
} from "@/app/utils/computeParticipation";
import { storedRoleDate } from "@/app/utils/roleWriteRequest";
import { compareServiceTime } from "@/app/utils/serviceTime";
import { failedSourcesOf, serviceKindOf, type ServiceKind } from "./servicePresenter";
import type { MemberNameLookup, ServiceSnapshot, SnapshotRow } from "./serviceSnapshot";

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object";
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

// ── Building `ParticipantRole[]` from the snapshot ──────────────────────────

type PersonRef = { _id: string };

function personRef(item: unknown): PersonRef | null {
  const id = isObj(item) && nonEmptyString(item._ref) ? item._ref : null;
  return id ? { _id: id } : null;
}

/** A bare-ref seat array (`Lead`/`BGVs`/`Chorus`): every entry WITH a reference, in order. An entry with no `_ref` at all carries no id to count under, so it is skipped — never invented, never dropped silently for any other reason. */
function seatRefsOf(value: unknown): PersonRef[] {
  const refs: PersonRef[] = [];
  for (const item of arr(value)) {
    const ref = personRef(item);
    if (ref) refs.push(ref);
  }
  return refs;
}

/** An `instruments`/`foh_team` slot: `{ person }`, `person: null` when the slot carries no reference. */
function personSlot(value: unknown): { person: PersonRef | null } {
  const holder = isObj(value) ? value.person : null;
  return { person: personRef(holder) };
}

/**
 * One canonical role row as `ParticipantRole`. `role._type` already names one
 * of the three role types — `canonicalRolesQuery()` scopes the read to them —
 * so the cast is a projection detail, never a role-type literal written here
 * (spec I2).
 */
function toParticipantRole(role: SnapshotRow): ParticipantRole | null {
  const date = storedRoleDate(role);
  if (!date) return null;
  return {
    _type: role._type as ParticipantRole["_type"],
    date,
    leads: seatRefsOf(role.Lead),
    bgvs: seatRefsOf(role.BGVs),
    chorus: seatRefsOf(role.Chorus),
    instruments: arr(role.instruments).map((item) => personSlot(item)),
    foh: arr(role.foh_team).map((item) => personSlot(item)),
  };
}

/** Every canonical role dated in `month` ("YYYY-MM") — the sidebar's own input set (see the header). */
export function participantRolesForMonth(snapshot: ServiceSnapshot, month: string): SnapshotRow[] {
  const prefix = `${month}-`;
  return snapshot.roles.filter((role) => {
    if (serviceKindOf(role._type) === null) return false;
    const date = storedRoleDate(role);
    return date !== null && date.startsWith(prefix);
  });
}

/**
 * `participantRolesForMonth`, shaped as `computeParticipation` takes it.
 * Exported so a test can call `computeParticipation` on EXACTLY the same input
 * this module feeds it, proving parity without re-deriving the function.
 */
export function buildParticipantRoles(snapshot: ServiceSnapshot, month: string): ParticipantRole[] {
  return participantRolesForMonth(snapshot, month)
    .map((role) => toParticipantRole(role))
    .filter((role): role is ParticipantRole => role !== null);
}

/**
 * Every member id a month's `ParticipantRole[]` names — every seat on every
 * role, regardless of that role's OWN validity (unlike
 * `collectRoleMemberRefs`, which a non-groupable role's refs never reach). The
 * caller feeds this to `loadMemberNames` alongside `snapshot.membersById`, so
 * a member seated only on a structurally invalid role still resolves.
 */
export function participantMemberIds(roles: readonly ParticipantRole[]): string[] {
  const ids = new Set<string>();
  for (const role of roles) {
    for (const m of role.leads) ids.add(m._id);
    for (const m of role.bgvs) ids.add(m._id);
    for (const m of role.chorus) ids.add(m._id);
    for (const s of role.instruments) if (s.person) ids.add(s.person._id);
    for (const s of role.foh) if (s.person) ids.add(s.person._id);
  }
  return [...ids];
}

// ── Presentation ─────────────────────────────────────────────────────────────

export type ParticipationEntry = Omit<MemberParticipation, "id" | "name"> & {
  memberId: string;
  name: string | null;
  /** This id resolved to no document in the member lookup (a dangling reference) — the lookup itself succeeded. Never dropped. */
  missing?: true;
  /** This id's name could not be resolved because a read it depended on failed — the bulk snapshot read, the supplementary lookup, or both (see the file header). Other members can still resolve in the same payload. */
  unresolved?: true;
};

export type ParticipationServiceEntry = {
  serviceId: string;
  date: string;
  kind: ServiceKind;
  /** Spec I3: `derivePublishState` — a missing field is a pre-draft service, published. */
  published: "draft" | "published";
};

export type GetParticipationPayload = {
  month: string;
  members: ParticipationEntry[];
  services: ParticipationServiceEntry[];
  notes?: string[];
  failedSources?: ServiceSourceKey[];
};

function serviceEntryOf(role: SnapshotRow): ParticipationServiceEntry | null {
  const kind = serviceKindOf(role._type);
  const date = storedRoleDate(role);
  if (!kind || !date || !nonEmptyString(role._id)) return null;
  return { serviceId: role._id, date, kind, published: derivePublishState(role.published) };
}

/** A special's `time`, or null for a weekend service or an absent one — the same value `servicePresenter.ts`'s `catalogue()` sorts by. */
function roleTime(role: SnapshotRow): string | null {
  return serviceKindOf(role._type) === "special" && nonEmptyString(role.time) ? role.time : null;
}

function compareRoleIds(a: SnapshotRow, b: SnapshotRow): number {
  const idA = nonEmptyString(a._id) ? a._id : "";
  const idB = nonEmptyString(b._id) ? b._id : "";
  return idA < idB ? -1 : idA > idB ? 1 : 0;
}

/** date, then `compareServiceTime`, then id — the SAME order `list_services` reports (`servicePresenter.ts`'s private `compareEntries`), so the two tools never disagree about which service comes first on a day with several. */
function compareServiceRoles(a: SnapshotRow, b: SnapshotRow): number {
  const da = storedRoleDate(a);
  const db = storedRoleDate(b);
  if (da !== db) {
    if (da === null) return 1;
    if (db === null) return -1;
    return da < db ? -1 : 1;
  }
  return compareServiceTime(roleTime(a), roleTime(b)) || compareRoleIds(a, b);
}

function toEntry(counts: MemberParticipation, members: MemberNameLookup): ParticipationEntry {
  const { id, name: _ignored, ...rest } = counts;
  const member = members.byId.get(id);
  if (member) {
    const name = member.alias?.trim() || member.member_name || null;
    return { ...rest, memberId: id, name };
  }
  return members.ok
    ? { ...rest, memberId: id, name: null, missing: true }
    : { ...rest, memberId: id, name: null, unresolved: true };
}

/**
 * `total` descending, then resolved `name` — the SAME key `computeParticipation`
 * sorts its own output by (`b.total - a.total || a.name.localeCompare(b.name)`,
 * `app/utils/computeParticipation.ts`). That function is fed bare `{_id}` refs
 * here (see the file header), so its OWN tie-break sees an empty string for
 * every member and falls back to Map insertion order — never the admin
 * sidebar's order, which feeds real names in. Re-sorting AFTER names resolve,
 * with the identical formula, is what matches it; `computeParticipation`
 * itself stays unchanged.
 */
function byTotalThenName(a: ParticipationEntry, b: ParticipationEntry): number {
  return b.total - a.total || (a.name ?? "").localeCompare(b.name ?? "");
}

const PARTIAL_NAMES_NOTE =
  "No se pudo leer el nombre de uno o más miembros; los conteos son correctos, pero esos miembros aparecen con unresolved: true.";

/**
 * `get_participation`'s whole payload for `month`. The caller must have
 * already refused an unreadable roles domain (`catalogueUnreadable`) and
 * already resolved `members` — a `MemberNameLookup` covering every id
 * `participantMemberIds` names, typically `loadMemberNames(ids,
 * snapshot.membersById)` (see the file header for why `membersById` alone
 * under-resolves). The bulk snapshot read and that supplementary read can fail
 * SEPARATELY: `members.ok` is false only when the supplementary read itself
 * failed, so an id already known from the bulk read still resolves even then —
 * `notes` and each entry's `unresolved` flag describe exactly which ids did
 * not. This function never re-reads anything itself.
 */
export function presentParticipation(
  snapshot: ServiceSnapshot,
  month: string,
  members: MemberNameLookup,
): GetParticipationPayload {
  const monthRoles = participantRolesForMonth(snapshot, month);
  const participantRoles = buildParticipantRoles(snapshot, month);

  const memberEntries = computeParticipation(participantRoles)
    .map((entry) => toEntry(entry, members))
    .sort(byTotalThenName);

  const services = [...monthRoles]
    .sort(compareServiceRoles)
    .map((role) => serviceEntryOf(role))
    .filter((service): service is ParticipationServiceEntry => service !== null);

  const notes = members.ok ? [] : [PARTIAL_NAMES_NOTE];

  return {
    month,
    members: memberEntries,
    services,
    ...(notes.length ? { notes } : {}),
    ...failedSourcesOf(snapshot),
  };
}
