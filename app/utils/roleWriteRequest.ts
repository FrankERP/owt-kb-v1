// Request validation and decision rules for the protected role writers
// (Service Readiness A2 §2). Pure: no Sanity client, no I/O, no framework types,
// so every prevalidation and conflict rule is exhaustively unit-testable in
// memory. The routes own all reads/writes and wrap the returned decisions in
// `serviceError(...)` responses.
//
// Three groups live here:
//  1. Request shape: bounded opaque creation request ids, canonical document ids
//     and revisions, and the exact publish batch contract.
//  2. Stored-document shapes: the role document a create writes and the field
//     patch an edit applies (request ORDER is preserved — only the fingerprint is
//     order-insensitive, so a pure reorder replays as idempotent success while
//     the UI still shows the operator's order).
//  3. Conflict decisions: what an existing creation receipt means, what may be
//     done with a weekend lock, and whether a Content Lake failure was a genuine
//     mutation conflict (never a blind retry).

import { ROLE_TYPES, isValidServiceDate, type RoleType } from "./serviceReadModel";
import { serviceDayKey } from "./serviceReadSelect";
import {
  ROLE_CREATION_RECEIPT_TYPE,
  canonicalizeCreatePayload,
  payloadFingerprint,
  receiptIdForRequestId,
  type CanonicalCreatePayload,
  type RoleCreatePayload,
} from "./roleCreationReceipt";
import { ROLE_TARGET_LOCK_TYPE, roleTargetLockId } from "./roleTargetLock";

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object";
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

// ── Request-shape primitives ────────────────────────────────────────────────

/** A creation request id is opaque but BOUNDED — never an unbounded client string. */
export const CREATION_REQUEST_ID_MIN = 8;
export const CREATION_REQUEST_ID_MAX = 128;
const CREATION_REQUEST_ID_RE = /^[A-Za-z0-9._:-]+$/;

export function isValidCreationRequestId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= CREATION_REQUEST_ID_MIN &&
    value.length <= CREATION_REQUEST_ID_MAX &&
    CREATION_REQUEST_ID_RE.test(value)
  );
}

export const DOCUMENT_ID_MAX = 200;

/**
 * A canonical (published) document id: bounded, no whitespace, and never a
 * `drafts.*` overlay id — a protected writer must not be steerable at a draft.
 */
export function isCanonicalDocumentId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= DOCUMENT_ID_MAX &&
    !/\s/.test(value) &&
    !value.startsWith("drafts.")
  );
}

/** A client-observed `_rev`: bounded, non-empty, no whitespace. */
export function isRevisionString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 200 && !/\s/.test(value);
}

// ── Normalized seats (stored order preserved) ───────────────────────────────

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

function normalizeLabel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const out = value.normalize("NFC").trim().replace(/\s+/g, " ");
  return out.length ? out : null;
}

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

/** Every assignee across all five seat paths, in stored order, de-duplicated. */
export function seatAssignees(seats: NormalizedSeats): string[] {
  return [
    ...new Set([
      ...seats.leads,
      ...seats.bgvs,
      ...seats.chorus,
      ...seats.instruments.map((s) => s.personId),
      ...seats.foh.map((s) => s.personId),
    ]),
  ];
}

// ── Stored document / patch shapes ──────────────────────────────────────────

export type KeyFactory = () => string;

/** The five seat fields, each item carrying its own required `_key`. */
export function seatFields(seats: NormalizedSeats, nextKey: KeyFactory): Record<string, unknown> {
  return {
    Lead: seats.leads.map((id) => ({ _type: "reference", _ref: id, _key: nextKey() })),
    BGVs: seats.bgvs.map((id) => ({ _type: "reference", _ref: id, _key: nextKey() })),
    Chorus: seats.chorus.map((id) => ({ _type: "reference", _ref: id, _key: nextKey() })),
    instruments: seats.instruments.map((s) => ({
      _type: "instrument_slot",
      _key: nextKey(),
      instrument: s.instrument,
      person: { _type: "reference", _ref: s.personId },
    })),
    foh_team: seats.foh.map((s) => ({
      _type: "foh_slot",
      _key: nextKey(),
      role: s.role,
      person: { _type: "reference", _ref: s.personId },
    })),
  };
}

/** `date` for a special service, `week` for the two weekend types. */
export function roleDateField(roleType: RoleType): "date" | "week" {
  return isSpecialRoleType(roleType) ? "date" : "week";
}

