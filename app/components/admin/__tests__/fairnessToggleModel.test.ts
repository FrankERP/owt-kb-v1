// Solver v3 C1 §6.0/§6.1 — the past-month rule and the effective values every
// surface and every request body go through. `todayIso` is passed explicitly, so
// each case sits on a known side of a month boundary.
import { describe, expect, it } from "vitest";

import {
  FAIRNESS_ENGINE_NOTE,
  FAIRNESS_LABEL,
  FAIRNESS_PAST_REASON,
  FAIRNESS_SPECIAL_HELP,
  effectiveCreateCounts,
  fairnessSwitchLabel,
  isPastServiceMonth,
} from "../fairnessToggleModel";

describe("the copy (solver v3 C1 §9 «Copy»)", () => {
  it("is exactly the spec's", () => {
    expect(FAIRNESS_LABEL).toBe("Cuenta para equidad");
    expect(FAIRNESS_ENGINE_NOTE).toBe("Cuenta para equidad: aplica con el nuevo solver. Hoy Auto no lo usa.");
    expect(FAIRNESS_PAST_REASON).toBe("Mes pasado: ya no se cambia.");
    expect(FAIRNESS_SPECIAL_HELP).toBe(
      "Si cuenta, su Lead suma como Dom Lead en domingo y como Sáb Lead en otro día; BGV y Coro suman igual.",
    );
  });
});

describe("isPastServiceMonth (§6.0)", () => {
  it("is false for the current month and later, true for any earlier month", () => {
    expect(isPastServiceMonth("2026-10-01", "2026-10-31")).toBe(false);
    expect(isPastServiceMonth("2026-11-15", "2026-10-31")).toBe(false);
    expect(isPastServiceMonth("2026-09-30", "2026-10-01")).toBe(true);
    expect(isPastServiceMonth("2025-12-31", "2026-01-01")).toBe(true);
  });

  it("flips at the month boundary for the same date", () => {
    expect(isPastServiceMonth("2026-10-25", "2026-10-31")).toBe(false);
    expect(isPastServiceMonth("2026-10-25", "2026-11-01")).toBe(true);
  });

  it("accepts a datetime prefix and answers false for a malformed date", () => {
    expect(isPastServiceMonth("2026-09-06T12:00:00Z", "2026-10-01")).toBe(true);
    expect(isPastServiceMonth("", "2026-10-01")).toBe(false);
    expect(isPastServiceMonth("nope", "2026-10-01")).toBe(false);
  });
});

describe("effectiveCreateCounts (§6.0, §6.1)", () => {
  it("is the admin's choice outside a past month", () => {
    expect(effectiveCreateCounts("sunday_role", "2026-11-01", false, "2026-10-31")).toBe(false);
    expect(effectiveCreateCounts("special_role", "2026-11-11", true, "2026-10-31")).toBe(true);
  });

  it("is the type default in a past month, whatever was chosen", () => {
    expect(effectiveCreateCounts("sunday_role", "2026-09-06", false, "2026-10-01")).toBe(true);
    expect(effectiveCreateCounts("saturday_role", "2026-09-05", false, "2026-10-01")).toBe(true);
    expect(effectiveCreateCounts("special_role", "2026-09-09", true, "2026-10-01")).toBe(false);
  });
});

describe("fairnessSwitchLabel", () => {
  it("names the column by date, and by date and name for a special", () => {
    expect(fairnessSwitchLabel({ date: "2026-11-01" })).toBe("Cuenta para equidad 2026-11-01");
    expect(fairnessSwitchLabel({ date: "2026-11-11", serviceName: "Vigilia" })).toBe(
      "Cuenta para equidad 2026-11-11 · Vigilia",
    );
  });
});
