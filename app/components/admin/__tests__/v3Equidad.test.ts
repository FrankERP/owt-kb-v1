// Solver v3 C6 EQ-3–EQ-5, EQ-7 — the plan columns come from each TAB's own entry (never its lines,
// never a division), «Queda» from `tenths.after` through C2's formatter, and each row's reason line
// from codes, with the cadence line taken from RQ-4's values.
import { describe, expect, it } from "vitest";

import { buildEquidadPlan, ledgerDiagnosticsLines, planCells } from "../v3Equidad";
import { v3Names } from "../v3RunReport";
import type { V3FairnessPerson, V3SolveRequest, V3Success, V3TabFigures } from "../v3Wire";
import type { RunCadence } from "../v3People";
import { ledgerPerson, ledgerResponse } from "./v3Fixtures";

const tab = (seats: number, pinnedSeats: number, afterTenths: number, received = seats * 100): V3TabFigures => ({
  carried: 0, share: 0, received, pinned: pinnedSeats * 100, seats, pinned_seats: pinnedSeats, after: 0, tenths: { share: 0, after: afterTenths },
});
const ana: V3FairnessPerson = {
  person: "m-ana", floor: [],
  lines: { BGV: { ...tab(1, 0, 4), planned: 0, set_aside: 0, in_stage: true, clamped: false }, "P:r1": { ...tab(1, 1, -6), planned: 0, set_aside: 0, in_stage: true, clamped: false } },
  tabs: { DL: tab(2, 1, 3), BGV: tab(2, 1, -2, 300), TOTAL: tab(4, 1, 1) },
};
const response = { fairness: { scale: 100, tolerance: 35, lines: [], people: [ana] }, cadence: [{ person: "m-ana", month: "2026-12", state: "off", sundays: 0, saturdays: 1, met: true, compensation: "given" }] } as unknown as V3Success;
const request = {
  months: ["2026-11", "2026-12"],
  services: [
    { id: "s1", date: "2026-11-08", month: "2026-11", kind: "sunday", fixed: false, counts: true },
    { id: "s2", date: "2026-11-15", month: "2026-11", kind: "sunday", fixed: false, counts: true },
  ],
  people: [{ id: "m-ana", name: "Ana", exempt: true, eligibility: {}, carried: {}, dl_since: null, prev_dl_leads: 0 }],
  rules: [{ kind: "count", id: "c1", person: "m-ana", roles: ["Sun.Lead"], op: "==", month: "2026-11", value: 2 }],
} as unknown as V3SolveRequest;
const names = v3Names({ members: [{ _id: "m-ana", member_name: "Ana Ruiz", alias: "Ana" }], serviceLabels: new Map(), ruleLabels: new Map([["c1", "Ana · Sun.Lead == 2"]]) });
const cadence: RunCadence = new Map([["m-ana", [
  { month: "2026-11", state: "on", reason: "on", wire: "on" },
  { month: "2026-12", state: "off", reason: "assumed_led_previous_month", wire: "off" },
]]]);

describe("plan columns (EQ-3, EQ-5)", () => {
  const plan = buildEquidadPlan({ response, request, cadence, ledger: ledgerResponse(["2026-11", "2026-12"]), names, members: [{ _id: "m-ana", unavailableDates: ["2026-11-15"] }] });

  it("«En este plan» is the tab's integer `seats`, «Queda» its `tenths.after` in words — the folded BGV and Total included", () => {
    expect(planCells(plan, "m-ana", "DL")).toEqual({ enEstePlan: "2", queda: "le deben 0.3" });
    expect(planCells(plan, "m-ana", "BGV")).toEqual({ enEstePlan: "2", queda: "0.2 de más" });
    expect(planCells(plan, "m-ana", "TOTAL")).toEqual({ enEstePlan: "4", queda: "le deben 0.1" });
  });

  it("before any solve, or where the tab is absent (Total for an exempt person), the plan columns read «—»", () => {
    expect(planCells(null, "m-ana", "DL")).toEqual({ enEstePlan: "—", queda: "—" });
    expect(planCells(plan, "m-ana", "SL")).toEqual({ enEstePlan: "—", queda: "—" });
  });

  it("each row's reason line comes from codes; the DL cadence line is RQ-4's own state, one per month", () => {
    expect(plan.reason("m-ana", "DL")).toBe(
      "En nov le toca domingo (previsto). Mes por medio: no dirige domingo en diciembre. No disponible 15 nov: esas fechas no le cuentan. Su número lo fija «Ana · Sun.Lead == 2». Los pines tomaron 1 lugares.",
    );
    expect(plan.reason("m-ana", "SL")).toBe("Sábado de compensación en diciembre. No disponible 15 nov: esas fechas no le cuentan.");
    expect(plan.reason("m-ana", "TOTAL")).toContain("Exenta: fuera de Total y del mínimo de voz.");
  });
});

describe("the ledger's diagnostics (EQ-7)", () => {
  it("one line per diagnostic, none when clean", () => {
    expect(ledgerDiagnosticsLines(ledgerResponse(["2026-11"]).diagnostics)).toEqual([]);
    expect(ledgerDiagnosticsLines({ duplicateTargets: [{ type: "saturday_role", date: "2026-10-24", roleIds: ["a", "b"] }], notInRecordSeats: 2, unknownMembers: ["m-x"] })).toEqual([
      "Servicios duplicados en una fecha — no cuenta ninguno: sábado 24 oct",
      "Lugares de personas que no están en el registro de su mes — no cuentan: 2",
      "Miembros asignados sin ficha — no cuentan: 1",
    ]);
  });

  it("a ledger person's figures still render as emitted: «Tuvo» is Figures.seats, never received/100", () => {
    const p = ledgerPerson("m-ana", "Ana", { tabs: { window: { DL: { share: 250, received: 300, balance: -50, seats: 3, tenths: { share: 25, balance: -5 } } }, cumulative: {} } });
    expect(p.tabs.window.DL!.seats).toBe(3);
  });
});
