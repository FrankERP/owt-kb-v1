// Solver v3 C6 RQ-1–RQ-10 composed: the request carries exactly C5's fields, one eligibility source
// per month shared with the record body, every pin (stored, special, board) under the v3 cap, the C5
// limits pre-flighted, C6's notices in a stable order — and never a v2 field or helper.
import { afterEach, describe, expect, it, vi } from "vitest";

const v2 = vi.hoisted(() => ({ buildSolveRequest: vi.fn(), omittedCapsNotices: vi.fn(), trailingNotice: vi.fn() }));
vi.mock("../plannerModel", async (importOriginal) => {
  const real = await importOriginal<typeof import("../plannerModel")>();
  v2.buildSolveRequest.mockImplementation(real.buildSolveRequest);
  v2.omittedCapsNotices.mockImplementation(real.omittedCapsNotices);
  v2.trailingNotice.mockImplementation(real.trailingNotice);
  return {
    ...real,
    buildSolveRequest: (...a: Parameters<typeof real.buildSolveRequest>) => v2.buildSolveRequest(...a),
    omittedCapsNotices: (...a: Parameters<typeof real.omittedCapsNotices>) => v2.omittedCapsNotices(...a),
    trailingNotice: (...a: Parameters<typeof real.trailingNotice>) => v2.trailingNotice(...a),
  };
});

import { V3_LIMITS, buildV3SolveRequest, limitRefusals, preReadRefusals, type V3BuildInput } from "../v3SolveRequest";
import { buildColumns, buildRows, type GridCell } from "../plannerModel";
import type { V3StoredRole } from "../v3Services";
import { ALL_IN, ANA, BRUNO, CARLA, DANI, MEMBERS, cap, config, ledgerResponse, record, restriction } from "./v3Fixtures";

afterEach(() => vi.clearAllMocks());

const NOV = ["2026-11-01", "2026-11-08", "2026-11-15", "2026-11-22", "2026-11-29"];
const POOLS = config({ sundayLeads: ["m-ana", "m-bruno"], saturdayLeads: ["m-carla"], support: ["m-dani"] });
const base = (over: Partial<V3BuildInput> = {}): V3BuildInput => ({
  months: ["2026-11"], currentMonth: "2026-10",
  ledger: ledgerResponse(["2026-11"]),
  config: POOLS, members: MEMBERS, storedRoles: [],
  planned: { columns: buildColumns({ sundayDates: NOV, activeSatDates: [] }), cells: [], rows: buildRows() },
  savedWindow: [], fillEmpty: false, seed: 42, requestId: "req-test",
  ...over,
});
const ok = (input: V3BuildInput) => {
  const out = buildV3SolveRequest(input);
  if (!out.ok) throw new Error(out.lines.join("\n"));
  return out;
};

describe("RQ-8 / RQ-9 — the envelope, and v2 never reached", () => {
  it("carries contract 3, seed, request_id, months, and nothing of v2 (no budget either)", () => {
    const { request } = ok(base());
    expect(Object.keys(request).sort()).toEqual(["contract", "months", "people", "pins", "prior", "request_id", "rules", "seed", "services"]);
    expect(request).toMatchObject({ contract: 3, seed: 42, request_id: "req-test", months: ["2026-11"] });
    for (const v2Field of ["weeks", "dsl_rules", "history", "weekends_with_saturday", "budget"]) expect(request).not.toHaveProperty(v2Field);
  });

  it("never calls v2's builder, omitted-cap notices or trailing notice", () => {
    ok(base());
    expect(v2.buildSolveRequest).not.toHaveBeenCalled();
    expect(v2.omittedCapsNotices).not.toHaveBeenCalled();
    expect(v2.trailingNotice).not.toHaveBeenCalled();
  });
});

