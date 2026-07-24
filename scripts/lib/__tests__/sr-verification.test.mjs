// scripts/lib/__tests__/sr-verification.test.mjs
//
// Offline unit tests for the A3 verification guards, lease, and fixtures.
// Nothing here touches the network: every assertion is about a DECISION the
// guard module makes, never about a Sanity call.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

import {
  ADMIN_HASH_ENV,
  BACKUP_DIR,
  DANGLING_MEMBER_ID,
  DEFAULT_LEASE_TTL_MS,
  FIXTURE_ID_PREFIX,
  FIXTURE_REQUEST_IDS,
  LEASE_DOC_ID,
  MARKER_ENV,
  MARKER_VALUE,
  TOKEN_ENV,
  VERIFICATION_DATASET,
  VERIFICATION_PROJECT_ID,
  backupFileName,
  buildBackupEnvelope,
  buildFixtureDocuments,
  buildLeaseDocument,
  evaluateGuards,
  evaluateLeaseClaim,
  evaluateLeaseOwnership,
  evaluateLeaseRelease,
  evaluateLeaseRenewal,
  evaluateMarkerDocument,
  leaseReplaceFields,
  filterDeletableIds,
  fixtureIds,
  isDeletableFixtureId,
  isLeaseExpired,
  leaseOwner,
  mirrorCanonicalCreatePayload,
  mirrorPayloadFingerprint,
  mirrorReceiptId,
  mirrorRoleTargetLockId,
  parseCliArgs,
  verifyFixtureState,
  verifyResetState,
} from "../sr-verification.mjs";

// The real TypeScript helpers, imported through the vitest `@` alias, so the
// `.mjs` mirrors above cannot drift from them silently.
import { payloadFingerprint, receiptIdForRequestId, canonicalizeCreatePayload } from "@/app/utils/roleCreationReceipt";
import { roleTargetLockId } from "@/app/utils/roleTargetLock";

const GOOD_ENV = {
  SR_VERIFY_SANITY_PROJECT_ID: VERIFICATION_PROJECT_ID,
  SR_VERIFY_SANITY_DATASET: VERIFICATION_DATASET,
  [MARKER_ENV]: MARKER_VALUE,
  [TOKEN_ENV]: "sk-not-a-real-token",
  [ADMIN_HASH_ENV]: "$2a$10$notarealhash",
};

const codes = (list) => list.map((f) => f.code);

/* ================================================================== *
 * CLI parsing
 * ================================================================== */

describe("parseCliArgs — dry-run is the default", () => {
  it("reports apply=false with no arguments", () => {
    expect(parseCliArgs([]).apply).toBe(false);
  });

  it("reports apply=true only for the exact --apply token", () => {
    expect(parseCliArgs(["--apply"]).apply).toBe(true);
    expect(parseCliArgs(["apply"]).apply).toBe(false);
    expect(parseCliArgs(["--APPLY"]).apply).toBe(false);
    expect(parseCliArgs(["--apply-please"]).apply).toBe(false);
  });

  it("surfaces unknown flags instead of ignoring a typo", () => {
    expect(parseCliArgs(["--aply"]).unknown).toEqual(["--aply"]);
    expect(parseCliArgs(["--apply", "--json"]).unknown).toEqual([]);
  });
});

/* ================================================================== *
 * Guards — project / dataset refusal
 * ================================================================== */

