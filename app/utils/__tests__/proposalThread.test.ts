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
    // `b` is the OLDER of the two datable messages, so oldest-first must put it
    // first. An earlier version of this test asserted ["a","broken","missing","b"]
    // — it had been read off the buggy output rather than derived from the
    // contract, and it went green on exactly the 4-element shape where the bad
    // comparator happened to return the identity.
    expect(
      orderedMessages([
        msg("a", "2026-08-24T12:00:00.000Z"),
        msg("broken", "no soy una fecha"),
        msg("missing", null),
        msg("b", "2026-08-23T09:00:00.000Z"),
      ]).map((m) => m._key),
    ).toEqual(["b", "broken", "missing", "a"]);
  });

  it("keeps the datable messages in order when broken ones are interleaved", () => {
    // The property the 4-element case is too small to see: with a NaN in the
    // array, the old comparator was intransitive and V8 scrambled the VALID
    // entries — a thread came back newest-first. Sizes above ~10 change sort
    // strategy, so this fixture is deliberately larger than the one above.
    const input = [];
    for (let i = 0; i < 12; i += 1) {
      // Descending timestamps: every one is out of order on input.
      input.push(msg(`v${i}`, `2026-08-${String(24 - i).padStart(2, "0")}T12:00:00.000Z`));
      if (i % 4 === 0) input.push(msg(`x${i}`, "no soy una fecha"));
    }
    const out = orderedMessages(input).map((m) => m._key);
    const datable = out.filter((k) => k.startsWith("v"));
    expect(datable).toEqual(["v11", "v10", "v9", "v8", "v7", "v6", "v5", "v4", "v3", "v2", "v1", "v0"]);
    // …and every broken message is still exactly where it was stored.
    input.forEach((m, i) => {
      if (m._key.startsWith("x")) expect(out[i]).toBe(m._key);
    });
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

  it("agrees with the outbox `isPast` rule on every YYYY-MM-DD date", () => {
    // Scoped to date-shaped input on purpose: the two predicates part company on
    // an UNUSABLE date, where this one fails closed and `isPast` reports false.
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
