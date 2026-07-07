import { describe, it, expect } from "vitest";
import {
  parseMonthParam,
  addMonths,
  monthBounds,
  monthLabel,
  monthRangeLabel,
  scheduleHref,
  windowBounds,
  windowMonths,
  WINDOW_MONTHS,
} from "@/app/utils/scheduleMonths";

describe("parseMonthParam", () => {
  it("accepts a well-formed month", () => {
    expect(parseMonthParam("2026-07")).toBe("2026-07");
    expect(parseMonthParam("2026-01")).toBe("2026-01");
    expect(parseMonthParam("2026-12")).toBe("2026-12");
  });
  it("rejects out-of-range and malformed input", () => {
    expect(parseMonthParam("2026-13")).toBeNull();
    expect(parseMonthParam("2026-00")).toBeNull();
    expect(parseMonthParam("2026-7")).toBeNull(); // needs 2-digit month
    expect(parseMonthParam("26-07")).toBeNull();
    expect(parseMonthParam("garbage")).toBeNull();
    expect(parseMonthParam("")).toBeNull();
    expect(parseMonthParam(undefined)).toBeNull();
    expect(parseMonthParam(null)).toBeNull();
  });
  it("rejects implausible years and accepts the bound edges", () => {
    expect(parseMonthParam("1999-05")).toBeNull();
    expect(parseMonthParam("2101-05")).toBeNull();
    expect(parseMonthParam("0000-05")).toBeNull();
    expect(parseMonthParam("2000-01")).toBe("2000-01");
    expect(parseMonthParam("2100-12")).toBe("2100-12");
  });
});

describe("addMonths", () => {
  it("crosses year boundaries in both directions", () => {
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2026-07", 0)).toBe("2026-07");
    expect(addMonths("2026-07", -13)).toBe("2025-06");
    expect(addMonths("2026-06", 8)).toBe("2027-02");
  });
});

describe("monthBounds", () => {
  it("returns first and last day, handling month lengths and leap years", () => {
    expect(monthBounds("2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(monthBounds("2024-02")).toEqual({ from: "2024-02-01", to: "2024-02-29" });
    expect(monthBounds("2026-04")).toEqual({ from: "2026-04-01", to: "2026-04-30" });
    expect(monthBounds("2026-01")).toEqual({ from: "2026-01-01", to: "2026-01-31" });
    expect(monthBounds("2026-12")).toEqual({ from: "2026-12-01", to: "2026-12-31" });
  });
});

describe("monthLabel", () => {
  it("renders a title-case Spanish label", () => {
    expect(monthLabel("2026-07")).toBe("Julio 2026");
    expect(monthLabel("2026-01")).toBe("Enero 2026");
    expect(monthLabel("2025-12")).toBe("Diciembre 2025");
  });
});

describe("scheduleHref", () => {
  it("builds browse and default targets", () => {
    expect(scheduleHref("2026-07")).toBe("/schedule?m=2026-07");
    expect(scheduleHref(null)).toBe("/schedule");
  });
});

describe("WINDOW_MONTHS", () => {
  it("is a 3-month window", () => {
    expect(WINDOW_MONTHS).toBe(3);
  });
});

describe("windowMonths", () => {
  it("lists count consecutive months from the anchor, crossing years", () => {
    expect(windowMonths("2026-07", 3)).toEqual(["2026-07", "2026-08", "2026-09"]);
    expect(windowMonths("2026-11", 3)).toEqual(["2026-11", "2026-12", "2027-01"]);
    expect(windowMonths("2026-07", 1)).toEqual(["2026-07"]);
  });
});

describe("windowBounds", () => {
  it("spans from the anchor's first day to the last day of the final month", () => {
    expect(windowBounds("2026-07", 3)).toEqual({ from: "2026-07-01", to: "2026-09-30" });
    expect(windowBounds("2026-11", 3)).toEqual({ from: "2026-11-01", to: "2027-01-31" });
    expect(windowBounds("2026-12", 3)).toEqual({ from: "2026-12-01", to: "2027-02-28" });
  });
});

describe("monthRangeLabel", () => {
  it("collapses a single month, shares the year within one, and spans years", () => {
    expect(monthRangeLabel("2026-07", 1)).toBe("Julio 2026");
    expect(monthRangeLabel("2026-07", 3)).toBe("Julio – Septiembre 2026");
    expect(monthRangeLabel("2026-11", 3)).toBe("Noviembre 2026 – Enero 2027");
  });
});
