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

const item = (p: Record<string, unknown> = {}) => ({ ministry: "jovenes", level: "member", groups: [], leaderOf: [], ...p });
const J = ["worship", "jovenes"];

describe("validateMinistryRolesWrite", () => {
  it("accepts every level, with or without groups (a leader leads at least one)", () => {
    expect(validateMinistryRolesWrite([], J)).toBeNull();
    expect(validateMinistryRolesWrite([item()], J)).toBeNull();
    expect(validateMinistryRolesWrite([item({ level: "admin" })], ["jovenes"])).toBeNull();
    expect(validateMinistryRolesWrite([item({ level: "admin", groups: ["emprendedores", "guerreras"] })], ["jovenes"])).toBeNull();
    expect(validateMinistryRolesWrite([item({ level: "leader", groups: ["emprendedores"], leaderOf: ["emprendedores"] })], J)).toBeNull();
    // Jacob (plan §1): leads two of his three groups.
    expect(
      validateMinistryRolesWrite([item({ level: "leader", groups: ["otro-nivel", "invencibles", "adrenalin"], leaderOf: ["otro-nivel", "adrenalin"] })], J),
    ).toBeNull();
    expect(validateMinistryRolesWrite([item({ groups: ["otro-nivel", "invencibles", "emprendedores"] })], J)).toBeNull();
  });
  it("requires `ministries` in the same request, naming the item's ministry", () => {
    expect(validateMinistryRolesWrite([item()], undefined)).not.toBeNull();
    expect(validateMinistryRolesWrite([item()], ["worship"])).not.toBeNull();
    expect(validateMinistryRolesWrite([], undefined)).not.toBeNull();
  });
  it("refuses a non-array, a non-object item, and any key set but exactly groups/leaderOf/level/ministry", () => {
    for (const bad of [null, "x", { ministry: "jovenes" }]) expect(validateMinistryRolesWrite(bad, J)).not.toBeNull();
    for (const bad of [null, "jovenes", ["jovenes"]]) expect(validateMinistryRolesWrite([bad], J)).not.toBeNull();
    expect(validateMinistryRolesWrite([{ ...item(), _key: "jovenes" }], J)).not.toBeNull();
    expect(validateMinistryRolesWrite([{ ministry: "jovenes", level: "member" }], J)).not.toBeNull();
    // A PR 1 body (no `leaderOf`) — a stale tab of the old form — is refused, never reinterpreted (plan §7).
    expect(validateMinistryRolesWrite([{ ministry: "jovenes", level: "leader", groups: ["otro-nivel"] }], J)).toBe("Niveles de ministerio inválidos.");
    expect(validateMinistryRolesWrite([{ ministry: "jovenes", level: "member", groups: [] }], J)).toBe("Niveles de ministerio inválidos.");
  });
  it("refuses a ministry that is not leveled", () => {
    expect(validateMinistryRolesWrite([item({ ministry: "worship" })], J)).not.toBeNull();
    expect(validateMinistryRolesWrite([item({ ministry: "kids" })], ["kids"])).not.toBeNull();
  });
  it("refuses two items for one ministry", () => {
    expect(validateMinistryRolesWrite([item(), item({ level: "admin" })], J)).toBe("Un solo nivel por ministerio.");
  });
  it("refuses an unknown level, an unknown or repeated group, and a leader who leads nothing", () => {
    expect(validateMinistryRolesWrite([item({ level: "owner" })], J)).toBe("Nivel inválido.");
    expect(validateMinistryRolesWrite([item({ groups: ["worship"] })], J)).toBe("Grupo inválido.");
    expect(validateMinistryRolesWrite([item({ groups: "otro-nivel" })], J)).toBe("Grupo inválido.");
    expect(validateMinistryRolesWrite([item({ groups: ["otro-nivel", "otro-nivel"] })], J)).toBe("Grupo repetido.");
    expect(validateMinistryRolesWrite([item({ level: "leader" })], J)).toBe("Un líder necesita liderar al menos un grupo.");
    expect(validateMinistryRolesWrite([item({ level: "leader", groups: ["otro-nivel"] })], J)).toBe("Un líder necesita liderar al menos un grupo.");
  });
  it("refuses a `leaderOf` that is not a list of this ministry's groups, repeats one, or leaves `groups`", () => {
    const leader = (leaderOf: unknown, groups: unknown = ["otro-nivel", "invencibles"]) => item({ level: "leader", groups, leaderOf });
    for (const bad of [null, "otro-nivel", { 0: "otro-nivel" }, ["worship"], [1], ["toString"]]) {
      expect(validateMinistryRolesWrite([leader(bad)], J)).toBe("Grupo inválido.");
    }
    expect(validateMinistryRolesWrite([leader(["otro-nivel", "otro-nivel"])], J)).toBe("Grupo repetido.");
    expect(validateMinistryRolesWrite([leader(["emprendedores"])], J)).toBe("Solo puede liderar un grupo al que pertenece.");
    expect(validateMinistryRolesWrite([leader(["otro-nivel", "emprendedores"])], J)).toBe("Solo puede liderar un grupo al que pertenece.");
  });
  it("refuses a non-empty `leaderOf` on a member or an admin (an admin already administers every group)", () => {
    for (const level of ["member", "admin"]) {
      expect(validateMinistryRolesWrite([item({ level, groups: ["otro-nivel"], leaderOf: ["otro-nivel"] })], J)).toBe(
        "Solo un líder lidera grupos; un admin ya administra todos.",
      );
      expect(validateMinistryRolesWrite([item({ level, groups: ["otro-nivel"], leaderOf: [] })], J)).toBeNull();
    }
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
    const leaderOf = ["invencibles"];
    const stored = ministryRolesForStorage([{ ministry: "jovenes", level: "leader", groups, leaderOf }]);
    expect(stored).toEqual([{ _key: "jovenes", _type: "ministryRole", ministry: "jovenes", level: "leader", groups, leaderOf }]);
    expect(stored[0].groups).not.toBe(groups);
    expect(stored[0].leaderOf).not.toBe(leaderOf);
  });
  it("stores `leaderOf` for a leader only; a member or admin item carries no key (I2)", () => {
    const groups = ["otro-nivel", "invencibles"];
    const leader = ministryRolesForStorage([{ ministry: "jovenes", level: "leader", groups, leaderOf: ["otro-nivel"] }])[0];
    expect(leader.leaderOf).toEqual(["otro-nivel"]);
    for (const level of ["member", "admin"] as const) {
      const [stored] = ministryRolesForStorage([{ ministry: "jovenes", level, groups, leaderOf: ["otro-nivel"] }]);
      expect(Object.keys(stored).sort()).toEqual(["_key", "_type", "groups", "level", "ministry"]);
    }
  });
  it("stores what was validated, per level (I2): a leader's `leaderOf` as sent, none on a member or admin", () => {
    const sent = [{ ministry: "jovenes" as const, level: "leader" as const, groups: ["otro-nivel", "invencibles"], leaderOf: ["invencibles"] }];
    expect(validateMinistryRolesWrite(sent, J)).toBeNull();
    expect(ministryRolesForStorage(sent)).toEqual([
      { _key: "jovenes", _type: "ministryRole", ministry: "jovenes", level: "leader", groups: ["otro-nivel", "invencibles"], leaderOf: ["invencibles"] },
    ]);
    for (const level of ["member", "admin"] as const) {
      const body = [{ ministry: "jovenes" as const, level, groups: ["otro-nivel"], leaderOf: [] }];
      expect(validateMinistryRolesWrite(body, J)).toBeNull();
      expect(ministryRolesForStorage(body)).toEqual([{ _key: "jovenes", _type: "ministryRole", ministry: "jovenes", level, groups: ["otro-nivel"] }]);
    }
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
