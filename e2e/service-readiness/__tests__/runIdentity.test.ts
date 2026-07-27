// Offline proof of the A3 §4 run-ownership contract.
//
// The most important test in this file is the PARITY test: the harness mirrors the
// five `x-sr-verification-*` header names instead of importing them (the server module
// is `import "server-only"`), so the mirror is asserted against that module's SOURCE.
// If either side is renamed alone, this fails — which is the whole point, because a
// renamed header would silently produce login events nothing can clean up.

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

import { VERIFICATION_MARKER_VALUE } from "../lib/harnessGuards";
import {
  AttemptLedger,
  ID_PATTERN,
  VERIFICATION_HEADERS,
  fileAttemptStore,
  generateAttemptId,
  generateRunId,
  isWellFormedId,
  leaseOwnerString,
  reconcileLoginEvents,
  resetAttemptLedger,
  verificationHeaders,
  type RunIdentity,
} from "../lib/runIdentity";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const SERVER_MODULE = "app/utils/srVerificationLoginEvent.ts";

const IDENTITY: RunIdentity = {
  runId: "srvrun-0123456789abcdef0123456789abcdef",
  candidateSha: "0123456789abcdef0123456789abcdef01234567",
  deploymentId: "dpl_0123456789abcdef",
};

/** An owned event minus its attempt id, for the ledger reconciliation cases. */
const OWNED = {
  runId: IDENTITY.runId,
  candidateSha: IDENTITY.candidateSha,
  deploymentId: IDENTITY.deploymentId,
};

/** A throwaway ledger path per case, outside the repository. */
const TMP_ROOT = mkdtempSync(path.join(tmpdir(), "sr-attempt-ledger-"));
let tmpSeq = 0;
function ledgerFile(): string {
  return path.join(TMP_ROOT, `attempts-${tmpSeq++}.log`);
}
afterAll(() => rmSync(TMP_ROOT, { recursive: true, force: true }));

