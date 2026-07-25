// The publish-ready transaction helper (Service Readiness A2 §6, for Plan B).
//
// Plan B computes readiness ONCE (role, coordination token, live setlist,
// proposal, and every assigned member's availability) and then wants to act on
// that computation atomically. This helper turns exactly those observed
// states/revisions into ONE guarded transaction, so a publish either happens
// against precisely the state that was judged ready, or does not happen at all.
//
// The planning half is pure (an explicit op list, exhaustively testable); the
// executor half only replays that list onto a Sanity transaction. Every op is a
// PROVEN primitive: `patch(id, p => p.ifRevisionId(rev).set(...))` (revision
// guard) and `patch(...).ifRevisionId(rev).unset([...])` for an absent field.
// `_type` is never sent — it is immutable per document id.
//
// What is asserted:
//  - the service role, plus its weekend target lock (or, for a special service,
//    the role's own revision — a special service takes no weekend lock)
//  - the live setlist singleton id/revision, or an explicit `none`; a weekend
//    absence is protected by the SAME lock every deterministic setlist create
//    must heartbeat, so "there is still no setlist" cannot silently change
//  - the shared proposal singleton id/revision, or an explicit absence protected
//    by that same coordination token
//  - every assigned member revision used for availability, across all five seat
//    paths
//
// Member availability IS assertable with the installed client without changing
// availability data: each member op writes back the exact `unavailableDates`
// value that the readiness computation read (or unsets a field that is already
// absent), under `ifRevisionId`. That is a data no-op with a revision
// precondition. An unrelated member write (e.g. a `lastSeen` update) can
// therefore cause a conservative false conflict, but it can never allow a
// publish based on stale availability.

import "server-only";

export interface RevisionedDocument {
  id: string;
  rev: string;
}

/** A member's availability exactly as the readiness computation observed it. */
export interface ObservedMemberAvailability {
  id: string;
  rev: string;
  /** The observed `unavailableDates`; `null`/absent means the field is not stored. */
  unavailableDates?: readonly string[] | null;
}

export type ObservedSingleton =
  | { state: "single"; id: string; rev: string }
  | { state: "none" };

export interface PublishReadyAssertion {
  /** The service role being published, at the revision readiness was computed from. */
  role: RevisionedDocument & {
    /** `week` for a weekend service, `date` for a special one. */
    dateField: "week" | "date";
    /** The observed stored date — written back unchanged as the guard's no-op. */
    date: string;
  };
  /**
   * The owned weekend target lock. `null` for a special service (its own revision
   * serializes it) — and a weekend assertion without a lock is refused, because
   * setlist/proposal ABSENCE would then be unprotected.
   */
  lock: RevisionedDocument | null;
  /** True for a special service, which stores its songs on the role itself. */
  special: boolean;
  setlist: ObservedSingleton;
  /** The observed `week` of a singleton weekend setlist (its no-op guard value). */
  setlistWeek?: string | null;
  proposal: ObservedSingleton;
  /** The observed `service_date` of a singleton proposal (its no-op guard value). */
  proposalServiceDate?: string | null;
  /** Every assigned member across all five seat paths. */
  members: readonly ObservedMemberAvailability[];
}

export interface AssertionOp {
  kind: "assert";
  id: string;
  rev: string;
  set: Record<string, unknown>;
  unset: string[];
  /** What this op protects, for diagnostics. */
  subject: "role" | "lock" | "setlist" | "proposal" | "member";
}

export type PublishReadyPlan =
  | { ok: true; ops: AssertionOp[] }
  | { ok: false; issues: string[] };

function nonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

function revisioned(doc: unknown): doc is RevisionedDocument {
  const d = doc as RevisionedDocument | null;
  return !!d && nonEmptyString(d.id) && nonEmptyString(d.rev);
}

