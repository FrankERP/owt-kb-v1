// Solver v3 C6 HZ-2, HZ-3, HZ-7, HZ-9 — the horizon's months, which month owns a date, and the two
// refusals Auto (and the confirm) apply before any read. Pure; the clock is an input.
import { describe, expect, it } from "vitest";

import {
  HORIZON_MONTHS_AHEAD, cdmxCurrentMonth, cdmxTodayIso, horizonMonths, horizonRefusal, monthOfDate,
  monthsEntering, retainInHorizon, weekendDatesOfMonth,
} from "../v3Horizon";

describe("horizonMonths (HZ-2)", () => {
  it("is the first month, or the first two consecutive months — across a year end too", () => {
    expect(horizonMonths("2026-11", 1)).toEqual(["2026-11"]);
    expect(horizonMonths("2026-12", 2)).toEqual(["2026-12", "2027-01"]);
  });
});

describe("date ownership (HZ-3)", () => {
  it("a date belongs to its own calendar month, by string", () => {
    expect(monthOfDate("2026-10-31")).toBe("2026-10");
  });

  it("Oct+Nov 2026 offers Saturday 31 Oct once, under October", () => {
    const oct = weekendDatesOfMonth("2026-10");
    const nov = weekendDatesOfMonth("2026-11");
    expect(oct.saturdays).toContain("2026-10-31");
    expect(nov.saturdays).not.toContain("2026-10-31");
    expect([...oct.saturdays, ...nov.saturdays].filter((d) => d === "2026-10-31")).toHaveLength(1);
    expect(nov.sundays).toEqual(["2026-11-01", "2026-11-08", "2026-11-15", "2026-11-22", "2026-11-29"]);
  });

  it("February of a leap year has its 29th", () => {
    expect(weekendDatesOfMonth("2032-02").sundays).toContain("2032-02-29");
  });
});

describe("the CDMX clock", () => {
  it("reads today in America/Mexico_City, not UTC", () => {
    // 2026-11-01T03:00Z is still 31 Oct in CDMX (UTC−6).
    const now = new Date("2026-11-01T03:00:00.000Z");
    expect(cdmxTodayIso(now)).toBe("2026-10-31");
    expect(cdmxCurrentMonth(now)).toBe("2026-10");
  });
});

describe("horizonRefusal (HZ-7 past, HZ-9 ceiling)", () => {
  it("admits the current month and current + 12", () => {
    expect(HORIZON_MONTHS_AHEAD).toBe(12);
    expect(horizonRefusal(["2026-10"], "2026-10")).toBeNull();
    expect(horizonRefusal(["2027-10"], "2026-10")).toBeNull();
  });

  it("refuses a month before the current one", () => {
    expect(horizonRefusal(["2026-09", "2026-10"], "2026-10")).toEqual({ kind: "past", month: "2026-09" });
  });

  it("refuses current + 13, naming the month and the limit", () => {
    expect(horizonRefusal(["2027-11"], "2026-10")).toEqual({ kind: "ceiling", month: "2027-11", limit: "2027-10" });
  });

  it("refuses a 2-month horizon whose SECOND month alone crosses", () => {
    expect(horizonRefusal(horizonMonths("2027-10", 2), "2026-10")).toEqual({ kind: "ceiling", month: "2027-11", limit: "2027-10" });
  });
});

describe("selections across a horizon change (HZ-2)", () => {
  it("keeps only dates of months still in the horizon", () => {
    const sats = ["2026-11-07", "2026-12-05", "2027-01-02"];
    expect(retainInHorizon(sats, ["2026-12", "2027-01"])).toEqual(["2026-12-05", "2027-01-02"]);
    const specials = [{ date: "2026-11-12", name: "Bautizos" }, { date: "2026-12-10", name: "Posada" }];
    expect(retainInHorizon(specials, ["2026-12"])).toEqual([{ date: "2026-12-10", name: "Posada" }]);
  });

  it("names the months that enter (their Saturdays start selected, as a month change does today)", () => {
    expect(monthsEntering(["2026-11", "2026-12"], ["2026-12", "2027-01"])).toEqual(["2027-01"]);
    expect(monthsEntering(["2026-11"], ["2026-11", "2026-12"])).toEqual(["2026-12"]);
    expect(monthsEntering(["2026-11", "2026-12"], ["2026-11"])).toEqual([]);
  });
});
