// Solver v3 C6 RQ-4 — people, carried balances (P: keys rewritten to minted ids), exempt and the
// cadence setting from each month's SOURCE, and the cadence states computed ONCE per run from IF2-12.
import { describe, expect, it } from "vitest";

import { buildV3People, carriedPresenceKeys, computeRunCadence } from "../v3People";
import type { MonthSource } from "../v3MonthSources";
import type { V3Role, V3Service } from "../v3Wire";
import { ALL_IN, MEMBERS, figures, ledgerPerson, ledgerResponse } from "./v3Fixtures";
import type { FairnessMonthBody, RoleKey, Status } from "@/app/utils/fairnessVocabulary";

type Person = FairnessMonthBody["people"][number];
const p = (memberId: string, over: Partial<Person> = {}): Person => ({
  memberId, roles: { ...ALL_IN }, exactRules: [], exempt: false, blocks: [], ...over,
});
const src = (month: string, people: Person[], state: MonthSource["state"] = "unrecorded"): MonthSource =>
  ({ month, state, rev: null, recordedAt: null, body: { month, people, presence: [] } });
const sunday = (id: string, date: string, counts = true): V3Service =>
  ({ id, date, month: date.slice(0, 7), kind: "sunday", fixed: false, counts, seats: { Lead: 2, BGV: 3, Choir: 3 } });
const NOV_SUNDAYS = ["2026-11-01", "2026-11-08", "2026-11-15", "2026-11-22", "2026-11-29"].map((d, i) => sunday(`s${i}`, d));
const DEC_SUNDAYS = ["2026-12-06", "2026-12-13"].map((d, i) => sunday(`d${i}`, d));
const leadEverywhere = (ids: string[]) => new Map<string, Record<string, V3Role[]>>(
  ids.map((id) => [id, Object.fromEntries([...NOV_SUNDAYS, ...DEC_SUNDAYS].map((s) => [s.id, ["Lead", "BGV"] as V3Role[]]))]),
);
const out = (key: RoleKey): Record<RoleKey, Status> => ({ ...ALL_IN, [key]: "out" });

