import { describe, expect, it } from "vitest";
import { compareServiceTime, isServiceTime } from "@/app/utils/serviceTime";

describe("isServiceTime", () => {
  it("accepts zero-padded 24-hour HH:mm", () => {
    for (const v of ["00:00", "09:00", "12:30", "18:45", "23:59"]) expect(isServiceTime(v)).toBe(true);
  });
  it("rejects everything that is not exactly HH:mm", () => {
    for (const v of ["9:00", "24:00", "18:60", "18:45:00", " 18:45", "", null, undefined, 1845, "18h45"]) {
      expect(isServiceTime(v)).toBe(false);
    }
  });
});

describe("compareServiceTime", () => {
  it("orders by clock time and puts an absent time last", () => {
    const sorted = ["18:30", undefined, "09:00", null, "12:30"].sort(compareServiceTime);
    // Array.prototype.sort moves undefined to the end itself; the comparator only orders null.
    expect(sorted).toEqual(["09:00", "12:30", "18:30", null, undefined]);
  });
  it("is 0 for equal inputs, including two absent ones", () => {
    expect(compareServiceTime("09:00", "09:00")).toBe(0);
    expect(compareServiceTime(null, undefined)).toBe(0);
  });
  it("puts an absent value after any time", () => {
    expect(compareServiceTime(undefined, "23:59")).toBe(1);
    expect(compareServiceTime("00:00", null)).toBe(-1);
    // A defined but malformed string is not a time, so it sorts as absent.
    expect(compareServiceTime("9:00", "23:59")).toBe(1);
  });
});
