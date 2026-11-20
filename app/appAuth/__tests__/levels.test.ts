// app/appAuth/__tests__/levels.test.ts — the app API's level lattice (spec D8)
// reads the SAME predicates as the web: a level means in the app exactly what
// it means on the matching web page. Inactive never passes anything.
import { describe, expect, it } from "vitest";
import type { MemberAccess } from "@/app/utils/memberAccess";
import { isMinistryManager, isMinistryMember, ledGroupsIn, plansInMinistry } from "@/app/utils/ministryAccess";
import { meetsNeeds, type AppNeeds } from "../levels";

const base: MemberAccess = { active: true, role: "member", ministries: ["worship"], managesMinistries: [], ministryRoles: [] };
const jov = (level: "member" | "leader" | "admin", groups: string[], leaderOf: string[] = []): MemberAccess => ({
  ...base,
  ministries: ["jovenes"],
  ministryRoles: [{ ministry: "jovenes", level, groups, leaderOf }],
});

const PEOPLE: Record<string, MemberAccess> = {
  superAdmin: { ...base, role: "super-admin", ministries: [] },
  worshipAdmin: { ...base, role: "admin" },
  contentEditor: { ...base, role: "content-editor" },
  worshipMember: base,
  jovenesAdmin: jov("admin", ["otro-nivel"]),
  leaderOfOne: jov("leader", ["otro-nivel", "invencibles"], ["otro-nivel"]),
  leaderOfNone: jov("leader", ["otro-nivel"], []),
  jovenesMember: jov("member", ["otro-nivel"]),
  kidsManager: { ...base, ministries: ["worship"], managesMinistries: ["kids"] },
};

const ALL_NEEDS: AppNeeds[] = [
  "self",
  "manager",
  "super-admin",
  { ministry: "worship", as: "member" },
  { ministry: "kids", as: "member" },
  { ministry: "jovenes", as: "member" },
  { ministry: "jovenes", as: "planner" },
  { ministry: "worship", as: "manager" },
  { ministry: "kids", as: "manager" },
  { ministry: "jovenes", as: "manager" },
];

describe("meetsNeeds", () => {
  it("never passes an inactive person", () => {
    for (const a of Object.values(PEOPLE)) for (const n of ALL_NEEDS) expect(meetsNeeds({ ...a, active: false }, n)).toBe(false);
  });

  it("is the web's predicates, case by case", () => {
    for (const a of Object.values(PEOPLE)) {
      expect(meetsNeeds(a, "self")).toBe(true);
      expect(meetsNeeds(a, "super-admin")).toBe(a.role === "super-admin");
      expect(meetsNeeds(a, "manager")).toBe(["super-admin", "admin", "content-editor"].includes(a.role ?? ""));
      for (const m of ["worship", "kids", "jovenes"] as const) {
        expect(meetsNeeds(a, { ministry: m, as: "member" })).toBe(isMinistryMember(a, m));
        expect(meetsNeeds(a, { ministry: m, as: "manager" })).toBe(isMinistryManager(a, m));
      }
      expect(meetsNeeds(a, { ministry: "jovenes", as: "planner" })).toBe(plansInMinistry(a, "jovenes"));
    }
  });

  it("lets plan in Jóvenes exactly: super-admin, Jóvenes admin, a leader of ≥1 group", () => {
    const planners = Object.entries(PEOPLE).filter(([, a]) => meetsNeeds(a, { ministry: "jovenes", as: "planner" })).map(([k]) => k);
    expect(planners.sort()).toEqual(["jovenesAdmin", "leaderOfOne", "superAdmin"]);
    expect(ledGroupsIn(PEOPLE.leaderOfOne!, "jovenes")).toEqual(["otro-nivel"]);
  });

  it("gives a worship admin no Jóvenes or Kids level (ministries are a second axis)", () => {
    const a = PEOPLE.worshipAdmin!;
    expect(meetsNeeds(a, { ministry: "jovenes", as: "member" })).toBe(false);
    expect(meetsNeeds(a, { ministry: "kids", as: "manager" })).toBe(false);
    expect(meetsNeeds(PEOPLE.kidsManager!, { ministry: "kids", as: "manager" })).toBe(true);
    expect(meetsNeeds(PEOPLE.kidsManager!, { ministry: "kids", as: "member" })).toBe(false);
  });
});
