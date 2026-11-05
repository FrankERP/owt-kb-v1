import { describe, expect, it } from "vitest";
import { ROLLOUT, ROLLOUT_STAGES, navRolloutAllows, rolloutAllows, stageAllows } from "../rollout";
import type { MemberAccess } from "../memberAccess";

const person = (over: Partial<MemberAccess>): MemberAccess => ({
  active: true,
  role: "member",
  ministries: ["jovenes"],
  managesMinistries: [],
  ministryRoles: [],
  ...over,
});
const superAdmin = person({ role: "super-admin", ministries: ["worship"] });
const jovenesAdmin = person({ ministryRoles: [{ ministry: "jovenes", level: "admin", groups: [] }] });
const leader = person({ ministryRoles: [{ ministry: "jovenes", level: "leader", groups: ["otro-nivel"] }] });
const pastor = person({});
const worshipAdmin = person({ role: "admin", ministries: ["worship"] });
const inactiveSuper = person({ role: "super-admin", active: false });

describe("stageAllows: each stage widens the last", () => {
  const table: Array<[string, MemberAccess, boolean[]]> = [
    //                      hidden superAdmin admins all
    ["super-admin", superAdmin, [false, true, true, true]],
    ["Jóvenes admin", jovenesAdmin, [false, false, true, true]],
    ["leader", leader, [false, false, false, true]],
    ["pastor", pastor, [false, false, false, true]],
    // A worship admin manages no Jóvenes: `admins` never reaches them.
    ["worship admin", worshipAdmin, [false, false, false, true]],
    ["inactive super-admin", inactiveSuper, [false, false, false, false]],
  ];
  it.each(table)("%s", (_label, access, expected) => {
    expect(ROLLOUT_STAGES.map((s) => stageAllows(s, "jovenes", access))).toEqual(expected);
  });
});

describe("the registry", () => {
  it("Jóvenes' meetings are at superAdmin until Frank widens them", () => {
    expect(ROLLOUT.jovenesEvents).toEqual({ ministry: "jovenes", stage: "superAdmin" });
    expect(rolloutAllows("jovenesEvents", superAdmin)).toBe(true);
    expect(rolloutAllows("jovenesEvents", jovenesAdmin)).toBe(false);
    expect(rolloutAllows("jovenesEvents", pastor)).toBe(false);
  });

  it("the nav copy never shows more than the server allows", () => {
    expect(navRolloutAllows("jovenesEvents", true)).toBe(rolloutAllows("jovenesEvents", superAdmin));
    expect(navRolloutAllows("jovenesEvents", false)).toBe(false);
  });
});
