// Service Readiness A3 §4 "Run-owned credentials login events".
//
// What these tests defend:
//   · an ordinary credentials sign-in is byte-for-byte unchanged, and performs no
//     extra read at all;
//   · ownership is stamped ONLY when the deployment is the isolated verification
//     deployment AND the claimed candidate SHA / deployment id are this
//     deployment's own AND the live dataset lease owner is exactly
//     `runId:candidateSha:deploymentId`;
//   · every other combination fails closed with no ownership;
//   · ownership is never inferred from email, member id, provider or timestamp;
//   · the created `_id` is captured and only run/deployment/attempt/event ids are
//     emitted.

import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// `import "server-only"` guard.
vi.mock("server-only", () => ({}));

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const getDocument = vi.fn();
vi.mock("@/sanity/lib/serverClient", () => ({
  serverClient: { getDocument: (...a: unknown[]) => getDocument(...a) },
  writeClient: { create: vi.fn() },
}));

import {
  LEASE_DOC_ID,
  LOGIN_EVENT_OWNERSHIP_FIELDS,
  VERIFICATION_HEADERS,
  buildLoginEventDocument,
  createLoginEvent,
  evaluateTicketPreconditions,
  evaluateVerificationOwnership,
  leaseOwnerString,
  readVerificationHeaders,
  redactedLoginEventRecord,
  resolveVerificationOwnership,
  verificationOwnershipFields,
  type LeaseLike,
  type VerificationOwnership,
} from "../srVerificationLoginEvent";

const MARKER = "owt-service-readiness-verification-v1";
const RUN_ID = "run-7f3a9c21b4e85d06";
const ATTEMPT_ID = "attempt-0001-9ab3c7de";
const SHA = "c".repeat(40);
const DEPLOYMENT_ID = "dpl_9aBcDeFgHiJkLmNo";

const OWNERSHIP: VerificationOwnership = {
  runId: RUN_ID,
  attemptId: ATTEMPT_ID,
  candidateSha: SHA,
  deploymentId: DEPLOYMENT_ID,
};

const NOW = "2026-07-25T18:00:00.000Z";

function verificationEnv(over: Record<string, string | undefined> = {}) {
  return {
    NEXT_PUBLIC_SANITY_PROJECT_ID: "scbxomq9",
    NEXT_PUBLIC_SANITY_DATASET: "service-readiness-verification",
    SERVICE_READINESS_VERIFICATION_MARKER: MARKER,
    ALLOW_SERVICE_READINESS_E2E_WRITES: "true",
    SERVICE_READINESS_DELIVERY_MODE: "disabled",
    VERCEL_GIT_COMMIT_SHA: SHA,
    VERCEL_DEPLOYMENT_ID: DEPLOYMENT_ID,
    ...over,
  };
}

function headers(over: Record<string, string | undefined> = {}): Record<string, string> {
  const all: Record<string, string | undefined> = {
    [VERIFICATION_HEADERS.marker]: MARKER,
    [VERIFICATION_HEADERS.runId]: RUN_ID,
    [VERIFICATION_HEADERS.attemptId]: ATTEMPT_ID,
    [VERIFICATION_HEADERS.candidateSha]: SHA,
    [VERIFICATION_HEADERS.deploymentId]: DEPLOYMENT_ID,
    ...over,
  };
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(all)) if (v !== undefined) out[k] = v;
  return out;
}

function liveLease(over: Partial<LeaseLike> = {}): LeaseLike {
  return {
    owner: leaseOwnerString(OWNERSHIP),
    expiresAt: "2026-07-25T18:15:00.000Z",
    ...over,
  };
}

function decide(over: {
  headers?: Record<string, string>;
  env?: Record<string, string | undefined>;
  lease?: LeaseLike | null;
  now?: string;
} = {}) {
  const { present, ticket } = readVerificationHeaders(over.headers ?? headers());
  return evaluateVerificationOwnership({
    present,
    ticket,
    env: over.env ?? verificationEnv(),
    lease: over.lease === undefined ? liveLease() : over.lease,
    now: over.now ?? NOW,
  });
}

// ── The wire contract ───────────────────────────────────────────────────────

