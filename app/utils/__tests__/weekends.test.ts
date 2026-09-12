// The weekend list's spine: which ten weekends «Mi semana» offers.
//
// The boundary worth pinning is the CURRENT weekend. A member opens `/me` on a
// Saturday morning or on Sunday before the service precisely to say "not this
// one" — a list that started at the next Saturday would hide that row on the two
// days it matters most. The Monday case pins the other side: once the weekend is
// past, it is gone from the list.

import { describe, it, expect } from "vitest";
import { nextWeekends, weekendLabel } from "../weekends";

describe("nextWeekends", () => {
  it("starts with the upcoming weekend, Friday before Saturday before Sunday", () => {
    const ws = nextWeekends("2026-09-09", 10); // a Wednesday
    expect(ws[0]).toEqual({ fri: "2026-09-11", sat: "2026-09-12", sun: "2026-09-13" });
    expect(ws).toHaveLength(10);
    ws.forEach(({ fri, sat, sun }) => { expect(fri < sat).toBe(true); expect(sat < sun).toBe(true); });
  });

  it("walks forward one week at a time", () => {
    const ws = nextWeekends("2026-09-09", 3);
    expect(ws.map(w => w.fri)).toEqual(["2026-09-11", "2026-09-18", "2026-09-25"]);
    expect(ws.map(w => w.sat)).toEqual(["2026-09-12", "2026-09-19", "2026-09-26"]);
    expect(ws.map(w => w.sun)).toEqual(["2026-09-13", "2026-09-20", "2026-09-27"]);
  });

  it("keeps THIS weekend while its Sunday is still ahead", () => {
    // Friday: rehearsal day, the weekend's own Friday is today.
    expect(nextWeekends("2026-09-11", 1)[0]).toEqual({ fri: "2026-09-11", sat: "2026-09-12", sun: "2026-09-13" });
    // Saturday: the weekend starts today.
    expect(nextWeekends("2026-09-12", 1)[0]).toEqual({ fri: "2026-09-11", sat: "2026-09-12", sun: "2026-09-13" });
    // Sunday: the weekend's Saturday is yesterday, and the row stays.
    expect(nextWeekends("2026-09-13", 1)[0]).toEqual({ fri: "2026-09-11", sat: "2026-09-12", sun: "2026-09-13" });
  });

  it("drops a weekend that is over — from a Monday the next Saturday leads", () => {
    expect(nextWeekends("2026-09-14", 1)[0]).toEqual({ fri: "2026-09-18", sat: "2026-09-19", sun: "2026-09-20" });
  });

  it("crosses a month and a year without a day-flip", () => {
    // 2026-10-31 / 2026-11-01, and the last week of December into January.
    expect(nextWeekends("2026-10-26", 1)[0]).toEqual({ fri: "2026-10-30", sat: "2026-10-31", sun: "2026-11-01" });
    expect(nextWeekends("2026-12-28", 1)[0]).toEqual({ fri: "2027-01-01", sat: "2027-01-02", sun: "2027-01-03" });
  });
});

describe("weekendLabel", () => {
  it("names one month once, Friday through Sunday", () => {
    expect(weekendLabel({ fri: "2026-09-11", sat: "2026-09-12", sun: "2026-09-13" })).toBe("11 – 13 sep");
  });

  it("names both when the span straddles a month boundary", () => {
    expect(weekendLabel({ fri: "2026-10-30", sat: "2026-10-31", sun: "2026-11-01" })).toBe("30 oct – 1 nov");
  });
});