/**
 * Plan the assertions for ONE readiness computation. Returns explicit issues
 * instead of a partially guarded plan: a missing revision, a weekend assertion
 * with no coordination token, or a singleton with no no-op guard value all fail
 * closed BEFORE anything is committed.
 */
export function planPublishReadyAssertions(input: PublishReadyAssertion): PublishReadyPlan {
  const issues: string[] = [];
  const ops: AssertionOp[] = [];

  if (!revisioned(input.role) || !nonEmptyString(input.role.date)) {
    issues.push("role");
  } else {
    ops.push({
      kind: "assert",
      id: input.role.id,
      rev: input.role.rev,
      // Writing the observed date back is a data no-op with a revision guard.
      set: { [input.role.dateField]: input.role.date },
      unset: [],
      subject: "role",
    });
  }

  if (input.special) {
    if (input.lock) issues.push("special_lock");
  } else if (!revisioned(input.lock)) {
    // Without the owned token, a weekend `none` (no setlist / no proposal yet) is
    // unprotected: a concurrent deterministic create heartbeats this very lock.
    issues.push("lock");
  } else {
    ops.push({
      kind: "assert",
      id: input.lock.id,
      rev: input.lock.rev,
      set: {},
      unset: [],
      subject: "lock",
    });
  }

  if (input.setlist.state === "single") {
    if (input.special) {
      // The special role IS the setlist target; the role assertion above covers it.
      if (input.setlist.id !== input.role.id) issues.push("setlist_identity");
    } else if (!nonEmptyString(input.setlistWeek)) {
      issues.push("setlist_week");
    } else {
      ops.push({
        kind: "assert",
        id: input.setlist.id,
        rev: input.setlist.rev,
        set: { week: input.setlistWeek },
        unset: [],
        subject: "setlist",
      });
    }
  }

  if (input.proposal.state === "single") {
    if (!nonEmptyString(input.proposalServiceDate)) {
      issues.push("proposal_service_date");
    } else {
      ops.push({
        kind: "assert",
        id: input.proposal.id,
        rev: input.proposal.rev,
        set: { service_date: input.proposalServiceDate },
        unset: [],
        subject: "proposal",
      });
    }
  }

  const seen = new Set<string>();
  for (const member of input.members ?? []) {
    if (!revisioned(member)) {
      issues.push("member");
      continue;
    }
    if (seen.has(member.id)) continue;
    seen.add(member.id);
    const dates = member.unavailableDates;
    ops.push({
      kind: "assert",
      id: member.id,
      rev: member.rev,
      // Availability data is never changed: either the exact observed array is
      // written back, or an already-absent field is unset.
      set: Array.isArray(dates) ? { unavailableDates: [...dates] } : {},
      unset: Array.isArray(dates) ? [] : ["unavailableDates"],
      subject: "member",
    });
  }

  if (issues.length) return { ok: false, issues };
  return { ok: true, ops };
}

/** The minimal transaction surface this helper needs (mockable in tests). */
export interface GuardedTransaction<T> {
  patch(
    id: string,
    fn: (p: {
      ifRevisionId(rev: string): unknown;
      set(values: Record<string, unknown>): unknown;
      unset(fields: string[]): unknown;
    }) => unknown,
  ): T;
}

/**
 * Apply a planned assertion list to a transaction, returning it for the caller to
 * append its own business ops to and commit. Every op is revision-guarded, so any
 * conflict rolls the WHOLE transaction back — a publish never lands on state that
 * moved after readiness was computed.
 */
export function applyPublishReadyAssertions<T extends GuardedTransaction<T>>(
  tx: T,
  ops: readonly AssertionOp[],
): T {
  let out = tx;
  for (const op of ops) {
    out = out.patch(op.id, (p) => {
      let chain = p.ifRevisionId(op.rev) as typeof p;
      chain = chain.set(op.set) as typeof p;
      if (op.unset.length) chain = chain.unset(op.unset) as typeof p;
      return chain;
    });
  }
  return out;
}
