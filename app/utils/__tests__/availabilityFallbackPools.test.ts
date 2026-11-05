// ADR-0079, plan 2026-11-05 §3: someone off the month's v3 lists for a seat is offered only when a
// personal rule on that seat is what keeps them off, i.e. they are on that seat's pool without it
// (`pooledForRoleKey`). Every path that seats a weekend voice: the singer who moves up, the filler of
// the seat they leave, and a Saturday Lead (Sunday or Saturday leaders, never «Soporte»).
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/sanity/env", () => ({ apiVersion: "2024-07-23", dataset: "test", projectId: "test" }));
import { ALL_IN, ledgerResponse, record, config, restriction } from "@/app/components/admin/__tests__/v3Fixtures";
import type { ServiceRole } from "@/app/components/admin/serviceCardModel";
import type { LogicalRecord, RoleKey } from "@/app/utils/fairnessVocabulary";
import { storedMonthBoard } from "@/app/mcp/monthProposals/storedMonthBoard";
import type { EditorMember } from "@/app/mcp/monthProposals/revise";
import { storedRow, summaryFor, type StoredRow } from "@/app/mcp/tools/__tests__/serviceEditorFixtures";
import { proposeFallbacks, proposeReplacement, type ProposeInput } from "../availabilityConflicts";

const TODAY = "2026-10-21";
const person = (memberId: string, roles: Partial<Record<RoleKey, "in" | "out">> = {}): LogicalRecord["people"][number] => ({
  memberId, name: memberId, roles: { ...ALL_IN, ...roles }, exactRules: [], exempt: false, blocks: [],
});
function build(rows: StoredRow[], members: EditorMember[], people: LogicalRecord["people"], cfg: ReturnType<typeof config>, absent: { roleId: string; memberId: string }) {
  const date = rows.find((r) => r._id === absent.roleId)!.date;
  const ms = members.map((m) => (m._id === absent.memberId ? { ...m, unavailableDates: [date] } : m)) as EditorMember[];
  const adminRoles = JSON.parse(JSON.stringify(rows)) as ServiceRole[];
  const input: ProposeInput & { nameOf: (id: string) => string } = {
    board: storedMonthBoard({ month: "2026-11", adminRoles, summary: summaryFor(rows), todayIso: TODAY }),
    roleId: absent.roleId, memberId: absent.memberId, members: ms, config: cfg, adminRoles, todayIso: TODAY,
    ledger: ledgerResponse(["2026-11"], { horizon: [{ record: record("2026-11", people), storedServices: rows.length, recordBinds: true }] }),
    nameOf: (id) => id,
  };
  return input;
}
const m = (id: string, types: string[]) => ({ _id: id, member_name: `${id} Test`, alias: id, memberType: ["voz", ...types], ministries: ["worship"] });

