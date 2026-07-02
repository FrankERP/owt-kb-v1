import { describe, it, expect } from "vitest";
import { daysUntil } from "../NextServiceHero";

describe("daysUntil", () => {
  // Fixed reference "now" (local time) so the test is deterministic.
  const now = new Date(2026, 6, 1, 9, 0, 0); // 2026-07-01 09:00 local

  it("returns 0 for a service on the same day (regardless of time of day)", () => {
    expect(daysUntil("2026-07-01", now)).toBe(0);
    expect(daysUntil("2026-07-01", new Date(2026, 6, 1, 23, 30))).toBe(0);
  });

  it("returns 1 for the next day", () => {
    expect(daysUntil("2026-07-02", now)).toBe(1);
  });

  it("counts multiple days ahead", () => {
    expect(daysUntil("2026-07-03", now)).toBe(2);
    expect(daysUntil("2026-07-05", now)).toBe(4);
  });

  it("is negative for past dates", () => {
    expect(daysUntil("2026-06-30", now)).toBe(-1);
  });

  it("ignores any time component in the date string", () => {
    expect(daysUntil("2026-07-02T00:00:00Z", now)).toBe(1);
  });
});
