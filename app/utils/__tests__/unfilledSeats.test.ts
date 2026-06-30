import { describe, it, expect } from "vitest";
import { summarizeUnfilledSeats } from "../unfilledSeats";

describe("summarizeUnfilledSeats", () => {
  it("returns nothing for no unfilled seats", () => {
    expect(summarizeUnfilledSeats([])).toEqual([]);
  });

  it("summarizes a single empty Choir seat in Spanish", () => {
    expect(summarizeUnfilledSeats(["W2 Sunday Sun.Choir #2"])).toEqual([
      { week: 2, service: "Domingo", labels: ["1 Coro"] },
    ]);
  });

  it("counts and pluralizes multiple seats of the same role", () => {
    const out = summarizeUnfilledSeats([
      "W2 Sunday Sun.Choir #2",
      "W2 Sunday Sun.Choir #3",
    ]);
    expect(out).toEqual([{ week: 2, service: "Domingo", labels: ["2 Coros"] }]);
  });

  it("orders roles by severity within a service (Lead, then BGV, then Choir)", () => {
    const out = summarizeUnfilledSeats([
      "W3 Sunday Sun.Choir #1",
      "W3 Sunday Sun.BGV #2",
      "W3 Sunday Sun.Lead #2",
    ]);
    expect(out).toEqual([
      { week: 3, service: "Domingo", labels: ["1 Líder", "1 BGV", "1 Coro"] },
    ]);
  });

  it("translates Saturday and keeps BGV invariant in plural", () => {
    expect(summarizeUnfilledSeats(["W4 Saturday Sat.BGV #2", "W4 Saturday Sat.BGV #3"]))
      .toEqual([{ week: 4, service: "Sábado", labels: ["2 BGV"] }]);
  });

  it("groups by week+service and sorts by week", () => {
    const out = summarizeUnfilledSeats([
      "W4 Saturday Sat.BGV #2",
      "W2 Sunday Sun.Choir #2",
      "W2 Saturday Sat.BGV #1",
    ]);
    expect(out).toEqual([
      { week: 2, service: "Domingo", labels: ["1 Coro"] },
      { week: 2, service: "Sábado", labels: ["1 BGV"] },
      { week: 4, service: "Sábado", labels: ["1 BGV"] },
    ]);
  });

  it("ignores malformed seat strings", () => {
    expect(summarizeUnfilledSeats(["garbage", "W2 Sunday Sun.Choir #1"])).toEqual([
      { week: 2, service: "Domingo", labels: ["1 Coro"] },
    ]);
  });
});