describe("computeRunCadence (RQ-4, IF2-12, A14) — once per run, mapped to the wire", () => {
  const base = { months: ["2026-11"], services: NOV_SUNDAYS, priorMonth: "2026-10" };

  it("on when eligible, available and she did not lead last month", () => {
    const run = computeRunCadence({ ...base, sources: [src("2026-11", [p("m-ana", { sundayCadence: "alternate" })])], ledger: ledgerResponse(["2026-11"]), eligibility: leadEverywhere(["m-ana"]) });
    expect(run.get("m-ana")).toEqual([{ month: "2026-11", state: "on", reason: "on", wire: "on" }]);
  });

  it("out of the Sunday pool → not_eligible → `out`", () => {
    const run = computeRunCadence({ ...base, sources: [src("2026-11", [p("m-ana", { sundayCadence: "alternate", roles: out("Sun.Lead") })])], ledger: ledgerResponse(["2026-11"]), eligibility: leadEverywhere(["m-ana"]) });
    expect(run.get("m-ana")?.[0]).toEqual({ month: "2026-11", state: "off", reason: "not_eligible", wire: "out" });
  });

  it("unavailable every Sunday, or rule-excluded from Sun.Lead on every available Sunday → `off` (A14)", () => {
    const noLead = new Map([["m-ana", Object.fromEntries(NOV_SUNDAYS.map((s) => [s.id, ["BGV"] as V3Role[]]))]]);
    const run = computeRunCadence({ ...base, sources: [src("2026-11", [p("m-ana", { sundayCadence: "alternate" })])], ledger: ledgerResponse(["2026-11"]), eligibility: noLead });
    expect(run.get("m-ana")?.[0]).toEqual({ month: "2026-11", state: "off", reason: "no_available_sunday", wire: "off" });
  });

  it("led a counted Sunday in the month before → `off`; a 2-month run assumes month 1 is led when it is on", () => {
    const ledLast = ledgerResponse(["2026-11", "2026-12"], { people: [ledgerPerson("m-ana", "Ana", { countedSundayLeads: ["2026-10-25"] })] });
    const two = { months: ["2026-11", "2026-12"], services: [...NOV_SUNDAYS, ...DEC_SUNDAYS], priorMonth: "2026-10" };
    const sources = [src("2026-11", [p("m-ana", { sundayCadence: "alternate" })]), src("2026-12", [p("m-ana", { sundayCadence: "alternate" })])];
    expect(computeRunCadence({ ...two, sources, ledger: ledLast, eligibility: leadEverywhere(["m-ana"]) }).get("m-ana")!.map((e) => e.wire)).toEqual(["off", "on"]);
    const fresh = computeRunCadence({ ...two, sources, ledger: ledgerResponse(["2026-11", "2026-12"]), eligibility: leadEverywhere(["m-ana"]) }).get("m-ana")!;
    expect(fresh.map((e) => [e.wire, e.reason])).toEqual([["on", "on"], ["off", "assumed_led_previous_month"]]);
  });

  it("a counted Sunday-dated special counts as a counted Sunday; an uncounted Sunday does not", () => {
    const services: V3Service[] = [
      { id: "sp", date: "2026-11-22", month: "2026-11", kind: "special", fixed: true, counts: true },
      sunday("s-un", "2026-11-01", false),
    ];
    const elig = new Map([["m-ana", { sp: ["Lead"] as V3Role[], "s-un": ["Lead"] as V3Role[] }]]);
    const run = computeRunCadence({ months: ["2026-11"], services, priorMonth: "2026-10", sources: [src("2026-11", [p("m-ana", { sundayCadence: "alternate" })])], ledger: ledgerResponse(["2026-11"]), eligibility: elig });
    expect(run.get("m-ana")?.[0].wire).toBe("on");
  });

  it("a bound month's record holds the cadence while the screen does not → the record's setting counts", () => {
    const run = computeRunCadence({ ...base, sources: [src("2026-11", [p("m-ana", { sundayCadence: "alternate" })], "bound")], ledger: ledgerResponse(["2026-11"]), eligibility: leadEverywhere(["m-ana"]) });
    expect(run.has("m-ana")).toBe(true);
  });
});

