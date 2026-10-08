// Solver v3 C6 NT-1, NT-2 — the run line, the stage summary (and «Ver etapas»'s detail), and every
// missed protection, notice, no-lead service and rule break, from codes only.
import { describe, expect, it } from "vitest";

import { buildV3RunReport, v3Names } from "../v3RunReport";
import type { V3SolveRequest, V3Stage, V3Success } from "../v3Wire";

const stage = (id: string, status: V3Stage["status"], reason?: V3Stage["reason"]): V3Stage =>
  ({ id, status, ...(reason ? { reason } : {}), value: 0, bound: 0, limit: "none", ms: 1, det_milli: 1 });
const names = v3Names({
  members: [{ _id: "m-ana", member_name: "Ana Ruiz", alias: "Ana" }],
  serviceLabels: new Map([["sun-1", "domingo 1 nov"]]),
  ruleLabels: new Map([["c1", "Ana · Sun.Lead <= 1"]]),
});
const request = { months: ["2026-11", "2026-12"], services: new Array(9).fill({}) } as unknown as V3SolveRequest;
const response = (over: Partial<V3Success>): V3Success => ({
  ok: true, contract: 3, engine: "v3", solver_version: "3", build: "b", request_id: "r", seed: 1, months: ["2026-11", "2026-12"],
  reproducible: false, assignments: {}, unfilled: [], pins: { requested: 0, honored: 0 }, violations: [], violation_ceiling: { value: 0, proven: true },
  stages: [], total_ms: 1, fairness: { scale: 100, tolerance: 35, lines: [], people: [] }, cadence: [], missed: [], notices: [], ...over,
});

describe("NT-1 — the run line and the stage summary", () => {
  it("names the months and counts the stored services", () => {
    const report = buildV3RunReport({ response: response({ stages: [stage("rules", "proven")] }), request, storedServiceIds: new Set(["a", "b"]), names });
    expect(report.runLine).toBe("Plan de 2 meses: noviembre y diciembre · 9 servicios (2 guardados, se respetan tal cual).");
    expect(report.stageSummary).toEqual(["Todas las etapas quedaron probadas."]);
  });

  it("one line per stage not proven, then each explanation", () => {
    const stages = [stage("rules", "proven"), stage("balance_max:DL", "unproven"), stage("tiebreak", "not_run", "budget")];
    const report = buildV3RunReport({ response: response({ stages }), request, storedServiceIds: new Set(), names });
    expect(report.stageSummary).toEqual([
      "Equidad Dom Lead: el más pendiente: no probado",
      "Desempate: no ejecutado",
      "\"No probado\": el plan es válido, pero el solver no alcanzó a comprobar que fuera el mejor en esa etapa.",
      "Se acabó el tiempo antes de empezarla.",
      "Las etapas no ejecutadas conservan el plan de la etapa anterior. Revísalo antes de crear.",
    ]);
    expect(report.stageDetail).toEqual([
      { label: "Reglas", status: "probado" },
      { label: "Equidad Dom Lead: el más pendiente", status: "no probado" },
      { label: "Desempate", status: "no ejecutado" },
    ]);
  });
});

describe("NT-2 — the solver's own lines", () => {
  it("missed protections, notices, no-lead services and rule breaks, with the ceiling caveat when unproven", () => {
    const report = buildV3RunReport({
      response: response({
        missed: [{ code: "voice_floor_missed", person: "m-ana", month: "2026-11", cause: "capacity" }],
        notices: [{ code: "dl_capacity", params: { months: ["2026-11", "2026-12"], seats: 7, people: 9 } }],
        unfilled: [{ service: "sun-1", role: "Lead", count: 1, reason: "no_possible_lead" }],
        violations: [{ code: "count", rule: "c1", cause: "pins", person: "m-ana", month: "2026-11", observed: 2, limit: 1 }],
        violation_ceiling: { value: 1, proven: false },
      }),
      request, storedServiceIds: new Set(), names,
    });
    expect(report.solverNotices).toEqual([
      "Ana no canta en ningún servicio de noviembre — no alcanzan los lugares (ver aviso de capacidad).",
      "Capacidad de Dom Lead en noviembre y diciembre: 7 domingos para 9 personas. No alcanza para que todas dirijan al menos un domingo cada dos meses.",
      "Nadie puede dirigir el domingo 1 nov: quedó sin líder.",
      "No se cumplió «Ana · Sun.Lead <= 1» en noviembre: quedó en 2 (pide 1) — por lo que ya estaba puesto.",
      "Puede que el solver haya cedido más reglas de las necesarias: no alcanzó a comprobarlo.",
    ]);
  });

  it("an unknown code still renders a line", () => {
    const report = buildV3RunReport({ response: response({ notices: [{ code: "brand_new", params: {} }] }), request, storedServiceIds: new Set(), names });
    expect(report.solverNotices).toEqual(["El solver informó algo que el planificador no reconoce (brand_new)."]);
  });
});
