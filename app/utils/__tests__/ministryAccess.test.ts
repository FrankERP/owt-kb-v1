// The leveled-ministry half of ADR-0075: `normalizeMinistryRoles` (the one
// reading of `teamMembers.ministryRoles`) and the pure answers built on it.
// Worship and kids are held to the old guards by ministryAccess.equivalence.test.ts.
import { describe, expect, it, vi } from "vitest";

// accessFromDoc is pure; its module also holds the cached fetch, whose client needs env.
vi.mock("@/sanity/lib/serverClient", () => ({ serverClient: { fetch: vi.fn() } }));
import { ABSENT_LEADER_OF, normalizeMinistryRoles, isGroupId, type MinistryId } from "@/app/ministries";
import { accessFromDoc } from "../memberAccess";
import { groupsIn, isMinistryManager, isMinistryMember, ledGroupsIn, levelIn } from "../ministryAccess";

const J: MinistryId[] = ["jovenes"];
const item = (p: Record<string, unknown> = {}) => ({
  _key: "jovenes", ministry: "jovenes", level: "leader", groups: ["otro-nivel"], ...p,
});

describe("normalizeMinistryRoles", () => {
  it("reads a valid item", () => {
    expect(normalizeMinistryRoles([item()], J)).toEqual([
      { ministry: "jovenes", level: "leader", groups: ["otro-nivel"], leaderOf: ["otro-nivel"] },
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
    ).toEqual([{ ministry: "jovenes", level: "leader", groups: ["otro-nivel", "invencibles"], leaderOf: ["otro-nivel", "invencibles"] }]);
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

// Step 5 (plan 2026-11-11-jovenes-per-group-leadership §4.4): which groups a leader LEADS.
describe("normalizeMinistryRoles — leaderOf (step 5)", () => {
  const groups = ["otro-nivel", "invencibles", "adrenalin"];
  const read = (p: Record<string, unknown>, absent?: "all" | "none") =>
    normalizeMinistryRoles([item({ groups, ...p })], J, absent)[0];

  it("PR 1 reads with L1: the switch is exported and set to «all»", () => {
    expect(ABSENT_LEADER_OF).toBe("all");
  });
  it("L1: a legacy leader (no key, null, undefined) leads every kept group — today's meaning", () => {
    expect(read({}).leaderOf).toEqual(groups);
    expect(read({ leaderOf: null }).leaderOf).toEqual(groups);
    expect(read({ leaderOf: undefined }).leaderOf).toEqual(groups);
    expect(read({ groups: ["otro-nivel", "bogus"] }).leaderOf).toEqual(["otro-nivel"]);
  });
  it("L2 (the switch PR 2 flips): a legacy leader leads nothing and is still in their groups", () => {
    expect(read({}, "none")).toEqual({ ministry: "jovenes", level: "leader", groups, leaderOf: [] });
    expect(read({ leaderOf: null }, "none").leaderOf).toEqual([]);
  });
  it("an explicit subset is read as stored, under L1 and L2 alike", () => {
    for (const absent of ["all", "none"] as const) {
      expect(read({ leaderOf: ["otro-nivel", "adrenalin"] }, absent).leaderOf).toEqual(["otro-nivel", "adrenalin"]);
      expect(read({ leaderOf: [] }, absent).leaderOf).toEqual([]);
    }
  });
  it("drops a group outside `groups`, an unknown id, a repeat and a non-string", () => {
    expect(read({ leaderOf: ["otro-nivel", "emprendedores", "bogus", "otro-nivel", 7, null, "constructor"] }).leaderOf).toEqual(["otro-nivel"]);
  });
  it("a present non-array value leads nothing (fail closed, I4)", () => {
    for (const v of ["otro-nivel", { 0: "otro-nivel" }, 1, true, ""]) {
      expect(read({ leaderOf: v }).leaderOf, JSON.stringify(v)).toEqual([]);
      expect(read({ leaderOf: v }).groups).toEqual(groups);
    }
  });
  it("a member or an admin leads nothing, whatever is stored", () => {
    for (const level of ["member", "admin"]) {
      for (const leaderOf of [undefined, ["otro-nivel"], groups, "x"]) {
        expect(read({ level, leaderOf }).leaderOf).toEqual([]);
      }
    }
  });
  it("duplicate items for one ministry still drop both", () => {
    expect(normalizeMinistryRoles([item({ leaderOf: ["otro-nivel"] }), item({ leaderOf: [] })], J)).toEqual([]);
  });
});

describe("ledGroupsIn — THE answer to «which groups does this person lead» (I3)", () => {
  const doc = (p: Record<string, unknown>) => accessFromDoc({ _id: "m1", role: "member", ...p });
  const leader = (p: Record<string, unknown> = {}) =>
    doc({ ministries: ["jovenes"], ministryRoles: [item({ groups: ["otro-nivel", "invencibles"], ...p })] });

  it("a legacy leader leads all their kept groups (L1)", () => {
    expect(ledGroupsIn(leader(), "jovenes")).toEqual(["otro-nivel", "invencibles"]);
  });
  it("a leader of a subset leads that subset and is still IN the rest", () => {
    const a = leader({ leaderOf: ["otro-nivel"] });
    expect(ledGroupsIn(a, "jovenes")).toEqual(["otro-nivel"]);
    expect(groupsIn(a, "jovenes")).toEqual(["otro-nivel", "invencibles"]);
    expect(levelIn(a, "jovenes")).toBe("leader");
  });
  it("a leader whose leaderOf is empty or unusable leads nothing", () => {
    expect(ledGroupsIn(leader({ leaderOf: [] }), "jovenes")).toEqual([]);
    expect(ledGroupsIn(leader({ leaderOf: "otro-nivel" }), "jovenes")).toEqual([]);
    expect(ledGroupsIn(leader({ leaderOf: ["emprendedores"] }), "jovenes")).toEqual([]);
  });
  it("[] for a member, an admin (no admin arm), a non-member and a super-admin with no leader item", () => {
    expect(ledGroupsIn(leader({ level: "member", leaderOf: ["otro-nivel"] }), "jovenes")).toEqual([]);
    expect(ledGroupsIn(leader({ level: "admin" }), "jovenes")).toEqual([]);
    expect(ledGroupsIn(doc({ ministries: ["worship"], ministryRoles: [item()] }), "jovenes")).toEqual([]);
    expect(ledGroupsIn(doc({ role: "super-admin", ministries: ["worship"] }), "jovenes")).toEqual([]);
    expect(ledGroupsIn(leader(), "worship")).toEqual([]);
  });
  it("never answers a group outside the snapshot's own groups, even from a hand-built snapshot", () => {
    const a = leader({ leaderOf: ["otro-nivel"] });
    const forged = { ...a, ministryRoles: a.ministryRoles.map((r) => ({ ...r, groups: ["invencibles"], leaderOf: ["otro-nivel", "invencibles"] })) };
    expect(ledGroupsIn(forged, "jovenes")).toEqual(["invencibles"]);
  });
  it("hands out a copy, never the snapshot's own array", () => {
    const a = leader();
    ledGroupsIn(a, "jovenes").push("emprendedores");
    expect(ledGroupsIn(a, "jovenes")).toEqual(["otro-nivel", "invencibles"]);
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
