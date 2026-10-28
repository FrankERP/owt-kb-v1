// The leveled-ministry half of ADR-0075: `normalizeMinistryRoles` (the one
// reading of `teamMembers.ministryRoles`) and the pure answers built on it.
// Worship and kids are held to the old guards by ministryAccess.equivalence.test.ts.
import { describe, expect, it, vi } from "vitest";

// accessFromDoc is pure; its module also holds the cached fetch, whose client needs env.
vi.mock("@/sanity/lib/serverClient", () => ({ serverClient: { fetch: vi.fn() } }));
import { normalizeMinistryRoles, isGroupId, type MinistryId } from "@/app/ministries";
import { accessFromDoc } from "../memberAccess";
import { groupsIn, isMinistryManager, isMinistryMember, levelIn } from "../ministryAccess";

const J: MinistryId[] = ["jovenes"];
const item = (p: Record<string, unknown> = {}) => ({
  _key: "jovenes", ministry: "jovenes", level: "leader", groups: ["otro-nivel"], ...p,
});

describe("normalizeMinistryRoles", () => {
  it("reads a valid item", () => {
    expect(normalizeMinistryRoles([item()], J)).toEqual([
      { ministry: "jovenes", level: "leader", groups: ["otro-nivel"] },
    ]);
  });
  it("is [] for anything that is not an array", () => {
    for (const raw of [undefined, null, "jovenes", { ministry: "jovenes" }, 3]) {
      expect(normalizeMinistryRoles(raw, J)).toEqual([]);
    }
  });
  it("rule 1: drops an item for a ministry the person is NOT a member of (the trap)", () => {
    expect(normalizeMinistryRoles([item({ level: "admin" })], ["worship"])).toEqual([]);
  });
  it("rule 1: drops an item for a ministry that is not leveled", () => {
    expect(normalizeMinistryRoles([item({ ministry: "kids" })], ["kids"])).toEqual([]);
    expect(normalizeMinistryRoles([item({ ministry: "worship" })], ["worship"])).toEqual([]);
  });
  it("rule 2: drops an item whose level is unknown (plain membership, no level)", () => {
    for (const level of ["owner", "", null, undefined, "ADMIN", "toString"]) {
      expect(normalizeMinistryRoles([item({ level })], J), String(level)).toEqual([]);
    }
  });
  it("rule 3: keeps only this ministry's groups, de-duplicated", () => {
    expect(
      normalizeMinistryRoles([item({ groups: ["otro-nivel", "otro-nivel", "worship", "constructor", 7, "invencibles"] })], J),
    ).toEqual([{ ministry: "jovenes", level: "leader", groups: ["otro-nivel", "invencibles"] }]);
    expect(normalizeMinistryRoles([item({ groups: "otro-nivel" })], J)[0].groups).toEqual([]);
  });
  it("rule 4: two items naming one ministry → both dropped, even if one is malformed", () => {
    expect(normalizeMinistryRoles([item({ level: "admin" }), item({ level: "member" })], J)).toEqual([]);
    expect(normalizeMinistryRoles([item({ level: "admin" }), item({ level: "bogus" })], J)).toEqual([]);
  });
  it("prototype strings validate nowhere", () => {
    for (const k of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
      expect(normalizeMinistryRoles([item({ ministry: k })], J)).toEqual([]);
      expect(normalizeMinistryRoles([item({ level: k })], J)).toEqual([]);
      expect(isGroupId("jovenes", k)).toBe(false);
    }
  });
  it("skips non-object entries without failing the rest", () => {
    expect(normalizeMinistryRoles([null, "x", 1, item()], J)).toHaveLength(1);
  });
});

describe("ministryAccess for a leveled ministry (Jóvenes)", () => {
  const doc = (p: Record<string, unknown>) => accessFromDoc({ _id: "m1", role: "member", ...p });

  it("a Jóvenes admin manages Jóvenes, and nothing of worship or kids", () => {
    const a = doc({ ministries: ["jovenes"], ministryRoles: [item({ level: "admin", groups: [] })] });
    expect(isMinistryManager(a, "jovenes")).toBe(true);
    expect(isMinistryMember(a, "worship")).toBe(false);
    expect(isMinistryManager(a, "worship")).toBe(false);
    expect(isMinistryMember(a, "kids")).toBe(false);
  });
  it("a leader or a plain member does not manage it", () => {
    expect(isMinistryManager(doc({ ministries: ["jovenes"], ministryRoles: [item()] }), "jovenes")).toBe(false);
    expect(isMinistryManager(doc({ ministries: ["jovenes"] }), "jovenes")).toBe(false);
  });
  it("an admin level WITHOUT membership grants nothing (absent ministries = worship)", () => {
    const a = doc({ ministryRoles: [item({ level: "admin" })] });
    expect(a.ministries).toEqual(["worship"]);
    expect(a.ministryRoles).toEqual([]); // read against the NORMALIZED ministries
    expect(isMinistryManager(a, "jovenes")).toBe(false);
    expect(isMinistryMember(a, "jovenes")).toBe(false);
  });
  it("managesMinistries never grants a leveled ministry", () => {
    expect(isMinistryManager(doc({ ministries: ["jovenes"], managesMinistries: ["jovenes"] }), "jovenes")).toBe(false);
  });
  it("super-admin manages and belongs to every ministry", () => {
    const a = doc({ role: "super-admin" });
    expect(isMinistryManager(a, "jovenes")).toBe(true);
    expect(isMinistryMember(a, "jovenes")).toBe(true);
  });
  it("levelIn / groupsIn: null and [] for a non-member, member and [] with no entry", () => {
    expect(levelIn(doc({ ministries: ["worship"] }), "jovenes")).toBeNull();
    expect(groupsIn(doc({ ministries: ["worship"] }), "jovenes")).toEqual([]);
    expect(levelIn(doc({ ministries: ["jovenes"] }), "jovenes")).toBe("member");
    expect(groupsIn(doc({ ministries: ["jovenes"] }), "jovenes")).toEqual([]);
    const leader = doc({ ministries: ["worship", "jovenes"], ministryRoles: [item({ groups: ["emprendedores"] })] });
    expect(levelIn(leader, "jovenes")).toBe("leader");
    expect(groupsIn(leader, "jovenes")).toEqual(["emprendedores"]);
    // No super-admin arm: phase 3's group guards add it explicitly.
    expect(levelIn(doc({ role: "super-admin", ministries: ["worship"] }), "jovenes")).toBeNull();
  });
});
