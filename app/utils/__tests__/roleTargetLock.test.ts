import { describe, expect, it } from "vitest";
import {
  ROLE_TARGET_LOCK_TYPE,
  assessRoleTargetLock,
  buildClaimedLock,
  claimLockPatch,
  roleTargetLockId,
  roleTargetLockIdForRole,
  vacateLockPatch,
  validateRoleTargetLock,
  type RoleTargetLockIssueKind,
} from "@/app/utils/roleTargetLock";

const NOW = "2026-07-24T18:00:00.000Z";

function lock(over: Record<string, unknown> = {}) {
  return {
    _id: "roleTarget.sunday_role.2026-07-05",
    _rev: "rev-1",
    _type: ROLE_TARGET_LOCK_TYPE,
    targetKey: "sunday_role:2026-07-05",
    state: "claimed",
    roleId: "role-a",
    roleType: "sunday_role",
    date: "2026-07-05",
    claimNonce: "nonce-1",
    generation: 0,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

// A lookup that resolves role ids to the canonical target key they own.
const owners = (map: Record<string, string | null>) => (roleId: string) => map[roleId] ?? null;

describe("roleTargetLockId", () => {
  const cases: [string, string | null][] = [
    ["sunday_role:2026-07-05", "roleTarget.sunday_role.2026-07-05"],
    ["saturday_role:2026-07-04", "roleTarget.saturday_role.2026-07-04"],
    // Special roles are their own target and get NO weekend lock.
    ["special-role-doc-id", null],
    ["drafts.abc", null],
    // Malformed / non-calendar dates never derive a lock id.
    ["sunday_role:2026-02-30", null],
    ["sunday_role:2026-7-5", null],
    ["sunday_role:", null],
    ["sunday_role", null],
    ["post:2026-07-05", null],
    ["", null],
  ];

  it.each(cases)("derives %s -> %s", (targetKey, expected) => {
    expect(roleTargetLockId(targetKey)).toBe(expected);
  });

  it("fails closed on non-string input", () => {
    expect(roleTargetLockId(null)).toBeNull();
    expect(roleTargetLockId(undefined)).toBeNull();
    expect(roleTargetLockId(42)).toBeNull();
  });
});

describe("roleTargetLockIdForRole", () => {
  it("derives weekend lock ids from the canonical role target", () => {
    expect(roleTargetLockIdForRole({ _type: "sunday_role", _id: "r1", week: "2026-07-05" })).toBe(
      "roleTarget.sunday_role.2026-07-05",
    );
    expect(roleTargetLockIdForRole({ _type: "saturday_role", _id: "r2", week: "2026-07-04" })).toBe(
      "roleTarget.saturday_role.2026-07-04",
    );
  });

  it("returns null for a special role (no weekend lock) and malformed roles", () => {
    expect(roleTargetLockIdForRole({ _type: "special_role", _id: "sp-1", date: "2026-04-03" })).toBeNull();
    expect(roleTargetLockIdForRole({ _type: "sunday_role", _id: "r1" })).toBeNull();
    expect(roleTargetLockIdForRole({})).toBeNull();
  });
});

describe("validateRoleTargetLock", () => {
  function kinds(result: { issues: { kind: RoleTargetLockIssueKind }[] }): RoleTargetLockIssueKind[] {
    return result.issues.map((i) => i.kind);
  }

  it("accepts a well-formed claimed lock whose role owns the same target", () => {
    const result = validateRoleTargetLock(lock(), owners({ "role-a": "sunday_role:2026-07-05" }));
    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result).toMatchObject({
      targetKey: "sunday_role:2026-07-05",
      state: "claimed",
      roleId: "role-a",
      generation: 0,
    });
  });

  it("accepts a well-formed vacant lock with no roleId", () => {
    const result = validateRoleTargetLock(
      lock({ state: "vacant", roleId: undefined, claimNonce: undefined, generation: 3 }),
      owners({}),
    );
    expect(result.valid).toBe(true);
    expect(result.roleId).toBeNull();
    expect(result.generation).toBe(3);
  });

  it("flags claimed_without_role when a claimed lock carries no roleId", () => {
    expect(kinds(validateRoleTargetLock(lock({ roleId: "" }), owners({})))).toEqual(["claimed_without_role"]);
    expect(kinds(validateRoleTargetLock(lock({ roleId: undefined }), owners({})))).toEqual([
      "claimed_without_role",
    ]);
  });

  it("flags vacant_with_role when a vacant lock still names a role", () => {
    const result = validateRoleTargetLock(lock({ state: "vacant" }), owners({ "role-a": "sunday_role:2026-07-05" }));
    expect(kinds(result)).toEqual(["vacant_with_role"]);
    expect(result.issues[0].roleId).toBe("role-a");
  });

  it("flags orphan_lock when the claimed roleId resolves to no canonical role", () => {
    const result = validateRoleTargetLock(lock(), owners({}));
    expect(kinds(result)).toEqual(["orphan_lock"]);
    expect(result.issues[0]).toMatchObject({ roleId: "role-a", lockId: "roleTarget.sunday_role.2026-07-05" });
  });

  it("flags wrong_owner when the claimed role owns a different target", () => {
    const result = validateRoleTargetLock(lock(), owners({ "role-a": "sunday_role:2026-07-12" }));
    expect(kinds(result)).toEqual(["wrong_owner"]);
    expect(result.issues[0].detail).toContain("sunday_role:2026-07-12");
  });

  it("flags id_mismatch when the stored _id is not the deterministic lock id", () => {
    const result = validateRoleTargetLock(
      lock({ _id: "roleTarget.sunday_role.2026-07-12" }),
      owners({ "role-a": "sunday_role:2026-07-05" }),
    );
    expect(kinds(result)).toContain("id_mismatch");
    expect(result.valid).toBe(false);
  });

  const malformed: [string, Record<string, unknown>][] = [
    ["unknown state", { state: "held" }],
    ["missing state", { state: undefined }],
    ["missing targetKey", { targetKey: undefined }],
    ["special targetKey (no weekend lock exists)", { targetKey: "sp-1", _id: "roleTarget.sp-1" }],
    ["roleType disagreeing with targetKey", { roleType: "saturday_role" }],
    ["date disagreeing with targetKey", { date: "2026-07-12" }],
    ["non-integer generation", { generation: "0" }],
    ["negative generation", { generation: -1 }],
    ["missing identity", { _rev: undefined }],
    ["wrong _type", { _type: "sunday_role" }],
  ];

  it.each(malformed)("flags malformed_lock: %s", (_label, over) => {
    const result = validateRoleTargetLock(lock(over), owners({ "role-a": "sunday_role:2026-07-05" }));
    expect(result.valid).toBe(false);
    expect(kinds(result)).toContain("malformed_lock");
  });

  it("treats a non-object as malformed rather than throwing", () => {
    expect(validateRoleTargetLock(null, owners({})).valid).toBe(false);
    expect(kinds(validateRoleTargetLock("nope", owners({})))).toContain("malformed_lock");
  });

  it("never throws when the owner lookup throws", () => {
    const result = validateRoleTargetLock(lock(), () => {
      throw new Error("boom");
    });
    expect(kinds(result)).toEqual(["orphan_lock"]);
  });
});

describe("assessRoleTargetLock", () => {
  it("reports missing_lock for a canonical weekend target with no lock document", () => {
    const { issues } = assessRoleTargetLock(
      { targetKey: "sunday_role:2026-07-05", lock: null, canonicalRoleIds: ["role-a"] },
      owners({ "role-a": "sunday_role:2026-07-05" }),
    );
    expect(issues.map((i) => i.kind)).toEqual(["missing_lock"]);
    expect(issues[0].lockId).toBe("roleTarget.sunday_role.2026-07-05");
  });

  it("reports nothing for an unoccupied target with no lock document", () => {
    const { issues } = assessRoleTargetLock(
      { targetKey: "sunday_role:2026-07-05", lock: null, canonicalRoleIds: [] },
      owners({}),
    );
    expect(issues).toEqual([]);
  });

  it("reports nothing for a special target (special roles never take weekend locks)", () => {
    const { issues, validation } = assessRoleTargetLock(
      { targetKey: "sp-1", lock: null, canonicalRoleIds: ["sp-1"] },
      owners({ "sp-1": "sp-1" }),
    );
    expect(issues).toEqual([]);
    expect(validation).toBeNull();
  });

  it("surfaces the lock's own invariant issues when a lock exists", () => {
    const { issues, validation } = assessRoleTargetLock(
      { targetKey: "sunday_role:2026-07-05", lock: lock(), canonicalRoleIds: ["role-a"] },
      owners({}),
    );
    expect(issues.map((i) => i.kind)).toEqual(["orphan_lock"]);
    expect(validation?.state).toBe("claimed");
  });

  it("is clean when the lock is claimed by the canonical owner", () => {
    const { issues } = assessRoleTargetLock(
      { targetKey: "sunday_role:2026-07-05", lock: lock(), canonicalRoleIds: ["role-a"] },
      owners({ "role-a": "sunday_role:2026-07-05" }),
    );
    expect(issues).toEqual([]);
  });
});

describe("lock document builders", () => {
  it("builds a claimed lock at generation 0 with the deterministic id", () => {
    const doc = buildClaimedLock({
      targetKey: "saturday_role:2026-07-04",
      roleId: "role-b",
      claimNonce: "nonce-9",
      now: NOW,
    });
    expect(doc).toEqual({
      _id: "roleTarget.saturday_role.2026-07-04",
      _type: ROLE_TARGET_LOCK_TYPE,
      targetKey: "saturday_role:2026-07-04",
      state: "claimed",
      roleId: "role-b",
      roleType: "saturday_role",
      date: "2026-07-04",
      claimNonce: "nonce-9",
      generation: 0,
      createdAt: NOW,
      updatedAt: NOW,
    });
  });

  it("refuses to build a lock for a special or malformed target", () => {
    expect(buildClaimedLock({ targetKey: "sp-1", roleId: "sp-1", claimNonce: "n", now: NOW })).toBeNull();
    expect(
      buildClaimedLock({ targetKey: "sunday_role:2026-07-05", roleId: "", claimNonce: "n", now: NOW }),
    ).toBeNull();
  });

  it("claims a vacant lock without advancing the generation", () => {
    expect(claimLockPatch({ roleId: "role-c", claimNonce: "nonce-2", now: NOW })).toEqual({
      set: { state: "claimed", roleId: "role-c", claimNonce: "nonce-2", updatedAt: NOW },
      unset: [],
    });
  });

  it("vacating clears the owner and advances the generation", () => {
    expect(vacateLockPatch({ generation: 4, now: NOW })).toEqual({
      set: { state: "vacant", generation: 5, updatedAt: NOW },
      unset: ["roleId", "claimNonce"],
    });
  });

  it("vacating a lock with a missing/invalid generation restarts at 1", () => {
    expect(vacateLockPatch({ generation: null, now: NOW }).set.generation).toBe(1);
    // @ts-expect-error deliberately wrong type to prove the runtime guard
    expect(vacateLockPatch({ generation: "4", now: NOW }).set.generation).toBe(1);
  });
});
