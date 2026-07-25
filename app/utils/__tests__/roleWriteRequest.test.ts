import { describe, expect, it } from "vitest";

import {
  buildRoleDocument,
  buildRoleEditPatch,
  decideReceipt,
  isCanonicalDocumentId,
  isRevisionString,
  isValidCreationRequestId,
  normalizeSeats,
  parseCreateRequest,
  parseDeleteRequest,
  parseEditRequest,
  parsePublishRequest,
  planOwnedLock,
  planTargetClaim,
  prevalidatePublishBatch,
  roleDateField,
  sanityConflictKind,
  seatAssignees,
  storedRoleDate,
} from "@/app/utils/roleWriteRequest";
import { payloadFingerprint, receiptIdForRequestId } from "@/app/utils/roleCreationReceipt";

const REQ = "req-abc-0001";

function createBody(over: Record<string, unknown> = {}) {
  return {
    creationRequestId: REQ,
    _type: "sunday_role",
    date: "2026-08-09",
    published: false,
    leads: ["mem-1"],
    bgvs: [],
    chorus: [],
    instruments: [{ instrument: "Guitarra", personId: "mem-2" }],
    foh: [{ role: "Audio", personId: "mem-3" }],
    ...over,
  };
}

describe("request-shape primitives", () => {
  it("bounds the opaque creation request id", () => {
    expect(isValidCreationRequestId("req-abc-0001")).toBe(true);
    expect(isValidCreationRequestId("short")).toBe(false);
    expect(isValidCreationRequestId("x".repeat(129))).toBe(false);
    expect(isValidCreationRequestId("has space 1")).toBe(false);
    expect(isValidCreationRequestId(12345678)).toBe(false);
  });

  it("rejects draft ids and unbounded/whitespace document ids", () => {
    expect(isCanonicalDocumentId("role-1")).toBe(true);
    expect(isCanonicalDocumentId("drafts.role-1")).toBe(false);
    expect(isCanonicalDocumentId("role 1")).toBe(false);
    expect(isCanonicalDocumentId("")).toBe(false);
    expect(isRevisionString("rev-1")).toBe(true);
    expect(isRevisionString("")).toBe(false);
  });
});

describe("seat normalization", () => {
  it("preserves request order and drops blanks/malformed slots", () => {
    const seats = normalizeSeats({
      leads: ["b", "a", "", null],
      bgvs: ["c"],
      chorus: undefined,
      instruments: [
        { instrument: "  Bajo  ", personId: "m1" },
        { instrument: "", personId: "m2" },
        { instrument: "Piano", personId: "" },
      ],
      foh: [{ role: "Audio", personId: "m9" }],
    });
    expect(seats.leads).toEqual(["b", "a"]);
    expect(seats.bgvs).toEqual(["c"]);
    expect(seats.chorus).toEqual([]);
    expect(seats.instruments).toEqual([{ instrument: "Bajo", personId: "m1" }]);
    expect(seats.foh).toEqual([{ role: "Audio", personId: "m9" }]);
  });

  it("collects assignees across all five seat paths, de-duplicated", () => {
    const seats = normalizeSeats({
      leads: ["m1"],
      bgvs: ["m1", "m2"],
      chorus: ["m3"],
      instruments: [{ instrument: "Bajo", personId: "m4" }],
      foh: [{ role: "Audio", personId: "m5" }],
    });
    expect(seatAssignees(seats)).toEqual(["m1", "m2", "m3", "m4", "m5"]);
  });
});

