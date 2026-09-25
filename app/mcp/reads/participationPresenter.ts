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
// `Lead[defined(@->)]`), a seat referencing a member missing from the
// snapshot's `membersById` is KEPT and counted — `computeParticipation`
// accumulates by `_id` regardless of whether a name resolved — and reported as
// `{ missing: true }` here, never dropped. A member seated on any role appears
// regardless of ministry (the I5 SEAT exception): this module applies no
// worship-audience filter at all, unlike `memberAvailabilityPresenter.ts`.

import { derivePublishState } from "@/app/components/admin/serviceReadiness";
import {
  computeParticipation,
  type MemberParticipation,
  type ParticipantRole,
} from "@/app/utils/computeParticipation";
import { storedRoleDate } from "@/app/utils/roleWriteRequest";
import { serviceKindOf, type ServiceKind } from "./servicePresenter";
import type { ServiceSnapshot, SnapshotRow } from "./serviceSnapshot";

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

// ── Presentation ─────────────────────────────────────────────────────────────

export type ParticipationEntry = Omit<MemberParticipation, "id" | "name"> & {
  memberId: string;
  name: string | null;
  /** The seat names a member document missing from `membersById` (a dangling reference). Never dropped. */
  missing?: true;
  /** The members-domain read failed: no name resolves for anyone, not just this one. */
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
};

function serviceEntryOf(role: SnapshotRow): ParticipationServiceEntry | null {
  const kind = serviceKindOf(role._type);
  const date = storedRoleDate(role);
  if (!kind || !date || !nonEmptyString(role._id)) return null;
  return { serviceId: role._id, date, kind, published: derivePublishState(role.published) };
}

function compareServices(a: ParticipationServiceEntry, b: ParticipationServiceEntry): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  return a.serviceId < b.serviceId ? -1 : a.serviceId > b.serviceId ? 1 : 0;
}

function toEntry(counts: MemberParticipation, snapshot: ServiceSnapshot, membersOk: boolean): ParticipationEntry {
  const { id, name: _ignored, ...rest } = counts;
  const member = snapshot.membersById.get(id);
  if (member) {
    const name = member.alias?.trim() || member.member_name || null;
    return { ...rest, memberId: id, name };
  }
  return membersOk ? { ...rest, memberId: id, name: null, missing: true } : { ...rest, memberId: id, name: null, unresolved: true };
}

/**
 * `get_participation`'s whole payload for `month`. The caller must have
 * already refused an unreadable roles domain (`catalogueUnreadable`) — this
 * function assumes the snapshot's roles are trustworthy and only degrades
 * gracefully when the MEMBERS domain failed (names null, plus a note).
 */
export function presentParticipation(snapshot: ServiceSnapshot, month: string): GetParticipationPayload {
  const monthRoles = participantRolesForMonth(snapshot, month);
  const participantRoles = buildParticipantRoles(snapshot, month);

  const membersOk = snapshot.readiness.sources.members === "ready";
  const members = computeParticipation(participantRoles).map((entry) => toEntry(entry, snapshot, membersOk));

  const services = monthRoles
    .map((role) => serviceEntryOf(role))
    .filter((service): service is ParticipationServiceEntry => service !== null)
    .sort(compareServices);

  const notes = membersOk
    ? []
    : ["No se pudieron leer los nombres de los miembros; los conteos son correctos, pero los nombres no están disponibles."];

  return { month, members, services, ...(notes.length ? { notes } : {}) };
}