describe("evaluateGuards — production project/dataset are hard refusals", () => {
  it("refuses the production project id ebb8vcnk even in dry-run", () => {
    const g = evaluateGuards({
      env: { ...GOOD_ENV, SR_VERIFY_SANITY_PROJECT_ID: "ebb8vcnk" },
      apply: false,
    });
    expect(codes(g.hardFailures)).toContain("forbidden_project");
    expect(g.refused).toBe(true);
    expect(g.exitCode).toBe(1);
    expect(g.willContactRemote).toBe(false);
  });

  it("refuses the production dataset name even in dry-run", () => {
    const g = evaluateGuards({
      env: { ...GOOD_ENV, SR_VERIFY_SANITY_DATASET: "production" },
      apply: false,
    });
    expect(codes(g.hardFailures)).toContain("forbidden_dataset");
    expect(g.refused).toBe(true);
    expect(g.willContactRemote).toBe(false);
  });

  it("refuses production project AND dataset together with --apply", () => {
    const g = evaluateGuards({
      env: { ...GOOD_ENV, SR_VERIFY_SANITY_PROJECT_ID: "ebb8vcnk", SR_VERIFY_SANITY_DATASET: "production" },
      apply: true,
    });
    expect(codes(g.hardFailures)).toEqual(expect.arrayContaining(["forbidden_project", "forbidden_dataset"]));
    expect(g.willContactRemote).toBe(false);
    expect(g.exitCode).toBe(1);
  });

  it("refuses a production .env.local shape reached through NEXT_PUBLIC_* fallback", () => {
    // The exact shape of `node --env-file=.env.local scripts/...seed.mjs --apply`.
    const g = evaluateGuards({
      env: {
        NEXT_PUBLIC_SANITY_PROJECT_ID: "ebb8vcnk",
        NEXT_PUBLIC_SANITY_DATASET: "production",
        [MARKER_ENV]: MARKER_VALUE,
        [TOKEN_ENV]: "sk-not-a-real-token",
      },
      apply: true,
    });
    expect(codes(g.hardFailures)).toEqual(expect.arrayContaining(["forbidden_project", "forbidden_dataset"]));
    expect(g.willContactRemote).toBe(false);
  });

  it("refuses any other non-verification project or dataset", () => {
    expect(
      codes(evaluateGuards({ env: { ...GOOD_ENV, SR_VERIFY_SANITY_PROJECT_ID: "abcd1234" } }).hardFailures),
    ).toContain("wrong_project");
    expect(
      codes(evaluateGuards({ env: { ...GOOD_ENV, SR_VERIFY_SANITY_DATASET: "staging" } }).hardFailures),
    ).toContain("wrong_dataset");
  });

  it("checks the two axes independently — a right project with a wrong dataset still refuses", () => {
    const g = evaluateGuards({ env: { ...GOOD_ENV, SR_VERIFY_SANITY_DATASET: "production" }, apply: true });
    expect(g.projectId).toBe(VERIFICATION_PROJECT_ID);
    expect(codes(g.hardFailures)).toContain("forbidden_dataset");
  });

  it("refuses an unrecognized flag rather than treating it as dry-run intent", () => {
    const g = evaluateGuards({ env: GOOD_ENV, apply: false, unknownFlags: ["--aply"] });
    expect(codes(g.hardFailures)).toContain("unknown_flag");
    expect(g.exitCode).toBe(1);
  });
});

/* ================================================================== *
 * Guards — marker
 * ================================================================== */

describe("evaluateGuards — verification marker", () => {
  it("blocks apply when the marker env var is absent", () => {
    const env = { ...GOOD_ENV };
    delete env[MARKER_ENV];
    const dry = evaluateGuards({ env, apply: false });
    expect(codes(dry.applyBlockers)).toContain("missing_marker");
    expect(dry.exitCode).toBe(0); // dry-run still plans safely
    expect(dry.willContactRemote).toBe(false);

    const applied = evaluateGuards({ env, apply: true });
    expect(applied.refused).toBe(true);
    expect(applied.exitCode).toBe(1);
    expect(applied.willContactRemote).toBe(false);
  });

  it("hard-refuses an incorrect marker value, even in dry-run", () => {
    const g = evaluateGuards({ env: { ...GOOD_ENV, [MARKER_ENV]: "owt-service-readiness-verification-v0" } });
    expect(codes(g.hardFailures)).toContain("marker_mismatch");
    expect(g.refused).toBe(true);
  });

  it("accepts only the exact documented marker value", () => {
    const g = evaluateGuards({ env: GOOD_ENV, apply: true });
    expect(g.hardFailures).toEqual([]);
    expect(g.applyBlockers).toEqual([]);
    expect(MARKER_VALUE).toBe("owt-service-readiness-verification-v1");
  });
});

/* ================================================================== *
 * Guards — token and dry-run default
 * ================================================================== */

