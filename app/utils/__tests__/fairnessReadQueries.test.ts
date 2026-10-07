// Solver v3 C2 IF2-24 … IF2-28 (RD-1, RD-6) — the fairness read builders, EXECUTED with
// groq-js over an in-memory dataset (the `leadNoteProjection.test.ts` precedent): the
// failures that matter here — a draft counted, a kids-only member in the roster, a
// special counted by the wrong default — are invisible to a string match.
import { evaluate, parse } from "groq-js";
import { describe, expect, it } from "vitest";

import { SOLVER_CONFIG_DOC_ID } from "@/app/utils/solverConfigWriteRequest";
import {
  fairnessMembersByIdsQuery,
  fairnessMonthsByIdsQuery,
  fairnessMonthsThroughQuery,
  serviceCountsInMonths,
  solverConfigQuery,
  voiceRolesInRangeQuery,
  worshipRosterQuery,
  type BoundQuery,
} from "../serviceReadQueries";

async function run(bound: BoundQuery, dataset: unknown[]): Promise<unknown> {
  const tree = parse(bound.query, { params: bound.params });
  return (await evaluate(tree, { dataset, params: bound.params })).get();
}

const ROLES = [
  { _id: "sun-1", _type: "sunday_role", week: "2026-11-01", Lead: [{ _key: "a", _ref: "m-alma" }] },
  { _id: "sat-1", _type: "saturday_role", week: "2026-11-07", published: false },
  { _id: "spc-counted", _type: "special_role", date: "2026-11-03", countsForFairness: true, time: "19:00" },
  { _id: "spc-legacy", _type: "special_role", date: "2026-11-04" },
  { _id: "spc-off", _type: "special_role", date: "2026-11-05", countsForFairness: false },
  { _id: "sat-legacy", _type: "saturday_role", week: "2026-11-14T00:00:00" },
  { _id: "drafts.sun-2", _type: "sunday_role", week: "2026-11-08" },
  { _id: "sun-dec", _type: "sunday_role", week: "2026-12-06", countsForFairness: false },
  { _id: "post-1", _type: "post", week: "2026-11-01" },
];

describe("serviceCountsInMonths (IF2-24)", () => {
  it("counts weekend services and splits specials by C1's rule, per month, drafts excluded", async () => {
    expect(await run(serviceCountsInMonths(["2026-11", "2026-12", "2027-01"]), ROLES)).toEqual([
      { month: "2026-11", weekend: 3, countedSpecials: 1, uncountedSpecials: 2 },
      // An explicit `countsForFairness: false` on a weekend service does not unfreeze it:
      // the freezing services are every stored weekend service (§4 vocabulary).
      { month: "2026-12", weekend: 1, countedSpecials: 0, uncountedSpecials: 0 },
      { month: "2027-01", weekend: 0, countedSpecials: 0, uncountedSpecials: 0 },
    ]);
  });
});

describe("voiceRolesInRangeQuery (IF2-26)", () => {
  it("answers the three role types in range with the stored date, the effective flag and the seat refs", async () => {
    const rows = (await run(voiceRolesInRangeQuery("2026-11-01", "2026-12-01"), ROLES)) as Array<Record<string, unknown>>;
    const byId = Object.fromEntries(rows.map((r) => [r._id, r]));
    expect(Object.keys(byId).sort()).toEqual(["sat-1", "sat-legacy", "spc-counted", "spc-legacy", "spc-off", "sun-1"]);
    expect(byId["sun-1"]).toMatchObject({ _type: "sunday_role", date: "2026-11-01", countsForFairness: true, Lead: ["m-alma"] });
    expect(byId["sat-1"]).toMatchObject({ published: false, countsForFairness: true });
    expect(byId["spc-counted"]).toMatchObject({ date: "2026-11-03", time: "19:00", countsForFairness: true });
    expect(byId["spc-legacy"]).toMatchObject({ countsForFairness: false });
    expect(byId["sat-legacy"]).toMatchObject({ date: "2026-11-14T00:00:00" });
  });
});

