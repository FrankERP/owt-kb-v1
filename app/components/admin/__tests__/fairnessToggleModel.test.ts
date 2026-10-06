// Solver v3 C1 §6.0/§6.1 — the past-month rule and the effective values every
// surface and every request body go through. `todayIso` is passed explicitly, so
// each case sits on a known side of a month boundary.
import { describe, expect, it } from "vitest";

import {
  FAIRNESS_ENGINE_NOTE,
  FAIRNESS_LABEL,
  FAIRNESS_PAST_REASON,
  FAIRNESS_SPECIAL_HELP,
  applyCreateCountsEdits,
  effectiveColumnCounts,
  effectiveCreateCounts,
  effectiveStoredCounts,
  fairnessSwitchLabel,
  isFairnessColumnPast,
  isPastServiceMonth,
  isStoredColumnPast,
  withoutCountsEdit,
} from "../fairnessToggleModel";
import { buildColumns } from "../plannerModel";
import type { StoredGridColumn } from "../storedRoleReadModel";

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

describe("applyCreateCountsEdits (§6.1)", () => {
  const cols = buildColumns({
    sundayDates: ["2026-11-01"],
    activeSatDates: [],
    specials: [{ date: "2026-11-11", name: "Vigilia", countsForFairness: true }],
  });

  it("overlays the admin's edit by columnId and keeps every other field", () => {
    const out = applyCreateCountsEdits(cols, new Map([[cols[0].columnId, false]]), "2026-11-02");
    expect(out.map((c) => c.countsForFairness)).toEqual([false, true]);
    expect(out.map(({ countsForFairness: _counts, ...rest }) => rest)).toEqual(
      cols.map(({ countsForFairness: _counts, ...rest }) => rest),
    );
  });

  it("is idempotent over its own output", () => {
    const edits = new Map([[cols[0].columnId, false]]);
    const once = applyCreateCountsEdits(cols, edits, "2026-11-02");
    expect(applyCreateCountsEdits(once, edits, "2026-11-02")).toEqual(once);
  });

  it("in a past month every column takes its type default — the composer's choice and the edit do not apply", () => {
    const out = applyCreateCountsEdits(cols, new Map([[cols[0].columnId, false]]), "2026-12-01");
    expect(out.map((c) => c.countsForFairness)).toEqual([true, false]);
  });
});

describe("withoutCountsEdit (§6.1)", () => {
  it("drops one column's edit and keeps the others", () => {
    const edits = new Map([["a", false], ["b", true]]);
    expect([...withoutCountsEdit(edits, "a")]).toEqual([["b", true]]);
    expect([...edits]).toEqual([["a", false], ["b", true]]);
  });

  it("returns the same map when there is nothing to drop", () => {
    const edits = new Map([["a", false]]);
    expect(withoutCountsEdit(edits, "z")).toBe(edits);
  });
});

describe("stored columns (§6.0)", () => {
  // Stored counted on 2026-10-04; the admin has an edit holding it off.
  const held: StoredGridColumn = {
    columnId: "role-1",
    roleId: "role-1",
    rev: "rev-1",
    type: "sunday_role",
    date: "2026-10-04",
    published: false,
    admission: "approved",
    countsForFairness: false,
    storedFairness: { date: "2026-10-04", countsForFairness: true },
  };

  it("outside a past month the edit is the effective value", () => {
    expect(isStoredColumnPast(held, "2026-10-20")).toBe(false);
    expect(effectiveStoredCounts(held, "2026-10-20")).toBe(false);
    expect(effectiveColumnCounts(held, "2026-10-20")).toBe(false);
  });

  it("past by its stored date: the stored value wins", () => {
    expect(isStoredColumnPast(held, "2026-11-02")).toBe(true);
    expect(effectiveStoredCounts(held, "2026-11-02")).toBe(true);
    expect(isFairnessColumnPast(held, "2026-11-02")).toBe(true);
  });

  it("past by its EDITED date alone: the stored value still wins", () => {
    const movedBack: StoredGridColumn = { ...held, date: "2026-09-27" };
    expect(isStoredColumnPast(movedBack, "2026-10-20")).toBe(true);
    expect(effectiveStoredCounts(movedBack, "2026-10-20")).toBe(true);
  });

  it("a create column is past by its own date and shows the type default there", () => {
    const [sunday] = buildColumns({ sundayDates: ["2026-10-04"], activeSatDates: [] });
    const off = { ...sunday, countsForFairness: false };
    expect(isFairnessColumnPast(off, "2026-10-20")).toBe(false);
    expect(effectiveColumnCounts(off, "2026-10-20")).toBe(false);
    expect(isFairnessColumnPast(off, "2026-11-02")).toBe(true);
    expect(effectiveColumnCounts(off, "2026-11-02")).toBe(true);
  });
});
