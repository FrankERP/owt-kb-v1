// Deterministic references into the seeded verification fixtures, plus the
// request-payload builders the specs share.
//
// Every id, date and derived document id comes from `scripts/lib/sr-verification.mjs`
// — the SAME generators the seed and reset scripts use. Nothing here invents an id,
// so a spec can never assert against a document the reset does not own (and
// therefore cannot clean).
//
// This module holds no Sanity client and issues no query; it only names things.

import {
  DANGLING_MEMBER_ID,
  FIXTURE_DATES,
  FIXTURE_REQUEST_IDS,
  mirrorReceiptId,
  mirrorRoleTargetLockId,
} from "../../../scripts/lib/sr-verification.mjs";

export { DANGLING_MEMBER_ID, FIXTURE_DATES, FIXTURE_REQUEST_IDS };

export const FIXTURE_DATE = FIXTURE_DATES as Readonly<Record<string, string>>;

/** The seeded member ids, one per assignment path plus the edge cases. */
export const MEMBERS = Object.freeze({
  admin: "srv.member.admin",
  lead: "srv.member.lead",
  bgv: "srv.member.bgv",
  chorus: "srv.member.chorus",
  instrument: "srv.member.instrument",
  foh: "srv.member.foh",
  unavailable: "srv.member.unavailable",
  disabled: "srv.member.disabled",
});

/** The seeded role documents, by the state each one represents. */
export const ROLES = Object.freeze({
  sundayPublished: "srv.role.sunday.published",
  sundayDraft: "srv.role.sunday.draft",
  sundayLegacy: "srv.role.sunday.legacy",
  sundayDangling: "srv.role.sunday.dangling",
  saturdayPublished: "srv.role.saturday.published",
  saturdayDraft: "srv.role.saturday.draft",
  saturdayLegacy: "srv.role.saturday.legacy",
  specialPublished: "srv.role.special.published",
  specialDraft: "srv.role.special.draft",
  specialLegacy: "srv.role.special.legacy",
});

export const SETLISTS = Object.freeze({
  sundayEmpty: "srv.setlist.sunday.empty",
  sundayReady: "srv.setlist.sunday.ready",
  saturdayIncomplete: "srv.setlist.saturday.incomplete",
});

export const PROPOSALS = Object.freeze({
  pending: "srv.proposal.pending",
  changesRequested: "srv.proposal.changesRequested",
  approved: "srv.proposal.approved",
  legacyApproved: "srv.proposal.legacyApproved",
});

export const SONGS = Object.freeze({
  a: "srv.song.a",
  b: "srv.song.b",
  c: "srv.song.c",
});

/** Deterministic weekend target-lock id, via the shared mirror of the app helper. */
export function lockId(roleType: "sunday_role" | "saturday_role", date: string): string {
  const id = mirrorRoleTargetLockId(`${roleType}:${date}`) as string | null;
  if (!id) throw new Error(`No deterministic lock id for ${roleType}:${date}`);
  return id;
}

/** Deterministic creation-receipt id, via the shared mirror of the app helper. */
export function receiptId(requestId: string): string {
  const id = mirrorReceiptId(requestId) as string | null;
  if (!id) throw new Error(`No deterministic receipt id for "${requestId}"`);
  return id;
}

/* ------------------------------------------------------------------ *
 * Request payload builders
 * ------------------------------------------------------------------ */

export interface CreateSeats {
  leads?: string[];
  bgvs?: string[];
  chorus?: string[];
  instruments?: Array<{ instrument: string; personId: string }>;
  foh?: Array<{ role: string; personId: string }>;
}

/**
 * A POST /api/admin/roles body. `creationRequestId` is the caller-owned
 * idempotency key: the same key with the same payload is a lost-response replay,
 * the same key with a different payload is `idempotency_mismatch`.
 */
export function createRoleBody({
  type,
  date,
  serviceName = null,
  published = false,
  requestId,
  seats = {},
}: {
  type: "sunday_role" | "saturday_role" | "special_role";
  date: string;
  serviceName?: string | null;
  published?: boolean;
  requestId: string;
  seats?: CreateSeats;
}): Record<string, unknown> {
  return {
    creationRequestId: requestId,
    _type: type,
    date,
    ...(serviceName === null ? {} : { service_name: serviceName }),
    published,
    leads: seats.leads ?? [],
    bgvs: seats.bgvs ?? [],
    chorus: seats.chorus ?? [],
    instruments: seats.instruments ?? [],
    foh: seats.foh ?? [],
  };
}

/** A full seat set drawn from the five seat fixtures. */
export function fullSeats(): CreateSeats {
  return {
    leads: [MEMBERS.lead],
    bgvs: [MEMBERS.bgv],
    chorus: [MEMBERS.chorus],
    instruments: [{ instrument: "Guitarra", personId: MEMBERS.instrument }],
    foh: [{ role: "Audio", personId: MEMBERS.foh }],
  };
}

/** `{ observed: { state: "single", id, rev } }` — the client's observed target. */
export function observedSingle(id: string, rev: string): Record<string, unknown> {
  return { state: "single", id, rev };
}

/** `{ observed: { state: "none" } }` — "I saw no target for this service". */
export function observedNone(): Record<string, unknown> {
  return { state: "none" };
}

/** A unique, well-formed creation request id scoped to this run. */
export function scopedRequestId(runId: string, label: string): string {
  return `srv-${label}-${runId.slice(-12)}`;
}