const RECORDS = [
  { _id: "fairnessMonth.2026-09", _type: "fairnessMonth", month: "2026-09" },
  { _id: "fairnessMonth.2026-11", _type: "fairnessMonth", month: "2026-11" },
  { _id: "fairnessMonth.2026-12", _type: "fairnessMonth", month: "2026-12" },
  { _id: "drafts.fairnessMonth.2026-10", _type: "fairnessMonth", month: "2026-10" },
];

describe("fairnessMonthsThroughQuery (IF2-25) and fairnessMonthsByIdsQuery", () => {
  it("answers every record up to the last month, ascending, drafts excluded", async () => {
    const rows = (await run(fairnessMonthsThroughQuery("2026-11"), RECORDS)) as Array<{ month: string }>;
    expect(rows.map((r) => r.month)).toEqual(["2026-09", "2026-11"]);
  });

  it("answers exactly the documents with the given ids", async () => {
    const rows = (await run(fairnessMonthsByIdsQuery(["fairnessMonth.2026-12", "fairnessMonth.2027-01"]), RECORDS)) as Array<{
      _id: string;
    }>;
    expect(rows.map((r) => r._id)).toEqual(["fairnessMonth.2026-12"]);
  });
});

const MEMBERS = [
  { _id: "m-absent", _type: "teamMembers", member_name: "Alma", memberType: ["voz"], unavailableDates: ["2026-11-08"], email: "x" },
  { _id: "m-empty", _type: "teamMembers", member_name: "Bruno", ministries: [] },
  { _id: "m-worship", _type: "teamMembers", member_name: "Carmen", alias: "Car", ministries: ["worship", "kids"] },
  { _id: "m-kids", _type: "teamMembers", member_name: "Diego", ministries: ["kids"], memberType: ["voz"] },
  { _id: "drafts.m-absent", _type: "teamMembers", member_name: "Alma (draft)" },
];

describe("worshipRosterQuery (IF2-27, RD-6 a)", () => {
  it("answers absent, empty and worship ministries — never kids-only, never a draft — with exactly six fields", async () => {
    const rows = (await run(worshipRosterQuery(), MEMBERS)) as Array<Record<string, unknown>>;
    expect(rows.map((r) => r._id).sort()).toEqual(["m-absent", "m-empty", "m-worship"]);
    // groq-js projects a field the document lacks as `null`; the six names are what matter.
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(["_id", "alias", "memberType", "member_name", "ministries", "unavailableDates"]);
    }
    expect(rows.find((r) => r._id === "m-absent")).toMatchObject({ memberType: ["voz"], unavailableDates: ["2026-11-08"] });
  });
});

describe("fairnessMembersByIdsQuery", () => {
  it("answers the asked members whatever their ministry, with the writer's and ledger's fields", async () => {
    const rows = (await run(fairnessMembersByIdsQuery(["m-kids", "m-worship", "m-none"]), MEMBERS)) as Array<Record<string, unknown>>;
    expect(rows.map((r) => r._id).sort()).toEqual(["m-kids", "m-worship"]);
    expect(Object.keys(rows[0]).sort()).toEqual(["_id", "alias", "memberType", "member_name", "ministries", "unavailableDates"]);
  });
});

describe("solverConfigQuery (IF2-28, RD-6 b)", () => {
  it("binds SOLVER_CONFIG_DOC_ID and answers the document", async () => {
    const bound = solverConfigQuery();
    expect(bound.params).toEqual({ id: SOLVER_CONFIG_DOC_ID });
    const doc = { _id: SOLVER_CONFIG_DOC_ID, _type: "solverConfig", sundayLeads: ["m-alma"] };
    expect(await run(bound, [doc, ...MEMBERS])).toEqual(doc);
  });

  it("answers null for an absent document", async () => {
    expect(await run(solverConfigQuery(), MEMBERS)).toBeNull();
  });
});