describe("verification header parity with the server module", () => {
  const source = readFileSync(path.join(REPO_ROOT, SERVER_MODULE), "utf8");

  it("mirrors all five header names exactly, and adds none of its own", () => {
    const expected = {
      marker: "x-sr-verification-marker",
      runId: "x-sr-verification-run-id",
      attemptId: "x-sr-verification-attempt-id",
      candidateSha: "x-sr-verification-candidate-sha",
      deploymentId: "x-sr-verification-deployment-id",
    };
    expect({ ...VERIFICATION_HEADERS }).toEqual(expected);

    // Each name must literally appear in the server module's VERIFICATION_HEADERS.
    const block = /export const VERIFICATION_HEADERS = Object\.freeze\(\{([\s\S]*?)\}\s*as const\)/.exec(
      source,
    );
    expect(block, `${SERVER_MODULE} no longer declares VERIFICATION_HEADERS`).not.toBeNull();
    for (const [key, name] of Object.entries(expected)) {
      expect(block?.[1], `${key} header`).toContain(`${key}: "${name}"`);
    }
    // The server declares exactly five; a sixth would need a mirror here too.
    expect((block?.[1].match(/:\s*"x-sr-verification-/g) ?? []).length).toBe(5);
  });

  it("mirrors the server's accepted id shape", () => {
    expect(source).toContain("const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/");
    expect(ID_PATTERN.source).toBe("^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$");
  });

  it("mirrors the lease-owner string the server computes", () => {
    expect(source).toContain("`${ticket.runId}:${ticket.candidateSha}:${ticket.deploymentId}`");
    expect(leaseOwnerString(IDENTITY)).toBe(
      `${IDENTITY.runId}:${IDENTITY.candidateSha}:${IDENTITY.deploymentId}`,
    );
  });
});

describe("generated ids", () => {
  it("produces well-formed, collision-resistant run and attempt ids", () => {
    for (let i = 0; i < 25; i++) {
      expect(isWellFormedId(generateRunId())).toBe(true);
      expect(isWellFormedId(generateAttemptId())).toBe(true);
    }
    const runs = new Set(Array.from({ length: 200 }, generateRunId));
    expect(runs.size).toBe(200);
  });

  it("rejects ids that are too short, oddly prefixed, or contain the lease separator", () => {
    expect(isWellFormedId("short")).toBe(false);
    expect(isWellFormedId("_leading-underscore")).toBe(false);
    expect(isWellFormedId("has:colon:inside")).toBe(false);
    expect(isWellFormedId("has spaces here")).toBe(false);
  });
});

describe("verification headers", () => {
  it("sends the marker plus the four non-secret provenance ids", () => {
    const attemptId = generateAttemptId();
    expect(verificationHeaders(IDENTITY, attemptId)).toEqual({
      "x-sr-verification-marker": VERIFICATION_MARKER_VALUE,
      "x-sr-verification-run-id": IDENTITY.runId,
      "x-sr-verification-attempt-id": attemptId,
      "x-sr-verification-candidate-sha": IDENTITY.candidateSha,
      "x-sr-verification-deployment-id": IDENTITY.deploymentId,
    });
  });

  it("REFUSES to send a malformed ticket rather than create an unowned login event", () => {
    expect(() => verificationHeaders(IDENTITY, "tiny")).toThrow(/well-formed id/);
    expect(() => verificationHeaders({ ...IDENTITY, runId: "a:b" }, generateAttemptId())).toThrow();
    expect(() =>
      verificationHeaders({ ...IDENTITY, deploymentId: "" }, generateAttemptId()),
    ).toThrow();
  });

  it("carries no secret at all — authorization is the server's env plus the lease", () => {
    const headers = verificationHeaders(IDENTITY, generateAttemptId());
    for (const value of Object.values(headers)) {
      expect(value).not.toMatch(/^sk/); // not a Sanity token
    }
    expect(Object.keys(headers)).toHaveLength(5);
  });
});

describe("attempt ledger", () => {
  it("hands out a unique attempt id per sign-in and remembers them all", () => {
    const ledger = new AttemptLedger();
    const ids = [ledger.next(), ledger.next(), ledger.next()];
    expect(new Set(ids).size).toBe(3);
    expect(ledger.expected()).toEqual([...ids].sort());
    expect(ledger.has(ids[0])).toBe(true);
    expect(ledger.has("never-used")).toBe(false);
  });

  // The regression this guards: `fetchOwnedLoginEvents` matches on
  // runId+candidateSha+deploymentId, so it returns every event the RUN created. A
  // per-test in-memory ledger saw only its own sign-in and reported every earlier
  // scenario's legitimate event as `unexpected_attempt`. The ledger's store is
  // therefore run-scoped and shared, so separate ledger INSTANCES — which is what
  // a per-test Playwright fixture creates — still reconcile against the whole run.
  it("is RUN-scoped: separate instances sharing a store see every attempt", () => {
    const store = fileAttemptStore("srvrun-shared", ledgerFile());
    const first = new AttemptLedger(store).next();
    const second = new AttemptLedger(store).next();

    const third = new AttemptLedger(store);
    expect(third.expected()).toEqual([first, second].sort());
    expect(third.has(first)).toBe(true);

    const verdict = reconcileLoginEvents({
      events: [
        { ...OWNED, attemptId: first, _id: "ev1" },
        { ...OWNED, attemptId: second, _id: "ev2" },
      ],
      identity: IDENTITY,
      expectedAttemptIds: third.expected(),
    });
    expect(verdict.failures).toEqual([]);
  });

  it("ignores another run's entries, so a stale file cannot fake a missing event", () => {
    const file = ledgerFile();
    const mine = new AttemptLedger(fileAttemptStore("srvrun-mine", file)).next();
    new AttemptLedger(fileAttemptStore("srvrun-theirs", file)).next();

    expect(new AttemptLedger(fileAttemptStore("srvrun-mine", file)).expected()).toEqual([mine]);
  });

  it("resetAttemptLedger drops the file entirely", () => {
    const file = ledgerFile();
    new AttemptLedger(fileAttemptStore("srvrun-mine", file)).next();
    resetAttemptLedger(file);
    expect(new AttemptLedger(fileAttemptStore("srvrun-mine", file)).expected()).toEqual([]);
  });
});

describe("login-event reconciliation", () => {
  const attempt = "srvatt-000000000000000000";
  const owned = (overrides: Record<string, unknown> = {}) => ({
    _id: "loginEvent.abc",
    runId: IDENTITY.runId,
    candidateSha: IDENTITY.candidateSha,
    deploymentId: IDENTITY.deploymentId,
    attemptId: attempt,
    ...overrides,
  });

  it("accepts exactly one owned event per awaited sign-in", () => {
    const verdict = reconcileLoginEvents({
      events: [owned()],
      identity: IDENTITY,
      expectedAttemptIds: [attempt],
    });
    expect(verdict.failures).toEqual([]);
    expect(verdict.ok).toBe(true);
    expect(verdict.matchedIds).toEqual(["loginEvent.abc"]);
  });

  it("fails on a MISSING event", () => {
    const verdict = reconcileLoginEvents({
      events: [],
      identity: IDENTITY,
      expectedAttemptIds: [attempt],
    });
    expect(verdict.failures.map((f) => f.code)).toEqual(["missing_event"]);
  });

  it("fails on a DUPLICATE event for the same attempt", () => {
    const verdict = reconcileLoginEvents({
      events: [owned(), owned({ _id: "loginEvent.def" })],
      identity: IDENTITY,
      expectedAttemptIds: [attempt],
    });
    expect(verdict.failures.map((f) => f.code)).toEqual(["duplicate_event"]);
  });

  it("fails on a FOREIGN event (any part of the ownership tuple disagreeing)", () => {
    for (const override of [
      { runId: "srvrun-someone-else" },
      { candidateSha: "another-sha" },
      { deploymentId: "dpl_another" },
      { attemptId: undefined },
    ]) {
      const verdict = reconcileLoginEvents({
        events: [owned(override)],
        identity: IDENTITY,
        expectedAttemptIds: [attempt],
      });
      expect(verdict.failures.map((f) => f.code), JSON.stringify(override)).toContain(
        "foreign_event",
      );
    }
  });

  it("fails on a LATE/unexpected owned event whose attempt id this run never used", () => {
    const verdict = reconcileLoginEvents({
      events: [owned({ attemptId: "srvatt-999999999999999999" })],
      identity: IDENTITY,
      expectedAttemptIds: [attempt],
    });
    expect(verdict.failures.map((f) => f.code).sort()).toEqual(
      ["missing_event", "unexpected_attempt"].sort(),
    );
  });
});
