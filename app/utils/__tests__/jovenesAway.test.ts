// Who is told that a Jóvenes pastor marked a day (ADR-0090; plan 2026-11-17 §3 R2), and the
// planner's two questions over the people it was handed.

import { describe, expect, it } from "vitest";
import { awayLine, awayNames, awayVisibleTo, isAway, type AwayReader } from "../jovenesAway";

const reader = (level: string | null, groups: string[] = [], leaderOf: string[] = [], over: Partial<AwayReader> = {}): AwayReader => ({
  active: true,
  role: "member",
  ministries: level === null ? ["worship"] : ["jovenes"],
  managesMinistries: [],
  ministryRoles: level === null ? [] : [{ ministry: "jovenes", level, groups, leaderOf } as AwayReader["ministryRoles"][number]],
  ...over,
});
const inGroups = (...groups: string[]) => ({ groups });

describe("awayVisibleTo", () => {
  it("a Jóvenes admin and a super-admin see every Jóvenes member, grouped or not", () => {
    for (const r of [reader("admin"), reader(null, [], [], { role: "super-admin" })]) {
      expect(awayVisibleTo(r, inGroups("otro-nivel"))).toBe(true);
      expect(awayVisibleTo(r, inGroups())).toBe(true);
    }
  });

  it("a leader sees a member of a group they LEAD, and nobody else", () => {
    const jacob = reader("leader", ["otro-nivel", "adrenalin", "invencibles"], ["otro-nivel", "adrenalin"]);
    expect(awayVisibleTo(jacob, inGroups("otro-nivel"))).toBe(true);
    expect(awayVisibleTo(jacob, inGroups("guerreras", "adrenalin"))).toBe(true);
    // A group they are IN but do not lead (ADR-0085), another group, no group at all.
    expect(awayVisibleTo(jacob, inGroups("invencibles"))).toBe(false);
    expect(awayVisibleTo(jacob, inGroups("emprendedores"))).toBe(false);
    expect(awayVisibleTo(jacob, inGroups())).toBe(false);
  });

  it("a `leader` who leads no group, a plain pastor and someone outside Jóvenes see nobody", () => {
    for (const r of [reader("leader", ["otro-nivel"], []), reader("member", ["otro-nivel"]), reader(null)]) {
      expect(awayVisibleTo(r, inGroups("otro-nivel"))).toBe(false);
    }
  });

  it("a worship admin is not a Jóvenes admin, and an inactive snapshot sees nobody whatever it holds", () => {
    expect(awayVisibleTo(reader(null, [], [], { role: "admin" }), inGroups("otro-nivel"))).toBe(false);
    expect(awayVisibleTo(reader("admin", [], [], { active: false }), inGroups("otro-nivel"))).toBe(false);
    expect(awayVisibleTo(reader(null, [], [], { role: "super-admin", active: false }), inGroups("otro-nivel"))).toBe(false);
  });
});

describe("isAway / awayNames / awayLine", () => {
  const people = [
    { id: "a", name: "Ana", away: ["2026-11-21", "2026-11-28"] },
    { id: "b", name: "Beto" },
    { id: "c", name: "Caro", away: ["2026-11-21"] },
  ];

  it("no date, no person or no `away` is «not marked»", () => {
    expect(isAway(people[0], "2026-11-21")).toBe(true);
    expect(isAway(people[0], "2026-11-22")).toBe(false);
    expect(isAway(people[1], "2026-11-21")).toBe(false);
    expect(isAway(people[0], null)).toBe(false);
    expect(isAway(null, "2026-11-21")).toBe(false);
  });

  it("names each assigned person who marked the day once, in roster order", () => {
    expect(awayNames(people, ["c", "a", "a", null, "gone"], "2026-11-21")).toEqual(["Ana", "Caro"]);
    expect(awayNames(people, ["b", "c"], "2026-11-28")).toEqual([]);
    expect(awayNames(people, [undefined], "2026-11-21")).toEqual([]);
  });

  it("says it in one line, singular or plural, and nothing for nobody", () => {
    expect(awayLine([])).toBeNull();
    expect(awayLine(["Ana"])).toBe("Ana: no disponible ese día");
    expect(awayLine(["Ana", "Caro"])).toBe("Ana y Caro: no disponibles ese día");
    expect(awayLine(["Ana", "Beto", "Caro"])).toBe("Ana, Beto y Caro: no disponibles ese día");
  });
});