describe("RQ-2 — one value feeds the request and the record body", () => {
  it("eligibility follows the snapshot's source, which is frozen", () => {
    const out = ok(base());
    const source = out.snapshot.sources[0];
    const dani = out.request.people.find((p) => p.id === "m-dani")!;
    expect(source.body.people.find((p) => p.memberId === "m-dani")!.roles["Sun.Lead"]).toBe("out");
    expect(Object.values(dani.eligibility).every((roles) => !roles.includes("Lead"))).toBe(true);
    expect(() => { (source.body.people as unknown[]).length = 0; }).toThrow();
  });

  it("a bound month ignores an on-screen pool change", () => {
    const rec = record("2026-11", [{ memberId: "m-dani", name: "Dani", roles: { ...ALL_IN }, exactRules: [], exempt: false, blocks: [] }]);
    const ledger = ledgerResponse(["2026-11"], { horizon: [{ record: rec, storedServices: 1, recordBinds: true }] });
    const out = ok(base({ ledger }));
    const dani = out.request.people.find((p) => p.id === "m-dani")!;
    expect(Object.values(dani.eligibility).some((roles) => roles.includes("Lead"))).toBe(true);
    expect(out.request.people.some((p) => p.id === "m-ana")).toBe(false);
  });
});

describe("RQ-6 — pins", () => {
  const stored = (id: string, date: string, leads: string[]): V3StoredRole =>
    ({ _id: id, _type: "special_role", date, countsForFairness: true, leads: leads.map((x) => ({ _id: x })), bgvs: [], chorus: [] });

  it("«Solo llenar vacíos» pins the planned columns' occupied voice seats, one per person per service, with today's duplicate wording", () => {
    const col = "create:sunday_role__2026-11-08";
    const cells: GridCell[] = [
      { columnId: col, rowId: "lead", occupants: [{ memberId: "m-ana" }], origin: "manual" },
      { columnId: col, rowId: "bgv", occupants: [{ memberId: "m-ana" }, { memberId: "m-dani" }], origin: "manual" },
    ];
    const out = ok(base({ fillEmpty: true, planned: { columns: buildColumns({ sundayDates: NOV, activeSatDates: [] }), cells, rows: buildRows() } }));
    expect(out.request.pins).toEqual([
      { service: col, date: "2026-11-08", role: "Lead", person: "m-ana" },
      { service: col, date: "2026-11-08", role: "BGV", person: "m-dani" },
    ]);
    expect(out.notices.some((n) => n.startsWith("Ana estaba en dos lugares del domingo 8 nov; se fijó solo en"))).toBe(true);
    expect(out.boardPinnedCellKeys).toEqual(new Set([`${col}|lead`, `${col}|bgv`]));
  });

  it("without «Solo llenar vacíos» the board's seats are not pins", () => {
    const col = "create:sunday_role__2026-11-08";
    const cells: GridCell[] = [{ columnId: col, rowId: "lead", occupants: [{ memberId: "m-ana" }], origin: "manual" }];
    expect(ok(base({ planned: { columns: buildColumns({ sundayDates: NOV, activeSatDates: [] }), cells, rows: buildRows() } })).request.pins).toEqual([]);
  });

  it("a board seat held by someone no longer a member refuses with today's line", () => {
    const col = "create:sunday_role__2026-11-08";
    const cells: GridCell[] = [{ columnId: col, rowId: "lead", occupants: [{ memberId: "m-gone" }], origin: "manual" }];
    const out = buildV3SolveRequest(base({ fillEmpty: true, planned: { columns: buildColumns({ sundayDates: NOV, activeSatDates: [] }), cells, rows: buildRows() } }));
    expect(out).toEqual({ ok: false, lines: ["No se puede usar «Solo llenar vacíos»: en Lead del domingo 8 nov hay alguien que ya no está en la lista de miembros. Quítalo de ese lugar y vuelve a intentarlo."] });
  });

  it("refuses above the v3 pin cap before any fetch", () => {
    // 64 stored counted specials × 4 people each = 256 pins (the pin cap is checked before C5's limits).
    const specials = Array.from({ length: 64 }, (_, i) =>
      stored(`sp-${i}`, i < 56 ? `2026-11-${String((i % 28) + 1).padStart(2, "0")}` : `2026-12-0${(i % 8) + 1}`, [ANA, BRUNO, CARLA, DANI].map((m) => m._id)));
    const out = buildV3SolveRequest(base({ months: ["2026-11", "2026-12"], ledger: ledgerResponse(["2026-11", "2026-12"]), storedRoles: specials, planned: { columns: [], cells: [], rows: buildRows() } }));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.lines[0]).toBe("El plan tiene 256 lugares fijados (guardados, especiales y del tablero) y el solver acepta hasta 250. Planea 1 mes o apaga «Solo llenar vacíos».");
  });
});

