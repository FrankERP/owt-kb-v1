// Deterministic role-creation receipts (Service Readiness A2 §2) — pure model.
//
// A `roleCreationReceipt` is the GLOBAL create-request mutex for `sunday_role`,
// `saturday_role`, and `special_role`: same request id -> same deterministic
// document id -> exactly one `create()` can win, across every target and role
// type. The weekend target lock (§1) independently serializes DIFFERENT request
// ids competing for one weekend target; the two never substitute for each other.
//
// No Sanity client, no I/O — server-side only (Node `crypto`), so every
// canonicalization and digest rule is exhaustively unit-testable in memory.
//
// Fingerprint contract (plan §2): canonicalize the COMPLETE create payload —
// role type, normalized target identity/date, normalized special-service name,
// effective publication default, and ordered normalized assignment/label inputs
// — while EXCLUDING the request id, generated `_key`s, the role id, and
// timestamps. Two payloads that differ only in incidental ordering or whitespace
// hash identically (a lost-response replay must be idempotent success), while
// any changed date, role type, special identity, or assignment hashes
// differently (that is `409 idempotency_mismatch`, never a silent overwrite).

import { createHash } from "node:crypto";
import { ROLE_TYPES, type RoleType } from "@/app/utils/serviceReadModel";
import { serviceDayKey } from "@/app/utils/serviceReadSelect";

export const ROLE_CREATION_RECEIPT_TYPE = "roleCreationReceipt";

export const RECEIPT_STATES = ["committed", "role_deleted"] as const;
export type RoleCreationReceiptState = (typeof RECEIPT_STATES)[number];

/** Bump when the canonical shape changes, so old fingerprints can never collide. */
const FINGERPRINT_VERSION = 1;

/** The create payload accepted by the role create writer. */
export interface RoleCreatePayload {
  _type?: unknown;
  date?: unknown;
  service_name?: unknown;
  published?: unknown;
  leads?: unknown;
  bgvs?: unknown;
  chorus?: unknown;
  instruments?: unknown;
  foh?: unknown;
}

export interface CanonicalSlot {
  label: string;
  personId: string;
}

export interface CanonicalCreatePayload {
  v: number;
  roleType: RoleType | null;
  date: string | null;
  targetIdentity: string | null;
  serviceName: string | null;
  published: boolean;
  leads: string[];
  bgvs: string[];
  chorus: string[];
  instruments: CanonicalSlot[];
  foh: CanonicalSlot[];
}

export interface CanonicalizedCreatePayload {
  valid: boolean;
  /** Issue tags: payload | role_type | date | service_name. */
  issues: string[];
  canonical: CanonicalCreatePayload;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object";
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

/** NFC + trim + collapse internal whitespace. Case and accents are meaningful. */
function normalizeLabel(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const out = v.normalize("NFC").trim().replace(/\s+/g, " ");
  return out.length ? out : null;
}

/** Member ids as a sorted multiset: blanks dropped, genuine duplicates kept. */
function canonicalRefs(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v) if (nonEmptyString(item)) out.push(item);
  return out.sort(compareStrings);
}

