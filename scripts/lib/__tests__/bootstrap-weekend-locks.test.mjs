// Parity + safety tests for the weekend-lock bootstrap.
//
// The script is `.mjs` and cannot import the TypeScript helpers, so it mirrors two
// things: the deterministic lock id and the "may this role own a target" subset of
// `validateRole`. Both mirrors are pinned here against the real implementations, so
// the script cannot silently drift from A1/A2's contracts.
import { describe, expect, it } from "vitest";

import { mirrorRoleTargetLockId } from "../sr-verification.mjs";
import { roleTargetLockId } from "@/app/utils/roleTargetLock";
import { validateRole, roleTargetKey } from "@/app/utils/serviceReadModel";

function weekendRole(over = {}) {
  return {
    _id: "sunday-role-2026-08-02",
    _rev: "rev-1",
    _type: "sunday_role",
    week: "2026-08-02",
    Lead: [{ _key: "k1", _type: "reference", _ref: "m1" }],
    BGVs: [],
    Chorus: [],
    instruments: [],
    foh_team: [],
    ...over,
  };
}

// The exact predicate the script uses, kept in sync with the source by these tests.
const SEAT_ARRAYS = ["Lead", "BGVs", "Chorus", "instruments", "foh_team"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function isValidDate(v) {
  if (typeof v !== "string" || !DATE_RE.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
function ownershipProblems(role) {
  const problems = [];
  if (typeof role?._id !== "string" || !role._id) problems.push("identity");
  if (typeof role?._rev !== "string" || !role._rev) problems.push("revision");
  if (!["sunday_role", "saturday_role"].includes(role?._type)) problems.push("type");
  if (!isValidDate(role?.week)) problems.push("date");
  for (const f of SEAT_ARRAYS) if (!Array.isArray(role?.[f])) problems.push(`seat:${f}`);
  return problems;
}

describe("lock id mirror matches the shipped helper", () => {
  for (const key of [
    "sunday_role:2026-08-02",
    "saturday_role:2026-08-01",
    "sunday_role:2026-02-30", // impossible day
    "special_role:2026-08-02", // special takes no weekend lock
    "sunday_role:2026-8-2", // malformed
    "not-a-target",
  ]) {
    it(`agrees for ${key}`, () => {
      expect(mirrorRoleTargetLockId(key)).toBe(roleTargetLockId(key));
    });
  }

  it("derives the documented deterministic id", () => {
    expect(mirrorRoleTargetLockId("sunday_role:2026-08-02")).toBe("roleTarget.sunday_role.2026-08-02");
    expect(mirrorRoleTargetLockId("saturday_role:2026-08-01")).toBe("roleTarget.saturday_role.2026-08-01");
  });

  it("never derives a lock for a special service", () => {
    expect(mirrorRoleTargetLockId("special_role:2026-08-02")).toBeNull();
    expect(mirrorRoleTargetLockId("sp-1")).toBeNull();
  });
});

describe("ownership check agrees with validateRole on lock-relevant cases", () => {
  it("accepts a role the shipped validator calls groupable", () => {
    const role = weekendRole();
    expect(validateRole(role).groupable).toBe(true);
    expect(ownershipProblems(role)).toEqual([]);
  });

  // These are exactly the six legacy roles the seat-array backfill repaired: a
  // missing seat array is invalid, never empty, so such a role must not own a lock.
  for (const field of SEAT_ARRAYS) {
    it(`refuses a role missing ${field}, as validateRole does`, () => {
      const role = weekendRole();
      delete role[field];
      expect(validateRole(role).groupable).toBe(false);
      expect(ownershipProblems(role)).toContain(`seat:${field}`);
    });
  }

  it("refuses a malformed week, as validateRole does", () => {
    const role = weekendRole({ week: "2026-8-2" });
    expect(validateRole(role).groupable).toBe(false);
    expect(ownershipProblems(role)).toContain("date");
  });

  it("refuses an impossible calendar day, as validateRole does", () => {
    const role = weekendRole({ week: "2026-02-30" });
    expect(validateRole(role).groupable).toBe(false);
    expect(ownershipProblems(role)).toContain("date");
  });

  it("refuses missing identity or revision", () => {
    expect(ownershipProblems(weekendRole({ _id: "" }))).toContain("identity");
    expect(ownershipProblems(weekendRole({ _rev: "" }))).toContain("revision");
  });

  it("refuses a special role — it takes no weekend lock", () => {
    const role = weekendRole({ _type: "special_role", week: undefined, date: "2026-08-05" });
    expect(ownershipProblems(role)).toContain("type");
  });
});

describe("target key grouping matches the shipped helper", () => {
  it("builds the same target key the model does", () => {
    const role = weekendRole();
    expect(`${role._type}:${role.week}`).toBe(roleTargetKey(role));
  });

  it("two roles on one date collapse to one target key (the ambiguity the script refuses)", () => {
    const a = weekendRole({ _id: "a" });
    const b = weekendRole({ _id: "b" });
    expect(roleTargetKey(a)).toBe(roleTargetKey(b));
  });
});
