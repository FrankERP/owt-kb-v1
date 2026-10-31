// The availability proposals' pure core (ADR-0079; plan §4). Fictitious people only.
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/sanity/env", () => ({ apiVersion: "2024-07-23", dataset: "test", projectId: "test" }));

import { ALL_IN, ledgerResponse, record } from "@/app/components/admin/__tests__/v3Fixtures";
import type { ServiceRole } from "@/app/components/admin/serviceCardModel";
import type { FairnessLedgerResponse, LogicalRecord } from "@/app/utils/fairnessVocabulary";
import { storedMonthBoard } from "@/app/mcp/monthProposals/storedMonthBoard";
import type { MonthCheckVerdict } from "@/app/mcp/monthProposals/monthCheck";
import { MEMBERS, RULES } from "@/app/mcp/monthProposals/__tests__/editorFixtures";
import type { EditorMember } from "@/app/mcp/monthProposals/revise";
import { NOVEMBER, storedRow, summaryFor, type StoredRow } from "@/app/mcp/tools/__tests__/serviceEditorFixtures";
import {
  compareVerdicts,
  findRoleConflicts,
  horizonMonths,
  proposeReplacement,
  type ProposeInput,
} from "../availabilityConflicts";

const TODAY = "2026-10-21";
const WORSHIP = (m: EditorMember) => ({ ...m, ministries: (m as { ministries?: unknown }).ministries ?? ["worship"] });
/** A second bassist, and Elsa, one more worship voice. */
const RAUL = { _id: "m-raul", member_name: "Raúl Paz", alias: "Raúl", memberType: ["instrumento"], instruments: ["Bass"], ministries: ["worship"] };
const ELSA = { _id: "m-elsa", member_name: "Elsa Mora", alias: "Elsa", memberType: ["voz", "support"], ministries: ["worship"] };

const listed = (memberId: string): LogicalRecord["people"][number] => ({
  memberId, name: memberId, roles: { ...ALL_IN }, exactRules: [], exempt: false, blocks: [],
});

function ledgerFor(people: string[] | null): FairnessLedgerResponse {
  return ledgerResponse(["2026-11"], people ? { horizon: [{ record: record("2026-11", people.map(listed)), storedServices: 5, recordBinds: true }] } : {});
}

function inputFor(opts: {
  rows?: StoredRow[];
  members?: EditorMember[];
  absent: { roleId: string; memberId: string };
  listed?: string[] | null;
  coherent?: boolean;
  exclude?: string[];
}): ProposeInput {
  const rows = opts.rows ?? NOVEMBER();
  const date = rows.find((r) => r._id === opts.absent.roleId)!.date;
  const members = (opts.members ?? [...MEMBERS, ELSA]).map(WORSHIP).map((m) =>
    m._id === opts.absent.memberId ? { ...m, unavailableDates: [date] } : m) as EditorMember[];
  const summary = summaryFor(rows);
  if (opts.coherent === false) summary.recordIssues.push({ code: "raw_draft" } as never);
  const adminRoles = JSON.parse(JSON.stringify(rows)) as ServiceRole[];
  return {
    board: storedMonthBoard({ month: "2026-11", adminRoles, summary, todayIso: TODAY }),
    roleId: opts.absent.roleId,
    memberId: opts.absent.memberId,
    members,
    config: RULES,
    adminRoles,
    todayIso: TODAY,
    ledger: ledgerFor(opts.listed === undefined ? ["m-ana", "m-bruno", "m-carla", "m-dani", "m-elsa"] : opts.listed),
    ...(opts.exclude ? { exclude: new Map([["coro", new Set(opts.exclude)]]) } : {}),
  };
}

describe("findRoleConflicts", () => {
  const roles = (rows: StoredRow[]) => JSON.parse(JSON.stringify(rows)) as ServiceRole[];

  it("finds a conflict in every seat kind, only on the marked day, from today through the horizon", () => {
    const rows = [
      storedRow("a", "sunday_role", "2026-11-01", { leads: ["m1"], bgvs: ["m2"], chorus: ["m3"], instruments: [["Bass", "m4"]], foh: [["Audio", "m5"]] }),
      storedRow("past", "sunday_role", "2026-10-18", { leads: ["m1"] }),
      storedRow("far", "sunday_role", "2027-01-03", { leads: ["m1"] }),
    ];
    const members = ["m1", "m2", "m3", "m4", "m5"].map((id) => ({ _id: id, member_name: id, unavailableDates: ["2026-11-01", "2026-10-18", "2027-01-03"] })) as EditorMember[];
    const found = findRoleConflicts({ adminRoles: roles(rows), members, todayIso: TODAY });
    expect(found.map((c) => `${c.roleId}:${c.memberId}`)).toEqual(["a:m1", "a:m2", "a:m3", "a:m4", "a:m5"]);
    expect(horizonMonths(TODAY)).toEqual(["2026-10", "2026-11", "2026-12"]);
  });

  it("scopes to one member and reads `published`", () => {
    const rows = [storedRow("a", "sunday_role", "2026-11-01", { leads: ["m1"], bgvs: ["m2"] }, { published: false })];
    const members = ["m1", "m2"].map((id) => ({ _id: id, member_name: id, unavailableDates: ["2026-11-01"] })) as EditorMember[];
    const found = findRoleConflicts({ adminRoles: roles(rows), members, todayIso: TODAY, memberId: "m2" });
    expect(found).toEqual([expect.objectContaining({ roleId: "a", memberId: "m2", published: false, date: "2026-11-01" })]);
  });
});

