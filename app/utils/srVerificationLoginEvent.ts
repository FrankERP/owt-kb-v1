import "server-only";

// Service Readiness A3 §4 "Run-owned credentials login events".
//
// A real credentials sign-in fires `auth.ts`'s `events.signIn`, which creates a
// random-id `loginEvent`. During deployed verification those documents are RUN
// SIDE EFFECTS, and the run must be able to delete exactly its own — by explicit
// `_id`, never by a broad `*[_type == "loginEvent"]`, email, member or time-range
// query. That requires stamping ownership at creation time, which is what this
// module decides.
//
// The ownership stamp is applied ONLY when every one of these holds:
//   1. the request carried the dedicated verification headers (an ordinary
//      sign-in with no headers keeps today's behaviour byte-for-byte, and does
//      not even read the lease);
//   2. the header marker equals the published verification marker value;
//   3. the deployment's own environment passes the full isolated-verification
//      check (marker, project `scbxomq9`, dataset
//      `service-readiness-verification`, `ALLOW_SERVICE_READINESS_E2E_WRITES=true`
//      and `SERVICE_READINESS_DELIVERY_MODE=disabled`);
//   4. the claimed candidate SHA equals THIS deployment's commit SHA;
//   5. the claimed deployment id equals THIS deployment's id (a foreign
//      deployment id is refused even when everything else matches);
//   6. the live dataset lease exists, is unexpired, and its owner is exactly
//      `runId:candidateSha:deploymentId`.
//
// Anything else fails closed: no ownership is stamped, and the login event is
// written exactly as an ordinary one (so authentication itself never breaks).
//
// Ownership is NEVER inferred from email, member id, provider, timestamp, branch,
// or fixture ids. The collision boundary is the cryptographically random run id
// plus the recorded deployment id plus the unique per-sign-in attempt id.
//
// Everything except `resolveVerificationOwnership` and `createLoginEvent` is
// pure, so `app/utils/__tests__/srVerificationLoginEvent.test.ts` proves the gate
// offline, with no Sanity client and no network.

import { serverClient } from "@/sanity/lib/serverClient";

import {
  VERIFICATION_MARKER_VALUE,
  evaluateVerificationEnvironment,
  resolveVerificationEnvironment,
  type EnvLike,
} from "./srVerificationIdentity";

/* ------------------------------------------------------------------ *
 * Wire contract
 * ------------------------------------------------------------------ */

/**
 * The dedicated request headers. All five carry NON-SECRET run provenance only —
 * there is deliberately no shared secret here, because a secret in a header would
 * become the thing that authorises the write. Authorisation comes from the
 * server's own environment plus the live dataset lease, neither of which the
 * caller can influence.
 */
export const VERIFICATION_HEADERS = Object.freeze({
  marker: "x-sr-verification-marker",
  runId: "x-sr-verification-run-id",
  attemptId: "x-sr-verification-attempt-id",
  candidateSha: "x-sr-verification-candidate-sha",
  deploymentId: "x-sr-verification-deployment-id",
} as const);

/** Deterministic exclusive-lease document id (mirrors `LEASE_DOC_ID` in scripts/lib/sr-verification.mjs). */
export const LEASE_DOC_ID = "serviceReadiness.verificationLease";

/**
 * The four optional ownership fields on `loginEvent`. Exported so the schema
 * test and the guarded reset path can assert the same closed set.
 */
export const LOGIN_EVENT_OWNERSHIP_FIELDS = Object.freeze([
  "runId",
  "attemptId",
  "candidateSha",
  "deploymentId",
] as const);

/**
 * Accepted id shape. No `:` (it is the lease-owner separator, so a colon in a
 * part could alias another run's owner string), bounded length, and a
 * conservative charset so nothing token-shaped or path-shaped slips through.
 */
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/;

function wellFormedId(value: string | null): boolean {
  return typeof value === "string" && ID_PATTERN.test(value);
}

/* ------------------------------------------------------------------ *
 * Header reading
 * ------------------------------------------------------------------ */

