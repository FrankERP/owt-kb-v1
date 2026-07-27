// Service Readiness A3 §4 "Run-owned credentials login events" — the harness side
// of the ownership contract.
//
// The real credentials sign-in fires `auth.ts`'s `events.signIn`, which creates a
// `loginEvent` with a RANDOM id. During deployed verification those documents are
// run side effects, and the run must delete exactly its own by explicit `_id`.
// That is only possible if ownership is stamped at creation time, which is what
// these headers do.
//
// WHY the names are mirrored rather than imported: `app/utils/srVerificationLoginEvent.ts`
// is `import "server-only"` and pulls in `@/sanity/lib/serverClient`. Importing it
// into a Playwright worker would drag the app's server runtime into the harness. So
// the five header names are duplicated here and
// `e2e/service-readiness/__tests__/runIdentity.test.ts` asserts every one of them
// against that module's SOURCE, so the two can never drift apart silently.
//
// There is deliberately NO shared secret in these headers. They carry non-secret
// run provenance only; the server authorizes the ownership stamp from its OWN
// environment plus the live dataset lease, neither of which the caller can
// influence. A header set the server does not like fails closed — the sign-in
// still succeeds, it simply produces an unowned event, which the harness detects
// as a missing event and fails the scenario on.

import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { VERIFICATION_MARKER_VALUE } from "./harnessGuards";
import { ATTEMPT_LEDGER_FILE } from "./runState";

/**
 * MIRROR of `VERIFICATION_HEADERS` in app/utils/srVerificationLoginEvent.ts.
 * Pinned by a source-parity test — do not edit one side alone.
 */
export const VERIFICATION_HEADERS = Object.freeze({
  marker: "x-sr-verification-marker",
  runId: "x-sr-verification-run-id",
  attemptId: "x-sr-verification-attempt-id",
  candidateSha: "x-sr-verification-candidate-sha",
  deploymentId: "x-sr-verification-deployment-id",
} as const);

/**
 * MIRROR of the server's accepted id shape (`ID_PATTERN`). Generated ids are
 * validated against it locally, so a malformed attempt id is caught in the runner
 * instead of silently producing an unowned login event on the deployment.
 */
export const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/;

export interface RunIdentity {
  runId: string;
  candidateSha: string;
  deploymentId: string;
}

/**
 * A collision-resistant run id. 128 bits of `randomBytes` hex, prefixed so it is
 * recognizable in evidence. The plan's collision boundary is exactly this random
 * run id plus the recorded deployment id plus a unique per-sign-in attempt id —
 * ownership is never inferred from email, member id, provider, timestamp, branch,
 * or fixture ids.
 */
export function generateRunId(): string {
  return `srvrun-${randomBytes(16).toString("hex")}`;
}

/** A unique per-sign-in attempt id. One per awaited sign-in, never reused. */
export function generateAttemptId(): string {
  return `srvatt-${randomBytes(12).toString("hex")}`;
}

export function isWellFormedId(value: string): boolean {
  return ID_PATTERN.test(value);
}

/**
 * The five headers for one sign-in attempt.
 *
 * Every part is validated first: a malformed id would be refused server-side as
 * `malformed_ticket`, producing an UNOWNED (and therefore uncleanable) login
 * event, so the harness refuses to send it at all.
 */
export function verificationHeaders(
  identity: RunIdentity,
  attemptId: string,
): Record<string, string> {
  for (const [name, value] of Object.entries({ ...identity, attemptId })) {
    if (typeof value !== "string" || !isWellFormedId(value)) {
      throw new Error(
        `Refusing to send verification headers: "${name}" is not a well-formed id. ` +
          `An unowned login event cannot be cleaned up by exact id.`,
      );
    }
    if (value.includes(":")) {
      throw new Error(
        `Refusing to send verification headers: "${name}" contains ":", the lease-owner separator.`,
      );
    }
  }
  return {
    [VERIFICATION_HEADERS.marker]: VERIFICATION_MARKER_VALUE,
    [VERIFICATION_HEADERS.runId]: identity.runId,
    [VERIFICATION_HEADERS.attemptId]: attemptId,
    [VERIFICATION_HEADERS.candidateSha]: identity.candidateSha,
    [VERIFICATION_HEADERS.deploymentId]: identity.deploymentId,
  };
}

/** `runId:candidateSha:deploymentId` — the exact dataset-lease owner string. */
export function leaseOwnerString(identity: RunIdentity): string {
  return `${identity.runId}:${identity.candidateSha}:${identity.deploymentId}`;
}

/* ------------------------------------------------------------------ *
 * Attempt bookkeeping
 * ------------------------------------------------------------------ */

/**
 * Where a ledger keeps its attempt ids. Injected so the pure in-memory behaviour
 * stays unit-testable with no filesystem, while the real run uses the run-scoped
 * file store below.
 */
export interface AttemptStore {
  read(): string[];
  append(attemptId: string): void;
}

/** Process-local store. Adequate only when one ledger serves the whole run. */
export function memoryAttemptStore(): AttemptStore {
  const attempts = new Set<string>();
  return {
    read: () => [...attempts],
    append: (attemptId) => void attempts.add(attemptId),
  };
}

