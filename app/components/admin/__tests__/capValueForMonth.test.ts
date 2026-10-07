// Solver v3 C2 RES-3 / IF2-17 — `capValueForMonth`, the ONE per-month count resolution:
// `resolvedCapValue` over every Sunday of the calendar month, as a typed result that is
// never rounded, truncated or clamped beyond `resolvedCapValue`'s own `max(0, ·)`.
import { describe, expect, it } from "vitest";

import type { RestrictionCap } from "../plannerModel";
import { capValueForMonth } from "../serviceRuleContext";

const cap = (patch: Partial<RestrictionCap>): RestrictionCap => ({
  id: "c1", pattern: "Sun.Lead", op: "==", value: 2, relative: false, relOffset: 0, ...patch,
});

// November 2026 has 5 Sundays (1, 8, 15, 22, 29); October 2026 has 4 (4, 11, 18, 25).
describe("capValueForMonth (C2 IF2-17)", () => {
  it("answers a fixed whole value as it is", () => {
    expect(capValueForMonth(cap({ value: 2 }), "2026-11")).toEqual({ ok: true, count: 2 });
    expect(capValueForMonth(cap({ value: 0 }), "2026-11")).toEqual({ ok: true, count: 0 });
  });

  it("resolves a relative cap against the month's full Sunday count", () => {
    expect(capValueForMonth(cap({ relative: true, relOffset: 2 }), "2026-11")).toEqual({ ok: true, count: 3 });
    expect(capValueForMonth(cap({ relative: true, relOffset: 2 }), "2026-10")).toEqual({ ok: true, count: 2 });
  });

  it("answers 0 for a relative cap clamped by resolvedCapValue, fractional offset included", () => {
    expect(capValueForMonth(cap({ relative: true, relOffset: 6 }), "2026-10")).toEqual({ ok: true, count: 0 });
    expect(capValueForMonth(cap({ relative: true, relOffset: 4.5 }), "2026-10")).toEqual({ ok: true, count: 0 });
  });

  it("refuses a fractional or non-finite result as not_whole, never rounded", () => {
    expect(capValueForMonth(cap({ value: 1.5 }), "2026-11")).toEqual({ ok: false, reason: "not_whole" });
    expect(capValueForMonth(cap({ relative: true, relOffset: 0.5 }), "2026-11")).toEqual({ ok: false, reason: "not_whole" });
    expect(capValueForMonth(cap({ value: Number.NaN }), "2026-11")).toEqual({ ok: false, reason: "not_whole" });
    expect(capValueForMonth(cap({ value: Number.POSITIVE_INFINITY }), "2026-11")).toEqual({ ok: false, reason: "not_whole" });
    expect(capValueForMonth(cap({ value: Number.NEGATIVE_INFINITY }), "2026-11")).toEqual({ ok: false, reason: "not_whole" });
  });

  it("refuses a fixed negative whole value as negative", () => {
    expect(capValueForMonth(cap({ value: -1 }), "2026-11")).toEqual({ ok: false, reason: "negative" });
  });

  it("has no upper bound of its own (RES-3 adds 31 for == caps)", () => {
    expect(capValueForMonth(cap({ value: 32 }), "2026-11")).toEqual({ ok: true, count: 32 });
  });
});