describe("stored document shapes", () => {
  it("writes the weekend date to week and the special date to date", () => {
    expect(roleDateField("sunday_role")).toBe("week");
    expect(roleDateField("saturday_role")).toBe("week");
    expect(roleDateField("special_role")).toBe("date");
    expect(storedRoleDate({ _type: "special_role", date: "2026-08-09" })).toBe("2026-08-09");
    expect(storedRoleDate({ _type: "sunday_role", week: "2026-08-09" })).toBe("2026-08-09");
    expect(storedRoleDate({ _type: "sunday_role", week: "nope" })).toBeNull();
  });

  it("gives every array item a _key and links the creation receipt", () => {
    let n = 0;
    const doc = buildRoleDocument({
      roleId: "role-9",
      roleType: "sunday_role",
      date: "2026-08-09",
      serviceName: null,
      published: true,
      seats: normalizeSeats(createBody()),
      receiptId: "roleCreate.abc",
      fingerprint: "fp",
      nextKey: () => `k${++n}`,
    });
    expect(doc._id).toBe("role-9");
    expect(doc.week).toBe("2026-08-09");
    expect(doc.date).toBeUndefined();
    expect(doc.creationReceiptId).toBe("roleCreate.abc");
    for (const field of ["Lead", "BGVs", "Chorus", "instruments", "foh_team"]) {
      for (const item of doc[field] as { _key: string }[]) expect(item._key).toBeTruthy();
    }
    expect((doc.instruments as { person: { _ref: string } }[])[0].person._ref).toBe("mem-2");
  });

  it("never includes _type in an edit patch (type is immutable per id)", () => {
    const patch = buildRoleEditPatch({
      roleType: "special_role",
      date: "2026-08-09",
      serviceName: "Bautizos",
      seats: normalizeSeats(createBody()),
      nextKey: () => "k",
    });
    expect(patch._type).toBeUndefined();
    expect(patch.date).toBe("2026-08-09");
    expect(patch.service_name).toBe("Bautizos");
    expect(patch.week).toBeUndefined();
  });
});

describe("parseCreateRequest", () => {
  it("derives the receipt id, fingerprint, target and lock id", () => {
    const parsed = parseCreateRequest(createBody());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.receiptId).toBe(receiptIdForRequestId(REQ));
    expect(parsed.value.fingerprint).toBe(payloadFingerprint(createBody()));
    expect(parsed.value.targetKey).toBe("sunday_role:2026-08-09");
    expect(parsed.value.lockId).toBe("roleTarget.sunday_role.2026-08-09");
  });

  it("gives a special create no weekend lock and a name-bearing target", () => {
    const parsed = parseCreateRequest(
      createBody({ _type: "special_role", service_name: " Noche  de Alabanza " }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.lockId).toBeNull();
    expect(parsed.value.targetKey).toBe("special_role:2026-08-09:Noche de Alabanza");
  });

  it("rejects a missing request id, bad date, bad type, or unnamed special", () => {
    expect(parseCreateRequest(createBody({ creationRequestId: undefined }))).toMatchObject({ ok: false });
    expect(parseCreateRequest(createBody({ date: "2026-02-30" }))).toMatchObject({ ok: false });
    expect(parseCreateRequest(createBody({ _type: "post" }))).toMatchObject({ ok: false });
    expect(parseCreateRequest(createBody({ _type: "special_role" }))).toMatchObject({ ok: false });
    expect(parseCreateRequest(null)).toMatchObject({ ok: false });
  });

  it("hashes a pure reorder identically but a changed date/type/name differently", () => {
    const base = payloadFingerprint(createBody());
    expect(payloadFingerprint(createBody({ leads: ["mem-1"] }))).toBe(base);
    expect(payloadFingerprint(createBody({ date: "2026-08-16" }))).not.toBe(base);
    expect(payloadFingerprint(createBody({ _type: "saturday_role" }))).not.toBe(base);
    expect(payloadFingerprint(createBody({ published: true }))).not.toBe(base);
  });
});

describe("parseEditRequest / parseDeleteRequest", () => {
  it("requires an observed revision and a real date", () => {
    expect(parseEditRequest({ date: "2026-08-09" })).toMatchObject({ ok: false, issues: ["rev"] });
    expect(parseEditRequest({ rev: "r1", date: "nope" })).toMatchObject({ ok: false, issues: ["date"] });
    const ok = parseEditRequest({ rev: "r1", date: "2026-08-09", _type: "sunday_role", leads: ["m1"] });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.value.requestedType).toBe("sunday_role");
  });

  it("rejects an unknown requested type outright", () => {
    expect(parseEditRequest({ rev: "r1", date: "2026-08-09", _type: "post" })).toMatchObject({
      ok: false,
      issues: ["_type"],
    });
  });

  it("requires an observed revision to delete", () => {
    expect(parseDeleteRequest({})).toMatchObject({ ok: false, issues: ["rev"] });
    expect(parseDeleteRequest({ rev: "r1" })).toMatchObject({ ok: true });
    expect(parseDeleteRequest({ rev: "r1", lockRev: 5 })).toMatchObject({ ok: false });
  });
});