function compareStrings(a: string, b: string): number {
  // Codepoint order, never `localeCompare` — a fingerprint must not depend on
  // the server's locale/ICU data.
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Labelled seats (instrument/FOH) as a sorted multiset of `{label, personId}`. */
function canonicalSlots(v: unknown, labelField: "instrument" | "role"): CanonicalSlot[] {
  if (!Array.isArray(v)) return [];
  const out: CanonicalSlot[] = [];
  for (const item of v) {
    if (!isObj(item)) continue;
    const label = normalizeLabel(item[labelField]);
    const personId = nonEmptyString(item.personId) ? item.personId : null;
    if (!label || !personId) continue;
    out.push({ label, personId });
  }
  return out.sort((a, b) => compareStrings(a.label, b.label) || compareStrings(a.personId, b.personId));
}

/**
 * Canonicalize a create payload. Never throws: a structurally unusable payload
 * still produces a deterministic canonical value (so its fingerprint is stable)
 * plus explicit issues, and the writer rejects it before any receipt is written.
 */
export function canonicalizeCreatePayload(payload: RoleCreatePayload): CanonicalizedCreatePayload {
  const issues: string[] = [];
  const doc = isObj(payload) ? payload : {};
  if (!isObj(payload)) issues.push("payload");

  const roleType = (ROLE_TYPES as readonly unknown[]).includes(doc._type)
    ? (doc._type as RoleType)
    : null;
  if (!roleType) issues.push("role_type");

  const date = serviceDayKey(doc.date);
  if (!date) issues.push("date");

  // A weekend role never stores `service_name`, so a stray one must not change
  // the fingerprint — the fingerprint describes what would actually be written.
  const serviceName = roleType === "special_role" ? normalizeLabel(doc.service_name) : null;
  if (roleType === "special_role" && !serviceName) issues.push("service_name");

  let targetIdentity: string | null = null;
  if (roleType && date) {
    if (roleType === "special_role") {
      targetIdentity = serviceName ? `special_role:${date}:${serviceName}` : null;
    } else {
      targetIdentity = `${roleType}:${date}`;
    }
  }

  return {
    valid: issues.length === 0,
    issues,
    canonical: {
      v: FINGERPRINT_VERSION,
      roleType,
      date,
      targetIdentity,
      serviceName,
      // Effective publication default: only an exact boolean `true` publishes,
      // matching the writer's `published === true` (missing/false = draft).
      published: doc.published === true,
      leads: canonicalRefs(doc.leads),
      bgvs: canonicalRefs(doc.bgvs),
      chorus: canonicalRefs(doc.chorus),
      instruments: canonicalSlots(doc.instruments, "instrument"),
      foh: canonicalSlots(doc.foh, "role"),
    },
  };
}

/** Deterministic JSON with sorted object keys, so key insertion order is irrelevant. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isObj(value)) {
    const keys = Object.keys(value).sort(compareStrings);
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

function sha256(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/**
 * Deterministic payload fingerprint. Equal fingerprint + equal request id +
 * a live role carrying the receipt is lost-response idempotent success; an equal
 * request id with a different fingerprint is `409 idempotency_mismatch`.
 */
export function payloadFingerprint(payload: RoleCreatePayload): string {
  return sha256(stableStringify(canonicalizeCreatePayload(payload).canonical));
}

/**
 * Deterministic receipt document id from a collision-resistant digest of the
 * EXACT request id. The receipt also stores the raw request id, because the
 * digest alone must never be trusted for equality.
 */
export function receiptIdForRequestId(requestId: unknown): string | null {
  if (!nonEmptyString(requestId)) return null;
  return `roleCreate.${sha256(requestId)}`;
}

export interface RoleCreationReceiptDocument {
  _id: string;
  _type: typeof ROLE_CREATION_RECEIPT_TYPE;
  /** The exact request id, for equality verification against the digest-derived id. */
  requestId: string;
  fingerprint: string;
  /** Pre-generated role id — the receipt and role are created in one transaction. */
  roleId: string;
  roleType: RoleType;
  targetIdentity: string;
  state: RoleCreationReceiptState;
  createdAt: string;
  updatedAt: string;
}

/**
 * Receipt document for a first commit. Returns null when the request id, role
 * id, timestamp, or payload is unusable — a caller must never write a
 * half-derived idempotency tombstone.
 */
export function buildCreationReceipt(input: {
  requestId: string;
  payload: RoleCreatePayload;
  roleId: string;
  now: string;
}): RoleCreationReceiptDocument | null {
  const _id = receiptIdForRequestId(input.requestId);
  if (!_id || !nonEmptyString(input.roleId) || !nonEmptyString(input.now)) return null;
  const { valid, canonical } = canonicalizeCreatePayload(input.payload);
  if (!valid || !canonical.roleType || !canonical.targetIdentity) return null;
  return {
    _id,
    _type: ROLE_CREATION_RECEIPT_TYPE,
    requestId: input.requestId,
    fingerprint: payloadFingerprint(input.payload),
    roleId: input.roleId,
    roleType: canonical.roleType,
    targetIdentity: canonical.targetIdentity,
    state: "committed",
    createdAt: input.now,
    updatedAt: input.now,
  };
}

export interface ReceiptPatch {
  set: Record<string, unknown>;
  unset: string[];
}

/**
 * Retire a receipt-backed key when its role is deleted, in the same transaction
 * that deletes the role and vacates any weekend lock. Request identity,
 * fingerprint, role id, and initial target stay immutable: a committed or
 * retired receipt is a durable idempotency tombstone, so a retried key can
 * never recreate the role (`409 idempotency_key_retired`).
 */
export function retireReceiptPatch(input: { now: string }): ReceiptPatch {
  return { set: { state: "role_deleted", updatedAt: input.now }, unset: [] };
}