/**
 * True only for the special-service role type. Centralized so server modules
 * that must not name protected stored types can still branch on it.
 */
export function isSpecialRoleType(roleType: unknown): boolean {
  return roleType === "special_role";
}

/** The stored service date of a role: `date` for special, `week` for weekend. */
export function storedRoleDate(role: {
  _type?: unknown;
  week?: unknown;
  date?: unknown;
}): string | null {
  const raw = isSpecialRoleType(role._type) ? role.date : role.week;
  return serviceDayKey(raw);
}

/**
 * The complete role document a create commits, at a PRE-GENERATED id (the same
 * id the receipt records, so receipt and role are written in one transaction).
 */
export function buildRoleDocument(input: {
  roleId: string;
  roleType: RoleType;
  date: string;
  serviceName: string | null;
  published: boolean;
  seats: NormalizedSeats;
  receiptId: string;
  fingerprint: string;
  nextKey: KeyFactory;
}): { _id: string; _type: RoleType } & Record<string, unknown> {
  return {
    _id: input.roleId,
    _type: input.roleType,
    [roleDateField(input.roleType)]: input.date,
    ...(input.roleType === "special_role" ? { service_name: input.serviceName ?? "" } : {}),
    ...seatFields(input.seats, input.nextKey),
    published: input.published,
    // Forward link to the idempotency tombstone. The receipt's own `roleId`
    // stays authoritative; this is not a second copy of the request key.
    creationReceiptId: input.receiptId,
    creationFingerprint: input.fingerprint,
  };
}

/**
 * The `set` payload of an edit. `_type` is NEVER included: it is immutable per
 * document id, and a request must not be able to convert a stored document.
 */
export function buildRoleEditPatch(input: {
  roleType: RoleType;
  date: string;
  serviceName: string | null;
  seats: NormalizedSeats;
  nextKey: KeyFactory;
}): Record<string, unknown> {
  return {
    [roleDateField(input.roleType)]: input.date,
    ...(input.roleType === "special_role" ? { service_name: input.serviceName ?? "" } : {}),
    ...seatFields(input.seats, input.nextKey),
  };
}

// ── Create request ─────────────────────────────────────────────────────────

export interface ParsedCreateRequest {
  requestId: string;
  receiptId: string;
  fingerprint: string;
  canonical: CanonicalCreatePayload;
  roleType: RoleType;
  date: string;
  serviceName: string | null;
  published: boolean;
  seats: NormalizedSeats;
  /** Deterministic weekend lock id; null for a special service. */
  lockId: string | null;
  targetKey: string;
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; issues: string[] };

function fail(issues: string[]): { ok: false; issues: string[] } {
  return { ok: false, issues };
}

export function parseCreateRequest(body: unknown): ParseResult<ParsedCreateRequest> {
  if (!isObj(body)) return fail(["payload"]);
  const requestId = body.creationRequestId;
  if (!isValidCreationRequestId(requestId)) return fail(["creationRequestId"]);
  const receiptId = receiptIdForRequestId(requestId);
  if (!receiptId) return fail(["creationRequestId"]);

  const payload = body as RoleCreatePayload;
  const { valid, issues, canonical } = canonicalizeCreatePayload(payload);
  if (!valid || !canonical.roleType || !canonical.date || !canonical.targetIdentity) {
    return fail(issues.length ? issues : ["payload"]);
  }

  const roleType = canonical.roleType;
  const targetKey =
    roleType === "special_role" ? canonical.targetIdentity : `${roleType}:${canonical.date}`;

  return {
    ok: true,
    value: {
      requestId,
      receiptId,
      fingerprint: payloadFingerprint(payload),
      canonical,
      roleType,
      date: canonical.date,
      serviceName: canonical.serviceName,
      published: canonical.published,
      seats: normalizeSeats(payload),
      lockId: roleTargetLockId(`${roleType}:${canonical.date}`),
      targetKey,
    },
  };
}

// ── Edit request ───────────────────────────────────────────────────────────

export interface ParsedEditRequest {
  /** Role revision the client observed when it loaded/confirmed the card. */
  rev: string;
  /** Optional client-observed weekend lock revision; the server asserts its own too. */
  lockRev: string | null;
  date: string;
  serviceName: string | null;
  /** Only for cross-checking against the STORED type — never used to convert. */
  requestedType: RoleType | null;
  seats: NormalizedSeats;
}