describe("parsePublishRequest", () => {
  it("accepts the exact contract only", () => {
    const ok = parsePublishRequest({ roles: [{ id: "role-1", rev: "r1" }], published: true });
    expect(ok).toMatchObject({ ok: true });
    expect(parsePublishRequest({ roles: [{ id: "role-1", rev: "r1" }] })).toMatchObject({ ok: false, issues: ["published"] });
    expect(parsePublishRequest({ roles: [], published: true })).toMatchObject({ ok: false, issues: ["roles"] });
    expect(parsePublishRequest({ ids: ["role-1"], published: true })).toMatchObject({ ok: false });
    expect(parsePublishRequest({ roles: [{ id: "role-1", rev: "r1" }], published: "true" })).toMatchObject({ ok: false });
  });

  it("rejects draft ids, missing revisions, duplicates and oversized batches", () => {
    expect(parsePublishRequest({ roles: [{ id: "drafts.role-1", rev: "r" }], published: true })).toMatchObject({ ok: false, issues: ["role_id"] });
    expect(parsePublishRequest({ roles: [{ id: "role-1" }], published: true })).toMatchObject({ ok: false, issues: ["role_rev"] });
    expect(
      parsePublishRequest({ roles: [{ id: "role-1", rev: "a" }, { id: "role-1", rev: "b" }], published: true }),
    ).toMatchObject({ ok: false, issues: ["duplicate_role_id"] });
    const many = Array.from({ length: 101 }, (_, i) => ({ id: `role-${i}`, rev: "r" }));
    expect(parsePublishRequest({ roles: many, published: true })).toMatchObject({ ok: false, issues: ["batch_size"] });
  });
});

describe("decideReceipt", () => {
  const receipt = {
    _id: "roleCreate.abc",
    _rev: "rr1",
    _type: "roleCreationReceipt",
    requestId: REQ,
    fingerprint: "fp",
    roleId: "role-1",
    roleType: "sunday_role",
    state: "committed",
  };
  const role = { _id: "role-1", _type: "sunday_role" };

  it("is a replay only with exact key, same fingerprint and a live matching role", () => {
    expect(decideReceipt({ receipt, requestId: REQ, fingerprint: "fp", role }).decision).toBe("replay");
  });

  it("is absent when no receipt exists", () => {
    expect(decideReceipt({ receipt: null, requestId: REQ, fingerprint: "fp", role: null }).decision).toBe("absent");
  });

  it("is a mismatch for the same key with a different fingerprint", () => {
    expect(decideReceipt({ receipt, requestId: REQ, fingerprint: "other", role }).decision).toBe(
      "idempotency_mismatch",
    );
  });

  it("is retired once its role was deleted", () => {
    expect(
      decideReceipt({ receipt: { ...receipt, state: "role_deleted" }, requestId: REQ, fingerprint: "fp", role: null })
        .decision,
    ).toBe("idempotency_key_retired");
  });

  it("fails closed on a digest collision, wrong type, or missing/mismatched result role", () => {
    expect(decideReceipt({ receipt, requestId: "other-request-id", fingerprint: "fp", role }).decision).toBe(
      "integrity_conflict",
    );
    expect(decideReceipt({ receipt: { ...receipt, _type: "post" }, requestId: REQ, fingerprint: "fp", role }).decision).toBe(
      "integrity_conflict",
    );
    expect(decideReceipt({ receipt, requestId: REQ, fingerprint: "fp", role: null }).decision).toBe(
      "integrity_conflict",
    );
    expect(
      decideReceipt({ receipt, requestId: REQ, fingerprint: "fp", role: { _id: "role-1", _type: "saturday_role" } })
        .decision,
    ).toBe("integrity_conflict");
    expect(decideReceipt({ receipt: { ...receipt, state: "weird" }, requestId: REQ, fingerprint: "fp", role }).decision).toBe(
      "integrity_conflict",
    );
  });
});