describe("buildV3People (RQ-4)", () => {
  const ids = (xs: string[]) => new Set(xs);
  const presenceId = (k: string) => ({ "d-carla-dani": "r1", "d-old": "r2" })[k]!;

  it("carried is IF2-8's window balance, unrounded, with every P: key rewritten to P: + the minted id", () => {
    const ledger = ledgerResponse(["2026-11"], { people: [ledgerPerson("m-ana", "Ana", { window: { DL: figures(-87), BGV: figures(13), "P:d-carla-dani": figures(50), "P:d-old": figures(-25) } })] });
    const res = buildV3People({ months: ["2026-11"], sources: [src("2026-11", [p("m-ana")])], ledger, members: MEMBERS, eligibility: leadEverywhere(["m-ana"]), extraIds: ids([]), cadence: new Map(), presenceId, priorMonth: "2026-10" });
    if (!res.ok) throw new Error(res.lines.join());
    expect(res.people[0].carried).toEqual({ DL: -87, BGV: 13, "P:r1": 50, "P:r2": -25 });
    expect(JSON.stringify(res.people)).not.toContain("d-carla-dani");
    expect(carriedPresenceKeys(ledger, ["m-ana"])).toEqual(["d-carla-dani", "d-old"]);
  });

  it("people sent: anyone eligible at a request service, every pin holder and rule person — nobody else", () => {
    const res = buildV3People({ months: ["2026-11"], sources: [src("2026-11", [p("m-ana"), p("m-bruno"), p("m-carla")])], ledger: ledgerResponse(["2026-11"]), members: MEMBERS, eligibility: leadEverywhere(["m-ana"]), extraIds: ids(["m-dani"]), cadence: new Map(), presenceId, priorMonth: "2026-10" });
    if (!res.ok) throw new Error(res.lines.join());
    expect(res.people.map((x) => x.id)).toEqual(["m-ana", "m-dani"]);
    expect(res.people[0].name).toBe("Ana");
  });

  it("exempt and cadence come from each month's source; a person in one month only is `out` in the other", () => {
    const cadence = new Map([["m-ana", [
      { month: "2026-11", state: "on" as const, reason: "on" as const, wire: "on" as const },
      { month: "2026-12", state: "off" as const, reason: "not_eligible" as const, wire: "out" as const },
    ]]]);
    const res = buildV3People({ months: ["2026-11", "2026-12"], sources: [src("2026-11", [p("m-ana", { sundayCadence: "alternate", exempt: true })]), src("2026-12", [])], ledger: ledgerResponse(["2026-11", "2026-12"]), members: MEMBERS, eligibility: leadEverywhere(["m-ana"]), extraIds: ids([]), cadence, presenceId, priorMonth: "2026-10" });
    if (!res.ok) throw new Error(res.lines.join());
    expect(res.people[0].exempt).toBe(true);
    expect(res.people[0].cadence).toEqual({ "2026-11": "on", "2026-12": "out" });
  });

  it.each([
    ["Exenta", { exempt: true }, { exempt: false }],
    ["Mes por medio", { sundayCadence: "alternate" as const }, {}],
  ])("refuses a person whose two months disagree on «%s» (the standing behaviour, C5 declined S-3)", (which, nov, dec) => {
    const res = buildV3People({ months: ["2026-11", "2026-12"], sources: [src("2026-11", [p("m-ana", nov)], "bound"), src("2026-12", [p("m-ana", dec)])], ledger: ledgerResponse(["2026-11", "2026-12"]), members: MEMBERS, eligibility: leadEverywhere(["m-ana"]), extraIds: ids([]), cadence: new Map(), presenceId, priorMonth: "2026-10" });
    expect(res).toEqual({ ok: false, lines: [`Noviembre y diciembre tienen distinto «${which}» para Ana (uno viene del registro). Planea 1 mes.`] });
  });

  it("dl_since: firstRecordedIn before months[0]; else the first horizon month whose source marks Sun.Lead `in`; else null", () => {
    const run = (firstRecordedIn: Record<string, string>, roles: Record<RoleKey, Status>[]) => {
      const ledger = ledgerResponse(["2026-11", "2026-12"], { people: [ledgerPerson("m-ana", "Ana", { firstRecordedIn })] });
      const res = buildV3People({ months: ["2026-11", "2026-12"], sources: [src("2026-11", [p("m-ana", { roles: roles[0] })]), src("2026-12", [p("m-ana", { roles: roles[1] })])], ledger, members: MEMBERS, eligibility: leadEverywhere(["m-ana"]), extraIds: ids([]), cadence: new Map(), presenceId, priorMonth: "2026-10" });
      if (!res.ok) throw new Error(res.lines.join());
      return res.people[0].dl_since;
    };
    expect(run({ "Sun.Lead": "2026-08" }, [ALL_IN, ALL_IN])).toBe("2026-08");
    expect(run({ "Sun.Lead": "2026-11" }, [out("Sun.Lead"), ALL_IN])).toBe("2026-12");
    expect(run({}, [out("Sun.Lead"), out("Sun.Lead")])).toBeNull();
  });

  it("prev_dl_leads counts IF2-8 countedSundayLeads entries in the month before (a repeated date counts twice)", () => {
    const ledger = ledgerResponse(["2026-11"], { people: [ledgerPerson("m-ana", "Ana", { countedSundayLeads: ["2026-09-27", "2026-10-04", "2026-10-04"] })] });
    const res = buildV3People({ months: ["2026-11"], sources: [src("2026-11", [p("m-ana")])], ledger, members: MEMBERS, eligibility: leadEverywhere(["m-ana"]), extraIds: ids([]), cadence: new Map(), presenceId, priorMonth: "2026-10" });
    if (!res.ok) throw new Error(res.lines.join());
    expect(res.people[0].prev_dl_leads).toBe(2);
  });
});