describe("evaluateGuards — credentials and the dry-run default", () => {
  it("blocks apply when the verification token is missing", () => {
    const env = { ...GOOD_ENV };
    delete env[TOKEN_ENV];
    const applied = evaluateGuards({ env, apply: true });
    expect(codes(applied.applyBlockers)).toContain("missing_token");
    expect(applied.willContactRemote).toBe(false);
    expect(applied.exitCode).toBe(1);
  });

  it("exits cleanly in dry-run with no token and no environment at all", () => {
    const g = evaluateGuards({ env: {}, apply: false });
    expect(g.hardFailures).toEqual([]);
    expect(codes(g.applyBlockers)).toEqual(
      expect.arrayContaining(["missing_project_id", "missing_dataset", "missing_marker", "missing_token"]),
    );
    expect(g.exitCode).toBe(0);
    expect(g.willContactRemote).toBe(false);
  });

  it("blocks the seed when the test-admin password hash is absent", () => {
    const env = { ...GOOD_ENV };
    delete env[ADMIN_HASH_ENV];
    const g = evaluateGuards({ env, apply: true, requireAdminHash: true });
    expect(codes(g.applyBlockers)).toContain("missing_admin_password_hash");
    expect(g.willContactRemote).toBe(false);
  });

  it("NEVER reaches a remote code path without --apply, for any environment", () => {
    const environments = [
      {},
      GOOD_ENV,
      { ...GOOD_ENV, SR_VERIFY_SANITY_PROJECT_ID: "ebb8vcnk" },
      { ...GOOD_ENV, SR_VERIFY_SANITY_DATASET: "production" },
      { ...GOOD_ENV, [MARKER_ENV]: "wrong" },
    ];
    for (const env of environments) {
      expect(evaluateGuards({ env, apply: false }).willContactRemote).toBe(false);
      expect(evaluateGuards({ env, apply: false, requireAdminHash: true }).willContactRemote).toBe(false);
    }
  });

  it("permits remote contact only with --apply and a fully clean environment", () => {
    const g = evaluateGuards({ env: GOOD_ENV, apply: true, requireAdminHash: true });
    expect(g.willContactRemote).toBe(true);
    expect(g.mode).toBe("apply");
    expect(g.exitCode).toBe(0);
  });

  it("never returns a secret value in its result", () => {
    const g = evaluateGuards({ env: GOOD_ENV, apply: true, requireAdminHash: true });
    expect(JSON.stringify(g)).not.toContain("sk-not-a-real-token");
    expect(JSON.stringify(g)).not.toContain("$2a$10$notarealhash");
  });
});

/* ================================================================== *
 * Marker document
 * ================================================================== */

describe("evaluateMarkerDocument", () => {
  it("bootstraps when the marker document is absent", () => {
    expect(evaluateMarkerDocument(null).action).toBe("create");
  });

  it("accepts an exact marker document", () => {
    expect(evaluateMarkerDocument({ marker: MARKER_VALUE }).ok).toBe(true);
  });

  it("refuses a marker document with a different value", () => {
    const r = evaluateMarkerDocument({ marker: "something-else" });
    expect(r.action).toBe("refuse");
    expect(r.reason).toBe("marker_document_mismatch");
  });

  // The dataset was originally provisioned by earlier tooling that stored the
  // same marker value under `purpose` with its own `_type`. That is the same
  // dataset, so it must be accepted rather than read as "wrong dataset".
  it("accepts a legacy marker document that carries the value in `purpose`", () => {
    const legacy = {
      _type: "serviceReadinessVerificationMarker",
      purpose: MARKER_VALUE,
      dataset: "service-readiness-verification",
      projectId: "scbxomq9",
      version: 1,
    };
    expect(evaluateMarkerDocument(legacy).ok).toBe(true);
  });

  it("still refuses when neither field carries the expected value", () => {
    const r = evaluateMarkerDocument({ purpose: "some other dataset", marker: undefined });
    expect(r.action).toBe("refuse");
    expect(r.reason).toBe("marker_document_mismatch");
  });
});

describe("leaseReplaceFields", () => {
  // `_type` is immutable per document id in the Content Lake, so an in-place
  // replace of a lease provisioned by earlier tooling must not send it.
  it("omits _id and _type so an in-place replace cannot abort", () => {
    const fields = leaseReplaceFields({
      _id: "serviceReadiness.verificationLease",
      _type: "srVerificationLease",
      owner: "r:c:d",
      expiresAt: "2026-07-24T00:00:00.000Z",
    });
    expect(fields).not.toHaveProperty("_id");
    expect(fields).not.toHaveProperty("_type");
  });

  it("preserves every ownership-bearing field", () => {
    const fields = leaseReplaceFields({
      _id: "x",
      _type: "y",
      owner: "r:c:d",
      runId: "r",
      candidateSha: "c",
      deploymentId: "d",
      acquiredAt: "a",
      expiresAt: "e",
    });
    expect(fields).toEqual({
      owner: "r:c:d",
      runId: "r",
      candidateSha: "c",
      deploymentId: "d",
      acquiredAt: "a",
      expiresAt: "e",
    });
  });
});

