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
  MAX_FALLBACK_OPTIONS,
  proposeFallbacks,
  proposeReplacement,
  type ProposeInput,
} from "../availabilityConflicts";
import { config, restriction } from "@/app/components/admin/__tests__/v3Fixtures";

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

  it("nobody free can lead: a singer on the same service moves up and a free person takes their seat", () => {
    // Carla is off the month's eligibility and Ana may not lead on Sundays: nobody free can lead.
    const lia = { _id: "m-lia", member_name: "Lía Paz", alias: "Lía", memberType: ["voz", "sunday_lead"], ministries: ["worship"] };
    const rows = [storedRow("sun1", "sunday_role", "2026-11-01", { leads: ["m-bruno"], bgvs: ["m-lia"] })];
    const input = inputFor({ rows, members: [...MEMBERS, ELSA, lia] as EditorMember[], absent: { roleId: "sun1", memberId: "m-bruno" }, listed: ["m-ana", "m-bruno", "m-dani", "m-elsa", "m-lia"] });
    // Only Bruno and Lía may lead on Sundays this month (the v3 record); the rest sing BGV or Coro.
    const noLead = (id: string) => ({ ...listed(id), roles: { ...ALL_IN, "Sun.Lead": "out" as const } });
    input.ledger = ledgerResponse(["2026-11"], {
      horizon: [{ record: record("2026-11", [listed("m-bruno"), listed("m-lia"), noLead("m-ana"), noLead("m-dani"), noLead("m-elsa")]), storedServices: 1, recordBinds: true }],
    });
    const out = proposeReplacement(input);
    expect(out.kind).toBe("replace");
    if (out.kind !== "replace") return;
    expect(out.seats[0]).toEqual({ rowId: "lead", from: "m-bruno", to: "m-lia" });
    expect(out.seats[1]).toMatchObject({ rowId: "bgv", from: "m-lia" });
    const filler = out.seats[1].to!;
    expect(["m-ana", "m-dani", "m-elsa"]).toContain(filler);
    expect(out.target.leads).toEqual(["m-lia"]);
    expect(out.target.bgvs).toEqual([filler]);

    // «Aplicar» replays that exact move; a move nobody asked for is not made.
    expect(proposeReplacement({ ...input, only: new Map([["lead", "m-lia"], ["bgv", filler]]) })).toEqual(out);
    expect(proposeReplacement({ ...input, only: new Map([["lead", "m-lia"]]) })).toEqual({ kind: "none", reason: "no_candidate" });
    // «Elegir otro» that skips Lía for Lead has nobody left.
    expect(proposeReplacement({ ...input, exclude: new Map([["lead", new Set(["m-lia"])]]) })).toEqual({ kind: "none", reason: "no_candidate" });
  });

  it("only moves a singer UP: a Lead is never moved down to cover BGV", () => {
    const lia = { _id: "m-lia", member_name: "Lía Paz", alias: "Lía", memberType: ["voz", "sunday_lead"], ministries: ["worship"] };
    const rows = [storedRow("sun1", "sunday_role", "2026-11-01", { leads: ["m-lia"], bgvs: ["m-bruno"] })];
    // Carla may lead but not sing BGV this month; nobody else free is on the record.
    const input = inputFor({ rows, members: [...MEMBERS, ELSA, lia] as EditorMember[], absent: { roleId: "sun1", memberId: "m-bruno" } });
    const carla = { ...listed("m-carla"), roles: { ...ALL_IN, "Sun.BGV": "out" as const, "Sun.Choir": "out" as const } };
    input.ledger = ledgerResponse(["2026-11"], { horizon: [{ record: record("2026-11", [listed("m-bruno"), listed("m-lia"), carla]), storedServices: 1, recordBinds: true }] });
    expect(proposeReplacement(input)).toEqual({ kind: "none", reason: "no_candidate" });
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

describe("proposeFallbacks (nobody passes every rule)", () => {
  // Every Sunday leader already leads another Sunday of the month; Ximena, who leads the 15th,
  // marked it unavailable; Quim could lead but marked the 15th too. Pau sings Coro (no Lead Tipo).
  const lead = (id: string, name: string) => ({ _id: id, member_name: `${name} Test`, alias: name, memberType: ["voz", "sunday_lead"], ministries: ["worship"] });
  const PEOPLE = [lead("m-lia", "Lía"), lead("m-mar", "Mar"), lead("m-noe", "Noé"), lead("m-oto", "Oto"), lead("m-xim", "Ximena"), lead("m-quim", "Quim"),
    { _id: "m-pau", member_name: "Pau Test", alias: "Pau", memberType: ["voz", "support"], ministries: ["worship"] }];
  const NAMES = new Map(PEOPLE.map((m) => [m._id, m.alias]));
  const rows = () => [
    storedRow("s1", "sunday_role", "2026-11-01", { leads: ["m-lia"] }),
    storedRow("s8", "sunday_role", "2026-11-08", { leads: ["m-mar"] }),
    storedRow("s15", "sunday_role", "2026-11-15", { leads: ["m-xim"], bgvs: ["m-noe"], chorus: ["m-pau"] }),
    storedRow("s22", "sunday_role", "2026-11-22", { leads: ["m-noe"] }),
    storedRow("s29", "sunday_role", "2026-11-29", { leads: ["m-oto"] }),
  ];
  function input(): ProposeInput & { nameOf: (id: string) => string } {
    const base = inputFor({ rows: rows(), members: PEOPLE as EditorMember[], absent: { roleId: "s15", memberId: "m-xim" }, listed: PEOPLE.map((m) => m._id) });
    const members = base.members.map((m) => (m._id === "m-quim" ? { ...m, unavailableDates: ["2026-11-15"] } : m));
    const ids = PEOPLE.filter((m) => m.memberType.includes("sunday_lead")).map((m) => m._id);
    // The record: Pau is not on the Sunday Lead line (as the solver's lists say).
    const people = PEOPLE.map((m) => (m._id === "m-pau" ? { ...listed(m._id), roles: { ...ALL_IN, "Sun.Lead": "out" as const } } : listed(m._id)));
    base.ledger = ledgerResponse(["2026-11"], { horizon: [{ record: record("2026-11", people), storedServices: 5, recordBinds: true }] });
    return { ...base, members, config: config({ sundayLeads: ids, support: ["m-pau"] }), nameOf: (id) => NAMES.get(id) ?? "?" };
  }

  it("the strict proposal finds nobody, and the fallback offers two or more options with their broken rules", () => {
    const i = input();
    expect(proposeReplacement(i)).toEqual({ kind: "none", reason: "no_candidate" });
    const out = proposeFallbacks(i);
    expect(out.kind).toBe("options");
    if (out.kind !== "options") return;
    expect(out.options.length).toBeGreaterThanOrEqual(2);
    expect(out.options.length).toBeLessThanOrEqual(MAX_FALLBACK_OPTIONS);
    const takers = out.options.map((o) => o.seats[0].to);
    // Never the absent person, never someone who marked the day.
    expect(takers).not.toContain("m-xim");
    expect(takers).not.toContain("m-quim");
    for (const o of out.options) {
      expect(o.breaks.length).toBeGreaterThan(0);
      const name = NAMES.get(o.seats[0].to!)!;
      expect(o.breaks.map((b) => b.line)).toContain(`${name} dirige 2 domingos en noviembre; lo normal es uno.`);
      expect(o.target.leads).toEqual([o.seats[0].to]);
    }
    // Fewest broken rules first: Lía and Oto break one; Mar also leads two Sundays in a row.
    expect(out.options[0].breaks).toHaveLength(1);
    expect(out.options[1].breaks).toHaveLength(1);
    const mar = out.options.find((o) => o.seats[0].to === "m-mar");
    expect(mar?.breaks.map((b) => b.line)).toContain("Mar dirige domingos seguidos: 8 y 15 nov.");
    const counts = out.options.map((o) => o.breaks.length);
    expect([...counts].sort((a, b) => a - b)).toEqual(counts);
  });

  it("offers a singer of the same service moving up, with someone free taking their seat", () => {
    const out = proposeFallbacks(input());
    if (out.kind !== "options") throw new Error("expected options");
    const all = proposeFallbacks({ ...input() });
    expect(all).toEqual(out);
    const moved = proposeFallbacks({ ...input(), only: new Map([["lead", "m-noe"], ["bgv", "m-lia"]]) });
    expect(moved.kind).toBe("options");
    if (moved.kind !== "options") return;
    expect(moved.options).toHaveLength(1);
    expect(moved.options[0].seats).toEqual([{ rowId: "lead", from: "m-xim", to: "m-noe" }, { rowId: "bgv", from: "m-noe", to: "m-lia" }]);
    expect(moved.options[0].breaks.map((b) => b.line)).toEqual(expect.arrayContaining([
      "Noé dirige 2 domingos en noviembre; lo normal es uno.",
      "Noé dirige domingos seguidos: 15 y 22 nov.",
    ]));
  });

  it("`only` reproduces exactly the option shown, keys included", () => {
    const out = proposeFallbacks(input());
    if (out.kind !== "options") throw new Error("expected options");
    for (const shown of out.options) {
      const replay = proposeFallbacks({ ...input(), only: new Map(shown.seats.map((s) => [s.rowId, s.to])) });
      expect(replay).toEqual({ kind: "options", options: [shown] });
    }
    // Someone who marked the day is never offered, even when asked for.
    expect(proposeFallbacks({ ...input(), only: new Map([["lead", "m-quim"]]) })).toEqual({ kind: "none", reason: "no_candidate" });
  });

  it("a personal rule may be broken too, and its sentence is the explanation", () => {
    const i = input();
    const out = proposeFallbacks({ ...i, config: { ...i.config!, restrictions: [restriction("x-oto", "Oto", { excludedPatterns: ["Sun.Lead"] })] } });
    if (out.kind !== "options") throw new Error("expected options");
    const oto = out.options.find((o) => o.seats[0].to === "m-oto");
    expect(oto).toBeDefined();
    const rule = oto!.breaks.find((b) => b.key.startsWith("s:"));
    expect(rule?.line).toBe("Oto: su regla «No líder en domingo».");
    // One more broken rule than Lía's option, so it sorts after it.
    expect(out.options.indexOf(oto!)).toBeGreaterThan(out.options.findIndex((o) => o.seats[0].to === "m-lia"));
  });

  it("someone off the lists BECAUSE of a personal rule on that seat is offered, with that rule as the line", () => {
    const i = input();
    const people = ["m-lia", "m-mar", "m-noe", "m-oto", "m-xim", "m-quim"].map((id) => (id === "m-oto" ? { ...listed(id), roles: { ...ALL_IN, "Sun.Lead": "out" as const } } : listed(id)));
    people.push({ ...listed("m-pau"), roles: { ...ALL_IN, "Sun.Lead": "out" as const } });
    const out = proposeFallbacks({
      ...i,
      ledger: ledgerResponse(["2026-11"], { horizon: [{ record: record("2026-11", people), storedServices: 5, recordBinds: true }] }),
      config: { ...i.config!, restrictions: [restriction("x-oto", "Oto", { excludedPatterns: ["Sun.Lead"] })] },
    });
    if (out.kind !== "options") throw new Error("expected options");
    const oto = out.options.find((o) => o.seats[0].to === "m-oto");
    expect(oto?.breaks.map((b) => b.line)).toContain("Oto: su regla «No líder en domingo».");
  });

  it("singers off the Lead lists never use up the tries: with many of them, the leaders are still offered", () => {
    const i = input();
    // Nine free support singers with no seats this month sort ahead of the leaders by load.
    const extra = Array.from({ length: 9 }, (_, k) => ({ _id: `m-s${k}`, member_name: `S${k} Test`, alias: `S${k}`, memberType: ["voz", "support"], ministries: ["worship"] }));
    const people = [...["m-lia", "m-mar", "m-noe", "m-oto", "m-xim", "m-quim"].map(listed), ...["m-pau", ...extra.map((m) => m._id)].map((id) => ({ ...listed(id), roles: { ...ALL_IN, "Sun.Lead": "out" as const } }))];
    const out = proposeFallbacks({
      ...i,
      members: [...i.members, ...extra] as EditorMember[],
      ledger: ledgerResponse(["2026-11"], { horizon: [{ record: record("2026-11", people), storedServices: 5, recordBinds: true }] }),
    });
    if (out.kind !== "options") throw new Error("expected options");
    expect(out.options.length).toBeGreaterThanOrEqual(2);
    expect(out.options.every((o) => ["m-lia", "m-mar", "m-noe", "m-oto"].includes(o.seats[0].to!))).toBe(true);
  });

  it("a person who also plays: the bass goes to a free bassist even when the Lead taker breaks a personal rule", () => {
    const i = input();
    const both = { ...lead("m-xim", "Ximena"), memberType: ["voz", "sunday_lead", "instrumento"], instruments: ["Bass"], singsAndPlays: true };
    const raul = { _id: "m-raul", member_name: "Raúl Test", alias: "Raúl", memberType: ["instrumento"], instruments: ["Bass"], ministries: ["worship"] };
    const r = rows();
    r[2] = storedRow("s15", "sunday_role", "2026-11-15", { leads: ["m-xim"], bgvs: ["m-noe"], chorus: ["m-pau"], instruments: [["Bass", "m-xim"]] });
    const base = inputFor({ rows: r, members: [...PEOPLE.filter((m) => m._id !== "m-xim"), both, raul] as EditorMember[], absent: { roleId: "s15", memberId: "m-xim" } });
    const out = proposeFallbacks({
      ...i, board: base.board, adminRoles: base.adminRoles, members: base.members,
      config: { ...i.config!, restrictions: [restriction("x-oto", "Oto", { excludedPatterns: ["Sun.Lead"] })] },
    });
    if (out.kind !== "options") throw new Error("expected options");
    const oto = out.options.find((o) => o.seats[0].to === "m-oto");
    expect(oto?.seats).toEqual([{ rowId: "lead", from: "m-xim", to: "m-oto" }, { rowId: "instrumento:Bass", from: "m-xim", to: "m-raul" }]);
    for (const o of out.options) expect(o.seats.find((s) => s.rowId === "instrumento:Bass")?.to).toBe("m-raul");
  });

  it("never offers someone off the solver's lists for the seat (a «Soporte» singer as Lead)", () => {
    const out = proposeFallbacks(input());
    if (out.kind !== "options") throw new Error("expected options");
    expect(out.options.some((o) => o.seats.some((s) => s.rowId === "lead" && s.to === "m-pau"))).toBe(false);
    expect(proposeFallbacks({ ...input(), only: new Map([["lead", "m-pau"], ["coro", "m-lia"]]) })).toEqual({ kind: "none", reason: "no_candidate" });
  });

  it("a «Soporte» singer with a «No líder en domingo» rule is still never offered as Lead (her rule does not explain it)", () => {
    const i = input();
    // Zoe is free, has no seat this month (lowest load) and is off the Lead list ANYWAY: she is
    // not on the Sunday Lead pool. Her personal rule must not excuse that.
    const zoe = { _id: "m-zoe", member_name: "Zoe Test", alias: "Zoe", memberType: ["voz", "support"], ministries: ["worship"] };
    const people = [...["m-lia", "m-mar", "m-noe", "m-oto", "m-xim", "m-quim"].map(listed), ...["m-pau", "m-zoe"].map((id) => ({ ...listed(id), roles: { ...ALL_IN, "Sun.Lead": "out" as const } }))];
    const withZoe = {
      ...i,
      members: [...i.members, zoe] as EditorMember[],
      ledger: ledgerResponse(["2026-11"], { horizon: [{ record: record("2026-11", people), storedServices: 5, recordBinds: true }] }),
      config: { ...i.config!, support: ["m-pau", "m-zoe"], restrictions: [restriction("x-zoe", "Zoe", { excludedPatterns: ["Sun.Lead"] })] },
    };
    const out = proposeFallbacks(withZoe);
    if (out.kind !== "options") throw new Error("expected options");
    expect(out.options.some((o) => o.seats.some((s) => s.to === "m-zoe" && s.rowId === "lead"))).toBe(false);
    expect(proposeFallbacks({ ...withZoe, only: new Map([["lead", "m-zoe"]]) })).toEqual({ kind: "none", reason: "no_candidate" });
  });

  it("stops early past the deadline and never answers an option without a broken rule", () => {
    expect(proposeFallbacks({ ...input(), pastDeadline: () => true })).toEqual({ kind: "none", reason: "no_candidate" });
    const out = proposeFallbacks(input());
    if (out.kind === "options") for (const o of out.options) expect(o.breaks.length).toBeGreaterThan(0);
  });

  it("is «sin revisar» without the month's record and never runs for a worship night's song lead", () => {
    expect(proposeFallbacks({ ...input(), ledger: ledgerFor(null) })).toEqual({ kind: "none", reason: "unchecked" });
    expect(proposeFallbacks({ ...input(), snapshotRole: { format: "worship_night", songs: [{ leads: [{ _ref: "m-xim" }] }] } }))
      .toEqual({ kind: "none", reason: "song_lead" });
  });
});
