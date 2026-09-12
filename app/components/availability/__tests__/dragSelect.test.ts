/** @vitest-environment jsdom */
//
// The drag-select model — pure logic, no layout.
//
// jsdom performs no layout, so the arithmetic that decides what a drag covers
// (which days, how solid the "next month" shadow looks, which element a
// pointer is over) is tested here directly, with plain elements standing in
// for the grid's `[data-iso]` day hosts. The grid only wires pointer events
// to these functions; it has no logic of its own to test.

import { describe, expect, it } from "vitest";
import { fmtDayLabel, isoFromPoint, isoRange, rangeLabel, shadowOpacity } from "../dragSelect";

describe("isoRange", () => {
  it("normalises reversed args and is inclusive of both ends", () => {
    expect(isoRange("2026-09-15", "2026-09-12", "2026-09-01")).toEqual([
      "2026-09-12",
      "2026-09-13",
      "2026-09-14",
      "2026-09-15",
    ]);
  });

  it("drops days before today", () => {
    expect(isoRange("2026-09-15", "2026-09-12", "2026-09-13")).toEqual([
      "2026-09-13",
      "2026-09-14",
      "2026-09-15",
    ]);
  });

  it("handles a same-day range", () => {
    expect(isoRange("2026-09-12", "2026-09-12", "2026-09-01")).toEqual(["2026-09-12"]);
  });

  it("crosses a month and year boundary", () => {
    expect(isoRange("2026-12-30", "2027-01-02", "2026-01-01")).toEqual([
      "2026-12-30",
      "2026-12-31",
      "2027-01-01",
      "2027-01-02",
    ]);
  });

  it("caps at 366 iterations for a runaway span", () => {
    const result = isoRange("2026-01-01", "2027-06-01", "2020-01-01");
    expect(result).toHaveLength(366);
  });
});

describe("shadowOpacity", () => {
  it("is 0 at or beyond reach", () => {
    expect(shadowOpacity(120)).toBe(0);
    expect(shadowOpacity(300)).toBe(0);
  });

  it("is linear between 0 and reach", () => {
    expect(shadowOpacity(60)).toBe(0.5);
  });

  it("is 1 at zero distance", () => {
    expect(shadowOpacity(0)).toBe(1);
  });

  it("treats NaN and negative distances as 1 (fully solid)", () => {
    expect(shadowOpacity(-5)).toBe(1);
    expect(shadowOpacity(NaN)).toBe(1);
  });
});

describe("isoFromPoint", () => {
  function fakeDoc(el: Element | null) {
    return { elementFromPoint: () => el } as unknown as Pick<Document, "elementFromPoint">;
  }

  it("returns the iso of the closest [data-iso] host", () => {
    const host = document.createElement("button");
    host.setAttribute("data-iso", "2026-09-12");
    const span = document.createElement("span");
    host.appendChild(span);
    expect(isoFromPoint(1, 2, fakeDoc(span))).toBe("2026-09-12");
  });

  it("returns null for an un-solid shadow host", () => {
    const host = document.createElement("button");
    host.setAttribute("data-iso", "2026-09-20");
    host.setAttribute("data-shadow", "true");
    host.setAttribute("data-solid", "false");
    expect(isoFromPoint(1, 2, fakeDoc(host))).toBeNull();
  });

  it("returns the iso for a solid shadow host", () => {
    const host = document.createElement("button");
    host.setAttribute("data-iso", "2026-09-20");
    host.setAttribute("data-shadow", "true");
    host.setAttribute("data-solid", "true");
    expect(isoFromPoint(1, 2, fakeDoc(host))).toBe("2026-09-20");
  });

  it("returns null when there is no [data-iso] host", () => {
    expect(isoFromPoint(1, 2, fakeDoc(null))).toBeNull();
  });
});

describe("rangeLabel", () => {
  it("uses the single-day label when first === last", () => {
    expect(rangeLabel("2026-09-12", "2026-09-12")).toBe(fmtDayLabel("2026-09-12"));
  });

  it("formats a same-month range", () => {
    expect(rangeLabel("2026-09-12", "2026-09-15")).toBe("del 12 al 15 de septiembre");
  });

  it("formats a cross-month range", () => {
    expect(rangeLabel("2026-10-30", "2026-11-01")).toBe("del 30 de octubre al 1 de noviembre");
  });
});