/* ================================================================== *
 * Exclusive dataset lease
 * ================================================================== */

const OWNER_INPUT = { runId: "run-1", candidateSha: "abc1234", deploymentId: "dpl-1" };
const OWNER = "run-1:abc1234:dpl-1";
const NOW = "2026-07-24T12:00:00.000Z";

describe("leaseOwner", () => {
  it("is the exact runId:candidateSha:deploymentId triple", () => {
    expect(leaseOwner(OWNER_INPUT)).toBe(OWNER);
  });

  it("refuses a half-formed owner", () => {
    expect(leaseOwner({ runId: "run-1", candidateSha: "abc", deploymentId: "" })).toBeNull();
    expect(leaseOwner({ runId: "run-1", candidateSha: "abc" })).toBeNull();
    expect(leaseOwner({})).toBeNull();
  });

  it("refuses a part containing the separator, so owners cannot alias", () => {
    expect(leaseOwner({ runId: "run:1", candidateSha: "abc", deploymentId: "dpl" })).toBeNull();
  });
});

describe("evaluateLeaseClaim", () => {
  it("creates when absent (create-if-absent is the atomic acquire)", () => {
    const r = evaluateLeaseClaim({ existing: null, owner: OWNER, now: NOW });
    expect(r.action).toBe("create");
    expect(r.requiredRev).toBeNull();
  });

  it("REFUSES a live foreign lease immediately and never steals", () => {
    const r = evaluateLeaseClaim({
      existing: { owner: "other:sha:dpl", expiresAt: "2026-07-24T12:30:00.000Z", _rev: "rev-a" },
      owner: OWNER,
      now: NOW,
    });
    expect(r.action).toBe("refuse");
    expect(r.reason).toBe("foreign_live_lease");
    expect(r.requiredRev).toBeNull();
  });

  it("replaces an EXPIRED foreign lease only under an _rev precondition", () => {
    const r = evaluateLeaseClaim({
      existing: { owner: "other:sha:dpl", expiresAt: "2026-07-24T11:00:00.000Z", _rev: "rev-a" },
      owner: OWNER,
      now: NOW,
    });
    expect(r.action).toBe("replace");
    expect(r.requiredRev).toBe("rev-a");
  });

  it("renews our own live lease under _rev", () => {
    const r = evaluateLeaseClaim({
      existing: { owner: OWNER, expiresAt: "2026-07-24T12:10:00.000Z", _rev: "rev-b" },
      owner: OWNER,
      now: NOW,
    });
    expect(r.action).toBe("renew");
    expect(r.requiredRev).toBe("rev-b");
  });

  it("refuses a structurally malformed lease rather than clearing it", () => {
    expect(evaluateLeaseClaim({ existing: { _rev: "r" }, owner: OWNER, now: NOW }).reason).toBe("malformed_lease");
    expect(evaluateLeaseClaim({ existing: { owner: OWNER, expiresAt: "nonsense" }, owner: OWNER, now: NOW }).action).toBe(
      "refuse",
    );
  });

  it("refuses when the caller has no valid owner", () => {
    expect(evaluateLeaseClaim({ existing: null, owner: null, now: NOW }).action).toBe("refuse");
  });
});

describe("evaluateLeaseOwnership — the pre-mutation re-read gate", () => {
  const live = { owner: OWNER, expiresAt: "2026-07-24T12:10:00.000Z", _rev: "rev-b" };

  it("passes only for the exact unexpired owner", () => {
    expect(evaluateLeaseOwnership({ existing: live, owner: OWNER, now: NOW }).ok).toBe(true);
  });

  it("fails when the lease vanished", () => {
    expect(evaluateLeaseOwnership({ existing: null, owner: OWNER, now: NOW })).toEqual({
      ok: false,
      reason: "lease_missing",
    });
  });

  it("fails when another run now owns it", () => {
    expect(
      evaluateLeaseOwnership({ existing: { ...live, owner: "other:sha:dpl" }, owner: OWNER, now: NOW }).reason,
    ).toBe("foreign_lease");
  });

  it("fails once our own lease has expired", () => {
    expect(
      evaluateLeaseOwnership({ existing: { ...live, expiresAt: "2026-07-24T11:59:59.000Z" }, owner: OWNER, now: NOW })
        .reason,
    ).toBe("lease_expired");
  });

  it("treats a lease expiring exactly now as expired (fail closed)", () => {
    expect(isLeaseExpired({ expiresAt: NOW }, NOW)).toBe(true);
  });
});

