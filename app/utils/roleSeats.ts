// app/utils/roleSeats.ts
//
// The server's reading of a request's five seat paths, split out of
// `roleWriteRequest.ts` because that module reaches `node:crypto` (through
// `roleCreationReceipt`) and must stay out of client bundles. The month
// confirm's seat-clash pre-check (`monthDraftCreate.draftSeatClashSentences`,
// imported by the planner) reads seats with THIS function, so it and
// `createRole`'s guard cannot disagree on the roster. Pure and client-safe:
// nothing here may import a server-only module (`roleSeatsClientSafe.test.ts`).

import { normalizeLabel } from "./normalizeLabel";

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object";
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

export interface NormalizedInstrumentSlot {
  instrument: string;
  personId: string;
}
export interface NormalizedFohSlot {
  role: string;
  personId: string;
}

export interface NormalizedSeats {
  leads: string[];
  bgvs: string[];
  chorus: string[];
  instruments: NormalizedInstrumentSlot[];
  foh: NormalizedFohSlot[];
}

function normalizeRefs(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(nonEmptyString);
}

// `normalizeLabel` is imported from `@/app/utils/normalizeLabel` — one
// definition shared with `roleCreationReceipt` (which fingerprints against it),
// `roleWriteOps` (which filters special occupancy by it) and the client planner
// grid (which keys a special's collision check by it). It used to be
// hand-copied here.

/**
 * Seats in the ORDER the request supplied them, with blanks and malformed slots
 * dropped. This is what is stored; `canonicalizeCreatePayload` independently
 * sorts for the fingerprint.
 */
export function normalizeSeats(payload: unknown): NormalizedSeats {
  const doc = isObj(payload) ? payload : {};
  const instruments: NormalizedInstrumentSlot[] = [];
  for (const item of Array.isArray(doc.instruments) ? doc.instruments : []) {
    if (!isObj(item)) continue;
    const instrument = normalizeLabel(item.instrument);
    if (!instrument || !nonEmptyString(item.personId)) continue;
    instruments.push({ instrument, personId: item.personId });
  }
  const foh: NormalizedFohSlot[] = [];
  for (const item of Array.isArray(doc.foh) ? doc.foh : []) {
    if (!isObj(item)) continue;
    const role = normalizeLabel(item.role);
    if (!role || !nonEmptyString(item.personId)) continue;
    foh.push({ role, personId: item.personId });
  }
  return {
    leads: normalizeRefs(doc.leads),
    bgvs: normalizeRefs(doc.bgvs),
    chorus: normalizeRefs(doc.chorus),
    instruments,
    foh,
  };
}