describe("proposeReplacement", () => {
  it("replaces a Coro voice with the first eligible worship voice, in place", () => {
    const out = proposeReplacement(inputFor({ absent: { roleId: "sun1", memberId: "m-dani" } }));
    expect(out.kind).toBe("replace");
    if (out.kind !== "replace") return;
    expect(out.seats).toHaveLength(1);
    expect(out.seats[0]).toMatchObject({ rowId: "coro", from: "m-dani" });
    // Bruno and Carla already serve sun1; Kira is not in Alabanza; Tomás has no voice Tipo.
    expect(["m-ana", "m-elsa"]).toContain(out.seats[0].to);
    expect(out.target.chorus).toEqual([out.seats[0].to]);
    expect(out.target.leads).toEqual(["m-bruno"]);
  });

  it("skips people «Elegir otro» excludes", () => {
    const first = proposeReplacement(inputFor({ absent: { roleId: "sun1", memberId: "m-dani" } }));
    if (first.kind !== "replace") throw new Error("expected a pick");
    const second = proposeReplacement(inputFor({ absent: { roleId: "sun1", memberId: "m-dani" }, exclude: [first.seats[0].to!] }));
    expect(second.kind).toBe("replace");
    if (second.kind === "replace") expect(second.seats[0].to).not.toBe(first.seats[0].to);
  });

  it("is «sin revisar» for a voice when the month has no fairness record", () => {
    expect(proposeReplacement(inputFor({ absent: { roleId: "sun1", memberId: "m-dani" }, listed: null }))).toEqual({ kind: "none", reason: "unchecked" });
  });

  it("never proposes a weekend voice outside the month's v3 eligibility", () => {
    // Only Dani (the absent one) is on the record: nobody else could be seated by the solver.
    expect(proposeReplacement(inputFor({ absent: { roleId: "sun1", memberId: "m-dani" }, listed: ["m-dani", "m-bruno", "m-carla"] })))
      .toEqual({ kind: "none", reason: "no_candidate" });
  });

  it("leaves an instrument nobody else declares empty, and picks a declared bassist when there is one", () => {
    const empty = proposeReplacement(inputFor({ absent: { roleId: "sun1", memberId: "m-tomas" } }));
    expect(empty).toMatchObject({ kind: "replace", seats: [{ rowId: "instrumento:Bass", from: "m-tomas", to: null }] });
    if (empty.kind === "replace") expect(JSON.stringify(empty.target)).not.toContain("m-tomas");
    const out = proposeReplacement(inputFor({ absent: { roleId: "sun1", memberId: "m-tomas" }, members: [...MEMBERS, ELSA, RAUL] as EditorMember[] }));
    expect(out).toMatchObject({ kind: "replace", seats: [{ rowId: "instrumento:Bass", from: "m-tomas", to: "m-raul" }] });
  });

  it("a person in Lead and Bass with no bassist: Lead gets a replacement and Bass is left empty", () => {
    const rows = [storedRow("sun1", "sunday_role", "2026-11-01", { leads: ["m-tomas2"], instruments: [["Bass", "m-tomas2"]] })];
    const both = { _id: "m-tomas2", member_name: "Teo Gil", alias: "Teo", memberType: ["voz", "sunday_lead", "instrumento"], instruments: ["Bass"], ministries: ["worship"] };
    const noBassist = MEMBERS.filter((m) => m._id !== "m-tomas");
    const input = inputFor({ rows, members: [...noBassist, ELSA, both] as EditorMember[], absent: { roleId: "sun1", memberId: "m-tomas2" } });
    const out = proposeReplacement(input);
    expect(out.kind).toBe("replace");
    if (out.kind !== "replace") return;
    expect(out.seats.map((x) => x.rowId)).toEqual(["lead", "instrumento:Bass"]);
    expect(out.seats[0].to).toEqual(expect.any(String));
    expect(out.seats[1].to).toBeNull();
    expect(out.target.leads).toEqual([out.seats[0].to]);
    expect(JSON.stringify(out.target)).not.toContain("m-tomas2");

    // «Aplicar» replays exactly that choice; an empty voice seat is refused.
    const replay = proposeReplacement({ ...input, only: new Map<string, string | null>([["lead", out.seats[0].to], ["instrumento:Bass", null]]) });
    expect(replay).toEqual(out);
    expect(proposeReplacement({ ...input, only: new Map<string, string | null>([["lead", null], ["instrumento:Bass", null]]) }))
      .toEqual({ kind: "none", reason: "no_candidate" });

    // With a bassist, both seats are covered by people.
    const full = proposeReplacement(inputFor({ rows, members: [...MEMBERS, ELSA, both] as EditorMember[], absent: { roleId: "sun1", memberId: "m-tomas2" } }));
    expect(full.kind).toBe("replace");
    if (full.kind === "replace") expect(full.seats.every((x) => x.to !== null)).toBe(true);
  });

  it("still needs a person for every voice seat: no voice → no proposal at all", () => {
    const rows = [storedRow("sun1", "sunday_role", "2026-11-01", { leads: ["m-tomas2"], instruments: [["Bass", "m-tomas2"]] })];
    const both = { _id: "m-tomas2", member_name: "Teo Gil", alias: "Teo", memberType: ["voz", "sunday_lead", "instrumento"], instruments: ["Bass"], ministries: ["worship"] };
    // Only Teo is on the month's eligibility: nobody else can lead.
    expect(proposeReplacement(inputFor({ rows, members: [...MEMBERS, ELSA, both] as EditorMember[], absent: { roleId: "sun1", memberId: "m-tomas2" }, listed: ["m-tomas2"] })))
      .toEqual({ kind: "none", reason: "no_candidate" });
  });

  it("never proposes for a worship night's song leader", () => {
    const input = inputFor({ absent: { roleId: "sun1", memberId: "m-dani" } });
    const out = proposeReplacement({ ...input, snapshotRole: { format: "worship_night", songs: [{ leads: [{ _ref: "m-dani" }] }] } });
    expect(out).toEqual({ kind: "none", reason: "song_lead" });
  });

  it("is «sin revisar» on a service the board does not let anyone edit", () => {
    expect(proposeReplacement(inputFor({ absent: { roleId: "sun1", memberId: "m-dani" }, coherent: false }))).toEqual({ kind: "none", reason: "unchecked" });
  });
});

