import { describe, it, expect } from "vitest";
import { findDuplicates, serviceTone, serviceConflicts, summarizeService, agendaRows, monthStripDays, weekStripDays, mondayOf, addDays } from "../agenda";
import type { ActiveDay } from "../../components/CalendarView";

const sun = (date: string, extra: Partial<ActiveDay> = {}): ActiveDay => ({ day: "Domingo", date, leads: ["Jakey", "Marianne"], instruments: [{ label: "Keys", person: "Sofi" }, { label: "Bass", person: "Mkz" }], setlist: { songs: Array(5).fill({ _id: "s", title: "t" }) as never, week: date }, ...extra });
const sat = (date: string): ActiveDay => ({ day: "Sábado", date, leads: ["Ana"] });
const special = (date: string): ActiveDay => ({ day: "Noche de alabanza", date, roleId: "sp1", leads: [] });

describe("findDuplicates", () => {
  it("lowercases, trims, and returns only names seen more than once", () => {
    expect([...findDuplicates(["Sofi", " sofi", "Mkz"])]).toEqual(["sofi"]);
  });
});
describe("serviceTone / serviceConflicts", () => {
  it("tones by day and roleId", () => {
    expect(serviceTone(sun("2026-09-13"))).toBe("sun");
    expect(serviceTone(sat("2026-09-12"))).toBe("sat");
    expect(serviceTone(special("2026-09-15"))).toBe("special");
  });
  it("counts a person seated twice in one section, per section", () => {
    const e = sun("2026-09-13", { leads: ["Ana", "Ana"], instruments: [{ label: "Keys", person: "Sofi" }, { label: "Bass", person: "sofi" }] });
    expect(serviceConflicts(e)).toBe(2);
    expect(serviceConflicts(sun("2026-09-13"))).toBe(0);
  });
});
describe("summarizeService", () => {
  it("joins lead · instruments · song count, skipping empty parts", () => {
    expect(summarizeService(sun("2026-09-13"))).toBe("Lead Jakey, Marianne · Keys Sofi · Bass Mkz · 5 canciones");
    expect(summarizeService(sat("2026-09-12"))).toBe("Lead Ana");
    expect(summarizeService(special("2026-09-15"))).toBe("Sin asignaciones");
  });
});
describe("agendaRows", () => {
  it("one row per service, sorted by date then Sábado < Domingo < specials, with a month marker on the first row of each month", () => {
    const rows = agendaRows({ "2026-09-13": [sun("2026-09-13")], "2026-09-12": [sat("2026-09-12")], "2026-10-04": [sun("2026-10-04")], "2026-09-13x": [] });
    expect(rows.map((r) => `${r.date} ${r.entry.day}`)).toEqual(["2026-09-12 Sábado", "2026-09-13 Domingo", "2026-10-04 Domingo"]);
    expect(rows.map((r) => r.monthStart)).toEqual(["2026-09", null, "2026-10"]);
    expect(rows[0].key).toBe("2026-09-12:Sábado");
  });
});
describe("monthStripDays", () => {
  it("lists every day of the month with weekday letters, lit tones, and today", () => {
    const days = monthStripDays("2026-09", { "2026-09-13": [sun("2026-09-13")], "2026-09-12": [sat("2026-09-12")] }, "2026-09-10");
    expect(days).toHaveLength(30);
    expect(days[0]).toMatchObject({ date: "2026-09-01", dow: "M", num: 1, tone: null, today: false });
    expect(days[11]).toMatchObject({ date: "2026-09-12", dow: "S", tone: "sat" });
    expect(days[12]).toMatchObject({ date: "2026-09-13", dow: "D", tone: "sun" });
    expect(days[9].today).toBe(true);
  });
});
describe("mondayOf / addDays", () => {
  it("resolves any day to the Monday on or before it, Sunday included", () => {
    expect(mondayOf("2026-09-09")).toBe("2026-09-07"); // a Wednesday
    expect(mondayOf("2026-09-07")).toBe("2026-09-07"); // the Monday itself
    expect(mondayOf("2026-09-13")).toBe("2026-09-07"); // the Sunday that ENDS that week
    expect(mondayOf("2026-01-01")).toBe("2025-12-29"); // across the year boundary
  });
  it("steps days across month and year boundaries", () => {
    expect(addDays("2026-09-07", 7)).toBe("2026-09-14");
    expect(addDays("2026-09-07", -7)).toBe("2026-08-31");
    expect(addDays("2026-12-28", 7)).toBe("2027-01-04");
  });
});
describe("weekStripDays", () => {
  it("gives seven days from the Monday of the given date, with weekday letters, lit tones and today", () => {
    const days = weekStripDays("2026-09-09", { "2026-09-13": [sun("2026-09-13")], "2026-09-12": [sat("2026-09-12")] }, "2026-09-10");
    expect(days).toHaveLength(7);
    expect(days.map((d) => d.dow)).toEqual(["L", "M", "X", "J", "V", "S", "D"]);
    expect(days[0]).toMatchObject({ date: "2026-09-07", num: 7, tone: null, today: false });
    expect(days[3].today).toBe(true);
    expect(days[5]).toMatchObject({ date: "2026-09-12", tone: "sat" });
    expect(days[6]).toMatchObject({ date: "2026-09-13", tone: "sun" });
  });
  it("lights a service in the next month when the week crosses the boundary", () => {
    const days = weekStripDays("2026-09-28", { "2026-10-04": [sun("2026-10-04")] }, "2026-09-10");
    expect(days.map((d) => d.date)).toEqual(["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]);
    expect(days[6]).toMatchObject({ tone: "sun", num: 4 });
  });
  it("flags a day carrying more than one service", () => {
    const days = weekStripDays("2026-09-14", { "2026-09-20": [sun("2026-09-20"), special("2026-09-20")] }, "2026-09-10");
    expect(days[6]).toMatchObject({ tone: "special", multiple: true });
  });
});