/** NextAuth v4 hands `authorize` a plain lower-cased header record; `Headers` is accepted too. */
export type HeadersLike =
  | Headers
  | Readonly<Record<string, string | string[] | undefined>>
  | null
  | undefined;

export interface VerificationTicket {
  marker: string | null;
  runId: string | null;
  attemptId: string | null;
  candidateSha: string | null;
  deploymentId: string | null;
}

function headerValue(headers: HeadersLike, name: string): string | null {
  if (!headers) return null;
  if (typeof (headers as Headers).get === "function") {
    const raw = (headers as Headers).get(name);
    return typeof raw === "string" && raw.trim().length ? raw.trim() : null;
  }
  const record = headers as Readonly<Record<string, string | string[] | undefined>>;
  // Header names are case-insensitive; NextAuth lower-cases them, but never rely on it.
  const key = Object.keys(record).find((k) => k.toLowerCase() === name);
  const raw = key === undefined ? undefined : record[key];
  // A repeated header is ambiguous about which run is claiming the sign-in —
  // refuse it rather than picking one.
  if (Array.isArray(raw)) return null;
  return typeof raw === "string" && raw.trim().length ? raw.trim() : null;
}

/**
 * Read the ticket off a request. `present` is true when the request supplied ANY
 * verification header at all: a partially-supplied ticket must be REFUSED, not
 * silently treated as an ordinary sign-in, or a truncated ticket would quietly
 * create an unowned (and therefore uncleanable) login event.
 */
export function readVerificationHeaders(headers: HeadersLike): {
  present: boolean;
  ticket: VerificationTicket;
} {
  const ticket: VerificationTicket = {
    marker: headerValue(headers, VERIFICATION_HEADERS.marker),
    runId: headerValue(headers, VERIFICATION_HEADERS.runId),
    attemptId: headerValue(headers, VERIFICATION_HEADERS.attemptId),
    candidateSha: headerValue(headers, VERIFICATION_HEADERS.candidateSha),
    deploymentId: headerValue(headers, VERIFICATION_HEADERS.deploymentId),
  };
  // `present` must also be true when a header was supplied but unusable (empty,
  // repeated) — so check the raw names, not the parsed values.
  const anyRawHeader = Object.values(VERIFICATION_HEADERS).some((name) => hasHeader(headers, name));
  return { present: anyRawHeader, ticket };
}

function hasHeader(headers: HeadersLike, name: string): boolean {
  if (!headers) return false;
  if (typeof (headers as Headers).has === "function") return (headers as Headers).has(name);
  const record = headers as Readonly<Record<string, string | string[] | undefined>>;
  return Object.keys(record).some((k) => k.toLowerCase() === name && record[k] !== undefined);
}

/* ------------------------------------------------------------------ *
 * The ownership gate (pure)
 * ------------------------------------------------------------------ */

export type OwnershipReason =
  | "unmarked_request"
  | "incomplete_ticket"
  | "malformed_ticket"
  | "marker_mismatch"
  | "environment_refused"
  | "candidate_sha_unavailable"
  | "candidate_sha_mismatch"
  | "deployment_id_unavailable"
  | "foreign_deployment"
  | "lease_missing"
  | "lease_malformed"
  | "foreign_lease"
  | "lease_expired";

export interface VerificationOwnership {
  runId: string;
  attemptId: string;
  candidateSha: string;
  deploymentId: string;
}

export interface OwnershipDecision {
  /** The request claimed verification ownership (any header supplied). */
  marked: boolean;
  ok: boolean;
  reason: OwnershipReason | null;
  ownership: VerificationOwnership | null;
}

export interface LeaseLike {
  owner?: unknown;
  expiresAt?: unknown;
}

/** Lease owner is the exact `runId:candidateSha:deploymentId` triple. */
export function leaseOwnerString(ticket: {
  runId: string;
  candidateSha: string;
  deploymentId: string;
}): string {
  return `${ticket.runId}:${ticket.candidateSha}:${ticket.deploymentId}`;
}

