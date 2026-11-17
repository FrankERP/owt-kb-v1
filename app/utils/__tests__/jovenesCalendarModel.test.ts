// The «Mes» view of Jóvenes' Calendario as data: its months, a month's cells, a day's marks.
import { describe, expect, it } from "vitest";
import { MINISTRIES } from "@/app/ministries";
import { calendarMonthTitle, calendarMonths, dayMarks, monthCells, monthLegend, type CalendarMeeting } from "../jovenesCalendarModel";

const [G1, G2] = MINISTRIES.jovenes.groups;
const all = (id: string, date: string, mine = false): CalendarMeeting => ({ id, date, audience: { kind: "ministry" }, mine });
const group = (id: string, date: string, groups: string[], mine = false): CalendarMeeting => ({ id, date, audience: { kind: "groups", groups }, mine });

describe("calendarMonths", () => {
  it("is today's month alone with no meetings, or with meetings only in it", () => {
    expect(calendarMonths([], "2026-11-17")).toEqual(["2026-11"]);
    expect(calendarMonths([all("a", "2026-11-21")], "2026-11-17")).toEqual(["2026-11"]);
  });

  it("runs to the last meeting's month, empty months included, across the year", () => {
    expect(calendarMonths([all("a", "2026-11-21"), all("b", "2027-02-06")], "2026-11-17")).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"]);
  });

  it("stops at three years, whatever a stored date says", () => {
    expect(calendarMonths([all("a", "9999-12-31")], "2026-11-17")).toHaveLength(36);
  });
});

describe("monthCells", () => {
  it("starts on Monday: November 2026 opens on a Sunday, six blanks before day 1", () => {
    const cells = monthCells("2026-11");
    expect(cells.slice(0, 6)).toEqual([null, null, null, null, null, null]);
    expect(cells[6]).toEqual({ date: "2026-11-01", day: 1 });
    expect(cells.at(-1)).toEqual({ date: "2026-11-30", day: 30 });
  });

  it("knows a leap February", () => {
    expect(monthCells("2028-02").filter(Boolean)).toHaveLength(29);
  });
});

describe("calendarMonthTitle", () => {
  it("names the month and the year", () => {
    expect(calendarMonthTitle("2026-11")).toBe("Noviembre 2026");
    expect(calendarMonthTitle("2027-01")).toBe("Enero 2027");
  });
});

describe("dayMarks", () => {
  it("gives a day one dot per audience of each of its meetings, and «mine» when any is the reader's", () => {
    const marks = dayMarks([all("a", "2026-11-21"), group("b", "2026-11-21", [G1.id, G2.id], true), group("c", "2026-11-22", [G1.id])]);
    const sat = marks.get("2026-11-21")!;
    expect(sat.count).toBe(2);
    expect(sat.dots.map((d) => d.key)).toEqual(["a-ministry", `b-${G1.id}`, `b-${G2.id}`]);
    expect(sat.labels).toEqual(["Todo Jóvenes", G1.name, G2.name]);
    expect(sat.mine).toBe(true);
    expect(marks.get("2026-11-22")).toMatchObject({ count: 1, mine: false, labels: [G1.name] });
    expect(marks.has("2026-11-23")).toBe(false);
  });
});

describe("monthLegend", () => {
  it("lists a month's audiences once each, in the order they appear", () => {
    const list = [group("a", "2026-11-18", [G1.id]), all("b", "2026-11-21"), group("c", "2026-11-25", [G1.id]), group("d", "2026-12-02", [G2.id])];
    expect(monthLegend(list, "2026-11").map((l) => l.label)).toEqual([G1.name, "Todo Jóvenes"]);
    expect(monthLegend(list, "2026-12").map((l) => l.label)).toEqual([G2.name]);
    expect(monthLegend(list, "2027-01")).toEqual([]);
  });
});