describe("evaluateLeaseRenewal / evaluateLeaseRelease", () => {
  const live = { owner: OWNER, expiresAt: "2026-07-24T12:10:00.000Z", _rev: "rev-b" };

  it("renews only as the current owner, under _rev, extending by the TTL", () => {
    const r = evaluateLeaseRenewal({ existing: live, owner: OWNER, now: NOW, ttlMs: 60_000 });
    expect(r.action).toBe("renew");
    expect(r.requiredRev).toBe("rev-b");
    expect(r.expiresAt).toBe("2026-07-24T12:01:00.000Z");
  });

  it("refuses to renew a foreign lease", () => {
    expect(evaluateLeaseRenewal({ existing: { ...live, owner: "x:y:z" }, owner: OWNER, now: NOW }).action).toBe("refuse");
  });

  it("releases only our own lease, under _rev", () => {
    const r = evaluateLeaseRelease({ existing: live, owner: OWNER });
    expect(r.action).toBe("delete");
    expect(r.requiredRev).toBe("rev-b");
  });

  it("never deletes a foreign lease during cleanup", () => {
    const r = evaluateLeaseRelease({ existing: { ...live, owner: "other:sha:dpl" }, owner: OWNER });
    expect(r.action).toBe("refuse");
    expect(r.reason).toBe("foreign_lease");
  });

  it("is a no-op when the lease is already gone", () => {
    expect(evaluateLeaseRelease({ existing: null, owner: OWNER }).action).toBe("noop");
  });
});

describe("buildLeaseDocument", () => {
  it("carries owner/runId/candidateSha/deploymentId/acquiredAt/expiresAt at the deterministic id", () => {
    const doc = buildLeaseDocument({ owner: OWNER, ...OWNER_INPUT, now: NOW, ttlMs: DEFAULT_LEASE_TTL_MS });
    expect(doc._id).toBe(LEASE_DOC_ID);
    expect(doc).toMatchObject({
      owner: OWNER,
      runId: "run-1",
      candidateSha: "abc1234",
      deploymentId: "dpl-1",
      acquiredAt: NOW,
    });
    expect(Date.parse(doc.expiresAt) - Date.parse(doc.acquiredAt)).toBe(DEFAULT_LEASE_TTL_MS);
  });
});

/* ================================================================== *
 * Deterministic derivation parity with the TypeScript helpers
 * ================================================================== */

describe("mirror parity — the .mjs derivations match the TypeScript helpers", () => {
  const requestIds = ["srv-request-sunday-published", "a", "ünïcode-ïd", "x".repeat(200), ...Object.values(FIXTURE_REQUEST_IDS)];

  it("mirrorReceiptId === receiptIdForRequestId", () => {
    for (const id of requestIds) expect(mirrorReceiptId(id)).toBe(receiptIdForRequestId(id));
    expect(mirrorReceiptId("")).toBe(receiptIdForRequestId(""));
    expect(mirrorReceiptId(null)).toBe(receiptIdForRequestId(null));
  });

  const targetKeys = [
    "sunday_role:2026-08-02",
    "saturday_role:2026-08-01",
    "sunday_role:2026-02-30", // invalid calendar day
    "special_role:2026-08-02", // special roles take no weekend lock
    "sunday_role:nope",
    "no-colon",
    "",
  ];

  it("mirrorRoleTargetLockId === roleTargetLockId", () => {
    for (const key of targetKeys) expect(mirrorRoleTargetLockId(key)).toBe(roleTargetLockId(key));
    expect(mirrorRoleTargetLockId(null)).toBe(roleTargetLockId(null));
    expect(mirrorRoleTargetLockId(42)).toBe(roleTargetLockId(42));
  });

  const payloads = [
    {},
    { _type: "sunday_role", date: "2026-08-02" },
    { _type: "sunday_role", date: "2026-08-02T00:00:00Z", published: true, leads: ["b", "a"], bgvs: ["z"] },
    { _type: "saturday_role", date: "2026-08-01", published: false, chorus: ["c", "c"] },
    {
      _type: "special_role",
      date: "2026-09-12",
      service_name: "  Servicio   Especial ",
      published: true,
      instruments: [
        { instrument: "Bajo", personId: "m2" },
        { instrument: " Guitarra ", personId: "m1" },
      ],
      foh: [{ role: "Audio", personId: "m3" }],
    },
    { _type: "special_role", date: "2026-09-12" }, // missing service_name
    { _type: "not_a_role", date: "2026-08-02" },
    { _type: "sunday_role", date: "not-a-date" },
    { _type: "sunday_role", date: "2026-08-02", service_name: "stray" }, // weekend roles ignore service_name
  ];

  it("mirrorPayloadFingerprint === payloadFingerprint over a table of payloads", () => {
    for (const p of payloads) expect(mirrorPayloadFingerprint(p)).toBe(payloadFingerprint(p));
  });

  it("mirrorCanonicalCreatePayload === canonicalizeCreatePayload(...).canonical", () => {
    for (const p of payloads) {
      expect(mirrorCanonicalCreatePayload(p)).toEqual(canonicalizeCreatePayload(p).canonical);
    }
  });

  it("distinguishes payloads the real helper distinguishes", () => {
    const a = { _type: "sunday_role", date: "2026-08-02", leads: ["m1"] };
    const b = { _type: "sunday_role", date: "2026-08-09", leads: ["m1"] };
    expect(mirrorPayloadFingerprint(a)).not.toBe(mirrorPayloadFingerprint(b));
    expect(payloadFingerprint(a)).not.toBe(payloadFingerprint(b));
  });
});