export function parseEditRequest(body: unknown): ParseResult<ParsedEditRequest> {
  if (!isObj(body)) return fail(["payload"]);
  if (!isRevisionString(body.rev)) return fail(["rev"]);
  if (body.lockRev != null && !isRevisionString(body.lockRev)) return fail(["lockRev"]);
  const date = serviceDayKey(body.date);
  if (!date) return fail(["date"]);
  const requestedType = (ROLE_TYPES as readonly unknown[]).includes(body._type)
    ? (body._type as RoleType)
    : null;
  if (body._type != null && !requestedType) return fail(["_type"]);
  return {
    ok: true,
    value: {
      rev: body.rev,
      lockRev: isRevisionString(body.lockRev) ? body.lockRev : null,
      date,
      serviceName: normalizeLabel(body.service_name),
      requestedType,
      seats: normalizeSeats(body),
    },
  };
}

// ── Delete request ─────────────────────────────────────────────────────────

export interface ParsedDeleteRequest {
  rev: string;
  lockRev: string | null;
}

export function parseDeleteRequest(body: unknown): ParseResult<ParsedDeleteRequest> {
  if (!isObj(body)) return fail(["payload"]);
  if (!isRevisionString(body.rev)) return fail(["rev"]);
  if (body.lockRev != null && !isRevisionString(body.lockRev)) return fail(["lockRev"]);
  return {
    ok: true,
    value: { rev: body.rev, lockRev: isRevisionString(body.lockRev) ? body.lockRev : null },
  };
}

// ── Publish request ────────────────────────────────────────────────────────

export const PUBLISH_BATCH_MAX = 100;

export interface PublishEntry {
  id: string;
  rev: string;
}

export interface ParsedPublishRequest {
  entries: PublishEntry[];
  published: boolean;
}

/**
 * Exact publish contract: `{ roles: [{ id, rev }], published: boolean }`. A
 * non-boolean `published`, an empty or oversized batch, a non-canonical id or
 * revision, or a duplicate id rejects the WHOLE batch before any read.
 */
export function parsePublishRequest(body: unknown): ParseResult<ParsedPublishRequest> {
  if (!isObj(body)) return fail(["payload"]);
  if (typeof body.published !== "boolean") return fail(["published"]);
  const rows = body.roles;
  if (!Array.isArray(rows) || rows.length === 0) return fail(["roles"]);
  if (rows.length > PUBLISH_BATCH_MAX) return fail(["batch_size"]);

  const entries: PublishEntry[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (!isObj(row)) return fail(["roles"]);
    if (!isCanonicalDocumentId(row.id)) return fail(["role_id"]);
    if (!isRevisionString(row.rev)) return fail(["role_rev"]);
    if (seen.has(row.id)) return fail(["duplicate_role_id"]);
    seen.add(row.id);
    entries.push({ id: row.id, rev: row.rev });
  }
  return { ok: true, value: { entries, published: body.published } };
}

// ── Creation receipt decision ──────────────────────────────────────────────

export type ReceiptDecision =
  /** Lost-response replay: return the committed role with no writes at all. */
  | "replay"
  | "idempotency_mismatch"
  | "idempotency_key_retired"
  | "integrity_conflict"
  /** No receipt at this deterministic id: this is a first attempt. */
  | "absent";

export interface ReceiptDecisionResult {
  decision: ReceiptDecision;
  detail?: string;
  /** The committed role id the receipt points at, when it has one. */
  roleId?: string;
}

/**
 * What an existing (or absent) deterministic receipt means for this attempt.
 * `role` is the canonical role resolved from `receipt.roleId` (null when it does
 * not resolve to exactly one canonical role) — a missing or mismatched result
 * role is an integrity conflict and is NEVER implicitly recreated.
 */
