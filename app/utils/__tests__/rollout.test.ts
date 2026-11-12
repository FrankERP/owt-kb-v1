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
const jovenesAdmin = person({ ministryRoles: [{ ministry: "jovenes", level: "admin", groups: [], leaderOf: [] }] });
const leader = person({ ministryRoles: [{ ministry: "jovenes", level: "leader", groups: ["otro-nivel"], leaderOf: ["otro-nivel"] }] });
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
  // Frank opened Jóvenes to every pastor on 2026-11-12. The stage is pinned here on purpose: moving
  // it changes who gets in, so it should never move as a side effect of another change.
  it("Jóvenes' meetings reach everyone their own guards let in", () => {
    expect(ROLLOUT.jovenesEvents).toEqual({ ministry: "jovenes", stage: "all" });
    for (const access of [superAdmin, jovenesAdmin, leader, pastor]) expect(rolloutAllows("jovenesEvents", access)).toBe(true);
    // The registry never lets an inactive person in, at any stage.
    expect(rolloutAllows("jovenesEvents", inactiveSuper)).toBe(false);
    expect(rolloutAllows("jovenesEvents", person({ active: false }))).toBe(false);
  });

  // The registry entry is moved here and put back, so the nav copy's arms stay exercised whatever
  // stage the feature is at.
  it("at every stage the nav copy shows no more than the server allows; at `admins`, the super-admin only", () => {
    const entry = ROLLOUT.jovenesEvents;
    const was = entry.stage;
    try {
      for (const stage of ROLLOUT_STAGES) {
        entry.stage = stage;
        expect(navRolloutAllows("jovenesEvents", true), stage).toBe(rolloutAllows("jovenesEvents", superAdmin));
        if (navRolloutAllows("jovenesEvents", false)) expect(rolloutAllows("jovenesEvents", pastor), stage).toBe(true);
      }
      entry.stage = "admins";
      expect(navRolloutAllows("jovenesEvents", false)).toBe(false);
      entry.stage = "hidden";
      expect(navRolloutAllows("jovenesEvents", true)).toBe(false);
    } finally {
      entry.stage = was;
    }
  });

  it("the nav copy never shows more than the server allows", () => {
    expect(navRolloutAllows("jovenesEvents", true)).toBe(rolloutAllows("jovenesEvents", superAdmin));
    expect(navRolloutAllows("jovenesEvents", false)).toBe(rolloutAllows("jovenesEvents", pastor));
  });
});
