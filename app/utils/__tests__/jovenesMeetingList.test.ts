// The `/jovenes` list as data (ADR-0087): which filters it offers, what one keeps, the rows.
import { describe, expect, it } from "vitest";
import { MINISTRIES } from "@/app/ministries";
import { FILTER_MIN_MEETINGS, applyFilter, filterOptions, listRows, type ListedMeeting } from "../jovenesMeetingList";

const [G1, G2] = MINISTRIES.jovenes.groups;
const all = (id: string, date: string, mine = false): ListedMeeting => ({ id, date, audience: { kind: "ministry" }, mine });
const group = (id: string, date: string, groups: string[], mine = false): ListedMeeting => ({ id, date, audience: { kind: "groups", groups }, mine });

const MIXED = [
  all("a", "2026-11-14", true),
  group("b", "2026-11-18", [G1.id]),
  group("c", "2026-11-21", [G1.id, G2.id]),
  all("d", "2026-12-05"),
  group("e", "2027-01-09", [G2.id], true),
];

describe("filterOptions", () => {
  it("offers nothing under the minimum: the whole list fits one glance", () => {
    expect(MIXED.length).toBeGreaterThanOrEqual(FILTER_MIN_MEETINGS);
    expect(filterOptions(MIXED.slice(0, FILTER_MIN_MEETINGS - 1))).toEqual([]);
  });

  it("offers «Todas», «Me toca», then each audience with its count — a shared meeting in both", () => {
    const options = filterOptions(MIXED);
    expect(options.map((o) => [o.value, o.label, o.count])).toEqual([
      ["all", "Todas", 5],
      ["mine", "Me toca", 2],
      ["ministry", "Todo Jóvenes", 2],
      [G1.id, G1.name, 2],
      [G2.id, G2.name, 2],
    ]);
    expect(options[0].tone).toBeNull();
    expect(options[3].tone).not.toBeNull();
  });

  it("leaves out a choice that would filter nothing", () => {
    const oneAudience = ["a", "b", "c", "d"].map((id, i) => all(id, `2026-11-0${i + 1}`));
    expect(filterOptions(oneAudience)).toEqual([]);
    const allMine = oneAudience.map((m) => ({ ...m, mine: true }));
    expect(filterOptions(allMine)).toEqual([]);
    const someMine = oneAudience.map((m, i) => ({ ...m, mine: i === 0 }));
    expect(filterOptions(someMine).map((o) => o.value)).toEqual(["all", "mine"]);
  });
});

describe("applyFilter", () => {
  it("keeps the meetings of the chosen filter, in order", () => {
    expect(applyFilter(MIXED, "all").map((m) => m.id)).toEqual(["a", "b", "c", "d", "e"]);
    expect(applyFilter(MIXED, "mine").map((m) => m.id)).toEqual(["a", "e"]);
    expect(applyFilter(MIXED, "ministry").map((m) => m.id)).toEqual(["a", "d"]);
    expect(applyFilter(MIXED, G1.id).map((m) => m.id)).toEqual(["b", "c"]);
    expect(applyFilter(MIXED, G2.id).map((m) => m.id)).toEqual(["c", "e"]);
  });

  it("keeps everything for a filter nothing matches, never an empty page", () => {
    expect(applyFilter(MIXED, "retirado").map((m) => m.id)).toEqual(["a", "b", "c", "d", "e"]);
  });
});

describe("listRows", () => {
  it("is empty for no meetings", () => {
    expect(listRows([])).toEqual([]);
  });

  it("features the first meeting, then groups the rest by month with a count and the year once it changes", () => {
    const rows = listRows(MIXED);
    expect(rows.map((r) => (r.kind === "label" ? `# ${r.title} ${r.count ?? ""}`.trim() : `${r.meeting.id}${r.featured ? "*" : ""}`))).toEqual([
      "# Próxima reunión",
      "a*",
      "# Noviembre 2",
      "b",
      "c",
      "# Diciembre 1",
      "d",
      "# Enero 2027 1",
      "e",
    ]);
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
  });

  it("a single meeting is only the featured one", () => {
    expect(listRows([MIXED[0]]).map((r) => r.kind)).toEqual(["label", "meeting"]);
  });
});
