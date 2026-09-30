// app/components/admin/__tests__/pinViolations.test.ts
import { describe, expect, it } from "vitest";

import type { RankMember } from "../candidateRanking";
import type { SolverConfig } from "../plannerModel";
import type { Pin } from "../pinModel";
import { parsePinViolation, pinViolationNotices } from "../pinViolations";

const SUNDAYS = ["2026-10-04", "2026-10-11", "2026-10-18", "2026-10-25"];
const members = [
  { _id: "andy", member_name: "Andrea Solís", alias: "Andy", memberType: ["voz", "support"] },
  { _id: "tay", member_name: "Taylor Ríos", alias: "Tay", memberType: ["voz", "support"] },
  { _id: "vale", member_name: "Valeria Paz", alias: "Vale", memberType: ["voz", "support"] },
] as RankMember[];
const config: SolverConfig = {
  sundayLeads: [], saturdayLeads: [], support: ["andy", "tay", "vale"],
  restrictions: [{
    id: "r", person: "Andy", excludedPatterns: ["Sun.BGV"], fairness: "none", fairnessSlack: 0, weekExclusions: [],
    caps: [
      { id: "c1", pattern: "Sun.*", op: "==", value: 1, relative: false, relOffset: 2 },
      { id: "c2", pattern: "Sat.BGV", op: ">=", value: 0, relative: true, relOffset: 2 },
    ],
  }],
  conflicts: [{ id: "k", personA: "Andy", personB: "Tay", pattern: "*.*" }],
  presence: [{ id: "p", persons: ["Tay", "Vale"], pattern: "Sun.BGV" }],
};
const pin = (week: number, role: Pin["role"], person: string): Pin => ({ week, role, person });
const notices = (violations: string[], pins: Pin[], ceilingProven: boolean | undefined = true) =>
  pinViolationNotices({ violations, ceilingProven, config, members, pins, sundayDates: SUNDAYS });

describe("parsePinViolation", () => {
  it("reads the six forms and nothing else", () => {
    expect(parsePinViolation("builtin:mandatory_lead:W2:Sun")).toEqual({ kind: "mandatoryLead", week: 2, service: "Sun" });
    expect(parsePinViolation("builtin:sat_anchor:W3")).toEqual({ kind: "satAnchor", week: 3 });
    expect(parsePinViolation("W1-2 Andrea Solís: Andrea Solís !consecutive on *.Lead"))
      .toEqual({ kind: "consecutive", week: 1, person: "Andrea Solís", source: "Andrea Solís !consecutive on *.Lead" });
    expect(parsePinViolation("W2 Sat: Andrea Solís !with Taylor Ríos on *.*"))
      .toEqual({ kind: "pair", week: 2, service: "Sat", source: "Andrea Solís !with Taylor Ríos on *.*" });
    expect(parsePinViolation("W4: any_of(Taylor Ríos,Valeria Paz) on Sun.BGV each_week"))
      .toEqual({ kind: "presence", week: 4, source: "any_of(Taylor Ríos,Valeria Paz) on Sun.BGV each_week" });
    expect(parsePinViolation("Andrea Solís: Sun.* == 1")).toEqual({ kind: "count", person: "Andrea Solís", source: "Sun.* == 1" });
    expect(parsePinViolation("builtin:something_new:W1")).toBeNull();
    expect(parsePinViolation("W1-3 Andrea Solís: x")).toBeNull();
    expect(parsePinViolation("no separator")).toBeNull();
  });
});

describe("pinViolationNotices", () => {
  it("names a count rule as the rules card does, whether or not its clause carries the person's name", () => {
    expect(notices(["Andrea Solís: Andrea Solís !in Sun.BGV & Sun.* == 1"], [])).toEqual([
      "El solver dejó de cumplir una regla para acomodar lo que ya estaba puesto (Andrea Solís: Andrea Solís !in Sun.BGV & Sun.* == 1).",
    ]); // not a count clause the config can produce — generic
    expect(notices(["Andrea Solís: Andrea Solís Sun.* == 1"], [pin(1, "Sun.Lead", "Andrea Solís")])).toEqual([
      "No se cumplió «Sun.* == 1» de Andy — por lo que ya estaba puesto.",
    ]);
    // A relative cap arrives resolved: {weeks-2} is 2 in a four-Sunday month; the card says sem−2.
    expect(notices(["Andrea Solís: Sat.BGV >= 2"], [pin(1, "Sun.Lead", "Andrea Solís")])).toEqual([
      "No se cumplió «Sat.BGV >= sem−2» de Andy — lo cedió el solver para acomodar lo que ya estaba puesto.",
    ]);
  });

  it("names a pair rule with its service and date, and judges it caused by a pin of either person that week", () => {
    expect(notices(["W2 Sat: Andrea Solís !with Taylor Ríos on *.*"], [pin(2, "Sat.BGV", "Taylor Ríos")])).toEqual([
      "No se cumplió «Andy ≠ Tay en *.*» (sábado 10 oct) — por lo que ya estaba puesto.",
    ]);
  });

  it("names a presence rule with its week", () => {
    expect(notices(["W4: any_of(Taylor Ríos,Valeria Paz) on Sun.BGV each_week"], [])).toEqual([
      "No se cumplió «Tay, Vale en Sun.BGV c/sem» (semana 4) — lo cedió el solver para acomodar lo que ya estaba puesto.",
    ]);
  });

  it("words the builtins by service and date", () => {
    expect(notices(["builtin:mandatory_lead:W2:Sun", "builtin:sat_anchor:W3"], [])).toEqual([
      "El domingo 11 oct quedó sin líder — lo cedió el solver para acomodar lo que ya estaba puesto.",
      "El sábado 17 oct quedó sin líder de sábado — lo cedió el solver para acomodar lo que ya estaba puesto.",
    ]);
  });

  it("renders a consecutive entry, which no planner rule produces, as the generic line and never «dos semanas seguidas»", () => {
    const [line] = notices(["W4-5 Andrea Solís: Andrea Solís !consecutive on Sat.*"], []);
    expect(line).toBe(
      "El solver dejó de cumplir una regla para acomodar lo que ya estaba puesto (W4-5 Andrea Solís: Andrea Solís !consecutive on Sat.*).",
    );
    expect(line).not.toContain("seguidas");
  });

  it("adds one caveat line when the ceiling was not proven, and none when there is nothing to report", () => {
    expect(notices([], [], false)).toEqual([
      "Puede que el solver haya cedido más reglas de las necesarias: no alcanzó a comprobarlo.",
    ]);
    expect(notices([], [], true)).toEqual([]);
    expect(notices([], [], undefined)).toEqual([]);
  });
});