describe("lock plans", () => {
  const targetKey = "sunday_role:2026-08-09";
  const base = {
    _id: "roleTarget.sunday_role.2026-08-09",
    _rev: "l1",
    _type: "roleTargetLock",
    targetKey,
    state: "claimed",
    roleId: "role-1",
    generation: 0,
  };

  it("creates a missing lock and reclaims a vacant one", () => {
    expect(planTargetClaim({ lock: null, targetKey })).toEqual({ kind: "create" });
    expect(
      planTargetClaim({ lock: { ...base, state: "vacant", roleId: undefined, generation: 3 }, targetKey }),
    ).toMatchObject({ kind: "reclaim", lockRev: "l1", generation: 3 });
  });

  it("reports an occupied target and never reclaims a malformed or half-vacant lock", () => {
    expect(planTargetClaim({ lock: base, targetKey })).toMatchObject({ kind: "occupied", roleId: "role-1" });
    expect(planTargetClaim({ lock: { ...base, state: "vacant" }, targetKey })).toMatchObject({
      kind: "integrity",
      detail: "vacant_with_role",
    });
    expect(planTargetClaim({ lock: { ...base, roleId: undefined }, targetKey })).toMatchObject({
      kind: "integrity",
      detail: "claimed_without_role",
    });
    expect(planTargetClaim({ lock: { ...base, _id: "roleTarget.wrong" }, targetKey })).toMatchObject({
      kind: "integrity",
    });
    expect(planTargetClaim({ lock: base, targetKey: "special-role-id" })).toMatchObject({ kind: "integrity" });
    expect(planTargetClaim({ lock: base, targetKey, ownerExists: false })).toMatchObject({
      kind: "integrity",
      detail: "orphan_lock",
    });
  });

  it("asserts an owned lock, bootstraps a missing one, refuses a wrong owner", () => {
    expect(planOwnedLock({ lock: base, targetKey, roleId: "role-1" })).toMatchObject({ kind: "assert", lockRev: "l1" });
    expect(planOwnedLock({ lock: null, targetKey, roleId: "role-1" })).toMatchObject({ kind: "bootstrap" });
    expect(planOwnedLock({ lock: base, targetKey, roleId: "role-2" })).toMatchObject({
      kind: "integrity",
      detail: "lock_wrong_owner",
    });
    expect(
      planOwnedLock({ lock: { ...base, state: "vacant", roleId: undefined }, targetKey, roleId: "role-1" }),
    ).toMatchObject({ kind: "integrity", detail: "lock_vacant" });
  });
});

describe("sanityConflictKind", () => {
  it("recognizes only genuine 409 mutation conflicts", () => {
    const already = {
      statusCode: 409,
      details: { type: "mutationError", items: [{ error: { type: "documentAlreadyExistsError" } }] },
    };
    const stale = {
      statusCode: 409,
      details: { type: "mutationError", items: [{ error: { type: "documentRevisionIDDoesNotMatchError" } }] },
    };
    expect(sanityConflictKind(already)).toBe("already_exists");
    expect(sanityConflictKind(stale)).toBe("revision_mismatch");
    expect(sanityConflictKind({ statusCode: 409, details: {} })).toBe("conflict");
    expect(sanityConflictKind({ statusCode: 401 })).toBeNull();
    expect(sanityConflictKind(new Error("network"))).toBeNull();
    expect(sanityConflictKind({ statusCode: 409, details: { type: "schemaError" } })).toBeNull();
  });
});

describe("prevalidatePublishBatch", () => {
  const entries = [
    { id: "role-1", rev: "r1" },
    { id: "role-2", rev: "r2" },
  ];
  const docs = [
    { _id: "role-1", _rev: "r1", _type: "sunday_role", week: "2026-08-09", published: false },
    { _id: "role-2", _rev: "r2", _type: "saturday_role", week: "2026-08-08", published: false },
  ];

  it("accepts an exact one-to-one batch", () => {
    const pre = prevalidatePublishBatch({ entries, fetched: docs });
    expect(pre.ok).toBe(true);
    expect(pre.roles.map((r) => r.targetKey)).toEqual(["sunday_role:2026-08-09", "saturday_role:2026-08-08"]);
  });

  it("rejects the whole batch for a missing, stale, wrong-type or duplicate-target entry", () => {
    expect(prevalidatePublishBatch({ entries, fetched: [docs[0]] }).issues).toContain("missing:role-2");
    expect(
      prevalidatePublishBatch({ entries, fetched: [docs[0], { ...docs[1], _rev: "moved" }] }).issues,
    ).toContain("stale:role-2");
    expect(prevalidatePublishBatch({ entries, fetched: [docs[0], { ...docs[1], _type: "post" }] }).issues).toContain(
      "type:role-2",
    );
    expect(
      prevalidatePublishBatch({
        entries,
        fetched: [docs[0], { ...docs[1], _type: "sunday_role", week: "2026-08-09" }],
      }).issues,
    ).toContain("duplicate_target:sunday_role:2026-08-09");
    expect(prevalidatePublishBatch({ entries, fetched: [docs[0], { ...docs[1], week: "bad" }] }).issues).toContain(
      "invalid:role-2",
    );
  });
});