/* ================================================================== *
 * Fixtures
 * ================================================================== */

describe("buildFixtureDocuments — deterministic and repeatable", () => {
  const a = buildFixtureDocuments({ now: "2026-01-01T00:00:00.000Z" });
  const b = buildFixtureDocuments({ now: "2026-01-01T00:00:00.000Z" });

  it("is byte-identical across two builds at the same timestamp", () => {
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("keeps every _id and every _key independent of `now`, so reset is repeatable", () => {
    const later = buildFixtureDocuments({ now: "2027-05-05T05:05:05.000Z" });
    const keysOf = (docs) =>
      JSON.stringify(
        docs.map((d) => [d._id, JSON.stringify(d).match(/"_key":"[^"]+"/g) ?? []]),
      );
    expect(keysOf(later)).toBe(keysOf(a));
  });

  it("gives every document a deterministic srv.* / derived id", () => {
    for (const doc of a) {
      const derived = doc._id.startsWith("roleTarget.") || doc._id.startsWith("roleCreate.");
      expect(doc._id.startsWith(FIXTURE_ID_PREFIX) || derived).toBe(true);
    }
    expect(new Set(a.map((d) => d._id)).size).toBe(a.length);
  });

  it("gives every array-of-object item a deterministic _key", () => {
    for (const doc of a) {
      for (const [, value] of Object.entries(doc)) {
        if (!Array.isArray(value)) continue;
        for (const item of value) {
          if (item && typeof item === "object") expect(typeof item._key).toBe("string");
        }
      }
    }
  });

  it("derives lock ids and receipt ids through the audited derivations", () => {
    const lockIds = a.filter((d) => d._type === "roleTargetLock").map((d) => d._id);
    for (const doc of a.filter((d) => d._type === "roleTargetLock")) {
      expect(doc._id).toBe(roleTargetLockId(doc.targetKey));
    }
    expect(lockIds).toContain("roleTarget.sunday_role.2026-08-02");

    for (const doc of a.filter((d) => d._type === "roleCreationReceipt")) {
      expect(doc._id).toBe(receiptIdForRequestId(doc.requestId));
    }
  });
});

describe("buildFixtureDocuments — plan §2 coverage", () => {
  const docs = buildFixtureDocuments({ now: "2026-01-01T00:00:00.000Z" });
  const byId = new Map(docs.map((d) => [d._id, d]));
  const ofType = (t) => docs.filter((d) => d._type === t);

  it("has exactly one credentials-provider test admin", () => {
    const admins = ofType("teamMembers").filter((m) => m.role === "admin");
    expect(admins).toHaveLength(1);
    expect(admins[0]._id).toBe("srv.member.admin");
  });

  it("carries NO password hash in the committed fixture definition", () => {
    expect(JSON.stringify(docs)).not.toContain("passwordHash");
  });

  it("covers all five member-referencing seats on a role", () => {
    const role = byId.get("srv.role.sunday.published");
    expect(role.Lead[0]._ref).toBe("srv.member.lead");
    expect(role.BGVs[0]._ref).toBe("srv.member.bgv");
    expect(role.Chorus[0]._ref).toBe("srv.member.chorus");
    expect(role.instruments[0].person._ref).toBe("srv.member.instrument");
    expect(role.foh_team[0].person._ref).toBe("srv.member.foh");
  });

  it("includes an unavailable member and a dangling-reference case", () => {
    expect(byId.get("srv.member.unavailable").unavailableDates).toContain("2026-08-02");
    const dangling = byId.get("srv.role.sunday.dangling");
    expect(dangling.Lead[0]._ref).toBe(DANGLING_MEMBER_ID);
    expect(dangling.Lead[0]._weak).toBe(true);
    expect(byId.has(DANGLING_MEMBER_ID)).toBe(false);
  });

  it("covers draft / published / legacy-missing-published for all three role types", () => {
    for (const type of ["sunday_role", "saturday_role", "special_role"]) {
      const roles = ofType(type);
      expect(roles.some((r) => r.published === true)).toBe(true);
      expect(roles.some((r) => r.published === false)).toBe(true);
      expect(roles.some((r) => !("published" in r))).toBe(true);
    }
  });

  it("covers empty / incomplete / ready setlists including the saturdarSongs typo", () => {
    expect(byId.get("srv.setlist.sunday.empty").songs).toHaveLength(0);
    expect(byId.get("srv.setlist.saturday.incomplete").songs).toHaveLength(1);
    expect(byId.get("srv.setlist.sunday.ready").songs).toHaveLength(3);
    expect(byId.get("srv.setlist.saturday.incomplete")._type).toBe("saturdarSongs");
  });

  it("covers pending / changes_requested / approved / legacy-approved proposals", () => {
    const statuses = ofType("setlistProposal").map((p) => p.status);
    expect(statuses).toEqual(expect.arrayContaining(["pending", "changes_requested", "approved"]));
    expect(byId.get("srv.proposal.approved").approvalReceiptId).toBeTruthy();
    expect(byId.get("srv.proposal.legacyApproved").approvalReceiptId).toBeUndefined();
  });

  it("covers claimed lock, vacant lock, and a legacy role with NO lock", () => {
    const locks = ofType("roleTargetLock");
    expect(locks.some((l) => l.state === "claimed")).toBe(true);
    expect(locks.some((l) => l.state === "vacant" && !l.roleId)).toBe(true);
    expect(locks.some((l) => l.targetKey === "sunday_role:2026-08-16")).toBe(false);
  });

  it("covers committed / orphan / retired receipts", () => {
    const receipts = ofType("roleCreationReceipt");
    expect(receipts.some((r) => r.state === "committed" && byId.has(r.roleId))).toBe(true);
    expect(receipts.some((r) => r.state === "committed" && !byId.has(r.roleId))).toBe(true);
    expect(receipts.some((r) => r.state === "role_deleted")).toBe(true);
  });

  it("uses only non-deliverable email domains and carries no device tokens", () => {
    for (const m of ofType("teamMembers")) {
      expect(m.email.endsWith("@sr-verify.invalid")).toBe(true);
      expect(m.deviceTokens).toBeUndefined();
    }
    expect(JSON.stringify(docs)).not.toContain("deviceTokens");
  });
});

/* ================================================================== *
 * Reset targeting
 * ================================================================== */

describe("reset targets only deterministic verification fixture ids", () => {
  it("accepts every built fixture id", () => {
    for (const id of fixtureIds()) expect(isDeletableFixtureId(id)).toBe(true);
  });

  it("refuses anything that is not a known fixture id", () => {
    const strangers = [
      "post.abc123",
      "sunday_role.real-production-doc",
      "srv.role.sunday.notAFixture", // right prefix, unknown id
      "drafts.srv.role.sunday.published",
      "roleTarget.sunday_role.2026-12-25",
      "",
      null,
      undefined,
    ];
    for (const id of strangers) expect(isDeletableFixtureId(id)).toBe(false);
  });

  it("never deletes the lease or the marker document", () => {
    expect(isDeletableFixtureId("serviceReadiness.verificationLease")).toBe(false);
    expect(isDeletableFixtureId("serviceReadiness.verificationMarker")).toBe(false);
  });

  it("splits a candidate list into allowed and refused rather than silently dropping", () => {
    const known = fixtureIds()[0];
    const { allowed, refused } = filterDeletableIds([known, "post.something", "srv.unknown"]);
    expect(allowed).toEqual([known]);
    expect(refused).toEqual(["post.something", "srv.unknown"]);
  });
});

/* ================================================================== *
 * Post-apply exactness
 * ================================================================== */

describe("verifyFixtureState / verifyResetState", () => {
  const expected = buildFixtureDocuments({ now: "2026-01-01T00:00:00.000Z" });

  it("passes when the re-query matches exactly", () => {
    expect(verifyFixtureState({ expected, actual: expected }).ok).toBe(true);
  });

  it("fails on a missing document", () => {
    const actual = expected.slice(1);
    const r = verifyFixtureState({ expected, actual });
    expect(r.ok).toBe(false);
    expect(r.failures[0].code).toBe("missing_document");
  });

  it("fails on a wrong _type", () => {
    const actual = expected.map((d, i) => (i === 0 ? { ...d, _type: "wrong" } : d));
    expect(codes(verifyFixtureState({ expected, actual }).failures)).toContain("wrong_type");
  });

  it("fails on an unexpected leftover srv.* document", () => {
    const actual = [...expected, { _id: "srv.role.sunday.stale", _type: "sunday_role" }];
    expect(codes(verifyFixtureState({ expected, actual }).failures)).toContain("unexpected_document");
  });

  it("requires reset to leave zero fixture documents behind", () => {
    expect(verifyResetState({ remaining: [] }).ok).toBe(true);
    const r = verifyResetState({ remaining: [{ _id: "srv.member.lead" }] });
    expect(r.ok).toBe(false);
    expect(r.failures[0].code).toBe("fixture_not_removed");
  });
});

/* ================================================================== *
 * Structural proof: no dry-run path can reach the Sanity client
 * ================================================================== */

describe("script structure — the remote half is unreachable without --apply", () => {
  const scripts = [
    "service-readiness-verification-seed.mjs",
    "service-readiness-verification-reset.mjs",
    "service-readiness-feasibility.mjs",
  ];

  it.each(scripts)("%s loads the runtime module only behind the willContactRemote gate", (name) => {
    const source = readFileSync(new URL(`../../${name}`, import.meta.url), "utf8");

    // The client-owning module is never a static import.
    expect(source).not.toMatch(/^import[^\n]*sr-verification-runtime/m);
    expect(source).not.toMatch(/^import[^\n]*@sanity\/client/m);

    // It is loaded exactly once, dynamically, AFTER the guard gate exits.
    const dynamicAt = source.indexOf('await import(\n  "./lib/sr-verification-runtime.mjs"');
    expect(dynamicAt).toBeGreaterThan(-1);
    const gateAt = source.indexOf("if (!guards.willContactRemote)");
    expect(gateAt).toBeGreaterThan(-1);
    expect(gateAt).toBeLessThan(dynamicAt);
    expect(source.slice(gateAt, dynamicAt)).toContain("process.exit(0)");
  });

  it.each(scripts)("%s refuses before the gate when a guard failed", (name) => {
    const source = readFileSync(new URL(`../../${name}`, import.meta.url), "utf8");
    const refusedAt = source.indexOf("if (guards.refused)");
    const gateAt = source.indexOf("if (!guards.willContactRemote)");
    expect(refusedAt).toBeGreaterThan(-1);
    expect(refusedAt).toBeLessThan(gateAt);
    expect(source.slice(refusedAt, gateAt)).toContain("process.exit(1)");
  });
});

/* ================================================================== *
 * Backups
 * ================================================================== */

describe("backups", () => {
  it("writes into the gitignored backup directory with a timestamped name", () => {
    const name = backupFileName({ kind: "seed", now: NOW });
    expect(name.startsWith(`${BACKUP_DIR}/`)).toBe(true);
    expect(name.endsWith("-seed.json")).toBe(true);
    expect(name).not.toContain(":"); // safe on every filesystem
  });

  it("records project/dataset/owner and the exact pre-mutation documents", () => {
    const env = buildBackupEnvelope({
      kind: "reset",
      now: NOW,
      projectId: VERIFICATION_PROJECT_ID,
      dataset: VERIFICATION_DATASET,
      owner: OWNER,
      documents: [{ _id: "srv.member.lead", _type: "teamMembers" }],
    });
    expect(env).toMatchObject({ kind: "reset", projectId: VERIFICATION_PROJECT_ID, dataset: VERIFICATION_DATASET });
    expect(env.documentCount).toBe(1);
  });
});
