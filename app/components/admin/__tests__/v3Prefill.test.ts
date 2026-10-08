// Solver v3 C6 SP-1, SP-2, SP-7, CTL-2 — planned COUNTED specials are filled before the request is
// built: today's hard blocks plus RQ-2's eligibility; for a Lead, candidates whose placement would
// itself miss a protection the solver can only report as `pins` go to a SECOND tier, used only when
// the first is empty; the first tier is the line's members most owed first, then today's load order.
import { describe, expect, it } from "vitest";

import { prefillCountedSpecials, type FixedLead, type PrefillTarget } from "../v3Prefill";
import type { MonthSource } from "../v3MonthSources";
import type { RunCadence } from "../v3People";
import type { V3Role } from "../v3Wire";
import { buildColumns, type GridCell, type GridRow } from "../plannerModel";
import { ALL_IN, ANA, BRUNO, CARLA, DANI, MEMBERS, config, figures, ledgerPerson, ledgerResponse, restriction } from "./v3Fixtures";
import type { FairnessMonthBody, RoleKey, Status } from "@/app/utils/fairnessVocabulary";

const SUN_SPECIAL = "create:special_role__2026-11-22";      // a Sunday-dated special → DL-mapped Lead
const FRI_SPECIAL = "create:special_role__2026-11-20";      // a Friday special → SL-mapped Lead
const ROWS: GridRow[] = [
  { id: "lead", label: "Lead", category: "voz", target: 1 },
  { id: "bgv", label: "BGV", category: "voz", target: 1 },
];
const COLUMNS = buildColumns({
  sundayDates: [], activeSatDates: [],
  specials: [{ date: "2026-11-22", name: "Vigilia", countsForFairness: true }, { date: "2026-11-20", name: "Bautizos", countsForFairness: true }],
});
const T = (columnId: string): PrefillTarget => ({ columnId, date: columnId.slice(-10), month: "2026-11", label: columnId === SUN_SPECIAL ? "Vigilia 22 nov" : "Bautizos 20 nov" });
type Person = FairnessMonthBody["people"][number];
const person = (memberId: string, over: Partial<Person> = {}): Person => ({ memberId, roles: { ...ALL_IN }, exactRules: [], exempt: false, blocks: [], ...over });
const sourceOf = (people: Person[]): Map<string, MonthSource> =>
  new Map([["2026-11", { month: "2026-11", state: "unrecorded", rev: null, recordedAt: null, body: { month: "2026-11", people, presence: [] } }]]);
const everyoneEligible = (ids: string[]) => new Map<string, Record<string, V3Role[]>>(
  ids.map((id) => [id, { [SUN_SPECIAL]: ["Lead", "BGV"], [FRI_SPECIAL]: ["Lead", "BGV"] }]),
);
const leaders = [ANA, BRUNO, { ...CARLA, memberType: ["voz", "sunday_lead"] }];

function run(over: Partial<Parameters<typeof prefillCountedSpecials>[0]> = {}) {
  return prefillCountedSpecials({
    targets: [T(SUN_SPECIAL)],
    columns: COLUMNS, rows: ROWS, cells: [], members: leaders, savedWindow: [],
    config: config(),
    eligibility: everyoneEligible(leaders.map((m) => m._id)),
    sources: sourceOf(leaders.map((m) => person(m._id))),
    cadence: new Map(),
    ledger: ledgerResponse(["2026-11"]),
    fixedLeads: [],
    nameOf: (id) => MEMBERS.find((m) => m._id === id)?.alias ?? id,
    ...over,
  });
}
const lead = (cells: GridCell[], columnId = SUN_SPECIAL) =>
  cells.find((c) => c.columnId === columnId && c.rowId === "lead")?.occupants.map((o) => o.memberId) ?? [];

describe("SP-1 — today's hard blocks AND RQ-2's eligibility", () => {
  it("never places someone unavailable that day, already seated here, without a voice Tipo, or kept apart by a pair rule", () => {
    const out = run({
      members: [{ ...ANA, unavailableDates: ["2026-11-22"] }, BRUNO, { ...CARLA, memberType: ["voz", "sunday_lead"] }, { ...DANI, memberType: ["instrumento"] }],
      eligibility: everyoneEligible(["m-ana", "m-bruno", "m-carla", "m-dani"]),
      cells: [{ columnId: SUN_SPECIAL, rowId: "bgv", occupants: [{ memberId: "m-bruno" }], origin: "manual" }],
      config: config({ conflicts: [{ id: "x", personA: "Carla", personB: "Bruno", pattern: "*.*" }] }),
    });
    // Ana unavailable; Bruno holds BGV here (same category); Dani has no voice Tipo; Carla is kept apart from Bruno.
    // Both rows are passed: the hard blocks see a column's occupants only through the rows it is given.
    expect(lead(out.cells)).toEqual([]);
  });

  it("never places a candidate the screen admits but the month source (e.g. a bound record) does not", () => {
    const elig = everyoneEligible(["m-bruno", "m-carla"]);
    elig.set("m-ana", { [SUN_SPECIAL]: ["BGV"] });   // no Lead at this special by the record
    const out = run({ eligibility: elig, ledger: ledgerResponse(["2026-11"], { people: [ledgerPerson("m-ana", "Ana", { window: { DL: figures(500) } })] }) });
    expect(lead(out.cells)).not.toContain("m-ana");
  });

  it("is append-only: a hand-placed occupant stays and only missing seats are filled", () => {
    const out = run({ cells: [{ columnId: SUN_SPECIAL, rowId: "lead", occupants: [{ memberId: "m-carla" }], origin: "manual" }] });
    expect(lead(out.cells)).toEqual(["m-carla"]);
  });
});

