import { describe, expect, it } from "vitest";
import {
  SONG_LEADS_MAX,
  carryOverSongLeads,
  formatLeadNames,
  leadRosterOf,
  leadSeatIds,
  songItemLeadIds,
  sortedLeadIds,
  unassignedLeads,
  validateSongLeads,
} from "@/app/utils/songLeads";

const ref = (key: string, id: string) => ({ _key: key, _type: "reference", _ref: id });
const item = (songId: string, leads?: unknown) => ({ _key: `k-${songId}`, play_key: "G", song: { _type: "reference", _ref: songId }, ...(leads === undefined ? {} : { leads }) });

describe("leadSeatIds / songItemLeadIds", () => {
  it("reads reference ids and ignores junk", () => {
    expect([...leadSeatIds([ref("a", "m1"), ref("b", "m2"), { _ref: "" }, null, "x"])]).toEqual(["m1", "m2"]);
    expect([...leadSeatIds(undefined)]).toEqual([]);
  });
  it("reads a song item's leaders, null and absent as none", () => {
    expect(songItemLeadIds(item("s1", [ref("x", "m1"), ref("y", "m2"), ref("z", "m1")]))).toEqual(["m1", "m2"]);
    expect(songItemLeadIds(item("s1", null))).toEqual([]);
    expect(songItemLeadIds(item("s1"))).toEqual([]);
    expect(SONG_LEADS_MAX).toBe(2);
  });
});

describe("validateSongLeads", () => {
  const lead = new Set(["m1", "m2"]);
  it("accepts leaders from Lead on a worship night, and rows without leaders anywhere", () => {
    expect(validateSongLeads([{ leadIds: ["m1"] }, { leadIds: [] }, { leadIds: ["m1", "m2"] }], { worshipNight: true, leadIds: lead })).toEqual({ ok: true });
    expect(validateSongLeads([{ leadIds: [] }], { worshipNight: false, leadIds: new Set() })).toEqual({ ok: true });
  });
  it("refuses leaders on a target that is not a worship night", () => {
    expect(validateSongLeads([{ leadIds: [] }, { leadIds: ["m1"] }], { worshipNight: false, leadIds: lead })).toEqual({ ok: false, issues: ["songs[1].leadIds"] });
  });
  it("refuses a leader who is not in Lead", () => {
    expect(validateSongLeads([{ leadIds: ["m1", "m9"] }], { worshipNight: true, leadIds: lead })).toEqual({ ok: false, issues: ["songs[0].leadIds"] });
  });
});

describe("carryOverSongLeads", () => {
  const lead = new Set(["m1", "m2"]);
  const rows = (...ids: string[]) => ids.map((songId) => ({ songId, playKey: "G", medleyTag: null }));

  it("keeps each song's leaders by song reference and drops leaders no longer in Lead", () => {
    const live = [item("s1", [ref("a", "m1")]), item("s3", [ref("b", "m2"), ref("c", "m7")])];
    expect(carryOverSongLeads(rows("s3", "s1", "s2"), live, lead).map((r) => r.leadIds)).toEqual([["m2"], ["m1"], []]);
  });

  it("matches repeated songs in order, each live item used once", () => {
    const live = [item("s1", [ref("a", "m1")]), item("s1", [ref("b", "m2")])];
    expect(carryOverSongLeads(rows("s1", "s1", "s1"), live, lead).map((r) => r.leadIds)).toEqual([["m1"], ["m2"], []]);
  });

  it("gives nothing when the live songs are absent or malformed", () => {
    expect(carryOverSongLeads(rows("s1"), null, lead)[0].leadIds).toEqual([]);
    expect(carryOverSongLeads(rows("s1"), "x", lead)[0].leadIds).toEqual([]);
  });

  it("never carries more than two leaders", () => {
    const live = [item("s1", [ref("a", "m1"), ref("b", "m2"), ref("c", "m3")])];
    expect(carryOverSongLeads(rows("s1"), live, new Set(["m1", "m2", "m3"]))[0].leadIds).toEqual(["m1", "m2"]);
  });
});

describe("editor and display helpers", () => {
  it("lists the Lead members with no song yet", () => {
    const roster = [{ id: "m1", name: "Ana" }, { id: "m2", name: "Beto" }, { id: "m3", name: "Caro" }];
    expect(unassignedLeads(roster, [{ leadIds: ["m2"] }, { leadIds: [] }])).toEqual([roster[0], roster[2]]);
  });
  it("builds the roster from a projected Lead, alias first, unresolved dropped", () => {
    expect(leadRosterOf([{ _id: "m1", member_name: "Ana López", alias: "Ani" }, null, { _id: "m2", member_name: "Beto" }, { member_name: "sin id" }, { _id: "m3" }]))
      .toEqual([{ id: "m1", name: "Ani" }, { id: "m2", name: "Beto" }, { id: "m3", name: "Sin nombre" }]);
    expect(leadRosterOf(undefined)).toEqual([]);
  });
  it("formats one or two names", () => {
    expect(formatLeadNames([{ member_name: "Ana", alias: "Ani" }])).toBe("Ani");
    expect(formatLeadNames([{ member_name: "Ana" }, { member_name: "Beto" }])).toBe("Ana y Beto");
    expect(formatLeadNames(null)).toBe("");
    // [post-approval, un-reviewed] An unresolved dereference projects as null.
    expect(formatLeadNames([null, { member_name: "Beto" }])).toBe("Beto");
  });
  it("normalizes snapshot leader ids in one place [post-approval, un-reviewed]", () => {
    expect(sortedLeadIds(["m2", "m1", "m2", "", 3])).toEqual(["m1", "m2"]);
    expect(sortedLeadIds(null)).toEqual([]);
    expect(sortedLeadIds("m1")).toEqual([]);
  });
});
