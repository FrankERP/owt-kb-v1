// The write side of a LEVELED ministry (ADR-0075, access plan §3.4): what the
// members routes accept as `ministryRoles`, how they store it, which stale levels
// they clear, and the worship-role rule both writers of `role` share.
import { describe, expect, it } from "vitest";
import {
  droppedMinistryRolePaths,
  ministryRolesForStorage,
  validateMinistryRolesWrite,
  worshipRoleWithoutWorship,
} from "@/app/ministries";

const item = (p: Record<string, unknown> = {}) => ({ ministry: "jovenes", level: "member", groups: [], ...p });
const J = ["worship", "jovenes"];

describe("validateMinistryRolesWrite", () => {
  it("accepts every level, with or without groups (a leader needs one)", () => {
    expect(validateMinistryRolesWrite([], J)).toBeNull();
    expect(validateMinistryRolesWrite([item()], J)).toBeNull();
    expect(validateMinistryRolesWrite([item({ level: "admin" })], ["jovenes"])).toBeNull();
    expect(validateMinistryRolesWrite([item({ level: "leader", groups: ["emprendedores"] })], J)).toBeNull();
    expect(validateMinistryRolesWrite([item({ groups: ["otro-nivel", "invencibles", "emprendedores"] })], J)).toBeNull();
  });
  it("requires `ministries` in the same request, naming the item's ministry", () => {
    expect(validateMinistryRolesWrite([item()], undefined)).not.toBeNull();
    expect(validateMinistryRolesWrite([item()], ["worship"])).not.toBeNull();
    expect(validateMinistryRolesWrite([], undefined)).not.toBeNull();
  });
  it("refuses a non-array, a non-object item, and any key beyond ministry/level/groups", () => {
    for (const bad of [null, "x", { ministry: "jovenes" }]) expect(validateMinistryRolesWrite(bad, J)).not.toBeNull();
    for (const bad of [null, "jovenes", ["jovenes"]]) expect(validateMinistryRolesWrite([bad], J)).not.toBeNull();
    expect(validateMinistryRolesWrite([{ ...item(), _key: "jovenes" }], J)).not.toBeNull();
    expect(validateMinistryRolesWrite([{ ministry: "jovenes", level: "member" }], J)).not.toBeNull();
  });
  it("refuses a ministry that is not leveled", () => {
    expect(validateMinistryRolesWrite([item({ ministry: "worship" })], J)).not.toBeNull();
    expect(validateMinistryRolesWrite([item({ ministry: "kids" })], ["kids"])).not.toBeNull();
  });
  it("refuses two items for one ministry", () => {
    expect(validateMinistryRolesWrite([item(), item({ level: "admin" })], J)).toBe("Un solo nivel por ministerio.");
  });
  it("refuses an unknown level, an unknown or repeated group, and a leader with no group", () => {
    expect(validateMinistryRolesWrite([item({ level: "owner" })], J)).toBe("Nivel inválido.");
    expect(validateMinistryRolesWrite([item({ groups: ["worship"] })], J)).toBe("Grupo inválido.");
    expect(validateMinistryRolesWrite([item({ groups: "otro-nivel" })], J)).toBe("Grupo inválido.");
    expect(validateMinistryRolesWrite([item({ groups: ["otro-nivel", "otro-nivel"] })], J)).toBe("Grupo repetido.");
    expect(validateMinistryRolesWrite([item({ level: "leader" })], J)).toBe("Un líder necesita al menos un grupo.");
  });
  it("prototype strings validate nowhere", () => {
    for (const k of ["constructor", "toString", "__proto__"]) {
      expect(validateMinistryRolesWrite([item({ ministry: k })], [...J, k])).not.toBeNull();
      expect(validateMinistryRolesWrite([item({ level: k })], J)).not.toBeNull();
      expect(validateMinistryRolesWrite([item({ groups: [k] })], J)).not.toBeNull();
    }
  });
});

describe("ministryRolesForStorage", () => {
  it("keys each item by its ministry and types it as the Studio object", () => {
    const groups = ["invencibles"];
    const stored = ministryRolesForStorage([{ ministry: "jovenes", level: "leader", groups }]);
    expect(stored).toEqual([{ _key: "jovenes", _type: "ministryRole", ministry: "jovenes", level: "leader", groups }]);
    expect(stored[0].groups).not.toBe(groups);
  });
});

describe("droppedMinistryRolePaths", () => {
  it("names the level of each leveled ministry the new list leaves out", () => {
    expect(droppedMinistryRolePaths(["worship"])).toEqual(['ministryRoles[_key=="jovenes"]']);
    expect(droppedMinistryRolePaths(["worship", "jovenes"])).toEqual([]);
  });
});

describe("worshipRoleWithoutWorship — the rule both writers of `role` enforce", () => {
  it("catches a worship management role outside worship", () => {
    expect(worshipRoleWithoutWorship("admin", ["jovenes"])).toBe(true);
    expect(worshipRoleWithoutWorship("content-editor", ["kids"])).toBe(true);
    expect(worshipRoleWithoutWorship("admin", ["kids", "jovenes"])).toBe(true);
  });
  it("absent or empty ministries are worship (the storage contract)", () => {
    expect(worshipRoleWithoutWorship("admin", undefined)).toBe(false);
    expect(worshipRoleWithoutWorship("admin", [])).toBe(false);
    expect(worshipRoleWithoutWorship("admin", ["worship", "jovenes"])).toBe(false);
  });
  it("super-admin spans every ministry; member and no role grant nothing", () => {
    for (const role of ["super-admin", "member", null, undefined, "weird"]) {
      expect(worshipRoleWithoutWorship(role, ["jovenes"])).toBe(false);
    }
  });
});