function leaseUsable(lease: LeaseLike | null | undefined): lease is { owner: string; expiresAt: string } {
  return (
    !!lease &&
    typeof lease.owner === "string" &&
    lease.owner.length > 0 &&
    typeof lease.expiresAt === "string" &&
    !Number.isNaN(Date.parse(lease.expiresAt))
  );
}

/**
 * Everything the deployment can decide WITHOUT reading the lease. Split out so
 * `resolveVerificationOwnership` can refuse a marked request in production
 * before performing any I/O at all.
 */
export function evaluateTicketPreconditions({
  present,
  ticket,
  env,
}: {
  present: boolean;
  ticket: VerificationTicket;
  env: EnvLike;
}): OwnershipDecision {
  if (!present) {
    return { marked: false, ok: false, reason: "unmarked_request", ownership: null };
  }

  const refuse = (reason: OwnershipReason): OwnershipDecision => ({
    marked: true,
    ok: false,
    reason,
    ownership: null,
  });

  // The deployment must itself be an isolated verification deployment. Checked
  // before anything caller-supplied is trusted.
  if (!evaluateVerificationEnvironment(env).ok) return refuse("environment_refused");

  if (ticket.marker === null) return refuse("incomplete_ticket");
  if (ticket.marker !== VERIFICATION_MARKER_VALUE) return refuse("marker_mismatch");

  const { runId, attemptId, candidateSha, deploymentId } = ticket;
  if (runId === null || attemptId === null || candidateSha === null || deploymentId === null) {
    return refuse("incomplete_ticket");
  }
  for (const part of [runId, attemptId, candidateSha, deploymentId]) {
    if (!wellFormedId(part)) return refuse("malformed_ticket");
  }

  const resolved = resolveVerificationEnvironment(env);
  if (!resolved.gitCommitSha) return refuse("candidate_sha_unavailable");
  if (resolved.gitCommitSha !== candidateSha) return refuse("candidate_sha_mismatch");
  if (!resolved.deploymentId) return refuse("deployment_id_unavailable");
  if (resolved.deploymentId !== deploymentId) return refuse("foreign_deployment");

  return {
    marked: true,
    ok: true,
    reason: null,
    ownership: { runId, attemptId, candidateSha, deploymentId },
  };
}

/**
 * The complete gate: preconditions plus the live dataset lease. `lease` is the
 * freshly-read lease document (or `null` when absent).
 */
export function evaluateVerificationOwnership({
  present,
  ticket,
  env,
  lease,
  now,
}: {
  present: boolean;
  ticket: VerificationTicket;
  env: EnvLike;
  lease: LeaseLike | null;
  now: string | number | Date;
}): OwnershipDecision {
  const pre = evaluateTicketPreconditions({ present, ticket, env });
  if (!pre.ok || !pre.ownership) return pre;

  const refuse = (reason: OwnershipReason): OwnershipDecision => ({
    marked: true,
    ok: false,
    reason,
    ownership: null,
  });

  if (!lease) return refuse("lease_missing");
  if (!leaseUsable(lease)) return refuse("lease_malformed");
  if (lease.owner !== leaseOwnerString(pre.ownership)) return refuse("foreign_lease");
  if (Date.parse(lease.expiresAt) <= new Date(now).getTime()) return refuse("lease_expired");

  return pre;
}

/* ------------------------------------------------------------------ *
 * The login event document
 * ------------------------------------------------------------------ */

export interface LoginEventDocument {
  _type: "loginEvent";
  member: { _type: "reference"; _ref: string };
  email: string;
  provider: string;
  timestamp: string;
  runId?: string;
  attemptId?: string;
  candidateSha?: string;
  deploymentId?: string;
}

/** Only the four ownership fields, and only when ownership was proven. */
export function verificationOwnershipFields(
  ownership: VerificationOwnership | null,
): Partial<Pick<LoginEventDocument, "runId" | "attemptId" | "candidateSha" | "deploymentId">> {
  if (!ownership) return {};
  return {
    runId: ownership.runId,
    attemptId: ownership.attemptId,
    candidateSha: ownership.candidateSha,
    deploymentId: ownership.deploymentId,
  };
}