export function decideReceipt(input: {
  receipt: unknown | null;
  requestId: string;
  fingerprint: string;
  role: unknown | null;
}): ReceiptDecisionResult {
  const receipt = input.receipt;
  if (receipt == null) return { decision: "absent" };
  if (!isObj(receipt)) return { decision: "integrity_conflict", detail: "receipt_malformed" };
  if (receipt._type !== ROLE_CREATION_RECEIPT_TYPE) {
    return { decision: "integrity_conflict", detail: "receipt_type" };
  }
  // The document id is only a digest; equality is verified against the EXACT
  // stored request id, never the digest alone.
  if (!nonEmptyString(receipt.requestId) || receipt.requestId !== input.requestId) {
    return { decision: "integrity_conflict", detail: "receipt_request_id" };
  }
  if (!nonEmptyString(receipt.fingerprint) || !nonEmptyString(receipt.roleId)) {
    return { decision: "integrity_conflict", detail: "receipt_fields" };
  }
  if (receipt.state === "role_deleted") {
    return { decision: "idempotency_key_retired", roleId: receipt.roleId };
  }
  if (receipt.state !== "committed") {
    return { decision: "integrity_conflict", detail: "receipt_state" };
  }
  if (receipt.fingerprint !== input.fingerprint) {
    return { decision: "idempotency_mismatch", roleId: receipt.roleId };
  }
  const role = input.role;
  if (!isObj(role) || role._id !== receipt.roleId) {
    return { decision: "integrity_conflict", detail: "receipt_result_missing", roleId: receipt.roleId };
  }
  if (role._type !== receipt.roleType) {
    return { decision: "integrity_conflict", detail: "receipt_result_type", roleId: receipt.roleId };
  }
  return { decision: "replay", roleId: receipt.roleId };
}

// ── Weekend lock decisions ─────────────────────────────────────────────────

export interface LockFacts {
  _id?: unknown;
  _rev?: unknown;
  _type?: unknown;
  targetKey?: unknown;
  state?: unknown;
  roleId?: unknown;
  generation?: unknown;
}

function lockShapeIssue(lock: LockFacts, targetKey: string): string | null {
  if (lock._type !== ROLE_TARGET_LOCK_TYPE) return "lock_type";
  if (!nonEmptyString(lock._id) || !nonEmptyString(lock._rev)) return "lock_identity";
  if (lock.targetKey !== targetKey) return "lock_target";
  if (lock._id !== roleTargetLockId(targetKey)) return "lock_id";
  if (lock.state !== "claimed" && lock.state !== "vacant") return "lock_state";
  return null;
}

export type ClaimPlan =
  /** No lock document exists yet: `create` it (the cross-request mutex). */
  | { kind: "create" }
  /** A vacant lock exists: re-claim it under its observed revision. */
  | { kind: "reclaim"; lockId: string; lockRev: string; generation: number | null }
  /** Claimed by a live role: this target is taken. */
  | { kind: "occupied"; lockId: string; roleId: string }
  | { kind: "integrity"; detail: string };

/**
 * Plan a claim of a weekend target for a NEW owner (create, or the destination
 * side of a date move). A wrong-owner or orphan lock is an integrity issue and is
 * never implicitly reclaimed.
 */
export function planTargetClaim(input: {
  lock: LockFacts | null;
  targetKey: string;
  /** Whether `lock.roleId` resolves to a live canonical role. */
  ownerExists?: boolean;
}): ClaimPlan {
  const lockId = roleTargetLockId(input.targetKey);
  if (!lockId) return { kind: "integrity", detail: "not_a_weekend_target" };
  if (input.lock == null) return { kind: "create" };
  const issue = lockShapeIssue(input.lock, input.targetKey);
  if (issue) return { kind: "integrity", detail: issue };
  const lock = input.lock;
  const generation = typeof lock.generation === "number" ? lock.generation : null;
  if (lock.state === "claimed") {
    if (!nonEmptyString(lock.roleId)) return { kind: "integrity", detail: "claimed_without_role" };
    if (input.ownerExists === false) return { kind: "integrity", detail: "orphan_lock" };
    return { kind: "occupied", lockId, roleId: lock.roleId };
  }
  if (nonEmptyString(lock.roleId)) return { kind: "integrity", detail: "vacant_with_role" };
  return { kind: "reclaim", lockId, lockRev: lock._rev as string, generation };
}

export type OwnedLockPlan =
  /** The lock is owned by this role: assert its revision and heartbeat it. */
  | { kind: "assert"; lockId: string; lockRev: string; generation: number | null }
  /** Legacy weekend role with no lock: run the §1 bootstrap first. */
  | { kind: "bootstrap"; lockId: string }
  | { kind: "integrity"; detail: string };

/**
 * Plan the assertion of the lock a weekend role must already own. A vacant lock
 * at an occupied target, or one claimed by a different role, is an integrity
 * issue — never repaired implicitly by a business writer.
 */
