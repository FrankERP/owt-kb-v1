// Pure read model for the private lead ↔ admin thread (Release 2 §8).

import { describe, expect, it } from "vitest";
import { isThreadOpen, orderedMessages } from "@/app/utils/proposalThread";

const msg = (key: string, at: string | null) => ({ _key: key, at });

describe("orderedMessages", () => {
  it("returns messages oldest first", () => {
    expect(
      orderedMessages([
        msg("b", "2026-08-24T12:00:00.000Z"),
        msg("a", "2026-08-23T09:00:00.000Z"),
        msg("c", "2026-08-24T18:30:00.000Z"),
      ]).map((m) => m._key),
    ).toEqual(["a", "b", "c"]);
  });

  it("keeps an already-append-only array exactly as stored", () => {
    const stored = [msg("a", "2026-08-23T09:00:00.000Z"), msg("b", "2026-08-24T12:00:00.000Z")];
    expect(orderedMessages(stored)).toEqual(stored);
  });

  it("compares INSTANTS, so an offset timestamp is not ordered lexicographically", () => {
    // 2026-08-24T10:00:00-06:00 is 16:00Z — AFTER 11:00Z, though it sorts
    // before it as a string.
    expect(
      orderedMessages([
        msg("offset", "2026-08-24T10:00:00-06:00"),
        msg("utc", "2026-08-24T11:00:00.000Z"),
      ]).map((m) => m._key),
    ).toEqual(["utc", "offset"]);
  });

  it("is stable — equal timestamps keep their stored order", () => {
    expect(
      orderedMessages([
        msg("first", "2026-08-24T12:00:00.000Z"),
        msg("second", "2026-08-24T12:00:00.000Z"),
      ]).map((m) => m._key),
    ).toEqual(["first", "second"]);
  });

  it("never relocates or drops a message with an unusable timestamp", () => {
    expect(
      orderedMessages([
        msg("a", "2026-08-24T12:00:00.000Z"),
        msg("broken", "no soy una fecha"),
        msg("missing", null),
        msg("b", "2026-08-23T09:00:00.000Z"),
      ]).map((m) => m._key),
    ).toEqual(["a", "broken", "missing", "b"]);
  });

  it("tolerates an absent array and drops non-object entries", () => {
    expect(orderedMessages(undefined)).toEqual([]);
    expect(orderedMessages(null)).toEqual([]);
    expect(orderedMessages([])).toEqual([]);
    const withJunk = [null, msg("a", "2026-08-24T12:00:00.000Z")] as ReturnType<typeof msg>[];
    expect(orderedMessages(withJunk).map((m) => m._key)).toEqual(["a"]);
  });
});

describe("isThreadOpen", () => {
  const today = "2026-08-24";

  it("stays open on the DAY of the service", () => {
    expect(isThreadOpen({ serviceDate: "2026-08-24", today })).toBe(true);
  });

  it("stays open for a future service", () => {
    expect(isThreadOpen({ serviceDate: "2026-08-30", today })).toBe(true);
  });

  it("closes the day after the service", () => {
    expect(isThreadOpen({ serviceDate: "2026-08-23", today })).toBe(false);
  });

  it("is the exact negation of the outbox `isPast` rule (serviceDate < today)", () => {
    const isPast = (serviceDate: string, day: string) => serviceDate < day;
    for (const serviceDate of ["2026-08-22", "2026-08-23", "2026-08-24", "2026-08-25"]) {
      expect(isThreadOpen({ serviceDate, today })).toBe(!isPast(serviceDate, today));
    }
  });

  it("derives today as a CALENDAR day in America/Mexico_City, not in UTC", () => {
    // 04:30Z on the 25th is still 22:30 on the 24th in Mexico City, so a
    // service dated the 24th is TODAY and the thread is open. A bare UTC
    // reading would have closed it six hours early.
    const lateEvening = new Date("2026-08-25T04:30:00Z");
    expect(isThreadOpen({ serviceDate: "2026-08-24", today: localDay(lateEvening) })).toBe(true);
    // 06:30Z is 00:30 on the 25th locally — now the 24th is past.
    const afterMidnight = new Date("2026-08-25T06:30:00Z");
    expect(isThreadOpen({ serviceDate: "2026-08-24", today: localDay(afterMidnight) })).toBe(false);
  });

  it("accepts a legacy datetime-shaped service date by its calendar day", () => {
    expect(isThreadOpen({ serviceDate: "2026-08-24T00:00:00Z", today })).toBe(true);
    expect(isThreadOpen({ serviceDate: "2026-08-23T23:59:59Z", today })).toBe(false);
  });

  it.each([
    ["a missing service date", undefined],
    ["a non-string service date", 20260824],
    ["a malformed service date", "24/08/2026"],
    ["an impossible calendar day", "2026-02-30"],
  ])("fails CLOSED on %s — this predicate authorizes a write", (_label, serviceDate) => {
    expect(isThreadOpen({ serviceDate, today })).toBe(false);
  });

  it("fails closed on an unusable `today` rather than comparing against garbage", () => {
    expect(isThreadOpen({ serviceDate: "2026-08-30", today: "hoy" })).toBe(false);
  });

  it("falls back to the real clock when no `today` is supplied", () => {
    // The suite pins TZ to America/Mexico_City (vitest.config.ts), so this is
    // the same calendar day `serviceTodayIso()` reports.
    expect(isThreadOpen({ serviceDate: localDay(new Date()) })).toBe(true);
    expect(isThreadOpen({ serviceDate: "2000-01-01" })).toBe(false);
  });
});

/** "Today" the way the app defines it, for the fixtures above. */
function localDay(at: Date): string {
  return at.toLocaleDateString("sv", { timeZone: "America/Mexico_City" });
}