/**
 * Build the document. With `ownership: null` the result is byte-for-byte the
 * document `auth.ts` has always written — the ordinary sign-in path gains no
 * field, no marker and no behaviour change.
 */
export function buildLoginEventDocument({
  memberId,
  email,
  provider,
  timestamp,
  ownership = null,
}: {
  memberId: string;
  email: string;
  provider: string;
  timestamp: string;
  ownership?: VerificationOwnership | null;
}): LoginEventDocument {
  return {
    _type: "loginEvent",
    member: { _type: "reference", _ref: memberId },
    email,
    provider,
    timestamp,
    ...verificationOwnershipFields(ownership),
  };
}

/** The redacted structured record. Run/deployment/attempt/event ids ONLY. */
export interface VerificationLoginEventRecord {
  event: "verification_login_event_created";
  runId: string;
  deploymentId: string;
  attemptId: string;
  eventId: string | null;
}

export function redactedLoginEventRecord({
  ownership,
  eventId,
}: {
  ownership: VerificationOwnership;
  eventId: string | null;
}): VerificationLoginEventRecord {
  return {
    event: "verification_login_event_created",
    runId: ownership.runId,
    deploymentId: ownership.deploymentId,
    attemptId: ownership.attemptId,
    eventId,
  };
}

/** Minimal client surface, so tests never need a Sanity client. */
export interface LoginEventWriter {
  create(doc: LoginEventDocument): Promise<{ _id?: string } | undefined>;
}

/**
 * Create the login event and CAPTURE the returned `_id`. For an owned event the
 * redacted `verification_login_event_created` record is emitted so the harness
 * can reconcile the exact created ids against its expected attempt ids.
 */
export async function createLoginEvent({
  client,
  memberId,
  email,
  provider,
  timestamp,
  ownership = null,
  logger = console,
}: {
  client: LoginEventWriter;
  memberId: string;
  email: string;
  provider: string;
  timestamp: string;
  ownership?: VerificationOwnership | null;
  logger?: Pick<Console, "log">;
}): Promise<string | null> {
  const created = await client.create(
    buildLoginEventDocument({ memberId, email, provider, timestamp, ownership }),
  );
  const eventId = typeof created?._id === "string" && created._id.length ? created._id : null;
  if (ownership) {
    logger.log(JSON.stringify(redactedLoginEventRecord({ ownership, eventId })));
  }
  return eventId;
}

/* ------------------------------------------------------------------ *
 * The one impure entry point, used by auth.ts
 * ------------------------------------------------------------------ */

async function readLeaseDocument(): Promise<LeaseLike | null> {
  try {
    const doc = await serverClient.getDocument<LeaseLike>(LEASE_DOC_ID);
    return doc ?? null;
  } catch {
    return null;
  }
}

/**
 * Resolve run ownership for one credentials sign-in.
 *
 * Returns `null` for every non-verification case, which is the ordinary path:
 * an unmarked request performs NO extra read and produces NO extra field. A
 * marked request in a non-verification deployment is refused before any I/O.
 */
export async function resolveVerificationOwnership({
  headers,
  env = process.env as EnvLike,
  now = new Date().toISOString(),
  readLease = readLeaseDocument,
  logger = console,
}: {
  headers: HeadersLike;
  env?: EnvLike;
  now?: string | number | Date;
  readLease?: () => Promise<LeaseLike | null>;
  logger?: Pick<Console, "warn">;
}): Promise<VerificationOwnership | null> {
  const { present, ticket } = readVerificationHeaders(headers);
  if (!present) return null;

  const pre = evaluateTicketPreconditions({ present, ticket, env });
  if (!pre.ok) {
    // Reason only — never a header value, never a secret.
    logger.warn(`[sr-verification] login-event ownership refused: ${pre.reason}`);
    return null;
  }

  const lease = await readLease();
  const decision = evaluateVerificationOwnership({ present, ticket, env, lease, now });
  if (!decision.ok) {
    logger.warn(`[sr-verification] login-event ownership refused: ${decision.reason}`);
    return null;
  }
  return decision.ownership;
}