export function planOwnedLock(input: {
  lock: LockFacts | null;
  targetKey: string;
  roleId: string;
}): OwnedLockPlan {
  const lockId = roleTargetLockId(input.targetKey);
  if (!lockId) return { kind: "integrity", detail: "not_a_weekend_target" };
  if (input.lock == null) return { kind: "bootstrap", lockId };
  const issue = lockShapeIssue(input.lock, input.targetKey);
  if (issue) return { kind: "integrity", detail: issue };
  const lock = input.lock;
  if (lock.state !== "claimed") return { kind: "integrity", detail: "lock_vacant" };
  if (!nonEmptyString(lock.roleId)) return { kind: "integrity", detail: "claimed_without_role" };
  if (lock.roleId !== input.roleId) return { kind: "integrity", detail: "lock_wrong_owner" };
  return {
    kind: "assert",
    lockId,
    lockRev: lock._rev as string,
    generation: typeof lock.generation === "number" ? lock.generation : null,
  };
}

// ── Content Lake conflict classification ───────────────────────────────────

export type SanityConflictKind = "already_exists" | "revision_mismatch" | "conflict";

/**
 * Classify a Content Lake failure. Only a genuine 409 mutation conflict counts:
 * an auth error, a network failure, or a schema complaint must never be mistaken
 * for a guard firing (and must never trigger a retry).
 *
 * Observed shape: `409 { error: { type: "mutationError", items: [{ error: {
 * type: "documentAlreadyExistsError" | "documentRevisionIDDoesNotMatchError" } }] } }`.
 */
export function sanityConflictKind(err: unknown): SanityConflictKind | null {
  if (!isObj(err)) return null;
  if (err.statusCode !== 409) return null;
  const details = isObj(err.details) ? err.details : null;
  const type = details?.type;
  if (type !== undefined && type !== "mutationError") return null;
  const items = details && Array.isArray(details.items) ? details.items : [];
  for (const item of items) {
    const inner = isObj(item) && isObj(item.error) ? item.error : null;
    if (inner?.type === "documentAlreadyExistsError") return "already_exists";
    if (inner?.type === "documentRevisionIDDoesNotMatchError") return "revision_mismatch";
  }
  return "conflict";
}

// ── Publish batch prevalidation ────────────────────────────────────────────

export interface PublishRoleFacts {
  _id: string;
  _rev: string;
  _type: RoleType;
  published?: boolean;
  targetKey: string;
}

export interface PublishPrevalidation {
  ok: boolean;
  /** Issue tags: cardinality | missing:<id> | type:<id> | stale:<id> | invalid:<id> | duplicate_target:<key> */
  issues: string[];
  roles: PublishRoleFacts[];
}

/**
 * Require exact one-to-one agreement between the requested batch and the fetched
 * canonical roles: same cardinality, every id present exactly once, a role type,
 * a groupable target, the exact observed revision, and no two entries on one
 * target. Any failure rejects the COMPLETE batch.
 */
export function prevalidatePublishBatch(input: {
  entries: readonly PublishEntry[];
  fetched: readonly unknown[];
}): PublishPrevalidation {
  const issues: string[] = [];
  const byId = new Map<string, Record<string, unknown>>();
  for (const row of input.fetched) {
    if (!isObj(row) || !nonEmptyString(row._id)) {
      issues.push("invalid:unknown");
      continue;
    }
    if (byId.has(row._id)) issues.push(`duplicate_document:${row._id}`);
    byId.set(row._id, row);
  }
  if (input.fetched.length !== input.entries.length) issues.push("cardinality");

  const roles: PublishRoleFacts[] = [];
  const targets = new Map<string, string>();
  for (const entry of input.entries) {
    const doc = byId.get(entry.id);
    if (!doc) {
      issues.push(`missing:${entry.id}`);
      continue;
    }
    if (!(ROLE_TYPES as readonly unknown[]).includes(doc._type)) {
      issues.push(`type:${entry.id}`);
      continue;
    }
    const roleType = doc._type as RoleType;
    const rawDate = roleType === "special_role" ? doc.date : doc.week;
    if (!isValidServiceDate(rawDate)) {
      issues.push(`invalid:${entry.id}`);
      continue;
    }
    if (!nonEmptyString(doc._rev) || doc._rev !== entry.rev) {
      issues.push(`stale:${entry.id}`);
      continue;
    }
    const targetKey = roleType === "special_role" ? entry.id : `${roleType}:${rawDate}`;
    const owner = targets.get(targetKey);
    if (owner) issues.push(`duplicate_target:${targetKey}`);
    targets.set(targetKey, entry.id);
    roles.push({
      _id: entry.id,
      _rev: doc._rev,
      _type: roleType,
      published: typeof doc.published === "boolean" ? doc.published : undefined,
      targetKey,
    });
  }
  return { ok: issues.length === 0, issues, roles };
}