describe("compareVerdicts (the month gate)", () => {
  const v = (over: Partial<MonthCheckVerdict> = {}): MonthCheckVerdict => ({
    judged: true, instances: [], missed: [], eligibility: new Map(), ruleIds: JSON.stringify([{ id: "r1", kind: "count", op: "<=" }]), ...over,
  });

  it("accepts a candidate that adds nothing", () => {
    expect(compareVerdicts(v(), v())).toBe("ok");
  });

  it("is «sin revisar» when either build was not judged", () => {
    expect(compareVerdicts(v({ judged: false }), v())).toBe("unchecked");
    expect(compareVerdicts(v(), v({ judged: false }))).toBe("unchecked");
  });

  it("rejects a new instance, a new missed protection, a grown `<=` count and a grown cap", () => {
    const inst = { family: "count" as const, rule: "r1", scope: "2026-11", observed: 2 };
    expect(compareVerdicts(v(), v({ instances: [inst] }))).toBe("reject");
    expect(compareVerdicts(v({ instances: [inst] }), v({ instances: [{ ...inst, observed: 3 }] }))).toBe("reject");
    expect(compareVerdicts(v({ instances: [inst] }), v({ instances: [inst] }))).toBe("ok");
    const cap = { code: "sunday_cap_exceeded" as const, person: "m-ana", scope: "2026-11", count: 2 };
    expect(compareVerdicts(v(), v({ missed: [cap] }))).toBe("reject");
    expect(compareVerdicts(v({ missed: [cap] }), v({ missed: [{ ...cap, count: 3 }] }))).toBe("reject");
    expect(compareVerdicts(v({ missed: [cap] }), v({ missed: [cap] }))).toBe("ok");
  });

  it("accepts a removal-only improvement and rejects when the rule tables differ", () => {
    const inst = { family: "pair" as const, rule: "r1", scope: "sun1" };
    expect(compareVerdicts(v({ instances: [inst] }), v())).toBe("ok");
    expect(compareVerdicts(v(), v({ ruleIds: "[]" }))).toBe("reject");
  });
});
