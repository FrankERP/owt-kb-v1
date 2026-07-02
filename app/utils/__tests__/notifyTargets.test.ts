import { describe, it, expect } from "vitest";
import { addedAssignees, setlistRecipientIds, tomorrowDateStr, assignedMemberRefsQuery } from "../notifyTargets";

describe("assignedMemberRefsQuery", () => {
  const q = assignedMemberRefsQuery("_type == 'x' && week == $w");
  it("covers every teamMember-referencing seat type", () => {
    expect(q).toContain("Lead[]._ref");
    expect(q).toContain("BGVs[]._ref");
    expect(q).toContain("Chorus[]._ref");
    expect(q).toContain("instruments[].person._ref");
    expect(q).toContain("foh_team[].person._ref");
  });
  it("embeds the supplied role filter and dedupes / drops undefined", () => {
    expect(q).toContain("_type == 'x' && week == $w");
    expect(q).toContain("array::unique(");
    expect(q).toContain("[defined(@)]");
  });
});

describe("addedAssignees", () => {
  it("returns ids present in next but not prev", () => {
    expect(addedAssignees(["a", "b"], ["b", "c", "d"]).sort()).toEqual(["c", "d"]);
  });
  it("returns all on a brand-new doc (empty prev)", () => {
    expect(addedAssignees([], ["a", "b"]).sort()).toEqual(["a", "b"]);
  });
  it("dedupes", () => {
    expect(addedAssignees(["a"], ["b", "b"])).toEqual(["b"]);
  });
});

describe("setlistRecipientIds", () => {
  const members = [
    { _id: "m1", setlist: "all" as const },
    { _id: "m2", setlist: "assigned" as const },
    { _id: "m3", setlist: "off" as const },
    { _id: "m4", setlist: "assigned" as const },
  ];
  it("includes all 'all' members plus 'assigned' members who are assigned", () => {
    expect(setlistRecipientIds(members, ["m2", "m3"]).sort()).toEqual(["m1", "m2"]);
  });
  it("excludes 'off' even if assigned", () => {
    expect(setlistRecipientIds(members, ["m3"])).toEqual(["m1"]);
  });
  it("treats an unset preference as 'all' (opted-in)", () => {
    const ms = [{ _id: "m1" }, { _id: "m2", setlist: "off" as const }];
    expect(setlistRecipientIds(ms, [])).toEqual(["m1"]);
  });
});

describe("tomorrowDateStr", () => {
  it("returns YYYY-MM-DD for tomorrow in the given tz", () => {
    const s = tomorrowDateStr("America/Mexico_City", new Date("2026-06-16T18:00:00Z"));
    expect(s).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