describe("SP-2 — first tier: the line's members most owed first, then today's load order", () => {
  it("orders DL-line candidates by carried balance, each placement counting as a received seat", () => {
    const ledger = ledgerResponse(["2026-11"], { people: [
      ledgerPerson("m-ana", "Ana", { window: { DL: figures(30) } }),
      ledgerPerson("m-bruno", "Bruno", { window: { DL: figures(120) } }),
    ] });
    const out = run({ ledger, targets: [T(SUN_SPECIAL)] });
    expect(lead(out.cells)).toEqual(["m-bruno"]);
  });

  it("a cadence member in her ON month ranks after every DL-line candidate, whatever the balances", () => {
    const cadence: RunCadence = new Map([["m-ana", [{ month: "2026-11", state: "on", reason: "on", wire: "on" }]]]);
    const ledger = ledgerResponse(["2026-11"], { people: [ledgerPerson("m-ana", "Ana", { window: { DL: figures(900) } }), ledgerPerson("m-bruno", "Bruno", { window: { DL: figures(-50) } })] });
    const out = run({ cadence, ledger, members: [ANA, BRUNO], eligibility: everyoneEligible(["m-ana", "m-bruno"]), sources: sourceOf([person("m-ana", { sundayCadence: "alternate" }), person("m-bruno")]) });
    expect(lead(out.cells)).toEqual(["m-bruno"]);
  });

  it("CTL-2: neither «Holgura» nor «Exenta» moves a counted special's ranking", () => {
    const ledger = ledgerResponse(["2026-11"], { people: [ledgerPerson("m-ana", "Ana", { window: { DL: figures(80) } }), ledgerPerson("m-bruno", "Bruno", { window: { DL: figures(10) } })] });
    const cfg = config({ restrictions: [restriction("r-ana", "Ana", { fairness: "slack", fairnessSlack: 5 }), restriction("r-bruno", "Bruno", { fairness: "exempt" })] });
    expect(lead(run({ ledger, config: cfg }).cells)).toEqual(["m-ana"]);
  });

  it("BGV uses the first tier's order alone (no protection tiers)", () => {
    const ledger = ledgerResponse(["2026-11"], { people: [ledgerPerson("m-carla", "Carla", { window: { BGV: figures(200) } })] });
    const out = run({ ledger, fixedLeads: [{ date: "2026-11-08", memberId: "m-carla", dl: true }] });
    expect(out.cells.find((c) => c.rowId === "bgv")?.occupants.map((o) => o.memberId)).toEqual(["m-carla"]);
  });
});