describe("verification header contract", () => {
  it("uses five dedicated non-secret headers and the deterministic lease id", () => {
    expect(VERIFICATION_HEADERS).toEqual({
      marker: "x-sr-verification-marker",
      runId: "x-sr-verification-run-id",
      attemptId: "x-sr-verification-attempt-id",
      candidateSha: "x-sr-verification-candidate-sha",
      deploymentId: "x-sr-verification-deployment-id",
    });
    expect(LEASE_DOC_ID).toBe("serviceReadiness.verificationLease");
    expect([...LOGIN_EVENT_OWNERSHIP_FIELDS]).toEqual(["runId", "attemptId", "candidateSha", "deploymentId"]);
  });

  it("reads headers from a plain record, case-insensitively, and from a Headers object", () => {
    expect(readVerificationHeaders(headers()).ticket).toEqual({
      marker: MARKER,
      runId: RUN_ID,
      attemptId: ATTEMPT_ID,
      candidateSha: SHA,
      deploymentId: DEPLOYMENT_ID,
    });
    expect(readVerificationHeaders({ "X-SR-Verification-Run-Id": RUN_ID }).ticket.runId).toBe(RUN_ID);
    expect(readVerificationHeaders(new Headers(headers())).ticket.runId).toBe(RUN_ID);
  });

  it("treats a repeated header as unusable rather than picking one", () => {
    const { present, ticket } = readVerificationHeaders({
      [VERIFICATION_HEADERS.runId]: [RUN_ID, "run-other"],
    });
    expect(present).toBe(true);
    expect(ticket.runId).toBeNull();
  });

  it("marks a partially supplied ticket as present (so it is refused, not ignored)", () => {
    const { present } = readVerificationHeaders({ [VERIFICATION_HEADERS.runId]: RUN_ID });
    expect(present).toBe(true);
  });

  it("builds the lease owner as the exact runId:candidateSha:deploymentId triple", () => {
    expect(leaseOwnerString(OWNERSHIP)).toBe(`${RUN_ID}:${SHA}:${DEPLOYMENT_ID}`);
    // The attempt id is deliberately NOT part of the owner — it identifies one
    // sign-in inside the run, not the lease.
    expect(leaseOwnerString(OWNERSHIP)).not.toContain(ATTEMPT_ID);
  });
});

// ── Ordinary sign-in is untouched ───────────────────────────────────────────