describe("RQ-10 — C5's limits are pre-flighted", () => {
  it("one line per limit crossed", () => {
    expect(V3_LIMITS).toEqual({ services: 40, people: 100, rules: 500 });
    expect(limitRefusals({ services: 41, people: 100, rules: 500 })).toEqual(["El plan es demasiado grande para el solver (servicios: 41 de 40). Planea 1 mes."]);
    expect(limitRefusals({ services: 40, people: 101, rules: 500 })).toEqual(["El plan es demasiado grande para el solver (personas: 101 de 100). Planea 1 mes."]);
    expect(limitRefusals({ services: 40, people: 100, rules: 501 })).toEqual(["El plan es demasiado grande para el solver (reglas: 501 de 500). Planea 1 mes."]);
  });

  it("the builder applies the services limit", () => {
    const fortyOne = Array.from({ length: 41 }, (_, i) => ({ _id: `sp-${i}`, _type: "special_role", date: `2026-${i < 30 ? "11" : "12"}-${String((i % 30) + 1).padStart(2, "0")}`, countsForFairness: true, leads: [], bgvs: [], chorus: [] }));
    const out = buildV3SolveRequest(base({ months: ["2026-11", "2026-12"], ledger: ledgerResponse(["2026-11", "2026-12"]), storedRoles: fortyOne, planned: { columns: [], cells: [], rows: buildRows() } }));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.lines).toContain("El plan es demasiado grande para el solver (servicios: 41 de 40). Planea 1 mes.");
  });
});

describe("preReadRefusals — HZ-7, HZ-9, WN-2, before any read", () => {
  it("a past month, then the ceiling", () => {
    expect(preReadRefusals({ months: ["2026-09"], currentMonth: "2026-10", config: POOLS, members: MEMBERS })).toEqual(["Auto no planea meses que ya pasaron. Crea esos servicios a mano."]);
    expect(preReadRefusals({ months: ["2027-10", "2027-11"], currentMonth: "2026-10", config: POOLS, members: MEMBERS }))
      .toEqual(["Auto no planea más de 12 meses adelante: Noviembre queda fuera. Elige un mes hasta octubre."]);
  });

  it("a «Mes por medio» name that matches nobody, or two people", () => {
    const cfg = config({ restrictions: [restriction("r1", "Nadie", { sundayCadence: "alternate" })] });
    expect(preReadRefusals({ months: ["2026-11"], currentMonth: "2026-10", config: cfg, members: MEMBERS }))
      .toEqual(["No se puede correr Auto: «Mes por medio» de «Nadie» no corresponde a una sola persona (no coincide con nadie). Corrige el nombre en la regla."]);
  });

  it("cadence plus an exact Sun.Lead count (A11)", () => {
    const cfg = config({ restrictions: [restriction("r1", "Ana", { sundayCadence: "alternate", caps: [cap("c", "Sun.Lead", "==", 2)] })] });
    expect(preReadRefusals({ months: ["2026-11"], currentMonth: "2026-10", config: cfg, members: MEMBERS }))
      .toEqual(["No se puede correr Auto: Ana tiene «Mes por medio» y además un número fijo de Dom Lead («Ana · Sun.Lead == 2»). Quita una de las dos."]);
  });

  it("a super-admin roster with a kids-only namesake of a «Mes por medio» person refuses nothing (C3 E25)", () => {
    const kidsAna = { _id: "m-ana-kids", member_name: "Ana Ruiz", alias: "Ana", memberType: ["voz"], ministries: ["kids"] };
    const cfg = config({ restrictions: [restriction("r1", "Ana", { sundayCadence: "alternate" })] });
    expect(preReadRefusals({ months: ["2026-11"], currentMonth: "2026-10", config: cfg, members: [...MEMBERS, kidsAna] })).toEqual([]);
  });
});