describe("SP-2 — the second tier, one case per protection, used only when the first tier is empty", () => {
  const status = (k: RoleKey, s: Status) => ({ ...ALL_IN, [k]: s });

  it("(a) a cadence member in her OFF month is not placed while a first-tier candidate exists", () => {
    const cadence: RunCadence = new Map([["m-ana", [{ month: "2026-11", state: "off", reason: "led_previous_month", wire: "off" }]]]);
    const ledger = ledgerResponse(["2026-11"], { people: [ledgerPerson("m-ana", "Ana", { window: { DL: figures(900) } })] });
    expect(lead(run({ cadence, ledger }).cells)).not.toContain("m-ana");
  });

  it("(b) a stored Sunday Lead that month pushes a regular to the second tier; «exact» for Sun.Lead stays first", () => {
    // Bruno's fixed Sunday is not adjacent to the 22nd, so «exact» is the only thing that could matter for him.
    const fixed: FixedLead[] = [{ date: "2026-11-08", memberId: "m-ana", dl: true }, { date: "2026-11-01", memberId: "m-bruno", dl: true }];
    const sources = sourceOf([person("m-ana"), person("m-bruno", { roles: status("Sun.Lead", "exact") }), person("m-carla")]);
    const ledger = ledgerResponse(["2026-11"], { people: [ledgerPerson("m-ana", "Ana", { window: { DL: figures(900) } })] });
    const out = run({ fixedLeads: fixed, sources, ledger, members: [ANA, BRUNO], eligibility: everyoneEligible(["m-ana", "m-bruno"]) });
    expect(lead(out.cells)).toEqual(["m-bruno"]);
  });

  it("(b) two Sunday-dated counted specials in one month: the first placement pushes that person to the second tier for the second", () => {
    const second = "create:special_role__2026-11-29";
    const cols = buildColumns({ sundayDates: [], activeSatDates: [], specials: [{ date: "2026-11-22", name: "Vigilia", countsForFairness: true }, { date: "2026-11-29", name: "Vigilia", countsForFairness: true }] });
    const elig = new Map<string, Record<string, V3Role[]>>([["m-ana", { [SUN_SPECIAL]: ["Lead"], [second]: ["Lead"] }], ["m-bruno", { [SUN_SPECIAL]: ["Lead"], [second]: ["Lead"] }]]);
    const ledger = ledgerResponse(["2026-11"], { people: [ledgerPerson("m-ana", "Ana", { window: { DL: figures(500) } })] });
    const out = run({ columns: cols, targets: [T(SUN_SPECIAL), { columnId: second, date: "2026-11-29", month: "2026-11", label: "Vigilia 29 nov" }], eligibility: elig, members: [ANA, BRUNO], ledger, rows: [ROWS[0]] });
    expect(lead(out.cells, SUN_SPECIAL)).toEqual(["m-ana"]);
    expect(lead(out.cells, second)).toEqual(["m-bruno"]);
  });

  it("(c) a Saturday-class special and a candidate holding a stored Saturday Lead that month", () => {
    const fixed: FixedLead[] = [{ date: "2026-11-07", memberId: "m-ana", dl: false }];
    const ledger = ledgerResponse(["2026-11"], { people: [ledgerPerson("m-ana", "Ana", { window: { SL: figures(900) } })] });
    const out = run({ targets: [T(FRI_SPECIAL)], fixedLeads: fixed, ledger, members: [ANA, BRUNO], eligibility: everyoneEligible(["m-ana", "m-bruno"]) });
    expect(lead(out.cells, FRI_SPECIAL)).toEqual(["m-bruno"]);
  });

  it("(d) a Sunday-dated special the Sunday after a `prior` Sunday Lead, and the Sunday before a fixed one", () => {
    const ledger = ledgerResponse(["2026-11"], { people: [ledgerPerson("m-ana", "Ana", { window: { DL: figures(900) } })] });
    const after = run({ fixedLeads: [{ date: "2026-11-15", memberId: "m-ana", dl: true }], ledger, members: [ANA, BRUNO], eligibility: everyoneEligible(["m-ana", "m-bruno"]) });
    expect(lead(after.cells)).toEqual(["m-bruno"]);
    const before = run({ fixedLeads: [{ date: "2026-11-29", memberId: "m-ana", dl: true }], ledger, members: [ANA, BRUNO], eligibility: everyoneEligible(["m-ana", "m-bruno"]) });
    expect(lead(before.cells)).toEqual(["m-bruno"]);
  });

  it("only second-tier candidates: fill outranks protections — least important miss first, with SP-7's notice", () => {
    // Ana misses `cadence` (most important); Bruno misses `no_consecutive` (least) → Bruno. Bruno is «exact»
    // for Sun.Lead, so his fixed Sunday the 29th (same month) does not ALSO make him miss `sunday_cap`.
    const cadence: RunCadence = new Map([["m-ana", [{ month: "2026-11", state: "off", reason: "led_previous_month", wire: "off" }]]]);
    const sources = sourceOf([person("m-ana"), person("m-bruno", { roles: status("Sun.Lead", "exact") })]);
    const out = run({ cadence, sources, fixedLeads: [{ date: "2026-11-29", memberId: "m-bruno", dl: true }], members: [ANA, BRUNO], eligibility: everyoneEligible(["m-ana", "m-bruno"]) });
    expect(lead(out.cells)).toEqual(["m-bruno"]);
    expect(out.notices).toContain("Bruno dirige el Vigilia 22 nov aunque dirige el domingo anterior o el siguiente: nadie más podía dirigirlo.");
  });

  it.each([
    ["cadence", { cadence: new Map([["m-ana", [{ month: "2026-11", state: "off" as const, reason: "led_previous_month" as const, wire: "off" as const }]]]) }, "es su mes sin domingo («Mes por medio»)"],
    ["sunday_cap", { fixedLeads: [{ date: "2026-11-01", memberId: "m-ana", dl: true }] }, "ya dirige otro domingo en noviembre"],
  ])("SP-7's motivo for %s", (_name, over, motivo) => {
    const out = run({ ...over, members: [ANA], eligibility: everyoneEligible(["m-ana"]) });
    expect(out.notices).toContain(`Ana dirige el Vigilia 22 nov aunque ${motivo}: nadie más podía dirigirlo.`);
  });

  it("SP-7's motivo for the Saturday cap", () => {
    const out = run({ targets: [T(FRI_SPECIAL)], fixedLeads: [{ date: "2026-11-07", memberId: "m-ana", dl: false }], members: [ANA], eligibility: everyoneEligible(["m-ana"]) });
    expect(out.notices).toContain("Ana dirige el Bautizos 20 nov aunque ya dirige otro sábado en noviembre: nadie más podía dirigirlo.");
  });
});

describe("SP-6 — the notice names the pre-fill whenever it placed anyone", () => {
  it("present after a placement, absent when nothing was placed", () => {
    expect(run().notices[0]).toBe("Los especiales que cuentan para equidad se llenaron primero (Lead y BGV, por saldo) y el solver acomodó los fines de semana alrededor de ellos.");
    expect(run({ members: [], eligibility: new Map() }).notices).toEqual([]);
  });
});
