import { describe, expect, it } from "vitest";
import { lessonOf, parseLesson, plusDays, shiftedDate, singleGroup } from "../ministryLesson";

// The ONE definition of a valid lesson (plan 2026-11-12 L0, L6): the writer and the reader agree.

describe("ministryLesson", () => {
  const ok = { series: "El Caos Dentro de Mi", track: "libro", done: false };

  it("accepts the stored shape, with or without its _type", () => {
    expect(parseLesson(ok)).toEqual(ok);
    expect(parseLesson({ ...ok, _type: "ministryEventLesson" })).toEqual(ok);
  });

  it.each([
    [null],
    [[ok]],
    [{ ...ok, series: " El Caos" }],
    [{ ...ok, series: "" }],
    [{ ...ok, series: "x".repeat(81) }],
    [{ ...ok, series: "a b" }],
    [{ ...ok, track: "Libro" }],
    [{ ...ok, done: 1 }],
    [{ ...ok, extra: true }],
    [{ series: "x", track: "libro" }],
  ])("rejects %j", (raw) => {
    expect(parseLesson(raw)).toBeNull();
  });

  it("is a class only on a one-group meeting", () => {
    expect(lessonOf({ kind: "groups", groups: ["otro-nivel"] }, ok)).toEqual(ok);
    expect(lessonOf({ kind: "groups", groups: ["otro-nivel", "invencibles"] }, ok)).toBeNull();
    expect(lessonOf({ kind: "ministry" }, ok)).toBeNull();
    expect(lessonOf(null, ok)).toBeNull();
    expect(singleGroup({ kind: "groups", groups: [1] })).toBeNull();
  });

  it("adds days on the calendar, across months and years", () => {
    expect(plusDays("2026-11-29", 7)).toBe("2026-12-06");
    expect(plusDays("2026-12-27", 7)).toBe("2027-01-03");
    expect(plusDays("2028-02-26", 7)).toBe("2028-03-04");
  });

  it("hops «No hubo clase» dates a week at a time", () => {
    expect(shiftedDate("2026-11-15", new Set())).toBe("2026-11-22");
    expect(shiftedDate("2026-11-15", new Set(["2026-11-22", "2026-11-29"]))).toBe("2026-12-06");
  });
});