describe("services, specials and the order of C6's notices (RQ-3, SP-5, NT-3)", () => {
  it("only the planned columns passed in are sent — a skipped or blocked column is the caller's to leave out", () => {
    const columns = buildColumns({ sundayDates: NOV.slice(0, 2), activeSatDates: [] });
    expect(ok(base({ planned: { columns, cells: [], rows: buildRows() } })).request.services.map((s) => s.date)).toEqual(NOV.slice(0, 2));
  });

  it("a counted special is pre-filled and sent fixed with its seats pinned; the pre-fill notice precedes nothing of the solver's", () => {
    const columns = buildColumns({ sundayDates: [], activeSatDates: [], specials: [{ date: "2026-11-22", name: "Vigilia", countsForFairness: true }] });
    const out = ok(base({ planned: { columns, cells: [], rows: buildRows() } }));
    const special = out.request.services.find((s) => s.kind === "special")!;
    expect(special.fixed).toBe(true);
    expect(out.request.pins.filter((p) => p.service === special.id).length).toBeGreaterThan(0);
    expect(out.notices).toContain("Los especiales que cuentan para equidad se llenaron primero (Lead y BGV, por saldo) y el solver acomodó los fines de semana alrededor de ellos.");
  });

  it("SP-5: a refusal adds the specials line when counted specials were waiting", () => {
    const columns = buildColumns({ sundayDates: [], activeSatDates: [], specials: [{ date: "2026-11-22", name: "Vigilia", countsForFairness: true }] });
    const cfg = config({ ...POOLS, restrictions: [restriction("r", "Ana", { caps: [cap("c", "Sun.Lead", "<=", 1.5)] })] });
    const out = buildV3SolveRequest(base({ config: cfg, planned: { columns, cells: [], rows: buildRows() } }));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.lines[out.lines.length - 1]).toBe("Los especiales que cuentan para equidad no se llenaron porque Auto no corrió.");
  });

  it("NT-3: WN-3, then the stored-service notices, then the rule notices, then the pre-fill's, in that order", () => {
    const columns = buildColumns({ sundayDates: [], activeSatDates: [], specials: [{ date: "2026-11-22", name: "Vigilia", countsForFairness: true }] });
    const cfg = config({ ...POOLS, restrictions: [restriction("r", "Ana", { caps: [cap("c", "Sun.BGV", "<=", 0, { relative: true, relOffset: 6 })] })] });
    const storedRoles: V3StoredRole[] = [{ _id: "sun-1", _type: "sunday_role", date: "2026-11-01", leads: [{ _id: "m-ana" }], bgvs: [], chorus: [] }];
    const out = ok(base({ config: cfg, storedRoles, planned: { columns, cells: [], rows: buildRows() } }));
    const idx = (prefix: string) => out.notices.findIndex((n) => n.startsWith(prefix));
    expect(idx("Con el nuevo solver, «Líderes Sábado»")).toBeLessThan(idx("Los servicios guardados no se tocan"));
    expect(idx("Los servicios guardados no se tocan")).toBeLessThan(idx("Ana · Sun.BGV <= sem−6 queda en 0"));
    expect(idx("Ana · Sun.BGV <= sem−6 queda en 0")).toBeLessThan(idx("Los especiales que cuentan para equidad se llenaron"));
  });
});