describe("ordinary credentials sign-in", () => {
  it("builds the historical document byte-for-byte", () => {
    const doc = buildLoginEventDocument({
      memberId: "member-1",
      email: "someone@example.com",
      provider: "credentials",
      timestamp: NOW,
    });
    expect(doc).toEqual({
      _type: "loginEvent",
      member: { _type: "reference", _ref: "member-1" },
      email: "someone@example.com",
      provider: "credentials",
      timestamp: NOW,
    });
    expect(Object.keys(doc)).toEqual(["_type", "member", "email", "provider", "timestamp"]);
    for (const field of LOGIN_EVENT_OWNERSHIP_FIELDS) expect(doc).not.toHaveProperty(field);
  });

  it("resolves no ownership and performs NO lease read when there are no headers", async () => {
    const readLease = vi.fn();
    const warn = vi.fn();
    for (const h of [undefined, null, {}, new Headers()]) {
      await expect(
        resolveVerificationOwnership({ headers: h, env: verificationEnv(), readLease, logger: { warn } }),
      ).resolves.toBeNull();
    }
    expect(readLease).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("emits no structured record for an unowned create", async () => {
    const log = vi.fn();
    const create = vi.fn().mockResolvedValue({ _id: "random-id-1" });
    const id = await createLoginEvent({
      client: { create },
      memberId: "member-1",
      email: "someone@example.com",
      provider: "google",
      timestamp: NOW,
      logger: { log },
    });
    expect(id).toBe("random-id-1");
    expect(log).not.toHaveBeenCalled();
  });
});

// ── The happy verification path ─────────────────────────────────────────────

describe("valid verification markers", () => {
  it("propagates ownership when environment, SHA, deployment id and lease all match", () => {
    expect(decide()).toEqual({ marked: true, ok: true, reason: null, ownership: OWNERSHIP });
  });

  it("accepts the configured SR_VERIFY_* fallbacks when provider metadata is absent", () => {
    const decision = decide({
      env: verificationEnv({
        VERCEL_GIT_COMMIT_SHA: undefined,
        VERCEL_DEPLOYMENT_ID: undefined,
        SR_VERIFY_CANDIDATE_SHA: SHA,
        SR_VERIFY_DEPLOYMENT_ID: DEPLOYMENT_ID,
      }),
    });
    expect(decision.ok).toBe(true);
  });

  it("stamps exactly the four ownership fields on the document", () => {
    const doc = buildLoginEventDocument({
      memberId: "member-1",
      email: "srv-member-admin@sr-verify.invalid",
      provider: "credentials",
      timestamp: NOW,
      ownership: OWNERSHIP,
    });
    expect(doc.runId).toBe(RUN_ID);
    expect(doc.attemptId).toBe(ATTEMPT_ID);
    expect(doc.candidateSha).toBe(SHA);
    expect(doc.deploymentId).toBe(DEPLOYMENT_ID);
    expect(Object.keys(doc)).toEqual([
      "_type",
      "member",
      "email",
      "provider",
      "timestamp",
      "runId",
      "attemptId",
      "candidateSha",
      "deploymentId",
    ]);
    expect(verificationOwnershipFields(null)).toEqual({});
  });

  it("captures the created _id and emits only run/deployment/attempt/event ids", async () => {
    const log = vi.fn();
    const create = vi.fn().mockResolvedValue({ _id: "login-event-abc" });
    const id = await createLoginEvent({
      client: { create },
      memberId: "srv.member.admin",
      email: "srv-member-admin@sr-verify.invalid",
      provider: "credentials",
      timestamp: NOW,
      ownership: OWNERSHIP,
      logger: { log },
    });
    expect(id).toBe("login-event-abc");
    expect(log).toHaveBeenCalledTimes(1);
    const record = JSON.parse(log.mock.calls[0][0] as string);
    expect(record).toEqual({
      event: "verification_login_event_created",
      runId: RUN_ID,
      deploymentId: DEPLOYMENT_ID,
      attemptId: ATTEMPT_ID,
      eventId: "login-event-abc",
    });
    // Redacted: no email, no member id, no provider, no timestamp.
    const serialized = log.mock.calls[0][0] as string;
    expect(serialized).not.toContain("sr-verify.invalid");
    expect(serialized).not.toContain("srv.member.admin");
    expect(serialized).not.toContain("credentials");
    expect(serialized).not.toContain(NOW);
  });

  it("records a null event id rather than inventing one when create returns nothing", async () => {
    const create = vi.fn().mockResolvedValue(undefined);
    const log = vi.fn();
    await expect(
      createLoginEvent({
        client: { create },
        memberId: "m",
        email: "e@sr-verify.invalid",
        provider: "credentials",
        timestamp: NOW,
        ownership: OWNERSHIP,
        logger: { log },
      }),
    ).resolves.toBeNull();
    expect(JSON.parse(log.mock.calls[0][0] as string).eventId).toBeNull();
  });

  it("keeps the redacted record shape closed", () => {
    expect(Object.keys(redactedLoginEventRecord({ ownership: OWNERSHIP, eventId: "x" }))).toEqual([
      "event",
      "runId",
      "deploymentId",
      "attemptId",
      "eventId",
    ]);
  });
});

// ── Fail-closed rejections ──────────────────────────────────────────────────

describe("marked requests fail closed", () => {
  it("refuses on the production project or dataset", () => {
    for (const over of [
      { NEXT_PUBLIC_SANITY_PROJECT_ID: "ebb8vcnk" },
      { NEXT_PUBLIC_SANITY_DATASET: "production" },
      { NEXT_PUBLIC_SANITY_PROJECT_ID: "ebb8vcnk", NEXT_PUBLIC_SANITY_DATASET: "service-readiness-verification" },
    ]) {
      const decision = decide({ env: verificationEnv(over) });
      expect(decision.ok, JSON.stringify(over)).toBe(false);
      expect(decision.reason).toBe("environment_refused");
      expect(decision.ownership).toBeNull();
    }
  });

  it("refuses when the deployment marker is absent or wrong", () => {
    expect(decide({ env: verificationEnv({ SERVICE_READINESS_VERIFICATION_MARKER: undefined }) }).reason).toBe(
      "environment_refused",
    );
    expect(decide({ env: verificationEnv({ SERVICE_READINESS_VERIFICATION_MARKER: "other" }) }).reason).toBe(
      "environment_refused",
    );
  });

  it("refuses when delivery mode is not exactly disabled", () => {
    expect(decide({ env: verificationEnv({ SERVICE_READINESS_DELIVERY_MODE: "enabled" }) }).reason).toBe(
      "environment_refused",
    );
    expect(decide({ env: verificationEnv({ SERVICE_READINESS_DELIVERY_MODE: undefined }) }).reason).toBe(
      "environment_refused",
    );
  });

  it("refuses when the E2E-writes flag is not enabled", () => {
    expect(decide({ env: verificationEnv({ ALLOW_SERVICE_READINESS_E2E_WRITES: undefined }) }).reason).toBe(
      "environment_refused",
    );
  });

  it("refuses a missing or wrong header marker", () => {
    expect(decide({ headers: headers({ [VERIFICATION_HEADERS.marker]: undefined }) }).reason).toBe("incomplete_ticket");
    expect(decide({ headers: headers({ [VERIFICATION_HEADERS.marker]: "owt-other-marker" }) }).reason).toBe(
      "marker_mismatch",
    );
  });

  it("refuses an incomplete ticket", () => {
    for (const missing of ["runId", "attemptId", "candidateSha", "deploymentId"] as const) {
      const decision = decide({ headers: headers({ [VERIFICATION_HEADERS[missing]]: undefined }) });
      expect(decision.reason, missing).toBe("incomplete_ticket");
    }
  });

  it("refuses a malformed id (colon, too short, or exotic characters)", () => {
    for (const bad of ["run:with:colons", "short", "run id with spaces", "run/../id", "a".repeat(200)]) {
      const decision = decide({ headers: headers({ [VERIFICATION_HEADERS.runId]: bad }) });
      expect(decision.reason, bad).toBe("malformed_ticket");
    }
  });

  it("refuses a candidate SHA that is not this deployment's commit", () => {
    expect(decide({ headers: headers({ [VERIFICATION_HEADERS.candidateSha]: "d".repeat(40) }) }).reason).toBe(
      "candidate_sha_mismatch",
    );
    expect(
      decide({ env: verificationEnv({ VERCEL_GIT_COMMIT_SHA: undefined }) }).reason,
    ).toBe("candidate_sha_unavailable");
  });

  it("refuses a foreign deployment id even when everything else matches", () => {
    const foreign = "dpl_ForeignDeployment999";
    const decision = decide({
      headers: headers({ [VERIFICATION_HEADERS.deploymentId]: foreign }),
      // A lease genuinely owned by that foreign triple, to prove the deployment
      // check is independent of the lease check.
      lease: { owner: `${RUN_ID}:${SHA}:${foreign}`, expiresAt: "2026-07-25T18:15:00.000Z" },
    });
    expect(decision.reason).toBe("foreign_deployment");
    expect(decision.ownership).toBeNull();
    expect(decide({ env: verificationEnv({ VERCEL_DEPLOYMENT_ID: undefined }) }).reason).toBe(
      "deployment_id_unavailable",
    );
  });

  it("refuses a missing, malformed, foreign or expired lease", () => {
    expect(decide({ lease: null }).reason).toBe("lease_missing");
    expect(decide({ lease: {} }).reason).toBe("lease_malformed");
    expect(decide({ lease: { owner: "x", expiresAt: "not-a-date" } }).reason).toBe("lease_malformed");
    expect(decide({ lease: liveLease({ owner: `other-run:${SHA}:${DEPLOYMENT_ID}` }) }).reason).toBe("foreign_lease");
    // Right run id, wrong SHA in the owner string: still foreign.
    expect(decide({ lease: liveLease({ owner: `${RUN_ID}:${"e".repeat(40)}:${DEPLOYMENT_ID}` }) }).reason).toBe(
      "foreign_lease",
    );
    expect(decide({ lease: liveLease({ expiresAt: "2026-07-25T17:59:59.000Z" }) }).reason).toBe("lease_expired");
    // Exactly at expiry is expired (the lease is not live at its own deadline).
    expect(decide({ lease: liveLease({ expiresAt: NOW }) }).reason).toBe("lease_expired");
  });

  it("never infers ownership from email, member, provider, timestamp or branch", () => {
    // A request with no verification headers but every "looks like the fixture"
    // signal present must still resolve to no ownership.
    const { present, ticket } = readVerificationHeaders({
      "x-forwarded-for": "127.0.0.1",
      "user-agent": "playwright",
    });
    expect(present).toBe(false);
    expect(
      evaluateVerificationOwnership({
        present,
        ticket,
        env: verificationEnv({ VERCEL_GIT_COMMIT_REF: "verify/service-readiness" }),
        lease: liveLease(),
        now: NOW,
      }),
    ).toEqual({ marked: false, ok: false, reason: "unmarked_request", ownership: null });
  });

  it("precondition failures short-circuit before the lease is ever read", async () => {
    const readLease = vi.fn();
    const warn = vi.fn();
    await expect(
      resolveVerificationOwnership({
        headers: headers(),
        env: verificationEnv({ NEXT_PUBLIC_SANITY_DATASET: "production" }),
        readLease,
        logger: { warn },
      }),
    ).resolves.toBeNull();
    expect(readLease).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("environment_refused"));
  });

  it("logs only a reason code, never a header value", async () => {
    const warn = vi.fn();
    await resolveVerificationOwnership({
      headers: headers(),
      env: verificationEnv(),
      now: NOW,
      readLease: async () => null,
      logger: { warn },
    });
    const message = String(warn.mock.calls[0][0]);
    expect(message).toContain("lease_missing");
    expect(message).not.toContain(RUN_ID);
    expect(message).not.toContain(DEPLOYMENT_ID);
  });

  it("returns ownership from the async resolver on the full happy path", async () => {
    await expect(
      resolveVerificationOwnership({
        headers: headers(),
        env: verificationEnv(),
        now: NOW,
        readLease: async () => liveLease(),
        logger: { warn: vi.fn() },
      }),
    ).resolves.toEqual(OWNERSHIP);
  });

  it("fails closed when the lease read throws", async () => {
    await expect(
      resolveVerificationOwnership({
        headers: headers(),
        env: verificationEnv(),
        now: NOW,
        readLease: async () => {
          throw new Error("network");
        },
        logger: { warn: vi.fn() },
      }),
    ).rejects.toThrow("network");
    // The default reader swallows its own errors (see readLeaseDocument), so the
    // deployed path degrades to "no ownership" rather than breaking sign-in.
  });
});

// ── Preconditions in isolation ──────────────────────────────────────────────

describe("evaluateTicketPreconditions", () => {
  it("is the lease-free half of the gate", () => {
    const { present, ticket } = readVerificationHeaders(headers());
    expect(evaluateTicketPreconditions({ present, ticket, env: verificationEnv() })).toEqual({
      marked: true,
      ok: true,
      reason: null,
      ownership: OWNERSHIP,
    });
  });
});

// ── auth.ts actually uses the helpers ───────────────────────────────────────

describe("auth.ts wiring", () => {
  const src = readFileSync(path.join(REPO_ROOT, "auth.ts"), "utf8");

  it("resolves ownership in credentials authorize and passes it to the sign-in event", () => {
    expect(src).toContain("resolveVerificationOwnership");
    expect(src).toContain("async authorize(credentials, req)");
    expect(src).toContain("headers: req?.headers");
    expect(src).toContain("createLoginEvent");
    expect(src).toContain("ownership: user.srVerification ?? null");
  });

  it("no longer assembles the loginEvent document inline", () => {
    // The gate and the document shape live in the tested helper, not buried in
    // the NextAuth callback where they cannot be asserted.
    expect(src).not.toContain('_type: "loginEvent"');
  });

  it("keeps the ownership marker out of the JWT and the session", () => {
    // The jwt callback copies role/sanityId/alias only; nothing propagates
    // `srVerification` into a token or a session.
    expect(src).not.toMatch(/token\.srVerification/);
    expect(src).not.toMatch(/session\.user\.srVerification/);
  });
});