describe("fallback options: a personal rule excuses only someone on the seat's pool (Sunday, moved-up singer and filler)", () => {
  const lead = (id: string) => m(id, ["sunday_lead"]);
  const PEOPLE = [lead("m-lia"), lead("m-mar"), lead("m-noe"), lead("m-oto"), lead("m-xim"), lead("m-quim"), m("m-pau", ["support"]), m("m-zed", ["support"])];
  const rows = () => [
    storedRow("s1", "sunday_role", "2026-11-01", { leads: ["m-lia"] }),
    storedRow("s8", "sunday_role", "2026-11-08", { leads: ["m-mar"] }),
    storedRow("s15", "sunday_role", "2026-11-15", { leads: ["m-xim"], bgvs: ["m-noe"], chorus: ["m-pau"] }),
    storedRow("s22", "sunday_role", "2026-11-22", { leads: ["m-noe"] }),
    storedRow("s29", "sunday_role", "2026-11-29", { leads: ["m-oto"] }),
  ];
  function input() {
    const people = PEOPLE.map((p) => p._id === "m-pau" ? person(p._id, { "Sun.Lead": "out" })
      : p._id === "m-zed" ? person(p._id, { "Sun.Lead": "out", "Sun.BGV": "out", "Sun.Choir": "out", "Sat.Lead": "out", "Sat.BGV": "out", "Sat.Choir": "out" })
      : person(p._id));
    const i = build(rows(), PEOPLE as EditorMember[], people, config({
      sundayLeads: ["m-lia", "m-mar", "m-noe", "m-oto", "m-xim", "m-quim"], support: ["m-pau"], // m-zed NOT ticked
      restrictions: [restriction("x-pau", "m-pau", { excludedPatterns: ["Sun.Lead"] }), restriction("x-zed", "m-zed", { excludedPatterns: ["Sun.BGV"] })],
    }), { roleId: "s15", memberId: "m-xim" });
    i.members = i.members.map((x) => (x._id === "m-quim" ? { ...x, unavailableDates: ["2026-11-15"] } : x));
    return i;
  }
  it("the strict search finds nobody", () => { expect(proposeReplacement(input())).toEqual({ kind: "none", reason: "no_candidate" }); });
  it("Pau (Soporte, Sun.Lead rule) never moved up into Lead", () => {
    const out = proposeFallbacks(input());
    if (out.kind === "options") expect(out.options.some((o) => o.seats.some((s) => s.rowId === "lead" && s.to === "m-pau"))).toBe(false);
    expect(proposeFallbacks({ ...input(), only: new Map([["lead", "m-pau"], ["coro", "m-lia"]]) })).toEqual({ kind: "none", reason: "no_candidate" });
  });
  it("Zed (unticked, Sun.BGV rule) never fills the BGV a moved-up singer leaves", () => {
    const out = proposeFallbacks(input());
    if (out.kind === "options") expect(out.options.some((o) => o.seats.some((s) => s.to === "m-zed"))).toBe(false);
    expect(proposeFallbacks({ ...input(), only: new Map([["lead", "m-noe"], ["bgv", "m-zed"]]) })).toEqual({ kind: "none", reason: "no_candidate" });
  });
});

describe("fallback options: a personal rule excuses only someone on the seat's pool (Saturday Lead)", () => {
  const PEOPLE = [m("m-sx", ["saturday_lead"]), m("m-sl", ["saturday_lead"]), m("m-sun", ["sunday_lead"]), m("m-pz", ["support"])];
  const rows = () => [
    storedRow("sat7", "saturday_role", "2026-11-07", { leads: ["m-sl"] }),
    storedRow("sat14", "saturday_role", "2026-11-14", { leads: ["m-sx"] }),
    storedRow("s15", "sunday_role", "2026-11-15", { leads: ["m-sun"] }),
  ];
  function input() {
    const people = [person("m-sx", { "Sun.Lead": "out" }), person("m-sl", { "Sun.Lead": "out", "Sat.Lead": "out" }), person("m-sun", { "Sat.Lead": "out" }), person("m-pz", { "Sun.Lead": "out", "Sat.Lead": "out" })];
    return build(rows(), PEOPLE as EditorMember[], people, config({
      sundayLeads: ["m-sun"], saturdayLeads: ["m-sx", "m-sl"], support: ["m-pz"],
      restrictions: [
        restriction("x-sl", "m-sl", { excludedPatterns: ["Sat.Lead"] }),
        restriction("x-sun", "m-sun", { excludedPatterns: ["Sat.Lead"] }),
        restriction("x-pz", "m-pz", { excludedPatterns: ["Sat.Lead"] }),
      ],
    }), { roleId: "sat14", memberId: "m-sx" });
  }
  it("pooled sat/sun leaders offered for Sat.Lead, Soporte never", () => {
    const out = proposeFallbacks(input());
    expect(out.kind).toBe("options");
    if (out.kind !== "options") return;
    const takers = out.options.map((o) => o.seats[0].to);
    expect(takers).toContain("m-sl");
    expect(takers).toContain("m-sun");
    expect(takers).not.toContain("m-pz");
    expect(proposeFallbacks({ ...input(), only: new Map([["lead", "m-pz"]]) })).toEqual({ kind: "none", reason: "no_candidate" });
  });
});