function attemptLedgerPath(file: string): string {
  return resolve(process.cwd(), file);
}

/**
 * Run-scoped, file-backed store.
 *
 * Every line carries the run id it belongs to and reads FILTER on it, so a stale
 * file from an earlier run can never inject an attempt id this run never used —
 * which would surface as a bogus `missing_event`. `resetAttemptLedger` still
 * truncates it at run start; the run-id filter is the belt to that braces.
 */
export function fileAttemptStore(runId: string, file: string = ATTEMPT_LEDGER_FILE): AttemptStore {
  const path = attemptLedgerPath(file);
  return {
    read() {
      if (!existsSync(path)) return [];
      const ids: string[] = [];
      for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line) as { runId?: unknown; attemptId?: unknown };
          if (parsed.runId !== runId) continue;
          if (typeof parsed.attemptId === "string" && isWellFormedId(parsed.attemptId)) {
            ids.push(parsed.attemptId);
          }
        } catch {
          continue;
        }
      }
      return ids;
    },
    append(attemptId) {
      mkdirSync(dirname(path), { recursive: true });
      appendFileSync(
        path,
        `${JSON.stringify({ runId, attemptId, at: new Date().toISOString() })}\n`,
        "utf8",
      );
    },
  };
}

/** Drop any previous run's ledger. Called once, by the global setup. */
export function resetAttemptLedger(file: string = ATTEMPT_LEDGER_FILE): void {
  rmSync(attemptLedgerPath(file), { force: true });
}

/**
 * The set of attempt ids this run has actually signed in with, recorded so the
 * post-sign-in reconciliation can require EXACTLY these and nothing else. A
 * missing, duplicate, foreign or late event fails the scenario.
 *
 * The ledger is RUN-scoped, matching the run-scoped ownership predicate it is
 * reconciled against — see `ATTEMPT_LEDGER_FILE`.
 */
export class AttemptLedger {
  constructor(private readonly store: AttemptStore = memoryAttemptStore()) {}

  next(): string {
    const used = new Set(this.store.read());
    let id = generateAttemptId();
    // Defensive: a repeat would make two sign-ins indistinguishable.
    while (used.has(id)) id = generateAttemptId();
    this.store.append(id);
    return id;
  }

  expected(): string[] {
    return [...new Set(this.store.read())].sort();
  }

  has(attemptId: unknown): boolean {
    return typeof attemptId === "string" && this.store.read().includes(attemptId);
  }
}

export interface LoginEventLike {
  _id?: unknown;
  runId?: unknown;
  attemptId?: unknown;
  candidateSha?: unknown;
  deploymentId?: unknown;
}

export type ReconcileFailureCode =
  | "missing_event"
  | "duplicate_event"
  | "foreign_event"
  | "unexpected_attempt";

export interface ReconcileFailure {
  code: ReconcileFailureCode;
  attemptId: string | null;
  eventId: string | null;
}

/**
 * Reconcile the documents returned by the exact run/deployment ownership predicate
 * against the attempt ids this run actually used.
 *
 * All four failure modes the plan names are distinguished:
 *   · `missing_event`      an awaited sign-in produced no owned event
 *   · `duplicate_event`    two events claim the same attempt id
 *   · `foreign_event`      an event's full ownership tuple does not match this run
 *   · `unexpected_attempt` an owned event carries an attempt id we never used
 *                          (this is the "late event" signal)
 */
export function reconcileLoginEvents({
  events,
  identity,
  expectedAttemptIds,
}: {
  events: readonly LoginEventLike[];
  identity: RunIdentity;
  expectedAttemptIds: readonly string[];
}): { ok: boolean; failures: ReconcileFailure[]; matchedIds: string[] } {
  const failures: ReconcileFailure[] = [];
  const seen = new Map<string, string[]>();
  const matchedIds: string[] = [];

  for (const doc of events) {
    const eventId = typeof doc._id === "string" ? doc._id : null;
    const attemptId = typeof doc.attemptId === "string" ? doc.attemptId : null;
    if (
      doc.runId !== identity.runId ||
      doc.candidateSha !== identity.candidateSha ||
      doc.deploymentId !== identity.deploymentId ||
      !attemptId
    ) {
      failures.push({ code: "foreign_event", attemptId, eventId });
      continue;
    }
    if (!expectedAttemptIds.includes(attemptId)) {
      failures.push({ code: "unexpected_attempt", attemptId, eventId });
      continue;
    }
    seen.set(attemptId, [...(seen.get(attemptId) ?? []), eventId ?? "(no id)"]);
    if (eventId) matchedIds.push(eventId);
  }

  for (const [attemptId, ids] of seen) {
    if (ids.length > 1) failures.push({ code: "duplicate_event", attemptId, eventId: ids.join(",") });
  }
  for (const attemptId of expectedAttemptIds) {
    if (!seen.has(attemptId)) failures.push({ code: "missing_event", attemptId, eventId: null });
  }

  return { ok: failures.length === 0, failures, matchedIds: matchedIds.sort() };
}
