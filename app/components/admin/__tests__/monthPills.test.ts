import { describe, expect, it } from "vitest";
import { addMonths, upcomingMonthPills } from "../monthPills";

describe("addMonths", () => {
  it("shifts across year boundaries", () => {
    expect(addMonths("2026-09", 1)).toBe("2026-10");
    expect(addMonths("2026-11", 2)).toBe("2027-01");
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", 0)).toBe("2026-01");
  });
});

describe("upcomingMonthPills", () => {
  it("always offers the current month and the next two, plus every later month with services", () => {
    expect(upcomingMonthPills(["2026-08", "2026-09", "2027-02"], "2026-09")).toEqual([
      "2026-09", "2026-10", "2026-11", "2027-02",
    ]);
  });
  it("never offers a past month and never duplicates", () => {
    expect(upcomingMonthPills(["2026-07", "2026-10", "2026-10"], "2026-09")).toEqual(["2026-09", "2026-10", "2026-11"]);
  });
  it("offers the window even when no month has services", () => {
    expect(upcomingMonthPills([], "2026-12")).toEqual(["2026-12", "2027-01", "2027-02"]);
  });
});
